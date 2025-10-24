// Local: rps-maestro/internal/config/config.go
package config

import (
	"strings"
	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	RabbitMQ RabbitMQConfig
}

type ServerConfig struct {
	Port int
}

type DatabaseConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
}

type RabbitMQConfig struct {
	Host     string
	Port     int
	User     string
	Password string
}

func LoadConfig(path string) (config Config, err error) {
	viper.AddConfigPath(path)
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")

	// Configurar variáveis de ambiente
	viper.SetEnvPrefix("MAESTRO")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	// Bind específico das variáveis de ambiente
	viper.BindEnv("database.host", "MAESTRO_DB_HOST")
	viper.BindEnv("database.port", "MAESTRO_DB_PORT")
	viper.BindEnv("database.user", "MAESTRO_DB_USER")
	viper.BindEnv("database.password", "MAESTRO_DB_PASSWORD")
	viper.BindEnv("database.dbname", "MAESTRO_DB_NAME")
	
	viper.BindEnv("rabbitmq.host", "MAESTRO_RABBITMQ_HOST")
	viper.BindEnv("rabbitmq.port", "MAESTRO_RABBITMQ_PORT")
	viper.BindEnv("rabbitmq.user", "MAESTRO_RABBITMQ_USER")
	viper.BindEnv("rabbitmq.password", "MAESTRO_RABBITMQ_PASSWORD")
	
	viper.BindEnv("server.port", "MAESTRO_SERVER_PORT")

	_ = viper.ReadInConfig()

	err = viper.Unmarshal(&config)
	return
}