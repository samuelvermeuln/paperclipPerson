import { useState } from "react";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">Recuperar senha</h1>
          <p className="text-sm text-muted-foreground">Solicite código de redefinição por e-mail.</p>
        </div>
        <div>
          <label htmlFor="forgot-email" className="mb-1 block text-xs text-muted-foreground">E-mail</label>
          <input
            id="forgot-email"
            type="email"
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {submitted ? <p className="text-xs text-emerald-600">Se a conta existir, o código foi enviado.</p> : null}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/auth", { replace: true })}
          >
            Voltar
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={loading || email.trim().length === 0}
            onClick={async () => {
              try {
                setLoading(true);
                setError(null);
                await authApi.requestPasswordResetCode({ email });
                setSubmitted(true);
                navigate(`/reset-password?email=${encodeURIComponent(email.trim())}`, { replace: true });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Falha ao solicitar código de redefinição");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Enviando..." : "Enviar código"}
          </Button>
        </div>
      </div>
    </div>
  );
}
