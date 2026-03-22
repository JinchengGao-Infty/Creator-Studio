import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function assertIncludes(source, text, message) {
  if (!source.includes(text)) {
    console.error(`[editor-shortcuts] ${message}`);
    process.exit(1);
  }
}

export async function runEditorShortcutsSuite({ rootDir }) {
  const root = fileURLToPath(rootDir);
  const editorPath = join(root, "src", "components", "Editor", "Editor.tsx");
  const source = readFileSync(editorPath, "utf8");

  console.log("\n[editor-shortcuts] Validate common editor shortcut bindings");
  assertIncludes(source, 'key: "Mod-z"', "Missing Mod-z undo binding");
  assertIncludes(source, 'key: "Mod-Shift-z"', "Missing Mod-Shift-z redo binding");
  assertIncludes(source, 'win: "Ctrl-y"', "Missing Windows Ctrl-y redo binding");
  assertIncludes(source, 'key: "Mod-a"', "Missing Mod-a select-all binding");
  assertIncludes(source, 'key: "Mod-s"', "Missing Mod-s save binding");
  assertIncludes(source, 'win: "Ctrl-Shift-s"', "Missing Windows Ctrl-Shift-s save binding");
  assertIncludes(source, "EditorSelection.single(0, view.state.doc.length)", "Select-all should select the full document");
  assertIncludes(source, "preventDefault: true", "Shortcut bindings should prevent browser default behavior");
  console.log("[editor-shortcuts] Check passed.");
}
