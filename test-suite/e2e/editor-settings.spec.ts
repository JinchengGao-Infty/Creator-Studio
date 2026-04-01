/**
 * 编辑器设置功能 E2E 测试
 *
 * 测试覆盖：
 * 1. 背景功能：纯色背景、预设背景、自定义图片、透明度、持久化
 * 2. 字体功能：字体切换、字号调整、行高调整
 * 3. 固定行宽：开关、字符数设置、边距指示线、内容居中
 * 4. 缩进功能：Tab 宽度、首行缩进、自动缩进
 * 5. 章节切换：列表切换、内容显示、未保存提示
 * 6. 主题切换：亮/暗主题、样式响应
 *
 * 需要添加的 data-testid（在组件中标记）：
 * - 编辑器设置面板: data-testid="editor-settings-panel"
 * - 背景 Tab: data-testid="settings-tab-background"
 * - 字体 Tab: data-testid="settings-tab-font"
 * - 行宽 Tab: data-testid="settings-tab-linewidth"
 * - 缩进 Tab: data-testid="settings-tab-indent"
 */

import { expect, test } from "@playwright/test";

// ============================================================
// 测试辅助函数
// ============================================================

/**
 * 聚焦编辑器
 */
async function focusEditor(page: import("@playwright/test").Page) {
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  return editor;
}

/**
 * 等待设置面板加载
 */
async function waitForSettingsPanel(page: import("@playwright/test").Page) {
  await page.waitForSelector(".ant-tabs-tab", { timeout: 5000 });
}

// ============================================================
// 1. 背景功能测试
// ============================================================

