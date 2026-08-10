import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentPermissions, TrustPreset } from "@paperclipai/shared";
import { Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, CollapsibleSection } from "./agent-config-primitives";
import {
  buildPermissionsForTrustPreset,
  clearSingleLowTrustBoundaryTarget,
  getLowTrustBoundary,
  getSingleLowTrustBoundaryTarget,
  getTrustPreset,
  isCeLowTrustBoundaryEditable,
  lowTrustBoundaryHasScope,
  setSingleLowTrustBoundaryTarget,
  summarizeLowTrustBoundaryTarget,
  TRUST_PRESET_DESCRIPTIONS,
  TRUST_PRESET_LABELS,
  type LowTrustBoundaryTarget,
} from "../lib/trust-policy-ui";
import { cn } from "../lib/utils";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

function formatCount(value: readonly unknown[] | undefined, singularKey: string, pluralKey: string) {
  const count = value?.length ?? 0;
  if (count === 0) return "-";
  return count === 1 ? singularKey : pluralKey;
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right", value === "-" && "text-muted-foreground")}>{value}</span>
    </div>
  );
}

export interface LowTrustBoundaryCandidate {
  id: string;
  label: string;
}

type LowTrustBoundaryTargetType = LowTrustBoundaryTarget["type"];

const BOUNDARY_TARGET_LABEL_KEYS: Record<LowTrustBoundaryTargetType, string> = {
  project: "trustPresetSection.boundaryTargets.project",
  root_issue: "trustPresetSection.boundaryTargets.rootIssue",
  issue: "trustPresetSection.boundaryTargets.issue",
};

