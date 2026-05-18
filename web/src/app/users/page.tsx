"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  usersApi,
  type CreateUserPayload,
  type UpdateUserPayload,
  type User,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const ROLE_OPTIONS: Array<{ value: "admin" | "operator" | "viewer"; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operador" },
  { value: "viewer", label: "Leitor" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((o) => [o.value, o.label])
);

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
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-500 hover:text-gray-900"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function UserForm({
  initial,
  isEdit,
  onSubmit,
  loading,
}: {
  initial: { name: string; email: string; role: "admin" | "operator" | "viewer"; password: string };
  isEdit: boolean;
  onSubmit: (data: { name: string; email: string; role: "admin" | "operator" | "viewer"; password: string }) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(initial);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-3"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Nome</label>
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
        <select
          value={form.role}
          onChange={(e) =>
            setForm((f) => ({ ...f, role: e.target.value as "admin" | "operator" | "viewer" }))
          }
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {!isEdit && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Senha inicial (mín. 8 caracteres)
          </label>
          <input
            required
            type="password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            O usuário deve trocar a senha no primeiro login pela tela /me.
          </p>
        </div>
      )}
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

function ResetPasswordForm({
  user,
  onSubmit,
  loading,
}: {
  user: User;
  onSubmit: (newPassword: string) => void;
  loading: boolean;
}) {
  const [pw, setPw] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(pw);
      }}
      className="space-y-3"
    >
      <p className="text-sm text-gray-600">
        Definir nova senha para <strong>{user.email}</strong>. O usuário poderá entrar imediatamente
        com a senha nova.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Nova senha (mín. 8 caracteres)
        </label>
        <input
          required
          type="password"
          minLength={8}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-rps-olive-dark py-2 text-sm font-medium text-white hover:bg-rps-olive-darker disabled:opacity-50"
      >
        {loading ? "Salvando…" : "Resetar senha"}
      </button>
    </form>
  );
}

export default function UsersPage() {
  const { isAdmin, userId } = useAuth();
  const qc = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users", { includeInactive }],
    queryFn: () => usersApi.list(includeInactive).then((r) => r.data),
    enabled: isAdmin,
  });

  const create = useMutation({
    mutationFn: (data: CreateUserPayload) => usersApi.create(data),
    onSuccess: () => {
      toast.success("Usuário criado");
      qc.invalidateQueries({ queryKey: ["users"] });
      setCreating(false);
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao criar usuário")),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUserPayload }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao atualizar usuário")),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) => usersApi.deactivate(id),
    onSuccess: () => {
      toast.success("Usuário desativado");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao desativar")),
  });

  const reactivate = useMutation({
    mutationFn: (id: number) => usersApi.reactivate(id),
    onSuccess: () => {
      toast.success("Usuário reativado");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao reativar")),
  });

  const resetPw = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      usersApi.resetPassword(id, newPassword),
    onSuccess: () => {
      toast.success("Senha resetada");
      setResetting(null);
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao resetar senha")),
  });

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        Permissão insuficiente para visualizar esta página.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-rps-olive-dark px-4 py-2 text-sm font-medium text-white hover:bg-rps-olive-darker"
        >
          + Novo usuário
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
          className="rounded border-gray-300"
        />
        Mostrar inativos
      </label>

      {isLoading && <p className="text-sm text-gray-600">Carregando…</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Criado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users?.map((u) => {
              const isSelf = userId === u.id;
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.name}
                    {isSelf && (
                      <span className="ml-2 rounded bg-rps-sage-soft px-1.5 py-0.5 text-xs font-medium text-rps-olive-dark">
                        você
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{u.email}</td>
                  <td className="px-4 py-3 text-gray-700">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {u.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDistanceToNow(new Date(u.createdAt), { locale: ptBR, addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditing(u)}
                        className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setResetting(u)}
                        className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                      >
                        Resetar senha
                      </button>
                      {u.isActive ? (
                        !isSelf && (
                          <button
                            onClick={() => {
                              if (confirm(`Desativar ${u.email}?`)) deactivate.mutate(u.id);
                            }}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                          >
                            Desativar
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => reactivate.mutate(u.id)}
                          className="rounded bg-rps-sage-soft px-2 py-1 text-xs font-medium text-rps-olive-dark hover:bg-rps-sage"
                        >
                          Reativar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {users?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-600">
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <Modal title="Novo usuário" onClose={() => setCreating(false)}>
          <UserForm
            initial={{ name: "", email: "", role: "viewer", password: "" }}
            isEdit={false}
            onSubmit={(d) =>
              create.mutate({
                name: d.name,
                email: d.email,
                role: d.role,
                password: d.password,
              })
            }
            loading={create.isPending}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Editar usuário" onClose={() => setEditing(null)}>
          <UserForm
            initial={{
              name: editing.name,
              email: editing.email,
              role: editing.role as "admin" | "operator" | "viewer",
              password: "",
            }}
            isEdit
            onSubmit={(d) =>
              update.mutate({
                id: editing.id,
                data: { name: d.name, email: d.email, role: d.role },
              })
            }
            loading={update.isPending}
          />
        </Modal>
      )}

      {resetting && (
        <Modal title="Resetar senha" onClose={() => setResetting(null)}>
          <ResetPasswordForm
            user={resetting}
            onSubmit={(newPassword) =>
              resetPw.mutate({ id: resetting.id, newPassword })
            }
            loading={resetPw.isPending}
          />
        </Modal>
      )}
    </div>
  );
}
