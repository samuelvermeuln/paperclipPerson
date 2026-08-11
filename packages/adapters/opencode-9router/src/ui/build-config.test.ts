import { describe, expect, it } from "vitest";
import { buildOpenCode9RouterConfig } from "./build-config.js";

describe("buildOpenCode9RouterConfig", () => {
  it("defaults new 9Router OpenCode agents to a conservative 12-hour hard cap", () => {
    expect(buildOpenCode9RouterConfig({ envVars: "" } as never)).toMatchObject({
      timeoutSec: 12 * 60 * 60,
      graceSec: 20,
    });
  });
});
