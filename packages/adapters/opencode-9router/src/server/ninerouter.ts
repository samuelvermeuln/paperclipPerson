import type { AdapterModel } from "@paperclipai/adapter-utils";
import {
  DEFAULT_NINEROUTER_API_KEY_ENV,
  DEFAULT_NINEROUTER_DEFAULT_COMBO,
  DEFAULT_NINEROUTER_MODELS_CACHE_TTL_SECONDS,
  DEFAULT_NINEROUTER_MODELS_TIMEOUT_MS,
  NINEROUTER_ALL_COMBOS_SENTINEL,
} from "../index.js";

export interface NineRouterCombo {
  id: string;
  name: string;
  ownedBy: "combo";
}

export interface NineRouterDiscoveryResult {
  provider: "9router";
  models: AdapterModel[];
  combos: NineRouterCombo[];
  cached: boolean;
  fetchedAt: string;
}

export interface NineRouterResolvedConfig {
  normalizedBaseUrl: string;
  apiKeyEnv: string;
  apiKey: string;
  comboPrefix: string;
  combo: string;
  smallCombo: string | null;
  modelsCacheTtlSeconds: number;
}

export class NineRouterDiscoveryError extends Error {
  code:
    | "base_url_missing"
    | "base_url_invalid"
    | "api_key_env_missing"
    | "unauthorized"
    | "not_found"
    | "unavailable"
    | "timeout"
    | "invalid_response"
    | "no_combos"
    | "http_error";
  status: number;
  retryable: boolean;

