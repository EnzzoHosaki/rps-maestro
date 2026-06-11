"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { automationsApi, type Automation, type ParameterSchema } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm";
import { ParameterSchemaEditor } from "@/components/parameter-schema-editor";
import { DynamicParameterForm } from "@/components/dynamic-parameter-form";
import { JobPanel } from "@/components/job-panel";
import { useAuth } from "@/lib/auth";
import { SkeletonRow } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { EmptyRow } from "@/components/ui/empty-state";
import { ErrorRow } from "@/components/ui/error-state";

type FormData = {
  name: string;
  description: string;
  scriptPath: string;
  queueName: string;
  parameterSchema: ParameterSchema;
  defaultParamsJson: string;
};

const empty: FormData = {
  name: "",
  description: "",
  scriptPath: "",
  queueName: "automation_jobs",
  parameterSchema: [],
  defaultParamsJson: "",
};

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err && "response" in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}


function paramsToJsonField(p?: Record<string, unknown>): string {
  if (!p || Object.keys(p).length === 0) return "";
  return JSON.stringify(p, null, 2);
}

function AutomationForm({
  initial,
  onSubmit,
  loading,
}: {
  initial: FormData;
  onSubmit: (d: FormData, defaultParams?: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [defaultParamsErr, setDefaultParamsErr] = useState<string | null>(null);

  const set =
    (k: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let defaultParams: Record<string, unknown> | undefined;
    const raw = form.defaultParamsJson.trim();
    if (raw !== "") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setDefaultParamsErr("Default params precisa ser um objeto JSON.");
          return;
        }
        defaultParams = parsed as Record<string, unknown>;
      } catch (err) {
        setDefaultParamsErr(err instanceof Error ? err.message : "JSON inválido");
        return;
      }
    }
    setDefaultParamsErr(null);
    onSubmit(form, defaultParams);
  };

  const formatDefaultParams = () => {
    const raw = form.defaultParamsJson.trim();
    if (raw === "") return;
    try {
      const parsed = JSON.parse(raw);
      setForm((f) => ({ ...f, defaultParamsJson: JSON.stringify(parsed, null, 2) }));
      setDefaultParamsErr(null);
    } catch (err) {
      setDefaultParamsErr(err instanceof Error ? err.message : "JSON inválido");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {(["name", "scriptPath", "queueName"] as const).map((k) => (
        <div key={k}>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">
            {k === "scriptPath" ? "Caminho do script" : k === "queueName" ? "Fila" : "Nome"}
          </label>
          <input
            required
            value={form[k]}
            onChange={set(k)}
            className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
          />
        </div>
      ))}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Descrição</label>
        <textarea
          value={form.description}
          onChange={set("description")}
          rows={2}
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>

      <ParameterSchemaEditor
        value={form.parameterSchema}
        onChange={(s) => setForm((f) => ({ ...f, parameterSchema: s }))}
      />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            Default params (JSON, opcional)
          </label>
          <button
            type="button"
            onClick={formatDefaultParams}
            className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Validar e formatar
          </button>
        </div>
        <textarea
          value={form.defaultParamsJson}
          onChange={set("defaultParamsJson")}
          rows={4}
          placeholder='{ "stores": [4814, 6861], "headless": true }'
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
        {defaultParamsErr && <p className="mt-1 text-xs text-red-600">{defaultParamsErr}</p>}
        <p className="mt-1 text-xs text-gray-500">
          Aplicado automaticamente quando o usuário abre &quot;Executar&quot; sem nunca ter executado essa automação.
        </p>
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}

type ParamSource = "loading" | "last" | "defaults" | "empty";

function ExecuteModal({
  automation,
  onClose,
  onJobCreated,
}: {
  automation: Automation;
  onClose: () => void;
  onJobCreated: (jobId: string) => void;
}) {
  const qc = useQueryClient();
  const hasDefaults = useMemo(
    () => !!automation.defaultParams && Object.keys(automation.defaultParams).length > 0,
    [automation.defaultParams]
  );

  const lastParamsQuery = useQuery({
    queryKey: ["automations", automation.id, "lastParams"],
    queryFn: () => automationsApi.lastParams(automation.id).then((r) => r.data.parameters),
    staleTime: 30_000,
  });

  // forceDefault=true → ignora lastParams (usuário clicou "Voltar ao padrão").
  const [forceDefault, setForceDefault] = useState(false);

  const { source, initial }: { source: ParamSource; initial: Record<string, unknown> } =
    useMemo(() => {
      if (lastParamsQuery.isLoading) return { source: "loading", initial: {} };

      const last = lastParamsQuery.data;
      const hasLast = !!last && Object.keys(last).length > 0;

      if (hasLast && !forceDefault) {
        return { source: "last", initial: last as Record<string, unknown> };
      }
      if (hasDefaults) {
        return {
          source: "defaults",
          initial: automation.defaultParams as Record<string, unknown>,
        };
      }
      return { source: "empty", initial: {} };
    }, [lastParamsQuery.data, lastParamsQuery.isLoading, forceDefault, hasDefaults, automation.defaultParams]);

  const execute = useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      automationsApi.execute(automation.id, params).then((r) => r.data),
    onSuccess: (job) => {
      toast.success(`Job criado: ${job.id.slice(0, 8)}…`);
      qc.invalidateQueries({ queryKey: ["automations", automation.id, "lastParams"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClose();
      onJobCreated(job.id);
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao executar")),
  });

  const showCascadeBadge =
    (automation.parameterSchema?.length ?? 0) > 0 && source !== "loading";

  return (
    <Modal title={`Executar: ${automation.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        Será criado um job imediato na fila <strong>{automation.queueName}</strong>.
      </p>

      {showCascadeBadge && source === "last" && (
        <div className="mb-3 flex items-center justify-between rounded border border-rps-sage bg-rps-sage-soft px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-rps-olive-dark">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Carregado da sua última execução
          </span>
          <button
            type="button"
            onClick={() => setForceDefault(true)}
            className="rounded bg-white dark:bg-gray-900 px-2 py-0.5 text-xs font-medium text-rps-olive-dark hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Voltar ao padrão
          </button>
        </div>
      )}
      {showCascadeBadge && source === "defaults" && (
        <div className="mb-3 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
          Usando valores padrão da automação.
        </div>
      )}
      {showCascadeBadge && source === "empty" && lastParamsQuery.isFetched && !hasDefaults && (
        <div className="mb-3 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-500">
          Sem histórico nem valores padrão — preencha do zero.
        </div>
      )}

      {source === "loading" ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">Carregando últimos valores…</p>
      ) : (
        <DynamicParameterForm
          // key força remount quando troca a fonte (last → defaults), pra
          // resetar o estado interno do form.
          key={`${automation.id}-${source}`}
          schema={automation.parameterSchema ?? []}
          initial={initial}
          submitLabel="Executar"
          onSubmit={(params) => execute.mutate(params)}
          loading={execute.isPending}
        />
      )}
    </Modal>
  );
}

export default function AutomationsPage() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { isAdmin, isOperatorPlus } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [executing, setExecuting] = useState<Automation | null>(null);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);

  const { data: automations, isLoading, isError, refetch } = useQuery({
    queryKey: ["automations"],
    queryFn: () => automationsApi.list().then((r) => r.data),
  });

  const toPayload = (d: FormData, defaultParams?: Record<string, unknown>) => ({
    name: d.name,
    description: d.description || undefined,
    scriptPath: d.scriptPath,
    queueName: d.queueName,
    parameterSchema: d.parameterSchema.length > 0 ? d.parameterSchema : undefined,
    defaultParams,
  });

  const create = useMutation({
    mutationFn: ({ d, defaults }: { d: FormData; defaults?: Record<string, unknown> }) =>
      automationsApi.create(toPayload(d, defaults)),
    onSuccess: () => {
      toast.success("Automação criada");
      qc.invalidateQueries({ queryKey: ["automations"] });
      setCreating(false);
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao criar automação")),
  });

  const update = useMutation({
    mutationFn: ({ d, defaults }: { d: FormData; defaults?: Record<string, unknown> }) =>
      automationsApi.update(editing!.id, toPayload(d, defaults)),
    onSuccess: () => {
      toast.success("Automação atualizada");
      qc.invalidateQueries({ queryKey: ["automations"] });
      setEditing(null);
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao atualizar automação")),
  });

  const remove = useMutation({
    mutationFn: (id: number) => automationsApi.delete(id),
    onSuccess: () => {
      toast.success("Automação removida");
      qc.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao remover automação")),
  });

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>+ Nova automação</Button>
        </div>
      )}

      <Table>
        <THead>
          <Th>Nome</Th>
          <Th>Script</Th>
          <Th>Fila</Th>
          <Th>Criada</Th>
          <Th></Th>
        </THead>
        <TBody>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
          {isError && (
            <ErrorRow colSpan={5} onRetry={() => refetch()} />
          )}
          {automations?.map((a) => (
            <Tr key={a.id}>
              <Td className="font-medium text-gray-900 dark:text-gray-100">{a.name}</Td>
              <Td className="font-mono text-xs text-gray-500">{a.scriptPath}</Td>
              <Td className="text-gray-500">{a.queueName}</Td>
              <Td className="text-gray-500">
                {formatDistanceToNow(new Date(a.createdAt), { locale: ptBR, addSuffix: true })}
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {isOperatorPlus && (
                    <Button variant="soft" size="sm" onClick={() => setExecuting(a)}>
                      Executar
                    </Button>
                  )}
                  {isAdmin && (
                    <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>
                      Editar
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Remover automação",
                            message: "Remover esta automação? Agendamentos e histórico vinculados a ela podem ser afetados.",
                            confirmLabel: "Remover",
                            tone: "danger",
                          })
                        )
                          remove.mutate(a.id);
                      }}
                    >
                      Remover
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
          {!isLoading && !isError && automations?.length === 0 && (
            <EmptyRow colSpan={5}>Nenhuma automação cadastrada.</EmptyRow>
          )}
        </TBody>
      </Table>

      {creating && (
        <Modal title="Nova automação" onClose={() => setCreating(false)} wide>
          <AutomationForm
            initial={empty}
            onSubmit={(d, defaults) => create.mutate({ d, defaults })}
            loading={create.isPending}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Editar automação" onClose={() => setEditing(null)} wide>
          <AutomationForm
            initial={{
              name: editing.name,
              description: editing.description ?? "",
              scriptPath: editing.scriptPath,
              queueName: editing.queueName,
              parameterSchema: editing.parameterSchema ?? [],
              defaultParamsJson: paramsToJsonField(editing.defaultParams),
            }}
            onSubmit={(d, defaults) => update.mutate({ d, defaults })}
            loading={update.isPending}
          />
        </Modal>
      )}

      {executing && (
        <ExecuteModal
          key={executing.id}
          automation={executing}
          onClose={() => setExecuting(null)}
          onJobCreated={setViewingJobId}
        />
      )}

      {viewingJobId && automations && (
        <JobPanel
          key={viewingJobId}
          jobId={viewingJobId}
          automations={automations}
          onClose={() => setViewingJobId(null)}
        />
      )}
    </div>
  );
}
