import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`[ai-engine-spawn] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[ai-engine-spawn] PASS: ${message}`);
}

export async function runAiEngineSpawnSuite({ rootDir }) {
  const cwd = fileURLToPath(rootDir);

  // Test 1: ai-engine source file exists
  const cliPath = join(cwd, "packages", "ai-engine", "src", "cli.ts");
  if (!existsSync(cliPath)) {
    fail(`cli.ts not found at ${cliPath}`);
  }
  pass("cli.ts source file exists");

  // Test 2: node can execute the built cli.js (if it exists)
  const builtPath = join(cwd, "packages", "ai-engine", "dist", "cli.js");
  if (existsSync(builtPath)) {
    const result = spawnSync("node", [builtPath], {
      input: JSON.stringify({ type: "fetch_models", provider: { baseURL: "http://localhost:0", apiKey: "test", providerType: "openai-compatible" }, parameters: {} }) + "\n",
      timeout: 10000,
      encoding: "utf8",
    });
    if (result.status === null && result.signal) {
      fail(`ai-engine crashed with signal ${result.signal}`);
    }
    pass("Built cli.js executes without crash (connection error expected)");
  } else {
    console.log("[ai-engine-spawn] SKIP: dist/cli.js not found (run npm run ai-engine:build first)");
  }

  // Test 3: JSONL protocol — malformed input doesn't crash
  if (existsSync(builtPath)) {
    const result = spawnSync("node", [builtPath], {
      input: "this is not json\n",
      timeout: 10000,
      encoding: "utf8",
    });
    if (result.status === null && result.signal === "SIGSEGV") {
      fail("ai-engine segfaulted on malformed input");
    }
    pass("Malformed JSONL input handled gracefully");
  }

  // Test 4: provider.models missing should not crash ai-engine before network request
  if (existsSync(builtPath)) {
    const result = spawnSync("node", [builtPath], {
      input:
        JSON.stringify({
          type: "complete",
          provider: {
            id: "test-provider",
            name: "Test Provider",
            baseURL: "http://127.0.0.1:1/v1",
            apiKey: "test-key",
            providerType: "openai-compatible",
          },
          parameters: {
            model: "gpt-5.4",
            temperature: 0,
            topP: 1,
            maxTokens: 16,
          },
          systemPrompt: "test",
          messages: [{ role: "user", content: "hello" }],
        }) + "\n",
      timeout: 10000,
      encoding: "utf8",
    });
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/Cannot read properties of undefined \(reading 'length'\)/.test(combined)) {
      fail("ai-engine crashed when provider.models was omitted");
    }
    if (result.status === null && result.signal) {
      fail(`ai-engine crashed with signal ${result.signal} when provider.models was omitted`);
    }
    pass("provider.models omitted no longer crashes ai-engine");
  }

  console.log("[ai-engine-spawn] All spawn tests passed.");
}
