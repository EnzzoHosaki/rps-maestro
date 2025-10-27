"""
Exemplo de automação Python que se conecta ao PostgreSQL e RabbitMQ do Maestro
"""
import os
import psycopg2
import pika
import requests
import json
from datetime import datetime

class MaestroAutomation:
    def __init__(self):
        # Configurações do PostgreSQL
        self.db_config = {
            'host': os.getenv('POSTGRES_HOST', 'maestro_postgres'),
            'port': os.getenv('POSTGRES_PORT', 5432),
            'user': os.getenv('POSTGRES_USER', 'user'),
            'password': os.getenv('POSTGRES_PASSWORD', 'password'),
            'database': os.getenv('POSTGRES_DB', 'maestro_db')
        }
        
        # Configurações do RabbitMQ
        self.rabbitmq_config = {
            'host': os.getenv('RABBITMQ_HOST', 'maestro_rabbitmq'),
            'port': int(os.getenv('RABBITMQ_PORT', 5672)),
            'user': os.getenv('RABBITMQ_USER', 'guest'),
            'password': os.getenv('RABBITMQ_PASSWORD', 'guest')
        }
        
        # URL da API do Maestro
        self.api_url = os.getenv('MAESTRO_API_URL', 'http://maestro_backend:8000')
        
    def connect_db(self):
        """Conecta ao banco de dados PostgreSQL"""
        try:
            conn = psycopg2.connect(**self.db_config)
            print(f"✓ Conectado ao PostgreSQL em {self.db_config['host']}")
            return conn
        except Exception as e:
            print(f"✗ Erro ao conectar ao PostgreSQL: {e}")
            return None
    
    def connect_rabbitmq(self):
        """Conecta ao RabbitMQ"""
        try:
            credentials = pika.PlainCredentials(
                self.rabbitmq_config['user'],
                self.rabbitmq_config['password']
            )
            parameters = pika.ConnectionParameters(
                host=self.rabbitmq_config['host'],
                port=self.rabbitmq_config['port'],
                credentials=credentials
            )
            connection = pika.BlockingConnection(parameters)
            channel = connection.channel()
            print(f"✓ Conectado ao RabbitMQ em {self.rabbitmq_config['host']}")
            return connection, channel
        except Exception as e:
            print(f"✗ Erro ao conectar ao RabbitMQ: {e}")
            return None, None
    
    def create_job_log(self, job_id, level, message):
        """Cria um log para o job no banco de dados"""
        conn = self.connect_db()
        if conn:
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO job_logs (job_id, level, message) VALUES (%s, %s, %s)",
                    (job_id, level, message)
                )
                conn.commit()
                cursor.close()
                conn.close()
                print(f"✓ Log criado para job {job_id}")
            except Exception as e:
                print(f"✗ Erro ao criar log: {e}")
    
    def run(self):
        """Executa a automação de exemplo"""
        print("=" * 50)
        print("Iniciando automação de exemplo do Maestro")
        print("=" * 50)
        
        # Testa conexão com PostgreSQL
        conn = self.connect_db()
        if conn:
            cursor = conn.cursor()
            cursor.execute("SELECT version();")
            version = cursor.fetchone()
            print(f"Versão do PostgreSQL: {version[0]}")
            cursor.close()
            conn.close()
        
        # Testa conexão com RabbitMQ
        connection, channel = self.connect_rabbitmq()
        if connection and channel:
            # Declara uma fila de exemplo
            channel.queue_declare(queue='test_queue', durable=True)
            print("✓ Fila de teste declarada no RabbitMQ")
            connection.close()
        
        # Testa conexão com a API do Maestro
        try:
            response = requests.get(f"{self.api_url}/api/v1/health")
            if response.status_code == 200:
                print(f"✓ API do Maestro está saudável: {response.json()}")
        except Exception as e:
            print(f"✗ Erro ao conectar à API do Maestro: {e}")
        
        print("=" * 50)
        print("Automação concluída com sucesso!")
        print("=" * 50)

if __name__ == "__main__":
    automation = MaestroAutomation()
    automation.run()
