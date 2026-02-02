# T4.6 实现写作预设 UI

## 目标
实现写作预设配置界面，用户可以自定义写作风格、叙事视角、写作规则等。

## 输入
- T4.2 完成的 AI 面板框架
- 项目配置存储能力

## 输出
- 写作预设配置组件
- 预设数据持久化

## 数据结构

### WritingPreset（写作预设）
```typescript
interface WritingPreset {
  id: string;
  name: string;
  isDefault: boolean;
  style: WritingStyle;
  rules: string[];
  customPrompt: string;  // 自定义系统提示词补充
}

interface WritingStyle {
  tone: string;           // 文风：轻松幽默/严肃深沉/温馨治愈/...
  perspective: string;    // 视角：第一人称/第三人称有限/第三人称全知/...
  tense: string;          // 时态：过去式/现在式
  description: string;    // 描写风格：细腻/简洁/华丽/...
}
```

### 存储位置
```
MyNovel/
├── config.json
│   └── presets: WritingPreset[]
│   └── activePresetId: string
```

## UI 设计

### 预设选择器（AI 面板顶部）
```
┌─────────────────────────────────┐
│  预设: 默认风格  ▼  [⚙️]        │  ← 下拉选择 + 设置按钮
└─────────────────────────────────┘
```

### 预设设置抽屉/弹窗
```
┌─────────────────────────────────────────────┐
│  写作预设设置                          [×]  │
├─────────────────────────────────────────────┤
│  预设列表                                   │
│  ┌─────────────────────────────────────┐   │
│  │ ✓ 默认风格                    [编辑] │   │
│  │   轻松幽默风格                [编辑] │   │
│  │   严肃深沉风格                [编辑] │   │
│  │   + 新建预设                         │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  当前预设: 默认风格                         │
├─────────────────────────────────────────────┤
│  文风                                       │
│  ┌─────────────────────────────────────┐   │
│  │ 轻松幽默 / 严肃深沉 / 温馨治愈 / 自定义 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  叙事视角                                   │
│  ┌─────────────────────────────────────┐   │
│  │ ○ 第一人称                          │   │
│  │ ● 第三人称有限                      │   │
│  │ ○ 第三人称全知                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  时态                                       │
│  ┌─────────────────────────────────────┐   │
│  │ ● 过去式  ○ 现在式                  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  描写风格                                   │
│  ┌─────────────────────────────────────┐   │
│  │ 细腻 / 简洁 / 华丽 / 自定义          │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  写作规则                                   │
│  ┌─────────────────────────────────────┐   │
│  │ • 避免过多心理描写           [×]    │   │
│  │ • 对话要简洁有力             [×]    │   │
│  │ • 场景描写要有画面感         [×]    │   │
│  │ + 添加规则                          │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  自定义提示词补充                           │
│  ┌─────────────────────────────────────┐   │
│  │ 参考金庸的武侠风格，注重江湖气息... │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│           [保存]  [重置为默认]              │
└─────────────────────────────────────────────┘
```

## 组件结构

### PresetSelector.tsx（预设选择器）
```tsx
interface PresetSelectorProps {
  presets: WritingPreset[];
  activePresetId: string;
  onSelect: (presetId: string) => void;
  onOpenSettings: () => void;
}
```

### PresetSettingsDrawer.tsx（预设设置抽屉）
```tsx
interface PresetSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  presets: WritingPreset[];
  activePresetId: string;
  onSave: (presets: WritingPreset[], activeId: string) => void;
}
```