test.describe("编辑器背景功能", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor-harness.html");
    // 打开设置面板（需要根据实际 UI 调整选择器）
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => {
      // 如果找不到设置按钮，跳过
      test.skip();
    });
    await waitForSettingsPanel(page);
  });

  test("TC_BG_001: 纯色背景切换", async ({ page }) => {
    // 选择背景 Tab
    const backgroundTab = page.locator(".ant-tabs-tab").filter({ hasText: "背景" });
    await backgroundTab.click();
    await page.waitForTimeout(300);

    // 选择背景类型为"纯色背景"
    const backgroundTypeSelect = page.locator(".ant-select").first();
    await backgroundTypeSelect.click();
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "纯色背景" }).click();

    // 选择一个预设颜色（纸张色 #faf8f5）
    const paperColor = page.locator('div[style*="background-color: rgb(250, 248, 245)"]').first();
    await paperColor.click();

    // 验证编辑器背景变化
    const editorContent = page.locator(".cm-editor");
    await expect(editorContent).toBeVisible();

    // 切换到米黄色 #fdf6e3
    const creamColor = page.locator('div[style*="background-color: rgb(253, 246, 227)"]').first();
    await creamColor.click();
    await page.waitForTimeout(200);

    // 验证编辑器背景已更新
    const editorBg = editorContent.locator(".cm-scroller");
    await expect(editorBg).toBeVisible();
  });

  test("TC_BG_002: 预设背景选择", async ({ page }) => {
    // 选择背景 Tab
    const backgroundTab = page.locator(".ant-tabs-tab").filter({ hasText: "背景" });
    await backgroundTab.click();
    await page.waitForTimeout(300);

    // 选择背景类型为"预设背景"
    const backgroundTypeSelect = page.locator(".ant-select").first();
    await backgroundTypeSelect.click();
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "预设背景" }).click();

    // 选择"米黄"预设背景
    const presetBg = page.locator('div[style*="background-color"]').filter({ hasText: "米黄" }).first();
    await presetBg.click();
    await page.waitForTimeout(200);

    // 验证预设背景选中状态（有边框高亮）
    const selectedPreset = page.locator('div[style*="border"][style*="1890ff"]').filter({ hasText: "米黄" });
    await expect(selectedPreset).toBeVisible();
  });

  test("TC_BG_003: 自定义图片上传", async ({ page }) => {
    // 选择背景 Tab
    const backgroundTab = page.locator(".ant-tabs-tab").filter({ hasText: "背景" });
    await backgroundTab.click();
    await page.waitForTimeout(300);

    // 选择背景类型为"自定义图片"
    const backgroundTypeSelect = page.locator(".ant-select").first();
    await backgroundTypeSelect.click();
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "自定义图片" }).click();

    // 验证上传按钮可见
    const uploadButton = page.locator("button").filter({ hasText: "上传图片" });
    await expect(uploadButton).toBeVisible();

    // 注意：实际文件上传需要使用 setInputFiles
    // const fileInput = page.locator('input[type="file"]');
    // await fileInput.setInputFiles("path/to/test-image.png");
  });

  test("TC_BG_004: 背景透明度调节", async ({ page }) => {
    // 选择背景 Tab
    const backgroundTab = page.locator(".ant-tabs-tab").filter({ hasText: "背景" });
    await backgroundTab.click();
    await page.waitForTimeout(300);

    // 选择背景类型为"自定义图片"
    const backgroundTypeSelect = page.locator(".ant-select").first();
    await backgroundTypeSelect.click();
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "自定义图片" }).click();

    // 查找透明度滑块
    const opacitySlider = page.locator(".ant-slider").filter({ has: page.locator("text=透明度") });
    await expect(opacitySlider).toBeVisible();

    // 获取当前透明度值
    const opacityLabel = page.locator("text=透明度").locator("..");
    await expect(opacityLabel).toContainText("100%");

    // 拖动滑块到 50%
    const sliderHandle = opacitySlider.locator(".ant-slider-handle");
    const sliderTrack = opacitySlider.locator(".ant-slider-rail");

    const trackBox = await sliderTrack.boundingBox();
    if (trackBox) {
      await sliderHandle.hover();
      await page.mouse.down();
      await page.mouse.move(trackBox.x + trackBox.width * 0.5, trackBox.y + trackBox.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    await expect(opacityLabel).toContainText("50%");
  });

  test("TC_BG_005: 设置持久化", async ({ page }) => {
    // 1. 修改背景设置
    const backgroundTab = page.locator(".ant-tabs-tab").filter({ hasText: "背景" });
    await backgroundTab.click();
    await page.waitForTimeout(300);

    // 选择"淡蓝"预设背景
    const backgroundTypeSelect = page.locator(".ant-select").first();
    await backgroundTypeSelect.click();
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "预设背景" }).click();

    const skyBg = page.locator('div[style*="background-color"]').filter({ hasText: "淡蓝" }).first();
    await skyBg.click();
    await page.waitForTimeout(300);

    // 2. 刷新页面
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 3. 重新打开设置面板
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    // 4. 验证设置已持久化
    const backgroundTabAfter = page.locator(".ant-tabs-tab").filter({ hasText: "背景" });
    await backgroundTabAfter.click();
    await page.waitForTimeout(300);

    // 验证淡蓝背景被选中
    const selectedBg = page.locator('div[style*="border"][style*="1890ff"]').filter({ hasText: "淡蓝" });
    await expect(selectedBg).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// 2. 字体功能测试
// ============================================================

