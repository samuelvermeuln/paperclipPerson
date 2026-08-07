export const type = "opencode_9router";
export const label = "9Router via OpenCode";

export const OPENCODE_NINEROUTER_PROVIDER_ID = "9router";
export const DEFAULT_NINEROUTER_API_KEY_ENV = "NINEROUTER_API_KEY";
export const DEFAULT_NINEROUTER_DEFAULT_COMBO = "auto";
export const DEFAULT_NINEROUTER_MODELS_CACHE_TTL_SECONDS = 60;
export const DEFAULT_NINEROUTER_MODELS_TIMEOUT_MS = 10_000;
export const NINEROUTER_ALL_COMBOS_SENTINEL = "__paperclip_show_all_combos__";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# opencode_9router agent configuration

Adapter: opencode_9router

Use when:
- You want Paperclip to run OpenCode locally while 9Router decides the real underlying LLM
- You want dynamic combo discovery from a 9Router /v1/models endpoint
- You want different agents to select different logical combos without editing OpenCode provider config by hand

Don't use when:
- You want direct OpenCode provider/model selection (use opencode_local)
- You need a webhook-style external invocation (use openclaw_gateway or http)
- OpenCode CLI is not installed on the machine

Core fields:
- baseUrl (string, optional): 9Router base URL. Defaults to NINEROUTER_BASE_URL. Paperclip normalizes it to end with /v1.
- apiKeyEnv (string, optional): environment variable name that holds the 9Router API key. Defaults to NINEROUTER_API_KEY.
- combo (string, optional): primary 9Router combo id. If omitted, Paperclip falls back to NINEROUTER_DEFAULT_COMBO, then auto, then first discovered combo.
- smallCombo (string, optional): auxiliary 9Router combo used for OpenCode small_model. Defaults to combo.
- comboPrefix (string, optional): when set, only discovered combos starting with this prefix are shown.
- modelsCacheTtlSeconds (number, optional): combo discovery cache TTL. Defaults to 60 seconds.
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt.
- dangerouslySkipPermissions (boolean, optional): inject a runtime OpenCode config that allows external_directory access without interactive prompts; defaults to true for unattended Paperclip runs.
- promptTemplate (string, optional): run prompt template.
- command (string, optional): defaults to opencode.
- extraArgs (string[], optional): additional CLI args.
- env (object, optional): KEY=VALUE environment variables.

Operational fields:
- timeoutSec (number, optional): run timeout in seconds.
- graceSec (number, optional): SIGTERM grace period in seconds.

Notes:
- Paperclip discovers combos from GET {baseUrl}/models and only exposes entries whose owned_by field equals combo.
- Paperclip never stores the real 9Router API key in adapter config. Only the environment variable name is persisted.
- OpenCode receives model ids in 9router/<combo-id> format, while 9Router remains responsible for routing to the real LLM provider and fallback path.
`;
