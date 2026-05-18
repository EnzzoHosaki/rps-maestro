"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { automationsApi, type Automation, type ParameterSchema } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ParameterSchemaEditor } from "@/components/parameter-schema-editor";
import { DynamicParameterForm } from "@/components/dynamic-parameter-form";
import { JobPanel } from "@/components/job-panel";
import { useAuth } from "@/lib/auth";

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

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-xl leading-none text-gray-500 hover:text-gray-900">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
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
          <label className="mb-1 block text-xs font-medium text-gray-600 capitalize">
            {k === "scriptPath" ? "Caminho do script" : k === "queueName" ? "Fila" : "Nome"}
          </label>
          <input
            required
            value={form[k]}
            onChange={set(k)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
          />
        </div>
      ))}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Descrição</label>
        <textarea
          value={form.description}
          onChange={set("description")}
          rows={2}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>

      <ParameterSchemaEditor
        value={form.parameterSchema}
        onChange={(s) => setForm((f) => ({ ...f, parameterSchema: s }))}
      />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-gray-600">
            Default params (JSON, opcional)
          </label>
          <button
            type="button"
            onClick={formatDefaultParams}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200"
          >
            Validar e formatar
          </button>
        </div>
        <textarea
          value={form.defaultParamsJson}
          onChange={set("defaultParamsJson")}
          rows={4}
          placeholder='{ "stores": [4814, 6861], "headless": true }'
          className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
        {defaultParamsErr && <p className="mt-1 text-xs text-red-600">{defaultParamsErr}</p>}
        <p className="mt-1 text-xs text-gray-500">
          Aplicado automaticamente quando o usuário abre &quot;Executar&quot; sem nunca ter executado essa automação.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-rps-olive-dark py-2 text-sm font-medium text-white hover:bg-rps-olive-darker disabled:opacity-50"
      >
        {loading ? "Salvando…" : "Salvar"}
      </button>
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
      <p className="mb-3 text-sm text-gray-600">
        Será criado um job imediato na fila <strong>{automation.queueName}</strong>.
      </p>

      {showCascadeBadge && source === "last" && (
        <div className="mb-3 flex items-center justify-between rounded border border-rps-sage bg-rps-sage-soft px-3 py-2 text-xs">
          <span className="font-medium text-rps-olive-dark">
            ✓ Carregado da sua última execução
          </span>
          <button
            type="button"
            onClick={() => setForceDefault(true)}
            className="rounded bg-white px-2 py-0.5 text-xs font-medium text-rps-olive-dark hover:bg-gray-50"
          >
            Voltar ao padrão
          </button>
        </div>
      )}
      {showCascadeBadge && source === "defaults" && (
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          Usando valores padrão da automação.
        </div>
      )}
      {showCascadeBadge && source === "empty" && lastParamsQuery.isFetched && !hasDefaults && (
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          Sem histórico nem valores padrão — preencha do zero.
        </div>
      )}

      {source === "loading" ? (
        <p className="text-sm text-gray-600">Carregando últimos valores…</p>
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
  const qc = useQueryClient();
  const { isAdmin, isOperatorPlus } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [executing, setExecuting] = useState<Automation | null>(null);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);

  const { data: automations, isLoading } = useQuery({
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Automações</h1>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="rounded bg-rps-olive-dark px-4 py-2 text-sm font-medium text-white hover:bg-rps-olive-darker"
          >
            + Nova automação
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-600">Carregando…</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Script</th>
              <th className="px-4 py-3">Fila</th>
              <th className="px-4 py-3">Criada</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {automations?.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{a.scriptPath}</td>
                <td className="px-4 py-3 text-gray-500">{a.queueName}</td>
                <td className="px-4 py-3 text-gray-500">
                  {formatDistanceToNow(new Date(a.createdAt), { locale: ptBR, addSuffix: true })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {isOperatorPlus && (
                      <button
                        onClick={() => setExecuting(a)}
                        className="rounded bg-rps-sage-soft px-2 py-1 text-xs font-medium text-rps-olive-dark hover:bg-rps-sage"
                      >
                        Executar
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setEditing(a)}
                        className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                      >
                        Editar
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          if (confirm("Remover esta automação?")) remove.mutate(a.id);
                        }}
                        className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {automations?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-600">
                  Nenhuma automação cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
