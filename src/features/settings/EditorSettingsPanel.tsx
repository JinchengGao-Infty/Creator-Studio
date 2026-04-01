/**
 * 编辑器设置面板组件
 *
 * 提供编辑器外观和格式设置的配置界面
 */

import {
  Card,
  Tabs,
  Slider,
  Switch,
  Select,
  Button,
  Upload,
  Typography,
  Tooltip,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useEditorSettingsStore, PRESET_FONTS, PRESET_BACKGROUNDS } from './store/editorSettingsStore';

// 解构 Typography 组件
const { Text } = Typography;

/**
 * 预设背景颜色列表（用于颜色选择）
 */
const PRESET_COLORS = [
  { id: 'paper', name: '纸张', color: '#faf8f5' },
  { id: 'cream', name: '米黄', color: '#fdf6e3' },
  { id: 'sepia', name: '羊皮纸', color: '#f4ecd8' },
  { id: 'sage', name: '淡绿', color: '#e8f0e8' },
  { id: 'sky', name: '淡蓝', color: '#e8f4f8' },
  { id: 'gray', name: '浅灰', color: '#f0f0f0' },
];

/**
 * 背景设置 Tab 组件
 */
function BackgroundTab() {
  const { settings, updateSettings } = useEditorSettingsStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 背景类型选择 */}
      <div>
        <Text strong>背景类型</Text>
        <Select
          value={settings.backgroundType}
          onChange={(v) => updateSettings({ backgroundType: v })}
          style={{ width: '100%', marginTop: 8 }}
          options={[
            { value: 'solid', label: '纯色背景' },
            { value: 'preset', label: '预设背景' },
            { value: 'custom', label: '自定义图片' },
          ]}
        />
      </div>

      {/* 纯色选择 */}
      {settings.backgroundType === 'solid' && (
        <div>
          <Text strong>背景颜色</Text>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {PRESET_COLORS.map((c) => (
              <Tooltip key={c.id} title={c.name}>
                <div
                  onClick={() => updateSettings({ backgroundColor: c.color })}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 4,
                    backgroundColor: c.color,
                    border:
                      settings.backgroundColor === c.color
                        ? '2px solid var(--ant-primary-color, #1890ff)'
                        : '1px solid var(--ant-color-border, #d9d9d9)',
                    cursor: 'pointer',
                  }}
                />
              </Tooltip>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <input
              type="color"
              value={settings.backgroundColor}
              onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
              style={{ width: 100, height: 32, cursor: 'pointer' }}
            />
          </div>
        </div>
      )}

      {/* 预设背景选择 */}
      {settings.backgroundType === 'preset' && (
        <div>
          <Text strong>预设背景</Text>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {PRESET_BACKGROUNDS.map((bg) => (
              <Tooltip key={bg.id} title={bg.name}>
                <div
                  onClick={() => updateSettings({ presetBackground: bg.id })}
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 4,
                    backgroundColor: bg.color,
                    border:
                      settings.presetBackground === bg.id
                        ? '2px solid var(--ant-primary-color, #1890ff)'
                        : '1px solid var(--ant-color-border, #d9d9d9)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    color: '#666',
                  }}
                >
                  {bg.name}
                </div>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {/* 自定义图片上传 */}
      {settings.backgroundType === 'custom' && (
        <div>
          <Text strong>自定义图片</Text>
          <Upload
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                updateSettings({ customBackgroundUrl: e.target?.result as string });
              };
              reader.readAsDataURL(file);
              return false;
            }}
            showUploadList={false}
          >
            <Button icon={<UploadOutlined />}>上传图片</Button>
          </Upload>
          {settings.customBackgroundUrl && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={settings.customBackgroundUrl}
                alt="preview"
                style={{ maxWidth: 200, maxHeight: 100, borderRadius: 4 }}
              />
              <Button
                size="small"
                danger
                onClick={() => updateSettings({ customBackgroundUrl: '' })}
              >
                清除
              </Button>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">适配方式</Text>
            <Select
              value={settings.backgroundFit}
              onChange={(v) => updateSettings({ backgroundFit: v })}
              style={{ width: '100%', marginTop: 4 }}
              options={[
                { value: 'cover', label: '填充（可能裁剪）' },
                { value: 'contain', label: '适应（可能留白）' },
                { value: 'center', label: '居中' },
              ]}
            />
          </div>
          {/* 透明度调节 */}
          <div style={{ marginTop: 16 }}>
            <Text strong>透明度: {settings.backgroundOpacity}%</Text>
            <Slider
              min={0}
              max={100}
              value={settings.backgroundOpacity}
              onChange={(v) => updateSettings({ backgroundOpacity: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 字体设置 Tab 组件
 */
function FontTab() {
  const { settings, updateSettings } = useEditorSettingsStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 字体选择 */}
      <div>
        <Text strong>字体</Text>
        <Select
          value={settings.fontFamily}
          onChange={(v) => updateSettings({ fontFamily: v })}
          style={{ width: '100%', marginTop: 8 }}
          options={PRESET_FONTS.map((f) => ({
            value: f.value,
            label: <span style={{ fontFamily: f.value }}>{f.name}</span>,
          }))}
        />
      </div>

      {/* 字号 */}
      <div>
        <Text strong>字号: {settings.fontSize}px</Text>
        <Slider
          min={14}
          max={24}
          value={settings.fontSize}
          onChange={(v) => updateSettings({ fontSize: v })}
          marks={{
            14: '14',
            16: '16',
            18: '18',
            20: '20',
            22: '22',
            24: '24',
          }}
        />
      </div>

      {/* 行高 */}
      <div>
        <Text strong>行高: {settings.lineHeight}</Text>
        <Slider
          min={1.5}
          max={2.5}
          step={0.1}
          value={settings.lineHeight}
          onChange={(v) => updateSettings({ lineHeight: v })}
          marks={{
            1.5: '1.5',
            2.0: '2.0',
            2.5: '2.5',
          }}
        />
      </div>
    </div>
  );
}

/**
 * 行宽设置 Tab 组件
 */
function LineWidthTab() {
  const { settings, updateSettings } = useEditorSettingsStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 固定行宽开关 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>启用固定行宽</Text>
        <Switch
          checked={settings.fixedLineWidthEnabled}
          onChange={(v) => updateSettings({ fixedLineWidthEnabled: v })}
        />
      </div>

      {settings.fixedLineWidthEnabled && (
        <>
          {/* 字符数 */}
          <div>
            <Text strong>每行字符数: {settings.lineWidth}</Text>
            <Slider
              min={40}
              max={80}
              value={settings.lineWidth}
              onChange={(v) => updateSettings({ lineWidth: v })}
              marks={{
                40: '40',
                60: '60',
                80: '80',
              }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              类似于 Word 的"打字纸"效果
            </Text>
          </div>

          {/* 右边距指示线 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>显示右边距指示线</Text>
            <Switch
              checked={settings.showMarginLine}
              onChange={(v) => updateSettings({ showMarginLine: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 缩进设置 Tab 组件
 */
function IndentTab() {
  const { settings, updateSettings } = useEditorSettingsStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 空格宽度比例 */}
      <div>
        <Text strong>空格宽度: {(settings.spaceWidthRatio * 100).toFixed(0)}%</Text>
        <Slider
          min={0.8}
          max={1.5}
          step={0.05}
          value={settings.spaceWidthRatio}
          onChange={(v) => updateSettings({ spaceWidthRatio: v })}
          marks={{
            1.0: '1字',
            1.2: '1.2字',
            1.5: '1.5字',
          }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          一个空格相对于汉字宽度的比例（100% = 一个汉字位置）
        </Text>
      </div>

      {/* Tab 宽度 */}
      <div>
        <Text strong>Tab 宽度: {settings.tabWidth} 字</Text>
        <Slider
          min={1}
          max={4}
          step={1}
          value={settings.tabWidth}
          onChange={(v) => updateSettings({ tabWidth: v })}
          marks={{
            1: '1字',
            2: '2字',
            3: '3字',
            4: '4字',
          }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          按 Tab 键时插入的宽度（以汉字为基准）
        </Text>
      </div>

      {/* 首行缩进开关 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>首行缩进</Text>
        <Switch
          checked={settings.firstLineIndentEnabled}
          onChange={(v) => updateSettings({ firstLineIndentEnabled: v })}
        />
      </div>

      {settings.firstLineIndentEnabled && (
        <div>
          <Text strong>首行缩进: {settings.firstLineIndentChars} 个字符</Text>
          <Select
            value={settings.firstLineIndentChars}
            onChange={(v) => updateSettings({ firstLineIndentChars: v })}
            style={{ width: '100%', marginTop: 8 }}
            options={[
              { value: 2, label: '2 个字符（约 1 个中文字符宽）' },
              { value: 4, label: '4 个字符（约 2 个中文字符宽）' },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
            新段落自动添加首行缩进
          </Text>
        </div>
      )}
    </div>
  );
}

/**
 * 编辑器设置面板主组件
 */
export function EditorSettingsPanel() {
  const tabItems = [
    {
      key: 'background',
      label: '背景',
      children: <BackgroundTab />,
    },
    {
      key: 'font',
      label: '字体',
      children: <FontTab />,
    },
    {
      key: 'lineWidth',
      label: '行宽',
      children: <LineWidthTab />,
    },
    {
      key: 'indent',
      label: '缩进',
      children: <IndentTab />,
    },
  ];

  return (
    <Card title="编辑器设置" size="small">
      <Tabs items={tabItems} />
    </Card>
  );
}
