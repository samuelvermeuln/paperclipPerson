import type { UIAdapterModule } from "../types";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-9router/ui";
import { OpenCode9RouterConfigFields } from "./config-fields";
import { buildOpenCode9RouterConfig } from "@paperclipai/adapter-opencode-9router/ui";

export const openCode9RouterUIAdapter: UIAdapterModule = {
  type: "opencode_9router",
  label: "9Router via OpenCode",
  parseStdoutLine: parseOpenCodeStdoutLine,
  ConfigFields: OpenCode9RouterConfigFields,
  buildAdapterConfig: buildOpenCode9RouterConfig,
};
