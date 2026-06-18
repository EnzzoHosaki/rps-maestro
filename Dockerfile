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

# Fuso horário de Brasília como padrão do container — alinha logs e qualquer
# uso de time.Local. O scheduler já é blindado em código (embute time/tzdata +
# fixa America/Sao_Paulo), mas isso mantém o resto da app coerente. tzdata dá
# suporte a /etc/localtime; sobrescreva via env TZ se precisar de outro fuso.
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

WORKDIR /root/

COPY --from=builder /app/rps-maestro .
COPY --from=builder /app/configs ./configs

EXPOSE 8000

CMD ["./rps-maestro"]
