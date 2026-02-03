export interface ModelInfo {
  id: string
  name?: string
  owned_by?: string
}

export interface ModelsResponse {
  data: ModelInfo[]
  object: string
}

function authHeaders(providerType: string, apiKey: string): Record<string, string> {
  const key = apiKey ?? ''
  if (!key) return {}

  switch (providerType) {
    case 'google':
      return { 'x-goog-api-key': key }
    case 'anthropic':
      return { 'x-api-key': key }
    default:
      return { Authorization: `Bearer ${key}` }
  }
}

function joinURL(baseURL: string, path: string): string {
  const normalizedBase = baseURL.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

function ensureV1(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items.filter((m) => m && m.trim()).map((m) => m.trim()))).sort()
}

async function fetchModelsOnce(baseURL: string, apiKey: string, providerType: string): Promise<string[]> {
  const url = joinURL(baseURL, '/models')

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...authHeaders(providerType, apiKey),
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
  }

  const data: ModelsResponse = await response.json()
  return data.data.map((m) => m.id)
}

export async function fetchModels(
  baseURL: string,
  apiKey: string,
  providerType: string = 'openai-compatible',
): Promise<string[]> {
  const normalizedBaseURL = baseURL.trim()
  try {
    return uniqueSorted(await fetchModelsOnce(normalizedBaseURL, apiKey, providerType))
  } catch (error) {
    // Fallback: users often input a host without `/v1`, but OpenAI-compatible APIs expect `/v1/models`.
    const message = error instanceof Error ? error.message : String(error)
    const trimmed = normalizedBaseURL.replace(/\/+$/, '')
    const hasV1 = trimmed.endsWith('/v1')
    if (message.includes('404') && !hasV1) {
      return uniqueSorted(await fetchModelsOnce(ensureV1(normalizedBaseURL), apiKey, providerType))
    }
    throw error
  }
}
