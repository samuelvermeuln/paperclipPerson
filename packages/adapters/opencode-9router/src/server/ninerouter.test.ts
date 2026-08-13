import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyNineRouterAgentConfigDefaults,
  buildNineRouterOpenCodeConfig,
  prepareNineRouterExecutionConfig,
} from "./config.js";
import {
  discover9RouterCombos,
  NineRouterDiscoveryError,
  normalize9RouterBaseUrl,
  parse9RouterModelsResponse,
  reset9RouterModelsCacheForTests,
  resolve9RouterConfig,
} from "./ninerouter.js";

describe("opencode_9router discovery helpers", () => {
  beforeEach(() => {
    reset9RouterModelsCacheForTests();
    vi.restoreAllMocks();
    delete process.env.NINEROUTER_BASE_URL;
    delete process.env.NINEROUTER_API_KEY;
    delete process.env.NINEROUTER_DEFAULT_COMBO;
    delete process.env.NINEROUTER_SMALL_COMBO;
    delete process.env.NINEROUTER_MODELS_CACHE_TTL_SECONDS;
    delete process.env.NINEROUTER_COMBO_PREFIX;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes base URLs without /v1", () => {
    expect(normalize9RouterBaseUrl("http://9router:20128")).toBe("http://9router:20128/v1");
  });

  it("normalizes base URLs with /v1 and strips trailing slash", () => {
    expect(normalize9RouterBaseUrl("http://9router:20128/v1/")).toBe("http://9router:20128/v1");
  });

  it("strips a pasted /models endpoint back to /v1", () => {
    expect(normalize9RouterBaseUrl("https://router.example.com/v1/models")).toBe("https://router.example.com/v1");
  });

  it("strips embedded credentials from normalized base URLs", () => {
    expect(normalize9RouterBaseUrl("https://user:pass@router.example.com/v1")).toBe("https://router.example.com/v1");
  });

  it("prevents duplicated /v1 segments", () => {
    expect(normalize9RouterBaseUrl("https://router.example.com/v1")).toBe("https://router.example.com/v1");
  });

  it("parses only combo-owned models and preserves original ids", () => {
    expect(parse9RouterModelsResponse({
      object: "list",
      data: [
        { id: "auto", owned_by: "combo" },
        { id: "combo/dev", owned_by: "combo" },
        { id: "openai/gpt-5", owned_by: "openai" },
      ],
    })).toEqual([
      { id: "auto", name: "9Router — auto", ownedBy: "combo" },
      { id: "combo/dev", name: "9Router — combo/dev", ownedBy: "combo" },
    ]);
  });

  it("keeps API order when no preferred combo or auto fallback is available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        data: [
          { id: "review", owned_by: "combo" },
          { id: "research", owned_by: "combo" },
        ],
      }),
    } as unknown as Response);

    const result = await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    });

    expect(result.models.map((entry) => entry.id)).toEqual(["review", "research"]);
  });

  it("supports optional prefix filtering", () => {
    expect(parse9RouterModelsResponse({
      data: [
        { id: "pc-auto", owned_by: "combo" },
        { id: "pc-dev", owned_by: "combo" },
        { id: "dev", owned_by: "combo" },
      ],
    }, "pc-")).toEqual([
      { id: "pc-auto", name: "9Router — pc-auto", ownedBy: "combo" },
      { id: "pc-dev", name: "9Router — pc-dev", ownedBy: "combo" },
    ]);
  });

  it("errors when the API key env var is missing", () => {
    process.env.NINEROUTER_BASE_URL = "http://9router:20128/v1";
    expect(() => resolve9RouterConfig({}, process.env)).toThrow(
      "A variável NINEROUTER_API_KEY não está configurada no ambiente do Paperclip.",
    );
  });

  it("falls back to env defaults but preserves explicit empty overrides", () => {
    process.env.NINEROUTER_BASE_URL = "http://9router:20128/v1";
    process.env.NINEROUTER_API_KEY = "secret";
    process.env.NINEROUTER_COMBO_PREFIX = "pc-";
    process.env.NINEROUTER_SMALL_COMBO = "auto";

    const inherited = resolve9RouterConfig({}, process.env);
    expect(inherited.comboPrefix).toBe("pc-");
    expect(inherited.smallCombo).toBe("auto");

    const cleared = resolve9RouterConfig({ comboPrefix: "", smallCombo: "" }, process.env);
    expect(cleared.comboPrefix).toBe("");
    expect(cleared.smallCombo).toBe("");
  });

  it("maps 401 and 403 responses to authorization errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() } as unknown as Response);

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    })).rejects.toMatchObject({
      message: "O 9Router rejeitou a API key configurada.",
      status: 401,
    });

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      forceRefresh: true,
    })).rejects.toMatchObject({
      message: "O 9Router rejeitou a API key configurada.",
      status: 403,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("maps 404 to duplicated-v1 guidance", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    } as unknown as Response);

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    })).rejects.toMatchObject({
      message: "O endpoint de modelos do 9Router não foi encontrado. Verifique a base URL e evite duplicar /v1.",
      status: 404,
    });
  });

  it("retries 429 and eventually succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "0" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "dev", owned_by: "combo" }] }),
      } as unknown as Response);

    const result = await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.models).toEqual([{ id: "dev", label: "9Router — dev" }]);
  });

  it("retries 503 and eventually succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "auto", owned_by: "combo" }] }),
      } as unknown as Response);

    const result = await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      forceRefresh: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.models[0]?.id).toBe("auto");
  });

  it("surfaces timeouts with a specific message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    })).rejects.toMatchObject({
      message: "A consulta aos combos do 9Router excedeu o tempo limite.",
    });
  });

  it("surfaces invalid JSON and missing data as invalid responses", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => {
          throw new Error("bad json");
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ object: "list" }),
      } as unknown as Response);

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    })).rejects.toMatchObject({ code: "invalid_response" });

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      forceRefresh: true,
    })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("fails when no combos are found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ id: "openai/gpt-5", owned_by: "openai" }] }),
    } as unknown as Response);

    await expect(discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    })).rejects.toMatchObject({ code: "no_combos" });
  });

  it("uses cache until ttl expires and supports force refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T19:00:00.000Z"));
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "auto", owned_by: "combo" }] }),
      } as unknown as Response);

    await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      cacheTtlSeconds: 60,
    });
    await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      cacheTtlSeconds: 60,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-08-04T19:01:01.000Z"));
    await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      cacheTtlSeconds: 60,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      forceRefresh: true,
      cacheTtlSeconds: 60,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("invalidates cache when base URL or apiKeyEnv changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ id: "auto", owned_by: "combo" }] }),
    } as unknown as Response);

    await discover9RouterCombos({
      baseUrl: "http://router-a:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    });
    await discover9RouterCombos({
      baseUrl: "http://router-b:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    });
    await discover9RouterCombos({
      baseUrl: "http://router-b:20128/v1",
      apiKeyEnv: "OTHER_KEY",
      apiKey: "secret",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("persists a discovered default combo when config does not set one", async () => {
    process.env.NINEROUTER_BASE_URL = "http://9router:20128/v1";
    process.env.NINEROUTER_API_KEY = "secret";
    process.env.NINEROUTER_DEFAULT_COMBO = "dev";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ id: "auto", owned_by: "combo" }, { id: "dev", owned_by: "combo" }] }),
    } as unknown as Response);

    await expect(applyNineRouterAgentConfigDefaults({ command: "opencode" })).resolves.toMatchObject({
      command: "opencode",
      combo: "dev",
    });
  });

  it("builds dynamic OpenCode provider config with combo map and small combo", () => {
    const translated = buildNineRouterOpenCodeConfig({
      originalConfig: { command: "opencode" },
      resolved: {
        normalizedBaseUrl: "http://9router:20128/v1",
        managementBaseUrl: "http://9router:20128",
        apiKeyEnv: "NINEROUTER_API_KEY",
        apiKey: "secret",
        comboPrefix: "",
        combo: "dev",
        smallCombo: "auto",
        modelsCacheTtlSeconds: 60,
      },
      discovery: {
        provider: "9router",
        cached: false,
        fetchedAt: "2026-08-04T19:00:00.000Z",
        combos: [
          { id: "auto", name: "9Router — auto", ownedBy: "combo" },
          { id: "combo/dev", name: "9Router — combo/dev", ownedBy: "combo" },
        ],
        models: [
          { id: "auto", label: "9Router — auto" },
          { id: "combo/dev", label: "9Router — combo/dev" },
        ],
      },
      primaryCombo: "combo/dev",
      smallCombo: "auto",
    });

    expect(translated.model).toBe("9router/combo/dev");
    expect(translated.paperclipNineRouter).toEqual({
      baseUrl: "http://9router:20128/v1",
      managementBaseUrl: "http://9router:20128",
      apiKeyEnv: "NINEROUTER_API_KEY",
      combos: ["auto", "combo/dev"],
      smallCombo: "auto",
    });
    expect((translated.env as Record<string, string>).NINEROUTER_API_KEY).toBe("secret");
  });

  it("derives management base URLs without losing path prefixes", () => {
    const resolved = resolve9RouterConfig({
      baseUrl: "https://router.example.com/ninerouter/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
    }, {
      NINEROUTER_API_KEY: "secret",
    });

    expect(resolved.normalizedBaseUrl).toBe("https://router.example.com/ninerouter/v1");
    expect(resolved.managementBaseUrl).toBe("https://router.example.com/ninerouter");
  });

  it("does not print the API key in discovery logs", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ id: "auto", owned_by: "combo" }] }),
    } as unknown as Response);

    await discover9RouterCombos({
      baseUrl: "http://9router:20128/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "super-secret-value",
    });

    expect(infoSpy.mock.calls.join("\n")).not.toContain("super-secret-value");
  });

  it("fails clearly when a saved combo disappears after refresh", async () => {
    process.env.NINEROUTER_BASE_URL = "http://9router:20128/v1";
    process.env.NINEROUTER_API_KEY = "secret";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "review", owned_by: "combo" }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "review", owned_by: "combo" }] }),
      } as unknown as Response);

    await expect(prepareNineRouterExecutionConfig({ combo: "dev" })).rejects.toThrow(
      'O combo "dev" não foi encontrado no 9Router.',
    );
  });

  it("rechecks the primary combo after small-combo refresh replaces discovery", async () => {
    process.env.NINEROUTER_BASE_URL = "http://9router:20128/v1";
    process.env.NINEROUTER_API_KEY = "secret";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "dev", owned_by: "combo" }, { id: "auto", owned_by: "combo" }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ id: "research", owned_by: "combo" }] }),
      } as unknown as Response);

    await expect(prepareNineRouterExecutionConfig({ combo: "dev", smallCombo: "research" })).rejects.toThrow(
      'O combo "dev" não foi encontrado no 9Router.',
    );
  });
});

