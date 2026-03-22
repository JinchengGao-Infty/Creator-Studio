import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[ai-engine-sidecar] ${message}`);
  process.exit(1);
}

export async function runAiEngineSidecarSuite({ rootDir }) {
  const root = fileURLToPath(rootDir);
  const sidecarPath = join(root, "src-tauri", "target", "release", "ai-engine.js");

  if (!existsSync(sidecarPath)) {
    fail(`Missing release sidecar: ${sidecarPath}`);
  }

  const request = JSON.stringify({
    type: "fetch_models",
    providerType: "openai-compatible",
    baseURL: "http://127.0.0.1:9/v1",
    apiKey: "test-key",
  });

  const result = spawnSync("node", [sidecarPath], {
    input: `${request}\n`,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (!result.stdout?.trim()) {
    fail(`No stdout from sidecar. stderr=${result.stderr?.trim() ?? ""}`);
  }

  let output;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch (error) {
    fail(`Invalid JSON from sidecar: ${result.stdout.trim()}`);
  }

  if (!["models", "error"].includes(output.type)) {
    fail(`Unexpected sidecar output: ${result.stdout.trim()}`);
  }

  if (result.status !== 0 && !result.stdout.includes('"type":"error"')) {
    fail(`Sidecar exited abnormally without structured error. stderr=${result.stderr?.trim() ?? ""}`);
  }

  console.log("[ai-engine-sidecar] Release sidecar execution check passed.");
}
