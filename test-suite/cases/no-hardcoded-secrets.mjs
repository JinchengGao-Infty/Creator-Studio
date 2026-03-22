import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const TARGETS = [
  "README.md",
  "bug",
  "docs",
  "scripts",
  "src",
  "src-tauri",
  "tasks",
  "test-suite",
];

const SECRET_PATTERNS = [
  "sk-[A-Za-z0-9._-]{24,}",
  "[A-Fa-f0-9]{32}\\.[A-Za-z0-9._-]{16,}",
];

function fail(message) {
  console.error(`[no-hardcoded-secrets] ${message}`);
  process.exit(1);
}

export async function runNoHardcodedSecretsSuite({ rootDir }) {
  const cwd = fileURLToPath(rootDir);

  for (const relativePath of TARGETS) {
    const absolutePath = join(cwd, relativePath);
    for (const pattern of SECRET_PATTERNS) {
      const scan = spawnSync("rg", ["-n", "-P", pattern, absolutePath], {
        stdio: "pipe",
        shell: process.platform === "win32",
        encoding: "utf8",
      });
      if (scan.status === 0) {
        fail(`Found secret-like literal under ${relativePath}\n${scan.stdout.trim()}`);
      }
    }
  }

  const keyringSource = readFileSync(
    join(cwd, "src-tauri", "src", "keyring_store.rs"),
    "utf8",
  );
  if (!keyringSource.includes("purge_leaked_builtin_demo_key")) {
    fail("Missing leaked builtin key purge logic.");
  }
  if (!keyringSource.includes("LEAKED_BUILTIN_DEMO_API_KEY_SHA256")) {
    fail("Missing leaked builtin key hash guard.");
  }

  console.log("[no-hardcoded-secrets] Secret scan passed.");
}
