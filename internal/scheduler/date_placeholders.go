package scheduler

import (
	"regexp"
	"strconv"
	"time"
)

// datePlaceholderRe casa tokens como {{today}}, {{yesterday}}, {{tomorrow}},
// {{today-N}} e {{today+N}} (apenas o keyword `today` aceita offset; os
// aliases yesterday/tomorrow são equivalentes a today-1 / today+1).
var datePlaceholderRe = regexp.MustCompile(`\{\{(today|yesterday|tomorrow)([+-]\d+)?\}\}`)

// monthPlaceholderRe casa tokens ancorados no mês corrente da execução:
// {{first_of_month}}, {{last_of_month}}, {{first_of_last_month}},
// {{last_of_last_month}}. Esses tokens não aceitam offset numérico — a
// semântica de "1º dia do mês anterior, menos 3 dias" seria ambígua.
var monthPlaceholderRe = regexp.MustCompile(`\{\{(first_of_month|last_of_month|first_of_last_month|last_of_last_month)\}\}`)

// dateLayoutBR é o formato padrão do projeto (mesmo aceito pelos workers
// de NFe/NFCe). Se mais formatos virarem necessários, expandir a sintaxe
// pra {{today-1|2006-01-02}} ou similar — hoje não tem demanda.
const dateLayoutBR = "02/01/2006"

// ExpandDatePlaceholders percorre o map de parâmetros recursivamente e
// substitui qualquer ocorrência de placeholder de data por uma string
// formatada em dd/MM/yyyy.
//
// O cálculo é feito relativo a `now` — passar time.Now() no caller. Isso
// facilita testar e evita que a expansão fique presa a um instante salvo
// em outro lugar.
//
// Tokens suportados:
//
//	{{today}}                 → hoje
//	{{yesterday}}             → ontem (alias de {{today-1}})
//	{{tomorrow}}              → amanhã (alias de {{today+1}})
//	{{today-N}}               → N dias antes de hoje (N inteiro)
//	{{today+N}}               → N dias depois de hoje
//	{{first_of_month}}        → 1º dia do mês corrente
//	{{last_of_month}}         → último dia do mês corrente
//	{{first_of_last_month}}   → 1º dia do mês anterior
//	{{last_of_last_month}}    → último dia do mês anterior
//
// Combinações em uma mesma string são suportadas: "{{today-2}} a {{yesterday}}"
// vira "17/05/2026 a 18/05/2026" se hoje for 19/05/2026.
func ExpandDatePlaceholders(params map[string]interface{}, now time.Time) map[string]interface{} {
	if params == nil {
		return nil
	}
	out := make(map[string]interface{}, len(params))
	for k, v := range params {
		out[k] = expandValue(v, now)
	}
	return out
}

func expandValue(v interface{}, now time.Time) interface{} {
	switch x := v.(type) {
	case string:
		return expandString(x, now)
	case []interface{}:
		out := make([]interface{}, len(x))
		for i, item := range x {
			out[i] = expandValue(item, now)
		}
		return out
	case map[string]interface{}:
		return ExpandDatePlaceholders(x, now)
	default:
		return v
	}
}

func expandString(s string, now time.Time) string {
	s = datePlaceholderRe.ReplaceAllStringFunc(s, func(match string) string {
		sub := datePlaceholderRe.FindStringSubmatch(match)
		keyword := sub[1]
		offsetStr := sub[2]

		days := 0
		switch keyword {
		case "yesterday":
			days = -1
		case "tomorrow":
			days = 1
		}
		if offsetStr != "" {
			n, err := strconv.Atoi(offsetStr)
			if err == nil {
				days += n
			}
		}

		return now.AddDate(0, 0, days).Format(dateLayoutBR)
	})

	s = monthPlaceholderRe.ReplaceAllStringFunc(s, func(match string) string {
		sub := monthPlaceholderRe.FindStringSubmatch(match)
		return resolveMonthToken(sub[1], now).Format(dateLayoutBR)
	})

	return s
}

// resolveMonthToken devolve o time.Time correspondente ao token de mês.
// Usa o truque do time.Date com dia=0 (= último dia do mês anterior) e
// mês+1 (Go normaliza overflow) pra não precisar calcular comprimento de
// mês na mão — funciona pra fevereiro bissexto também.
func resolveMonthToken(token string, now time.Time) time.Time {
	y, m, _ := now.Date()
	loc := now.Location()
	switch token {
	case "first_of_month":
		return time.Date(y, m, 1, 0, 0, 0, 0, loc)
	case "last_of_month":
		return time.Date(y, m+1, 0, 0, 0, 0, 0, loc)
	case "first_of_last_month":
		return time.Date(y, m-1, 1, 0, 0, 0, 0, loc)
	case "last_of_last_month":
		return time.Date(y, m, 0, 0, 0, 0, 0, loc)
	}
	return now
}