### PresetForm.tsx（预设编辑表单）
```tsx
interface PresetFormProps {
  preset: WritingPreset;
  onChange: (preset: WritingPreset) => void;
}

function PresetForm({ preset, onChange }: PresetFormProps) {
  return (
    <Form layout="vertical">
      <Form.Item label="预设名称">
        <Input value={preset.name} onChange={...} />
      </Form.Item>
      
      <Form.Item label="文风">
        <Select value={preset.style.tone} onChange={...}>
          <Option value="轻松幽默">轻松幽默</Option>
          <Option value="严肃深沉">严肃深沉</Option>
          <Option value="温馨治愈">温馨治愈</Option>
          <Option value="悬疑紧张">悬疑紧张</Option>
          <Option value="custom">自定义...</Option>
        </Select>
      </Form.Item>
      
      <Form.Item label="叙事视角">
        <Radio.Group value={preset.style.perspective} onChange={...}>
          <Radio value="第一人称">第一人称</Radio>
          <Radio value="第三人称有限">第三人称有限</Radio>
          <Radio value="第三人称全知">第三人称全知</Radio>
        </Radio.Group>
      </Form.Item>
      
      <Form.Item label="时态">
        <Radio.Group value={preset.style.tense} onChange={...}>
          <Radio value="过去式">过去式</Radio>
          <Radio value="现在式">现在式</Radio>
        </Radio.Group>
      </Form.Item>
      
      <Form.Item label="描写风格">
        <Select value={preset.style.description} onChange={...}>
          <Option value="细腻">细腻</Option>
          <Option value="简洁">简洁</Option>
          <Option value="华丽">华丽</Option>
          <Option value="写实">写实</Option>
        </Select>
      </Form.Item>
      
      <Form.Item label="写作规则">
        <RulesList rules={preset.rules} onChange={...} />
      </Form.Item>
      
      <Form.Item label="自定义提示词补充">
        <Input.TextArea 
          value={preset.customPrompt} 
          onChange={...}
          rows={4}
          placeholder="添加额外的写作要求或风格参考..."
        />
      </Form.Item>
    </Form>
  );
}
```

### RulesList.tsx（规则列表）
```tsx
interface RulesListProps {
  rules: string[];
  onChange: (rules: string[]) => void;
}

function RulesList({ rules, onChange }: RulesListProps) {
  const [newRule, setNewRule] = useState('');
  
  const addRule = () => {
    if (newRule.trim()) {
      onChange([...rules, newRule.trim()]);
      setNewRule('');
    }
  };
  
  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };
  
  return (
    <div className="rules-list">
      {rules.map((rule, index) => (
        <Tag key={index} closable onClose={() => removeRule(index)}>
          {rule}
        </Tag>
      ))}
      <Input
        size="small"
        placeholder="添加规则..."
        value={newRule}
        onChange={e => setNewRule(e.target.value)}
        onPressEnter={addRule}
        suffix={<PlusOutlined onClick={addRule} />}
      />
    </div>
  );
}
```

## 预设应用到系统提示词

```typescript
function buildSystemPrompt(preset: WritingPreset, basePrompt: string): string {
  const styleDesc = `
写作风格要求：
- 文风：${preset.style.tone}
- 叙事视角：${preset.style.perspective}
- 时态：${preset.style.tense}
- 描写风格：${preset.style.description}
`;

  const rulesDesc = preset.rules.length > 0 
    ? `\n写作规则：\n${preset.rules.map(r => `- ${r}`).join('\n')}`
    : '';

  const customDesc = preset.customPrompt 
    ? `\n额外要求：\n${preset.customPrompt}`
    : '';

  return `${basePrompt}\n${styleDesc}${rulesDesc}${customDesc}`;
}
```

## Tauri Commands

```rust
#[tauri::command]
pub async fn get_presets(project_path: String) -> Result<Vec<WritingPreset>, String>

#[tauri::command]
pub async fn save_presets(
    project_path: String, 
    presets: Vec<WritingPreset>,
    active_preset_id: String,
) -> Result<(), String>
```

## 验收标准
1. [ ] 能显示预设列表
2. [ ] 能切换当前预设
3. [ ] 能创建新预设
4. [ ] 能编辑预设（文风、视角、时态、描写风格）
5. [ ] 能添加/删除写作规则
6. [ ] 能输入自定义提示词
7. [ ] 预设正确保存到项目配置
8. [ ] 预设正确应用到 AI 系统提示词
9. [ ] 样式适配双主题
10. [ ] `npm run build` 通过

## 默认预设
```typescript
const defaultPreset: WritingPreset = {
  id: 'default',
  name: '默认风格',
  isDefault: true,
  style: {
    tone: '自然流畅',
    perspective: '第三人称有限',
    tense: '过去式',
    description: '适中',
  },
  rules: [],
  customPrompt: '',
};
```
