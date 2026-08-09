import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as translate } from "@/i18n";
import { Link } from "@/lib/router";
import type { Issue, ExecutionWorkspace } from "@paperclipai/shared";
import { useQuery } from "@tanstack/react-query";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { environmentsApi } from "../api/environments";
import { instanceSettingsApi } from "../api/instanceSettings";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import {
  defaultExecutionWorkspaceModeForProject,
  issueExecutionWorkspaceModeForExistingWorkspace,
} from "../lib/project-workspace-defaults";
import { orderReusableExecutionWorkspaces } from "../lib/reusable-execution-workspaces";
import { cn, projectWorkspaceUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Check, Copy, FileSearch, FolderOpen, FolderSearch, GitBranch, Pencil, X } from "lucide-react";
import { ReusableExecutionWorkspaceSelect } from "./ReusableExecutionWorkspaceSelect";
import { Badge } from "@/components/ui/badge";

/* -------------------------------------------------------------------------- */
/*  Utility helpers (mirrored from IssueProperties for self-containment)      */
/* -------------------------------------------------------------------------- */

const EXECUTION_WORKSPACE_OPTIONS = [
  { value: "shared_workspace", labelKey: "issueDetailPage.workspaceCard.options.projectDefault" },
  { value: "isolated_workspace", labelKey: "issueDetailPage.workspaceCard.options.newIsolatedWorkspace" },
  { value: "reuse_existing", labelKey: "issueDetailPage.workspaceCard.options.reuseExistingWorkspace" },
] as const;

