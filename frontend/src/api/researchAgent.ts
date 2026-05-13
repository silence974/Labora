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
  research_id?: string
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
  nodes: AgentTimelineNode[]
  error?: string
}

export type AgentNodeKind = 'conversation' | 'deep_read' | 'thought'

export interface AgentTimelineNode {
  id: string
  sequence?: number
  task_id?: string
  kind: AgentNodeKind
  title: string
  status: 'completed' | 'active' | 'pending' | string
  payload: {
    message?: AgentChatMessage
    step?: AgentProgressEvent
    [key: string]: unknown
  }
  created_at?: string
  updated_at?: string
}

export interface AgentChatMessage {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  actions?: { label: string; value: string }[]
  references?: AgentReferenceObject[]
  created_at?: string
}

export interface AgentReferenceObject {
  kind: 'paper' | 'link'
  label: string
  href: string
  paperId?: string
  title?: string
  authors?: string[]
  year?: string
  abstract?: string
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

export interface AgentTaskListItem {
  task_id: string
  research_id?: string
  research_question: string
  initial_direction?: string
  status: string
  created_at: string
  updated_at: string
}

export interface ResearchListItem {
  research_id: string
  title: string
  research_question?: string
  document?: string
  status: string
  latest_task_id?: string
  session_count: number
  created_at: string
  updated_at: string
}

export interface StartRequest {
  research_question: string
  initial_direction?: string
  research_id?: string
}

export interface ResumeRequest {
  user_response: string
  references?: AgentReferenceObject[]
}

export interface RollbackRequest {
  version_index: number
}

export interface AgentStreamEvent {
  event: 'status' | 'node' | 'state' | 'final' | 'error'
  task_id?: string
  research_id?: string
  node?: string | AgentTimelineNode
  message?: string
  state?: AgentStateResponse
  action_result?: Record<string, unknown>
}

export interface AgentProgressEvent {
  label: string
  description?: string
  status?: 'completed' | 'active' | 'pending'
  detail?: string
  progress?: number
  kind?: string
  timestamp?: string
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
      if (event.state) {
        finalState = event.state
        return
      }
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
  async listResearches(): Promise<{ researches: ResearchListItem[] }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/researches`)
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to list researches: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async createResearch(request: { title: string; research_question?: string }): Promise<{ research: ResearchListItem }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/researches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to create research: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async listResearchSessions(researchId: string): Promise<{ sessions: AgentTaskListItem[] }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/researches/${researchId}/sessions`)
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to list sessions: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async clearSession(taskId: string): Promise<{ task_id: string; status: string }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/sessions/${taskId}/clear`, {
      method: 'POST',
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to clear session: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

  async deleteSession(taskId: string): Promise<{ task_id: string; status: string }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/sessions/${taskId}`, {
      method: 'DELETE',
    })
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to delete session: ${resp.status} ${detail}`)
    }
    return resp.json()
  },

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

  async listTasks(): Promise<{ tasks: AgentTaskListItem[] }> {
    const resp = await fetch(`${API_BASE}/api/research-agent/`)
    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`Failed to list agent tasks: ${resp.status} ${detail}`)
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
