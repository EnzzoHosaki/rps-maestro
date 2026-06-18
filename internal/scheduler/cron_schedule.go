package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

// ParseSchedule converte uma expressão de 5 campos numa cron.Schedule, sem
// fixar fuso (o SpecSchedule herda time.Local). Use pra VALIDAÇÃO, onde o fuso
// não importa. Pro runtime do scheduler use ParseScheduleTZ.
func ParseSchedule(expr string) (cron.Schedule, error) {
	return ParseScheduleTZ(expr, "")
}

// ParseScheduleTZ é como ParseSchedule, mas com fuso explícito.
//
// O cron padrão (robfig ParseStandard) NÃO entende o token `L` (último dia do
// mês). Pra suportar agendamentos tipo "dias 8,15,22 e o último dia", quando o
// campo dia-do-mês contém `L` a gente usa um Schedule próprio (monthDaysSchedule),
// cujo Next respeita o fuso do `t` que o runner passa (cron.WithLocation);
// caso contrário cai no ParseStandard normal (que já cobre listas como 8,15,22).
//
// Quando tzName != "" injeta o prefixo CRON_TZ= na expressão. Sem isso, o
// SpecSchedule do robfig herda time.Local — que no container alpine é UTC (sem
// tzdata/TZ), fazendo o cron disparar 3h adiantado. Com o prefixo o disparo fica
// preso ao fuso pretendido, independente do TZ do container.
func ParseScheduleTZ(expr, tzName string) (cron.Schedule, error) {
	fields := strings.Fields(expr)
	if len(fields) == 5 && strings.ContainsAny(fields[2], "Ll") {
		return parseMonthDaysSchedule(fields)
	}
	if tzName != "" {
		expr = "CRON_TZ=" + tzName + " " + expr
	}
	return cron.ParseStandard(expr)
}

// monthDaysSchedule dispara em HH:MM nos dias do mês listados em `days` e/ou no
// último dia do mês quando `last` é true. Mês e dia-da-semana são ignorados
// (sempre "*" nesse modo).
type monthDaysSchedule struct {
	minute, hour int
	days         map[int]bool
	last         bool
}

func parseMonthDaysSchedule(f []string) (cron.Schedule, error) {
	minute, err := atoiRange(f[0], 0, 59)
	if err != nil {
		return nil, fmt.Errorf("minuto inválido: %w", err)
	}
	hour, err := atoiRange(f[1], 0, 23)
	if err != nil {
		return nil, fmt.Errorf("hora inválida: %w", err)
	}
	// `L` só é suportado no modo mensal por dia-do-mês — mês e dia-da-semana
	// precisam ser curinga.
	if f[3] != "*" || f[4] != "*" {
		return nil, fmt.Errorf("`L` (último dia) só vale com mês e dia-da-semana = *")
	}

	sched := monthDaysSchedule{minute: minute, hour: hour, days: map[int]bool{}}
	for _, part := range strings.Split(f[2], ",") {
		if strings.EqualFold(part, "L") {
			sched.last = true
			continue
		}
		d, err := atoiRange(part, 1, 31)
		if err != nil {
			return nil, fmt.Errorf("dia do mês inválido %q: %w", part, err)
		}
		sched.days[d] = true
	}
	if len(sched.days) == 0 && !sched.last {
		return nil, fmt.Errorf("nenhum dia do mês especificado")
	}
	return sched, nil
}

// Next devolve o próximo disparo estritamente depois de t. Varre dia a dia
// (via AddDate, que normaliza fim de mês / ano bissexto), no máximo ~13 meses.
func (s monthDaysSchedule) Next(t time.Time) time.Time {
	loc := t.Location()
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	for i := 0; i < 400; i++ {
		if s.matches(d) {
			fire := time.Date(d.Year(), d.Month(), d.Day(), s.hour, s.minute, 0, 0, loc)
			if fire.After(t) {
				return fire
			}
		}
		d = d.AddDate(0, 0, 1)
	}
	return time.Time{}
}

func (s monthDaysSchedule) matches(d time.Time) bool {
	if s.days[d.Day()] {
		return true
	}
	return s.last && d.Day() == lastDayOfMonth(d)
}

// lastDayOfMonth usa o truque do dia 0 do mês seguinte (= último do atual).
func lastDayOfMonth(d time.Time) int {
	return time.Date(d.Year(), d.Month()+1, 0, 0, 0, 0, 0, d.Location()).Day()
}

func atoiRange(s string, lo, hi int) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, err
	}
	if n < lo || n > hi {
		return 0, fmt.Errorf("%d fora do intervalo [%d,%d]", n, lo, hi)
	}
	return n, nil
}

// PrevFire devolve o disparo mais recente ANTES de `now` para uma schedule
// qualquer (cron.Schedule só expõe Next, não Prev). Faz uma busca com janela
// exponencial: tenta 1d, 7d, 40d, 200d atrás e, na primeira janela que contém
// um disparo, anda pra frente guardando o último antes de `now`. Isso é
// eficiente tanto pra schedules sub-diárias (janela 1d) quanto mensais (40d).
// Devolve zero se não achar (ex.: schedule sem disparo no último ~ano).
func PrevFire(sched cron.Schedule, now time.Time) time.Time {
	if sched == nil {
		return time.Time{}
	}
	for _, back := range []time.Duration{
		24 * time.Hour,
		7 * 24 * time.Hour,
		40 * 24 * time.Hour,
		200 * 24 * time.Hour,
	} {
		t := now.Add(-back)
		var prev time.Time
		for i := 0; i < 5000; i++ {
			next := sched.Next(t)
			if next.IsZero() || !next.Before(now) {
				break
			}
			prev = next
			t = next
		}
		if !prev.IsZero() {
			return prev
		}
	}
	return time.Time{}
}
