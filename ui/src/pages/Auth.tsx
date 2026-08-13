import { useEffect, useMemo, useState } from "react";
import type { CompleteRegistrationInput, RegistrationKind } from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { getRememberedInvitePath } from "../lib/invite-memory";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles } from "lucide-react";

type AuthMode = "sign_in" | "sign_up";

const emptyAddress = {
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  country: "Brasil",
};

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCompletionMode = location.pathname === "/register/complete";
  const [mode, setMode] = useState<AuthMode>(() => (location.pathname.startsWith("/register") ? "sign_up" : "sign_in"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registrationKind, setRegistrationKind] = useState<RegistrationKind>("PF");
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState(emptyAddress);
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyAddress, setCompanyAddress] = useState(emptyAddress);
  const errorId = "auth-error";

  const nextPath = useMemo(
    () => searchParams.get("next") || getRememberedInvitePath() || "/",
    [searchParams],
  );

  useEffect(() => {
    setMode(location.pathname.startsWith("/register") ? "sign_up" : "sign_in");
    setError(null);
  }, [location.pathname]);

  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  const { data: me } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => authApi.getMe(),
    enabled: isCompletionMode && Boolean(session),
    retry: false,
  });

  const providersQuery = useQuery({
    queryKey: queryKeys.auth.providers,
    queryFn: () => authApi.getProviders(),
    retry: false,
  });

  const googleEnabled = providersQuery.data?.google.enabled ?? false;

  useEffect(() => {
    if (session && !isCompletionMode) {
      navigate(nextPath, { replace: true });
    }
  }, [isCompletionMode, navigate, nextPath, session]);

  useEffect(() => {
    if (isCompletionMode && !isSessionLoading && !session) {
      navigate("/login", { replace: true });
    }
  }, [isCompletionMode, isSessionLoading, navigate, session]);

  useEffect(() => {
    if (!isCompletionMode || !me) return;
    if (me.registrationKind || me.companies.length > 0) {
      navigate(nextPath, { replace: true });
    }
  }, [isCompletionMode, me, navigate, nextPath]);

  useEffect(() => {
    if (!isCompletionMode) return;
    if (!fullName.trim() && session?.user?.name) {
      setFullName(session.user.name);
    }
  }, [fullName, isCompletionMode, session]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CompleteRegistrationInput = registrationKind === "PF"
        ? {
            registrationKind: "PF",
            fullName: fullName.trim(),
            cpf,
            phone,
            address,
          }
        : {
            registrationKind: "PJ",
            companyName: companyName.trim(),
            legalName: legalName.trim() || null,
            cnpj,
            companyPhone,
            companyAddress,
            responsibleFullName: fullName.trim(),
            responsibleCpf: cpf,
            responsiblePhone: phone,
            responsibleAddress: address,
          };

      if (isCompletionMode) {
        await authApi.completeRegistration(payload);
        return;
      }

      if (mode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }

      await authApi.signUpEmail({
        name: fullName.trim(),
        email: email.trim(),
        password,
      });
      await authApi.completeRegistration(payload);
    },
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.session }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
      ]);
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Falha na autenticação");
    },
  });

  const registrationFieldsValid =
    fullName.trim().length > 0 &&
    cpf.trim().length > 0 &&
    phone.trim().length > 0 &&
    address.postalCode.trim().length > 0 &&
    address.street.trim().length > 0 &&
    address.number.trim().length > 0 &&
    address.neighborhood.trim().length > 0 &&
    address.city.trim().length > 0 &&
    address.state.trim().length > 0 &&
    (
      registrationKind === "PF" ||
      (
        companyName.trim().length > 0 &&
        cnpj.trim().length > 0 &&
        companyPhone.trim().length > 0 &&
        companyAddress.postalCode.trim().length > 0 &&
        companyAddress.street.trim().length > 0 &&
        companyAddress.number.trim().length > 0 &&
        companyAddress.neighborhood.trim().length > 0 &&
        companyAddress.city.trim().length > 0 &&
        companyAddress.state.trim().length > 0
      )
    );

  const canSubmit = isCompletionMode
    ? registrationFieldsValid
    : email.trim().length > 0 &&
      password.trim().length > 0 &&
      (
        mode === "sign_in" ||
        (
          password.trim().length >= 8 &&
          registrationFieldsValid
        )
      );

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <PaperclipLoading className="min-h-0" />
      </div>
    );
  }

  const authTitle = isCompletionMode
    ? "Conclua seu cadastro"
    : mode === "sign_in"
      ? "Entrar no Paperclip"
      : "Criar conta no Paperclip";

  const authDescription = isCompletionMode
    ? "Finalize seu cadastro PF ou PJ para criar sua primeira empresa e acessar o Paperclip."
    : mode === "sign_in"
      ? "Entre com e-mail e senha ou use sua conta Google."
      : "Crie sua conta com e-mail e senha ou continue com Google.";

  return (
    <div className="fixed inset-0 flex bg-background">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="flex w-full flex-col overflow-y-auto md:w-1/2">
        <div className="my-auto mx-auto w-full max-w-md px-8 py-12">
          <div className="mb-8 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Paperclip</span>
          </div>

          <h1 className="text-xl font-semibold">{authTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{authDescription}</p>

          {!isCompletionMode ? (
            <div className="mt-6 space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!googleEnabled}
                onClick={async () => {
                  if (!googleEnabled) return;
                  try {
                    const url = await authApi.signInWithGoogle(`/register/complete?next=${encodeURIComponent(nextPath)}`);
                    if (url) window.location.href = url;
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Falha ao entrar com Google");
                  }
                }}
              >
                Continuar com Google
              </Button>
              {!googleEnabled ? (
                <p className="text-xs text-muted-foreground">
                  Login com Google indisponível nesta instância. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
                  `PAPERCLIP_AUTH_BASE_URL_MODE=explicit` e `PAPERCLIP_AUTH_PUBLIC_BASE_URL`.
                </p>
              ) : null}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>ou continue com e-mail</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>
          ) : null}

          <form
            className="mt-6 space-y-4"
            method="post"
            action={isCompletionMode ? "/api/auth/complete-registration" : mode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError("Preencha todos os campos obrigatórios.");
                return;
              }
              mutation.mutate();
            }}
          >
            {mode === "sign_up" ? (
              <>
                <div>
                  <label htmlFor="registration-kind" className="mb-1 block text-xs text-muted-foreground">Tipo de cadastro</label>
                  <select
                    id="registration-kind"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    value={registrationKind}
                    onChange={(event) => setRegistrationKind(event.target.value as RegistrationKind)}
                  >
                    <option value="PF">Pessoa Física</option>
                    <option value="PJ">Pessoa Jurídica</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="full-name" className="mb-1 block text-xs text-muted-foreground">
                    {registrationKind === "PF" ? "Nome completo" : "Nome completo do responsável"}
                  </label>
                  <input
                    id="full-name"
                    name="name"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                    required
                    aria-required="true"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cpf" className="mb-1 block text-xs text-muted-foreground">CPF</label>
                    <input id="cpf" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={cpf} onChange={(event) => setCpf(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="phone" className="mb-1 block text-xs text-muted-foreground">Telefone</label>
                    <input id="phone" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="postal-code" className="mb-1 block text-xs text-muted-foreground">CEP</label>
                    <input id="postal-code" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={address.postalCode} onChange={(event) => setAddress((current) => ({ ...current, postalCode: event.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="street" className="mb-1 block text-xs text-muted-foreground">Rua</label>
                    <input id="street" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={address.street} onChange={(event) => setAddress((current) => ({ ...current, street: event.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="number" className="mb-1 block text-xs text-muted-foreground">Número</label>
                    <input id="number" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={address.number} onChange={(event) => setAddress((current) => ({ ...current, number: event.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="neighborhood" className="mb-1 block text-xs text-muted-foreground">Bairro</label>
                    <input id="neighborhood" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={address.neighborhood} onChange={(event) => setAddress((current) => ({ ...current, neighborhood: event.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="city" className="mb-1 block text-xs text-muted-foreground">Cidade</label>
                    <input id="city" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={address.city} onChange={(event) => setAddress((current) => ({ ...current, city: event.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="state" className="mb-1 block text-xs text-muted-foreground">Estado</label>
                    <input id="state" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={address.state} onChange={(event) => setAddress((current) => ({ ...current, state: event.target.value }))} />
                  </div>
                </div>
                {registrationKind === "PJ" ? (
                  <>
                    <div>
                      <label htmlFor="company-name" className="mb-1 block text-xs text-muted-foreground">Nome da empresa</label>
                      <input id="company-name" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="legal-name" className="mb-1 block text-xs text-muted-foreground">Razão social</label>
                      <input id="legal-name" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={legalName} onChange={(event) => setLegalName(event.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="cnpj" className="mb-1 block text-xs text-muted-foreground">CNPJ</label>
                        <input id="cnpj" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={cnpj} onChange={(event) => setCnpj(event.target.value)} />
                      </div>
                      <div>
                        <label htmlFor="company-phone" className="mb-1 block text-xs text-muted-foreground">Telefone da empresa</label>
                        <input id="company-phone" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyPhone} onChange={(event) => setCompanyPhone(event.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="company-postal-code" className="mb-1 block text-xs text-muted-foreground">CEP da empresa</label>
                        <input id="company-postal-code" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyAddress.postalCode} onChange={(event) => setCompanyAddress((current) => ({ ...current, postalCode: event.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="company-street" className="mb-1 block text-xs text-muted-foreground">Rua da empresa</label>
                        <input id="company-street" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyAddress.street} onChange={(event) => setCompanyAddress((current) => ({ ...current, street: event.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="company-number" className="mb-1 block text-xs text-muted-foreground">Número da empresa</label>
                        <input id="company-number" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyAddress.number} onChange={(event) => setCompanyAddress((current) => ({ ...current, number: event.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="company-neighborhood" className="mb-1 block text-xs text-muted-foreground">Bairro da empresa</label>
                        <input id="company-neighborhood" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyAddress.neighborhood} onChange={(event) => setCompanyAddress((current) => ({ ...current, neighborhood: event.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="company-city" className="mb-1 block text-xs text-muted-foreground">Cidade da empresa</label>
                        <input id="company-city" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyAddress.city} onChange={(event) => setCompanyAddress((current) => ({ ...current, city: event.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="company-state" className="mb-1 block text-xs text-muted-foreground">Estado da empresa</label>
                        <input id="company-state" className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" value={companyAddress.state} onChange={(event) => setCompanyAddress((current) => ({ ...current, state: event.target.value }))} />
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {!isCompletionMode ? (
              <>
                <div>
                  <label htmlFor="email" className="mb-1 block text-xs text-muted-foreground">E-mail</label>
                  <input
                    id="email"
                    name="email"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    required
                    aria-required="true"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    autoFocus={mode === "sign_in"}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1 block text-xs text-muted-foreground">Senha</label>
                  <input
                    id="password"
                    name="password"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                    required
                    aria-required="true"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                  />
                </div>
              </>
            ) : null}

            {error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-disabled={!canSubmit || mutation.isPending}
              className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
            >
              {mutation.isPending
                ? "Processando…"
                : isCompletionMode
                  ? "Concluir cadastro"
                  : mode === "sign_in"
                    ? "Entrar"
                    : "Criar conta"}
            </Button>
          </form>

          {!isCompletionMode && mode === "sign_in" ? (
            <div className="mt-3 text-right text-sm">
              <button
                type="button"
                className="text-foreground underline underline-offset-2"
                onClick={() => navigate("/forgot-password", { replace: true })}
              >
                Esqueci minha senha
              </button>
            </div>
          ) : null}

          {!isCompletionMode ? (
            <div className="mt-5 text-sm text-muted-foreground">
              {mode === "sign_in" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  setMode(mode === "sign_in" ? "sign_up" : "sign_in");
                }}
              >
                {mode === "sign_in" ? "Criar conta" : "Entrar"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="hidden w-1/2 overflow-hidden md:block">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
