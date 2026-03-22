import { expect, test } from "@playwright/test";

async function focusEditor(page: import("@playwright/test").Page) {
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  return editor;
}

test("Ctrl+S saves the latest content", async ({ page }) => {
  await page.goto("/editor-harness.html");
  const editor = await focusEditor(page);

  await editor.press("End");
  await page.keyboard.type(" 保存测试");
  await page.keyboard.press("Control+S");

  await expect(page.getByTestId("save-status")).toHaveText("saved");
  await expect(page.getByTestId("save-count")).toHaveText("1");
  await expect(page.getByTestId("saved-content")).toContainText("保存测试");
});

test("Ctrl+Z and Ctrl+Y undo and redo content changes", async ({ page }) => {
  await page.goto("/editor-harness.html");
  const editor = await focusEditor(page);

  await editor.press("End");
  await page.keyboard.type(" abc");
  await expect(page.getByTestId("draft-content")).toContainText("abc");

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("draft-content")).not.toContainText("abc");

  await page.keyboard.press("Control+Y");
  await expect(page.getByTestId("draft-content")).toContainText("abc");
});

test("Ctrl+Shift+Z also redoes content changes", async ({ page }) => {
  await page.goto("/editor-harness.html");
  const editor = await focusEditor(page);

  await editor.press("End");
  await page.keyboard.type(" redo");
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("draft-content")).not.toContainText("redo");

  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByTestId("draft-content")).toContainText("redo");
});

test("Ctrl+A selects all and replacement input overwrites the full document", async ({ page }) => {
  await page.goto("/editor-harness.html");
  const editor = await focusEditor(page);

  await page.keyboard.press("Control+A");
  await page.keyboard.type("全文替换");
  await expect(page.getByTestId("draft-content")).toHaveText("全文替换");
});
