/**
 * API client for the Research Agent interactive loop.
 *
 * The agent runs via LangGraph interrupts — it stops at plan_node and
 * reflect_node waiting for user input, then resumes via /resume.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8765'

// ── Types ──────────────────────────────────────────────────────────────────────────

export interface DocumentVersion {
  index: number
  content: string
  description: string
  edit_type: string
  timestamp: string
}

export interface PlannedAction {
  type: string
  params: Record<string, unknown>
  rationale: string
}

export interface Reflection {
  summary: string
  gaps: string[]
  recommendation: string
  should_continue: boolean
  reason: string
}

export interface AgentStateResponse {
  task_id: string
  status: string
  interrupt_type?: string
  pending_prompt?: string
  research_question: string
  initial_direction: string
  document: string
  document_versions: DocumentVersion[]
  current_version_index: number
  literature_map: Record<string, unknown>
  reading_notes: Record<string, unknown>
  insights: string[]
  open_questions: string[]
  planned_action?: PlannedAction
  action_result?: Record<string, unknown>
  reflection?: Reflection
  iteration_count: number
  action_history: ActionHistoryItem[]
  error?: string
}

export interface ActionHistoryItem {
  type: string
  rationale?: string
  [key: string]: unknown
}

export interface AgentResult {
  task_id: string
  document: string
  document_versions: DocumentVersion[]
  literature_map: Record<string, unknown>
  reading_notes: Record<string, unknown>
  insights: string[]
  iteration_count: number
}

export interface StartRequest {
  research_question: string
  initial_direction?: string
}

export interface ResumeRequest {
  user_response: string
}

export interface RollbackRequest {
  version_index: number
}

export interface AgentStreamEvent {
  event: 'status' | 'state' | 'final' | 'error'
  task_id?: string
  node?: string
  message?: string
  state?: AgentStateResponse
  action_result?: Record<string, unknown>
}

type AgentStreamHandler = (event: AgentStreamEvent) => void

async function readAgentStream(
  resp: Response,
  onEvent?: AgentStreamHandler,
): Promise<AgentStateResponse> {
  if (!resp.body) {
    throw new Error('Agent stream response did not include a body')
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalState: AgentStateResponse | null = null

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as AgentStreamEvent
    onEvent?.(event)
    if (event.event === 'error') {
      throw new Error(event.message || 'Agent stream failed')
    }
    if (event.event === 'final' && event.state) {
      finalState = event.state
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      processLine(line)
    }
  }

  buffer += decoder.decode()
  processLine(buffer)

  if (!finalState) {
    throw new Error('Agent stream ended without a final state')
  }
  return finalState
}

// ── API Functions ──────────────────────────────────────────────────────────────────

export const researchAgentApi = {
  async start(request: StartRequest): Promise<AgentStateResponse> {
    const resp = await fetch(`${API_BASE}/api/research-agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to start agent: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async startStream(
    request: StartRequest,
    onEvent?: AgentStreamHandler,
  ): Promise<AgentStateResponse> {
    const resp = await fetch(`${API_BASE}/api/research-agent/start/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to start agent stream: ${resp.status} ${detail}`)
    }
    return readAgentStream(resp, onEvent)
  },

  async resume(taskId: string, request: ResumeRequest): Promise<AgentStateResponse> {
    const resp = await fetch(`${API_BASE}/api/research-agent/${taskId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to resume agent: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async resumeStream(
    taskId: string,
    request: ResumeRequest,
    onEvent?: AgentStreamHandler,
  ): Promise<AgentStateResponse> {
    const resp = await fetch(`${API_BASE}/api/research-agent/${taskId}/resume/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to resume agent stream: ${resp.status} ${detail}`)
    }
    return readAgentStream(resp, onEvent)
  },

  async getState(taskId: string): Promise<AgentStateResponse> {
    const resp = await fetch(`${API_BASE}/api/research-agent/${taskId}/state`)
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to get state: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async getResult(taskId: string): Promise<AgentResult> {
    const resp = await fetch(`${API_BASE}/api/research-agent/${taskId}/result`)
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to get result: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async rollback(taskId: string, request: RollbackRequest): Promise<{
    task_id: string
    document: string
    current_version_index: number
  }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/${taskId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to rollback: ${resp.status} ${detail}`)
    }
    return resp.json()
  },
}
