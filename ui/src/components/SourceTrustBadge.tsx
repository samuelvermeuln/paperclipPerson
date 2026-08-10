import type { SourceTrustMetadata } from "@paperclipai/shared";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t as translate } from "@/i18n";
import { sourceTrustLabel } from "../lib/trust-policy-ui";
import { cn } from "../lib/utils";

export function SourceTrustBadge({
  sourceTrust,
  artifactLabel = "content",
  className,
}: {
  sourceTrust: SourceTrustMetadata | null | undefined;
  artifactLabel?: "comment" | "document" | "work product" | "content";
  className?: string;
}) {
  const label = sourceTrustLabel(sourceTrust);
  if (!label) return null;

  const promoted = sourceTrust?.disposition === "promoted";
  const translatedArtifactLabel = translate(`trustPresetSection.artifactLabels.${artifactLabel}`);
  const tooltip = promoted
    ? translate("trustPresetSection.sourceTrust.promotedTooltip", {
        dateSuffix: sourceTrust.promotedAt
          ? translate("trustPresetSection.sourceTrust.onDate", { date: new Date(sourceTrust.promotedAt).toLocaleString() })
          : "",
      })
    : translate("trustPresetSection.sourceTrust.lowTrustTooltip", { artifactLabel: translatedArtifactLabel });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          aria-label={label}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0 text-(length:--text-nano) font-medium tracking-normal",
            promoted
              ? "border-border text-muted-foreground"
              : "border-amber-500/40 text-amber-700 dark:text-amber-100",
            className,
          )}
        >
          {promoted ? <BadgeCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
