import { useCharacterStore } from '../store/characterStore';
import { useFactionStore } from '../store/factionStore';

export function buildWorldSummary(): string {
  const { characters, relationships } = useCharacterStore.getState();
  const { factions } = useFactionStore.getState();

  if (characters.length === 0 && factions.length === 0) {
    return '';
  }

  const lines: string[] = ['## 当前世界观设定'];

  if (characters.length > 0) {
    lines.push('');
    lines.push('### 人物');
    for (const char of characters.slice(0, 20)) {
      const desc = char.description || '暂无描述';
      lines.push(`- ${char.name}: ${desc}`);
    }
    if (characters.length > 20) {
      lines.push(`- ...（共 ${characters.length} 个人物）`);
    }
  }

  if (relationships.length > 0) {
    lines.push('');
    lines.push('### 人物关系');
    for (const rel of relationships.slice(0, 15)) {
      const from = characters.find((c) => c.id === rel.from)?.name ?? '?';
      const to = characters.find((c) => c.id === rel.to)?.name ?? '?';
      lines.push(`- ${from} → ${to}: ${rel.type}${rel.description ? `（${rel.description}）` : ''}`);
    }
  }

  if (factions.length > 0) {
    lines.push('');
    lines.push('### 势力/组织');
    for (const faction of factions.slice(0, 10)) {
      lines.push(`- ${faction.name}: ${faction.description || '暂无描述'}`);
    }
  }

  return lines.join('\n');
}