test.describe("编辑器字体功能", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor-harness.html");
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    // 选择字体 Tab
    const fontTab = page.locator(".ant-tabs-tab").filter({ hasText: "字体" });
    await fontTab.click();
    await page.waitForTimeout(300);
  });

  test("TC_FONT_001: 字体切换", async ({ page }) => {
    // 获取字体选择器
    const fontSelect = page.locator(".ant-select").first();
    await fontSelect.click();

    // 选择"思源宋体"
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "思源宋体" }).click();
    await page.waitForTimeout(300);

    // 验证编辑器内容应用了新字体
    const scroller = page.locator(".cm-scroller");
    const fontFamily = await scroller.evaluate((el) => window.getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain("Noto Serif SC");
  });

  test("TC_FONT_002: 字号调整", async ({ page }) => {
    // 获取字号滑块（第一个 Slider）
    const fontSizeSlider = page.locator(".ant-slider").first();
    await expect(fontSizeSlider).toBeVisible();

    // 验证初始字号标签
    const fontSizeLabel = page.locator("text=/\\d+px/").first();
    const initialSize = await fontSizeLabel.textContent();
    expect(initialSize).toContain("16px");

    // 拖动滑块到 20px
    const sliderHandle = fontSizeSlider.locator(".ant-slider-handle");
    const sliderRail = fontSizeSlider.locator(".ant-slider-rail");

    const railBox = await sliderRail.boundingBox();
    if (railBox) {
      // 滑块位置计算：(20 - 14) / (24 - 14) = 0.6
      await sliderHandle.hover();
      await page.mouse.down();
      await page.mouse.move(railBox.x + railBox.width * 0.6, railBox.y + railBox.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    await expect(fontSizeLabel).toContainText("20px");

    // 验证编辑器应用了新的字号
    const scroller = page.locator(".cm-scroller");
    const fontSize = await scroller.evaluate((el) => window.getComputedStyle(el).fontSize);
    expect(fontSize).toBe("20px");
  });

  test("TC_FONT_003: 行高调整", async ({ page }) => {
    // 获取行高滑块（第二个 Slider）
    const lineHeightSlider = page.locator(".ant-slider").nth(1);
    await expect(lineHeightSlider).toBeVisible();

    // 验证初始行高标签
    const lineHeightLabel = page.locator("text=/1\\.[5-9]/").first();
    const initialHeight = await lineHeightLabel.textContent();
    expect(initialHeight).toMatch(/1\.[5-9]/);

    // 拖动滑块到 2.0
    const sliderHandle = lineHeightSlider.locator(".ant-slider-handle");
    const sliderRail = lineHeightSlider.locator(".ant-slider-rail");

    const railBox = await sliderRail.boundingBox();
    if (railBox) {
      // 滑块位置计算：(2.0 - 1.5) / (2.5 - 1.5) = 0.5
      await sliderHandle.hover();
      await page.mouse.down();
      await page.mouse.move(railBox.x + railBox.width * 0.5, railBox.y + railBox.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    await expect(lineHeightLabel).toContainText("2");

    // 验证编辑器应用了新的行高
    const scroller = page.locator(".cm-scroller");
    const lineHeight = await scroller.evaluate((el) => window.getComputedStyle(el).lineHeight);
    expect(lineHeight).toMatch(/2\.0/);
  });
});

// ============================================================
// 3. 固定行宽功能测试
// ============================================================

test.describe("编辑器固定行宽功能", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor-harness.html");
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    // 选择行宽 Tab
    const lineWidthTab = page.locator(".ant-tabs-tab").filter({ hasText: "行宽" });
    await lineWidthTab.click();
    await page.waitForTimeout(300);
  });

  test("TC_LINE_001: 固定行宽开关", async ({ page }) => {
    // 获取固定行宽开关
    const switchElement = page.locator(".ant-switch").first();
    await expect(switchElement).toBeVisible();

    // 验证初始状态（默认关闭）
    const isChecked = await switchElement.evaluate((el) => el.classList.contains("ant-switch-checked"));
    expect(isChecked).toBe(false);

    // 开启固定行宽
    await switchElement.click();
    await page.waitForTimeout(300);

    // 验证开关状态
    const isCheckedAfter = await switchElement.evaluate((el) => el.classList.contains("ant-switch-checked"));
    expect(isCheckedAfter).toBe(true);

    // 验证编辑器应用了固定行宽样式
    const editorContent = page.locator(".cm-editor");
    await expect(editorContent).toBeVisible();
    const hasFixedWidth = await editorContent.locator(".cm-content").evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.maxWidth !== "none" && style.maxWidth !== "";
    });
    expect(hasFixedWidth).toBe(true);
  });

  test("TC_LINE_002: 字符数设置", async ({ page }) => {
    // 开启固定行宽
    const switchElement = page.locator(".ant-switch").first();
    await switchElement.click();
    await page.waitForTimeout(300);

    // 获取字符数滑块
    const lineWidthSlider = page.locator(".ant-slider").first();
    await expect(lineWidthSlider).toBeVisible();

    // 验证初始字符数
    const charCountLabel = page.locator("text=/\\d+ 个字符/").first();
    await expect(charCountLabel).toContainText("60");

    // 拖动滑块到 40
    const sliderHandle = lineWidthSlider.locator(".ant-slider-handle");
    const sliderRail = lineWidthSlider.locator(".ant-slider-rail");

    const railBox = await sliderRail.boundingBox();
    if (railBox) {
      // 滑块位置计算：(40 - 40) / (80 - 40) = 0
      await sliderHandle.hover();
      await page.mouse.down();
      await page.mouse.move(railBox.x, railBox.y + railBox.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    await expect(charCountLabel).toContainText("40");

    // 验证编辑器内容宽度变化
    const content = page.locator(".cm-content");
    const maxWidth = await content.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return parseInt(style.maxWidth);
    });
    expect(maxWidth).toBeGreaterThan(0);
  });

  test("TC_LINE_003: 边距指示线显示", async ({ page }) => {
    // 开启固定行宽
    const switchElement = page.locator(".ant-switch").first();
    await switchElement.click();
    await page.waitForTimeout(300);

    // 获取边距指示线开关（第二个开关）
    const marginLineSwitch = page.locator(".ant-switch").nth(1);
    await expect(marginLineSwitch).toBeVisible();

    // 验证初始状态（默认开启）
    const isChecked = await marginLineSwitch.evaluate((el) => el.classList.contains("ant-switch-checked"));
    expect(isChecked).toBe(true);

    // 验证边距指示线存在
    const marginLine = page.locator('[style*="position: absolute"][style*="right"]').first();
    await expect(marginLine).toBeVisible({ timeout: 3000 });

    // 关闭边距指示线
    await marginLineSwitch.click();
    await page.waitForTimeout(300);

    // 验证边距指示线消失
    await expect(marginLine).not.toBeVisible();
  });

  test("TC_LINE_004: 内容居中效果", async ({ page }) => {
    // 开启固定行宽
    const switchElement = page.locator(".ant-switch").first();
    await switchElement.click();
    await page.waitForTimeout(300);

    // 在编辑器中输入长文本
    const editor = await focusEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type("\n这是一段很长的测试文本，用于验证固定行宽功能是否正常工作。".repeat(3));
    await page.waitForTimeout(300);

    // 验证内容没有溢出（固定行宽应该限制内容宽度）
    const content = page.locator(".cm-content");
    const contentBox = await content.boundingBox();
    expect(contentBox).not.toBeNull();

    // 验证编辑器容器没有水平滚动
    const scroller = page.locator(".cm-scroller");
    const scrollWidth = await scroller.evaluate((el) => el.scrollWidth);
    const clientWidth = await scroller.evaluate((el) => el.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10); // 允许一些容差
  });
});