export function TrustPresetSection({
  permissions,
  onChange,
  disabled,
  companyId,
  projectCandidates = [],
  issueCandidates = [],
  candidatesLoading,
}: {
  permissions: Partial<AgentPermissions> | null | undefined;
  onChange: (permissions: Partial<AgentPermissions>) => void;
  disabled?: boolean;
  companyId?: string | null;
  projectCandidates?: LowTrustBoundaryCandidate[];
  issueCandidates?: LowTrustBoundaryCandidate[];
  candidatesLoading?: boolean;
}) {
  const { t } = useTranslation();
  const [policyOpen, setPolicyOpen] = useState(false);
  const preset = getTrustPreset(permissions);
  const boundary = getLowTrustBoundary(permissions);
  const boundaryTarget = getSingleLowTrustBoundaryTarget(boundary);
  const [targetType, setTargetType] = useState<LowTrustBoundaryTargetType>(boundaryTarget?.type ?? "project");
  const lowTrust = preset === "low_trust_review";
  const hasScope = lowTrustBoundaryHasScope(boundary);
  const boundaryEditable = isCeLowTrustBoundaryEditable(boundary);
  const policy = permissions?.authorizationPolicy ?? null;
  const managedPermissions = useMemo(
    () => buildPermissionsForTrustPreset(permissions, preset),
    [permissions, preset],
  );

  useEffect(() => {
    if (boundaryTarget) setTargetType(boundaryTarget.type);
  }, [boundaryTarget?.type]);

  function handlePresetChange(value: string) {
    const nextPreset: TrustPreset = value === "low_trust_review" ? "low_trust_review" : "standard";
    onChange(buildPermissionsForTrustPreset(permissions, nextPreset));
  }

  function handleBoundaryTargetChange(targetId: string) {
    if (!companyId || !targetId) return;
    onChange(setSingleLowTrustBoundaryTarget(permissions, companyId, { type: targetType, id: targetId }));
  }

  function handleClearBoundary() {
    onChange(clearSingleLowTrustBoundaryTarget(permissions));
  }

  const targetCandidates = targetType === "project" ? projectCandidates : issueCandidates;
  const boundaryValue = boundaryTarget?.type === targetType ? boundaryTarget.id : "";

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">{t("trustPresetSection.title")}</h3>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <Field label={t("trustPresetSection.fields.preset")} hint={t("trustPresetSection.fields.presetHint")}>
          <select
            className={inputClass}
            value={preset}
            onChange={(event) => handlePresetChange(event.target.value)}
            disabled={disabled}
          >
            <option value="standard">{TRUST_PRESET_LABELS.standard}</option>
            <option value="low_trust_review">{TRUST_PRESET_LABELS.low_trust_review}</option>
          </select>
        </Field>
        <p className="text-xs text-muted-foreground">{TRUST_PRESET_DESCRIPTIONS[preset]}</p>

        {lowTrust ? (
          <div
            role={hasScope ? "status" : "alert"}
            aria-live="polite"
            className={cn(
              "rounded-md border px-3 py-2.5 text-sm flex gap-2",
              hasScope
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-100"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {hasScope ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="font-medium">
                  {hasScope ? t("trustPresetSection.containment.activeTitle") : t("trustPresetSection.containment.notConfiguredTitle")}
                </p>
                <p className="mt-1 text-xs leading-5">
                  {hasScope
                    ? t("trustPresetSection.containment.activeDescription")
                    : t("trustPresetSection.containment.notConfiguredDescription")}
                </p>
              </div>
              {boundaryEditable ? (
                <div className="rounded-md border border-border/70 bg-background/70 p-3 text-foreground space-y-3">
                  <div className="grid gap-3 sm:grid-cols-(--gtc-12)">
                    <Field label={t("trustPresetSection.fields.boundaryType")}>
                      <select
                        className={inputClass}
                        value={targetType}
                        onChange={(event) => setTargetType(event.target.value as LowTrustBoundaryTargetType)}
                        disabled={disabled}
                      >
                        <option value="project">{t("trustPresetSection.boundaryTargets.project")}</option>
                        <option value="root_issue">{t("trustPresetSection.boundaryTargets.rootIssue")}</option>
                        <option value="issue">{t("trustPresetSection.boundaryTargets.issue")}</option>
                      </select>
                    </Field>
                    <Field label={t(BOUNDARY_TARGET_LABEL_KEYS[targetType])}>
                      <select
                        className={inputClass}
                        value={boundaryValue}
                        onChange={(event) => handleBoundaryTargetChange(event.target.value)}
                        disabled={disabled || !companyId || candidatesLoading || targetCandidates.length === 0}
                      >
                        <option value="">
                          {candidatesLoading
                            ? t("trustPresetSection.states.loading")
                            : targetCandidates.length === 0
                              ? targetType === "project"
                                ? t("trustPresetSection.states.noProjectsAvailable")
                                : t("trustPresetSection.states.noIssuesAvailable")
                              : t("trustPresetSection.states.selectBoundary")}
                        </option>
                        {targetCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t("trustPresetSection.messages.ceSingleBoundary")}
                    </p>
                    {boundaryTarget ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={handleClearBoundary}
                        disabled={disabled}
                      >
                        {t("trustPresetSection.actions.clearBoundary")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-border/70 bg-background/70 p-3 text-foreground">
                  <p className="text-sm font-medium">{t("trustPresetSection.messages.managedByEeApi")}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("trustPresetSection.messages.managedByEeApiDescription", {
                      boundary: summarizeLowTrustBoundaryTarget(boundary).toLowerCase(),
                    })}
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("trustPresetSection.messages.wantMoreThanOneBoundary")}{" "}
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://paperclip.ing/ee"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("trustPresetSection.actions.getPaperclipEe")}
                </a>
              </p>
              <CollapsibleSection
                title={t("trustPresetSection.actions.viewPolicy")}
                open={policyOpen}
                onToggle={() => setPolicyOpen((open) => !open)}
              >
                <div className="divide-y divide-border/60 text-foreground">
                  <PolicyRow label={t("trustPresetSection.policy.preset")} value={t("trustPresetSection.policy.lowTrustReviewV1")} />
                  <PolicyRow label={t("trustPresetSection.policy.rawOutput")} value={t("trustPresetSection.policy.quarantinedFromHigherTrustAgents")} />
                  <PolicyRow label={t("trustPresetSection.policy.projects")} value={formatCount(boundary?.projectIds, t("trustPresetSection.counts.project"), t("trustPresetSection.counts.projects"))} />
                  <PolicyRow label={t("trustPresetSection.policy.rootIssue")} value={boundary?.rootIssueId ? boundary.rootIssueId.slice(0, 8) : "-"} />
                  <PolicyRow label={t("trustPresetSection.policy.explicitIssues")} value={formatCount(boundary?.issueIds, t("trustPresetSection.counts.issue"), t("trustPresetSection.counts.issues"))} />
                  <PolicyRow label={t("trustPresetSection.policy.allowedAgents")} value={formatCount(boundary?.allowedAgentIds, t("trustPresetSection.counts.agent"), t("trustPresetSection.counts.agents"))} />
                  <PolicyRow label={t("trustPresetSection.policy.allowedTools")} value={boundary?.allowedToolClasses?.join(" · ") || "-"} />
                  <PolicyRow label={t("trustPresetSection.policy.allowedSecrets")} value={formatCount(boundary?.allowedSecretBindingIds, t("trustPresetSection.counts.binding"), t("trustPresetSection.counts.bindings"))} />
                  <PolicyRow label={t("trustPresetSection.policy.promotionTarget")} value={boundary?.outputPromotionTarget?.issueId?.slice(0, 8) ?? "-"} />
                  <PolicyRow
                    label={t("trustPresetSection.policy.eeFields")}
                    value={Object.keys(policy ?? {}).some((key) => !["trustPreset", "reviewPreset", "trustBoundary"].includes(key))
                      ? t("trustPresetSection.policy.customAdvancedPolicyFieldsPreserved")
                      : "-"}
                  />
                </div>
              </CollapsibleSection>
            </div>
          </div>
        ) : null}

        {managedPermissions.authorizationPolicy?.reviewPreset ? null : (
          <p className="text-xs text-muted-foreground">
            {t("trustPresetSection.messages.advancedPermissionsEditable")}
          </p>
        )}
      </div>
    </div>
  );
}
