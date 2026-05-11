# syntax=docker/dockerfile:1.7

FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./

RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# Cache mounts mantêm o build cache do Go (compilados) e o module cache entre
# rebuilds. CGO_ENABLED=0 já garante binário estático — `-a -installsuffix cgo`
# foram removidos pois forçavam rebuild completo de todos os pacotes a cada
# build, mesmo quando só uma linha mudou.
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -o rps-maestro ./cmd/api

FROM alpine:latest

WORKDIR /root/

COPY --from=builder /app/rps-maestro .
COPY --from=builder /app/configs ./configs

EXPOSE 8000

CMD ["./rps-maestro"]
