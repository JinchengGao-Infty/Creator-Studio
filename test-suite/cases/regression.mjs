import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function runStep(step, cwd) {
  console.log(`\n[regression] ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.error(`[regression] FAILED: ${step.name}`);
    process.exit(result.status ?? 1);
  }

  console.log(`[regression] PASSED: ${step.name}`);
}

export async function runRegressionSuite({ rootDir }) {
  const cwd = fileURLToPath(rootDir);
  const steps = [
    {
      name: "Build local AI engine sidecar",
      command: "npm",
      args: ["run", "ai-engine:build"],
    },
    {
      name: "Release ai-engine sidecar smoke test",
      command: "npm",
      args: ["run", "test:ai-engine-sidecar"],
    },
    {
      name: "No hardcoded secret scan",
      command: "node",
      args: ["test-suite/run.mjs", "no-hardcoded-secrets"],
    },
    {
      name: "Rust backend smoke and regression tests",
      command: "cargo",
      args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--", "--nocapture"],
    },
  ];

  for (const step of steps) {
    runStep(step, cwd);
  }

  console.log("\n[regression] All regression checks passed.");
}
