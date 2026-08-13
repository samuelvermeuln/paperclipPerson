import { useState } from "react";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { useNavigate, useSearchParams } from "@/lib/router";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get("email") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">Reset password</h1>
          <p className="text-sm text-muted-foreground">Enter email, code, and new password.</p>
        </div>
        <div className="space-y-3">
          <div>
            <label htmlFor="reset-email" className="mb-1 block text-xs text-muted-foreground">Email</label>
            <input id="reset-email" type="email" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <label htmlFor="reset-code" className="mb-1 block text-xs text-muted-foreground">Code</label>
            <input id="reset-code" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
          <div>
            <label htmlFor="reset-password" className="mb-1 block text-xs text-muted-foreground">New password</label>
            <input id="reset-password" type="password" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className="mb-1 block text-xs text-muted-foreground">Confirm password</label>
            <input id="reset-confirm-password" type="password" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {success ? <p className="text-xs text-emerald-600">Password reset completed.</p> : null}
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate("/auth", { replace: true })}>Back</Button>
          <Button
            type="button"
            className="flex-1"
            disabled={loading || !email.trim() || !code.trim() || !newPassword.trim() || !confirmPassword.trim()}
            onClick={async () => {
              try {
                setLoading(true);
                setError(null);
                await authApi.verifyPasswordResetCode({ email, code });
                await authApi.resetPasswordWithCode({ email, code, newPassword, confirmPassword });
                setSuccess(true);
                navigate("/auth", { replace: true });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to reset password");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Saving..." : "Reset password"}
          </Button>
        </div>
      </div>
    </div>
  );
}
