import { useEffect, useMemo, useState } from "react";
import type {
  AdminCreateUserInput,
  AdminResetUserPasswordInput,
  AdminUpdateUserInput,
  AuthUserStatus,
} from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, ShieldCheck } from "lucide-react";
import { accessApi } from "@/api/access";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate } from "@/lib/router";

type CreateUserForm = {
  fullName: string;
  email: string;
  password: string;
  cpf: string;
  phone: string;
  status: AuthUserStatus;
  companyId: string;
  membershipRole: "owner" | "admin" | "operator" | "viewer";
};

type EditUserForm = {
  fullName: string;
  cpf: string;
  phone: string;
  status: AuthUserStatus;
};

type ResetPasswordForm = {
  newPassword: string;
  confirmPassword: string;
};

const emptyCreateUserForm: CreateUserForm = {
  fullName: "",
  email: "",
  password: "",
  cpf: "",
  phone: "",
  status: "ACTIVE",
  companyId: "",
  membershipRole: "operator",
};

const emptyEditUserForm: EditUserForm = {
  fullName: "",
  cpf: "",
  phone: "",
  status: "ACTIVE",
};

const emptyResetPasswordForm: ResetPasswordForm = {
  newPassword: "",
  confirmPassword: "",
};

function statusBadgeClass(status: AuthUserStatus) {
  return status === "BLOCKED"
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400";
}

