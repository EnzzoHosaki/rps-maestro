"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { schedulesApi, automationsApi, type Schedule, type Automation } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm";
import { DynamicParameterForm } from "@/components/dynamic-parameter-form";
import { CronBuilder } from "@/components/cron-builder";
import { describeCron } from "@/lib/cron";
import { useAuth } from "@/lib/auth";
import { SkeletonRow } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { EmptyRow } from "@/components/ui/empty-state";
import { ErrorRow } from "@/components/ui/error-state";

type FormData = {
  automationId: number;
  cronExpression: string;
  isEnabled: boolean;
  parameters: Record<string, unknown>;
};

const CRON_PRESETS = [
  { label: "A cada hora", value: "0 * * * *" },
  { label: "Todo dia às 08h", value: "0 8 * * *" },
  { label: "Toda segunda às 09h", value: "0 9 * * 1" },
  { label: "Primeira do mês", value: "0 0 1 * *" },
];

function ScheduleForm({
  initial,
  automations,
  onSubmit,
  loading,
}: {
  initial: FormData;
  automations: Automation[];
  onSubmit: (d: FormData) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const selected = automations.find((a) => a.id === form.automationId);
  const schema = selected?.parameterSchema ?? [];

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Automação</label>
        <select
          required
          value={form.automationId}
          onChange={(e) =>
            setForm((f) => ({ ...f, automationId: Number(e.target.value), parameters: {} }))
          }
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none focus:ring-2 focus:ring-rps-olive-dark"
        >
          <option value={0} disabled>
            Selecione…
          </option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quando executar</label>
        <CronBuilder
          value={form.cronExpression}
          onChange={(next) => setForm((f) => ({ ...f, cronExpression: next }))}
        />

        <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expressão Cron</label>
        <input
          required
          value={form.cronExpression}
          onChange={(e) => setForm((f) => ({ ...f, cronExpression: e.target.value }))}
          placeholder="0 8 * * *"
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none focus:ring-2 focus:ring-rps-olive-dark"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {CRON_PRESETS.map((p) => (
            <button
              type="button"
              key={p.value}
              onClick={() => setForm((f) => ({ ...f, cronExpression: p.value }))}
              className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              {p.label}
            </button>
          ))}
        </div>
        {form.cronExpression && (
          <p className="mt-1.5 text-xs text-rps-olive-dark dark:text-rps-sage">
            {describeCron(form.cronExpression)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="enabled"
          checked={form.isEnabled}
          onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))}
          className="rounded border-gray-300 dark:border-gray-700"
        />
        <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">
          Ativo
        </label>
      </div>

      {form.automationId > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Parâmetros</p>
          {schema.length === 0 ? (
            <p className="text-xs text-gray-600 dark:text-gray-400">Esta automação não define parâmetros.</p>
          ) : (
            <>
              <div className="mb-3 rounded border border-rps-sage bg-rps-sage-soft px-3 py-2 text-xs text-rps-olive-dark">
                <p className="font-medium">Dica: datas dinâmicas</p>
                <p className="mt-0.5">
                  Em campos de data você pode usar placeholders que são resolvidos a cada execução
                  do cron:
                </p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  <li>
                    <code className="font-mono">{"{{yesterday}}"}</code> →
                    {" "}data de ontem (também <code className="font-mono">{"{{today-1}}"}</code>)
                  </li>
                  <li>
                    <code className="font-mono">{"{{today}}"}</code> → hoje
                  </li>
                  <li>
                    <code className="font-mono">{"{{today-N}}"}</code> → N dias atrás (ex.:
                    {" "}<code className="font-mono">{"{{today-2}}"}</code>)
                  </li>
                  <li>
                    <code className="font-mono">{"{{tomorrow}}"}</code> → amanhã
                  </li>
                  <li>
                    <code className="font-mono">{"{{prev_run}}"}</code> → data da execução
                    {" "}agendada anterior (e <code className="font-mono">{"{{prev_run+1}}"}</code>/
                    <code className="font-mono">{"{{prev_run-1}}"}</code>). Ex.: pra pegar só o
                    {" "}período desde a última execução, use{" "}
                    <code className="font-mono">{"{{prev_run+1}}"}</code> até{" "}
                    <code className="font-mono">{"{{yesterday}}"}</code>.
                  </li>
                </ul>
                <p className="mt-1">Formato resolvido: <span className="font-mono">dd/MM/yyyy</span>.</p>
              </div>
              <DynamicParameterForm
                schema={schema}
                initial={form.parameters}
                submitLabel={loading ? "Salvando…" : "Salvar agendamento"}
                loading={loading}
                allowDynamicPlaceholders
                onSubmit={(params) => onSubmit({ ...form, parameters: params })}
              />
            </>
          )}
        </div>
      )}

      {(form.automationId === 0 || schema.length === 0) && (
        <Button
          onClick={() => onSubmit(form)}
          disabled={loading || form.automationId === 0 || !form.cronExpression}
          className="w-full"
        >
          {loading ? "Salvando…" : "Salvar agendamento"}
        </Button>
      )}
    </div>
  );
}

