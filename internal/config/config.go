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

	viper.SetEnvPrefix("MAESTRO")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	_ = viper.ReadInConfig()

	err = viper.Unmarshal(&config)
	return
}