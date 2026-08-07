import { useEffect, useMemo, useState } from "react";
import type { AdapterConfigFieldsProps } from "../types";
import {
  DraftInput,
  DraftNumberInput,
  Field,
  ToggleField,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";
import { SearchableSelect, type SearchableSelectGroup } from "../../components/SearchableSelect";
import { NINEROUTER_ALL_COMBOS_SENTINEL } from "@paperclipai/adapter-opencode-9router";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

type ComboOption = {
  key: string;
  value: string;
  label: string;
  searchText?: string;
};

function ComboSelectField({
  value,
  models,
  onChange,
  placeholder,
}: {
  value: string;
  models: { id: string; label: string }[];
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const groups = useMemo<SearchableSelectGroup<string, ComboOption>[]>(() => [{
    id: "combos",
    label: "Combos",
    options: models.map((model) => ({
      key: model.id,
      value: model.id,
      label: model.label,
      searchText: model.id,
    })),
  }], [models]);

  return (
    <SearchableSelect
      value={value}
      groups={groups}
      onValueChange={(next) => onChange(next)}
      placeholder={placeholder}
      searchPlaceholder="Search combos..."
      emptyMessage="No combos found. Refresh discovery or adjust the 9Router settings."
      renderValue={(option) => option?.label ?? (value || placeholder)}
      createItem={{
        render: (query) => `Use \"${query}\"`,
        onSelect: (query) => onChange(query.trim()),
      }}
    />
  );
}

export function OpenCode9RouterConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  models,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  const initialSmallComboOverrideIsPrimary = Object.prototype.hasOwnProperty.call(config, "smallCombo")
    && String(config.smallCombo ?? "") === "";
  const initialIgnoreGlobalComboPrefix = Object.prototype.hasOwnProperty.call(config, "comboPrefix")
    && ["", NINEROUTER_ALL_COMBOS_SENTINEL].includes(String(config.comboPrefix ?? ""));
  const [editSmallComboOverrideIsPrimary, setEditSmallComboOverrideIsPrimary] = useState(initialSmallComboOverrideIsPrimary);
  const [editIgnoreGlobalComboPrefix, setEditIgnoreGlobalComboPrefix] = useState(initialIgnoreGlobalComboPrefix);

  useEffect(() => {
    if (isCreate) return;
    setEditSmallComboOverrideIsPrimary(initialSmallComboOverrideIsPrimary);
  }, [initialSmallComboOverrideIsPrimary, isCreate]);

  useEffect(() => {
    if (isCreate) return;
    setEditIgnoreGlobalComboPrefix(initialIgnoreGlobalComboPrefix);
  }, [initialIgnoreGlobalComboPrefix, isCreate]);

  const smallComboOverrideIsPrimary = isCreate
    ? Boolean(values?.opencode9RouterUsePrimaryAsSmallCombo)
    : editSmallComboOverrideIsPrimary;
  const currentSmallCombo = smallComboOverrideIsPrimary
    ? ""
    : isCreate
      ? (values?.opencode9RouterSmallCombo ?? "")
      : eff("adapterConfig", "smallCombo", String(config.smallCombo ?? ""));
  const ignoreGlobalComboPrefix = isCreate
    ? Boolean(values?.opencode9RouterIgnoreGlobalComboPrefix)
    : editIgnoreGlobalComboPrefix;

  return (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}

      <Field
        label="9Router base URL"
        hint="Defaults to NINEROUTER_BASE_URL. Paperclip normalizes values like host/, host/v1, and host/v1/."
      >
        <DraftInput
          value={
            isCreate
              ? values!.opencode9RouterBaseUrl ?? ""
              : eff("adapterConfig", "baseUrl", String(config.baseUrl ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ opencode9RouterBaseUrl: v })
              : mark("adapterConfig", "baseUrl", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="http://9router:20128/v1"
        />
      </Field>

      <Field
        label="API key environment variable"
        hint="Stores only the variable name in the agent config. Paperclip reads the real value from its own environment at runtime."
      >
        <DraftInput
          value={
            isCreate
              ? values!.opencode9RouterApiKeyEnv ?? ""
              : eff("adapterConfig", "apiKeyEnv", String(config.apiKeyEnv ?? "NINEROUTER_API_KEY"))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ opencode9RouterApiKeyEnv: v })
              : mark("adapterConfig", "apiKeyEnv", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="NINEROUTER_API_KEY"
        />
      </Field>

      <Field
        label="Auxiliary combo"
        hint="Optional OpenCode small_model combo. Leave blank to inherit the global default, or force reuse of the primary combo below."
      >
        <div className="space-y-2">
          <ComboSelectField
            value={currentSmallCombo}
            models={models}
            onChange={(next) =>
              isCreate
                ? set!({
                    opencode9RouterSmallCombo: next,
                    opencode9RouterUsePrimaryAsSmallCombo: false,
                  })
                : (() => {
                    setEditSmallComboOverrideIsPrimary(false);
                    mark("adapterConfig", "smallCombo", next || undefined);
                  })()
            }
            placeholder="Inherit global small combo"
          />
          <ToggleField
            label="Always reuse primary combo"
            hint="Persists an explicit per-agent override so this agent ignores NINEROUTER_SMALL_COMBO and uses the primary combo for small_model."
            checked={smallComboOverrideIsPrimary}
            onChange={(checked) => {
              if (isCreate) {
                set!({
                  opencode9RouterUsePrimaryAsSmallCombo: checked,
                  ...(checked ? { opencode9RouterSmallCombo: "" } : {}),
                });
                return;
              }
              setEditSmallComboOverrideIsPrimary(checked);
              mark("adapterConfig", "smallCombo", checked ? "" : undefined);
            }}
          />
        </div>
      </Field>

      <Field
        label="Optional combo prefix"
        hint="When set, only discovered combos starting with this prefix are shown."
      >
        <div className="space-y-2">
          <DraftInput
            value={
              ignoreGlobalComboPrefix
                ? ""
                : isCreate
                  ? values!.opencode9RouterComboPrefix ?? ""
                  : eff("adapterConfig", "comboPrefix", String(config.comboPrefix ?? ""))
            }
            onCommit={(v) =>
              isCreate
                ? set!({
                    opencode9RouterComboPrefix: v,
                    opencode9RouterIgnoreGlobalComboPrefix: false,
                  })
                : (() => {
                    setEditIgnoreGlobalComboPrefix(false);
                    mark("adapterConfig", "comboPrefix", v || undefined);
                  })()
            }
            immediate
            className={inputClass}
            placeholder="pc-"
          />
          <ToggleField
            label="Show all combos"
            hint="Persists an explicit per-agent override so this agent ignores NINEROUTER_COMBO_PREFIX and discovers every combo returned by 9Router."
            checked={ignoreGlobalComboPrefix}
            onChange={(checked) => {
              if (isCreate) {
                set!({
                  opencode9RouterIgnoreGlobalComboPrefix: checked,
                  opencode9RouterComboPrefix: checked ? NINEROUTER_ALL_COMBOS_SENTINEL : "",
                });
                return;
              }
              setEditIgnoreGlobalComboPrefix(checked);
              mark("adapterConfig", "comboPrefix", checked ? NINEROUTER_ALL_COMBOS_SENTINEL : undefined);
            }}
          />
        </div>
      </Field>

      <Field
        label="Combo cache TTL (seconds)"
        hint="Discovery cache key includes base URL, API key variable name, and prefix. Use Refresh combos to bypass cache manually."
      >
        <DraftNumberInput
          value={
            isCreate
              ? Number(values!.opencode9RouterModelsCacheTtlSeconds ?? 60)
              : Number(eff("adapterConfig", "modelsCacheTtlSeconds", Number(config.modelsCacheTtlSeconds ?? 60)))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ opencode9RouterModelsCacheTtlSeconds: Number.isFinite(v) ? v : 60 })
              : mark("adapterConfig", "modelsCacheTtlSeconds", Number.isFinite(v) ? v : undefined)
          }
          min={1}
          step={1}
          className={inputClass}
        />
      </Field>

      <ToggleField
        label="Skip permissions"
        hint={help.dangerouslySkipPermissions}
        checked={
          isCreate
            ? values!.dangerouslySkipPermissions
            : eff(
                "adapterConfig",
                "dangerouslySkipPermissions",
                config.dangerouslySkipPermissions !== false,
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ dangerouslySkipPermissions: v })
            : mark("adapterConfig", "dangerouslySkipPermissions", v)
        }
      />
    </>
  );
}
