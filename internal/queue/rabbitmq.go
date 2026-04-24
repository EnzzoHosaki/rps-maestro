package queue

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/rabbitmq/amqp091-go"
	"github.com/rs/zerolog/log"
)

const (
	dlxName = "maestro.dlx"
	dlqName = "maestro.dlq"
)

type RabbitMQClient struct {
	conn    *amqp091.Connection
	channel *amqp091.Channel
}

func NewRabbitMQClient(cfg config.RabbitMQConfig) (*RabbitMQClient, error) {
	connStr := fmt.Sprintf("amqp://%s:%s@%s:%d/",
		cfg.User, cfg.Password, cfg.Host, cfg.Port,
	)

	conn, err := amqp091.Dial(connStr)
	if err != nil {
		return nil, fmt.Errorf("falha ao conectar ao RabbitMQ: %w", err)
	}

	go func() {
		<-conn.NotifyClose(make(chan *amqp091.Error))
		log.Fatal().Msg("conexão com RabbitMQ perdida")
	}()

	channel, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("falha ao abrir canal RabbitMQ: %w", err)
	}

	client := &RabbitMQClient{conn: conn, channel: channel}

	if err := client.setupDLQ(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("falha ao configurar DLQ: %w", err)
	}

	log.Info().Msg("conexão com RabbitMQ estabelecida")
	return client, nil
}

// setupDLQ declara o dead-letter exchange e a fila de dead-letters.
func (c *RabbitMQClient) setupDLQ() error {
	if err := c.channel.ExchangeDeclare(dlxName, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("falha ao declarar DLX: %w", err)
	}
	if _, err := c.channel.QueueDeclare(dlqName, true, false, false, false, nil); err != nil {
		return fmt.Errorf("falha ao declarar DLQ: %w", err)
	}
	if err := c.channel.QueueBind(dlqName, "", dlxName, false, nil); err != nil {
		return fmt.Errorf("falha ao vincular DLQ ao DLX: %w", err)
	}
	return nil
}

func (c *RabbitMQClient) Close() {
	if c.channel != nil {
		if err := c.channel.Close(); err != nil {
			log.Error().Err(err).Msg("erro ao fechar canal RabbitMQ")
		}
	}
	if c.conn != nil {
		if err := c.conn.Close(); err != nil {
			log.Error().Err(err).Msg("erro ao fechar conexão RabbitMQ")
		}
	}
	log.Info().Msg("conexão com RabbitMQ fechada")
}

type JobMessage struct {
	JobID        string                 `json:"job_id"`
	AutomationID int                    `json:"automation_id"`
	ScriptPath   string                 `json:"script_path"`
	Parameters   map[string]interface{} `json:"parameters"`
}

func (c *RabbitMQClient) PublishJob(ctx context.Context, queueName string, msg JobMessage) error {
	// Declara a fila com dead-letter exchange configurado
	args := amqp091.Table{
		"x-dead-letter-exchange": dlxName,
	}
	q, err := c.channel.QueueDeclare(queueName, true, false, false, false, args)
	if err != nil {
		return fmt.Errorf("falha ao declarar fila: %w", err)
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("falha ao serializar mensagem: %w", err)
	}

	err = c.channel.PublishWithContext(ctx, "", q.Name, false, false,
		amqp091.Publishing{
			DeliveryMode: amqp091.Persistent,
			ContentType:  "application/json",
			Body:         body,
		},
	)
	if err != nil {
		return fmt.Errorf("falha ao publicar mensagem: %w", err)
	}

	log.Info().Str("queue", queueName).Str("job_id", msg.JobID).Msg("job publicado")
	return nil
}

// ConsumeDLQ consome mensagens da dead-letter queue e chama handler para cada uma.
// handler recebe o job_id e a razão da morte (x-death header).
func (c *RabbitMQClient) ConsumeDLQ(ctx context.Context, handler func(jobID string, reason string)) error {
	msgs, err := c.channel.Consume(dlqName, "dlq-consumer", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("falha ao consumir DLQ: %w", err)
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case d, ok := <-msgs:
				if !ok {
					return
				}
				var msg JobMessage
				if err := json.Unmarshal(d.Body, &msg); err != nil {
					log.Error().Err(err).Msg("DLQ: falha ao desserializar mensagem")
					d.Nack(false, false)
					continue
				}

				reason := "unknown"
				if deaths, ok := d.Headers["x-death"].([]interface{}); ok && len(deaths) > 0 {
					if death, ok := deaths[0].(amqp091.Table); ok {
						if r, ok := death["reason"].(string); ok {
							reason = r
						}
					}
				}

				handler(msg.JobID, reason)
				d.Ack(false)
			}
		}
	}()

	return nil
}
