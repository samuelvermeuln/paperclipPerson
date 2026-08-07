import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
} from "@paperclipai/adapter-utils";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";
import { OPENCODE_NINEROUTER_PROVIDER_ID } from "../index.js";
import {
  buildMissingComboMessage,
  discover9RouterCombos,
  resolve9RouterConfig,
  resolvePrimaryCombo,
  resolveSmallCombo,
  validateDiscoveredCombo,
  type NineRouterDiscoveryError,
  type NineRouterDiscoveryResult,
  type NineRouterResolvedConfig,
} from "./ninerouter.js";

function readEnvObject(value: unknown): Record<string, string> {
  const env = parseObject(value);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(env)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

export interface PreparedNineRouterExecutionConfig {
  resolved: NineRouterResolvedConfig;
  discovery: NineRouterDiscoveryResult;
  primaryCombo: string;
  smallCombo: string;
  translatedConfig: Record<string, unknown>;
}

export function buildNineRouterRuntimeEnv(
  config: Record<string, unknown>,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...runtimeEnv,
    ...readEnvObject(config.env),
  };
}

export async function applyNineRouterAgentConfigDefaults(
  config: Record<string, unknown>,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const explicitCombo = typeof config.combo === "string" ? config.combo.trim() : "";
  if (explicitCombo) return config;

  const resolved = resolve9RouterConfig(config, buildNineRouterRuntimeEnv(config, runtimeEnv));
  const discovery = await discover9RouterCombos({
    baseUrl: resolved.normalizedBaseUrl,
    apiKeyEnv: resolved.apiKeyEnv,
    apiKey: resolved.apiKey,
    comboPrefix: resolved.comboPrefix,
    cacheTtlSeconds: resolved.modelsCacheTtlSeconds,
    preferredCombo: resolved.combo,
  });
  const primaryCombo = resolvePrimaryCombo(resolved, discovery);
  return primaryCombo ? { ...config, combo: primaryCombo } : config;
}

export async function prepareNineRouterExecutionConfig(
  config: Record<string, unknown>,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): Promise<PreparedNineRouterExecutionConfig> {
  const resolved = resolve9RouterConfig(config, buildNineRouterRuntimeEnv(config, runtimeEnv));
  const explicitCombo = typeof config.combo === "string" ? config.combo.trim() : "";
  const explicitSmallCombo = typeof config.smallCombo === "string" ? config.smallCombo.trim() : "";
  let discovery = await discover9RouterCombos({
    baseUrl: resolved.normalizedBaseUrl,
    apiKeyEnv: resolved.apiKeyEnv,
    apiKey: resolved.apiKey,
    comboPrefix: resolved.comboPrefix,
    cacheTtlSeconds: resolved.modelsCacheTtlSeconds,
    preferredCombo: explicitCombo || resolved.combo,
  });
  let primaryCombo = resolvePrimaryCombo(resolved, discovery);
  if (explicitCombo) {
    const validated = await validateDiscoveredCombo({
      config: resolved,
      desiredCombo: explicitCombo,
    });
    discovery = validated.discovery;
    primaryCombo = validated.combo;
  }
  if (!discovery.combos.some((entry) => entry.id === primaryCombo)) {
    throw new Error(buildMissingComboMessage(primaryCombo, discovery.combos));
  }
  let smallCombo = explicitSmallCombo || resolveSmallCombo(resolved, discovery, primaryCombo);
  if (explicitSmallCombo) {
    const validatedSmall = await validateDiscoveredCombo({
      config: resolved,
      desiredCombo: explicitSmallCombo,
    });
    discovery = validatedSmall.discovery;
    smallCombo = validatedSmall.combo;
  }
  if (!discovery.combos.some((entry) => entry.id === primaryCombo)) {
    throw new Error(buildMissingComboMessage(primaryCombo, discovery.combos));
  }
  const translatedConfig = buildNineRouterOpenCodeConfig({
    originalConfig: config,
    resolved,
    discovery,
    primaryCombo,
    smallCombo,
  });
  return {
    resolved,
    discovery,
    primaryCombo,
    smallCombo,
    translatedConfig,
  };
}

export function buildNineRouterOpenCodeConfig(input: {
  originalConfig: Record<string, unknown>;
  resolved: NineRouterResolvedConfig;
  discovery: NineRouterDiscoveryResult;
  primaryCombo: string;
  smallCombo: string;
}): Record<string, unknown> {
  const existingEnv = readEnvObject(input.originalConfig.env);
  const runtimeEnv = {
    ...existingEnv,
    [input.resolved.apiKeyEnv]: input.resolved.apiKey,
  };
  const comboIds = input.discovery.combos.map((entry) => entry.id);
  console.info(JSON.stringify({
    service: "9router-runtime-config",
    message: "9Router temporary OpenCode config created",
    baseUrl: input.resolved.normalizedBaseUrl,
    combo: input.primaryCombo,
    comboCount: comboIds.length,
  }));
  return {
    ...input.originalConfig,
    env: runtimeEnv,
    model: `${OPENCODE_NINEROUTER_PROVIDER_ID}/${input.primaryCombo}`,
    paperclipNineRouter: {
      baseUrl: input.resolved.normalizedBaseUrl,
      apiKeyEnv: input.resolved.apiKeyEnv,
      combos: comboIds,
      smallCombo: input.smallCombo,
    },
  };
}

export function prependNineRouterChecks(
  result: AdapterEnvironmentTestResult,
  input: {
    resolved: NineRouterResolvedConfig;
    discovery: NineRouterDiscoveryResult;
    primaryCombo: string;
    smallCombo: string;
  },
): AdapterEnvironmentTestResult {
  const checks: AdapterEnvironmentCheck[] = [
    {
      code: "ninerouter_base_url_valid",
      level: "info",
      message: `9Router base URL is valid: ${input.resolved.normalizedBaseUrl}`,
    },
    {
      code: "ninerouter_api_key_configured",
      level: "info",
      message: `API key environment is configured: ${input.resolved.apiKeyEnv}`,
    },
    {
      code: "ninerouter_combos_discovered",
      level: "info",
      message: `Found ${input.discovery.combos.length} combo(s) in 9Router.`,
    },
    {
      code: "ninerouter_primary_combo_selected",
      level: "info",
      message: `Selected combo: ${input.primaryCombo}`,
    },
    {
      code: "ninerouter_small_combo_selected",
      level: "info",
      message: `Selected auxiliary combo: ${input.smallCombo}`,
    },
    {
      code: "ninerouter_runtime_config_created",
      level: "info",
      message: "Temporary OpenCode runtime config was created successfully.",
    },
  ];
  return {
    ...result,
    checks: [...checks, ...result.checks],
  };
}

export function translateNineRouterExecutionContext(
  ctx: AdapterExecutionContext,
  translatedConfig: Record<string, unknown>,
): AdapterExecutionContext {
  return {
    ...ctx,
    config: translatedConfig,
  };
}

export function buildNineRouterEnvironmentFailureResult(
  adapterType: string,
  error: unknown,
): AdapterEnvironmentTestResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = isNineRouterDiscoveryError(error)
    ? `ninerouter_${error.code}`
    : "ninerouter_probe_failed";
  return {
    adapterType,
    status: "fail",
    testedAt: new Date().toISOString(),
    checks: [
      {
        code,
        level: "error",
        message,
      },
    ],
  };
}

export function isNineRouterDiscoveryError(error: unknown): error is NineRouterDiscoveryError {
  return error instanceof Error && error.name === "NineRouterDiscoveryError";
}
