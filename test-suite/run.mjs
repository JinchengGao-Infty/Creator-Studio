import { runRegressionSuite } from "./cases/regression.mjs";
import { runAiEngineSidecarSuite } from "./cases/ai-engine-sidecar.mjs";
import { runDefaultProviderSuite } from "./cases/default-provider.mjs";
import { runEditorShortcutsSuite } from "./cases/editor-shortcuts.mjs";
import { runNoHardcodedSecretsSuite } from "./cases/no-hardcoded-secrets.mjs";
import { runWindowsDemoSuite } from "./cases/windows-demo.mjs";

const suite = process.argv[2] ?? "regression";

const suites = {
  regression: runRegressionSuite,
  "ai-engine-sidecar": runAiEngineSidecarSuite,
  "default-provider": runDefaultProviderSuite,
  "editor-shortcuts": runEditorShortcutsSuite,
  "no-hardcoded-secrets": runNoHardcodedSecretsSuite,
  "windows-demo": runWindowsDemoSuite,
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
