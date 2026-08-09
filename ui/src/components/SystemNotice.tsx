import { useId, useState, type ReactNode } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type SystemNoticeTone = "neutral" | "info" | "success" | "warning" | "danger";

export type SystemNoticeMetadataRow =
  | { kind: "text"; label: string; value: string }
  | { kind: "code"; label: string; value: string }
  | { kind: "issue"; label: string; identifier: string; href?: string; title?: string }
  | { kind: "agent"; label: string; name: string; href?: string }
  | { kind: "run"; label: string; runId: string; href?: string; status?: string };

export type SystemNoticeMetadataSection = {
  title?: string;
  rows: SystemNoticeMetadataRow[];
};

export type SystemNoticeProps = {
  tone?: SystemNoticeTone;
  /** Short label that names the system actor + tone, e.g. "System warning". Required so tone is not color-only. */
  label?: string;
  /** Short visible body — one or two sentences from the system perspective. */
  body: ReactNode;
  /** Optional small chip for the originating run link. */
  source?: { label: string; href?: string };
  /** Hidden-by-default metadata. Renders the Details affordance only when present. */
  metadata?: SystemNoticeMetadataSection[];
  /** Force the details panel open initially. Defaults to false (collapsed). */
  detailsDefaultOpen?: boolean;
  /** Optional ISO timestamp shown next to the label. */
  timestamp?: string;
  className?: string;
};

type ToneTokens = {
  container: string;
  iconWrap: string;
  icon: LucideIcon;
  iconClass: string;
  label: string;
  divider: string;
};

const TONE_TOKENS: Record<SystemNoticeTone, ToneTokens> = {
  neutral: {
    container:
      "border-border bg-muted/35 dark:bg-muted/20",
    iconWrap: "bg-muted text-foreground/70",
    icon: Info,
    iconClass: "text-muted-foreground",
    label: "text-muted-foreground",
    divider: "border-border/70",
  },
  info: {
    container:
      "border-sky-300/70 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10",
    iconWrap: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
    icon: Info,
    iconClass: "text-sky-700 dark:text-sky-300",
    label: "text-sky-800 dark:text-sky-200",
    divider: "border-sky-300/50 dark:border-sky-500/30",
  },
  success: {
    container:
      "border-emerald-300/70 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    iconWrap: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
    icon: CircleCheck,
    iconClass: "text-emerald-700 dark:text-emerald-300",
    label: "text-emerald-800 dark:text-emerald-200",
    divider: "border-emerald-300/50 dark:border-emerald-500/30",
  },
  warning: {
    container:
      "border-amber-300/70 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10",
    iconWrap: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    icon: TriangleAlert,
    iconClass: "text-amber-700 dark:text-amber-300",
    label: "text-amber-900 dark:text-amber-200",
    divider: "border-amber-300/60 dark:border-amber-500/30",
  },
  danger: {
    container:
      "border-red-400/60 bg-red-50/80 dark:border-red-500/35 dark:bg-red-500/10",
    iconWrap: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
    icon: OctagonAlert,
    iconClass: "text-red-700 dark:text-red-300",
    label: "text-red-900 dark:text-red-200",
    divider: "border-red-400/50 dark:border-red-500/30",
  },
};

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function translateSystemNoticeText(t: ReturnType<typeof useTranslation>["t"], text: string): string {
  const keyMap: Record<string, string> = {
    "System notice": "issueDetailPage.systemNotice.defaults.notice",
    "System warning": "issueDetailPage.systemNotice.defaults.warning",
    "System alert": "issueDetailPage.systemNotice.defaults.alert",
    "Hide details": "issueDetailPage.systemNotice.actions.hideDetails",
    "Details": "issueDetailPage.systemNotice.actions.details",
    "Missing issue disposition": "issueDetailPage.systemNotice.labels.missingIssueDisposition",
    "Missing disposition recovery blocked": "issueDetailPage.systemNotice.labels.missingDispositionRecoveryBlocked",
    "Missing disposition": "issueDetailPage.systemNotice.labels.missingDisposition",
    "Required action": "issueDetailPage.systemNotice.sections.requiredAction",
    "Run evidence": "issueDetailPage.systemNotice.sections.runEvidence",
    "Source issue": "issueDetailPage.systemNotice.rows.sourceIssue",
    "Assignee": "issueDetailPage.systemNotice.rows.assignee",
    "Recovery owner": "issueDetailPage.systemNotice.rows.recoveryOwner",
    "Recovery action": "issueDetailPage.systemNotice.rows.recoveryAction",
    "Source assignee": "issueDetailPage.systemNotice.rows.sourceAssignee",
    "Suggested action": "issueDetailPage.systemNotice.rows.suggestedAction",
    "Valid dispositions": "issueDetailPage.systemNotice.rows.validDispositions",
    "Successful run": "issueDetailPage.systemNotice.rows.successfulRun",
    "Source run": "issueDetailPage.systemNotice.rows.sourceRun",
    "Corrective handoff run": "issueDetailPage.systemNotice.rows.correctiveHandoffRun",
    "Run status": "issueDetailPage.systemNotice.rows.runStatus",
    "Latest issue status": "issueDetailPage.systemNotice.rows.latestIssueStatus",
    "Latest handoff run status": "issueDetailPage.systemNotice.rows.latestHandoffRunStatus",
    "Normalized cause": "issueDetailPage.systemNotice.rows.normalizedCause",
    "Detected progress": "issueDetailPage.systemNotice.rows.detectedProgress",
    "Automatic retry": "issueDetailPage.systemNotice.rows.automaticRetry",
    "Paperclip needs a disposition before this issue can continue.": "issueDetailPage.systemNotice.messages.needsDisposition",
    "Paperclip could not resolve this issue's missing disposition automatically. The issue is blocked on a recovery owner.": "issueDetailPage.systemNotice.messages.recoveryBlocked",
    "Run produced useful output but no concrete action evidence": "issueDetailPage.systemNotice.messages.detectedProgressNoActionEvidence",
    "choose and record a valid issue disposition without copying transcript content": "issueDetailPage.systemNotice.messages.chooseValidDispositionWithoutTranscript",
    "succeeded": "issueDetailPage.systemNotice.status.succeeded",
    "failed": "issueDetailPage.systemNotice.status.failed",
    "running": "issueDetailPage.systemNotice.status.running",
    "queued": "issueDetailPage.systemNotice.status.queued",
    "in_progress": "issueDetailPage.systemNotice.status.inProgress"
  };
  const key = keyMap[text];
  return key ? t(key) : text;
}

