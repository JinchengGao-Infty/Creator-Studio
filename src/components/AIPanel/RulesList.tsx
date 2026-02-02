import { PlusOutlined } from "@ant-design/icons";
import { Input, Tag } from "antd";
import { useMemo, useState } from "react";

interface RulesListProps {
  rules: string[];
  onChange: (rules: string[]) => void;
}

export default function RulesList({ rules, onChange }: RulesListProps) {
  const [newRule, setNewRule] = useState("");

  const normalizedRules = useMemo(() => rules.filter((r) => r.trim()), [rules]);

  const addRule = () => {
    const trimmed = newRule.trim();
    if (!trimmed) return;
    onChange([...normalizedRules, trimmed]);
    setNewRule("");
  };

  const removeRule = (index: number) => {
    onChange(normalizedRules.filter((_, i) => i !== index));
  };

  return (
    <div className="rules-list">
      {normalizedRules.map((rule, index) => (
        <Tag
          key={`${rule}-${index}`}
          closable
          onClose={(e) => {
            e.preventDefault();
            removeRule(index);
          }}
        >
          {rule}
        </Tag>
      ))}
      <Input
        size="small"
        placeholder="添加规则..."
        value={newRule}
        onChange={(e) => setNewRule(e.target.value)}
        onPressEnter={addRule}
        suffix={<PlusOutlined onClick={addRule} style={{ cursor: "pointer" }} />}
      />
    </div>
  );
}

