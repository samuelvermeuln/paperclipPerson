import { createHash } from "node:crypto";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { execute as executeOpenCode } from "@paperclipai/adapter-opencode-local/server";
import {
  buildNineRouterRuntimeEnv,
  prepareNineRouterExecutionConfig,
  translateNineRouterExecutionContext,
} from "./config.js";
import {
  compute9RouterComboCapacity,
  NineRouterDiscoveryError,
  type NineRouterComboCapacity,
} from "./ninerouter.js";

function estimateTokens(characters: number) {
  return Math.max(0, Math.ceil(characters / 4));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildPromptDiagnostics(prompt: string, promptMetrics: Record<string, number> | undefined, combo: string) {
  const sections = [
    { name: "instructions", characters: promptMetrics?.instructionsChars ?? 0 },
    { name: "bootstrap", characters: promptMetrics?.bootstrapPromptChars ?? 0 },
    { name: "wake", characters: promptMetrics?.wakePromptChars ?? 0 },
    { name: "sessionHandoff", characters: promptMetrics?.sessionHandoffChars ?? 0 },
    { name: "task", characters: promptMetrics?.heartbeatPromptChars ?? 0 },
  ]
    .map((entry) => ({
      ...entry,
      estimatedTokens: estimateTokens(entry.characters),
    }))
    .filter((entry) => entry.characters > 0);
  return {
    provider: "9router",
    combo,
    totalCharacters: prompt.length,
    estimatedInputTokens: estimateTokens(prompt.length),
    promptHash: hashText(prompt),
    sections,
  };
}

function isQuotaLikeFailure(result: AdapterExecutionResult) {
  const errorText = [result.errorCode ?? "", result.errorFamily ?? "", result.errorMessage ?? "", JSON.stringify(result.resultJson ?? {})]
    .join("\n");
  return /quota|usage limit|rate limit|capacity|429|temporarily unavailable|resource exhausted/i.test(errorText);
}

function buildProviderQuotaResult(input: {
  combo: string;
  capacity: NineRouterComboCapacity;
  cause: "preflight" | "runtime_confirmation";
  baseResult?: AdapterExecutionResult | null;
}): AdapterExecutionResult {
  const retryNotBefore = input.capacity.retryAt;
  const connections = input.capacity.connections.map((connection) => ({
    connectionId: connection.connectionId,
    provider: connection.provider,
    available: connection.available,
    exhausted: connection.exhausted,
    resetAt: connection.resetAt,
    reason: connection.reason,
  }));
  return {
    exitCode: input.baseResult?.exitCode ?? 1,
    signal: input.baseResult?.signal ?? null,
    timedOut: false,
    errorMessage:
      input.cause === "preflight"
        ? `9Router combo ${input.combo} has no available capacity; retry after quota reset.`
        : (input.baseResult?.errorMessage ?? `9Router combo ${input.combo} exhausted all eligible providers during execution.`),
    errorCode: "provider_quota",
    errorFamily: "provider_quota",
    retryNotBefore,
    usage: input.baseResult?.usage,
    usageBasis: input.baseResult?.usageBasis,
    sessionId: input.baseResult?.sessionId ?? null,
    sessionParams: input.baseResult?.sessionParams ?? null,
    sessionDisplayId: input.baseResult?.sessionDisplayId ?? null,
    provider: "9router",
    biller: input.baseResult?.biller ?? "9router",
    model: input.baseResult?.model ?? `9router/${input.combo}`,
    billingType: input.baseResult?.billingType ?? "unknown",
    costUsd: input.baseResult?.costUsd ?? null,
    cacheAdjustedCostUsd: input.baseResult?.cacheAdjustedCostUsd ?? null,
    summary: input.baseResult?.summary ?? null,
    clearSession: input.baseResult?.clearSession ?? false,
    resultJson: {
      ...((input.baseResult?.resultJson as Record<string, unknown> | null) ?? {}),
      errorFamily: "provider_quota",
      retryNotBefore,
      transientRetryNotBefore: retryNotBefore,
      providerQuotaRetryNotBefore: retryNotBefore,
      nineRouterQuota: {
        cause: input.cause,
        combo: input.combo,
        retryAt: input.capacity.retryAt,
        connections,
      },
    },
    errorMeta: {
      cause: input.cause,
      combo: input.combo,
      retryAt: input.capacity.retryAt,
      connections,
    },
  };
}

async function confirmNineRouterCapacity(prepared: Awaited<ReturnType<typeof prepareNineRouterExecutionConfig>>) {
  return await compute9RouterComboCapacity({
    managementBaseUrl: prepared.resolved.managementBaseUrl,
    apiKey: prepared.resolved.apiKey,
    combo: prepared.primaryCombo,
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const prepared = await prepareNineRouterExecutionConfig(ctx.config, buildNineRouterRuntimeEnv(ctx.config));
  const capacity = await confirmNineRouterCapacity(prepared);
  if (!capacity.available) {
    await ctx.onLog(
      "stdout",
      `[paperclip] 9Router combo ${prepared.primaryCombo} has no available capacity. Waiting until ${capacity.retryAt ?? "quota reset"}.\n`,
    );
    return buildProviderQuotaResult({
      combo: prepared.primaryCombo,
      capacity,
      cause: "preflight",
    });
  }

  console.info(JSON.stringify({
    service: "9router-opencode-execution",
    message: "OpenCode execution started with 9Router combo",
    baseUrl: prepared.resolved.normalizedBaseUrl,
    managementBaseUrl: prepared.resolved.managementBaseUrl,
    combo: prepared.primaryCombo,
    comboCount: prepared.discovery.combos.length,
  }));
  await ctx.onLog(
    "stdout",
    `[paperclip] OpenCode execution started with 9Router combo ${prepared.primaryCombo}.\n`,
  );
  const translatedContext = translateNineRouterExecutionContext(ctx, prepared.translatedConfig);
  const wrappedResult = await executeOpenCode({
    ...translatedContext,
    onMeta: ctx.onMeta
      ? async (meta) => {
          const sanitizedEnv = meta.env && typeof meta.env === "object"
            ? {
                ...meta.env,
                [prepared.resolved.apiKeyEnv]: "[REDACTED]",
              }
            : meta.env;
          const prompt = typeof meta.prompt === "string" ? meta.prompt : "";
          const promptDiagnostics = buildPromptDiagnostics(prompt, meta.promptMetrics, prepared.primaryCombo);
          await ctx.onMeta?.({
            ...meta,
            adapterType: "opencode_9router",
            env: sanitizedEnv,
            promptDiagnostics: {
              ...promptDiagnostics,
              nineRouter: {
                combo: prepared.primaryCombo,
                baseUrl: prepared.resolved.normalizedBaseUrl,
                managementBaseUrl: prepared.resolved.managementBaseUrl,
              },
            },
          });
        }
      : undefined,
  });

  if (!wrappedResult.timedOut && (wrappedResult.exitCode ?? 0) !== 0 && isQuotaLikeFailure(wrappedResult)) {
    try {
      const confirmedCapacity = await confirmNineRouterCapacity(prepared);
      if (!confirmedCapacity.available) {
        return buildProviderQuotaResult({
          combo: prepared.primaryCombo,
          capacity: confirmedCapacity,
          cause: "runtime_confirmation",
          baseResult: wrappedResult,
        });
      }
    } catch (error) {
      if (!(error instanceof NineRouterDiscoveryError)) throw error;
    }
  }

  return wrappedResult;
}