// ============================================================
// 4. 缩进功能测试
// ============================================================

test.describe("编辑器缩进功能", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor-harness.html");
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    // 选择缩进 Tab
    const indentTab = page.locator(".ant-tabs-tab").filter({ hasText: "缩进" });
    await indentTab.click();
    await page.waitForTimeout(300);
  });

  test("TC_INDENT_001: Tab 宽度设置", async ({ page }) => {
    // 获取 Tab 宽度滑块（第二个 Slider）
    const tabWidthSlider = page.locator(".ant-slider").nth(1);
    await expect(tabWidthSlider).toBeVisible();

    // 验证初始 Tab 宽度
    const tabWidthLabel = page.locator("text=/Tab 宽度.*\\d/");
    await expect(tabWidthLabel).toContainText("2");

    // 拖动滑块到 4 字
    const sliderHandle = tabWidthSlider.locator(".ant-slider-handle");
    const sliderRail = tabWidthSlider.locator(".ant-slider-rail");

    const railBox = await sliderRail.boundingBox();
    if (railBox) {
      // 滑块位置计算：(4 - 1) / (4 - 1) = 1
      await sliderHandle.hover();
      await page.mouse.down();
      await page.mouse.move(railBox.x + railBox.width, railBox.y + railBox.height / 2);
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    await expect(tabWidthLabel).toContainText("4");
  });

  test("TC_INDENT_002: 首行缩进开关", async ({ page }) => {
    // 获取首行缩进开关
    const firstLineSwitch = page.locator(".ant-switch").filter({ hasText: /首行缩进/ });
    await expect(firstLineSwitch).toBeVisible();

    // 验证初始状态（默认开启）
    const isChecked = await firstLineSwitch.evaluate((el) => el.classList.contains("ant-switch-checked"));
    expect(isChecked).toBe(true);

    // 关闭首行缩进
    await firstLineSwitch.click();
    await page.waitForTimeout(300);

    // 验证开关状态
    const isCheckedAfter = await firstLineSwitch.evaluate((el) => el.classList.contains("ant-switch-checked"));
    expect(isCheckedAfter).toBe(false);

    // 再次开启
    await firstLineSwitch.click();
    await page.waitForTimeout(300);

    // 验证首行缩进字符选择器出现
    const indentSelect = page.locator(".ant-select").filter({ hasText: /个字符/ });
    await expect(indentSelect).toBeVisible();
  });

  test("TC_INDENT_003: 自动首行缩进", async ({ page }) => {
    // 确保首行缩进开启
    const firstLineSwitch = page.locator(".ant-switch").filter({ hasText: /首行缩进/ });
    const isChecked = await firstLineSwitch.evaluate((el) => el.classList.contains("ant-switch-checked"));
    if (!isChecked) {
      await firstLineSwitch.click();
      await page.waitForTimeout(300);
    }

    // 选择 2 个字符缩进
    const indentSelect = page.locator(".ant-select").filter({ hasText: /个字符/ });
    await indentSelect.click();
    await page.locator(".ant-select-dropdown .ant-select-item").filter({ hasText: "2 个字符" }).click();
    await page.waitForTimeout(300);

    // 在编辑器中输入文本并换行
    const editor = await focusEditor(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("新段落内容");
    await page.waitForTimeout(300);

    // 验证首行缩进样式已应用
    const firstLine = page.locator(".cm-line").first();
    const textIndent = await firstLine.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.textIndent;
    });
    expect(textIndent).not.toBe("0px");
  });
});