function MetadataRow({ row, tone }: { row: SystemNoticeMetadataRow; tone: ToneTokens }) {
  const { t } = useTranslation();
  const translatedLabel = translateSystemNoticeText(t, row.label);
  return (
    <div className="grid grid-cols-(--gtc-8) gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs">
      <div className="truncate text-(length:--text-micro) font-medium uppercase tracking-(--tracking-label) text-muted-foreground">
        {translatedLabel}
      </div>
      <div className="min-w-0 break-words text-foreground/90">
        {(() => {
          switch (row.kind) {
            case "text":
              return <span>{translateSystemNoticeText(t, row.value)}</span>;
            case "code":
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-(length:--text-micro) text-foreground/80">
                  {row.value}
                </code>
              );
            case "issue": {
              const issueLabel = (
                <>
                  <span>{row.identifier}</span>
                  {row.title ? (
                    <span className="text-muted-foreground">— {translateSystemNoticeText(t, row.title)}</span>
                  ) : null}
                </>
              );
              if (row.href) {
                return (
                  <a
                    href={row.href}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm font-medium underline-offset-2 hover:underline",
                      tone.label,
                    )}
                  >
                    {issueLabel}
                  </a>
                );
              }
              return (
                <span className={cn("inline-flex items-center gap-1 font-medium", tone.label)}>
                  {issueLabel}
                </span>
              );
            }
            case "agent":
              if (row.href) {
                return (
                  <a
                    href={row.href}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm font-medium underline-offset-2 hover:underline",
                      tone.label,
                    )}
                  >
                    {row.name}
                  </a>
                );
              }
              return (
                <span className={cn("font-medium", tone.label)}>{row.name}</span>
              );
            case "run": {
              const runShort = row.runId.length > 12 ? `${row.runId.slice(0, 8)}…` : row.runId;
              const inner = (
                <>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-foreground/80">{runShort}</code>
                  {row.status ? (
                    <span className={cn("font-sans", tone.label)}>{translateSystemNoticeText(t, row.status)}</span>
                  ) : null}
                </>
              );
              if (row.href) {
                return (
                  <a
                    href={row.href}
                    className="inline-flex items-center gap-2 rounded-sm font-mono text-(length:--text-micro) underline-offset-2 hover:underline"
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <span className="inline-flex items-center gap-2 font-mono text-(length:--text-micro)">
                  {inner}
                </span>
              );
            }
          }
        })()}
      </div>
    </div>
  );
}

