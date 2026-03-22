import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme as antdTheme } from "antd";
import Editor from "../components/Editor/Editor";
import "../styles/theme.css";
import "../components/Editor/editor.css";

function Harness() {
  const [content, setContent] = React.useState("第一行初始内容");
  const [saveCount, setSaveCount] = React.useState(0);
  const [savedContent, setSavedContent] = React.useState(content);
  const [saveStatus, setSaveStatus] = React.useState("idle");

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorBgBase: "#fffff0",
          colorBgContainer: "#fafaf5",
          colorBgElevated: "#fafaf5",
          colorBorder: "#e8e8d8",
          colorText: "#333333",
          colorTextSecondary: "#666666",
          colorTextTertiary: "#999999",
          colorPrimary: "#8b7355",
          colorPrimaryHover: "#d4a574",
          colorLink: "#8b7355",
          colorLinkHover: "#d4a574",
          borderRadius: 10,
        },
      }}
    >
      <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #ddd", fontSize: 14 }}>
          <strong>Editor Harness</strong>
        </div>
        <Editor
          projectPath="test-project"
          chapterId="chapter_001"
          chapterTitle="快捷键测试章节"
          initialContent={content}
          disableInlineCompletion
          onChange={setContent}
          onSave={async (nextContent) => {
            setSaveStatus("saving");
            await new Promise((resolve) => window.setTimeout(resolve, 10));
            setSavedContent(nextContent);
            setSaveCount((count) => count + 1);
            setSaveStatus("saved");
          }}
        />
        <div
          style={{ padding: 12, borderTop: "1px solid #ddd", fontSize: 12 }}
          data-testid="harness-state"
        >
          <div data-testid="draft-content">{content}</div>
          <div data-testid="saved-content">{savedContent}</div>
          <div data-testid="save-count">{saveCount}</div>
          <div data-testid="save-status">{saveStatus}</div>
        </div>
      </div>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
