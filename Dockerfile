# Dockerfile
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o rps-maestro ./cmd/api

FROM alpine:latest

WORKDIR /root/

COPY --from=builder /app/rps-maestro .

EXPOSE 8000

CMD ["./rps-maestro"]