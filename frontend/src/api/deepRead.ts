const API_BASE_URL = 'http://localhost:8765'

export interface StartDeepReadRequest {
  paper_id: string
  paper_title?: string
  paper_content?: string
}

export interface KeyTechnique {
  name: string
  description: string
}

export interface Stage1Result {
  tl_dr: string
  research_problem: string
  core_insight: string
  method_overview: string[]
}

export interface KeyResultItem {
  metric: string
  value: string
  interpretation: string
}

export interface CriticalReading {
  strengths: string[]
  limitations: string[]
  reproducibility: string
}

export interface Stage2Result {
  key_techniques: KeyTechnique[]
  differences_from_baseline: string
  assumptions: string[]
  experimental_setup: string
  key_results: KeyResultItem[]
  surprising_findings: string[]
  critical_reading: CriticalReading
}

export interface RelatedPaper {
  arxiv_id: string
  title: string
  authors: string[]
  year: string | null
  relevance: string | null
}

export interface Stage3Result {
  predecessor_papers: RelatedPaper[]
  successor_papers: RelatedPaper[]
  field_position: string
}

export interface DeepReadStages {
  '1'?: Stage1Result & { error?: string }
  '2'?: Stage2Result & { error?: string }
  '3'?: Stage3Result & { error?: string }
}

export interface DeepReadResult {
  task_id?: string
  paper_id?: string
  paper_title: string
  stages: DeepReadStages
  current_stage: number
}

export interface DeepReadStatus {
  task_id: string
  paper_id: string
  paper_title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  current_stage: number
  stages?: DeepReadStages
  error?: string
  created_at: string
  updated_at: string
}

export interface DeepReadTask {
  task_id: string
  paper_id: string
  paper_title: string
  status: DeepReadStatus['status']
  progress: number
  current_stage: number
  stages?: DeepReadStages
  error?: string
  created_at: string
  updated_at: string
}

export interface PollProgress {
  progress: number
  currentStage: number
  stages: DeepReadStages
  status: DeepReadStatus['status']
}

export const deepReadApi = {
  async startDeepRead(request: StartDeepReadRequest): Promise<{ task_id: string; status: string }> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`Failed to start deep read: ${response.statusText}`)
    }

    return response.json()
  },

  async getStatus(taskId: string): Promise<DeepReadStatus> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/${taskId}/status`)

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`)
    }

    return response.json()
  },

  async getResult(taskId: string): Promise<DeepReadResult> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/${taskId}/result`)

    if (!response.ok) {
      throw new Error(`Failed to get result: ${response.statusText}`)
    }

    return response.json()
  },

  async listTasks(): Promise<{ tasks: DeepReadTask[] }> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/`)

    if (!response.ok) {
      throw new Error(`Failed to list tasks: ${response.statusText}`)
    }

    return response.json()
  },

  async getByPaper(paperId: string): Promise<DeepReadTask> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/paper/${encodeURIComponent(paperId)}`)

    if (response.status === 404) {
      throw new Error('NOT_FOUND')
    }

    if (!response.ok) {
      throw new Error(`Failed to get deep read result: ${response.statusText}`)
    }

    return response.json()
  },

  async deleteTask(taskId: string): Promise<{ message: string; task_id: string }> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/${taskId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to delete task: ${response.statusText}`)
    }

    return response.json()
  },

  async pollUntilComplete(
    taskId: string,
    onProgress?: (progress: PollProgress) => void,
  ): Promise<DeepReadResult> {
    while (true) {
      const status = await this.getStatus(taskId)

      if (onProgress) {
        onProgress({
          progress: status.progress,
          currentStage: status.current_stage,
          stages: status.stages || {},
          status: status.status,
        })
      }

      if (status.status === 'completed') {
        return {
          task_id: status.task_id,
          paper_id: status.paper_id,
          paper_title: status.paper_title,
          stages: status.stages || {},
          current_stage: status.current_stage,
        }
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Task failed')
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  },
}
