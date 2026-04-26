const API_BASE_URL = 'http://localhost:8765'

export interface DeepReadRequest {
  paper_title: string
  paper_url?: string
  paper_content?: string
}

export interface DeepReadStatus {
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  result?: DeepReadResult
  error?: string
  created_at: string
  updated_at: string
}

export interface DeepReadResult {
  paper_title: string
  summary: string
  key_points: string[]
  key_quotes: Array<{
    text: string
    section: string
  }>
  citations_count: number
}

export interface DeepReadTask {
  task_id: string
  paper_title: string
  status: string
  progress: number
  created_at: string
}

export const deepReadApi = {
  // 启动深度阅读任务
  async startDeepRead(request: DeepReadRequest): Promise<{ task_id: string; status: string }> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`Failed to start deep read: ${response.statusText}`)
    }

    return response.json()
  },

  // 获取任务状态
  async getStatus(taskId: string): Promise<DeepReadStatus> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/${taskId}/status`)

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`)
    }

    return response.json()
  },

  // 获取任务结果
  async getResult(taskId: string): Promise<DeepReadResult> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/${taskId}/result`)

    if (!response.ok) {
      throw new Error(`Failed to get result: ${response.statusText}`)
    }

    return response.json()
  },

  // 列出所有任务
  async listTasks(): Promise<{ tasks: DeepReadTask[] }> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/`)

    if (!response.ok) {
      throw new Error(`Failed to list tasks: ${response.statusText}`)
    }

    return response.json()
  },

  // 删除任务
  async deleteTask(taskId: string): Promise<{ message: string; task_id: string }> {
    const response = await fetch(`${API_BASE_URL}/api/deep-read/${taskId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to delete task: ${response.statusText}`)
    }

    return response.json()
  },

  // 轮询任务状态直到完成
  async pollUntilComplete(taskId: string, onProgress?: (progress: number) => void): Promise<DeepReadResult> {
    while (true) {
      const status = await this.getStatus(taskId)

      if (onProgress) {
        onProgress(status.progress)
      }

      if (status.status === 'completed') {
        return status.result!
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Task failed')
      }

      // 等待1秒后再次检查
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  },
}
