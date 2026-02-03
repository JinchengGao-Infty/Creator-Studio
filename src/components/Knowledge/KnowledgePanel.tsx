import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button, Card, Checkbox, Input, List, Modal, Space, Typography, message } from "antd";
import { EditOutlined, FileAddOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { formatError } from "../../utils/error";

interface KnowledgePanelProps {
  projectPath: string;
}

interface KnowledgeDoc {
  path: string;
  name: string;
  bytes: number;
  modifiedAt: number;
  enabled: boolean;
}

interface RagIndexSummary {
  createdAt: number;
  docCount: number;
  chunkCount: number;
  model: string;
}

interface RagHit {
  path: string;
  score: number;
  text: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeDocName(name: string): string {
  const trimmed = (name ?? "").trim();
  const safe = trimmed.replace(/[\\\\/:*?\"<>|]/g, "-");
  return safe || "knowledge";
}

function defaultDocPath(fileName: string): string {
  const base = normalizeDocName(fileName);
  const withExt = /\.[a-z0-9]+$/i.test(base) ? base : `${base}.md`;
  return `knowledge/${withExt}`;
}

function joinPath(parent: string, child: string): string {
  const trimmedParent = (parent ?? "").replace(/[\\/]+$/, "");
  const separator = trimmedParent.includes("\\") ? "\\" : "/";
  if (!trimmedParent) return child;
  return `${trimmedParent}${separator}${child}`;
}

export default function KnowledgePanel({ projectPath }: KnowledgePanelProps) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [selectedDocContent, setSelectedDocContent] = useState<string>("");
  const [editingOpen, setEditingOpen] = useState(false);
  const [editingText, setEditingText] = useState("");
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("人物设定");
  const [newDocContent, setNewDocContent] = useState("");
  const [selectedText, setSelectedText] = useState<string>("");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RagHit[]>([]);
  const [searching, setSearching] = useState(false);

  const enabledCount = useMemo(() => docs.filter((d) => d.enabled).length, [docs]);
  const knowledgeAbs = useMemo(() => joinPath(projectPath, "knowledge"), [projectPath]);
  const ragAbs = useMemo(() => joinPath(projectPath, ".creatorai/rag"), [projectPath]);
  const localModelAbs = useMemo(
    () => joinPath(projectPath, ".creatorai/rag/models/Xenova/bge-small-zh-v1.5"),
    [projectPath],
  );

  const handleOpenPath = async (path: string) => {
    if (!isTauri()) {
      message.info("当前为 Web 环境，无法直接打开本地目录。");
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      message.error(`打开失败: ${formatError(error)}`);
    }
  };

  const loadDocs = async () => {
    setLoading(true);
    try {
      const list = (await invoke("rag_list_docs", { projectPath })) as KnowledgeDoc[];
      setDocs(Array.isArray(list) ? list : []);
    } catch (error) {
      message.error(`加载知识库失败: ${formatError(error)}`);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  const loadDocContent = async (path: string) => {
    try {
      const content = (await invoke("rag_read_doc", { projectPath, docPath: path })) as string;
      setSelectedDocContent(content ?? "");
    } catch (error) {
      message.error(`读取失败: ${formatError(error)}`);
      setSelectedDocContent("");
    }
  };

  useEffect(() => {
    void loadDocs();
  }, [projectPath]);

  useEffect(() => {
    if (!selectedDocPath) {
      setSelectedDocContent("");
      return;
    }
    void loadDocContent(selectedDocPath);
  }, [projectPath, selectedDocPath]);

  useEffect(() => {
    const onSelection = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string; text: string }>;
      if (!detail || detail.projectPath !== projectPath) return;
      setSelectedText(detail.text ?? "");
    };
    window.addEventListener("creatorai:editorSelection", onSelection);
    return () => window.removeEventListener("creatorai:editorSelection", onSelection);
  }, [projectPath]);

  const handleToggleEnabled = async (docPath: string, enabled: boolean) => {
    try {
      await invoke("rag_set_doc_enabled", { projectPath, docPath, enabled });
      setDocs((prev) => prev.map((d) => (d.path === docPath ? { ...d, enabled } : d)));
    } catch (error) {
      message.error(`更新失败: ${formatError(error)}`);
    }
  };

  const handleBuildIndex = async () => {
    setBuilding(true);
    message.loading({ content: "正在构建向量索引（首次会下载模型）...", key: "rag", duration: 0 });
    try {
      const summary = (await invoke("rag_build_index", { projectPath })) as RagIndexSummary;
      message.success({
        content: `索引完成：${summary.docCount} 文档 / ${summary.chunkCount} 片段（${summary.model}）`,
        key: "rag",
      });
    } catch (error) {
      message.error({ content: `构建失败: ${formatError(error)}`, key: "rag" });
    } finally {
      setBuilding(false);
    }
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const result = (await invoke("rag_search", { projectPath, query: q, topK: 5 })) as RagHit[];
      setHits(Array.isArray(result) ? result : []);
    } catch (error) {
      message.error(`检索失败: ${formatError(error)}`);
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const openEditDoc = () => {
    if (!selectedDocPath) return;
    setEditingText(selectedDocContent);
    setEditingOpen(true);
  };

  const saveEditDoc = async () => {
    if (!selectedDocPath) return;
    try {
      await invoke("rag_write_doc", { projectPath, docPath: selectedDocPath, content: editingText });
      setEditingOpen(false);
      setSelectedDocContent(editingText);
      void loadDocs();
      message.success("已保存");
    } catch (error) {
      message.error(`保存失败: ${formatError(error)}`);
    }
  };

  const appendSelectionToDoc = async () => {
    const text = selectedText.trim();
    if (!text) {
      message.info("请先在编辑器中选中一段文本");
      return;
    }
    if (!selectedDocPath) {
      setNewDocContent(text);
      setCreatingOpen(true);
      return;
    }
    try {
      await invoke("rag_append_doc", { projectPath, docPath: selectedDocPath, content: text });
      message.success("已追加到知识库");
      void loadDocContent(selectedDocPath);
      void loadDocs();
    } catch (error) {
      message.error(`追加失败: ${formatError(error)}`);
    }
  };

  const createDocFromSelection = async () => {
    const targetPath = defaultDocPath(newDocName);
    const content = newDocContent.trim();
    if (!content) {
      message.error("内容不能为空");
      return;
    }
    try {
      await invoke("rag_write_doc", { projectPath, docPath: targetPath, content });
      message.success("已创建知识文档");
      setCreatingOpen(false);
      setSelectedDocPath(targetPath);
      setSelectedDocContent(content);
      void loadDocs();
    } catch (error) {
      message.error(`创建失败: ${formatError(error)}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Card
        title="知识库（RAG）"
        size="small"
        style={{ marginBottom: 12 }}
        extra={
          <Space size={6}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void loadDocs()}
              disabled={loading}
              title="刷新"
            />
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => void handleBuildIndex()}
              loading={building}
              disabled={!enabledCount}
              title="构建索引"
            >
              构建索引
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph style={{ marginBottom: 8, color: "var(--text-secondary)" }}>
          把人物/设定/时间线等资料放在 <Typography.Text code>{knowledgeAbs}</Typography.Text>{" "}
          （支持 .md/.txt），AI 可通过 <Typography.Text code>rag_search</Typography.Text> 检索这些资料。
          <br />
          索引保存位置：<Typography.Text code>{ragAbs}</Typography.Text>。
          <br />
          嵌入模型默认会在首次点击“构建索引”时下载（国内可能无法访问 HuggingFace）。你也可以手动下载模型文件并放到：{" "}
          <Typography.Text code>{localModelAbs}</Typography.Text>{" "}
          （需要：onnx/model.onnx、tokenizer.json、config.json、special_tokens_map.json、tokenizer_config.json）。
          <br />
          下载失败时应用会自动尝试使用镜像（例如 <Typography.Text code>https://hf-mirror.com</Typography.Text>）。
          你也可以在启动应用前手动设置环境变量 <Typography.Text code>HF_ENDPOINT</Typography.Text>{" "}
          （或从魔搭/ModelScope 等平台下载文件后放到上面目录）。
        </Typography.Paragraph>

        <Space size={6} wrap>
          <Button size="small" onClick={() => void handleOpenPath(knowledgeAbs)}>
            打开 knowledge/
          </Button>
          <Button size="small" onClick={() => void handleOpenPath(ragAbs)}>
            打开 .creatorai/rag/
          </Button>
          <Button size="small" onClick={() => void handleOpenPath(localModelAbs)}>
            打开嵌入模型目录
          </Button>
        </Space>

        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="测试检索：输入问题/关键词"
            onPressEnter={() => void handleSearch()}
          />
          <Button onClick={() => void handleSearch()} loading={searching}>
            检索
          </Button>
        </Space.Compact>
      </Card>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Card
          title={`文档（已启用 ${enabledCount}/${docs.length}）`}
          size="small"
          style={{ marginBottom: 12 }}
          extra={
            <Space size={6}>
              <Button
                size="small"
                icon={<FileAddOutlined />}
                onClick={() => {
                  setNewDocContent(selectedText.trim());
                  setCreatingOpen(true);
                }}
              >
                新建
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={openEditDoc}
                disabled={!selectedDocPath}
              >
                编辑
              </Button>
            </Space>
          }
        >
          <List
            size="small"
            dataSource={docs}
            loading={loading}
            locale={{ emptyText: "暂无文档（请在 knowledge/ 放入 .md/.txt）" }}
            renderItem={(doc) => (
              <List.Item
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedDocPath(doc.path)}
              >
                <List.Item.Meta
                  title={
                    <Space size={8}>
                      <Checkbox
                        checked={doc.enabled}
                        onChange={(e) => {
                          e.stopPropagation();
                          void handleToggleEnabled(doc.path, e.target.checked);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span style={{ fontWeight: doc.path === selectedDocPath ? 600 : 400 }}>
                        {doc.name}
                      </span>
                    </Space>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {doc.path} · {formatBytes(doc.bytes)}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />

          {selectedDocPath ? (
            <div style={{ marginTop: 10 }}>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text strong>预览</Typography.Text>
                <Button size="small" onClick={() => void appendSelectionToDoc()}>
                  追加选中文本
                </Button>
              </Space>
              <div
                style={{
                  marginTop: 8,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  background: "var(--bg-tertiary)",
                  maxHeight: 220,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                }}
              >
                {selectedDocContent || <span style={{ color: "var(--text-secondary)" }}>（空）</span>}
              </div>
            </div>
          ) : null}
        </Card>

        <Card title={`检索结果（${hits.length}）`} size="small">
          {hits.length ? (
            <List
              size="small"
              dataSource={hits}
              renderItem={(hit) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space size={8}>
                        <Typography.Text code>{hit.path}</Typography.Text>
                        <Typography.Text type="secondary">score={hit.score.toFixed(3)}</Typography.Text>
                      </Space>
                    }
                    description={
                      <Typography.Paragraph style={{ marginBottom: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {hit.text.trim().slice(0, 400)}
                        {hit.text.trim().length > 400 ? "…" : ""}
                      </Typography.Paragraph>
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Typography.Text type="secondary">暂无结果</Typography.Text>
          )}
        </Card>
      </div>

      <Modal
        title={`编辑：${selectedDocPath ?? ""}`}
        open={editingOpen}
        onCancel={() => setEditingOpen(false)}
        onOk={() => void saveEditDoc()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input.TextArea
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          autoSize={{ minRows: 10, maxRows: 18 }}
          placeholder="输入内容…"
        />
      </Modal>

      <Modal
        title="新建知识文档"
        open={creatingOpen}
        onCancel={() => setCreatingOpen(false)}
        onOk={() => void createDocFromSelection()}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Input
            value={newDocName}
            onChange={(e) => setNewDocName(e.target.value)}
            placeholder="文件名（例如：人物设定.md）"
          />
          <Input.TextArea
            value={newDocContent}
            onChange={(e) => setNewDocContent(e.target.value)}
            autoSize={{ minRows: 10, maxRows: 16 }}
            placeholder="内容（可直接粘贴）"
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将保存到：<Typography.Text code>{defaultDocPath(newDocName)}</Typography.Text>
          </Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
