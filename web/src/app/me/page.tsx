"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { authApi } from "@/lib/api";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operador",
  viewer: "Leitor",
};

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err && "response" in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function MePage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data: me, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authApi.me().then((r) => r.data),
  });

  const change = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success("Senha atualizada");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao trocar senha")),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (newPassword.length < 8) {
      setFormError("A nova senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Confirmação não bate com a nova senha.");
      return;
    }
    if (newPassword === currentPassword) {
      setFormError("Nova senha não pode ser igual à atual.");
      return;
    }
    change.mutate();
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Meu perfil</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Dados</h2>
        {isLoading || !me ? (
          <p className="text-sm text-gray-600">Carregando…</p>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Nome</dt>
              <dd className="font-medium text-gray-900">{me.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Email</dt>
              <dd className="font-medium text-gray-900">{me.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Permissão</dt>
              <dd className="font-medium text-gray-900">{ROLE_LABEL[me.role] ?? me.role}</dd>
            </div>
          </dl>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-gray-700">Trocar senha</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Senha atual</label>
          <input
            required
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Nova senha (mín. 8 caracteres)
          </label>
          <input
            required
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Confirmar nova senha</label>
          <input
            required
            type="password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-rps-olive-dark focus:outline-none"
          />
        </div>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <button
          type="submit"
          disabled={change.isPending}
          className="w-full rounded bg-rps-olive-dark py-2 text-sm font-medium text-white hover:bg-rps-olive-darker disabled:opacity-50"
        >
          {change.isPending ? "Salvando…" : "Trocar senha"}
        </button>
      </form>
    </div>
  );
}
