export interface ModelInfo {
  id: string
  name?: string
  owned_by?: string
}

export interface ModelsResponse {
  data: ModelInfo[]
  object: string
}

function joinURL(baseURL: string, path: string): string {
  const normalizedBase = baseURL.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

export async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  const url = joinURL(baseURL, '/models')

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
  }

  const data: ModelsResponse = await response.json()
  return data.data.map((m) => m.id)
}
