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
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm";
import { useAuth } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SkeletonRow } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { EmptyRow } from "@/components/ui/empty-state";
import { ErrorRow } from "@/components/ui/error-state";

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
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Nome</label>
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Email</label>
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Role</label>
        <select
          value={form.role}
          onChange={(e) =>
            setForm((f) => ({ ...f, role: e.target.value as "admin" | "operator" | "viewer" }))
          }
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-rps-olive-dark focus:outline-none"
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
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Senha inicial (mín. 8 caracteres)
          </label>
          <input
            required
            type="password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-rps-olive-dark focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            O usuário deve trocar a senha no primeiro login pela tela /me.
          </p>
        </div>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Salvando…" : "Salvar"}
      </Button>
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
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Definir nova senha para <strong>{user.email}</strong>. O usuário poderá entrar imediatamente
        com a senha nova.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Nova senha (mín. 8 caracteres)
        </label>
        <input
          required
          type="password"
          minLength={8}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-rps-olive-dark focus:outline-none"
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Salvando…" : "Resetar senha"}
      </Button>
    </form>
  );
}

export default function UsersPage() {
  const { isAdmin, userId } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const { data: users, isLoading, isError, refetch } = useQuery({
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
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-600 dark:text-gray-400 shadow-sm">
        Permissão insuficiente para visualizar esta página.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          Mostrar inativos
        </label>
        <Button onClick={() => setCreating(true)}>+ Novo usuário</Button>
      </div>

      <Table>
        <THead>
          <Th>Nome</Th>
          <Th>Email</Th>
          <Th>Role</Th>
          <Th>Status</Th>
          <Th>Criado</Th>
          <Th></Th>
        </THead>
        <TBody>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
          {isError && <ErrorRow colSpan={6} onRetry={() => refetch()} />}
          {users?.map((u) => {
            const isSelf = userId === u.id;
            return (
              <Tr key={u.id}>
                <Td className="font-medium text-gray-900 dark:text-gray-100">
                  {u.name}
                  {isSelf && (
                    <Badge shape="square" className="ml-2 bg-rps-sage-soft text-rps-olive-dark">
                      você
                    </Badge>
                  )}
                </Td>
                <Td className="text-gray-700 dark:text-gray-300">{u.email}</Td>
                <Td className="text-gray-700 dark:text-gray-300">{ROLE_LABEL[u.role] ?? u.role}</Td>
                <Td>
                  <Badge
                    className={
                      u.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                    }
                  >
                    {u.isActive ? "Ativo" : "Inativo"}
                  </Badge>
                </Td>
                <Td className="text-gray-500">
                  {formatDistanceToNow(new Date(u.createdAt), { locale: ptBR, addSuffix: true })}
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(u)}>
                      Editar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setResetting(u)}>
                      Resetar senha
                    </Button>
                    {u.isActive ? (
                      !isSelf && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "Desativar usuário",
                                message: `Desativar ${u.email}? A conta perde o acesso, mas pode ser reativada depois.`,
                                confirmLabel: "Desativar",
                                tone: "danger",
                              })
                            )
                              deactivate.mutate(u.id);
                          }}
                        >
                          Desativar
                        </Button>
                      )
                    ) : (
                      <Button variant="soft" size="sm" onClick={() => reactivate.mutate(u.id)}>
                        Reativar
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
          {!isLoading && !isError && users?.length === 0 && (
            <EmptyRow colSpan={6}>Nenhum usuário cadastrado.</EmptyRow>
          )}
        </TBody>
      </Table>

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
