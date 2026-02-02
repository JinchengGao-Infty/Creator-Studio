# T3.7 实现字数统计

## 目标

实现底部状态栏的字数统计功能，显示当前章节和全书字数。

## 背景

写作时需要实时了解字数进度。需要显示：
- 当前章节字数
- 全书总字数
- 选中文本字数（可选）

## UI 设计

```
┌─────────────────────────────────────────────────────┐
│                    编辑区域                         │
│                                                     │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│  本章：3,500 字  |  全书：45,200 字  |  已保存 ✓   │
└─────────────────────────────────────────────────────┘
```

## 组件

### StatusBar.tsx

```tsx
import { CheckCircleOutlined, SyncOutlined } from "@ant-design/icons";
import "./status-bar.css";

interface StatusBarProps {
  chapterWordCount: number;
  totalWordCount: number;
  saveStatus: "saved" | "saving" | "unsaved";
}

export function StatusBar({
  chapterWordCount,
  totalWordCount,
  saveStatus,
}: StatusBarProps) {
  const statusIcon = {
    saved: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
    saving: <SyncOutlined spin style={{ color: "#1890ff" }} />,
    unsaved: <span style={{ color: "#faad14" }}>●</span>,
  };

  const statusText = {
    saved: "已保存",
    saving: "保存中...",
    unsaved: "未保存",
  };

  return (
    <div className="status-bar">
      <div className="status-item">
        本章：{chapterWordCount.toLocaleString()} 字
      </div>
      <div className="status-divider">|</div>
      <div className="status-item">
        全书：{totalWordCount.toLocaleString()} 字
      </div>
      <div className="status-divider">|</div>
      <div className="status-item status-save">
        {statusIcon[saveStatus]} {statusText[saveStatus]}
      </div>
    </div>
  );
}
```

### 样式 status-bar.css

```css
.status-bar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  background: #fafaf5;
  border-top: 1px solid #e8e8e0;
  font-size: 12px;
  color: #666;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-divider {
  margin: 0 12px;
  color: #ddd;
}

.status-save {
  margin-left: auto;
}
```

## 字数计算逻辑

```typescript
// utils/wordCount.ts

export function countWords(text: string): number {
  // 去除空白字符后的字符数（适合中文）
  return text.replace(/\s/g, "").length;
}

export function countChineseWords(text: string): number {
  // 只计算中文字符
  return (text.match(/[\u4e00-\u9fa5]/g) || []).length;
}

export function countEnglishWords(text: string): number {
  // 计算英文单词数
  return (text.match(/[a-zA-Z]+/g) || []).length;
}

export function countMixedWords(text: string): number {
  // 中文按字符，英文按单词
  const chinese = countChineseWords(text);
  const english = countEnglishWords(text);
  return chinese + english;
}
```

## 验收标准

- [ ] 状态栏正常显示
- [ ] 本章字数实时更新
- [ ] 全书字数正确计算
- [ ] 保存状态正确显示

## 文件变更

- 新增：`src/components/StatusBar/StatusBar.tsx`
- 新增：`src/components/StatusBar/status-bar.css`
- 新增：`src/utils/wordCount.ts`

## 依赖

- T3.6 完成（编辑器）

---

*任务创建时间：2026-02-02*
