// Local: rps-maestro/internal/queue/rabbitmq.go
package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/rabbitmq/amqp091-go"
)

type RabbitMQClient struct {
	 conn    *amqp091.Connection
	 channel *amqp091.Channel
}
	func NewRabbitMQClient(cfg config.RabbitMQConfig) (*RabbitMQClient, error) {
		connStr := fmt.Sprintf("amqp://%s:%s@%s:%d/",
			cfg.User,
			cfg.Password,
			cfg.Host,
			cfg.Port,
		)

		conn, err := amqp091.Dial(connStr)
		if err != nil {
			return nil, fmt.Errorf("falha ao conectar ao RabbitMQ: %w", err)
		}

		go func() {
			<-conn.NotifyClose(make(chan *amqp091.Error))
			log.Fatalf("[FATAL] Conexão com RabbitMQ perdida!")
		}()

		channel, err := conn.Channel()
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("falha ao abrir canal RabbitMQ: %w", err)
		}

		log.Println("Conexão com RabbitMQ estabelecida e canal aberto com sucesso!")

		client := &RabbitMQClient{
			conn:    conn,
			channel: channel,
		}

		return client, nil
}

func (c *RabbitMQClient) Close() {
		if c.channel != nil {
			err := c.channel.Close()
			if err != nil {
				log.Printf("Erro ao fechar canal RabbitMQ: %v", err)
			}
		}
		if c.conn != nil {
			err := c.conn.Close()
			if err != nil {
				log.Printf("Erro ao fechar conexão RabbitMQ: %v", err)
			}
		}
		log.Println("Conexão com RabbitMQ fechada.")
}

type JobMessage struct {
	JobID        string                 `json:"job_id"`
	AutomationID int                    `json:"automation_id"`
	ScriptPath   string                 `json:"script_path"`
	Parameters   map[string]interface{} `json:"parameters"`
}

func (c *RabbitMQClient) PublishJob(ctx context.Context, queueName string, msg JobMessage) error {
	queue, err := c.channel.QueueDeclare(
		queueName,
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("falha ao declarar fila: %w", err)
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("falha ao serializar mensagem: %w", err)
	}

	err = c.channel.PublishWithContext(
		ctx,
		"",
		queue.Name,
		false,
		false,
		amqp091.Publishing{
			DeliveryMode: amqp091.Persistent,
			ContentType:  "application/json",
			Body:         body,
		},
	)
	if err != nil {
		return fmt.Errorf("falha ao publicar mensagem: %w", err)
	}

	log.Printf("Mensagem publicada na fila %s para job %s", queueName, msg.JobID)
	return nil
}