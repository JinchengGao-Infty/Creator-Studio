import { RedoOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";

interface EditorHeaderProps {
  title: string;
  wordCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function EditorHeader({
  title,
  wordCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: EditorHeaderProps) {
  return (
    <div className="editor-header">
      <div className="editor-title">{title}</div>
      <div className="editor-actions">
        <Tooltip title="撤销 (Ctrl+Z)">
          <Button type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} />
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Shift+Z)">
          <Button type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} />
        </Tooltip>
        <span className="editor-word-count">{wordCount.toLocaleString()} 字</span>
      </div>
    </div>
  );
}