export default function SchedulesPage() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  // createSeed = valores iniciais do modal de criação (null = fechado). "Novo"
  // abre vazio; "Duplicar" abre pré-preenchido com os dados de um agendamento.
  const [createSeed, setCreateSeed] = useState<FormData | null>(null);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const emptyForm: FormData = { automationId: 0, cronExpression: "", isEnabled: true, parameters: {} };

  const { data: schedules, isLoading, isError, refetch } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => schedulesApi.list().then((r) => r.data),
  });

  const { data: automations } = useQuery({
    queryKey: ["automations"],
    queryFn: () => automationsApi.list().then((r) => r.data),
  });

  const toPayload = (d: FormData) => ({
    automationId: d.automationId,
    cronExpression: d.cronExpression,
    isEnabled: d.isEnabled,
    parameters: Object.keys(d.parameters).length > 0 ? d.parameters : undefined,
  });

  const create = useMutation({
    mutationFn: (d: FormData) => schedulesApi.create(toPayload(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setCreateSeed(null);
    },
  });

  const update = useMutation({
    mutationFn: (d: FormData) => schedulesApi.update(editing!.id, toPayload(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => schedulesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const toggle = useMutation({
    // Envia o objeto completo: o handler de update faz replace total, então um
    // payload parcial zeraria automationId/cronExpression.
    mutationFn: (s: Schedule) =>
      schedulesApi.update(s.id, {
        automationId: s.automationId,
        cronExpression: s.cronExpression,
        isEnabled: !s.isEnabled,
        parameters: s.parameters,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const autoList = automations ?? [];

  const getAutoName = (id: number) => autoList.find((a) => a.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setCreateSeed(emptyForm)}>+ Novo agendamento</Button>
        </div>
      )}

      <Table>
        <THead>
          <Th>Automação</Th>
          <Th>Cron</Th>
          <Th>Próxima execução</Th>
          <Th>Status</Th>
          <Th></Th>
        </THead>
        <TBody>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
          {isError && <ErrorRow colSpan={5} onRetry={() => refetch()} />}
          {schedules?.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium text-gray-900 dark:text-gray-100">{getAutoName(s.automationId)}</Td>
              <Td>
                <div className="font-mono text-xs text-gray-500">{s.cronExpression}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">{describeCron(s.cronExpression)}</div>
              </Td>
              <Td className="text-gray-500">
                {s.nextRunAt
                  ? formatDistanceToNow(new Date(s.nextRunAt), { locale: ptBR, addSuffix: true })
                  : "—"}
              </Td>
              <Td>
                {isAdmin ? (
                  <button
                    onClick={() => toggle.mutate(s)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.isEnabled
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {s.isEnabled ? "Ativo" : "Inativo"}
                  </button>
                ) : (
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.isEnabled
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500"
                    }`}
                  >
                    {s.isEnabled ? "Ativo" : "Inativo"}
                  </span>
                )}
              </Td>
              <Td>
                {isAdmin && (
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>
                      Editar
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      title="Criar um novo agendamento a partir deste"
                      onClick={() =>
                        setCreateSeed({
                          automationId: s.automationId,
                          cronExpression: s.cronExpression,
                          isEnabled: s.isEnabled,
                          parameters: (s.parameters as Record<string, unknown>) ?? {},
                        })
                      }
                    >
                      Duplicar
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Remover agendamento",
                            message: "Remover este agendamento? A automação não será mais disparada por ele.",
                            confirmLabel: "Remover",
                            tone: "danger",
                          })
                        )
                          remove.mutate(s.id);
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                )}
              </Td>
            </Tr>
          ))}
          {!isLoading && !isError && schedules?.length === 0 && (
            <EmptyRow colSpan={5}>Nenhum agendamento cadastrado.</EmptyRow>
          )}
        </TBody>
      </Table>

      {createSeed && (
        <Modal title="Novo agendamento" onClose={() => setCreateSeed(null)} wide>
          <ScheduleForm
            initial={createSeed}
            automations={autoList}
            onSubmit={(d) => create.mutate(d)}
            loading={create.isPending}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Editar agendamento" onClose={() => setEditing(null)} wide>
          <ScheduleForm
            initial={{
              automationId: editing.automationId,
              cronExpression: editing.cronExpression,
              isEnabled: editing.isEnabled,
              parameters: (editing.parameters as Record<string, unknown>) ?? {},
            }}
            automations={autoList}
            onSubmit={(d) => update.mutate(d)}
            loading={update.isPending}
          />
        </Modal>
      )}
    </div>
  );
}
