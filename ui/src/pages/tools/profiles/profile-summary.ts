import type { ToolProfileStatus, ToolProfileSummary, ToolProfileWithDetails } from "@paperclipai/shared";
import { t } from "@/i18n";

/**
 * Prosumer copy for the access-profile index (PAP-10997, AP1). Reads the
 * server-computed `summary` and renders the friendly "Allows" / "Assigned to"
 * lines the table shows. Vocabulary gate: nothing here says
 * binding/entry/selector/priority — only "tools", "apps", "agents".
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function toolCountLabel(count: number) {
  return t("profiles.summary.toolCount", { defaultValue: plural(count, "tool"), count });
}

function appCountLabel(count: number) {
  return t("profiles.summary.appCount", { defaultValue: plural(count, "app"), count });
}

function agentCountLabel(count: number) {
  return t("profiles.summary.agentCount", { defaultValue: plural(count, "agent"), count });
}

function assignmentCountLabel(count: number) {
  return t("profiles.summary.assignmentCount", { defaultValue: plural(count, "assignment"), count });
}

/** "9 tools · 3 apps" / "All tools" / "All except 2 tools". */
export function allowsLabel(summary: ToolProfileSummary): string {
  if (summary.accessMode === "all_except") {
    return summary.excludedToolCount === 0
      ? t("profiles.summary.allTools", { defaultValue: "All tools" })
      : t("profiles.summary.allExceptTools", {
        defaultValue: `All except ${plural(summary.excludedToolCount, "tool")}`,
        count: summary.excludedToolCount,
      });
  }
  const parts = [toolCountLabel(summary.allowedToolCount)];
  if (summary.allowedApplicationCount > 0) {
    parts.push(appCountLabel(summary.allowedApplicationCount));
  }
  return parts.join(" · ");
}

export interface AssignedLabel {
  text: string;
  /** A profile with no assignment has no effect — the index shows a quiet hint. */
  unassigned: boolean;
}

/** "Company default" / "2 agents" / "Not assigned yet". */
export function assignedLabel(summary: ToolProfileSummary): AssignedLabel {
  if (summary.isCompanyDefault) return { text: t("profiles.summary.companyDefault", { defaultValue: "Company default" }), unassigned: false };
  if (summary.appliesToAgentCount > 0) {
    return { text: agentCountLabel(summary.appliesToAgentCount), unassigned: false };
  }
  if (summary.assignmentCount > 0) {
    return { text: assignmentCountLabel(summary.assignmentCount), unassigned: false };
  }
  return { text: t("profiles.summary.notAssignedYet", { defaultValue: "Not assigned yet" }), unassigned: true };
}

export const STATUS_LABEL: Record<ToolProfileStatus, string> = {
  draft: t("profiles.status.draft", { defaultValue: "Draft" }),
  active: t("profiles.status.active", { defaultValue: "Active" }),
  disabled: t("profiles.status.disabled", { defaultValue: "Off" }),
  archived: t("profiles.status.archived", { defaultValue: "Archived" }),
};

export function isDraft(profile: Pick<ToolProfileWithDetails, "status">): boolean {
  return profile.status === "draft";
}
