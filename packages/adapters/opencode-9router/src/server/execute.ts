import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { execute as executeOpenCode } from "@paperclipai/adapter-opencode-local/server";
import { buildNineRouterRuntimeEnv, prepareNineRouterExecutionConfig, translateNineRouterExecutionContext } from "./config.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const prepared = await prepareNineRouterExecutionConfig(ctx.config, buildNineRouterRuntimeEnv(ctx.config));
  console.info(JSON.stringify({
    service: "9router-opencode-execution",
    message: "OpenCode execution started with 9Router combo",
    baseUrl: prepared.resolved.normalizedBaseUrl,
    combo: prepared.primaryCombo,
    comboCount: prepared.discovery.combos.length,
  }));
  await ctx.onLog(
    "stdout",
    `[paperclip] OpenCode execution started with 9Router combo ${prepared.primaryCombo}.\n`,
  );
  const translatedContext = translateNineRouterExecutionContext(ctx, prepared.translatedConfig);
  return executeOpenCode({
    ...translatedContext,
    onMeta: ctx.onMeta
      ? async (meta) => {
          const sanitizedEnv = meta.env && typeof meta.env === "object"
            ? {
                ...meta.env,
                [prepared.resolved.apiKeyEnv]: "[REDACTED]",
              }
            : meta.env;
          await ctx.onMeta?.({
            ...meta,
            adapterType: "opencode_9router",
            env: sanitizedEnv,
          });
        }
      : undefined,
  });
}