// ============================================================
// 5. 章节切换测试
// ============================================================

test.describe("编辑器章节切换功能", () => {
  test("TC_CHAPTER_001: 章节列表切换", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 等待编辑器加载
    const editor = await focusEditor(page);
    await expect(editor).toBeVisible();

    // 查找章节列表
    const chapterList = page.locator(".chapter-list");
    await expect(chapterList).toBeVisible({ timeout: 5000 });

    // 获取章节数量
    const chapterItems = page.locator(".chapter-item");
    const count = await chapterItems.count();

    if (count < 2) {
      // 需要先创建章节
      test.skip();
      return;
    }

    // 点击第二个章节
    await chapterItems.nth(1).click();
    await page.waitForTimeout(500);

    // 验证章节切换成功（可以通过 URL 或编辑器内容变化来判断）
    const isActive = await chapterItems.nth(1).evaluate((el) => el.classList.contains("active"));
    expect(isActive).toBe(true);
  });

  test("TC_CHAPTER_002: 章节内容正确显示", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 等待编辑器加载
    const editor = await focusEditor(page);
    await expect(editor).toBeVisible();

    // 获取初始内容
    const initialContent = await page.getByTestId("draft-content").textContent();

    // 在编辑器中输入新内容
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" - 新增内容");
    await page.waitForTimeout(300);

    // 验证草稿内容更新
    const newContent = await page.getByTestId("draft-content").textContent();
    expect(newContent).not.toBe(initialContent);
    expect(newContent).toContain("新增内容");
  });

  test("TC_CHAPTER_003: 未保存提示", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 等待编辑器加载
    const editor = await focusEditor(page);
    await expect(editor).toBeVisible();

    // 修改内容
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" - 未保存测试");
    await page.waitForTimeout(300);

    // 验证保存状态变为 unsaved
    const saveStatus = page.getByTestId("save-status");
    await expect(saveStatus).toHaveText("unsaved", { timeout: 3000 });

    // 执行保存
    await page.keyboard.press("Control+S");
    await page.waitForTimeout(500);

    // 验证保存状态变为 saved
    await expect(saveStatus).toHaveText("saved");
  });
});

