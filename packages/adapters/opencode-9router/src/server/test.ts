import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";
import { testEnvironment as testOpenCodeEnvironment } from "@paperclipai/adapter-opencode-local/server";
import {
  buildNineRouterEnvironmentFailureResult,
  buildNineRouterRuntimeEnv,
  prependNineRouterChecks,
  prepareNineRouterExecutionConfig,
} from "./config.js";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  try {
    const config = parseObject(ctx.config);
    const prepared = await prepareNineRouterExecutionConfig(config, buildNineRouterRuntimeEnv(config));
    const result = await testOpenCodeEnvironment({
      ...ctx,
      config: prepared.translatedConfig,
    });
    return prependNineRouterChecks(result, prepared);
  } catch (error) {
    return buildNineRouterEnvironmentFailureResult(ctx.adapterType, error);
  }
}
