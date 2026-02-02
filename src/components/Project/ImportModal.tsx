import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Input, List, Modal, Progress, Select, message } from "antd";
import { formatError } from "../../utils/error";

interface ChapterPreview {
  title: string;
  wordCount: number;
}

interface ImportTxtProgressPayload {
  requestId: string;
  total: number;
  completed: number;
  currentTitle?: string | null;
}

interface ImportModalProps {
  visible: boolean;
  projectPath: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const IMPORT_PROGRESS_EVENT = "creatorai:importTxtProgress";

const CHAPTER_PATTERNS = [
  { label: "第X章（默认）", value: "^第.+章.*" },
  { label: "Chapter X", value: "^Chapter\\s+\\d+.*" },
  { label: "数字章节", value: "^\\d+[.、].*" },
  { label: "【章节】", value: "^【.+】.*" },
];

function makeRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ImportModal({ visible, projectPath, onCancel, onSuccess }: ImportModalProps) {
  const [filePath, setFilePath] = useState("");
  const [pattern, setPattern] = useState(CHAPTER_PATTERNS[0]?.value ?? "^第.+章.*");
  const [previews, setPreviews] = useState<ChapterPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ total: number; completed: number; currentTitle?: string } | null>(
    null,
  );
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setFilePath("");
      setPattern(CHAPTER_PATTERNS[0]?.value ?? "^第.+章.*");
      setPreviews([]);
      setPreviewLoading(false);
      setImporting(false);
      setProgress(null);
      requestIdRef.current = null;
    }
  }, [visible]);

  const runPreview = async (path: string, pat: string) => {
    if (!path.trim()) {
      setPreviews([]);
      return;
    }
    setPreviewLoading(true);
    try {
      const result = (await invoke("preview_import_txt", {
        filePath: path,
        pattern: pat,
      })) as ChapterPreview[];
      setPreviews(result || []);
    } catch (error) {
      setPreviews([]);
      message.error(`预览失败: ${formatError(error)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    if (!filePath.trim()) return;
    if (importing) return;
    const handle = window.setTimeout(() => void runPreview(filePath, pattern), 500);
    return () => window.clearTimeout(handle);
  }, [filePath, pattern, visible, importing]);

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "文本文件", extensions: ["txt"] }],
        title: "选择 TXT 文件",
      });
      if (typeof selected === "string" && selected.trim()) {
        setFilePath(selected);
        await runPreview(selected, pattern);
      }
    } catch (error) {
      message.error(`选择失败: ${formatError(error)}`);
    }
  };

  const handleImport = async () => {
    if (!filePath.trim()) {
      message.error("请先选择 txt 文件");
      return;
    }
    if (!previews.length) {
      message.error("未识别到章节，请调整章节识别规则");
      return;
    }

    const requestId = makeRequestId();
    requestIdRef.current = requestId;

    let unlisten: UnlistenFn | null = null;
    setImporting(true);
    setProgress({ total: previews.length, completed: 0 });

    try {
      unlisten = await listen<ImportTxtProgressPayload>(IMPORT_PROGRESS_EVENT, (event) => {
        const payload = event.payload;
        if (!payload || payload.requestId !== requestIdRef.current) return;
        setProgress({
          total: payload.total,
          completed: payload.completed,
          currentTitle: payload.currentTitle ?? undefined,
        });
      });

      await invoke("import_txt", {
        projectPath,
        filePath,
        pattern,
        requestId,
      });

      message.success(`成功导入 ${previews.length} 个章节`);
      onSuccess();
    } catch (error) {
      message.error(`导入失败: ${formatError(error)}`);
    } finally {
      requestIdRef.current = null;
      setImporting(false);
      unlisten?.();
    }
  };

  const progressPercent = progress?.total
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;

  const presetValue = CHAPTER_PATTERNS.some((p) => p.value === pattern) ? pattern : undefined;

  return (
    <Modal
      title="导入小说"
      open={visible}
      onCancel={() => {
        if (importing) return;
        onCancel();
      }}
      onOk={() => void handleImport()}
      okText="导入"
      cancelText="取消"
      confirmLoading={importing}
      okButtonProps={{
        disabled: previewLoading || importing || !filePath.trim() || previews.length === 0,
      }}
      width={640}
      destroyOnClose
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ marginBottom: 6 }}>文件</div>
          <Input.Search
            value={filePath}
            placeholder="选择 txt 文件"
            enterButton="选择"
            onSearch={() => void handleSelectFile()}
            readOnly
          />
        </div>

        <div>
          <div style={{ marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
            <span>章节识别规则（正则）</span>
            <Button
              size="small"
              type="link"
              onClick={() => void runPreview(filePath, pattern)}
              disabled={!filePath.trim() || previewLoading || importing}
            >
              刷新预览
            </Button>
          </div>
          <Select
            value={presetValue}
            onChange={(value) => setPattern(value)}
            options={CHAPTER_PATTERNS}
            style={{ width: "100%", marginBottom: 8 }}
            disabled={importing}
            placeholder="选择预设（可选）"
          />
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="例如：^第.+章.*"
            disabled={importing}
          />
        </div>

        {(importing || progress) && (
          <div>
            <div style={{ marginBottom: 6 }}>
              导入进度：{progress?.completed ?? 0}/{progress?.total ?? previews.length}
              {progress?.currentTitle ? `（${progress.currentTitle}）` : ""}
            </div>
            <Progress percent={progressPercent} status={importing ? "active" : "normal"} />
          </div>
        )}

        <div>
          <div style={{ marginBottom: 6 }}>
            预览（识别到 {previews.length} 个章节）
            {previewLoading ? "，加载中…" : ""}
          </div>
          <List
            size="small"
            bordered
            dataSource={previews}
            style={{ maxHeight: 300, overflow: "auto" }}
            renderItem={(item, index) => (
              <List.Item>
                <span>
                  {index + 1}. {item.title}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {item.wordCount.toLocaleString()} 字
                </span>
              </List.Item>
            )}
          />
        </div>
      </div>
    </Modal>
  );
}
