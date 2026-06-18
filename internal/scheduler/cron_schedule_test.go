package scheduler

import (
	"testing"
	"time"
)

func mustParse(t *testing.T, expr string) interface{ Next(time.Time) time.Time } {
	t.Helper()
	s, err := ParseSchedule(expr)
	if err != nil {
		t.Fatalf("ParseSchedule(%q) erro: %v", expr, err)
	}
	return s
}

func d(y int, m time.Month, day, h, min int) time.Time {
	return time.Date(y, m, day, h, min, 0, 0, time.UTC)
}

func TestMonthDaysSchedule_Next_lastDay(t *testing.T) {
	// dias 8,15,22 e o último dia do mês, às 08:00
	s := mustParse(t, "0 8 8,15,22,L * *")

	cases := []struct {
		from time.Time
		want time.Time
	}{
		// dentro de junho (30 dias): sequência 8 → 15 → 22 → 30 → 8/jul
		{d(2026, time.June, 1, 0, 0), d(2026, time.June, 8, 8, 0)},
		{d(2026, time.June, 8, 8, 0), d(2026, time.June, 15, 8, 0)},
		{d(2026, time.June, 22, 9, 0), d(2026, time.June, 30, 8, 0)},  // próximo é o último dia (30)
		{d(2026, time.June, 30, 8, 0), d(2026, time.July, 8, 8, 0)},   // vira o mês
		// fevereiro não-bissexto (28) e bissexto (29)
		{d(2026, time.February, 23, 0, 0), d(2026, time.February, 28, 8, 0)},
		{d(2024, time.February, 23, 0, 0), d(2024, time.February, 29, 8, 0)},
		// janeiro (31)
		{d(2026, time.January, 23, 0, 0), d(2026, time.January, 31, 8, 0)},
	}
	for _, c := range cases {
		got := s.Next(c.from)
		if !got.Equal(c.want) {
			t.Errorf("Next(%s) = %s; quer %s", c.from.Format(time.RFC3339), got.Format(time.RFC3339), c.want.Format(time.RFC3339))
		}
	}
}

func TestParseSchedule_routesStandard(t *testing.T) {
	// sem L → cai no ParseStandard (lista numérica funciona)
	s := mustParse(t, "0 8 8,15,22 * *")
	got := s.Next(d(2026, time.June, 10, 0, 0))
	if want := d(2026, time.June, 15, 8, 0); !got.Equal(want) {
		t.Errorf("Next = %s; quer %s", got, want)
	}
}

func TestParseSchedule_invalid(t *testing.T) {
	for _, expr := range []string{"0 8 8,L 6 *", "0 8 L * 1", "xx"} {
		if _, err := ParseSchedule(expr); err == nil {
			t.Errorf("ParseSchedule(%q) deveria falhar", expr)
		}
	}
}

func TestPrevFire(t *testing.T) {
	cases := []struct {
		now  time.Time
		want time.Time
	}{
		// no disparo do dia 8 (truncado), o anterior é o último dia de maio (31)
		{d(2026, time.June, 8, 8, 0), d(2026, time.May, 31, 8, 0)},
		// no disparo do dia 15, o anterior é o dia 8
		{d(2026, time.June, 15, 8, 0), d(2026, time.June, 8, 8, 0)},
		// meio do ciclo (dia 10), o anterior ainda é o dia 8
		{d(2026, time.June, 10, 12, 0), d(2026, time.June, 8, 8, 0)},
	}
	for _, c := range cases {
		sc, _ := ParseSchedule("0 8 8,15,22,L * *")
		got := PrevFire(sc, c.now)
		if !got.Equal(c.want) {
			t.Errorf("PrevFire(%s) = %s; quer %s", c.now.Format(time.RFC3339), got.Format(time.RFC3339), c.want.Format(time.RFC3339))
		}
	}
}

func TestExpandDatePlaceholders_prevRun(t *testing.T) {
	now := d(2026, time.June, 8, 8, 0)
	prev := d(2026, time.May, 31, 8, 0)
	params := map[string]interface{}{
		"inicio": "{{prev_run+1}}",
		"fim":    "{{yesterday}}",
		"hoje":   "{{today}}",
	}
	out := ExpandDatePlaceholders(params, now, prev)
	if out["inicio"] != "01/06/2026" {
		t.Errorf("prev_run+1 = %v; quer 01/06/2026", out["inicio"])
	}
	if out["fim"] != "07/06/2026" {
		t.Errorf("yesterday = %v; quer 07/06/2026", out["fim"])
	}
	if out["hoje"] != "08/06/2026" {
		t.Errorf("today = %v; quer 08/06/2026", out["hoje"])
	}

	// prev_run com zero (execução manual) cai pra hoje, sem vazar o token
	out2 := ExpandDatePlaceholders(map[string]interface{}{"x": "{{prev_run}}"}, now, time.Time{})
	if out2["x"] != "08/06/2026" {
		t.Errorf("prev_run sem contexto = %v; quer fallback 08/06/2026", out2["x"])
	}
}

// TestParseScheduleTZ_pinnedTimezone garante a correção do bug "agendado pra
// 01:00 disparou às 22:00": no container alpine time.Local é UTC, então sem
// fixar o fuso o cron "0 1 * * *" dispara às 01:00 UTC (= 22:00 BRT). Com o
// CRON_TZ injetado, o próximo disparo cai às 01:00 em America/Sao_Paulo, que é
// 04:00 UTC — independente do time.Local do processo.
func TestParseScheduleTZ_pinnedTimezone(t *testing.T) {
	br, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatalf("LoadLocation: %v (binário embute time/tzdata?)", err)
	}

	// "agora" = 2026-06-17 00:00 UTC (= 16/06 21:00 BRT). O próximo "01:00 BRT"
	// é 17/06 01:00 BRT = 17/06 04:00 UTC.
	now := time.Date(2026, time.June, 17, 0, 0, 0, 0, time.UTC)

	withTZ, err := ParseScheduleTZ("0 1 * * *", "America/Sao_Paulo")
	if err != nil {
		t.Fatalf("ParseScheduleTZ com fuso: %v", err)
	}
	gotTZ := withTZ.Next(now)
	wantTZ := time.Date(2026, time.June, 17, 1, 0, 0, 0, br) // 01:00 BRT
	if !gotTZ.Equal(wantTZ) {
		t.Errorf("com fuso: próximo disparo = %s; queria %s (01:00 BRT)", gotTZ.UTC(), wantTZ.UTC())
	}
	if h := gotTZ.UTC().Hour(); h != 4 {
		t.Errorf("com fuso: disparo em UTC = %dh; queria 4h (01:00 BRT)", h)
	}

	// Sem fixar fuso, o SpecSchedule herda time.Local. Não dá pra forçar
	// time.Local num teste de forma portátil, então só garantimos que a versão
	// sem TZ NÃO está presa ao BRT (ou seja, o prefixo CRON_TZ é o que prende).
	noTZ, err := ParseScheduleTZ("0 1 * * *", "")
	if err != nil {
		t.Fatalf("ParseScheduleTZ sem fuso: %v", err)
	}
	// Em time.Local=UTC (CI/alpine), o disparo seria 01:00 UTC. Confirmamos que
	// difere do caso com fuso — provando que a injeção muda o instante.
	if noTZ.Next(now).Equal(gotTZ) && time.Local.String() == "UTC" {
		t.Errorf("sem fuso deveria diferir do com-fuso quando time.Local=UTC")
	}
}