  constructor(input: {
    code: NineRouterDiscoveryError["code"];
    message: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "NineRouterDiscoveryError";
    this.code = input.code;
    this.status = input.status ?? 500;
    this.retryable = input.retryable ?? false;
  }
}

type NineRouterModelsApiEntry = {
  id: string;
  object?: string;
  owned_by: string;
};

type NineRouterModelsApiResponse = {
  object?: string;
  data: NineRouterModelsApiEntry[];
};

type DiscoveryCacheEntry = {
  expiresAt: number;
  fetchedAt: string;
  combos: NineRouterCombo[];
};

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readConfigEnv(value: unknown): NodeJS.ProcessEnv {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env: NodeJS.ProcessEnv = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") env[key] = entry;
  }
  return env;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalize9RouterBaseUrl(value: unknown): string {
  const raw = readTrimmedString(value);
  if (!raw) {
    throw new NineRouterDiscoveryError({
      code: "base_url_missing",
      status: 422,
      message: "A variável NINEROUTER_BASE_URL não está configurada no ambiente do Paperclip.",
    });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NineRouterDiscoveryError({
      code: "base_url_invalid",
      status: 422,
      message: "A base URL do 9Router é inválida.",
    });
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments[segments.length - 1] === "models") {
    segments.pop();
  }
  const normalizedSegments = segments[segments.length - 1] === "v1"
    ? segments
    : [...segments, "v1"];
  url.pathname = `/${normalizedSegments.join("/")}`;
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

function buildDiscoveryCacheKey(input: {
  normalizedBaseUrl: string;
  apiKeyEnv: string;
  comboPrefix: string;
}) {
  return `${input.normalizedBaseUrl}\n${input.apiKeyEnv}\n${input.comboPrefix}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parse9RouterModelsResponse(
  value: unknown,
  comboPrefix = "",
): NineRouterCombo[] {
  if (!isPlainObject(value) || !Array.isArray(value.data)) {
    throw new NineRouterDiscoveryError({
      code: "invalid_response",
      message: "O 9Router retornou uma resposta incompatível com o formato OpenAI /v1/models.",
      status: 502,
    });
  }

  const prefix = comboPrefix.trim();
  const seen = new Set<string>();
  const combos: NineRouterCombo[] = [];
  for (const entry of value.data) {
    if (!isPlainObject(entry)) continue;
    const id = readTrimmedString(entry.id);
    const ownedBy = readTrimmedString(entry.owned_by);
    if (!id || ownedBy !== "combo") continue;
    if (prefix && !id.startsWith(prefix)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    combos.push({
      id,
      name: `9Router — ${id}`,
      ownedBy: "combo",
    });
  }

  if (combos.length === 0) {
    throw new NineRouterDiscoveryError({
      code: "no_combos",
      message: "A conexão com o 9Router funcionou, mas nenhum combo foi encontrado.",
      status: 422,
    });
  }

  return combos;
}

function shouldRetryDiscovery(status: number | null, error: unknown): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (error instanceof NineRouterDiscoveryError) return error.retryable;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return false;
}

function retryAfterDelayMs(response: Response | null): number {
  const retryAfter = response?.headers.get("retry-after")?.trim() ?? "";
  if (!retryAfter) return 0;
  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, DEFAULT_NINEROUTER_MODELS_TIMEOUT_MS);
  }
  const dateMs = Number.parseInt(String(Date.parse(retryAfter)), 10);
  if (!Number.isFinite(dateMs)) return 0;
  return Math.max(0, Math.min(dateMs - Date.now(), DEFAULT_NINEROUTER_MODELS_TIMEOUT_MS));
}

function classifyResponseError(response: Response): never {
  if (response.status === 401 || response.status === 403) {
    throw new NineRouterDiscoveryError({
      code: "unauthorized",
      status: response.status,
      message: "O 9Router rejeitou a API key configurada.",
    });
  }
  if (response.status === 404) {
    throw new NineRouterDiscoveryError({
      code: "not_found",
      status: 404,
      message: "O endpoint de modelos do 9Router não foi encontrado. Verifique a base URL e evite duplicar /v1.",
    });
  }
  if (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
    throw new NineRouterDiscoveryError({
      code: response.status === 429 ? "http_error" : "unavailable",
      status: response.status,
      retryable: true,
      message: "O 9Router está temporariamente indisponível.",
    });
  }
  throw new NineRouterDiscoveryError({
    code: "http_error",
    status: response.status,
    message: `O 9Router retornou HTTP ${response.status} ao listar combos.`,
  });
}

async function fetch9RouterCombosUncached(input: {
  normalizedBaseUrl: string;
  apiKey: string;
  comboPrefix: string;
  timeoutMs?: number;
}): Promise<{ combos: NineRouterCombo[]; fetchedAt: string }> {
  const startedAt = Date.now();
  const timeoutMs = readPositiveInteger(input.timeoutMs, DEFAULT_NINEROUTER_MODELS_TIMEOUT_MS);
  const deadline = startedAt + timeoutMs;
  console.info(JSON.stringify({
    service: "9router-model-discovery",
    message: "9Router model discovery started",
    baseUrl: input.normalizedBaseUrl,
    cached: false,
  }));

  let lastError: unknown = null;
  let lastStatus: number | null = null;
  let responseForRetry: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs <= 0) {
      throw new NineRouterDiscoveryError({
        code: "timeout",
        status: 504,
        message: "A consulta aos combos do 9Router excedeu o tempo limite.",
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      const response = await fetch(`${input.normalizedBaseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      responseForRetry = response;
      lastStatus = response.status;
      if (!response.ok) {
        classifyResponseError(response);
      }
      let parsed: NineRouterModelsApiResponse;
      try {
        parsed = await response.json() as NineRouterModelsApiResponse;
      } catch {
        throw new NineRouterDiscoveryError({
          code: "invalid_response",
          status: 502,
          message: "O 9Router retornou uma resposta incompatível com o formato OpenAI /v1/models.",
        });
      }
      const combos = parse9RouterModelsResponse(parsed, input.comboPrefix);
      const fetchedAt = new Date().toISOString();
      console.info(JSON.stringify({
        service: "9router-model-discovery",
        message: "9Router combos discovered",
        baseUrl: input.normalizedBaseUrl,
        comboCount: combos.length,
        cached: false,
        durationMs: Date.now() - startedAt,
        statusCode: response.status,
      }));
      return { combos, fetchedAt };
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") {
        lastStatus = null;
        responseForRetry = null;
        lastError = new NineRouterDiscoveryError({
          code: "timeout",
          status: 504,
          retryable: true,
          message: "A consulta aos combos do 9Router excedeu o tempo limite.",
        });
      }
      if (attempt >= 1 || !shouldRetryDiscovery(lastStatus, lastError)) {
        throw lastError;
      }
      const waitMs = Math.min(retryAfterDelayMs(responseForRetry), Math.max(0, deadline - Date.now()));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new NineRouterDiscoveryError({
        code: "http_error",
        message: "Falha ao consultar combos do 9Router.",
      });
}

export function resolve9RouterConfig(
  config: Record<string, unknown>,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): NineRouterResolvedConfig {
  const effectiveRuntimeEnv = {
    ...runtimeEnv,
    ...readConfigEnv(config.env),
  };
  const apiKeyEnv = readTrimmedString(config.apiKeyEnv) || DEFAULT_NINEROUTER_API_KEY_ENV;
  const apiKey = readTrimmedString(effectiveRuntimeEnv[apiKeyEnv]);
  if (!apiKey) {
    throw new NineRouterDiscoveryError({
      code: "api_key_env_missing",
      status: 422,
      message: `A variável ${apiKeyEnv} não está configurada no ambiente do Paperclip.`,
    });
  }

  const normalizedBaseUrl = normalize9RouterBaseUrl(
    readTrimmedString(config.baseUrl) || effectiveRuntimeEnv.NINEROUTER_BASE_URL,
  );
  const comboPrefixRaw = hasOwnKey(config, "comboPrefix")
    ? readTrimmedString(config.comboPrefix)
    : readTrimmedString(effectiveRuntimeEnv.NINEROUTER_COMBO_PREFIX);
  const comboPrefix = comboPrefixRaw === NINEROUTER_ALL_COMBOS_SENTINEL ? "" : comboPrefixRaw;
  const combo = readTrimmedString(config.combo) || readTrimmedString(effectiveRuntimeEnv.NINEROUTER_DEFAULT_COMBO) || DEFAULT_NINEROUTER_DEFAULT_COMBO;
  const smallCombo = hasOwnKey(config, "smallCombo")
    ? (typeof config.smallCombo === "string" ? config.smallCombo.trim() : "")
    : (readTrimmedString(effectiveRuntimeEnv.NINEROUTER_SMALL_COMBO) || null);
  const modelsCacheTtlSeconds = readPositiveInteger(
    config.modelsCacheTtlSeconds ?? effectiveRuntimeEnv.NINEROUTER_MODELS_CACHE_TTL_SECONDS,
    DEFAULT_NINEROUTER_MODELS_CACHE_TTL_SECONDS,
  );

  return {
    normalizedBaseUrl,
    apiKeyEnv,
    apiKey,
    comboPrefix,
    combo,
    smallCombo,
    modelsCacheTtlSeconds,
  };
}

function prioritizeCombos(combos: NineRouterCombo[], preferredId: string): NineRouterCombo[] {
  const ordered = [...combos];
  const preferred = preferredId.trim();
  const preferredIndex = preferred ? ordered.findIndex((entry) => entry.id === preferred) : -1;
  if (preferredIndex > 0) {
    const [entry] = ordered.splice(preferredIndex, 1);
    ordered.unshift(entry);
    return ordered;
  }
  if (preferredIndex === 0) return ordered;
  const autoIndex = ordered.findIndex((entry) => entry.id === DEFAULT_NINEROUTER_DEFAULT_COMBO);
  if (autoIndex > 0) {
    const [entry] = ordered.splice(autoIndex, 1);
    ordered.unshift(entry);
  }
  return ordered;
}

export async function discover9RouterCombos(input: {
  baseUrl: string;
  apiKeyEnv: string;
  apiKey: string;
  comboPrefix?: string;
  forceRefresh?: boolean;
  cacheTtlSeconds?: number;
  timeoutMs?: number;
  preferredCombo?: string;
}): Promise<NineRouterDiscoveryResult> {
  const normalizedBaseUrl = normalize9RouterBaseUrl(input.baseUrl);
  const comboPrefix = readTrimmedString(input.comboPrefix);
  const cacheKey = buildDiscoveryCacheKey({
    normalizedBaseUrl,
    apiKeyEnv: input.apiKeyEnv,
    comboPrefix,
  });
  const cacheTtlSeconds = readPositiveInteger(
    input.cacheTtlSeconds,
    DEFAULT_NINEROUTER_MODELS_CACHE_TTL_SECONDS,
  );
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = !input.forceRefresh ? discoveryCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > now) {
    const combos = prioritizeCombos(cached.combos, readTrimmedString(input.preferredCombo));
    console.info(JSON.stringify({
      service: "9router-model-discovery",
      message: "9Router combos loaded from cache",
      baseUrl: normalizedBaseUrl,
      comboCount: combos.length,
      cached: true,
      durationMs: 0,
    }));
    return {
      provider: "9router",
      combos,
      models: combos.map((combo) => ({ id: combo.id, label: combo.name })),
      cached: true,
      fetchedAt: cached.fetchedAt,
    };
  }

  const fetched = await fetch9RouterCombosUncached({
    normalizedBaseUrl,
    apiKey: input.apiKey,
    comboPrefix,
    timeoutMs: input.timeoutMs,
  });
  discoveryCache.set(cacheKey, {
    combos: fetched.combos,
    fetchedAt: fetched.fetchedAt,
    expiresAt: now + cacheTtlSeconds * 1000,
  });
  const combos = prioritizeCombos(fetched.combos, readTrimmedString(input.preferredCombo));
  return {
    provider: "9router",
    combos,
    models: combos.map((combo) => ({ id: combo.id, label: combo.name })),
    cached: false,
    fetchedAt: fetched.fetchedAt,
  };
}

export async function validateDiscoveredCombo(input: {
  config: NineRouterResolvedConfig;
  desiredCombo: string;
  forceRefreshOnMiss?: boolean;
}): Promise<{ combo: string; discovery: NineRouterDiscoveryResult }> {
  console.info(JSON.stringify({
    service: "9router-combo-validation",
    message: "9Router combo validation started",
    baseUrl: input.config.normalizedBaseUrl,
    combo: input.desiredCombo,
  }));
  const first = await discover9RouterCombos({
    baseUrl: input.config.normalizedBaseUrl,
    apiKeyEnv: input.config.apiKeyEnv,
    apiKey: input.config.apiKey,
    comboPrefix: input.config.comboPrefix,
    cacheTtlSeconds: input.config.modelsCacheTtlSeconds,
    preferredCombo: input.desiredCombo,
  });
  if (first.combos.some((entry) => entry.id === input.desiredCombo)) {
    return { combo: input.desiredCombo, discovery: first };
  }
  if (input.forceRefreshOnMiss === false) {
    throw new Error(buildMissingComboMessage(input.desiredCombo, first.combos));
  }
  const second = await discover9RouterCombos({
    baseUrl: input.config.normalizedBaseUrl,
    apiKeyEnv: input.config.apiKeyEnv,
    apiKey: input.config.apiKey,
    comboPrefix: input.config.comboPrefix,
    cacheTtlSeconds: input.config.modelsCacheTtlSeconds,
    preferredCombo: input.desiredCombo,
    forceRefresh: true,
  });
  if (second.combos.some((entry) => entry.id === input.desiredCombo)) {
    return { combo: input.desiredCombo, discovery: second };
  }
  throw new Error(buildMissingComboMessage(input.desiredCombo, second.combos));
}

export function buildMissingComboMessage(combo: string, combos: readonly NineRouterCombo[]): string {
  const list = combos.map((entry) => entry.id).join(", ");
  return [
    `O combo "${combo}" não foi encontrado no 9Router.`,
    "",
    "Verifique se:",
    "- o combo ainda existe;",
    "- a API key possui acesso;",
    "- o endpoint /v1/models está disponível;",
    "- o Paperclip está conectado à instância correta.",
    "",
    `Combos disponíveis: ${list || "nenhum"}.`,
  ].join("\n");
}

export function resolvePrimaryCombo(config: NineRouterResolvedConfig, discovery: NineRouterDiscoveryResult): string {
  const preferred = readTrimmedString(config.combo);
  if (preferred && discovery.combos.some((entry) => entry.id === preferred)) return preferred;
  if (discovery.combos.some((entry) => entry.id === DEFAULT_NINEROUTER_DEFAULT_COMBO)) {
    return DEFAULT_NINEROUTER_DEFAULT_COMBO;
  }
  return discovery.combos[0]?.id ?? preferred;
}

export function resolveSmallCombo(config: NineRouterResolvedConfig, discovery: NineRouterDiscoveryResult, primaryCombo: string): string {
  const preferred = readTrimmedString(config.smallCombo);
  if (!preferred) return primaryCombo;
  if (discovery.combos.some((entry) => entry.id === preferred)) return preferred;
  throw new Error(buildMissingComboMessage(preferred, discovery.combos));
}

export function reset9RouterModelsCacheForTests() {
  discoveryCache.clear();
}