function shouldPresentExistingWorkspaceSelection(
  issue: Pick<
    Issue,
    "executionWorkspaceId" | "executionWorkspacePreference" | "executionWorkspaceSettings" | "currentExecutionWorkspace"
  >,
) {
  const persistedMode =
    issue.currentExecutionWorkspace?.mode
    ?? issue.executionWorkspaceSettings?.mode
    ?? issue.executionWorkspacePreference;
  return Boolean(
    issue.executionWorkspaceId &&
    (persistedMode === "isolated_workspace" || persistedMode === "operator_branch"),
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function BreakablePath({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const segments = text.split(/(?<=[\/-])/);
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) parts.push(<wbr key={i} />);
    parts.push(segments[i]);
  }
  return <>{parts}</>;
}

function CopyableInline({ value, label, mono }: { value: string; label?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }, [value]);

  return (
    <span className="inline-flex items-center gap-1 group/copy">
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className={cn("min-w-0", mono && "font-mono")} style={{ overflowWrap: "anywhere" }}>
        <BreakablePath text={value} />
      </span>
      <button
        type="button"
        className="shrink-0 p-0.5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground opacity-0 group-hover/copy:opacity-100 focus:opacity-100"
        onClick={handleCopy}
        title={copied ? translate("issueDetailPage.workspaceCard.copy.copiedTitle") : translate("issueDetailPage.workspaceCard.copy.copyTitle")}
        aria-label={copied
          ? translate("issueDetailPage.workspaceCard.copy.copiedAria")
          : translate("issueDetailPage.workspaceCard.copy.copyAria", { label: label ?? translate("issueDetailPage.workspaceCard.copy.value") })}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

function workspaceModeLabel(mode: string | null | undefined) {
  switch (mode) {
    case "isolated_workspace": return translate("issueDetailPage.workspaceCard.modes.isolatedWorkspace");
    case "operator_branch": return translate("issueDetailPage.workspaceCard.modes.operatorBranch");
    case "cloud_sandbox": return translate("issueDetailPage.workspaceCard.modes.cloudSandbox");
    case "adapter_managed": return translate("issueDetailPage.workspaceCard.modes.adapterManaged");
    default: return translate("issueDetailPage.workspaceCard.modes.workspace");
  }
}

function configuredWorkspaceLabel(
  selection: string | null | undefined,
  reusableWorkspace: ExecutionWorkspace | null,
) {
  switch (selection) {
    case "isolated_workspace":
      return translate("issueDetailPage.workspaceCard.options.newIsolatedWorkspace");
    case "reuse_existing":
      return reusableWorkspace?.mode === "isolated_workspace"
        ? translate("issueDetailPage.workspaceCard.options.existingIsolatedWorkspace")
        : translate("issueDetailPage.workspaceCard.options.reuseExistingWorkspace");
    default:
      return translate("issueDetailPage.workspaceCard.options.projectDefault");
  }
}

function projectWorkspaceDetailLink(input: {
  projectId: string | null | undefined;
  projectWorkspaceId: string | null | undefined;
}) {
  if (!input.projectId || !input.projectWorkspaceId) return null;
  return projectWorkspaceUrl({ id: input.projectId, urlKey: input.projectId }, input.projectWorkspaceId);
}

function workspaceDetailLink(input: {
  projectId: string | null | undefined;
  issueProjectWorkspaceId: string | null | undefined;
  workspace: ExecutionWorkspace | null | undefined;
}) {
  const linkedProjectWorkspaceId = input.workspace?.projectWorkspaceId ?? input.issueProjectWorkspaceId ?? null;
  if (input.workspace?.mode === "shared_workspace") {
    return projectWorkspaceDetailLink({
      projectId: input.projectId,
      projectWorkspaceId: linkedProjectWorkspaceId,
    });
  }
  return input.workspace ? `/execution-workspaces/${input.workspace.id}` : null;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    active: "bg-green-500/15 text-green-700 dark:text-green-400",
    idle: "bg-muted text-muted-foreground",
    in_review: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    archived: "bg-muted text-muted-foreground",
  };
  const label = ({
    active: translate("issueDetailPage.workspaceCard.status.active"),
    idle: translate("issueDetailPage.workspaceCard.status.idle"),
    in_review: translate("issueDetailPage.workspaceCard.status.inReview"),
    archived: translate("issueDetailPage.workspaceCard.status.archived"),
  } as const)[status as keyof typeof colors] ?? status.replace(/_/g, " ");
  return (
    <Badge variant="ghost" className={cn("text-(length:--text-nano) px-1.5", colors[status] ?? colors.idle)}>
      {label}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

interface IssueWorkspaceCardProps {
  issue: Omit<
    Pick<
      Issue,
      | "companyId"
      | "projectId"
      | "projectWorkspaceId"
      | "executionWorkspaceId"
      | "executionWorkspacePreference"
      | "executionWorkspaceSettings"
    >,
    "companyId"
  > & {
    companyId: string | null;
    currentExecutionWorkspace?: ExecutionWorkspace | null;
  };
  project: {
    id: string;
    executionWorkspacePolicy?: {
      enabled?: boolean;
      defaultMode?: string | null;
      defaultProjectWorkspaceId?: string | null;
      environmentId?: string | null;
    } | null;
    workspaces?: Array<{ id: string; isPrimary: boolean }>;
  } | null;
  onUpdate: (data: Record<string, unknown>) => void;
  initialEditing?: boolean;
  livePreview?: boolean;
  onDraftChange?: (data: Record<string, unknown>, meta: { canSave: boolean; workspaceBranchName?: string | null }) => void;
  /** Opens the workspace file browser sheet. When omitted, the browse row is hidden. */
  onBrowseFiles?: () => void;
  /** Opens the same browser sheet focused for path entry. */
  onOpenFileByPath?: () => void;
}

export function IssueWorkspaceCard({
  issue,
  project,
  onUpdate,
  initialEditing = false,
  livePreview = false,
  onDraftChange,
  onBrowseFiles,
  onOpenFileByPath,
}: IssueWorkspaceCardProps) {
  const { selectedCompanyId } = useCompany();
  const companyId = issue.companyId ?? selectedCompanyId;
  const [editing, setEditing] = useState(initialEditing);

  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const environmentsEnabled = experimentalSettings?.enableEnvironments === true;
  const policyEnabled = experimentalSettings?.enableIsolatedWorkspaces === true
    && Boolean(project?.executionWorkspacePolicy?.enabled);

  const workspace = issue.currentExecutionWorkspace as ExecutionWorkspace | null | undefined;
  const { data: environments } = useQuery({
    queryKey: queryKeys.environments.list(companyId!),
    queryFn: () => environmentsApi.list(companyId!),
    enabled: Boolean(companyId) && environmentsEnabled,
  });

  const {
    data: reusableExecutionWorkspaces,
    isLoading: reusableExecutionWorkspacesLoading,
    isError: reusableExecutionWorkspacesError,
  } = useQuery({
    queryKey: queryKeys.executionWorkspaces.list(companyId!, {
      projectId: issue.projectId ?? undefined,
      projectWorkspaceId: issue.projectWorkspaceId ?? undefined,
      reuseEligible: true,
    }),
    queryFn: () =>
      executionWorkspacesApi.list(companyId!, {
        projectId: issue.projectId ?? undefined,
        projectWorkspaceId: issue.projectWorkspaceId ?? undefined,
        reuseEligible: true,
      }),
    enabled: Boolean(companyId) && Boolean(issue.projectId) && editing,
  });

  const selectableReusableWorkspaces = reusableExecutionWorkspaces ?? [];

  const selectedReusableExecutionWorkspace =
    selectableReusableWorkspaces.find((w) => w.id === issue.executionWorkspaceId)
    ?? workspace
    ?? null;

  const currentSelection = shouldPresentExistingWorkspaceSelection(issue)
    ? "reuse_existing"
    : (
        issue.executionWorkspacePreference
        ?? issue.executionWorkspaceSettings?.mode
        ?? defaultExecutionWorkspaceModeForProject(project)
      );

  const [draftSelection, setDraftSelection] = useState(currentSelection);
  const [draftExecutionWorkspaceId, setDraftExecutionWorkspaceId] = useState(issue.executionWorkspaceId ?? "");
  const projectEnvironmentId = environmentsEnabled
    ? project?.executionWorkspacePolicy?.environmentId ?? null
    : null;
  const currentReusableEnvironmentId = selectedReusableExecutionWorkspace?.config?.environmentId ?? null;
  const currentEnvironmentId = environmentsEnabled
    ? (
        (currentSelection === "reuse_existing" && currentReusableEnvironmentId)
        ?? workspace?.config?.environmentId
        ?? projectEnvironmentId
      )
    : null;
  const currentEnvironment =
    environments?.find((environment) => environment.id === currentEnvironmentId)
    ?? null;

  useEffect(() => {
    if (editing) return;
    setDraftSelection(currentSelection);
    setDraftExecutionWorkspaceId(issue.executionWorkspaceId ?? "");
  }, [currentSelection, editing, issue.executionWorkspaceId]);

  const activeNonDefaultWorkspace = Boolean(workspace && workspace.mode !== "shared_workspace");

  const configuredReusableWorkspace =
    selectableReusableWorkspaces.find((w) => w.id === draftExecutionWorkspaceId)
    ?? (draftExecutionWorkspaceId === issue.executionWorkspaceId ? selectedReusableExecutionWorkspace : null);

  const selectedReusableWorkspaceLink = workspaceDetailLink({
    projectId: project?.id,
    issueProjectWorkspaceId: issue.projectWorkspaceId,
    workspace: selectedReusableExecutionWorkspace,
  });
  const currentWorkspaceLink = workspaceDetailLink({
    projectId: project?.id,
    issueProjectWorkspaceId: issue.projectWorkspaceId,
    workspace,
  });

  const canSaveWorkspaceConfig = draftSelection !== "reuse_existing" || draftExecutionWorkspaceId.length > 0;
  const draftWorkspaceBranchName =
    draftSelection === "reuse_existing" && configuredReusableWorkspace?.mode !== "shared_workspace"
      ? configuredReusableWorkspace?.branchName ?? null
      : null;

  const buildWorkspaceDraftUpdate = useCallback(() => ({
    executionWorkspacePreference: draftSelection,
    executionWorkspaceId: draftSelection === "reuse_existing" ? draftExecutionWorkspaceId || null : null,
    executionWorkspaceSettings: {
      mode:
        draftSelection === "reuse_existing"
          ? issueExecutionWorkspaceModeForExistingWorkspace(configuredReusableWorkspace?.mode)
          : draftSelection,
      environmentId: null,
    },
  }), [
    configuredReusableWorkspace?.mode,
    draftExecutionWorkspaceId,
    draftSelection,
  ]);

  useEffect(() => {
    if (!onDraftChange) return;
    onDraftChange(buildWorkspaceDraftUpdate(), {
      canSave: canSaveWorkspaceConfig,
      workspaceBranchName: draftWorkspaceBranchName,
    });
  }, [buildWorkspaceDraftUpdate, canSaveWorkspaceConfig, draftWorkspaceBranchName, onDraftChange]);

  const handleSave = useCallback(() => {
    if (!canSaveWorkspaceConfig) return;
    onUpdate(buildWorkspaceDraftUpdate());
    setEditing(false);
  }, [
    buildWorkspaceDraftUpdate,
    canSaveWorkspaceConfig,
    onUpdate,
  ]);

  const handleCancel = useCallback(() => {
    setDraftSelection(currentSelection);
    setDraftExecutionWorkspaceId(issue.executionWorkspaceId ?? "");
    setEditing(false);
  }, [currentSelection, issue.executionWorkspaceId]);

  if (!policyEnabled || !project) return null;

  const showEditingControls = livePreview || editing;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          {activeNonDefaultWorkspace && workspace
            ? workspaceModeLabel(workspace.mode)
            : configuredWorkspaceLabel(currentSelection, selectedReusableExecutionWorkspace)}
          {workspace ? statusBadge(workspace.status) : statusBadge("idle")}
        </div>
        <div className="flex items-center gap-1">
          {showEditingControls ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={handleCancel}
              >
                <X className="h-3 w-3 mr-1" />{translate("issueDetailPage.workspaceCard.actions.cancel")}
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleSave}
                disabled={!canSaveWorkspaceConfig}
              >
                {translate("issueDetailPage.workspaceCard.actions.save")}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3 mr-1" />{translate("issueDetailPage.workspaceCard.actions.edit")}
            </Button>
          )}
        </div>
      </div>

      {/* Read-only info */}
      {!showEditingControls && (
        <div className="space-y-1.5 text-xs">
          {workspace?.branchName && (
            <div className="flex items-center gap-1.5">
              <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
              <CopyableInline value={workspace.branchName} mono />
            </div>
          )}
          {workspace?.cwd && (
            <div className="flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
              <CopyableInline value={workspace.cwd} mono />
            </div>
          )}
          {workspace?.repoUrl && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-(length:--text-micro)">{translate("issueDetailPage.workspaceCard.labels.repo")}</span>
              <CopyableInline value={workspace.repoUrl} mono />
            </div>
          )}
          {environmentsEnabled && currentEnvironmentId && (
            <div className="text-muted-foreground" style={{ overflowWrap: "anywhere" }}>
              {translate("issueDetailPage.workspaceCard.labels.environment")} <span className="text-foreground">{currentEnvironment?.name ?? currentEnvironmentId}</span>
              {currentSelection === "reuse_existing" && currentReusableEnvironmentId === currentEnvironmentId
                ? translate("issueDetailPage.workspaceCard.environmentSuffix.reusedWorkspace")
                : !issue.executionWorkspaceSettings?.environmentId && projectEnvironmentId === currentEnvironmentId
                ? translate("issueDetailPage.workspaceCard.environmentSuffix.projectDefault")
                : null}
            </div>
          )}
          {!workspace && (
            <div className="text-muted-foreground">
              {currentSelection === "isolated_workspace"
                ? translate("issueDetailPage.workspaceCard.descriptions.freshIsolatedWorkspace")
                : currentSelection === "reuse_existing"
                  ? translate("issueDetailPage.workspaceCard.descriptions.reuseExistingWorkspace")
                  : translate("issueDetailPage.workspaceCard.descriptions.projectDefaultWorkspace")}
            </div>
          )}
          {currentSelection === "reuse_existing" && selectedReusableExecutionWorkspace && (
            <div className="text-muted-foreground" style={{ overflowWrap: "anywhere" }}>
              {translate("issueDetailPage.workspaceCard.labels.reusing")} 
              {selectedReusableWorkspaceLink ? (
                <Link
                  to={selectedReusableWorkspaceLink}
                  className="hover:text-foreground hover:underline"
                >
                  <BreakablePath text={selectedReusableExecutionWorkspace.name} />
                </Link>
              ) : (
                <BreakablePath text={selectedReusableExecutionWorkspace.name} />
              )}
            </div>
          )}
          {workspace && currentWorkspaceLink && (
            <div className="pt-0.5">
              <Link
                to={currentWorkspaceLink}
                className="text-(length:--text-micro) text-muted-foreground hover:text-foreground hover:underline"
              >
                {translate("issueDetailPage.workspaceCard.actions.viewWorkspaceDetails")}
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Editing controls */}
      {editing && (
        <div className="space-y-2 pt-1">
          <select
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
            value={draftSelection}
            onChange={(e) => {
              const nextMode = e.target.value;
              setDraftSelection(nextMode);
              if (nextMode !== "reuse_existing") {
                setDraftExecutionWorkspaceId("");
              } else if (!draftExecutionWorkspaceId && issue.executionWorkspaceId) {
                setDraftExecutionWorkspaceId(issue.executionWorkspaceId);
              }
            }}
          >
            {EXECUTION_WORKSPACE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value === "reuse_existing" && configuredReusableWorkspace?.mode === "isolated_workspace"
                  ? translate("issueDetailPage.workspaceCard.options.existingIsolatedWorkspace")
                  : translate(option.labelKey)}
              </option>
            ))}
          </select>

          {draftSelection === "reuse_existing" && (
            <ReusableExecutionWorkspaceSelect
              value={draftExecutionWorkspaceId}
              workspaces={selectableReusableWorkspaces}
              onValueChange={(workspaceId) => setDraftExecutionWorkspaceId(workspaceId)}
              loading={reusableExecutionWorkspacesLoading}
              error={reusableExecutionWorkspacesError}
            />
          )}

          {/* Current workspace summary when editing */}
          {workspace && (
            <div className="text-(length:--text-micro) text-muted-foreground space-y-0.5 pt-1 border-t border-border/50">
              <div style={{ overflowWrap: "anywhere" }}>
                {translate("issueDetailPage.workspaceCard.labels.current")} 
                {currentWorkspaceLink ? (
                  <Link
                    to={currentWorkspaceLink}
                    className="hover:text-foreground hover:underline"
                  >
                    <BreakablePath text={workspace.name} />
                  </Link>
                ) : (
                  <BreakablePath text={workspace.name} />
                )}
                {" · "}
                {workspace.status}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workspace file discovery — calm row under the workspace identity. */}
      {!showEditingControls && onBrowseFiles && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-2 text-xs">
          <button
            type="button"
            onClick={onBrowseFiles}
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <FolderSearch className="h-3.5 w-3.5 shrink-0" />
            {translate("issueDetailPage.workspaceCard.actions.browseFiles")}
          </button>
          <button
            type="button"
            onClick={onOpenFileByPath ?? onBrowseFiles}
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileSearch className="h-3.5 w-3.5 shrink-0" />
            {translate("issueDetailPage.workspaceCard.actions.openFileByPath")}
          </button>
        </div>
      )}
    </div>
  );
}
