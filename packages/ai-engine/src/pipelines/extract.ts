import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { ProviderConfig, ModelParameters } from '../types'
import { ProviderManager } from '../provider'
import { generateText } from 'ai'

const EXTRACT_SYSTEM_PROMPT = `你是一个小说文本分析专家。分析用户提供的小说文本，提取以下结构化信息。

请严格按照 JSON 格式输出，不要输出其他内容。

JSON Schema:
{
  "characters": [
    {
      "name": "string (角色名)",
      "description": "string (简短描述，1-2句)",
      "role": "string (protagonist/antagonist/supporting/minor)",
      "tags": ["string (性格特征或标签)"]
    }
  ],
  "relationships": [
    {
      "from": "string (角色名A)",
      "to": "string (角色名B)",
      "type": "friend|enemy|lover|family|rival|other",
      "description": "string (关系描述)"
    }
  ],
  "factions": [
    {
      "name": "string (组织/势力名)",
      "description": "string (描述)",
      "members": ["string (成员角色名)"]
    }
  ],
  "events": [
    {
      "title": "string (事件标题)",
      "description": "string (事件描述)",
      "type": "normal|plot_point|foreshadowing|turning_point|subplot",
      "characters": ["string (涉及角色名)"]
    }
  ]
}

注意：
- 只提取文本中明确提到的信息，不要虚构
- 角色名使用文本中出现的原名
- 关系的 from/to 使用角色名而非 ID
- 如果某类信息在文本中没有，返回空数组`

export class ExtractPipeline implements Pipeline {
  readonly name = 'extract'

  async run(input: Record<string, unknown>, _runtime: PipelineRuntime): Promise<Record<string, unknown>> {
    const provider = input.provider as ProviderConfig
    const parameters = input.parameters as ModelParameters
    const text = input.text as string

    const providerManager = new ProviderManager()
    providerManager.addProvider(provider)
    const sdk = providerManager.createSDK(provider.id)
    const model = sdk(parameters.model)

    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ] as any,
      maxSteps: 1,
      temperature: 0.1,
      maxTokens: parameters.maxTokens ?? 4000,
    } as any)

    const content = (result as any).text ?? ''

    let structured: unknown = null
    try {
      const jsonStr = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
      structured = JSON.parse(jsonStr)
    } catch {
      structured = null
    }

    return { type: 'extract_result', content, structured }
  }
}
