import { runRegressionSuite } from "./cases/regression.mjs";
import { runAiEngineSidecarSuite } from "./cases/ai-engine-sidecar.mjs";
import { runAiEnginePackagingSuite } from "./cases/ai-engine-packaging.mjs";
import { runDefaultProviderSuite } from "./cases/default-provider.mjs";
import { runEditorShortcutsSuite } from "./cases/editor-shortcuts.mjs";
import { runNoHardcodedSecretsSuite } from "./cases/no-hardcoded-secrets.mjs";
import { runWindowsDemoSuite } from "./cases/windows-demo.mjs";
import { runAiEngineSpawnSuite } from "./cases/ai-engine-spawn.mjs";
import { runAiEngineToolSafetySuite } from "./cases/ai-engine-tool-safety.mjs";
import { runAiEngineErrorRecoverySuite } from "./cases/ai-engine-error-recovery.mjs";

const suite = process.argv[2] ?? "regression";

const suites = {
  regression: runRegressionSuite,
  "ai-engine-sidecar": runAiEngineSidecarSuite,
  "ai-engine-packaging": runAiEnginePackagingSuite,
  "default-provider": runDefaultProviderSuite,
  "editor-shortcuts": runEditorShortcutsSuite,
  "no-hardcoded-secrets": runNoHardcodedSecretsSuite,
  "windows-demo": runWindowsDemoSuite,
  "ai-engine-spawn": runAiEngineSpawnSuite,
  "ai-engine-tool-safety": runAiEngineToolSafetySuite,
  "ai-engine-error-recovery": runAiEngineErrorRecoverySuite,
};

const runner = suites[suite];

if (!runner) {
  console.error(`[test-suite] Unknown suite: ${suite}`);
  console.error(`[test-suite] Available suites: ${Object.keys(suites).join(", ")}`);
  process.exit(1);
}

await runner({
  rootDir: new URL("..", import.meta.url),
});
