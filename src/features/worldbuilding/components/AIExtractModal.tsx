import React, { useState } from 'react';
import { Modal, Button, Input, Tabs, Checkbox, Table, Space, message, Spin, Tag, Alert } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { aiExtract } from '../../../lib/ai';
import { useCharacterStore } from '../store/characterStore';
import { useFactionStore } from '../store/factionStore';
import { useTimelineStore } from '../store/timelineStore';
import { buildMergePreview, type MergePreview } from '../utils/mergeExtracted';

const { TextArea } = Input;

interface AIExtractModalProps {
  visible: boolean;
  onClose: () => void;
  projectPath?: string;
}

type SourceType = 'paste' | 'chapters';

const AIExtractModal: React.FC<AIExtractModalProps> = ({ visible, onClose, projectPath }) => {
  const [source, setSource] = useState<SourceType>('paste');
  const [pasteText, setPasteText] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [selectedNewChars, setSelectedNewChars] = useState<Set<number>>(new Set());
  const [selectedNewRels, setSelectedNewRels] = useState<Set<number>>(new Set());

  const { characters, relationships, addCharacter, addRelationship, updateCharacter } =
    useCharacterStore();
  const { addFaction } = useFactionStore();
  const { addTimeline, addEvent } = useTimelineStore();

  const handleExtract = async () => {
    let text = '';
    if (source === 'paste') {
      text = pasteText.trim();
    } else if (projectPath) {
      try {
        const chapters = await invoke<Array<{ id: string; title: string }>>('list_chapters', {
          projectPath,
        });
        const contents: string[] = [];
        for (const ch of chapters.slice(0, 10)) {
          const content = await invoke<string>('get_chapter_content', {
            projectPath,
            chapterId: ch.id,
          });
          contents.push(content);
        }
        text = contents.join('\n\n---\n\n');
      } catch {
        message.error('读取章节失败');
        return;
      }
    }

    if (!text || text.length < 50) {
      message.warning('文本内容太短（至少 50 字），无法有效提取');
      return;
    }

    // 截取前 8000 字符避免 token 溢出
    const truncated = text.slice(0, 8000);

    setLoading(true);
    try {
      const result = await aiExtract({ text: truncated });
      if (!result.structured) {
        message.error('AI 未能返回结构化数据，请重试');
        setLoading(false);
        return;
      }
      const mergePreview = buildMergePreview(result.structured, characters, relationships);
      setPreview(mergePreview);
      // 默认全选新增项
      setSelectedNewChars(new Set(mergePreview.newCharacters.map((_, i) => i)));
      setSelectedNewRels(new Set(mergePreview.newRelationships.map((_, i) => i)));
    } catch (err) {
      message.error(`提取失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    if (!preview) return;

    // 导入选中的新角色，并建立名称 → ID 映射
    const charNameToId = new Map<string, string>();
    characters.forEach((c) => charNameToId.set(c.name, c.id));

    for (const [i, char] of preview.newCharacters.entries()) {
      if (!selectedNewChars.has(i)) continue;
      const created = addCharacter({
        name: char.name,
        description: char.description,
        attributes: {},
      });
      charNameToId.set(char.name, created.id);
    }

    // 更新已有角色
    for (const { existing, updates } of preview.updatedCharacters) {
      updateCharacter(existing.id, updates);
    }

    // 导入选中的关系
    for (const [i, rel] of preview.newRelationships.entries()) {
      if (!selectedNewRels.has(i)) continue;
      const fromId = charNameToId.get(rel.from);
      const toId = charNameToId.get(rel.to);
      if (fromId && toId) {
        addRelationship({
          from: fromId,
          to: toId,
          type: rel.type as Parameters<typeof addRelationship>[0]['type'],
          description: rel.description,
        });
      }
    }

    // 导入势力
    for (const faction of preview.newFactions) {
      addFaction({
        name: faction.name,
        description: faction.description,
        parentId: null,
        members: faction.members,
        attributes: {},
      });
    }

    // 导入事件到默认时间线
    if (preview.newEvents.length > 0) {
      let timelineId = useTimelineStore.getState().activeTimelineId;
      if (!timelineId) {
        const tl = addTimeline({ name: 'AI 提取的时间线', description: '' });
        timelineId = tl.id;
      }
      preview.newEvents.forEach((event, idx) => {
        addEvent(timelineId!, {
          title: event.title,
          description: event.description,
          type: event.type as Parameters<typeof addEvent>[1]['type'],
          date: '',
          order: idx,
          tags: event.characters,
          characters: [],
          factions: [],
        });
      });
    }

    message.success('世界观数据已导入');
    setPreview(null);
    onClose();
  };

  const handleClose = () => {
    setPreview(null);
    setPasteText('');
    onClose();
  };

  return (
    <Modal
      title={
        <>
          <RobotOutlined /> AI 提取世界观
        </>
      }
      open={visible}
      onCancel={handleClose}
      width={720}
      footer={
        preview ? (
          <Space>
            <Button onClick={() => setPreview(null)}>返回</Button>
            <Button type="primary" onClick={handleImport}>
              确认导入
            </Button>
          </Space>
        ) : null
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>AI 正在分析文本，提取人物、关系、势力、事件...</div>
        </div>
      ) : preview ? (
        <div>
          {preview.newCharacters.length > 0 && (
            <>
              <h4>新增人物 ({preview.newCharacters.length})</h4>
              <Table
                size="small"
                dataSource={preview.newCharacters.map((c, i) => ({ ...c, key: i }))}
                pagination={false}
                columns={[
                  {
                    title: '',
                    width: 40,
                    render: (_: unknown, __: unknown, i: number) => (
                      <Checkbox
                        checked={selectedNewChars.has(i)}
                        onChange={(e) => {
                          const next = new Set(selectedNewChars);
                          e.target.checked ? next.add(i) : next.delete(i);
                          setSelectedNewChars(next);
                        }}
                      />
                    ),
                  },
                  { title: '名称', dataIndex: 'name' },
                  { title: '描述', dataIndex: 'description', ellipsis: true },
                  { title: '角色', dataIndex: 'role', width: 80 },
                ]}
              />
            </>
          )}
          {preview.updatedCharacters.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>
                更新现有人物 ({preview.updatedCharacters.length})
              </h4>
              {preview.updatedCharacters.map(({ existing, updates }) => (
                <Alert
                  key={existing.id}
                  type="info"
                  showIcon={false}
                  message={`${existing.name}: 补充 ${Object.keys(updates).join(', ')}`}
                  style={{ marginBottom: 4 }}
                />
              ))}
            </>
          )}
          {preview.newRelationships.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>新增关系 ({preview.newRelationships.length})</h4>
              <Table
                size="small"
                dataSource={preview.newRelationships.map((r, i) => ({ ...r, key: i }))}
                pagination={false}
                columns={[
                  {
                    title: '',
                    width: 40,
                    render: (_: unknown, __: unknown, i: number) => (
                      <Checkbox
                        checked={selectedNewRels.has(i)}
                        onChange={(e) => {
                          const next = new Set(selectedNewRels);
                          e.target.checked ? next.add(i) : next.delete(i);
                          setSelectedNewRels(next);
                        }}
                      />
                    ),
                  },
                  { title: '从', dataIndex: 'from', width: 100 },
                  { title: '到', dataIndex: 'to', width: 100 },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 80,
                    render: (t: string) => <Tag>{t}</Tag>,
                  },
                  { title: '描述', dataIndex: 'description', ellipsis: true },
                ]}
              />
            </>
          )}
          {preview.newFactions.length > 0 && (
            <h4 style={{ marginTop: 16 }}>
              新增势力: {preview.newFactions.map((f) => f.name).join(', ')}
            </h4>
          )}
          {preview.newEvents.length > 0 && (
            <h4 style={{ marginTop: 16 }}>新增事件: {preview.newEvents.length} 个</h4>
          )}
          {preview.newCharacters.length === 0 &&
            preview.updatedCharacters.length === 0 &&
            preview.newRelationships.length === 0 &&
            preview.newFactions.length === 0 &&
            preview.newEvents.length === 0 && (
              <Alert type="info" message="文本中未发现新的世界观信息" />
            )}
        </div>
      ) : (
        <Tabs
          activeKey={source}
          onChange={(k) => setSource(k as SourceType)}
          items={[
            {
              key: 'paste',
              label: '粘贴文本',
              children: (
                <div>
                  <TextArea
                    rows={10}
                    placeholder="粘贴小说文本，AI 将自动提取人物、关系、势力、事件..."
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <Button
                    type="primary"
                    style={{ marginTop: 12 }}
                    onClick={handleExtract}
                    disabled={!pasteText.trim()}
                  >
                    开始提取
                  </Button>
                </div>
              ),
            },
            ...(projectPath
              ? [
                  {
                    key: 'chapters' as const,
                    label: '从章节提取',
                    children: (
                      <div>
                        <Alert
                          type="info"
                          message="将读取项目的前 10 个章节，合并后交给 AI 分析"
                          style={{ marginBottom: 12 }}
                        />
                        <Button type="primary" onClick={handleExtract}>
                          开始提取
                        </Button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </Modal>
  );
};

export default AIExtractModal;
