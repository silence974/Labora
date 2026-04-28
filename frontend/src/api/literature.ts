const API_BASE_URL = 'http://localhost:8765'

export interface LiteratureSearchRequest {
  query: string
  year?: string
  source?: string
  limit?: number
  online?: boolean
  page?: number
  page_size?: number
}

export interface LiteratureItem {
  paper_id: string
  title: string
  authors: string[]
  year: string
  abstract?: string
  source: string
  url?: string
  source_url?: string
  tags: string[]
  is_downloaded: boolean
  local_source_url?: string
}

export interface LiteratureContentSection {
  key: string
  title: string
  content: string
}

export interface LiteratureDetail extends LiteratureItem {
  published?: string
  updated?: string
  original_sections: LiteratureContentSection[]
  original_text?: string
  content_source?: string
  content_error?: string
}

export interface LiteratureSearchResponse {
  query: string
  page: number
  page_size: number
  total: number
  total_pages: number
  has_prev: boolean
  has_next: boolean
  notice?: string
  results: LiteratureItem[]
}

export interface RecentPaper extends LiteratureItem {}

export interface LiteratureDownloadResponse {
  paper_id: string
  source: string
  source_url: string
  download_url: string
  local_source_url: string
}

export const literatureApi = {
  async search(request: LiteratureSearchRequest): Promise<LiteratureSearchResponse> {
    const response = await fetch(`${API_BASE_URL}/api/literature/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`Failed to search literature: ${response.statusText}`)
    }

    return response.json()
  },

  async getPaperDetail(paperId: string): Promise<LiteratureDetail> {
    const response = await fetch(`${API_BASE_URL}/api/literature/papers/${encodeURIComponent(paperId)}`)

    if (!response.ok) {
      throw new Error(`Failed to load paper detail: ${response.statusText}`)
    }

    return response.json()
  },

  async download(paperId: string, source: string = 'arXiv'): Promise<LiteratureDownloadResponse> {
    const response = await fetch(`${API_BASE_URL}/api/literature/download/${encodeURIComponent(paperId)}?source=${encodeURIComponent(source)}`)

    if (!response.ok) {
      throw new Error(`Failed to download literature: ${response.statusText}`)
    }

    return response.json()
  },

  async getRecent(limit: number = 10): Promise<{ papers: RecentPaper[] }> {
    const response = await fetch(`${API_BASE_URL}/api/literature/recent?limit=${limit}`)

    if (!response.ok) {
      throw new Error(`Failed to get recent papers: ${response.statusText}`)
    }

    return response.json()
  },
}
