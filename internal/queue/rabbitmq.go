package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/rabbitmq/amqp091-go"
	"github.com/rs/zerolog/log"
)

const (
	dlxName = "maestro.dlx"
	dlqName = "maestro.dlq"

	reconnectInitialBackoff = 1 * time.Second
	reconnectMaxBackoff     = 30 * time.Second
)

// RabbitMQClient mantém conexão+canal com o broker e se reconecta sozinho se a
// conexão cair (antes era log.Fatal, que derrubava o backend inteiro). O acesso
// ao canal é protegido por mutex porque publish (handlers + retry worker) roda
// concorrente com a troca de canal feita pela reconexão.
type RabbitMQClient struct {
	cfg config.RabbitMQConfig

	mu      sync.RWMutex
	conn    *amqp091.Connection
	channel *amqp091.Channel

	closed atomic.Bool // true após Close() intencional — para de reconectar

	// Consumidor da DLQ registrado por ConsumeDLQ; guardado pra re-anexar a cada
	// reconexão (o canal antigo morre junto com a conexão).
	dlqMu      sync.Mutex
	dlqHandler func(jobID string, reason string)
	dlqCtx     context.Context
}

func NewRabbitMQClient(cfg config.RabbitMQConfig) (*RabbitMQClient, error) {
	c := &RabbitMQClient{cfg: cfg}
	if err := c.connect(); err != nil {
		return nil, err
	}
	go c.watchReconnect()
	log.Info().Msg("conexão com RabbitMQ estabelecida")
	return c, nil
}

// connect estabelece conn+channel e (re)declara a DLQ. Substitui os ponteiros
// sob lock pra publishes concorrentes sempre verem um canal consistente.
func (c *RabbitMQClient) connect() error {
	connStr := fmt.Sprintf("amqp://%s:%s@%s:%d/",
		c.cfg.User, c.cfg.Password, c.cfg.Host, c.cfg.Port,
	)

	conn, err := amqp091.Dial(connStr)
	if err != nil {
		return fmt.Errorf("falha ao conectar ao RabbitMQ: %w", err)
	}

	channel, err := conn.Channel()
	if err != nil {
		conn.Close()
		return fmt.Errorf("falha ao abrir canal RabbitMQ: %w", err)
	}

	if err := setupDLQ(channel); err != nil {
		conn.Close()
		return fmt.Errorf("falha ao configurar DLQ: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.channel = channel
	c.mu.Unlock()
	return nil
}

// watchReconnect roda em goroutine: observa o fechamento da conexão atual e,
// quando cai (não sendo um Close() intencional), reconecta com backoff
// exponencial e re-anexa o consumidor da DLQ.
func (c *RabbitMQClient) watchReconnect() {
	for {
		c.mu.RLock()
		conn := c.conn
		c.mu.RUnlock()
		if conn == nil {
			return
		}

		closeErr := <-conn.NotifyClose(make(chan *amqp091.Error))
		if c.closed.Load() {
			return // fechamento intencional via Close()
		}
		log.Warn().Err(closeErr).Msg("conexão com RabbitMQ perdida, reconectando…")

		backoff := reconnectInitialBackoff
		for !c.closed.Load() {
			time.Sleep(backoff)
			if err := c.connect(); err != nil {
				log.Error().Err(err).Dur("retry_in", backoff).Msg("falha ao reconectar ao RabbitMQ")
				backoff *= 2
				if backoff > reconnectMaxBackoff {
					backoff = reconnectMaxBackoff
				}
				continue
			}
			log.Info().Msg("reconectado ao RabbitMQ")
			c.reattachDLQ()
			break
		}
	}
}

// reattachDLQ re-registra o consumidor da DLQ no canal novo, se algum tiver sido
// registrado por ConsumeDLQ.
func (c *RabbitMQClient) reattachDLQ() {
	c.dlqMu.Lock()
	handler, ctx := c.dlqHandler, c.dlqCtx
	c.dlqMu.Unlock()
	if handler == nil {
		return
	}
	if err := c.consume(ctx, handler); err != nil {
		log.Error().Err(err).Msg("falha ao re-anexar consumidor da DLQ após reconexão")
	}
}

// setupDLQ declara o dead-letter exchange e a fila de dead-letters.
func setupDLQ(channel *amqp091.Channel) error {
	if err := channel.ExchangeDeclare(dlxName, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("falha ao declarar DLX: %w", err)
	}
	if _, err := channel.QueueDeclare(dlqName, true, false, false, false, nil); err != nil {
		return fmt.Errorf("falha ao declarar DLQ: %w", err)
	}
	if err := channel.QueueBind(dlqName, "", dlxName, false, nil); err != nil {
		return fmt.Errorf("falha ao vincular DLQ ao DLX: %w", err)
	}
	return nil
}

func (c *RabbitMQClient) Close() {
	c.closed.Store(true)
	c.mu.Lock()
	defer c.mu.Unlock()
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
	c.mu.RLock()
	channel := c.channel
	c.mu.RUnlock()
	if channel == nil {
		return errors.New("canal RabbitMQ indisponível (reconectando)")
	}

	// Declara a fila com dead-letter exchange configurado
	args := amqp091.Table{
		"x-dead-letter-exchange": dlxName,
	}
	q, err := channel.QueueDeclare(queueName, true, false, false, false, args)
	if err != nil {
		return fmt.Errorf("falha ao declarar fila: %w", err)
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("falha ao serializar mensagem: %w", err)
	}

	err = channel.PublishWithContext(ctx, "", q.Name, false, false,
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
// handler recebe o job_id e a razão da morte (x-death header). O consumidor é
// re-anexado automaticamente a cada reconexão.
func (c *RabbitMQClient) ConsumeDLQ(ctx context.Context, handler func(jobID string, reason string)) error {
	c.dlqMu.Lock()
	c.dlqHandler = handler
	c.dlqCtx = ctx
	c.dlqMu.Unlock()
	return c.consume(ctx, handler)
}

func (c *RabbitMQClient) consume(ctx context.Context, handler func(jobID string, reason string)) error {
	c.mu.RLock()
	channel := c.channel
	c.mu.RUnlock()
	if channel == nil {
		return errors.New("canal RabbitMQ indisponível (reconectando)")
	}

	msgs, err := channel.Consume(dlqName, "dlq-consumer", false, false, false, false, nil)
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
					// canal fechou (provável queda da conexão) — a goroutine
					// de reconexão re-anexa o consumidor num canal novo.
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
