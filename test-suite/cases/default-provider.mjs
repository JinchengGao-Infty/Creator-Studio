import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

function fail(message) {
  console.error(`[default-provider] ${message}`);
  process.exit(1);
}

export async function runDefaultProviderSuite() {
  const configPath = join(os.homedir(), ".creatorai", "config.json");
  const raw = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(raw);

  const provider = config.providers?.find((item) => item.id === "builtin_dashscope_qwen_demo");
  if (!provider) fail("Missing builtin DashScope provider");
  if (provider.name !== "DashScope Qwen Demo") fail(`Unexpected provider name: ${provider.name}`);
  if (provider.base_url !== "https://dashscope.aliyuncs.com/compatible-mode/v1") {
    fail(`Unexpected provider base_url: ${provider.base_url}`);
  }
  if (provider.provider_type !== "openai-compatible") {
    fail(`Unexpected provider_type: ${provider.provider_type}`);
  }
  if (!Array.isArray(provider.models) || provider.models.length !== 1 || provider.models[0] !== "qwen-plus") {
    fail(`Unexpected provider models: ${JSON.stringify(provider.models)}`);
  }
  if (config.active_provider_id !== "builtin_dashscope_qwen_demo") {
    fail(`Unexpected active_provider_id: ${config.active_provider_id}`);
  }
  if (config.default_parameters?.model !== "qwen-plus") {
    fail(`Unexpected default model: ${config.default_parameters?.model}`);
  }

  console.log("[default-provider] Builtin DashScope provider check passed.");
}
