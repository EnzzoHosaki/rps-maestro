// Local: rps-maestro/internal/queue/rabbitmq.go
package queue

import (
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