export function InstanceAccess() {
  const { companies, setSelectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [selectedAdminCompanyId, setSelectedAdminCompanyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(emptyCreateUserForm);
  const [editForm, setEditForm] = useState<EditUserForm>(emptyEditUserForm);
  const [resetPasswordForm, setResetPasswordForm] = useState<ResetPasswordForm>(emptyResetPasswordForm);
  const [blockReason, setBlockReason] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Instance settings", href: "/company/settings/instance/general" },
      { label: "Access" },
    ]);
  }, [setBreadcrumbs]);

  const usersQuery = useQuery({
    queryKey: queryKeys.access.adminUsers(search),
    queryFn: () => accessApi.searchAdminUsers(search),
  });

  const selectedUser = useMemo(
    () => usersQuery.data?.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, usersQuery.data],
  );

  const userAccessQuery = useQuery({
    queryKey: queryKeys.access.userCompanyAccess(selectedUserId ?? ""),
    queryFn: () => accessApi.getUserCompanyAccess(selectedUserId!),
    enabled: !!selectedUserId,
  });

  const companyMembersQuery = useQuery({
    queryKey: queryKeys.access.companyMembers(selectedAdminCompanyId ?? ""),
    queryFn: () => accessApi.listMembers(selectedAdminCompanyId!),
    enabled: !!selectedAdminCompanyId,
  });

  const selectedUserDetails = userAccessQuery.data?.user ?? null;
  const selectedUserStatus = selectedUserDetails?.status ?? selectedUser?.status ?? "ACTIVE";

  useEffect(() => {
    if (!selectedUserId && usersQuery.data?.[0]) {
      setSelectedUserId(usersQuery.data[0].id);
    }
  }, [selectedUserId, usersQuery.data]);

  useEffect(() => {
    if (selectedAdminCompanyId && companies.some((company) => company.id === selectedAdminCompanyId)) {
      return;
    }
    setSelectedAdminCompanyId(companies[0]?.id ?? null);
  }, [companies, selectedAdminCompanyId]);

  useEffect(() => {
    if (!userAccessQuery.data) return;
    setSelectedCompanyIds(
      new Set(
        userAccessQuery.data.companyAccess
          .filter((membership) => membership.status === "active")
          .map((membership) => membership.companyId),
      ),
    );
  }, [userAccessQuery.data]);

  useEffect(() => {
    if (!selectedUserDetails) return;
    setEditForm({
      fullName: selectedUserDetails.name ?? "",
      cpf: selectedUserDetails.cpf ?? "",
      phone: selectedUserDetails.phone ?? "",
      status: selectedUserDetails.status,
    });
  }, [selectedUserDetails]);

  async function invalidateAdminState(userId: string | null) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.access.adminUsers(search) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess }),
      userId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.access.userCompanyAccess(userId) })
        : Promise.resolve(),
    ]);
  }

  function mutationErrorTitle(error: unknown, fallback: string) {
    if (error instanceof ApiError || error instanceof Error) return error.message;
    return fallback;
  }

  const updateCompanyAccessMutation = useMutation({
    mutationFn: () => accessApi.setUserCompanyAccess(selectedUserId!, [...selectedCompanyIds]),
    onSuccess: async () => {
      await invalidateAdminState(selectedUserId);
      pushToast({ title: "Company access updated", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to update company access"), tone: "error" });
    },
  });

  const setAdminMutation = useMutation({
    mutationFn: async (makeAdmin: boolean) => {
      if (!selectedUserId) throw new Error("No user selected");
      if (makeAdmin) return accessApi.promoteInstanceAdmin(selectedUserId);
      return accessApi.demoteInstanceAdmin(selectedUserId);
    },
    onSuccess: async () => {
      await invalidateAdminState(selectedUserId);
      pushToast({ title: "Instance role updated", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to update instance role"), tone: "error" });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const payload: AdminCreateUserInput = {
        fullName: createForm.fullName,
        email: createForm.email,
        password: createForm.password,
        cpf: createForm.cpf.trim() || null,
        phone: createForm.phone.trim() || null,
        status: createForm.status,
        companyId: createForm.companyId || null,
        membershipRole: createForm.companyId ? createForm.membershipRole : null,
      };
      return accessApi.createAdminUser(payload);
    },
    onSuccess: async ({ userId }) => {
      await invalidateAdminState(userId);
      setSelectedUserId(userId);
      setCreateOpen(false);
      setCreateForm(emptyCreateUserForm);
      pushToast({ title: "User created", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to create user"), tone: "error" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      const payload: AdminUpdateUserInput = {
        fullName: editForm.fullName,
        cpf: editForm.cpf.trim() || null,
        phone: editForm.phone.trim() || null,
        status: editForm.status,
      };
      return accessApi.updateAdminUser(selectedUserId, payload);
    },
    onSuccess: async () => {
      await invalidateAdminState(selectedUserId);
      setEditOpen(false);
      pushToast({ title: "User updated", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to update user"), tone: "error" });
    },
  });

  const blockMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      return accessApi.blockAdminUser(selectedUserId, { reason: blockReason.trim() || null });
    },
    onSuccess: async () => {
      await invalidateAdminState(selectedUserId);
      setBlockOpen(false);
      setBlockReason("");
      pushToast({ title: "User blocked", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to block user"), tone: "error" });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      return accessApi.unblockAdminUser(selectedUserId);
    },
    onSuccess: async () => {
      await invalidateAdminState(selectedUserId);
      pushToast({ title: "User unblocked", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to unblock user"), tone: "error" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      const payload: AdminResetUserPasswordInput = {
        newPassword: resetPasswordForm.newPassword,
        confirmPassword: resetPasswordForm.confirmPassword,
      };
      return accessApi.resetAdminUserPassword(selectedUserId, payload);
    },
    onSuccess: async () => {
      await invalidateAdminState(selectedUserId);
      setResetPasswordOpen(false);
      setResetPasswordForm(emptyResetPasswordForm);
      pushToast({ title: "Password reset", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: mutationErrorTitle(error, "Failed to reset password"), tone: "error" });
    },
  });

  const createUserDisabled =
    createForm.fullName.trim().length < 3 ||
    createForm.email.trim().length === 0 ||
    createForm.password.length < 8;

  const updateUserDisabled = editForm.fullName.trim().length < 3;
  const resetPasswordDisabled =
    resetPasswordForm.newPassword.length < 8 ||
    resetPasswordForm.confirmPassword.length < 8 ||
    resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword;

  if (usersQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading instance users…</div>;
  }

  if (usersQuery.error) {
    const message =
      usersQuery.error instanceof ApiError && usersQuery.error.status === 403
        ? "Instance admin access is required to manage users."
        : usersQuery.error instanceof Error
          ? usersQuery.error.message
          : "Failed to load users.";
    return <div className="text-sm text-destructive">{message}</div>;
  }

  return (
    <>
      <div className="max-w-6xl space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Instance Access</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Search users, create accounts, manage blocked status, assign instance-admin status, and control company access.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-(--gtc-34)">
          <Card className="block space-y-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="block flex-1 space-y-2 text-sm">
                <span className="font-medium">Search users</span>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or email"
                />
              </label>
              <Button type="button" className="self-end" onClick={() => setCreateOpen(true)}>
                New user
              </Button>
            </div>
            <div className="space-y-2">
              {(usersQuery.data ?? []).map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    user.id === selectedUserId
                      ? "border-foreground bg-accent"
                      : "border-border hover:bg-accent/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{user.name || user.email || user.id}</div>
                      <div className="truncate text-sm text-muted-foreground">{user.email || user.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(user.status)}`}>
                        {user.status}
                      </span>
                      {user.isInstanceAdmin ? (
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {user.activeCompanyMembershipCount} active company memberships
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="block space-y-4 p-5">
            {!selectedUserId ? (
              <div className="text-sm text-muted-foreground">Select a user to inspect instance access.</div>
            ) : userAccessQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading user access…</div>
            ) : userAccessQuery.error ? (
              <div className="text-sm text-destructive">
                {userAccessQuery.error instanceof Error ? userAccessQuery.error.message : "Failed to load user access."}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div>
                      <div className="text-lg font-semibold">
                        {selectedUser?.name || selectedUser?.email || selectedUserId}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {selectedUser?.email || selectedUserId}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(selectedUserStatus)}`}>
                        {selectedUserStatus}
                      </span>
                      {selectedUserDetails?.isInstanceAdmin ? (
                        <span className="rounded-full border border-emerald-600/30 bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          INSTANCE_ADMIN
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                      Edit user
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setResetPasswordOpen(true)}>
                      Reset password
                    </Button>
                    {selectedUserStatus === "BLOCKED" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => unblockMutation.mutate()}
                        disabled={unblockMutation.isPending}
                      >
                        {unblockMutation.isPending ? "Unblocking…" : "Unblock user"}
                      </Button>
                    ) : (
                      <Button type="button" variant="destructive" onClick={() => setBlockOpen(true)}>
                        Block user
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={selectedUser?.isInstanceAdmin ? "outline" : "default"}
                      onClick={() => setAdminMutation.mutate(!(selectedUser?.isInstanceAdmin ?? false))}
                      disabled={setAdminMutation.isPending}
                    >
                      {setAdminMutation.isPending
                        ? "Saving…"
                        : selectedUser?.isInstanceAdmin
                          ? "Remove instance admin"
                          : "Promote to instance admin"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-border px-3 py-3 text-sm">
                    <div className="text-xs text-muted-foreground">Email</div>
                    <div className="mt-1 break-all font-medium">{selectedUserDetails?.email || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-3 text-sm">
                    <div className="text-xs text-muted-foreground">CPF</div>
                    <div className="mt-1 font-medium">{selectedUserDetails?.cpf || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-3 text-sm">
                    <div className="text-xs text-muted-foreground">Phone</div>
                    <div className="mt-1 font-medium">{selectedUserDetails?.phone || "—"}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold">Company access</h2>
                    <p className="text-sm text-muted-foreground">
                      Toggle company membership for this user. New access defaults to an active operator membership.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {companies.map((company) => (
                      <label
                        key={company.id}
                        className="flex items-start gap-3 rounded-lg border border-border px-3 py-3"
                      >
                        <Checkbox
                          checked={selectedCompanyIds.has(company.id)}
                          onCheckedChange={(checked) => {
                            setSelectedCompanyIds((current) => {
                              const next = new Set(current);
                              if (checked) next.add(company.id);
                              else next.delete(company.id);
                              return next;
                            });
                          }}
                        />
                        <span className="space-y-1">
                          <span className="block text-sm font-medium">{company.name}</span>
                          <span className="block text-xs text-muted-foreground">{company.issuePrefix}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => updateCompanyAccessMutation.mutate()}
                      disabled={updateCompanyAccessMutation.isPending}
                    >
                      {updateCompanyAccessMutation.isPending ? "Saving…" : "Save company access"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">Current memberships</h2>
                  <div className="space-y-2">
                    {(userAccessQuery.data?.companyAccess ?? []).map((membership) => (
                      <div
                        key={membership.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="font-medium">{membership.companyName || membership.companyId}</div>
                          <div className="text-muted-foreground">
                            {membership.membershipRole || "unset"} • {membership.status}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(membership.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        <Card className="block space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Companies</h2>
              <p className="text-sm text-muted-foreground">
                Review companies, inspect memberships, and jump into company-scoped management.
              </p>
            </div>
            {selectedAdminCompanyId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedCompanyId(selectedAdminCompanyId, { source: "manual" });
                  navigate("/company/settings/members");
                }}
              >
                Open company access
              </Button>
            ) : null}
          </div>

          <div className="grid gap-6 lg:grid-cols-(--gtc-34)">
            <div className="space-y-2">
              {companies.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => setSelectedAdminCompanyId(company.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    company.id === selectedAdminCompanyId
                      ? "border-foreground bg-accent"
                      : "border-border hover:bg-accent/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{company.name}</div>
                      <div className="truncate text-sm text-muted-foreground">{company.issuePrefix}</div>
                    </div>
                    <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {company.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {!selectedAdminCompanyId ? (
                <div className="text-sm text-muted-foreground">Select a company to inspect memberships.</div>
              ) : companyMembersQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading company memberships…</div>
              ) : companyMembersQuery.error ? (
                <div className="text-sm text-destructive">
                  {companyMembersQuery.error instanceof Error ? companyMembersQuery.error.message : "Failed to load company memberships."}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-border px-3 py-3 text-sm">
                      <div className="text-xs text-muted-foreground">Company</div>
                      <div className="mt-1 font-medium">
                        {companies.find((company) => company.id === selectedAdminCompanyId)?.name ?? selectedAdminCompanyId}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-3 text-sm">
                      <div className="text-xs text-muted-foreground">Members</div>
                      <div className="mt-1 font-medium">{companyMembersQuery.data?.members.length ?? 0}</div>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-3 text-sm">
                      <div className="text-xs text-muted-foreground">Can manage members</div>
                      <div className="mt-1 font-medium">{companyMembersQuery.data?.access.canManageMembers ? "Yes" : "No"}</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Memberships</h3>
                    <div className="space-y-2">
                      {(companyMembersQuery.data?.members ?? []).map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-medium">{member.user?.name || member.user?.email || member.principalId}</div>
                            <div className="text-muted-foreground">
                              {member.user?.email || member.principalId} • {member.membershipRole || "unset"} • {member.status}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(member.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create admin-managed user</DialogTitle>
            <DialogDescription>Create login, optional company membership, and initial account status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>Full name</span>
              <input className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.fullName} onChange={(event) => setCreateForm((current) => ({ ...current, fullName: event.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span>Email</span>
              <input type="email" className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span>Password</span>
              <input type="password" className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span>Status</span>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.status} onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as AuthUserStatus }))}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>CPF</span>
              <input className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.cpf} onChange={(event) => setCreateForm((current) => ({ ...current, cpf: event.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span>Phone</span>
              <input className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.phone} onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>Initial company access</span>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.companyId} onChange={(event) => setCreateForm((current) => ({ ...current, companyId: event.target.value }))}>
                <option value="">No company access</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>Initial membership role</span>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={createForm.membershipRole} disabled={!createForm.companyId} onChange={(event) => setCreateForm((current) => ({ ...current, membershipRole: event.target.value as CreateUserForm["membershipRole"] }))}>
                <option value="owner">owner</option>
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => createUserMutation.mutate()} disabled={createUserDisabled || createUserMutation.isPending}>
              {createUserMutation.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Update user profile fields and account status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span>Email</span>
              <input className="w-full rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground" value={selectedUserDetails?.email ?? ""} readOnly />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Full name</span>
              <input className="w-full rounded-md border border-border bg-background px-3 py-2" value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>CPF</span>
                <input className="w-full rounded-md border border-border bg-background px-3 py-2" value={editForm.cpf} onChange={(event) => setEditForm((current) => ({ ...current, cpf: event.target.value }))} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Phone</span>
                <input className="w-full rounded-md border border-border bg-background px-3 py-2" value={editForm.phone} onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span>Status</span>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={editForm.status} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as AuthUserStatus }))}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => updateUserMutation.mutate()} disabled={updateUserDisabled || updateUserMutation.isPending}>
              {updateUserMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Sets new credential password and revokes existing sessions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span>New password</span>
              <input type="password" className="w-full rounded-md border border-border bg-background px-3 py-2" value={resetPasswordForm.newPassword} onChange={(event) => setResetPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Confirm password</span>
              <input type="password" className="w-full rounded-md border border-border bg-background px-3 py-2" value={resetPasswordForm.confirmPassword} onChange={(event) => setResetPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetPasswordOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => resetPasswordMutation.mutate()} disabled={resetPasswordDisabled || resetPasswordMutation.isPending}>
              {resetPasswordMutation.isPending ? "Saving…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block user</DialogTitle>
            <DialogDescription>Blocks sign-in, revokes sessions, and revokes board API keys.</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span>Reason</span>
            <textarea className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBlockOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => blockMutation.mutate()} disabled={blockMutation.isPending}>
              {blockMutation.isPending ? "Blocking…" : "Block user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