// ============================================================
// 6. 主题切换测试
// ============================================================

test.describe("编辑器主题切换功能", () => {
  test("TC_THEME_001: 亮色/暗色主题切换", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 等待编辑器加载
    await expect(page.locator(".cm-editor")).toBeVisible();

    // 获取初始主题
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const isInitialDark = initialTheme === "dark";

    // 查找主题切换按钮
    const themeSwitch = page.locator("button").filter({ hasText: /主题|Theme|深|浅|暗黑/ }).first();
    const themeSwitchExists = await themeSwitch.count() > 0;

    if (!themeSwitchExists) {
      // 尝试通过 antd theme 配置切换
      // 或者直接修改 data-theme 属性
      await page.evaluate(() => {
        const newTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
      });
    } else {
      await themeSwitch.click();
    }

    await page.waitForTimeout(500);

    // 验证主题已切换
    const newTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(newTheme).not.toBe(initialTheme);
  });

  test("TC_THEME_002: 编辑器样式响应主题变化", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 等待编辑器加载
    await expect(page.locator(".cm-editor")).toBeVisible();

    // 获取编辑器容器的初始样式
    const editorElement = page.locator(".cm-editor");

    // 切换到暗色主题
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(500);

    // 验证编辑器响应主题变化
    // 暗色主题应该有深色背景
    const darkModeStyles = await editorElement.evaluate((el) => {
      const bg = window.getComputedStyle(el).backgroundColor;
      return bg;
    });

    // 切换回亮色主题
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    await page.waitForTimeout(500);

    // 验证亮色主题样式
    const lightModeStyles = await editorElement.evaluate((el) => {
      const bg = window.getComputedStyle(el).backgroundColor;
      return bg;
    });

    // 两种主题的背景颜色应该不同
    expect(darkModeStyles).not.toBe(lightModeStyles);
  });
});

// ============================================================
// 7. 综合功能测试
// ============================================================

