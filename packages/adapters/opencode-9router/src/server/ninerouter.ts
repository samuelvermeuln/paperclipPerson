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

export interface NineRouterManagementRequestLogEntry {
  id: string | null;
  provider: string | null;
  model: string | null;
  connectionId: string | null;
  connectionName: string | null;
  status: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

export interface NineRouterProviderConnection {
  id: string;
  provider: string | null;
  name: string | null;
  models: string[];
  raw: Record<string, unknown>;
}

export interface NineRouterConnectionQuotaState {
  connectionId: string;
  provider: string | null;
  available: boolean | null;
  exhausted: boolean;
  resetAt: string | null;
  reason: string | null;
  raw: Record<string, unknown>;
}

export interface NineRouterComboCapacity {
  combo: string;
  available: boolean;
  retryAt: string | null;
  reason: string | null;
  connections: NineRouterConnectionQuotaState[];
}

export interface NineRouterResolvedConfig {
  normalizedBaseUrl: string;
  managementBaseUrl: string;
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
    | "http_error"
    | "rate_limited";
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

function derive9RouterManagementBaseUrl(normalizedBaseUrl: string): string {
  const url = new URL(normalizedBaseUrl);
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments[segments.length - 1] === "models") segments.pop();
  if (segments[segments.length - 1] === "v1") segments.pop();
  url.pathname = segments.length > 0 ? `/${segments.join("/")}` : "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
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
      code: response.status === 429 ? "rate_limited" : "unavailable",
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
  const managementBaseUrl = derive9RouterManagementBaseUrl(normalizedBaseUrl);
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
    managementBaseUrl,
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

function build9RouterAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

async function fetch9RouterApiJson(input: {
  url: string;
  apiKey: string;
  timeoutMs?: number;
  service: string;
  message: string;
}): Promise<unknown> {
  const timeoutMs = readPositiveInteger(input.timeoutMs, DEFAULT_NINEROUTER_MODELS_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: "GET",
      headers: build9RouterAuthHeaders(input.apiKey),
      signal: controller.signal,
    });
    if (!response.ok) classifyResponseError(response);
    try {
      return await response.json();
    } catch {
      throw new NineRouterDiscoveryError({
        code: "invalid_response",
        status: 502,
        message: `${input.message}: o 9Router retornou JSON inválido.`,
      });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new NineRouterDiscoveryError({
        code: "timeout",
        status: 504,
        retryable: true,
        message: `${input.message}: tempo limite excedido.`,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => readTrimmedString(entry))
    .filter(Boolean);
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().replace(/,/g, "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readIsoDate(value: unknown): string | null {
  if (!(typeof value === "string" || value instanceof Date || typeof value === "number")) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function lookupCaseInsensitive(record: Record<string, unknown>, candidates: string[]): unknown {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const candidate of candidates) {
    const value = lowered.get(candidate.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseRequestLogEntry(raw: unknown): NineRouterManagementRequestLogEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = readTrimmedString(lookupCaseInsensitive(record, ["id", "requestId", "request_id"])) || null;
  const provider = readTrimmedString(lookupCaseInsensitive(record, ["provider", "providerName"])) || null;
  const model = readTrimmedString(lookupCaseInsensitive(record, ["model", "modelName"])) || null;
  const connectionId = readTrimmedString(lookupCaseInsensitive(record, ["connectionId", "connection_id", "providerId", "provider_id"])) || null;
  const connectionName = readTrimmedString(lookupCaseInsensitive(record, ["connectionName", "connection_name", "providerLabel", "provider_label"])) || null;
  const status = readTrimmedString(lookupCaseInsensitive(record, ["status", "result", "outcome"])) || null;
  const inputTokens = readNullableNumber(lookupCaseInsensitive(record, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]));
  const outputTokens = readNullableNumber(lookupCaseInsensitive(record, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]));
  const timestamp = readIsoDate(lookupCaseInsensitive(record, ["timestamp", "createdAt", "created_at", "startedAt", "started_at"]));
  return {
    id,
    provider,
    model,
    connectionId,
    connectionName,
    status,
    inputTokens,
    outputTokens,
    timestamp,
    raw: record,
  };
}

function extractRecordArray(payload: unknown, explicitKeys: string[] = []): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of explicitKeys) {
    const candidate = root[key];
    if (Array.isArray(candidate)) {
      return candidate.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
  }
  for (const value of Object.values(root)) {
    if (Array.isArray(value) && value.every((entry) => typeof entry === "object" && entry !== null)) {
      return value.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
  }
  return [];
}

function extractConnectionsFromCombo(rawCombo: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const directId = readTrimmedString(lookupCaseInsensitive(record, ["connectionId", "connection_id", "providerId", "provider_id", "id"]));
    const providerMarker = readTrimmedString(lookupCaseInsensitive(record, ["provider", "type", "kind"]));
    if (directId && (providerMarker || hasOwnKey(record, "connectionId") || hasOwnKey(record, "connection_id") || hasOwnKey(record, "providerId") || hasOwnKey(record, "provider_id"))) {
      ids.add(directId);
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(rawCombo);
  return [...ids];
}

function parseProviderConnection(raw: unknown): NineRouterProviderConnection | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = readTrimmedString(lookupCaseInsensitive(record, ["id", "connectionId", "connection_id", "providerId", "provider_id"]));
  if (!id) return null;
  return {
    id,
    provider: readTrimmedString(lookupCaseInsensitive(record, ["provider", "type", "kind"])) || null,
    name: readTrimmedString(lookupCaseInsensitive(record, ["name", "label", "connectionName", "connection_name"])) || null,
    models: readStringArray(lookupCaseInsensitive(record, ["models", "modelIds", "model_ids"])),
    raw: record,
  };
}

function parseQuotaState(input: { connection: NineRouterProviderConnection; usagePayload: unknown }): NineRouterConnectionQuotaState {
  const record = asRecord(input.usagePayload) ?? {};
  const availableRaw = lookupCaseInsensitive(record, ["available", "isAvailable", "canRun"]);
  const exhaustedRaw = lookupCaseInsensitive(record, ["exhausted", "quotaExceeded", "quota_exhausted", "locked"]);
  const resetAt = readIsoDate(lookupCaseInsensitive(record, ["resetAt", "retryAt", "reset_at", "retry_at", "nextResetAt", "next_reset_at"]));
  const countdownMs = readNullableNumber(lookupCaseInsensitive(record, ["countdownMs", "retryAfterMs", "cooldownMs", "countdown_ms", "retry_after_ms", "cooldown_ms"]));
  const resolvedResetAt = resetAt ?? (countdownMs != null && countdownMs >= 0 ? new Date(Date.now() + countdownMs).toISOString() : null);
  const reason = readTrimmedString(lookupCaseInsensitive(record, ["reason", "status", "message", "detail"])) || null;
  const available = typeof availableRaw === "boolean"
    ? availableRaw
    : typeof exhaustedRaw === "boolean"
      ? !exhaustedRaw
      : null;
  const exhaustedByReason = /quota|exhaust|limit|capacity|cooldown|locked/i.test(reason ?? "");
  const exhausted = typeof exhaustedRaw === "boolean"
    ? exhaustedRaw
    : available === false
      ? true
      : exhaustedByReason;
  return {
    connectionId: input.connection.id,
    provider: input.connection.provider,
    available,
    exhausted,
    resetAt: resolvedResetAt,
    reason,
    raw: record,
  };
}

export async function list9RouterCombos(input: {
  managementBaseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}) {
  const payload = await fetch9RouterApiJson({
    url: `${input.managementBaseUrl}/api/combos`,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    service: "9router-management",
    message: "Falha ao consultar /api/combos do 9Router",
  });
  return extractRecordArray(payload, ["combos"]);
}

export async function list9RouterConnections(input: {
  managementBaseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}) {
  const payload = await fetch9RouterApiJson({
    url: `${input.managementBaseUrl}/api/providers`,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    service: "9router-management",
    message: "Falha ao consultar /api/providers do 9Router",
  });
  return extractRecordArray(payload, ["providers", "connections"]).map(parseProviderConnection).filter((entry): entry is NineRouterProviderConnection => Boolean(entry));
}

export async function get9RouterConnectionUsage(input: {
  managementBaseUrl: string;
  apiKey: string;
  connectionId: string;
  timeoutMs?: number;
}) {
  return await fetch9RouterApiJson({
    url: `${input.managementBaseUrl}/api/usage/${encodeURIComponent(input.connectionId)}`,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    service: "9router-management",
    message: `Falha ao consultar /api/usage/${input.connectionId} do 9Router`,
  });
}

export async function list9RouterRequestLogs(input: {
  managementBaseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}) {
  const payload = await fetch9RouterApiJson({
    url: `${input.managementBaseUrl}/api/usage/request-logs`,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    service: "9router-management",
    message: "Falha ao consultar /api/usage/request-logs do 9Router",
  });
  return extractRecordArray(payload, ["logs", "requests", "items"]).map(parseRequestLogEntry).filter((entry): entry is NineRouterManagementRequestLogEntry => Boolean(entry));
}

export async function list9RouterRequestDetails(input: {
  managementBaseUrl: string;
  apiKey: string;
  filters?: Record<string, string | number | null | undefined>;
  timeoutMs?: number;
}) {
  const url = new URL(`${input.managementBaseUrl}/api/usage/request-details`);
  for (const [key, value] of Object.entries(input.filters ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  const payload = await fetch9RouterApiJson({
    url: url.toString(),
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    service: "9router-management",
    message: "Falha ao consultar /api/usage/request-details do 9Router",
  });
  return extractRecordArray(payload, ["requests", "items", "details"]).map(parseRequestLogEntry).filter((entry): entry is NineRouterManagementRequestLogEntry => Boolean(entry));
}

export async function compute9RouterComboCapacity(input: {
  managementBaseUrl: string;
  apiKey: string;
  combo: string;
  timeoutMs?: number;
}): Promise<NineRouterComboCapacity> {
  const [combos, connections] = await Promise.all([
    list9RouterCombos(input),
    list9RouterConnections(input),
  ]);
  const combo = combos.find((entry) => readTrimmedString(lookupCaseInsensitive(entry, ["id", "name", "combo"])) === input.combo) ?? null;
  if (!combo) {
    throw new NineRouterDiscoveryError({
      code: "not_found",
      status: 404,
      message: `O combo \"${input.combo}\" não foi encontrado em /api/combos do 9Router.`,
    });
  }
  const comboConnectionIds = new Set(extractConnectionsFromCombo(combo));
  const eligibleConnections = connections.filter((connection) =>
    comboConnectionIds.size > 0 ? comboConnectionIds.has(connection.id) : true
  );
  const usageStates = await Promise.all(
    eligibleConnections.map(async (connection) =>
      parseQuotaState({
        connection,
        usagePayload: await get9RouterConnectionUsage({
          managementBaseUrl: input.managementBaseUrl,
          apiKey: input.apiKey,
          connectionId: connection.id,
          timeoutMs: input.timeoutMs,
        }),
      })
    ),
  );
  const availableConnections = usageStates.filter((entry) => entry.available === true || (!entry.exhausted && entry.available !== false));
  const retryAt = usageStates
    .map((entry) => entry.resetAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  return {
    combo: input.combo,
    available: availableConnections.length > 0,
    retryAt,
    reason: availableConnections.length > 0 ? null : "quota_exhausted",
    connections: usageStates,
  };
}

export function reset9RouterModelsCacheForTests() {
  discoveryCache.clear();
}