export function SystemNotice({
  tone = "neutral",
  label,
  body,
  source,
  metadata,
  detailsDefaultOpen = false,
  timestamp,
  className,
}: SystemNoticeProps) {
  const { t } = useTranslation();
  const tokens = TONE_TOKENS[tone];
  const ToneIcon = tokens.icon;
  const [open, setOpen] = useState(detailsDefaultOpen);
  const detailsId = useId();
  const hasDetails = Boolean(metadata && metadata.length > 0);
  const resolvedLabel = translateSystemNoticeText(
    t,
    label ??
      {
        neutral: "System notice",
        info: "System notice",
        success: "System notice",
        warning: "System warning",
        danger: "System alert",
      }[tone],
  );
  const resolvedBody = typeof body === "string" ? translateSystemNoticeText(t, body) : body;

  return (
    <section
      role="status"
      aria-label={resolvedLabel}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border text-sm shadow-(--shadow-extract-8)",
        tokens.container,
        className,
      )}
    >
      <header className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            tokens.iconWrap,
          )}
          aria-hidden
        >
          <ToneIcon className={cn("h-4 w-4", tokens.iconClass)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-(length:--text-micro) font-semibold uppercase tracking-(--tracking-eyebrow)">
            <span className={tokens.label}>{resolvedLabel}</span>
            {source ? (
              <>
                <span className="text-muted-foreground/60" aria-hidden>·</span>
                {source.href ? (
                  <a
                    href={source.href}
                    className="rounded-sm font-medium normal-case tracking-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {source.label}
                  </a>
                ) : (
                  <span className="font-medium normal-case tracking-normal text-muted-foreground">
                    {source.label}
                  </span>
                )}
              </>
            ) : null}
            {timestamp ? (
              <>
                <span className="text-muted-foreground/60" aria-hidden>·</span>
                <span className="font-medium normal-case tracking-normal text-muted-foreground">
                  {formatTimestamp(timestamp)}
                </span>
              </>
            ) : null}
          </div>
          <div className="mt-1 break-words text-sm leading-6 text-foreground">{resolvedBody}</div>
        </div>
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={detailsId}
            className={cn(
              "ml-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-transparent px-2 text-(length:--text-micro) font-medium uppercase tracking-(--tracking-eyebrow) text-muted-foreground transition-(--tp-background-color-border-color-color)",
              "hover:border-border/70 hover:bg-background/70 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            <span>{open ? t("issueDetailPage.systemNotice.actions.hideDetails") : t("issueDetailPage.systemNotice.actions.details")}</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </header>
      {hasDetails && open ? (
        <div
          id={detailsId}
          className={cn(
            "border-t bg-background/50 dark:bg-background/30",
            tokens.divider,
          )}
        >
          <div className="divide-y divide-border/50 px-1 py-1">
            {metadata!.map((section, sectionIdx) => (
              <div key={sectionIdx} className="py-1.5 first:pt-2 last:pb-2">
                {section.title ? (
                  <div className="px-3 pb-1 pt-0.5 text-(length:--text-nano) font-semibold uppercase tracking-(--tracking-caps) text-muted-foreground">
                    {translateSystemNoticeText(t, section.title)}
                  </div>
                ) : null}
                <div>
                  {section.rows.map((row, rowIdx) => (
                    <MetadataRow key={rowIdx} row={row} tone={tokens} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default SystemNotice;