describe("opencode_9router integration refresh", () => {
  let server: http.Server | null = null;
  let baseUrl = "";
  let models = [{ id: "auto", owned_by: "combo" }, { id: "dev", owned_by: "combo" }];

  beforeEach(async () => {
    vi.restoreAllMocks();
    reset9RouterModelsCacheForTests();
    delete process.env.NINEROUTER_COMBO_PREFIX;
    delete process.env.NINEROUTER_DEFAULT_COMBO;
    models = [{ id: "auto", owned_by: "combo" }, { id: "dev", owned_by: "combo" }];
    server = http.createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ object: "list", data: models }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterEach(async () => {
    reset9RouterModelsCacheForTests();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it("discovers new combos after a force refresh without env changes or restart", async () => {
    const first = await discover9RouterCombos({
      baseUrl,
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
    });
    expect(first.models.map((entry) => entry.id)).toEqual(["auto", "dev"]);

    models = [
      { id: "auto", owned_by: "combo" },
      { id: "dev", owned_by: "combo" },
      { id: "research", owned_by: "combo" },
      { id: "openai/gpt-test", owned_by: "openai" },
    ];

    const refreshed = await discover9RouterCombos({
      baseUrl,
      apiKeyEnv: "NINEROUTER_API_KEY",
      apiKey: "secret",
      forceRefresh: true,
    });

    expect(refreshed.models.map((entry) => entry.id)).toEqual(["auto", "dev", "research"]);
  });
});
