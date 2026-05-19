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
//	{{today}}     → hoje
//	{{yesterday}} → ontem (alias de {{today-1}})
//	{{tomorrow}}  → amanhã (alias de {{today+1}})
//	{{today-N}}   → N dias antes de hoje (N inteiro)
//	{{today+N}}   → N dias depois de hoje
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
	return datePlaceholderRe.ReplaceAllStringFunc(s, func(match string) string {
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
}