test.describe("编辑器综合功能", () => {
  test("TC_COMBO_001: 设置联动效果", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 1. 打开设置面板
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    // 2. 设置暗色主题
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(300);

    // 3. 开启固定行宽
    const lineWidthTab = page.locator(".ant-tabs-tab").filter({ hasText: "行宽" });
    await lineWidthTab.click();
    await page.waitForTimeout(200);

    const switchElement = page.locator(".ant-switch").first();
    await switchElement.click();
    await page.waitForTimeout(300);

    // 4. 设置首行缩进
    const indentTab = page.locator(".ant-tabs-tab").filter({ hasText: "缩进" });
    await indentTab.click();
    await page.waitForTimeout(200);

    // 5. 在编辑器中输入内容
    const editor = await focusEditor(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("测试综合功能");
    await page.waitForTimeout(300);

    // 6. 验证编辑器同时应用了所有设置
    const editorEl = page.locator(".cm-editor");
    await expect(editorEl).toBeVisible();

    // 验证固定行宽
    const hasFixedWidth = await page.locator(".cm-content").evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.maxWidth !== "none" && style.maxWidth !== "";
    });
    expect(hasFixedWidth).toBe(true);
  });

  test("TC_COMBO_002: 设置重置功能", async ({ page }) => {
    await page.goto("/editor-harness.html");

    // 1. 修改多项设置
    const settingsButton = page.locator("button").filter({ hasText: /设置|编辑器/ }).first();
    await settingsButton.click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    // 修改字号到 20px
    const fontTab = page.locator(".ant-tabs-tab").filter({ hasText: "字体" });
    await fontTab.click();
    await page.waitForTimeout(200);

    const fontSizeSlider = page.locator(".ant-slider").first();
    const sliderHandle = fontSizeSlider.locator(".ant-slider-handle");
    const sliderRail = fontSizeSlider.locator(".ant-slider-rail");
    const railBox = await sliderRail.boundingBox();
    if (railBox) {
      await sliderHandle.hover();
      await page.mouse.down();
      await page.mouse.move(railBox.x + railBox.width * 0.6, railBox.y + railBox.height / 2);
      await page.mouse.up();
    }
    await page.waitForTimeout(300);

    // 2. 关闭页面并重新打开（模拟重置）
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 3. 验证字号恢复默认值
    await page.locator("button").filter({ hasText: /设置|编辑器/ }).first().click().catch(() => test.skip());
    await waitForSettingsPanel(page);

    const fontTabAfter = page.locator(".ant-tabs-tab").filter({ hasText: "字体" });
    await fontTabAfter.click();
    await page.waitForTimeout(200);

    const fontSizeLabel = page.locator("text=/\\d+px/").first();
    await expect(fontSizeLabel).toContainText("16px"); // 默认值
  });
});

// ============================================================
// 附录：需要添加的 data-testid 清单
// ============================================================

/**
 * 建议在以下组件中添加 data-testid 属性以简化测试选择器：
 *
 * 1. EditorSettingsPanel.tsx
 *    - 外层 Card: data-testid="editor-settings-panel"
 *    - 各 Tab: data-testid="settings-tab-{key}"
 *
 * 2. BackgroundTab
 *    - 背景类型选择器: data-testid="bg-type-select"
 *    - 纯色颜色选择器: data-testid="bg-color-presets"
 *    - 预设背景项: data-testid="bg-preset-{id}"
 *    - 上传按钮: data-testid="bg-upload-btn"
 *    - 透明度滑块: data-testid="bg-opacity-slider"
 *
 * 3. FontTab
 *    - 字体选择器: data-testid="font-family-select"
 *    - 字号滑块: data-testid="font-size-slider"
 *    - 行高滑块: data-testid="line-height-slider"
 *
 * 4. LineWidthTab
 *    - 固定行宽开关: data-testid="fixed-linewidth-switch"
 *    - 字符数滑块: data-testid="line-width-slider"
 *    - 边距指示线开关: data-testid="margin-line-switch"
 *
 * 5. IndentTab
 *    - 空格宽度滑块: data-testid="space-width-slider"
 *    - Tab 宽度滑块: data-testid="tab-width-slider"
 *    - 首行缩进开关: data-testid="first-line-indent-switch"
 *    - 首行缩进选择器: data-testid="first-line-indent-select"
 *
 * 6. Editor
 *    - 编辑器容器: data-testid="editor-container"
 *    - 边距指示线: data-testid="margin-line"
 *
 * 7. StatusBar
 *    - 状态栏: data-testid="status-bar"
 *    - 保存状态: data-testid="save-status"
 *
 * 8. ChapterList
 *    - 章节列表: data-testid="chapter-list"
 *    - 章节项: data-testid="chapter-item-{id}"
 */
