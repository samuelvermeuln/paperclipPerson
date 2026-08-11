import { describe, expect, it } from "vitest";
import { buildOpenCodeLocalConfig } from "./build-config.js";

describe("buildOpenCodeLocalConfig", () => {
  it("defaults new OpenCode agents to a conservative 12-hour hard cap", () => {
    expect(buildOpenCodeLocalConfig({ envVars: "" } as never)).toMatchObject({
      timeoutSec: 12 * 60 * 60,
      graceSec: 20,
    });
  });
});
