import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

function readHostTargetTriple() {
  const raw = execSync("rustc -vV", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const match = raw.match(/^host:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function resolveTargetTriple() {
  const fromEnv = (process.env.TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? "").trim();
  if (fromEnv) return fromEnv;
  return readHostTargetTriple();
}

function run(command, args, options = {}) {
  const cmd = [command, ...args].join(" ");
  // eslint-disable-next-line no-console
  console.log(`[ai-engine] ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...options });
}

const target = resolveTargetTriple();
if (!target) {
  throw new Error("Failed to resolve Rust target triple (TARGET / rustc -vV).");
}

const exeSuffix = target.includes("windows") ? ".exe" : "";
const outPath = path.join("src-tauri", "bin", `ai-engine-${target}${exeSuffix}`);

mkdirSync(path.dirname(outPath), { recursive: true });

run("bun", ["install", "--frozen-lockfile"], { cwd: path.join("packages", "ai-engine") });
run(
  "bun",
  ["build", "src/cli.ts", "--compile", "--outfile", path.resolve(outPath)],
  { cwd: path.join("packages", "ai-engine") },
);

