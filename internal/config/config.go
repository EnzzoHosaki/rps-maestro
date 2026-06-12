// Local: rps-maestro/internal/config/config.go
package config

import (
	"errors"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	RabbitMQ RabbitMQConfig
	JWT      JWTConfig
	Worker   WorkerConfig
	Log      LogConfig
}

type ServerConfig struct {
	Port           int
	AllowedOrigins []string `mapstructure:"-"`
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

type JWTConfig struct {
	Secret    string `mapstructure:"secret"`
	ExpiresIn int    `mapstructure:"expires_in"` // horas
}

type WorkerConfig struct {
	APIKey string `mapstructure:"apikey"`
}

type LogConfig struct {
	Level string `mapstructure:"level"`
}

func LoadConfig(path string) (config Config, err error) {
	viper.AddConfigPath(path)
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")

	viper.SetEnvPrefix("MAESTRO")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	bindings := map[string]string{
		"database.host":         "MAESTRO_DB_HOST",
		"database.port":         "MAESTRO_DB_PORT",
		"database.user":         "MAESTRO_DB_USER",
		"database.password":     "MAESTRO_DB_PASSWORD",
		"database.dbname":       "MAESTRO_DB_NAME",
		"rabbitmq.host":         "MAESTRO_RABBITMQ_HOST",
		"rabbitmq.port":         "MAESTRO_RABBITMQ_PORT",
		"rabbitmq.user":         "MAESTRO_RABBITMQ_USER",
		"rabbitmq.password":     "MAESTRO_RABBITMQ_PASSWORD",
		"server.port":           "MAESTRO_SERVER_PORT",
		"server.allowedorigins": "MAESTRO_CORS_ALLOWED_ORIGINS",
		"worker.apikey":         "MAESTRO_WORKER_API_KEY",
		"jwt.secret":            "MAESTRO_JWT_SECRET",
		"jwt.expires_in":        "MAESTRO_JWT_EXPIRES_IN",
		"log.level":             "MAESTRO_LOG_LEVEL",
	}

	for key, env := range bindings {
		viper.BindEnv(key, env)
	}

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("rabbitmq.host", "localhost")
	viper.SetDefault("rabbitmq.port", 5672)
	viper.SetDefault("server.port", 8000)
	viper.SetDefault("jwt.expires_in", 24)
	viper.SetDefault("log.level", "info")

	_ = viper.ReadInConfig()

	if err = viper.Unmarshal(&config); err != nil {
		return
	}

	if raw := viper.GetString("server.allowedorigins"); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if t := strings.TrimSpace(o); t != "" {
				config.Server.AllowedOrigins = append(config.Server.AllowedOrigins, t)
			}
		}
	}
	return
}

// Validate falha rápido no boot quando uma config crítica está ausente, em vez
// de subir num estado inseguro/quebrado. O compose já exige MAESTRO_JWT_SECRET
// via `${VAR:?}`, mas validar aqui protege execuções fora do compose (binário
// solto, testes, outro orquestrador).
func (c Config) Validate() error {
	if strings.TrimSpace(c.JWT.Secret) == "" {
		return errors.New("MAESTRO_JWT_SECRET é obrigatório (gere com: openssl rand -base64 48)")
	}
	if c.Database.Password == "" {
		return errors.New("MAESTRO_DB_PASSWORD é obrigatório")
	}
	return nil
}
