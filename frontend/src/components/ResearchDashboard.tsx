import { useEffect, useRef, useState } from 'preact/hooks'
import type { KeyboardEvent, MouseEvent } from 'preact/compat'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { deepReadApi } from '../api/deepRead'
import type {
  DeepReadStatus,
  DeepReadStages,
  DeepReadTask,
  Stage1Result,
  Stage2Result,
  Stage3Result,
  RelatedPaper,
} from '../api/deepRead'
import { literatureApi } from '../api/literature'
import type { LiteratureDetail, LiteratureItem, RecentPaper } from '../api/literature'
import { PreactDocumentRenderer } from './PreactDocumentRenderer'
import { PdfPaperViewer } from './PdfPaperViewer'
import type { ReaderAnnotation } from './PdfPaperViewer'
import { resolveReferenceTarget } from '../utils/literatureLinks'
import type { LiteratureReferenceTarget } from '../utils/literatureLinks'
import { researchAgentApi } from '../api/researchAgent'
import type { AgentChatMessage, AgentReferenceObject, AgentStateResponse, AgentStreamEvent, AgentTimelineNode, ResearchListItem, AgentTaskListItem } from '../api/researchAgent'

interface StartDeepReadDetail {
  paperId?: string
  paperTitle?: string
  paperUrl?: string
  paperContent?: string
}

function openDownloadLink(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function formatPaperDisplayTitle(title: string) {
  return title
    .replace(/\$\\times\$/g, '×')
    .replace(/\\times/g, '×')
    .replace(/\$\\cdot\$/g, '·')
    .replace(/\\cdot/g, '·')
    .replace(/\$\\&\$/g, '&')
    .replace(/\\&/g, '&')
    .replace(/\$([^$]{1,24})\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatRelativeTime(value?: string) {
  if (!value) return ''

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''

  const diffMs = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`
  return `${Math.floor(diffMs / day)}d`
}

let chatMessageIdCounter = 0

function createChatMessageId() {
  chatMessageIdCounter += 1
  return `chat-${Date.now()}-${chatMessageIdCounter}`
}

function AutoHideScrollArea({
  children,
  className = '',
  viewportClassName = '',
  scrollRef,
}: {
  children: any
  className?: string
  viewportClassName?: string
  scrollRef?: { current: HTMLDivElement | null }
}) {
  const localRef = useRef<HTMLDivElement | null>(null)
  const activeRef = scrollRef || localRef
  const hideTimerRef = useRef<number | null>(null)
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [thumb, setThumb] = useState({ visible: false, top: 8, height: 56 })

  const updateThumb = () => {
    const element = activeRef.current
    if (!element) return

    const maxScroll = element.scrollHeight - element.clientHeight
    if (maxScroll <= 1) {
      setThumb((current) => ({ ...current, visible: false }))
      return
    }

    const trackPadding = 8
    const trackHeight = Math.max(0, element.clientHeight - trackPadding * 2)
    const thumbHeight = Math.min(56, Math.max(32, trackHeight))
    const maxTop = Math.max(0, trackHeight - thumbHeight)
    const top = trackPadding + (element.scrollTop / maxScroll) * maxTop
    setThumb({ visible: true, top, height: thumbHeight })
  }

  const showScrollbar = () => {
    setIsVisible(true)
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }
    hideTimerRef.current = window.setTimeout(() => setIsVisible(false), 850)
  }

  const handleScroll = () => {
    updateThumb()
    showScrollbar()
  }

  const handleThumbPointerDown = (event: any) => {
    const element = activeRef.current
    if (!element || !thumb.visible) return

    event.preventDefault()
    dragRef.current = {
      startY: event.clientY,
      startScrollTop: element.scrollTop,
    }
    setIsVisible(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current
      const scrollElement = activeRef.current
      if (!current || !scrollElement) return

      const trackPadding = 8
      const trackHeight = Math.max(0, scrollElement.clientHeight - trackPadding * 2)
      const maxTop = Math.max(1, trackHeight - thumb.height)
      const maxScroll = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      const deltaY = moveEvent.clientY - current.startY
      scrollElement.scrollTop = current.startScrollTop + (deltaY / maxTop) * maxScroll
    }

    const handlePointerUp = () => {
      dragRef.current = null
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      showScrollbar()
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }

  useEffect(() => {
    const element = activeRef.current
    if (!element) return

    const frame = window.requestAnimationFrame(updateThumb)
    const observer = new ResizeObserver(updateThumb)
    observer.observe(element)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
      }
    }
  }, [children])

  return (
    <div className={`relative ${className}`}>
      <div
        ref={activeRef}
        className={`custom-scrollbar-viewport h-full overflow-y-auto ${viewportClassName}`}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {thumb.visible && (
        <div className="pointer-events-none absolute bottom-2 right-1.5 top-2 w-1">
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className={`pointer-events-auto absolute right-0 w-1 rounded-full bg-slate-300 transition-opacity duration-200 hover:bg-slate-400 ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ height: `${thumb.height}px`, transform: `translateY(${thumb.top - 8}px)` }}
            onPointerDown={handleThumbPointerDown}
          />
        </div>
      )}
    </div>
  )
}

function normalizeNodeStatus(status?: string): ProgressStep['status'] {
  if (status === 'active' || status === 'running' || status === 'in_progress') return 'active'
  if (status === 'pending') return 'pending'
  return 'completed'
}

function nodeStepToProgressStep(node: AgentTimelineNode): ProgressStep | null {
  const step = node.payload?.step
  if (!step || step.label === 'Resume') return null

  const status = normalizeNodeStatus(step.status || node.status)
  return {
    label: step.label || node.title,
    status,
    description: step.description || '',
    detail: step.detail,
    progress: typeof step.progress === 'number' ? step.progress : (status === 'active' ? undefined : 100),
    timestamp: step.timestamp || node.created_at,
  }
}

type ReferencePreviewState =
  | {
      kind: 'closed'
    }
  | {
      kind: 'paper-loading'
      paperId: string
    }
  | {
      kind: 'paper-ready'
      paper: LiteratureDetail
    }
  | {
      kind: 'paper-error'
      paperId: string
      message: string
    }
  | {
      kind: 'external'
      href: string
      label: string
    }

interface AgentSearchPaper {
  paper_id: string
  title: string
  authors: string[]
  year?: string
  abstract?: string
  status?: string
}

type ConversationReferenceObject = AgentReferenceObject

type ActiveWorkspace =
  | { kind: 'deepRead' }
  | { kind: 'dataAnalysis' }
  | { kind: 'newResearch' }
  | { kind: 'research'; researchId: string }

function normalizeAgentSearchPaper(paperId: string, metadata: unknown): AgentSearchPaper {
  const data = metadata && typeof metadata === 'object'
    ? metadata as Record<string, unknown>
    : {}
  const authors = Array.isArray(data.authors)
    ? data.authors.map((author) => String(author))
    : []

  return {
    paper_id: paperId,
    title: String(data.title || paperId),
    authors,
    year: data.year == null ? undefined : String(data.year),
    abstract: data.abstract == null ? undefined : String(data.abstract),
    status: data.status == null ? undefined : String(data.status),
  }
}

function extractAgentSearchPapers(state?: AgentStateResponse): AgentSearchPaper[] {
  const result = state?.action_result || {}
  if (result.action !== 'search' || !Array.isArray(result.paper_ids)) {
    return []
  }

  return result.paper_ids
    .map((paperId) => String(paperId).trim())
    .filter(Boolean)
    .map((paperId) => normalizeAgentSearchPaper(paperId, state?.literature_map?.[paperId]))
}

function hasPendingAgentAction(messages?: ChatMessage[]) {
  if (!messages || messages.length === 0) return false
  const latestActionIndex = messages.reduce((latest, msg, index) => (
    msg.role === 'assistant' && msg.actions && msg.actions.length > 0 ? index : latest
  ), -1)
  if (latestActionIndex < 0) return false
  return !messages.slice(latestActionIndex + 1).some((msg) => msg.role === 'user')
}

function chatMessageSemanticKey(message: ChatMessage) {
  const references = (message.references || []).map((reference) => (
    reference.paperId || reference.href || reference.label
  ))
  return JSON.stringify({
    role: message.role,
    content: message.content,
    references,
  })
}

function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  if (incoming.length === 0) return current

  const incomingKeys = new Set<string>()
  incoming.forEach((message) => {
    if (message.id) incomingKeys.add(`id:${message.id}`)
    incomingKeys.add(`semantic:${chatMessageSemanticKey(message)}`)
  })

  const localOnly = current.filter((message) => {
    if (message.id && incomingKeys.has(`id:${message.id}`)) return false
    return !incomingKeys.has(`semantic:${chatMessageSemanticKey(message)}`)
  })

  return [...incoming, ...localOnly]
}

function messageFromTimelineNode(node: AgentTimelineNode): ChatMessage | null {
  const message = node.payload?.message
  if (!message) return null
  return {
    ...message,
    id: message.id || node.id,
    created_at: message.created_at || node.created_at,
  }
}

function messagesFromTimelineNodes(nodes?: AgentTimelineNode[]): ChatMessage[] {
  return (nodes || [])
    .map(messageFromTimelineNode)
    .filter((message): message is ChatMessage => Boolean(message))
}

function mergeTimelineNodes(current: AgentTimelineNode[], incoming: AgentTimelineNode[]) {
  if (incoming.length === 0) return current
  const byId = new Map(current.map((node) => [node.id, node]))
  incoming.forEach((node) => {
    byId.set(node.id, node)
  })
  return Array.from(byId.values()).sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
}

function paperHref(paperId: string) {
  return `https://arxiv.org/abs/${paperId}`
}

function agentSearchPaperToReference(paper: AgentSearchPaper): ConversationReferenceObject {
  return {
    kind: 'paper',
    label: formatPaperDisplayTitle(paper.title),
    href: paperHref(paper.paper_id),
    paperId: paper.paper_id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
  }
}

function literaturePaperToReference(paper: LiteratureItem | RecentPaper | LiteratureDetail): ConversationReferenceObject {
  return {
    kind: 'paper',
    label: formatPaperDisplayTitle(paper.title),
    href: paper.url || paper.source_url || paperHref(paper.paper_id),
    paperId: paper.paper_id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
  }
}

function relatedPaperToReference(paper: RelatedPaper): ConversationReferenceObject {
  return {
    kind: 'paper',
    label: formatPaperDisplayTitle(paper.title),
    href: paperHref(paper.arxiv_id),
    paperId: paper.arxiv_id,
    title: paper.title,
    authors: paper.authors || [],
    year: paper.year ?? undefined,
  }
}

function referenceTargetToObject(target: LiteratureReferenceTarget): ConversationReferenceObject {
  return {
    kind: target.isArxiv ? 'paper' : 'link',
    label: target.label || target.href,
    href: target.href,
    paperId: target.paperId,
    title: target.label,
  }
}

function referenceToTarget(reference: ConversationReferenceObject): LiteratureReferenceTarget {
  const resolved = resolveReferenceTarget(reference.href, reference.label)
  if (resolved) return resolved

  return {
    label: reference.label,
    href: reference.href,
    isArxiv: reference.kind === 'paper',
    paperId: reference.paperId,
  }
}

function addReferenceToConversation(reference: ConversationReferenceObject) {
  window.dispatchEvent(new CustomEvent<ConversationReferenceObject>('addReferenceToConversation', {
    detail: reference,
  }))
}

function previewReferenceObject(reference: ConversationReferenceObject) {
  window.dispatchEvent(new CustomEvent<ConversationReferenceObject>('previewReferenceObject', {
    detail: reference,
  }))
}

function getDeepReadStatusMeta(status?: DeepReadTask['status'], progress = 0) {
  if (status === 'completed') {
    return {
      text: '完成',
      icon: 'fa-check',
      chipClass: 'bg-green-100 text-green-700',
      barClass: 'bg-green-500',
      value: 100,
    }
  }
  if (status === 'failed') {
    return {
      text: '失败',
      icon: 'fa-triangle-exclamation',
      chipClass: 'bg-red-100 text-red-700',
      barClass: 'bg-red-500',
      value: Math.max(progress, 100),
    }
  }
  if (status === 'running') {
    return {
      text: `${progress}%`,
      icon: 'fa-spinner fa-spin',
      chipClass: 'bg-yellow-100 text-yellow-700',
      barClass: 'bg-academic-accent',
      value: progress,
    }
  }
  return {
    text: '等待',
    icon: 'fa-clock',
    chipClass: 'bg-academic-border text-academic-muted',
    barClass: 'bg-academic-muted',
    value: progress,
  }
}

function DeepReadProgressBar({
  status,
  progress,
  compact = false,
  inverted = false,
}: {
  status?: DeepReadTask['status']
  progress: number
  compact?: boolean
  inverted?: boolean
}) {
  const meta = getDeepReadStatusMeta(status, progress)
  const value = Math.min(100, Math.max(0, meta.value))

  return (
    <div className={compact ? 'mt-1' : 'mt-2'}>
      <div className={`h-1.5 overflow-hidden rounded-full ${inverted ? 'bg-white/30' : 'bg-white border border-academic-border'}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${inverted ? 'bg-white' : meta.barClass}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {!compact && (
        <div className={`mt-1 flex items-center justify-between text-[10px] ${inverted ? 'text-white/80' : 'text-academic-muted'}`}>
          <span className="inline-flex items-center gap-1">
            <i className={`fa-solid ${meta.icon}`}></i>
            {meta.text}
          </span>
          <span>Stage {status === 'completed' ? 3 : Math.min(3, Math.max(0, Math.ceil(value / 34)))}/3</span>
        </div>
      )}
    </div>
  )
}

export function ResearchDashboard() {
  const [showDocDetails, setShowDocDetails] = useState(false)
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>({ kind: 'newResearch' })
  const [researches, setResearches] = useState<ResearchListItem[]>([])
  const [agentSearchPapers, setAgentSearchPapers] = useState<AgentSearchPaper[]>([])
  const [showAgentSearchPapers, setShowAgentSearchPapers] = useState(false)

  const refreshResearches = async () => {
    try {
      const response = await researchAgentApi.listResearches()
      setResearches(response.researches)
      setActiveWorkspace((current) => {
        if (current.kind !== 'newResearch') return current
        const latest = response.researches[0]
        return latest ? { kind: 'research', researchId: latest.research_id } : current
      })
    } catch (error) {
      console.error('Failed to load researches:', error)
    }
  }

  useEffect(() => {
    void refreshResearches()
  }, [])

  const activeResearchId = activeWorkspace.kind === 'research' ? activeWorkspace.researchId : null
  const sidebarItemClass = (active: boolean) => (
    `w-full h-10 rounded-lg flex items-center pl-3 cursor-pointer relative group/item transition-colors ${
      active
        ? 'bg-academic-hover border border-academic-border text-academic-accent'
        : 'text-academic-muted hover:bg-academic-hover hover:text-academic-text'
    }`
  )

  return (
    <div className="w-full h-dvh bg-academic-bg flex flex-col overflow-hidden relative">

      {/* Header */}
      <header className="bg-academic-panel border-b border-academic-border h-12 flex items-center justify-between px-5 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-academic-accent text-white rounded flex items-center justify-center font-serif font-bold text-lg">
            R
          </div>
          <h1 className="font-serif text-xl font-bold tracking-tight">Research Assistant</h1>
        </div>

        <button className="text-academic-muted hover:text-academic-accent transition-colors">
          <i className="fa-solid fa-gear"></i>
        </button>
      </header>

      {/* Main Content */}
      <main className="min-h-0 flex-1 flex overflow-hidden">

        <div className="min-h-0 flex-1 min-w-0 flex overflow-hidden">
          {/* Leftmost Sidebar */}
          <div className="relative z-40 w-12 shrink-0">
            <aside className="absolute inset-y-0 left-0 z-40 w-12 overflow-hidden bg-academic-panel border-r border-academic-border flex flex-col items-center py-4 shadow-sm transition-[width,box-shadow] duration-200 ease-out hover:w-40 hover:shadow-[0_14px_28px_rgba(15,23,42,0.12)] group">
              <div className="flex-1 w-full flex flex-col gap-2 px-2 overflow-y-auto">
                <div
                  className={sidebarItemClass(activeWorkspace.kind === 'deepRead')}
                  onClick={() => setActiveWorkspace({ kind: 'deepRead' })}
                >
                  <i className="fa-regular fa-file-pdf"></i>
                  <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">Deep Read</span>
                </div>

                <div
                  className={sidebarItemClass(activeWorkspace.kind === 'dataAnalysis')}
                  onClick={() => setActiveWorkspace({ kind: 'dataAnalysis' })}
                >
                  <i className="fa-regular fa-file-word"></i>
                  <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">Data Analysis</span>
                </div>

                <div className="my-2 h-px w-8 self-center bg-academic-border group-hover:w-32 transition-[width]"></div>

                <div
                  className={sidebarItemClass(activeWorkspace.kind === 'newResearch')}
                  onClick={() => {
                    setActiveWorkspace({ kind: 'newResearch' })
                    window.dispatchEvent(new Event('newResearchSession'))
                  }}
                >
                  <i className="fa-solid fa-file-circle-plus"></i>
                  <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">New Research</span>
                </div>

                <div className="my-2 h-px w-8 self-center bg-academic-border group-hover:w-32 transition-[width]"></div>

                {researches.map((research) => (
                  <div
                    key={research.research_id}
                    className={sidebarItemClass(activeResearchId === research.research_id)}
                    onClick={() => setActiveWorkspace({ kind: 'research', researchId: research.research_id })}
                  >
                    <i className="fa-solid fa-file-lines"></i>
                    <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">
                      {research.title}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-auto w-full px-2 pt-4 border-t border-academic-border">
                <button className="w-full h-10 rounded-lg flex items-center pl-3 text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors relative group/btn">
                  <i className="fa-solid fa-box-archive"></i>
                  <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none">Archive</span>
                </button>
              </div>
            </aside>
          </div>

          {/* Left Workspace */}
          <LeftWorkspace
            showDocDetails={showDocDetails}
            onCloseDetails={() => setShowDocDetails(false)}
            activeWorkspace={activeWorkspace}
            setActiveWorkspace={setActiveWorkspace}
            activeResearch={activeResearchId ? researches.find((research) => research.research_id === activeResearchId) || null : null}
            onResearchesChanged={refreshResearches}
            onAgentSearchPapers={setAgentSearchPapers}
            onShowAgentSearchPapers={() => setShowAgentSearchPapers(true)}
            hasAgentSearchPapers={agentSearchPapers.length > 0}
          />
        </div>

        {/* Right Workspace */}
        <RightWorkspace
          agentSearchPapers={agentSearchPapers}
          showAgentSearchPapers={showAgentSearchPapers}
          onShowAgentSearchPapers={() => setShowAgentSearchPapers(true)}
          onHideAgentSearchPapers={() => setShowAgentSearchPapers(false)}
        />

      </main>
    </div>
  )
}

function LeftWorkspace({
  showDocDetails,
  onCloseDetails,
  activeWorkspace,
  setActiveWorkspace,
  activeResearch,
  onResearchesChanged,
  onAgentSearchPapers,
  onShowAgentSearchPapers,
  hasAgentSearchPapers,
}: {
  showDocDetails: boolean
  onCloseDetails: () => void
  activeWorkspace: ActiveWorkspace
  setActiveWorkspace: (workspace: ActiveWorkspace) => void
  activeResearch: ResearchListItem | null
  onResearchesChanged: () => void | Promise<void>
  onAgentSearchPapers: (papers: AgentSearchPaper[]) => void
  onShowAgentSearchPapers: () => void
  hasAgentSearchPapers: boolean
}) {
  const [deepReadProgress, setDeepReadProgress] = useState(0)
  const [deepReadStage, setDeepReadStage] = useState(0)
  const [readResults, setReadResults] = useState<DeepReadTask[]>([])
  const [readResultCache, setReadResultCache] = useState<Record<string, DeepReadStatus>>({})
  const [openReadResults, setOpenReadResults] = useState<string[]>([])
  const [activeReadResult, setActiveReadResult] = useState<string | null>(null)
  const [currentStages, setCurrentStages] = useState<DeepReadStages>({})
  const [readResultSearch, setReadResultSearch] = useState('')
  const activeReadResultRef = useRef<string | null>(null)
  const activeDeepReadPollsRef = useRef<Set<string>>(new Set())

  // Agent state
  const [agentPhase, setAgentPhase] = useState<'idle' | 'starting' | 'running' | 'waiting_input' | 'completed' | 'failed'>('idle')
  const [agentQuestion, setAgentQuestion] = useState('')
  const [agentDirection, setAgentDirection] = useState('')
  const [agentTaskId, setAgentTaskId] = useState<string | null>(null)
  const [agentState, setAgentState] = useState<AgentStateResponse | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [researchSessions, setResearchSessions] = useState<AgentTaskListItem[]>([])
  const [agentTimelineNodes, setAgentTimelineNodes] = useState<AgentTimelineNode[]>([])
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([])
  const [pendingAgentReferences, setPendingAgentReferences] = useState<ConversationReferenceObject[]>([])
  const [docViewMode, setDocViewMode] = useState<'source' | 'preview'>('preview')
  const [isAgentChatExpanded, setIsAgentChatExpanded] = useState(false)
  const activeResearchId = activeWorkspace.kind === 'research' ? activeWorkspace.researchId : null

  useEffect(() => {
    activeReadResultRef.current = activeReadResult
  }, [activeReadResult])

  const agentAddMessage = (msg: ChatMessage) => {
    setAgentMessages(prev => [...prev, { ...msg, id: msg.id || createChatMessageId() }])
  }

  const setAgentPhaseFromState = (state: AgentStateResponse, messages: ChatMessage[] = messagesFromTimelineNodes(state.nodes)) => {
    if (state.status === 'completed') {
      setAgentPhase('completed')
    } else if (state.status === 'interrupted' || state.status === 'failed' || hasPendingAgentAction(messages)) {
      setAgentPhase('waiting_input')
    } else {
      setAgentPhase('running')
    }
  }

  const handleAgentStreamEvent = (event: AgentStreamEvent) => {
    if (event.task_id) {
      setAgentTaskId(event.task_id)
    }
    if (event.research_id) {
      setActiveWorkspace({ kind: 'research', researchId: event.research_id })
    }
    if (event.state) {
      setAgentState(event.state)
      setAgentTaskId(event.state.task_id)
      if (event.state.research_id) {
        setActiveWorkspace({ kind: 'research', researchId: event.state.research_id })
      }
      setAgentTimelineNodes(event.state.nodes || [])
      const searchPapers = extractAgentSearchPapers(event.state)
      if (searchPapers.length > 0) {
        onAgentSearchPapers(searchPapers)
      }
      const nodeMessages = messagesFromTimelineNodes(event.state.nodes)
      if (nodeMessages.length) {
        setAgentMessages((current) => mergeChatMessages(current, nodeMessages))
      }
      setAgentPhaseFromState(event.state, nodeMessages)
    }
    if (event.event === 'node' && typeof event.node === 'object') {
      setAgentTimelineNodes((current) => mergeTimelineNodes(current, [event.node as AgentTimelineNode]))
    }
  }

  const agentStart = async () => {
    if (!agentQuestion.trim()) return
    setAgentLoading(true)
    setAgentError(null)
    setAgentPhase('starting')
    setAgentTimelineNodes([])
    setAgentMessages([])
    try {
      const result = await researchAgentApi.startStream({
        research_question: agentQuestion,
        initial_direction: agentDirection,
        research_id: activeResearchId || undefined,
      }, handleAgentStreamEvent)
      setAgentTaskId(result.task_id)
      setAgentState(result)
      if (result.research_id) {
        setActiveWorkspace({ kind: 'research', researchId: result.research_id })
      }
      setAgentTimelineNodes(result.nodes || [])
      const nodeMessages = messagesFromTimelineNodes(result.nodes)
      setAgentMessages(nodeMessages)
      setAgentPhaseFromState(result, nodeMessages)
      await onResearchesChanged()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to start'
      setAgentError(message)
      agentAddMessage({ role: 'assistant', content: `### Agent Error\n\n${message}` })
      if (agentTaskId) {
        try {
          const recoveredState = await researchAgentApi.getState(agentTaskId)
          setAgentState(recoveredState)
          setAgentTimelineNodes(recoveredState.nodes || [])
          const nodeMessages = messagesFromTimelineNodes(recoveredState.nodes)
          setAgentMessages((current) => mergeChatMessages(current, nodeMessages))
          setAgentPhaseFromState(recoveredState, nodeMessages)
          return
        } catch {
          // fall back to failed phase below
        }
      }
      setAgentPhase('failed')
    } finally {
      setAgentLoading(false)
    }
  }

  const agentRespond = async (
    response: string,
    references: ConversationReferenceObject[] = pendingAgentReferences,
  ) => {
    if (!agentTaskId) return
    const userResponse = response || (references.length > 0 ? '请参考已附加的可引用对象' : '')
    const labelMap: Record<string, string> = { confirm: 'Accept this action', done: 'Finalize and finish', continue: 'Continue research', retry: 'Retry last step', reject: 'Reject this action', replan: 'Replan next step' }
    agentAddMessage({
      role: 'user',
      content: labelMap[userResponse] || userResponse,
      references,
    })
    setPendingAgentReferences([])
    setAgentLoading(true)
    setAgentError(null)
    setAgentPhase('running')
    try {
      const result = await researchAgentApi.resumeStream(agentTaskId, {
        user_response: userResponse,
        references,
      }, handleAgentStreamEvent)
      setAgentState(result)
      setAgentTimelineNodes(result.nodes || [])
      const nodeMessages = messagesFromTimelineNodes(result.nodes)
      setAgentMessages((current) => mergeChatMessages(current, nodeMessages))
      setAgentPhaseFromState(result, nodeMessages)
      await onResearchesChanged()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to resume'
      setAgentError(message)
      agentAddMessage({ role: 'assistant', content: `### Agent Error\n\n${message}` })
      try {
        const recoveredState = await researchAgentApi.getState(agentTaskId)
        setAgentState(recoveredState)
        setAgentTimelineNodes(recoveredState.nodes || [])
        const nodeMessages = messagesFromTimelineNodes(recoveredState.nodes)
        setAgentMessages((current) => mergeChatMessages(current, nodeMessages))
        setAgentPhaseFromState(recoveredState, nodeMessages)
      } catch {
        setAgentPhase('failed')
      }
    } finally {
      setAgentLoading(false)
    }
  }

  const resetAgentForNewSession = () => {
    setAgentPhase('starting')
    setAgentQuestion('')
    setAgentDirection('')
    setAgentTaskId(null)
    setAgentState(null)
    setAgentLoading(false)
    setAgentError(null)
    setAgentTimelineNodes([])
    setAgentMessages([])
    setPendingAgentReferences([])
    setIsAgentChatExpanded(false)
    onAgentSearchPapers([])
  }

  const loadAgentSession = async (session: AgentTaskListItem) => {
    const state = await researchAgentApi.getState(session.task_id)
    setAgentTaskId(state.task_id)
    setAgentState(state)
    setAgentQuestion(state.research_question || session.research_question || '')
    setAgentDirection(state.initial_direction || session.initial_direction || '')
    setAgentTimelineNodes(state.nodes || [])
    const nodeMessages = messagesFromTimelineNodes(state.nodes)
    setAgentMessages(nodeMessages)
    setAgentLoading(false)
    const searchPapers = extractAgentSearchPapers(state)
    if (searchPapers.length > 0) {
      onAgentSearchPapers(searchPapers)
    }
    setAgentPhaseFromState(state, nodeMessages)
  }

  const startNewSessionInCurrentResearch = () => {
    resetAgentForNewSession()
    setAgentQuestion(activeResearch?.research_question || '')
  }

  const reloadCurrentResearch = async () => {
    await onResearchesChanged()
    if (!activeResearchId) return
    const response = await researchAgentApi.listResearchSessions(activeResearchId)
    setResearchSessions(response.sessions)
    const latest = response.sessions[0]
    if (!latest) {
      resetAgentForNewSession()
      setAgentQuestion(activeResearch?.research_question || '')
      return
    }
    await loadAgentSession(latest)
  }

  const clearCurrentSession = async () => {
    if (!agentTaskId) return
    await researchAgentApi.clearSession(agentTaskId)
    await reloadCurrentResearch()
  }

  const deleteCurrentSession = async () => {
    if (!agentTaskId) return
    await researchAgentApi.deleteSession(agentTaskId)
    await reloadCurrentResearch()
  }

  const canSendAgentCommand = Boolean(agentTaskId) && (agentPhase === 'waiting_input' || agentPhase === 'failed')

  const activeReadSummary = activeReadResult
    ? readResults.find((result) => result.task_id === activeReadResult)
    : null
  const filteredReadResults = readResults.filter((result) => {
    const query = readResultSearch.trim().toLowerCase()
    if (!query) return true
    return (
      result.paper_title.toLowerCase().includes(query) ||
      result.paper_id.toLowerCase().includes(query)
    )
  })

  const upsertReadResult = (result: DeepReadTask | DeepReadStatus) => {
    const summary: DeepReadTask = {
      task_id: result.task_id,
      paper_id: result.paper_id,
      paper_title: result.paper_title,
      status: result.status,
      progress: result.progress,
      current_stage: result.current_stage,
      stages: result.stages,
      error: result.error,
      created_at: result.created_at,
      updated_at: result.updated_at,
    }

    setReadResults((previous) => {
      const withoutCurrent = previous.filter((item) => item.task_id !== summary.task_id)
      return [summary, ...withoutCurrent].sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
    })

    setReadResultCache((previous) => ({
      ...previous,
      [summary.task_id]: summary,
    }))
  }

  const pollReadResult = async (summary: DeepReadTask) => {
    if (activeDeepReadPollsRef.current.has(summary.task_id)) return
    activeDeepReadPollsRef.current.add(summary.task_id)

    try {
      const result = await deepReadApi.pollUntilComplete(summary.task_id, (poll) => {
        const updatedAt = new Date().toISOString()
        if (activeReadResultRef.current === summary.task_id) {
          setDeepReadProgress(poll.progress)
          setDeepReadStage(poll.currentStage)
          setCurrentStages(poll.stages)
        }
        upsertReadResult({
          task_id: summary.task_id,
          paper_id: summary.paper_id,
          paper_title: summary.paper_title,
          status: poll.status,
          progress: poll.progress,
          current_stage: poll.currentStage,
          stages: poll.stages,
          error: summary.error,
          created_at: summary.created_at,
          updated_at: updatedAt,
        })
      })

      const completed: DeepReadTask = {
        task_id: summary.task_id,
        paper_id: result.paper_id || summary.paper_id,
        paper_title: result.paper_title || summary.paper_title,
        status: 'completed',
        progress: 100,
        current_stage: result.current_stage,
        stages: result.stages,
        created_at: summary.created_at,
        updated_at: new Date().toISOString(),
      }
      if (activeReadResultRef.current === summary.task_id) {
        setDeepReadProgress(100)
        setDeepReadStage(result.current_stage)
        setCurrentStages(result.stages)
      }
      upsertReadResult(completed)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deep read failed'
      upsertReadResult({
        ...summary,
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
      })
      console.error('Deep read polling failed:', error)
    } finally {
      activeDeepReadPollsRef.current.delete(summary.task_id)
    }
  }

  const openReadResult = async (summary: DeepReadTask) => {
    setActiveWorkspace({ kind: 'deepRead' })
    setOpenReadResults((previous) =>
      previous.includes(summary.task_id) ? previous : [...previous, summary.task_id]
    )
    setActiveReadResult(summary.task_id)
    setDeepReadProgress(summary.progress)
    setDeepReadStage(summary.current_stage)
    setCurrentStages(summary.stages || {})
    upsertReadResult(summary)

    if (summary.status === 'running' || summary.status === 'pending') {
      void pollReadResult(summary)
      return
    }

    try {
      const status = await deepReadApi.getStatus(summary.task_id)
      setDeepReadProgress(status.progress)
      setDeepReadStage(status.current_stage)
      setCurrentStages(status.stages || {})
      upsertReadResult(status)
    } catch (error) {
      console.error('Failed to open deep read result:', error)
    }
  }

  const getReadResultSummary = (taskId: string) => {
    return readResultCache[taskId] || readResults.find((result) => result.task_id === taskId)
  }

  const handleCloseOpenReadResult = (taskId: string, event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    const nextOpenResults = openReadResults.filter((id) => id !== taskId)
    setOpenReadResults(nextOpenResults)

    if (activeReadResult !== taskId) {
      return
    }

    const nextActiveId = nextOpenResults[0] ?? null
    setActiveReadResult(nextActiveId)

    if (!nextActiveId) {
      setDeepReadProgress(0)
      setDeepReadStage(0)
      setCurrentStages({})
      return
    }

    const nextSummary = getReadResultSummary(nextActiveId)
    if (nextSummary) {
      void openReadResult(nextSummary)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadResearchSession = async () => {
      if (!activeResearchId) {
        setResearchSessions([])
        resetAgentForNewSession()
        return
      }

      try {
        const response = await researchAgentApi.listResearchSessions(activeResearchId)
        if (cancelled) return
        setResearchSessions(response.sessions)
        const latest = response.sessions[0]
        if (!latest) {
          if (!cancelled) {
            resetAgentForNewSession()
            setAgentQuestion(activeResearch?.research_question || '')
            setAgentState(activeResearch?.document ? {
              task_id: '',
              research_id: activeResearchId,
              status: 'completed',
              research_question: activeResearch.research_question || '',
              initial_direction: '',
              document: activeResearch.document || '',
              document_versions: [],
              current_version_index: 0,
              literature_map: {},
              reading_notes: {},
              insights: [],
              open_questions: [],
              iteration_count: 0,
              action_history: [],
              nodes: [],
            } : null)
          }
          return
        }

        await loadAgentSession(latest)
      } catch (error) {
        console.error('Failed to load agent history:', error)
      }
    }

    void loadResearchSession()

    return () => {
      cancelled = true
    }
  }, [activeResearchId])

  useEffect(() => {
    const handleNewResearchSession = () => resetAgentForNewSession()
    window.addEventListener('newResearchSession', handleNewResearchSession)
    return () => {
      window.removeEventListener('newResearchSession', handleNewResearchSession)
    }
  }, [])

  useEffect(() => {
    const handleAddReference = (event: Event) => {
      const reference = (event as CustomEvent<ConversationReferenceObject>).detail
      if (!reference) return
      setPendingAgentReferences((current) => {
        const key = reference.paperId || reference.href
        if (current.some((item) => (item.paperId || item.href) === key)) {
          return current
        }
        return [...current, reference]
      })
    }

    const handleAddPaper = (event: Event) => {
      const paper = (event as CustomEvent<AgentSearchPaper>).detail
      if (!paper) return
      addReferenceToConversation(agentSearchPaperToReference(paper))
    }

    window.addEventListener('addReferenceToConversation', handleAddReference)
    window.addEventListener('addAgentPaperToConversation', handleAddPaper)
    return () => {
      window.removeEventListener('addReferenceToConversation', handleAddReference)
      window.removeEventListener('addAgentPaperToConversation', handleAddPaper)
    }
  }, [agentTaskId, agentLoading])

  const removePendingAgentReference = (reference: ConversationReferenceObject) => {
    const key = reference.paperId || reference.href
    setPendingAgentReferences((current) =>
      current.filter((item) => (item.paperId || item.href) !== key)
    )
  }

  useEffect(() => {
    let cancelled = false

    const loadReadResults = async () => {
      try {
        const response = await deepReadApi.listTasks()
        if (cancelled) return
        setReadResults(response.tasks)
        setReadResultCache((previous) => {
          const next = { ...previous }
          response.tasks.forEach((task) => {
            next[task.task_id] = task
          })
          return next
        })
        const runningTasks = response.tasks.filter((task) =>
          task.status === 'pending' || task.status === 'running'
        )
        if (runningTasks.length > 0) {
          setOpenReadResults((previous) => {
            const next = new Set(previous)
            runningTasks.forEach((task) => next.add(task.task_id))
            return Array.from(next)
          })
          if (!activeReadResultRef.current) {
            const firstRunning = runningTasks[0]
            setActiveReadResult(firstRunning.task_id)
            activeReadResultRef.current = firstRunning.task_id
            setDeepReadProgress(firstRunning.progress)
            setDeepReadStage(firstRunning.current_stage)
            setCurrentStages(firstRunning.stages || {})
          }
          runningTasks.forEach((task) => {
            void pollReadResult(task)
          })
        }
      } catch (error) {
        console.error('Failed to load deep read results:', error)
      }
    }

    void loadReadResults()

    return () => {
      cancelled = true
    }
  }, [])

  // Listen for deep read events
  useEffect(() => {
    const handleStartDeepRead = async (event: Event) => {
      const detail = (event as CustomEvent<StartDeepReadDetail>).detail
      const paperId = detail?.paperId || ''
      const paperTitle = detail?.paperTitle || 'Untitled Paper'

      setActiveWorkspace({ kind: 'deepRead' })

      try {
        if (paperId) {
          try {
            const existing = await deepReadApi.getByPaper(paperId)
            await openReadResult(existing)
            window.alert('该文献已有深度阅读结果，已为你打开。')
            return
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'NOT_FOUND') {
              throw error
            }
          }
        }

        setDeepReadProgress(0)
        setDeepReadStage(0)
        setCurrentStages({})

        const { task_id } = await deepReadApi.startDeepRead({
          paper_id: paperId,
          paper_title: paperTitle,
          paper_content: detail?.paperContent,
        })

        const now = new Date().toISOString()
        const pendingTask: DeepReadTask = {
          task_id,
          paper_id: paperId,
          paper_title: paperTitle,
          status: 'pending',
          progress: 0,
          current_stage: 0,
          stages: {},
          created_at: now,
          updated_at: now,
        }
        upsertReadResult(pendingTask)
        setOpenReadResults(prev => prev.includes(task_id) ? prev : [...prev, task_id])
        setActiveReadResult(task_id)
        activeReadResultRef.current = task_id
        void pollReadResult(pendingTask)
      } catch (error) {
        console.error('Deep read failed:', error)
      }
    }

    const handleJumpToResult = () => {
      setActiveWorkspace({ kind: 'deepRead' })
    }

    window.addEventListener('startDeepRead', handleStartDeepRead as EventListener)
    window.addEventListener('jumpToResult', handleJumpToResult)

    return () => {
      window.removeEventListener('startDeepRead', handleStartDeepRead as EventListener)
      window.removeEventListener('jumpToResult', handleJumpToResult)
    }
  }, [readResults])

  return (
    <section className="relative min-h-0 flex-1 min-w-0 flex flex-col bg-academic-bg border-r border-academic-border h-full overflow-hidden p-2">

      {/* Document Details Card */}
      {showDocDetails && (
        <div className="absolute top-4 left-4 z-30 w-80 bg-white rounded-xl shadow-hover border border-academic-border p-4 flex flex-col gap-3 transition-opacity">
          <div className="flex justify-between items-start border-b border-academic-border pb-2">
            <div>
              <h3 className="font-serif font-bold text-academic-text text-sm">Methodology: Comparing CNNs and ViTs</h3>
              <p className="text-[10px] text-academic-muted mt-0.5">Last edited: 10 mins ago</p>
            </div>
            <button onClick={onCloseDetails} className="text-academic-muted hover:text-academic-accent">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-academic-muted">Status:</span>
              <span className="text-academic-accent font-medium">Drafting</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-academic-muted">Word Count:</span>
              <span className="text-academic-text font-medium">1,240</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-academic-muted">Linked Refs:</span>
              <span className="text-academic-text font-medium">12</span>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 bg-academic-hover text-academic-text text-xs py-1.5 rounded hover:bg-academic-border transition-colors">Settings</button>
            <button className="flex-1 bg-academic-accent text-white text-xs py-1.5 rounded hover:bg-red-700 transition-colors">Export</button>
          </div>
        </div>
      )}

      {(activeWorkspace.kind === 'research' || activeWorkspace.kind === 'newResearch') ? (
        <>
          {/* Editor Toolbar */}
          <div className="bg-academic-panel border-b-2 border-academic-border py-1 px-6 flex items-center justify-between">
            <div className="min-w-0 flex items-center gap-2">
              <i className="fa-solid fa-file-lines text-xs text-academic-accent"></i>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-academic-text">
                  {activeResearch?.title || 'New Research'}
                </div>
                <div className="text-[10px] text-academic-muted">
                  {activeResearch ? `${researchSessions.length} session${researchSessions.length === 1 ? '' : 's'}` : 'Create a research report'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeResearch && (
                <>
                  <select
                    className="h-6 max-w-36 rounded border border-academic-border bg-white px-2 text-[10px] text-academic-text outline-none"
                    value={agentTaskId || ''}
                    onChange={(event) => {
                      const session = researchSessions.find((item) => item.task_id === event.currentTarget.value)
                      if (session) {
                        void loadAgentSession(session)
                      }
                    }}
                    title="Switch session"
                  >
                    {researchSessions.length === 0 ? (
                      <option value="">No Session</option>
                    ) : researchSessions.map((session, index) => (
                      <option key={session.task_id} value={session.task_id}>
                        {`Session ${researchSessions.length - index} · ${session.status}`}
                      </option>
                    ))}
                  </select>
                  <button
                    className="text-[10px] px-2 py-1 border border-academic-border bg-white rounded hover:bg-academic-hover"
                    onClick={startNewSessionInCurrentResearch}
                    title="Create a new session under this research"
                  >
                    New Session
                  </button>
                  <button
                    className="text-[10px] px-2 py-1 border border-academic-border bg-white rounded hover:bg-academic-hover disabled:opacity-50"
                    disabled={!agentTaskId}
                    onClick={() => void clearCurrentSession()}
                    title="Clear this session without deleting the report"
                  >
                    Clear Session
                  </button>
                  <button
                    className="text-[10px] px-2 py-1 border border-red-200 bg-white text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                    disabled={!agentTaskId}
                    onClick={() => void deleteCurrentSession()}
                    title="Delete this session without deleting the report"
                  >
                    Delete Session
                  </button>
                </>
              )}
              {agentPhase !== 'idle' ? (
                <>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    agentPhase === 'completed' ? 'bg-green-100 text-green-700' :
                    agentPhase === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {agentPhase === 'completed' ? 'Done' : agentPhase === 'failed' ? 'Error' : `Iter ${agentState?.iteration_count || 0}`}
                  </span>
                  <span className="text-[10px] text-academic-muted">
                    {Object.keys(agentState?.literature_map || {}).length}p / {Object.keys(agentState?.reading_notes || {}).length}r
                  </span>
                  {agentPhase === 'completed' && (
                    <button className="text-[10px] px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      onClick={() => {
                        const blob = new Blob([agentState?.document || ''], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob); const a = document.createElement('a')
                        a.href = url; a.download = 'research-document.tex'; a.click(); URL.revokeObjectURL(url)
                      }}>Export .tex</button>
                  )}
                </>
              ) : (
                <button className="text-xs px-2 py-1 bg-academic-accent text-white rounded hover:bg-red-700 flex items-center gap-1"
                  onClick={() => setAgentPhase('starting')}>
                  <i className="fa-solid fa-robot text-[10px]"></i> Start Agent
                </button>
              )}
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex-1 overflow-y-auto bg-white p-8">
            {agentPhase !== 'idle' && agentPhase !== 'starting' ? (
              <div className="max-w-4xl mx-auto flex flex-col h-full">
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <button
                    className={`text-xs px-2 py-1 rounded ${docViewMode === 'preview' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
                    onClick={() => setDocViewMode('preview')}>Preview</button>
                  <button
                    className={`text-xs px-2 py-1 rounded ${docViewMode === 'source' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
                    onClick={() => setDocViewMode('source')}>Source</button>
                </div>
                <div className="flex-1 overflow-auto">
                  {agentState?.document ? (
                    docViewMode === 'source' ? (
                      <pre className="font-mono text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {agentState.document}
                      </pre>
                    ) : (
                      <div className="agent-markdown max-w-none text-sm text-gray-800">
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {agentState.document}
                        </ReactMarkdown>
                      </div>
                    )
                  ) : (
                    <p className="text-academic-muted text-sm text-center py-12">Document will appear here as research progresses...</p>
                  )}
                </div>
              </div>
            ) : agentPhase === 'starting' ? (
              /* Start form */
              <div className="max-w-lg mx-auto space-y-4 py-8">
                <h3 className="text-base font-semibold text-gray-800">
                  {activeResearch ? 'Start New Session' : 'Start New Research'}
                </h3>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Research Question</label>
                  <textarea className="w-full border border-gray-300 rounded-md p-2 text-sm resize-none focus:ring-1 focus:ring-blue-100 focus:border-blue-400 outline-none" rows={2}
                    value={agentQuestion} onInput={(e) => setAgentQuestion((e.target as HTMLTextAreaElement).value)}
                    placeholder="e.g., What are the latest advances in diffusion models?" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Initial Direction (optional)</label>
                  <input className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-1 focus:ring-blue-100 focus:border-blue-400 outline-none"
                    value={agentDirection} onInput={(e) => setAgentDirection((e.target as HTMLInputElement).value)}
                    placeholder="e.g., Focus on sampling speed improvements" />
                </div>
                {agentError && <p className="text-xs text-red-600">{agentError}</p>}
                <div className="flex gap-2">
                  <button className="flex-1 py-2 bg-academic-accent text-white rounded-md hover:bg-red-700 disabled:opacity-50 text-xs font-medium"
                    onClick={agentStart} disabled={agentLoading || !agentQuestion.trim()}>
                    {agentLoading ? 'Starting...' : 'Start Research'}
                  </button>
                  <button className="px-3 py-2 text-xs border border-gray-300 rounded-md text-gray-500 hover:bg-gray-50"
                    onClick={() => { setAgentPhase('idle'); setAgentError(null) }}>Cancel</button>
                </div>
              </div>
            ) : (
              /* Idle — clean state */
              <div className="max-w-lg mx-auto py-16 text-center space-y-6">
                <div className="text-academic-muted">
                  <i className="fa-solid fa-robot text-5xl opacity-20"></i>
                </div>
                <h3 className="text-lg font-semibold text-gray-700">Research Agent</h3>
                <p className="text-sm text-gray-500">
                  Start an AI-powered research session. The agent will search, read, compare papers,
                  and build a LaTeX research document iteratively — with your guidance at each step.
                </p>
              </div>
            )}
          </div>

          {/* Bottom Research Session Area */}
          <div className={`${isAgentChatExpanded ? 'absolute inset-x-2 bottom-2 top-2 z-30 shadow-[0_-18px_46px_rgba(15,23,42,0.16)]' : 'h-[320px] shrink-0'} border-t-2 border-academic-border bg-academic-panel flex overflow-hidden transition-all duration-200`}>
            {agentPhase !== 'idle' ? (
              <AIChat messages={agentMessages} nodes={agentTimelineNodes} loading={agentLoading || agentPhase === 'running'}
                expanded={isAgentChatExpanded}
                onToggleExpanded={() => setIsAgentChatExpanded((previous) => !previous)}
                onSend={canSendAgentCommand ? agentRespond : undefined}
                placeholder={canSendAgentCommand ? '输入继续/结束/引导，或点击上方按钮...' : 'Agent is working...'}
                pendingReferences={pendingAgentReferences}
                onRemovePendingReference={removePendingAgentReference}
                hasSearchResults={hasAgentSearchPapers}
                onShowSearchResults={onShowAgentSearchPapers} />
            ) : (
              <AIChat
                nodes={agentTimelineNodes}
                expanded={isAgentChatExpanded}
                onToggleExpanded={() => setIsAgentChatExpanded((previous) => !previous)}
              />
            )}
          </div>
        </>
      ) : activeWorkspace.kind === 'deepRead' ? (
        <div className="flex-1 min-h-0 flex gap-2 overflow-hidden">
          {/* Middle Column: Tabs and List */}
          <div className="w-64 min-h-0 flex flex-col gap-2 shrink-0">
            {/* Top: Open Read Results Tabs */}
            <div className="flex-1 min-h-0 bg-white border-2 border-academic-border rounded flex flex-col overflow-hidden">
              <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
                <h3 className="font-serif text-xs font-bold flex items-center gap-2">
                  <i className="fa-solid fa-folder-open text-academic-accent text-xs"></i>
                  当前打开
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {openReadResults.map((resultId) => {
                  const summary = getReadResultSummary(resultId)
                  const title = summary?.paper_title || '未命名文献'
                  const meta = getDeepReadStatusMeta(summary?.status, summary?.progress || 0)

                  return (
                    <div
                      key={resultId}
                      className={`group rounded px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        activeReadResult === resultId
                          ? 'bg-academic-accent text-white'
                          : 'bg-academic-hover text-academic-text hover:bg-academic-border'
                      }`}
                      onClick={() => {
                        if (summary) {
                          void openReadResult(summary)
                        } else {
                          setActiveReadResult(resultId)
                        }
                      }}
                      title={title}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex flex-1 items-center gap-2">
                          <i className="fa-solid fa-file-lines shrink-0"></i>
                          <span className="read-result-title-marquee">
                            <span className="read-result-title-marquee__text">{title}</span>
                          </span>
                        </div>
                        {summary && (
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                            activeReadResult === resultId ? 'bg-white/20 text-white' : meta.chipClass
                          }`}>
                            {meta.text}
                          </span>
                        )}
                        <button
                          onClick={(e) => handleCloseOpenReadResult(resultId, e)}
                          className="shrink-0 hover:text-red-500"
                          aria-label="关闭阅读结果"
                          title="关闭阅读结果"
                        >
                          <i className="fa-solid fa-xmark text-xs"></i>
                        </button>
                      </div>
                      {summary && (
                        <DeepReadProgressBar
                          status={summary.status}
                          progress={summary.progress}
                          compact
                          inverted={activeReadResult === resultId}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Bottom: All Read Results List with Search */}
            <div className="flex-1 min-h-0 bg-white border-2 border-academic-border rounded flex flex-col overflow-hidden">
              <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
                <h3 className="font-serif text-xs font-bold flex items-center gap-2">
                  <i className="fa-solid fa-clock-rotate-left text-academic-accent text-xs"></i>
                  所有阅读结果
                </h3>
              </div>
              <div className="p-2 border-b border-academic-border">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="搜索..."
                    value={readResultSearch}
                    onInput={(event) => setReadResultSearch(event.currentTarget.value)}
                    className="w-full bg-academic-bg border border-academic-border rounded py-1.5 pl-3 pr-8 text-xs focus:outline-none focus:border-academic-accent transition-colors"
                  />
                  <button className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded bg-academic-accent text-white flex items-center justify-center hover:bg-red-700 transition-colors">
                    <i className="fa-solid fa-magnifying-glass text-[10px]"></i>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredReadResults.length > 0 ? (
                  filteredReadResults.map((result) => {
                    const meta = getDeepReadStatusMeta(result.status, result.progress)

                    return (
                      <div
                        key={result.task_id}
                        className={`border rounded p-2 transition-colors cursor-pointer ${
                          activeReadResult === result.task_id
                            ? 'bg-red-50 border-academic-accent'
                            : 'bg-academic-hover border-academic-border hover:bg-academic-border'
                        }`}
                        onClick={() => void openReadResult(result)}
                        title={result.paper_title}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="text-xs font-medium text-academic-text line-clamp-2">{result.paper_title}</h4>
                          <span className="shrink-0 text-[10px] text-academic-muted">{formatRelativeTime(result.updated_at)}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${meta.chipClass}`}>
                            <i className={`fa-solid ${meta.icon}`}></i>
                            {meta.text}
                          </span>
                          <span className="px-1.5 py-0.5 bg-white text-[10px] rounded text-academic-muted">{result.paper_id}</span>
                        </div>
                        <DeepReadProgressBar status={result.status} progress={result.progress} />
                      </div>
                    )
                  })
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-xs text-academic-muted">
                    暂无阅读结果
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Current Read Result Content */}
          <div className="flex-1 min-w-0 min-h-0 bg-white border-2 border-academic-border rounded overflow-hidden">
            {activeReadResult ? (
              <DeepReadResultView
                progress={deepReadProgress}
                currentStage={deepReadStage}
                stages={currentStages}
                paperTitle={activeReadSummary?.paper_title}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-academic-muted">
                  <i className="fa-solid fa-book-open text-4xl mb-3 opacity-30"></i>
                  <p className="text-sm">点击"深度阅读"开始分析论文</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-white overflow-y-auto p-8 flex items-center justify-center">
          <div className="text-center text-academic-muted">
            <i className="fa-regular fa-file-word text-4xl mb-3 opacity-30"></i>
            <p className="text-sm">Data Analysis 内容开发中...</p>
          </div>
        </div>
      )}
    </section>
  )
}

function DeepReadResultView({
  progress,
  currentStage,
  stages,
  paperTitle,
}: {
  progress: number
  currentStage: number
  stages: DeepReadStages
  paperTitle?: string
}) {
  const [activeTab, setActiveTab] = useState<'stage1' | 'stage2' | 'stage3'>('stage1')

  const stage1 = stages['1']
  const stage2 = stages['2']
  const stage3 = stages['3']
  const hasStageData = (stage: DeepReadStages[keyof DeepReadStages]) => {
    if (!stage || stage.error) return false
    return Object.entries(stage).some(([key, value]) => {
      if (key === 'error') return false
      if (Array.isArray(value)) return value.length > 0
      return value !== null && value !== undefined && String(value).trim() !== ''
    })
  }
  const hasStage1 = hasStageData(stage1)
  const hasStage2 = hasStageData(stage2)
  const hasStage3 = hasStageData(stage3)
  const isStage1Complete = !!stage1 && !stage1.error &&
    !!stage1.tl_dr &&
    !!stage1.research_problem &&
    !!stage1.core_insight &&
    Array.isArray(stage1.method_overview)
  const isStage2Complete = !!stage2 && !stage2.error &&
    Array.isArray(stage2.key_techniques) &&
    !!stage2.differences_from_baseline &&
    Array.isArray(stage2.assumptions) &&
    !!stage2.experimental_setup &&
    Array.isArray(stage2.key_results) &&
    Array.isArray(stage2.surprising_findings) &&
    !!stage2.critical_reading
  const isStage3Complete = !!stage3 && !stage3.error &&
    Array.isArray(stage3.predecessor_papers) &&
    Array.isArray(stage3.successor_papers) &&
    !!stage3.field_position

  const stageState = (
    n: number,
    stage: DeepReadStages[keyof DeepReadStages],
    isComplete: boolean,
  ) => {
    if (stage?.error) return 'error'
    if (isComplete || currentStage > n) return 'completed'
    if (currentStage === n || hasStageData(stage)) return 'active'
    return 'pending'
  }

  const isStageAvailable = (n: number, stage: DeepReadStages[keyof DeepReadStages]) => {
    return n === 1 || !!stage || currentStage >= n
  }

  const handleOpenRelatedPaper = (arxivId: string) => {
    if (!arxivId) return
    window.dispatchEvent(new CustomEvent('openRelatedPaper', {
      detail: { paperId: arxivId },
    }))
  }

  const tabs = [
    {
      key: 'stage1' as const,
      n: 1,
      label: '核心理解',
      icon: 'fa-lightbulb',
      state: stageState(1, stage1, isStage1Complete),
      isAvailable: isStageAvailable(1, stage1),
    },
    {
      key: 'stage2' as const,
      n: 2,
      label: '深度分析',
      icon: 'fa-microscope',
      state: stageState(2, stage2, isStage2Complete),
      isAvailable: isStageAvailable(2, stage2),
    },
    {
      key: 'stage3' as const,
      n: 3,
      label: '学术脉络',
      icon: 'fa-project-diagram',
      state: stageState(3, stage3, isStage3Complete),
      isAvailable: isStageAvailable(3, stage3),
    },
  ]

  useEffect(() => {
    const availableTabs = [
      { key: 'stage1' as const, isAvailable: true },
      { key: 'stage2' as const, isAvailable: !!stage2 || currentStage >= 2 },
      { key: 'stage3' as const, isAvailable: !!stage3 || currentStage >= 3 },
    ]
    const currentTab = availableTabs.find((tab) => tab.key === activeTab)
    if (currentTab?.isAvailable) {
      return
    }

    const firstAvailableTab = availableTabs.find((tab) => tab.isAvailable)
    if (firstAvailableTab) {
      setActiveTab(firstAvailableTab.key)
    }
  }, [activeTab, currentStage, stage1, stage2, stage3])

  return (
    <div className="h-full min-h-0 flex flex-col bg-white">
      {/* Fixed header: title + progress + tabs */}
      <div className="shrink-0 px-8 pt-8">
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <h2 className="font-serif text-2xl font-bold text-academic-text" title={paperTitle}>
            深度阅读结果
          </h2>

          <div className="min-w-[280px] max-w-xl flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-academic-border">
                <div
                  className="h-full rounded-full bg-academic-accent transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs font-medium text-academic-accent">{progress}%</span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {tabs.map(({ n, label, state }) => {
                const dotClass =
                  state === 'completed' ? 'bg-academic-accent text-white' :
                  state === 'error' ? 'bg-red-100 text-red-600 border border-red-200' :
                  state === 'active' ? 'border-2 border-academic-accent bg-white' :
                  'border-2 border-academic-border bg-white'
                const textClass =
                  state === 'active' ? 'text-academic-accent font-medium' :
                  state === 'error' ? 'text-red-600 font-medium' :
                  'text-academic-muted'

                return (
                  <div key={n} className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full flex items-center justify-center ${dotClass}`}>
                      {state === 'completed' ? <i className="fa-solid fa-check text-[5px]"></i> :
                       state === 'error' ? <i className="fa-solid fa-exclamation text-[5px]"></i> :
                       state === 'active' ? <div className="w-1 h-1 rounded-full bg-academic-accent animate-pulse"></div> :
                       null}
                    </div>
                    <span className={textClass}>{label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-academic-border pb-0">
          {tabs.map(({ key, label, icon, isAvailable }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              disabled={!isAvailable}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                activeTab === key
                  ? 'bg-white border border-academic-border border-b-white -mb-[1px] text-academic-accent font-medium'
                  : 'text-academic-muted hover:text-academic-text hover:bg-academic-hover'
              }`}
            >
              <i className={`fa-solid ${icon} text-xs`}></i>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-8 pb-8 pt-5">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Stage 1 */}
          {activeTab === 'stage1' && (
            <>
              {hasStage1 ? (
                <Stage1Cards result={stage1 as Partial<Stage1Result>} />
              ) : stage1?.error ? (
                <ErrorCard title="核心理解" message={stage1.error} />
              ) : (
                <LoadingCard title="核心理解" active={currentStage === 1} />
              )}
            </>
          )}

          {/* Stage 2 */}
          {activeTab === 'stage2' && (
            <>
              {hasStage2 ? (
                <Stage2Cards result={stage2 as Partial<Stage2Result>} />
              ) : stage2?.error ? (
                <ErrorCard title="深度分析" message={stage2.error} />
              ) : currentStage < 2 ? (
                <PendingCard title="深度分析" />
              ) : (
                <LoadingCard title="深度分析" active={currentStage === 2} />
              )}
            </>
          )}

          {/* Stage 3 */}
          {activeTab === 'stage3' && (
            <>
              {hasStage3 ? (
                <Stage3Cards
                  result={stage3 as Partial<Stage3Result>}
                  onOpenPaper={handleOpenRelatedPaper}
                />
              ) : stage3?.error ? (
                <ErrorCard title="学术脉络" message={stage3.error} />
              ) : currentStage < 3 ? (
                <PendingCard title="学术脉络" />
              ) : (
                <LoadingCard title="学术脉络" active={currentStage === 3} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stage Card Components ──────────────────────────────────────────────────

function CollapsibleCard({ title, icon, defaultOpen = true, children }: {
  title: string
  icon: string
  defaultOpen?: boolean
  children: any
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white border border-academic-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-academic-hover transition-colors"
      >
        <h4 className="font-serif text-sm font-bold text-academic-text flex items-center gap-2">
          <i className={`fa-solid ${icon} text-academic-accent text-xs`}></i>
          {title}
        </h4>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-academic-muted`}></i>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  )
}

function Stage1Cards({ result }: { result: Partial<Stage1Result> }) {
  return (
    <>
      {result.tl_dr && (
        <div className="p-5 bg-gradient-to-r from-red-50 to-white border border-academic-border rounded-lg">
          <p className="text-base font-serif font-bold text-academic-accent leading-relaxed">
            {result.tl_dr}
          </p>
        </div>
      )}
      {result.research_problem && (
        <CollapsibleCard title="研究问题" icon="fa-circle-question">
          <p className="text-sm text-academic-text/90 leading-relaxed">{result.research_problem}</p>
        </CollapsibleCard>
      )}
      {result.core_insight && (
        <CollapsibleCard title="核心洞察" icon="fa-lightbulb">
          <p className="text-sm text-academic-text/90 leading-relaxed">{result.core_insight}</p>
        </CollapsibleCard>
      )}
      {result.method_overview && result.method_overview.length > 0 && (
        <CollapsibleCard title="方法概述" icon="fa-diagram-project">
          <ol className="space-y-2">
            {result.method_overview.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-academic-text/90">
                <span className="text-academic-accent font-bold shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </CollapsibleCard>
      )}
    </>
  )
}

function Stage2Cards({ result }: { result: Partial<Stage2Result> }) {
  return (
    <>
      {result.key_techniques && result.key_techniques.length > 0 && (
        <CollapsibleCard title="关键技术" icon="fa-gear">
          <div className="space-y-3">
            {result.key_techniques.map((tech, i) => (
              <div key={i} className="p-3 bg-academic-hover rounded-lg">
                <h5 className="text-sm font-bold text-academic-text">{tech.name}</h5>
                <p className="text-xs text-academic-text/70 mt-1">{tech.description}</p>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}
      {result.differences_from_baseline && (
        <CollapsibleCard title="与 Baseline 的本质区别" icon="fa-code-branch">
          <p className="text-sm text-academic-text/90 leading-relaxed">{result.differences_from_baseline}</p>
        </CollapsibleCard>
      )}
      {result.assumptions && result.assumptions.length > 0 && (
        <CollapsibleCard title="前提假设" icon="fa-scale-balanced">
          <ul className="space-y-1.5">
            {result.assumptions.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-academic-text/80">
                <span className="text-academic-accent">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}
      {result.experimental_setup && (
        <CollapsibleCard title="实验设计" icon="fa-flask" defaultOpen={false}>
          <p className="text-sm text-academic-text/90 leading-relaxed">{result.experimental_setup}</p>
        </CollapsibleCard>
      )}
      {result.key_results && result.key_results.length > 0 && (
        <CollapsibleCard title="核心实验结果" icon="fa-chart-bar" defaultOpen={false}>
          <div className="space-y-3">
            {result.key_results.map((kr, i) => (
              <div key={i} className="p-3 bg-academic-hover rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-academic-text">{kr.metric}</span>
                  <span className="text-xs bg-academic-accent text-white px-2 py-0.5 rounded font-mono">{kr.value}</span>
                </div>
                <p className="text-xs text-academic-text/70">{kr.interpretation}</p>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}
      {result.surprising_findings && result.surprising_findings.length > 0 && (
        <CollapsibleCard title="意外发现" icon="fa-wand-magic-sparkles" defaultOpen={false}>
          <ul className="space-y-1.5">
            {result.surprising_findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm text-academic-text/80">
                <span className="text-amber-500">!</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}
      {result.critical_reading && (
        <CollapsibleCard title="批判性阅读" icon="fa-comment-dots">
        <div className="space-y-4">
          {result.critical_reading.strengths?.length > 0 && <div>
            <h5 className="text-xs font-bold text-green-700 mb-1.5">亮点</h5>
            <ul className="space-y-1">
              {result.critical_reading.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-academic-text/80">
                  <span className="text-green-500">+</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>}
          {result.critical_reading.limitations?.length > 0 && <div>
            <h5 className="text-xs font-bold text-red-700 mb-1.5">局限</h5>
            <ul className="space-y-1">
              {result.critical_reading.limitations.map((l, i) => (
                <li key={i} className="flex gap-2 text-sm text-academic-text/80">
                  <span className="text-red-500">-</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>}
          {result.critical_reading.reproducibility && <div>
            <h5 className="text-xs font-bold text-academic-text mb-1.5">可复现性</h5>
            <p className="text-sm text-academic-text/70">{result.critical_reading.reproducibility}</p>
          </div>}
        </div>
      </CollapsibleCard>
      )}
    </>
  )
}

function Stage3Cards({ result, onOpenPaper }: {
  result: Partial<Stage3Result>
  onOpenPaper: (arxivId: string) => void
}) {
  const predecessorPapers = result.predecessor_papers ?? []
  const successorPapers = result.successor_papers ?? []

  return (
    <>
      {result.field_position && (
        <CollapsibleCard title="领域定位" icon="fa-compass">
          <p className="text-sm text-academic-text/90 leading-relaxed">{result.field_position}</p>
        </CollapsibleCard>
      )}
      {result.predecessor_papers && (
        <CollapsibleCard title={`前驱论文 (${predecessorPapers.length})`} icon="fa-arrow-left">
        {predecessorPapers.length > 0 ? (
          <div className="grid gap-2">
            {predecessorPapers.map((paper, i) => (
              <RelatedPaperCard key={i} paper={paper} onOpen={onOpenPaper} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-academic-muted">未找到前驱论文信息</p>
        )}
      </CollapsibleCard>
      )}
      {result.successor_papers && (
        <CollapsibleCard title={`后继论文 (${successorPapers.length})`} icon="fa-arrow-right">
        {successorPapers.length > 0 ? (
          <div className="grid gap-2">
            {successorPapers.map((paper, i) => (
              <RelatedPaperCard key={i} paper={paper} onOpen={onOpenPaper} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-academic-muted">未找到后继论文信息</p>
        )}
      </CollapsibleCard>
      )}
    </>
  )
}

function RelatedPaperCard({ paper, onOpen }: {
  paper: RelatedPaper
  onOpen: (arxivId: string) => void
}) {
  const reference = relatedPaperToReference(paper)

  return (
    <div
      className="p-3 border border-academic-border rounded-lg hover:bg-academic-hover hover:border-academic-accent cursor-pointer transition-all group"
      onClick={() => onOpen(paper.arxiv_id)}
    >
      <h5 className="text-sm font-medium text-academic-text group-hover:text-academic-accent transition-colors line-clamp-2">
        {paper.title}
      </h5>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs text-academic-muted">
          {paper.authors?.slice(0, 2).join(', ') || 'Unknown'}
        </span>
        {paper.year && (
          <span className="text-xs text-academic-muted bg-academic-hover px-1.5 py-0.5 rounded">{paper.year}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ReferenceButton
            reference={reference}
            className="opacity-0 group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
          />
          <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-academic-muted opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </div>
      </div>
      {paper.relevance && (
        <p className="text-xs mt-1.5 text-academic-text/60 italic">{paper.relevance}</p>
      )}
    </div>
  )
}

function ReferenceButton({
  reference,
  className = '',
  onClick,
}: {
  reference: ConversationReferenceObject
  className?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded border border-academic-border bg-white text-academic-muted transition-colors hover:border-academic-accent hover:text-academic-accent ${className}`}
      title="引用到对话"
      aria-label="引用到对话"
      onClick={(event) => {
        onClick?.(event)
        addReferenceToConversation(reference)
      }}
    >
      <i className="fa-solid fa-quote-right text-[10px]"></i>
    </button>
  )
}

// ── Placeholder Cards ──────────────────────────────────────────────────────

function LoadingCard({ title, active }: { title: string; active: boolean }) {
  return (
    <div className="bg-white border border-academic-border rounded-lg p-5">
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          active ? 'border-academic-accent' : 'border-academic-border'
        }`}>
          {active && <div className="w-2 h-2 rounded-full bg-academic-accent animate-pulse"></div>}
        </div>
        <div>
          <h4 className="font-serif text-sm font-bold text-academic-text">{title}</h4>
          <p className="text-xs text-academic-muted mt-0.5">
            {active ? '正在分析中...' : '等待中...'}
          </p>
        </div>
      </div>
    </div>
  )
}

function PendingCard({ title }: { title: string }) {
  return (
    <div className="bg-white border border-academic-border rounded-lg p-5 opacity-50">
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 rounded-full border-2 border-academic-border shrink-0"></div>
        <div>
          <h4 className="font-serif text-sm font-bold text-academic-text">{title}</h4>
          <p className="text-xs text-academic-muted mt-0.5">等待前置阶段完成...</p>
        </div>
      </div>
    </div>
  )
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-5">
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 rounded-full bg-red-200 text-red-600 flex items-center justify-center shrink-0">
          <i className="fa-solid fa-exclamation text-[10px]"></i>
        </div>
        <div>
          <h4 className="font-serif text-sm font-bold text-red-700">{title}</h4>
          <p className="text-xs text-red-600 mt-0.5">{message}</p>
        </div>
      </div>
    </div>
  )
}

interface ProgressStep {
  label: string
  status: 'completed' | 'active' | 'pending'
  description: string
  detail?: string
  progress?: number
  timestamp?: string
  stageNodes?: ProgressStageNode[]
}

interface ProgressStageNode {
  stage: number
  label: string
  status: 'completed' | 'active' | 'pending'
  description: string
  detail?: string
  timestamp?: string
}

function parseReferenceDeepReadStage(step: ProgressStep) {
  const stageMatch = step.label.match(/^Run: reference deep read stage (\d+)/)
  if (!stageMatch) return null

  const paperMatch = step.description.match(/for\s+(.+?)\.?$/)
  return {
    stage: Number(stageMatch[1]),
    paperId: paperMatch?.[1] || 'attached reference',
  }
}

function parseReferenceDeepReadStart(step: ProgressStep) {
  if (step.label !== 'Run: deep read reference') return null

  const paperMatch = step.description.match(/paper\s+(.+?)\.?$/)
  return paperMatch?.[1] || 'attached reference'
}

function compactReferenceDeepReadSteps(steps: ProgressStep[]) {
  const compacted: ProgressStep[] = []
  const groupByPaper = new Map<string, ProgressStep>()
  const wrapperLabels = new Set([
    'Run: deep read attached references',
    'Run: attach references',
  ])

  const getGroup = (paperId: string, fallbackStep: ProgressStep) => {
    const existing = groupByPaper.get(paperId)
    if (existing) return existing

    const group: ProgressStep = {
      label: 'Run: reference deep read',
      status: 'active',
      description: `Deep reading attached paper ${paperId}.`,
      progress: fallbackStep.progress ?? 0,
      timestamp: fallbackStep.timestamp,
      stageNodes: [],
    }
    groupByPaper.set(paperId, group)
    compacted.push(group)
    return group
  }

  steps.forEach((step) => {
    if (wrapperLabels.has(step.label)) {
      return
    }

    const startedPaperId = parseReferenceDeepReadStart(step)
    if (startedPaperId) {
      const group = getGroup(startedPaperId, step)
      group.status = step.status === 'pending' ? 'pending' : 'active'
      group.progress = Math.max(group.progress || 0, step.progress || 0)
      return
    }

    const stage = parseReferenceDeepReadStage(step)
    if (!stage) {
      compacted.push(step)
      return
    }

    const group = getGroup(stage.paperId, step)
    group.progress = Math.max(group.progress || 0, step.progress || 0)
    const stageNode: ProgressStageNode = {
      stage: stage.stage,
      label: `Stage ${stage.stage}`,
      status: step.status,
      description: step.description,
      detail: step.detail,
      timestamp: step.timestamp,
    }
    const existingIndex = group.stageNodes?.findIndex((node) => node.stage === stage.stage) ?? -1
    if (existingIndex >= 0 && group.stageNodes) {
      group.stageNodes[existingIndex] = stageNode
    } else {
      group.stageNodes = [...(group.stageNodes || []), stageNode].sort((a, b) => a.stage - b.stage)
    }

    const maxStage = Math.max(...(group.stageNodes || []).map((node) => node.stage))
    group.progress = Math.max(group.progress || 0, Math.min(100, Math.round((maxStage / 3) * 100)))
    group.status = maxStage >= 3 ? 'completed' : 'active'
    group.detail = stageNode.detail
    group.timestamp = group.timestamp || step.timestamp
  })

  return compacted
}

function ProgressDetailPreview({
  content,
  compact,
  muted = false,
  onExpand,
}: {
  content: string
  compact: boolean
  muted?: boolean
  onExpand: () => void
}) {
  return (
    <div className="group/detail relative mt-2">
      <button
        type="button"
        className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded border border-academic-border bg-white px-1.5 py-0.5 text-[9px] text-academic-muted opacity-80 shadow-sm transition-colors hover:border-academic-accent/40 hover:text-academic-accent group-hover/detail:opacity-100"
        title="展开完整内容"
        aria-label="展开完整内容"
        onClick={onExpand}
      >
        <i className="fa-solid fa-up-right-and-down-left-from-center text-[8px]"></i>
        展开
      </button>
      <pre className={`${compact ? 'max-h-24' : 'max-h-20'} overflow-auto whitespace-pre-wrap rounded ${muted ? 'bg-academic-bg' : 'border border-academic-border bg-white'} px-2 py-1.5 pr-14 font-mono text-[9px] leading-4 text-academic-text/75`}>
        {content}
      </pre>
    </div>
  )
}

type AgentNodeKind = 'conversation' | 'deep_read' | 'thought'

interface AgentNode {
  id: string
  kind: AgentNodeKind
  title: string
  status: 'completed' | 'active' | 'pending'
  description: string
  timestamp?: string
  step?: ProgressStep
  messages: Array<{ message: ChatMessage; index: number }>
}

function isPromptLikeProgressStep(step?: ProgressStep) {
  if (!step) return false
  return (
    step.label === 'Await Decision' ||
    step.label === 'Await User Answer' ||
    step.label === 'Await Confirmation' ||
    step.label === 'Run: ask_user'
  )
}

function deriveConversationTitle(messages: Array<{ message: ChatMessage; index: number }>, fallback = 'Conversation') {
  const assistantWithActions = messages.find(({ message }) => (
    message.role === 'assistant' && Boolean(message.actions?.length)
  ))
  if (assistantWithActions) {
    const firstLine = assistantWithActions.message.content
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find(Boolean)
    return firstLine || fallback
  }
  const latest = messages[messages.length - 1]?.message
  if (!latest) return fallback
  return latest.role === 'user' ? 'User Input' : 'Conversation'
}

type ChatMessage = AgentChatMessage
type ChatAction = NonNullable<ChatMessage['actions']>[number]

function buildAgentNodesFromTimelineNodes(
  timelineNodes: AgentTimelineNode[],
  localMessages: ChatMessage[] = [],
): AgentNode[] {
  const nodes: AgentNode[] = []
  const backendMessageKeys = new Set<string>()
  let pendingDeepReadSteps: ProgressStep[] = []
  let messageIndex = 0

  const flushDeepReadSteps = () => {
    if (pendingDeepReadSteps.length === 0) return
    const compacted = compactReferenceDeepReadSteps(pendingDeepReadSteps)
    compacted.forEach((step, index) => {
      nodes.push({
        id: `deep-read-${step.label}-${step.timestamp || index}-${nodes.length}`,
        kind: 'deep_read',
        title: step.label,
        status: step.status,
        description: step.description || '',
        timestamp: step.timestamp,
        step,
        messages: [],
      })
    })
    pendingDeepReadSteps = []
  }

  const pushStepNode = (timelineNode: AgentTimelineNode, step: ProgressStep, index: number) => {
    const nextNode: AgentNode = {
      id: timelineNode.id || `${timelineNode.kind}-${index}`,
      kind: timelineNode.kind === 'conversation' ? 'conversation' : 'thought',
      title: timelineNode.title || step.label,
      status: normalizeNodeStatus(timelineNode.status || step.status),
      description: step.description || '',
      timestamp: step.timestamp || timelineNode.created_at,
      step,
      messages: [],
    }
    const previousNode = nodes[nodes.length - 1]
    const isDuplicate = previousNode
      && previousNode.kind === nextNode.kind
      && previousNode.title === nextNode.title
      && previousNode.description === nextNode.description
      && previousNode.messages.length === 0
    if (!isDuplicate) {
      nodes.push(nextNode)
    }
  }

  timelineNodes
    .slice()
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
    .forEach((timelineNode, index) => {
      const message = messageFromTimelineNode(timelineNode)
      if (message) {
        flushDeepReadSteps()
        backendMessageKeys.add(chatMessageSemanticKey(message))
        nodes.push({
          id: timelineNode.id || `conversation-${index}`,
          kind: 'conversation',
          title: timelineNode.title || (message.role === 'user' ? 'User Input' : 'Conversation'),
          status: normalizeNodeStatus(timelineNode.status),
          description: '',
          timestamp: message.created_at || timelineNode.created_at,
          messages: [{ message, index: messageIndex }],
        })
        messageIndex += 1
        return
      }

      const step = nodeStepToProgressStep(timelineNode)
      if (!step) return

      if (timelineNode.kind === 'conversation' && isPromptLikeProgressStep(step)) {
        return
      }

      if (timelineNode.kind === 'deep_read') {
        pendingDeepReadSteps.push(step)
        return
      }

      flushDeepReadSteps()
      pushStepNode(timelineNode, step, index)
    })

  flushDeepReadSteps()

  const localOnly = localMessages.filter((message) => !backendMessageKeys.has(chatMessageSemanticKey(message)))
  if (localOnly.length > 0) {
    nodes.push({
      id: 'local-conversation',
      kind: 'conversation',
      title: deriveConversationTitle(localOnly.map((message, index) => ({ message, index }))),
      status: 'completed',
      description: '',
      timestamp: localOnly[0]?.created_at,
      messages: localOnly.map((message, index) => ({ message, index: messageIndex + index })),
    })
  }

  return nodes
}

function AgentChoiceActions({
  actions,
  disabled,
  onChoose,
  onOther,
}: {
  actions: ChatAction[]
  disabled?: boolean
  onChoose?: (value: string) => void
  onOther: () => void
}) {
  const yesAction = actions[0]
  const noAction = actions[1]
  const buttonClass = 'rounded bg-academic-accent px-2.5 py-1 text-[10px] text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:hover:bg-gray-200'
  const explicitActionLabels: Record<string, string> = {
    retry: '重试',
    replan: '重新规划',
    done: '结束',
    finalize: '结束',
  }
  const hasExplicitRecoveryActions = actions.some((action) => action.value in explicitActionLabels)

  if (!yesAction || !noAction || hasExplicitRecoveryActions) {
    return (
      <div className="mt-2 flex justify-end gap-2 border-t border-academic-border pt-2">
        {actions.map((action, index) => (
          <button
            key={index}
            className={action.value === 'done' || action.value === 'finalize'
              ? 'rounded border border-academic-border bg-white px-2.5 py-1 text-[10px] text-academic-text transition-colors hover:bg-academic-hover disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-gray-100'
              : buttonClass}
            onClick={() => onChoose?.(action.value)}
            disabled={disabled || !onChoose}
            title={action.label}
          >
            {explicitActionLabels[action.value] || action.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-2 flex justify-end gap-2 border-t border-academic-border pt-2">
      <button
        className={buttonClass}
        onClick={() => onChoose?.(yesAction.value)}
        disabled={disabled || !onChoose}
        title={yesAction.label}
      >
        是
      </button>
      <button
        className={buttonClass}
        onClick={() => onChoose?.(noAction.value)}
        disabled={disabled || !onChoose}
        title={noAction.label}
      >
        否
      </button>
      <button
        className="rounded border border-academic-border bg-white px-2.5 py-1 text-[10px] text-academic-text transition-colors hover:bg-academic-hover disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-gray-100"
        onClick={onOther}
        disabled={disabled || !onChoose}
      >
        其他
      </button>
    </div>
  )
}

function nodeToText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: unknown } }).props
    return nodeToText(props?.children)
  }
  return ''
}

const chatMarkdownComponents: any = {
  a: ({ href, children }: { href?: string; children?: any }) => {
    const label = nodeToText(children) || href || ''
    const target = href ? resolveReferenceTarget(href, label) : null

    if (!target) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      )
    }

    return (
      <a
        href={target.href}
        className="inline-flex items-center gap-1 text-academic-accent underline decoration-red-200 underline-offset-2 hover:text-red-700"
        title="可引用对象，点击预览"
        onClick={(event) => {
          event.preventDefault()
          previewReferenceObject(referenceTargetToObject(target))
        }}
      >
        {children}
        <i className="fa-solid fa-quote-right text-[9px] no-underline"></i>
      </a>
    )
  },
}

function tryParseDetailJson(content?: string): unknown | null {
  if (!content) return null
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function formatDetailKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function markdownFromDetailValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const rendered = markdownFromDetailValue(item, depth + 1)
        return rendered.includes('\n') ? `- ${rendered.replace(/\n/g, '\n  ')}` : `- ${rendered}`
      })
      .join('\n')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const title = formatDetailKey(key)
        const rendered = markdownFromDetailValue(nestedValue, depth + 1)
        if (!rendered) return ''
        if (depth === 0) {
          return `### ${title}\n\n${rendered}`
        }
        return `- **${title}:** ${rendered.replace(/\n/g, '\n  ')}`
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return String(value)
}

function detailToMarkdown(content?: string) {
  const parsed = tryParseDetailJson(content)
  if (!parsed) return content || 'No detail available.'
  return markdownFromDetailValue(parsed) || 'No detail available.'
}

function DetailMarkdownContent({ content }: { content?: string }) {
  const markdown = detailToMarkdown(content)
  return (
    <div className="chat-markdown text-[11px] leading-5">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={chatMarkdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function MessageBubble({
  msg,
  index,
  copied,
  onCopy,
  showSearchIcon,
  onShowSearchResults,
  activeActionIndex,
  loading,
  onSend,
  onChoose,
  onOther,
}: {
  msg: ChatMessage
  index: number
  copied: boolean
  onCopy: (messageId: string, content: string) => void
  showSearchIcon: boolean
  onShowSearchResults?: () => void
  activeActionIndex: number
  loading?: boolean
  onSend?: (msg: string, references?: ConversationReferenceObject[]) => void
  onChoose: (value: string) => void
  onOther: () => void
}) {
  const messageId = msg.id || `message-${index}`

  return (
    <div className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative border rounded-lg px-3 py-2.5 pr-9 text-xs max-w-[92%] shadow-sm ${
        msg.role === 'user' ? 'bg-academic-bg text-academic-text max-w-[86%]' :
        msg.role === 'system' ? 'bg-amber-50 text-amber-900 max-w-[92%]' :
        'bg-academic-hover text-academic-text'
      }`}>
        <button
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-academic-muted opacity-40 transition-colors hover:bg-white hover:text-academic-text group-hover:opacity-100 focus:opacity-100"
          title={copied ? 'Copied' : 'Copy'}
          aria-label="Copy message"
          onClick={() => onCopy(messageId, msg.content)}
        >
          <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'} text-[10px]`}></i>
        </button>
        <div className="chat-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={chatMarkdownComponents}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
        {msg.references && msg.references.length > 0 && (
          <ReferenceAttachmentBar references={msg.references} readonly />
        )}
        {showSearchIcon && onShowSearchResults && (
          <button
            className="mt-2 inline-flex items-center gap-2 rounded-md border border-academic-accent/35 bg-red-50 px-2.5 py-1.5 text-[10px] font-medium text-academic-accent shadow-sm transition-colors hover:border-academic-accent hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-academic-accent/25"
            title="查看搜索到的论文"
            aria-label="查看搜索到的论文"
            onClick={onShowSearchResults}
          >
            <i className="fa-solid fa-list-ul text-[10px]"></i>
            查看搜索论文
          </button>
        )}
        {msg.actions && msg.actions.length > 0 && (
          <AgentChoiceActions
            actions={msg.actions}
            disabled={loading || !onSend || index !== activeActionIndex}
            onChoose={onChoose}
            onOther={onOther}
          />
        )}
      </div>
    </div>
  )
}

function NodeMessageList({
  messages,
  copiedMessageId,
  onCopy,
  latestAssistantIndex,
  activeActionIndex,
  loading,
  onSend,
  onChoose,
  onOther,
  hasSearchResults,
  onShowSearchResults,
}: {
  messages: Array<{ message: ChatMessage; index: number }>
  copiedMessageId: string | null
  onCopy: (messageId: string, content: string) => void
  latestAssistantIndex: number
  activeActionIndex: number
  loading?: boolean
  onSend?: (msg: string, references?: ConversationReferenceObject[]) => void
  onChoose: (value: string) => void
  onOther: () => void
  hasSearchResults?: boolean
  onShowSearchResults?: () => void
}) {
  return (
    <div className="space-y-3">
      {messages.map(({ message, index }) => {
        const messageId = message.id || `message-${index}`
        return (
          <MessageBubble
            key={messageId}
            msg={message}
            index={index}
            copied={copiedMessageId === messageId}
            onCopy={onCopy}
            showSearchIcon={Boolean(hasSearchResults && onShowSearchResults && message.role === 'assistant' && index === latestAssistantIndex)}
            onShowSearchResults={onShowSearchResults}
            activeActionIndex={activeActionIndex}
            loading={loading}
            onSend={onSend}
            onChoose={onChoose}
            onOther={onOther}
          />
        )
      })}
    </div>
  )
}

function AgentNodeShell({
  node,
  icon,
  children,
}: {
  node: AgentNode
  icon: string
  children?: any
}) {
  return (
    <div className="group flex justify-start">
      <div className="max-w-[92%] rounded-lg border border-dashed border-academic-border bg-white px-3 py-2.5 text-xs text-academic-text shadow-sm">
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
            node.status === 'completed'
              ? 'bg-academic-accent text-white'
              : node.status === 'active'
                ? 'border-2 border-academic-accent bg-white text-academic-accent'
                : 'border border-academic-border bg-white text-academic-muted'
          }`}>
            {node.status === 'completed' ? (
              <i className="fa-solid fa-check text-[8px]"></i>
            ) : (
              <i className={`fa-solid ${icon} text-[8px]`}></i>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-academic-muted">
                {node.kind === 'deep_read' ? 'Deep Read Node' : node.kind === 'conversation' ? 'Conversation Node' : 'Thought Node'}
              </span>
              <span className="text-xs font-medium text-academic-text">{node.title}</span>
              {node.status === 'active' && (
                <span className="inline-flex items-center gap-1 rounded-sm border border-red-100 bg-red-50 px-1.5 py-0.5 text-[9px] text-academic-accent">
                  In Progress
                  <span className="inline-flex gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-academic-accent animate-bounce"></span>
                    <span className="h-1 w-1 rounded-full bg-academic-accent animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                    <span className="h-1 w-1 rounded-full bg-academic-accent animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                  </span>
                </span>
              )}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function ThoughtNodeRenderer({
  node,
  onExpandDetail,
}: {
  node: AgentNode
  onExpandDetail: (title: string, content: string) => void
}) {
  const detail = node.step?.detail

  return (
    <AgentNodeShell node={node} icon="fa-brain">
      {node.description && (
        <p className="mt-1 text-[10px] leading-4 text-academic-muted">{node.description}</p>
      )}
      {node.step?.progress !== undefined && node.status === 'active' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full border border-academic-border bg-academic-bg">
          <div className="h-full rounded-full bg-academic-accent" style={{ width: `${node.step.progress}%` }} />
        </div>
      )}
      {detail && (
        <ProgressDetailPreview
          compact
          content={detail}
          muted
          onExpand={() => onExpandDetail(node.title, detail)}
        />
      )}
    </AgentNodeShell>
  )
}

function DeepReadNodeRenderer({
  node,
  onExpandDetail,
}: {
  node: AgentNode
  onExpandDetail: (title: string, content: string) => void
}) {
  const stageNodes = node.step?.stageNodes || []
  const [selectedStageNumber, setSelectedStageNumber] = useState<number | null>(
    stageNodes[stageNodes.length - 1]?.stage || null
  )
  const stageKey = stageNodes.map((stage) => `${stage.stage}:${stage.status}`).join('|')
  useEffect(() => {
    if (stageNodes.length === 0) return
    if (!stageNodes.some((stage) => stage.stage === selectedStageNumber)) {
      setSelectedStageNumber(stageNodes[stageNodes.length - 1].stage)
    }
  }, [stageKey])
  const selectedStage = stageNodes.find((stage) => stage.stage === selectedStageNumber) || stageNodes[stageNodes.length - 1]
  const detail = selectedStage?.detail || node.step?.detail
  const progress = node.step?.progress ?? (stageNodes.length > 0 ? Math.round((stageNodes.length / 3) * 100) : 0)
  const stageLabels: Record<number, string> = {
    1: '核心概念',
    2: '论证结构',
    3: '综合评估',
  }
  const expandedMarkdown = detail ? detailToMarkdown(detail) : ''

  return (
    <AgentNodeShell node={node} icon="fa-book-open-reader">
      {node.description && (
        <p className="mt-1 text-[10px] leading-4 text-academic-muted">{node.description}</p>
      )}
      <div className="mt-3">
        <div className="relative px-1 pb-7 pt-2">
          <div className="absolute left-1 right-1 top-[17px] h-1.5 overflow-hidden rounded-full border border-academic-border bg-academic-bg">
            <div className="h-full rounded-full bg-academic-accent transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="relative flex justify-between">
            {[1, 2, 3].map((stageNumber) => {
              const stage = stageNodes.find((item) => item.stage === stageNumber)
              const selected = selectedStage?.stage === stageNumber
              return (
                <button
                  key={stageNumber}
                  type="button"
                  className={`group/stage flex flex-col items-center gap-1 text-[10px] transition-colors ${
                    stage ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  title={stage?.description || stageLabels[stageNumber]}
                  disabled={!stage}
                  onClick={() => stage && setSelectedStageNumber(stage.stage)}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-semibold shadow-sm transition-colors ${
                    selected
                      ? 'border-academic-accent bg-academic-accent text-white'
                      : stage
                        ? 'border-academic-accent bg-white text-academic-accent group-hover/stage:bg-red-50'
                        : 'border-academic-border bg-white text-academic-muted'
                  }`}
                  >
                    {stageNumber}
                  </span>
                  <span className={`w-16 truncate text-center ${selected ? 'text-academic-accent' : 'text-academic-muted'}`}>
                    {stageLabels[stageNumber]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        {(selectedStage || detail) && (
          <div className="rounded border border-academic-border bg-academic-bg/60 px-3 py-2">
            {selectedStage && (
              <>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-academic-text">
                    {stageLabels[selectedStage.stage] || selectedStage.label}
                  </span>
                  <span className="text-[9px] text-academic-muted">{selectedStage.status}</span>
                </div>
                {selectedStage.description && (
                  <p className="mb-2 text-[10px] leading-4 text-academic-muted">{selectedStage.description}</p>
                )}
              </>
            )}
            <DetailMarkdownContent content={detail} />
            {detail && (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 rounded border border-academic-border bg-white px-2 py-1 text-[10px] text-academic-muted transition-colors hover:text-academic-accent"
                onClick={() => onExpandDetail(selectedStage?.label || node.title, expandedMarkdown)}
              >
                <i className="fa-solid fa-up-right-and-down-left-from-center text-[9px]"></i>
                展开完整内容
              </button>
            )}
          </div>
        )}
      </div>
    </AgentNodeShell>
  )
}

function AgentNodeRenderer({
  node,
  copiedMessageId,
  onCopyMessage,
  latestAssistantIndex,
  activeActionIndex,
  loading,
  onSend,
  onChoose,
  onOther,
  hasSearchResults,
  onShowSearchResults,
  onExpandDetail,
}: {
  node: AgentNode
  copiedMessageId: string | null
  onCopyMessage: (messageId: string, content: string) => void
  latestAssistantIndex: number
  activeActionIndex: number
  loading?: boolean
  onSend?: (msg: string, references?: ConversationReferenceObject[]) => void
  onChoose: (value: string) => void
  onOther: () => void
  hasSearchResults?: boolean
  onShowSearchResults?: () => void
  onExpandDetail: (title: string, content: string) => void
}) {
  const renderMessages = () => (
    <NodeMessageList
      messages={node.messages}
      copiedMessageId={copiedMessageId}
      onCopy={onCopyMessage}
      latestAssistantIndex={latestAssistantIndex}
      activeActionIndex={activeActionIndex}
      loading={loading}
      onSend={onSend}
      onChoose={onChoose}
      onOther={onOther}
      hasSearchResults={hasSearchResults}
      onShowSearchResults={onShowSearchResults}
    />
  )

  if (node.kind === 'conversation') {
    return renderMessages()
  }

  return (
    <div className="space-y-3">
      {node.kind === 'deep_read' ? (
        <DeepReadNodeRenderer node={node} onExpandDetail={onExpandDetail} />
      ) : (
        <ThoughtNodeRenderer node={node} onExpandDetail={onExpandDetail} />
      )}
      {node.messages.length > 0 && renderMessages()}
    </div>
  )
}

function AIChat({
  messages,
  nodes = [],
  onSend,
  loading,
  placeholder,
  pendingReferences = [],
  onRemovePendingReference,
  hasSearchResults,
  onShowSearchResults,
  expanded = false,
  onToggleExpanded,
}: {
  messages?: ChatMessage[]
  nodes?: AgentTimelineNode[]
  onSend?: (msg: string, references?: ConversationReferenceObject[]) => void
  loading?: boolean
  placeholder?: string
  pendingReferences?: ConversationReferenceObject[]
  onRemovePendingReference?: (reference: ConversationReferenceObject) => void
  hasSearchResults?: boolean
  onShowSearchResults?: () => void
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  const [input, setInput] = useState('')
  const [isOtherInput, setIsOtherInput] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [detailModal, setDetailModal] = useState<{ title: string; content: string } | null>(null)
  const [copiedDetailModal, setCopiedDetailModal] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [messages, nodes, loading])

  const handleSend = () => {
    const text = input.trim()
    if ((!text && pendingReferences.length === 0) || !onSend) return
    onSend(text, pendingReferences)
    setInput('')
    setIsOtherInput(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend()
  }

  const handleCopy = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessageId(messageId)
      window.setTimeout(() => setCopiedMessageId(current => current === messageId ? null : current), 1200)
    } catch {
      setCopiedMessageId(null)
    }
  }

  const copyDetailModalContent = async () => {
    if (!detailModal) return

    try {
      await navigator.clipboard.writeText(detailModal.content)
      setCopiedDetailModal(true)
      window.setTimeout(() => setCopiedDetailModal(false), 1200)
    } catch {
      setCopiedDetailModal(false)
    }
  }

  useEffect(() => {
    if (!detailModal) return
    setCopiedDetailModal(false)

    const handleKeyDown = (event: any) => {
      if (event.key === 'Escape') {
        setDetailModal(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [detailModal])

  const displayMessages: ChatMessage[] = messages || []
  const activeActionIndex = displayMessages.reduce((latest, msg, index) => (
    msg.actions && msg.actions.length > 0 ? index : latest
  ), -1)
  const latestAssistantIndex = displayMessages.reduce((latest, msg, index) => (
    msg.role === 'assistant' ? index : latest
  ), -1)
  const agentNodes = buildAgentNodesFromTimelineNodes(nodes, displayMessages)
  const activeActivityNode = agentNodes
    .slice()
    .reverse()
    .find((node) => node.status === 'active' || node.step?.status === 'active')
  const latestStepNode = agentNodes
    .slice()
    .reverse()
    .find((node) => node.step)
  const loadingNodeId = loading ? (activeActivityNode || latestStepNode)?.id : null
  const focusOtherInput = () => {
    setIsOtherInput(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }
  const chooseAction = (value: string) => {
    setIsOtherInput(false)
    onSend?.(value, pendingReferences)
  }

  return (
    <div className="w-full min-h-0 overflow-hidden flex flex-col bg-white">
      <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center justify-between px-3">
        <h3 className="font-serif text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-robot text-academic-accent text-xs"></i>
          Research Session
        </h3>
        <div className="flex gap-2">
          <button
            className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
              expanded
                ? 'border-academic-accent bg-red-50 text-academic-accent hover:bg-red-100'
                : 'border-academic-border bg-white text-academic-muted hover:border-academic-accent/50 hover:text-academic-text'
            }`}
            title={expanded ? 'Collapse conversation' : 'Expand conversation'}
            aria-label={expanded ? 'Collapse conversation' : 'Expand conversation'}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <i className={`fa-solid ${expanded ? 'fa-down-left-and-up-right-to-center' : 'fa-up-right-and-down-left-from-center'} text-[10px]`}></i>
          </button>
          <button className="text-academic-muted hover:text-academic-text transition-colors"><i className="fa-solid fa-ellipsis-vertical text-xs"></i></button>
        </div>
      </div>

      {/* Chat History */}
      <AutoHideScrollArea
        className="min-h-0 flex-1"
        viewportClassName="p-6 pr-4 space-y-4"
        scrollRef={chatRef}
      >
        {agentNodes.length === 0 && !loading && (
          <p className="text-xs text-academic-muted text-center py-8">Start the agent to begin the research conversation.</p>
        )}
        {agentNodes.map((node) => {
          const renderedNode = node.id === loadingNodeId
            ? {
              ...node,
              status: 'active' as const,
              step: node.step ? { ...node.step, status: 'active' as const } : node.step,
            }
            : node
          return (
            <AgentNodeRenderer
              key={node.id}
              node={renderedNode}
              copiedMessageId={copiedMessageId}
              onCopyMessage={(messageId, content) => void handleCopy(messageId, content)}
              latestAssistantIndex={latestAssistantIndex}
              activeActionIndex={activeActionIndex}
              loading={loading}
              onSend={onSend}
              onChoose={chooseAction}
              onOther={focusOtherInput}
              hasSearchResults={hasSearchResults}
              onShowSearchResults={onShowSearchResults}
              onExpandDetail={(title, content) => setDetailModal({ title, content })}
            />
          )
        })}

        {loading && agentNodes.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[82%] rounded-lg border border-academic-border bg-academic-hover p-3 text-xs text-academic-muted shadow-sm">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-academic-accent bg-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-academic-accent animate-pulse"></span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-xs font-medium text-academic-text">{placeholder || 'Agent is working...'}</span>
                    <span className="inline-flex gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-academic-accent animate-bounce"></span>
                      <span className="h-1 w-1 rounded-full bg-academic-accent animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                      <span className="h-1 w-1 rounded-full bg-academic-accent animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </AutoHideScrollArea>
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-6">
          <div className="flex h-[min(82vh,720px)] w-[min(760px,calc(100vw-48px))] flex-col overflow-hidden rounded-lg border-2 border-academic-border bg-white shadow-hover">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-academic-border bg-academic-hover px-3">
              <h3 className="min-w-0 truncate font-serif text-sm font-bold text-academic-text">{detailModal.title}</h3>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded border border-academic-border bg-white px-2 text-[10px] text-academic-muted transition-colors hover:text-academic-text"
                  title="复制完整内容"
                  aria-label="复制完整内容"
                  onClick={() => void copyDetailModalContent()}
                >
                  <i className={`fa-solid ${copiedDetailModal ? 'fa-check' : 'fa-copy'} text-[10px]`}></i>
                  {copiedDetailModal ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded text-academic-muted transition-colors hover:bg-white hover:text-academic-text"
                  title="关闭"
                  aria-label="关闭"
                  onClick={() => setDetailModal(null)}
                >
                  <i className="fa-solid fa-xmark text-xs"></i>
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <AutoHideScrollArea className="h-full" viewportClassName="p-4">
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-academic-text">
                  {detailModal.content}
                </pre>
              </AutoHideScrollArea>
            </div>
          </div>
        </div>
      )}

      {/* Chat Input */}
      {onSend && (
        <div className="p-3 border-t border-academic-border bg-white shrink-0">
          <ReferenceAttachmentBar
            references={pendingReferences}
            onRemove={onRemovePendingReference}
          />
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              className="w-full bg-academic-bg border border-academic-border rounded-full py-2 pl-4 pr-10 text-xs focus:outline-none focus:border-academic-accent transition-colors text-academic-text"
              placeholder={isOtherInput ? '请输入其他要求...' : (placeholder || 'Ask about your research...')}
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="absolute right-1 w-7 h-7 rounded-full bg-academic-accent text-white flex items-center justify-center hover:bg-red-700 transition-colors disabled:opacity-50"
              onClick={handleSend}
              disabled={loading || (!input.trim() && pendingReferences.length === 0)}
            >
              <i className="fa-solid fa-arrow-up text-[10px]"></i>
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

function ReferenceAttachmentBar({
  references,
  readonly = false,
  onRemove,
}: {
  references: ConversationReferenceObject[]
  readonly?: boolean
  onRemove?: (reference: ConversationReferenceObject) => void
}) {
  if (references.length === 0) return null

  return (
    <div className={`${readonly ? 'mt-2' : 'mb-2'} flex flex-wrap gap-1.5`}>
      {references.map((reference) => (
        <span
          key={reference.paperId || reference.href}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-academic-border bg-academic-bg px-2 py-1 text-[10px] text-academic-text"
        >
          <button
            type="button"
            className="min-w-0 truncate text-left hover:text-academic-accent"
            title="点击预览"
            onClick={() => previewReferenceObject(reference)}
          >
            <span className="font-medium">{reference.label}</span>
            {reference.paperId ? (
              <span className="ml-1 font-mono text-academic-muted">{reference.paperId}</span>
            ) : null}
          </button>
          {!readonly && onRemove ? (
            <button
              type="button"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-academic-muted opacity-0 transition-opacity hover:bg-white hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
              title="删除引用"
              aria-label="删除引用"
              onClick={() => onRemove(reference)}
            >
              <i className="fa-solid fa-xmark text-[9px]"></i>
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function RightWorkspace({
  agentSearchPapers,
  showAgentSearchPapers,
  onShowAgentSearchPapers,
  onHideAgentSearchPapers,
}: {
  agentSearchPapers: AgentSearchPaper[]
  showAgentSearchPapers: boolean
  onShowAgentSearchPapers: () => void
  onHideAgentSearchPapers: () => void
}) {
  const [showSearch, setShowSearch] = useState(true)
  const [openPapers, setOpenPapers] = useState<LiteratureDetail[]>([])
  const [activePaperId, setActivePaperId] = useState<string | null>(null)
  const [isPaperMenuOpen, setIsPaperMenuOpen] = useState(false)
  const [isDownloadingPaper, setIsDownloadingPaper] = useState(false)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([])
  const [referencePreview, setReferencePreview] = useState<ReferencePreviewState>({ kind: 'closed' })
  const referencePreviewRequestTokenRef = useRef(0)
  const paperMenuRef = useRef<HTMLDivElement | null>(null)

  const activePaper = openPapers.find((paper) => paper.paper_id === activePaperId) ?? null
  const isSearchVisible = !showAgentSearchPapers && (showSearch || openPapers.length === 0)
  const isReferencePreviewOpen = referencePreview.kind !== 'closed'
  const currentWorkspaceTitle =
    showAgentSearchPapers ? 'Agent Search Results' :
    showSearch || !activePaper ? 'Literature Search' : activePaper.title
  const currentWorkspaceDisplayTitle = formatPaperDisplayTitle(currentWorkspaceTitle)

  const handleClosePaper = (paperId: string, event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    const remainingPapers = openPapers.filter((paper) => paper.paper_id !== paperId)
    setOpenPapers(remainingPapers)

    if (activePaperId === paperId) {
      setActivePaperId(remainingPapers[0]?.paper_id ?? null)
      if (remainingPapers.length === 0) {
        setShowSearch(true)
      }
    }
  }

  const openPaperDetail = (detail: LiteratureDetail) => {
    setOpenPapers((previous) => {
      const existingIndex = previous.findIndex((item) => item.paper_id === detail.paper_id)
      if (existingIndex === -1) {
        return [...previous, detail]
      }

      const next = [...previous]
      next[existingIndex] = detail
      return next
    })

    setActivePaperId(detail.paper_id)
    setShowSearch(false)
    onHideAgentSearchPapers()
  }

  const handleOpenPaperById = async (paperId: string): Promise<LiteratureDetail | null> => {
    setPaperError(null)

    try {
      const detail = await literatureApi.getPaperDetail(paperId)
      openPaperDetail(detail)
      return detail
    } catch (error) {
      console.error('Failed to open paper:', error)
      setPaperError(error instanceof Error ? error.message : 'Failed to open paper')
      return null
    }
  }

  const handleOpenPaper = async (paper: LiteratureItem): Promise<LiteratureDetail | null> => {
    return handleOpenPaperById(paper.paper_id)
  }

  const handleCloseReferencePreview = () => {
    referencePreviewRequestTokenRef.current += 1
    setReferencePreview({ kind: 'closed' })
  }

  const handleOpenReferencePreview = async (target: LiteratureReferenceTarget) => {
    if (!target.isArxiv || !target.paperId) {
      referencePreviewRequestTokenRef.current += 1
      setReferencePreview({
        kind: 'external',
        href: target.href,
        label: target.label || target.href,
      })
      return
    }

    const requestToken = referencePreviewRequestTokenRef.current + 1
    referencePreviewRequestTokenRef.current = requestToken
    setReferencePreview({
      kind: 'paper-loading',
      paperId: target.paperId,
    })

    try {
      const detail = await literatureApi.getPaperDetail(target.paperId)
      if (referencePreviewRequestTokenRef.current !== requestToken) {
        return
      }

      setReferencePreview({
        kind: 'paper-ready',
        paper: detail,
      })
    } catch (error) {
      if (referencePreviewRequestTokenRef.current !== requestToken) {
        return
      }

      console.error('Failed to preview arXiv reference:', error)
      setReferencePreview({
        kind: 'paper-error',
        paperId: target.paperId,
        message: error instanceof Error ? error.message : 'Failed to preview arXiv reference',
      })
    }
  }

  const handleOpenPreviewPaperInReader = () => {
    if (referencePreview.kind !== 'paper-ready') {
      return
    }

    openPaperDetail(referencePreview.paper)
    handleCloseReferencePreview()
  }

  const getPreviewReference = (): ConversationReferenceObject | null => {
    if (referencePreview.kind === 'paper-ready') {
      return literaturePaperToReference(referencePreview.paper)
    }
    if (referencePreview.kind === 'paper-loading' || referencePreview.kind === 'paper-error') {
      return {
        kind: 'paper',
        label: referencePreview.paperId,
        href: paperHref(referencePreview.paperId),
        paperId: referencePreview.paperId,
      }
    }
    if (referencePreview.kind === 'external') {
      return {
        kind: 'link',
        label: referencePreview.label,
        href: referencePreview.href,
      }
    }
    return null
  }

  const handlePaperDownloaded = (paperId: string, localSourceUrl: string) => {
    setOpenPapers((previous) =>
      previous.map((paper) =>
        paper.paper_id === paperId
          ? {
              ...paper,
              is_downloaded: true,
              local_source_url: localSourceUrl,
            }
          : paper
      )
    )
  }

  const handleDownloadActivePaper = async () => {
    if (!activePaper) {
      return
    }

    try {
      setIsDownloadingPaper(true)
      const response = await literatureApi.download(activePaper.paper_id, activePaper.source)
      handlePaperDownloaded(activePaper.paper_id, response.local_source_url)
      openDownloadLink(response.local_source_url)
    } catch (error) {
      console.error('Failed to download active paper:', error)
      setPaperError(error instanceof Error ? error.message : 'Failed to download paper')
    } finally {
      setIsDownloadingPaper(false)
    }
  }

  const handleStartDeepRead = () => {
    if (!activePaper) {
      return
    }

    const event = new CustomEvent<StartDeepReadDetail>('startDeepRead', {
      detail: {
        paperId: activePaper.paper_id,
        paperTitle: activePaper.title,
        paperUrl: activePaper.local_source_url ?? activePaper.url ?? activePaper.source_url,
        paperContent: activePaper.original_text ?? activePaper.abstract,
      },
    })
    window.dispatchEvent(event)
  }

  const handleCreateAnnotation = (annotation: ReaderAnnotation) => {
    setAnnotations((previous) => [annotation, ...previous])
    window.dispatchEvent(new CustomEvent('openNotes'))
  }

  const handleUpdateAnnotationNote = (annotationId: string, note: string) => {
    setAnnotations((previous) =>
      previous.map((annotation) =>
        annotation.id === annotationId
          ? {
              ...annotation,
              note,
            }
          : annotation
      )
    )
  }

  const activeAnnotations = activePaper
    ? annotations.filter((annotation) => annotation.paperId === activePaper.paper_id)
    : []
  const referencePreviewAnnotations =
    referencePreview.kind === 'paper-ready'
      ? annotations.filter((annotation) => annotation.paperId === referencePreview.paper.paper_id)
      : []

  useEffect(() => {
    if (!isPaperMenuOpen) {
      return
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const menuNode = paperMenuRef.current
      if (!menuNode || !(event.target instanceof Node) || menuNode.contains(event.target)) {
        return
      }

      setIsPaperMenuOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isPaperMenuOpen])

  useEffect(() => {
    setIsPaperMenuOpen(false)
  }, [showSearch, activePaperId, openPapers.length, showAgentSearchPapers])

  useEffect(() => {
    if (!isReferencePreviewOpen) {
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseReferencePreview()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isReferencePreviewOpen])

  useEffect(() => {
    const handleOpenRelatedPaper = async (event: Event) => {
      const detail = (event as CustomEvent<{ paperId: string }>).detail
      if (detail?.paperId) {
        await handleOpenPaperById(detail.paperId)
      }
    }

    window.addEventListener('openRelatedPaper', handleOpenRelatedPaper)
    return () => {
      window.removeEventListener('openRelatedPaper', handleOpenRelatedPaper)
    }
  }, [])

  useEffect(() => {
    const handlePreviewReference = (event: Event) => {
      const reference = (event as CustomEvent<ConversationReferenceObject>).detail
      if (!reference) return
      void handleOpenReferencePreview(referenceToTarget(reference))
    }

    window.addEventListener('previewReferenceObject', handlePreviewReference)
    return () => {
      window.removeEventListener('previewReferenceObject', handlePreviewReference)
    }
  }, [])

  return (
    <section className="relative min-h-0 flex-1 flex flex-col bg-academic-bg p-2 overflow-hidden border-l-2 border-academic-border">
      <div className="bg-academic-panel border-b border-academic-border p-2 mb-2 flex items-center justify-between shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {openPapers.length === 0 ? (
            <button className="px-3 py-1 text-sm font-medium text-academic-muted border-b-2 border-academic-accent">
              {showAgentSearchPapers ? 'Agent Search Results' : 'Literature Search'}
            </button>
          ) : (
            <>
              <div ref={paperMenuRef} className="relative min-w-0 flex-1">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded-sm border-b-2 border-academic-accent px-3 py-1 text-sm font-medium text-academic-text transition-colors hover:text-academic-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-academic-accent/25"
                  onClick={() => setIsPaperMenuOpen((current) => !current)}
                  title={currentWorkspaceDisplayTitle}
                  aria-haspopup="menu"
                  aria-expanded={isPaperMenuOpen}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {currentWorkspaceDisplayTitle}
                  </span>
                  <span className="shrink-0 text-[10px] text-academic-muted">
                    <i className={`fa-solid ${isPaperMenuOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                  </span>
                </button>

                {isPaperMenuOpen ? (
                  <div className="absolute left-0 top-full z-20 mt-2 w-full min-w-[340px] max-w-[640px] overflow-hidden rounded-xl border border-academic-border bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
                    <div className="border-b border-academic-border bg-academic-bg/70 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-academic-muted">
                      Open Papers
                    </div>

                    <div className="max-h-72 overflow-y-auto py-1">
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          showSearch
                            ? 'bg-red-50 text-academic-accent'
                            : 'text-academic-text hover:bg-academic-hover'
                        }`}
                        onClick={() => {
                          setShowSearch(true)
                          onHideAgentSearchPapers()
                          setIsPaperMenuOpen(false)
                        }}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-academic-accent shadow-sm ring-1 ring-academic-border">
                          <i className="fa-solid fa-magnifying-glass text-[11px]"></i>
                        </span>
                        <span className="truncate">Literature Search</span>
                      </button>

                      <div className="my-1 border-t border-academic-border"></div>

                      {agentSearchPapers.length > 0 ? (
                        <>
                          <button
                            type="button"
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                              showAgentSearchPapers
                                ? 'bg-red-50 text-academic-accent'
                                : 'text-academic-text hover:bg-academic-hover'
                            }`}
                            onClick={() => {
                              onShowAgentSearchPapers()
                              setShowSearch(false)
                              setIsPaperMenuOpen(false)
                            }}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-academic-accent shadow-sm ring-1 ring-academic-border">
                              <i className="fa-solid fa-list-ul text-[11px]"></i>
                            </span>
                            <span className="truncate">Agent Search Results</span>
                          </button>
                          <div className="my-1 border-t border-academic-border"></div>
                        </>
                      ) : null}

                      {openPapers.map((paper) => (
                        <div key={paper.paper_id} className="flex items-center gap-2 px-2 py-0.5">
                          <button
                            type="button"
                            className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                              activePaperId === paper.paper_id && !showSearch
                                ? 'bg-red-50 text-academic-accent'
                                : 'text-academic-text hover:bg-academic-hover'
                            }`}
                            onClick={() => {
                              onHideAgentSearchPapers()
                              setShowSearch(false)
                              setActivePaperId(paper.paper_id)
                              setIsPaperMenuOpen(false)
                            }}
                            title={formatPaperDisplayTitle(paper.title)}
                          >
                            <span className="block truncate">{formatPaperDisplayTitle(paper.title)}</span>
                          </button>

                          <button
                            type="button"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-academic-muted transition-colors hover:bg-red-50 hover:text-red-500"
                            title="关闭文献"
                            aria-label="关闭文献"
                            onClick={(event) => {
                              handleClosePaper(paper.paper_id, event)
                              setIsPaperMenuOpen(false)
                            }}
                          >
                            <i className="fa-solid fa-xmark text-xs"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadActivePaper}
            disabled={!activePaper || isDownloadingPaper}
            className="w-8 h-8 flex items-center justify-center rounded bg-white hover:bg-academic-hover text-academic-text border border-academic-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={activePaper?.is_downloaded ? '下载本地 LaTeX 源码' : '下载 LaTeX 源码'}
          >
            <i className="fa-solid fa-download text-sm"></i>
          </button>

          <button
            onClick={handleStartDeepRead}
            disabled={!activePaper}
            className="w-8 h-8 flex items-center justify-center rounded bg-academic-accent text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="深度阅读"
          >
            <i className="fa-solid fa-brain text-sm"></i>
          </button>

          <button
            onClick={() => {
              const event = new CustomEvent('jumpToResult')
              window.dispatchEvent(event)
            }}
            className="w-8 h-8 flex items-center justify-center rounded bg-academic-hover hover:bg-academic-border text-academic-text border border-academic-border transition-colors"
            title="跳转结果"
          >
            <i className="fa-solid fa-arrow-right text-sm"></i>
          </button>

          <button
            onClick={() => {
              const event = new CustomEvent('toggleNotes')
              window.dispatchEvent(event)
            }}
            className="w-8 h-8 flex items-center justify-center rounded bg-white hover:bg-academic-hover text-academic-text border border-academic-border transition-colors"
            title="阅读笔记"
          >
            <i className="fa-regular fa-pen-to-square text-sm"></i>
          </button>
        </div>
      </div>

      {paperError && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {paperError}
        </div>
      )}

      <div className={`flex-1 min-h-0 flex-col ${isSearchVisible ? 'flex' : 'hidden'}`}>
        <LiteratureSearch
          onOpenPaper={handleOpenPaper}
          onPaperDownloaded={handlePaperDownloaded}
        />
      </div>

      <div className={`flex-1 min-h-0 flex-col ${showAgentSearchPapers ? 'flex' : 'hidden'}`}>
        <AgentSearchResultsPanel
          papers={agentSearchPapers}
          onOpenPaper={handleOpenPaperById}
          onBackToSearch={() => {
            onHideAgentSearchPapers()
            setShowSearch(true)
          }}
        />
      </div>

      <div className={`relative flex-1 overflow-hidden ${isSearchVisible || showAgentSearchPapers ? 'hidden' : 'block'}`}>
        <LaTeXViewer
          paper={activePaper}
          annotations={activeAnnotations}
          onCreateAnnotation={handleCreateAnnotation}
          onOpenReference={handleOpenReferencePreview}
        />
        <AnnotationPanel
          annotations={activeAnnotations}
          onUpdateAnnotationNote={handleUpdateAnnotationNote}
        />
      </div>

      {isReferencePreviewOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/28 backdrop-blur-[1px]"
          onClick={handleCloseReferencePreview}
        >
          <div
            className="flex h-[84%] w-[80%] min-w-0 flex-col overflow-hidden rounded-2xl border border-academic-border bg-academic-panel shadow-[0_20px_60px_rgba(15,23,42,0.24)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-academic-border px-4 py-3 shrink-0">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-academic-muted">
                  {referencePreview.kind === 'external' ? 'External Link Preview' : 'arXiv Reference Preview'}
                </p>
                <p className="truncate text-sm text-academic-text">
                  {referencePreview.kind === 'paper-ready'
                    ? referencePreview.paper.title
                    : referencePreview.kind === 'paper-loading'
                      ? referencePreview.paperId
                      : referencePreview.kind === 'paper-error'
                        ? referencePreview.paperId
                        : referencePreview.kind === 'external'
                          ? referencePreview.label
                          : 'Loading reference...'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {getPreviewReference() ? (
                  <ReferenceButton
                    reference={getPreviewReference()!}
                    className="h-8 w-8"
                  />
                ) : null}
                {referencePreview.kind === 'paper-ready' ? (
                  <button
                    type="button"
                    onClick={handleOpenPreviewPaperInReader}
                    className="rounded-md border border-academic-border bg-white px-3 py-1.5 text-xs text-academic-text transition-colors hover:bg-academic-hover"
                  >
                    在阅读器中打开
                  </button>
                ) : null}
                {referencePreview.kind === 'external' ? (
                  <a
                    href={referencePreview.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-academic-border bg-white px-3 py-1.5 text-xs text-academic-text transition-colors hover:bg-academic-hover"
                  >
                    新标签打开
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={handleCloseReferencePreview}
                  className="flex h-8 w-8 items-center justify-center rounded bg-academic-hover text-academic-text transition-colors hover:bg-academic-border"
                  title="关闭预览"
                  aria-label="关闭预览"
                >
                  <i className="fa-solid fa-xmark text-sm"></i>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-academic-bg p-3">
              {referencePreview.kind === 'paper-error' ? (
                <div className="flex h-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 text-center text-sm text-red-600">
                  {referencePreview.message}
                </div>
              ) : referencePreview.kind === 'paper-ready' ? (
                <div className="flex h-full min-h-0 overflow-hidden rounded-xl">
                  <LaTeXViewer
                    paper={referencePreview.paper}
                    annotations={referencePreviewAnnotations}
                    onCreateAnnotation={handleCreateAnnotation}
                    onOpenReference={handleOpenReferencePreview}
                  />
                </div>
              ) : referencePreview.kind === 'external' ? (
                <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-academic-border bg-white">
                  <iframe
                    src={literatureApi.buildExternalPreviewUrl(referencePreview.href)}
                    title={referencePreview.label}
                    className="h-full w-full border-0 bg-white"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-academic-border bg-white text-academic-muted">
                  <div className="text-center">
                    <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                    <p className="mt-3 text-sm">Loading arXiv reference preview...</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function AgentSearchResultsPanel({
  papers,
  onOpenPaper,
  onBackToSearch,
}: {
  papers: AgentSearchPaper[]
  onOpenPaper: (paperId: string) => Promise<LiteratureDetail | null>
  onBackToSearch: () => void
}) {
  const [openingPaperId, setOpeningPaperId] = useState<string | null>(null)

  const handleOpen = async (paperId: string) => {
    setOpeningPaperId(paperId)
    try {
      await onOpenPaper(paperId)
    } finally {
      setOpeningPaperId((current) => current === paperId ? null : current)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white shadow-soft border-2 border-academic-border">
      <div className="h-8 shrink-0 border-b border-academic-border bg-academic-hover flex items-center justify-between px-3">
        <h3 className="font-serif text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-list-ul text-academic-accent text-xs"></i>
          Agent Search Results
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-academic-muted">{papers.length} papers</span>
          <button
            type="button"
            className="rounded border border-academic-border bg-white px-2 py-0.5 text-[10px] text-academic-text transition-colors hover:bg-academic-hover"
            onClick={onBackToSearch}
          >
            Search
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {papers.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-academic-muted">
            No agent search results yet.
          </div>
        ) : (
          <div className="space-y-2">
            {papers.map((paper) => (
              <article
                key={paper.paper_id}
                className="rounded border border-academic-border bg-academic-bg/40 p-3"
              >
                {(() => {
                  const reference = agentSearchPaperToReference(paper)
                  return (
                    <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold leading-snug text-academic-text">
                      {formatPaperDisplayTitle(paper.title)}
                    </h4>
                    <p className="mt-1 text-[11px] text-academic-muted">
                      {paper.paper_id}
                      {paper.year ? ` · ${paper.year}` : ''}
                      {paper.authors.length > 0 ? ` · ${paper.authors.slice(0, 3).join(', ')}` : ''}
                    </p>
                  </div>
                  {paper.status ? (
                    <span className="shrink-0 rounded bg-white px-2 py-0.5 text-[10px] text-academic-muted ring-1 ring-academic-border">
                      {paper.status}
                    </span>
                  ) : null}
                </div>

                {paper.abstract ? (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-academic-text/80">
                    {paper.abstract}
                  </p>
                ) : null}

                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-academic-border bg-white px-2.5 py-1 text-[10px] text-academic-text transition-colors hover:bg-academic-hover disabled:opacity-50"
                    onClick={() => void handleOpen(paper.paper_id)}
                    disabled={openingPaperId === paper.paper_id}
                  >
                    {openingPaperId === paper.paper_id ? 'Opening...' : 'Open'}
                  </button>
                  <ReferenceButton reference={reference} className="h-7 w-7" />
                </div>
                    </>
                  )
                })()}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LiteratureSearch({
  onOpenPaper,
  onPaperDownloaded,
}: {
  onOpenPaper: (paper: LiteratureItem) => Promise<LiteratureDetail | null>
  onPaperDownloaded: (paperId: string, localSourceUrl: string) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LiteratureItem[]>([])
  const [recentPapers, setRecentPapers] = useState<RecentPaper[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingRecent, setIsLoadingRecent] = useState(false)
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSource, setSelectedSource] = useState('')
  const [searchOnline, setSearchOnline] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchNotice, setSearchNotice] = useState<string | null>(null)
  const [searchPage, setSearchPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchTotalPages, setSearchTotalPages] = useState(0)
  const [hasPrevPage, setHasPrevPage] = useState(false)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [isRecentCollapsed, setIsRecentCollapsed] = useState(true)
  const [openingPaperId, setOpeningPaperId] = useState<string | null>(null)

  const loadRecent = async () => {
    setIsLoadingRecent(true)
    try {
      const { papers } = await literatureApi.getRecent()
      setRecentPapers(papers)
    } catch (error) {
      console.error('Failed to load recent papers:', error)
    } finally {
      setIsLoadingRecent(false)
    }
  }

  useEffect(() => {
    void loadRecent()
  }, [])

  const runSearch = async (page: number) => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    setSearchError(null)
    setSearchNotice(null)
    try {
      const response = await literatureApi.search({
        query: searchQuery,
        year: selectedYear || undefined,
        source: selectedSource || undefined,
        limit: pageSize,
        online: searchOnline,
        page,
        page_size: pageSize,
      })
      setSearchResults(response.results)
      setSearchPage(response.page)
      setSearchTotal(response.total)
      setSearchTotalPages(response.total_pages)
      setHasPrevPage(response.has_prev)
      setHasNextPage(response.has_next)
      setSearchNotice(response.notice ?? null)
    } catch (error) {
      console.error('Search failed:', error)
      setSearchResults([])
      setSearchTotal(0)
      setSearchTotalPages(0)
      setHasPrevPage(false)
      setHasNextPage(false)
      setSearchNotice(null)
      setSearchError(error instanceof Error ? error.message : 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }

  const handleSearch = async () => {
    await runSearch(1)
  }

  const markPaperDownloaded = (paperId: string, localSourceUrl: string) => {
    setSearchResults((previous) =>
      previous.map((paper) =>
        paper.paper_id === paperId
          ? {
              ...paper,
              is_downloaded: true,
              local_source_url: localSourceUrl,
            }
          : paper
      )
    )
    setRecentPapers((previous) =>
      previous.map((paper) =>
        paper.paper_id === paperId
          ? {
              ...paper,
              is_downloaded: true,
              local_source_url: localSourceUrl,
            }
          : paper
      )
    )
    onPaperDownloaded(paperId, localSourceUrl)
  }

  const handleDownload = async (paper: LiteratureItem) => {
    try {
      if (paper.is_downloaded && paper.local_source_url) {
        openDownloadLink(paper.local_source_url)
        return
      }

      const response = await literatureApi.download(paper.paper_id, paper.source)
      markPaperDownloaded(paper.paper_id, response.local_source_url)
      void loadRecent()
      openDownloadLink(response.local_source_url)
    } catch (error) {
      console.error('Download failed:', error)
      setSearchError(error instanceof Error ? error.message : 'Download failed')
    }
  }

  const handleOpenPaperClick = async (paper: LiteratureItem) => {
    setOpeningPaperId(paper.paper_id)
    setSearchError(null)

    try {
      const detail = await onOpenPaper(paper)
      if (detail?.is_downloaded && detail.local_source_url) {
        markPaperDownloaded(detail.paper_id, detail.local_source_url)
        void loadRecent()
      }
    } finally {
      setOpeningPaperId((current) => (current === paper.paper_id ? null : current))
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-2 overflow-hidden">
      <div className={`${isRecentCollapsed ? 'flex-1 min-h-0' : 'h-1/2 min-h-0'} bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden transition-all duration-200`}>
        <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
          <h3 className="font-serif text-xs font-bold flex items-center gap-2">
            <i className="fa-solid fa-magnifying-glass text-academic-accent text-xs"></i>
            Literature Search
          </h3>
        </div>

        <div className="flex-1 min-h-0 p-4 overflow-y-auto flex flex-col">
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search by title, author, keywords..."
                className="w-full bg-academic-bg border border-academic-border rounded-md py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-academic-accent transition-colors"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') {
                    void handleSearch()
                  }
                }}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded bg-academic-accent text-white flex items-center justify-center hover:bg-red-700 transition-colors disabled:opacity-50"
                onClick={handleSearch}
                disabled={isSearching}
              >
                <i className="fa-solid fa-magnifying-glass text-xs"></i>
              </button>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            <select
              className="px-3 py-1 text-xs border border-academic-border rounded bg-white text-academic-text focus:outline-none focus:border-academic-accent"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.currentTarget.value)}
            >
              <option value="">All Years</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
              <option value="2022">2022</option>
              <option value="2021">2021</option>
            </select>
            <select
              className="px-3 py-1 text-xs border border-academic-border rounded bg-white text-academic-text focus:outline-none focus:border-academic-accent"
              value={selectedSource}
              onChange={(event) => setSelectedSource(event.currentTarget.value)}
            >
              <option value="">All Sources</option>
              <option value="arXiv">arXiv</option>
            </select>
            <select
              className="px-3 py-1 text-xs border border-academic-border rounded bg-white text-academic-text focus:outline-none focus:border-academic-accent"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.currentTarget.value))}
            >
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
            </select>
            <button
              type="button"
              role="switch"
              aria-checked={searchOnline}
              onClick={() => setSearchOnline((previous) => !previous)}
              className={`ml-auto inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs transition-colors duration-200 ${
                searchOnline
                  ? 'border-red-200 bg-red-50 text-academic-accent'
                  : 'border-academic-border bg-white text-academic-muted'
              }`}
            >
              <span className="font-medium">联网搜索</span>
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                  searchOnline ? 'bg-academic-accent' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out ${
                    searchOnline ? 'translate-x-4' : 'translate-x-0'
                  }`}
                ></span>
              </span>
            </button>
          </div>

          <div className="mb-4 text-xs text-academic-muted">
            {searchOnline
              ? '已开启联网搜索：将查询 arXiv，并标记论文源码是否已缓存到本地。'
              : '当前仅搜索本地文献库。开启联网搜索后会查询 arXiv。'}
          </div>

          {searchError && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {searchError}
            </div>
          )}

          {searchNotice && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {searchNotice}
            </div>
          )}

          {isSearching ? (
            <div className="text-center text-academic-muted py-8">
              <i className="fa-solid fa-spinner fa-spin text-3xl mb-3"></i>
              <p className="text-sm">Searching...</p>
            </div>
          ) : searchResults.length > 0 ? (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-academic-muted">
                <span>
                  {searchTotal > 0
                    ? `Showing ${(searchPage - 1) * pageSize + 1}-${Math.min(searchPage * pageSize, searchTotal)} of ${searchTotal}`
                    : 'No results'}
                </span>
                <span>Page {searchPage} / {Math.max(searchTotalPages, 1)}</span>
              </div>

              <AutoHideScrollArea
                className="flex-1 min-h-0"
                viewportClassName="space-y-3 pr-4"
              >
                {searchResults.map((paper) => (
                  <div
                    key={paper.paper_id}
                    className="p-3 border border-academic-border rounded-lg hover:bg-academic-hover transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4
                        className={`text-sm font-medium flex-1 cursor-pointer hover:text-academic-accent ${
                          openingPaperId === paper.paper_id
                            ? 'text-academic-accent'
                            : 'text-academic-text'
                        }`}
                        onClick={() => void handleOpenPaperClick(paper)}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span>{paper.title}</span>
                          {openingPaperId === paper.paper_id && (
                            <i className="fa-solid fa-spinner fa-spin text-[11px] text-academic-accent"></i>
                          )}
                        </span>
                      </h4>
                      <ReferenceButton
                        reference={literaturePaperToReference(paper)}
                        className="ml-2 shrink-0"
                      />
                    </div>
                    <p className="text-xs text-academic-muted mb-2">
                      {paper.authors.slice(0, 3).join(', ')}
                      {paper.authors.length > 3 && ' et al.'} • {paper.year}
                    </p>
                    {paper.abstract && (
                      <p className="text-xs text-academic-text/70 mb-2 line-clamp-2">
                        {paper.abstract}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex gap-1 flex-wrap">
                        {paper.tags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-academic-hover text-xs rounded">
                            {tag}
                          </span>
                        ))}
                        <span
                          className={`px-2 py-0.5 text-xs rounded ${
                            paper.is_downloaded
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {paper.is_downloaded ? '已缓存源码' : '未缓存源码'}
                        </span>
                      </div>
                      {paper.source_url && (
                        <button
                          onClick={() => handleDownload(paper)}
                          className="text-xs text-academic-accent hover:text-red-700 flex items-center gap-1 shrink-0"
                        >
                          <i className="fa-solid fa-download"></i>
                          {paper.is_downloaded ? 'Get Local LaTeX' : 'Download LaTeX'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </AutoHideScrollArea>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => void runSearch(searchPage - 1)}
                  disabled={!hasPrevPage || isSearching}
                  className="rounded border border-academic-border bg-white px-3 py-1.5 text-xs text-academic-text transition-colors hover:bg-academic-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  onClick={() => void runSearch(searchPage + 1)}
                  disabled={!hasNextPage || isSearching}
                  className="rounded border border-academic-border bg-white px-3 py-1.5 text-xs text-academic-text transition-colors hover:bg-academic-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </>
          ) : searchQuery ? (
            <div className="text-center text-academic-muted py-8">
              <i className="fa-solid fa-search text-3xl mb-3 opacity-30"></i>
              <p className="text-sm">
                {searchOnline ? 'No results found online' : 'No local results found'}
              </p>
              {!searchOnline && (
                <p className="text-xs mt-2">打开“联网搜索”后可以直接查询 arXiv。</p>
              )}
            </div>
          ) : (
            <div className="text-center text-academic-muted py-8">
              <i className="fa-solid fa-magnifying-glass text-3xl mb-3 opacity-30"></i>
              <p className="text-sm">
                {searchOnline ? 'Enter keywords to search online' : 'Enter keywords to search local literature'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className={`${isRecentCollapsed ? 'shrink-0' : 'h-1/2 min-h-0'} bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden transition-all duration-200`}>
        <div className={`h-8 ${isRecentCollapsed ? '' : 'border-b'} border-academic-border bg-academic-hover flex items-center justify-between px-3`}>
          <h3 className="font-serif text-xs font-bold flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left text-academic-accent text-xs"></i>
            Recent Papers
          </h3>
          <button
            type="button"
            onClick={() => setIsRecentCollapsed((previous) => !previous)}
            className="flex items-center gap-2 text-[11px] text-academic-muted hover:text-academic-text transition-colors"
            aria-expanded={!isRecentCollapsed}
            aria-label={isRecentCollapsed ? '展开 Recent Papers' : '折叠 Recent Papers'}
          >
            <span>{recentPapers.length}</span>
            <i className={`fa-solid fa-chevron-${isRecentCollapsed ? 'up' : 'down'} text-[10px]`}></i>
          </button>
        </div>

        {!isRecentCollapsed && (
          <AutoHideScrollArea
            className="flex-1 min-h-0"
            viewportClassName="p-4 pr-4"
          >
            {isLoadingRecent ? (
              <div className="text-center text-academic-muted py-8">
                <i className="fa-solid fa-spinner fa-spin text-2xl mb-3"></i>
                <p className="text-sm">Loading recent papers...</p>
              </div>
            ) : recentPapers.length > 0 ? (
              recentPapers.map((paper) => (
                <div
                  key={paper.paper_id}
                  className="mb-3 p-3 border border-academic-border rounded-lg hover:bg-academic-hover transition-colors cursor-pointer"
                  onClick={() => void handleOpenPaperClick(paper)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-academic-text mb-1 inline-flex items-center gap-2">
                        <span>{paper.title}</span>
                        {openingPaperId === paper.paper_id && (
                          <i className="fa-solid fa-spinner fa-spin text-[11px] text-academic-accent"></i>
                        )}
                      </h4>
                      <p className="text-xs text-academic-muted mb-2">
                        {paper.authors.slice(0, 2).join(', ')}
                        {paper.authors.length > 2 && ' et al.'} • {paper.year}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ReferenceButton
                        reference={literaturePaperToReference(paper)}
                        onClick={(event) => event.stopPropagation()}
                      />
                      {paper.is_downloaded && paper.local_source_url && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            openDownloadLink(paper.local_source_url!)
                          }}
                          className="text-xs text-academic-accent hover:text-red-700"
                        >
                          LaTeX
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {paper.tags.map((tag, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-academic-hover text-xs rounded">
                        {tag}
                      </span>
                    ))}
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        paper.is_downloaded
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {paper.is_downloaded ? '已缓存源码' : '未缓存源码'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-academic-muted py-8">
                <i className="fa-regular fa-clock text-3xl mb-3 opacity-30"></i>
                <p className="text-sm">No recent papers yet</p>
              </div>
            )}
          </AutoHideScrollArea>
        )}
      </div>
    </div>
  )
}

function LaTeXViewer({
  paper,
  annotations,
  onCreateAnnotation,
  onOpenReference,
}: {
  paper: LiteratureDetail | null
  annotations: ReaderAnnotation[]
  onCreateAnnotation: (annotation: ReaderAnnotation) => void
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  if (!paper) {
    return (
      <article className="flex-[2] bg-white shadow-soft border-2 border-academic-border overflow-y-auto p-8 pt-5 flex items-center justify-center">
        <div className="text-center text-academic-muted">
          <i className="fa-regular fa-file-lines text-4xl mb-3 opacity-30"></i>
          <p className="text-sm">Select a paper to view its details.</p>
        </div>
      </article>
    )
  }

  const contentMaxWidthPx = paper.pdf_view_url ? 1380 : 768
  const contentWidthClass = paper.pdf_view_url ? 'max-w-[1380px]' : 'max-w-3xl'
  const viewerScrollControlRight = `clamp(12px, calc((100% - ${contentMaxWidthPx}px) / 2 - 16px), 72px)`
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const scrollTrackRef = useRef<HTMLDivElement | null>(null)
  const scrollControlHideTimeoutRef = useRef<number | null>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [canScroll, setCanScroll] = useState(false)
  const [isDraggingScroll, setIsDraggingScroll] = useState(false)
  const [isScrollControlVisible, setIsScrollControlVisible] = useState(false)
  const [isScrollControlHovered, setIsScrollControlHovered] = useState(false)
  const [lastScrollActivityAt, setLastScrollActivityAt] = useState(0)
  const [selectionZoomEnabled, setSelectionZoomEnabled] = useState(false)

  const pingScrollControl = () => {
    setIsScrollControlVisible(true)
    setLastScrollActivityAt(Date.now())
  }

  useEffect(() => {
    const node = scrollContainerRef.current
    if (!node) {
      return
    }

    const updateScrollState = () => {
      const maxScrollTop = Math.max(node.scrollHeight - node.clientHeight, 0)
      setCanScroll(maxScrollTop > 0)
      setScrollProgress(maxScrollTop > 0 ? (node.scrollTop / maxScrollTop) * 100 : 0)
      if (maxScrollTop > 0) {
        pingScrollControl()
      } else {
        setIsScrollControlVisible(false)
      }
    }

    updateScrollState()
    const resizeObserver = new ResizeObserver(() => updateScrollState())
    resizeObserver.observe(node)
    node.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)

    return () => {
      resizeObserver.disconnect()
      node.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [paper.paper_id, paper.pdf_view_url, paper.original_sections.length])

  useEffect(() => {
    if (scrollControlHideTimeoutRef.current !== null) {
      window.clearTimeout(scrollControlHideTimeoutRef.current)
      scrollControlHideTimeoutRef.current = null
    }

    if (!canScroll) {
      setIsScrollControlVisible(false)
      return
    }

    if (isDraggingScroll || isScrollControlHovered) {
      setIsScrollControlVisible(true)
      return
    }

    if (lastScrollActivityAt === 0) {
      return
    }

    scrollControlHideTimeoutRef.current = window.setTimeout(() => {
      setIsScrollControlVisible(false)
    }, 1200)

    return () => {
      if (scrollControlHideTimeoutRef.current !== null) {
        window.clearTimeout(scrollControlHideTimeoutRef.current)
        scrollControlHideTimeoutRef.current = null
      }
    }
  }, [canScroll, isDraggingScroll, isScrollControlHovered, lastScrollActivityAt])

  const scrollToTop = () => {
    const node = scrollContainerRef.current
    if (!node) {
      return
    }

    pingScrollControl()
    node.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const scrollToBottom = () => {
    const node = scrollContainerRef.current
    if (!node) {
      return
    }

    pingScrollControl()
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }

  const handleScrollSliderChange = (value: number) => {
    const node = scrollContainerRef.current
    if (!node) {
      return
    }

    pingScrollControl()
    const maxScrollTop = Math.max(node.scrollHeight - node.clientHeight, 0)
    node.scrollTo({
      top: (value / 100) * maxScrollTop,
      behavior: 'auto',
    })
  }

  const updateScrollFromPointer = (clientY: number) => {
    const track = scrollTrackRef.current
    if (!track) {
      return
    }

    const rect = track.getBoundingClientRect()
    const relative = ((clientY - rect.top) / rect.height) * 100
    handleScrollSliderChange(Math.min(Math.max(relative, 0), 100))
  }

  useEffect(() => {
    if (!isDraggingScroll) {
      return
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      updateScrollFromPointer(event.clientY)
    }

    const handleMouseUp = () => {
      setIsDraggingScroll(false)
      setLastScrollActivityAt(Date.now())
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingScroll])

  useEffect(() => {
    setSelectionZoomEnabled(false)
  }, [paper.paper_id, paper.pdf_view_url])

  return (
    <div className="relative h-full min-w-0">
      {canScroll ? (
        <div
          className="pointer-events-none absolute top-1/2 z-20 -translate-y-1/2"
          style={{ right: viewerScrollControlRight }}
        >
          <div
            className={`flex flex-col items-center gap-2 rounded-full border border-academic-border bg-white/95 px-2 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-opacity duration-200 ${
              isScrollControlVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onMouseEnter={() => {
              setIsScrollControlHovered(true)
              setIsScrollControlVisible(true)
            }}
            onMouseLeave={() => {
              setIsScrollControlHovered(false)
              setLastScrollActivityAt(Date.now())
            }}
          >
            {paper.pdf_view_url ? (
              <button
                type="button"
                onClick={() => {
                  pingScrollControl()
                  setSelectionZoomEnabled((current) => !current)
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                  selectionZoomEnabled
                    ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                    : 'border-academic-border bg-white text-academic-text hover:bg-academic-hover'
                }`}
                title={selectionZoomEnabled ? '取消框选放大' : '框选放大'}
                aria-label={selectionZoomEnabled ? '取消框选放大' : '框选放大'}
                aria-pressed={selectionZoomEnabled}
              >
                <i className="fa-solid fa-magnifying-glass-plus text-[11px]"></i>
              </button>
            ) : null}

            <button
              type="button"
              onClick={scrollToTop}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-academic-border bg-white text-academic-text transition-colors hover:bg-academic-hover"
              title="回到顶部"
            >
              <i className="fa-solid fa-arrow-up text-[11px]"></i>
            </button>

            <div
              ref={scrollTrackRef}
              className="viewer-scroll-track"
              onMouseDown={(event) => {
                event.preventDefault()
                setIsDraggingScroll(true)
                setIsScrollControlVisible(true)
                updateScrollFromPointer(event.clientY)
              }}
              role="slider"
              aria-label="Scroll preview"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(scrollProgress)}
              tabIndex={0}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  handleScrollSliderChange(scrollProgress - 5)
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  handleScrollSliderChange(scrollProgress + 5)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  scrollToTop()
                } else if (event.key === 'End') {
                  event.preventDefault()
                  scrollToBottom()
                }
              }}
            >
              <div className="viewer-scroll-track__rail"></div>
              <div
                className="viewer-scroll-track__thumb"
                style={{ top: `${scrollProgress}%` }}
              ></div>
            </div>

            <button
              type="button"
              onClick={scrollToBottom}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-academic-border bg-white text-academic-text transition-colors hover:bg-academic-hover"
              title="回到底部"
            >
              <i className="fa-solid fa-arrow-down text-[11px]"></i>
            </button>
          </div>
        </div>
      ) : null}

      <article
        ref={scrollContainerRef}
        className="relative h-full overflow-y-auto bg-white p-6 pt-4 shadow-soft border-2 border-academic-border"
      >
        <div className={`${contentWidthClass} mx-auto`}>
          <header className="mb-6 border-b border-academic-border pb-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.22em] text-academic-muted">
                  <span>{paper.source} {paper.year ? `• ${paper.year}` : ''}</span>
                  <span className="font-mono text-[10px] normal-case tracking-normal text-academic-text/70">{paper.paper_id}</span>
                </div>

                <h1 className="mt-2 font-serif text-[2rem] font-bold leading-tight text-academic-text lg:text-[2.2rem]">
                  {paper.title}
                </h1>

                <div className="mt-3 text-sm leading-6 text-academic-text/80">
                  {paper.authors.length > 0 ? paper.authors.join(', ') : 'Unknown authors'}
                </div>

                {paper.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {paper.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[11px] text-academic-accent">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                <ReferenceButton reference={literaturePaperToReference(paper)} className="h-8 w-8" />
                {paper.url && (
                  <>
                    <ReferenceButton
                      reference={{
                        kind: 'link',
                        label: `${paper.title} Source`,
                        href: paper.url,
                      }}
                      className="h-8 w-8"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onOpenReference?.({
                          label: paper.title,
                          href: paper.url!,
                          isArxiv: false,
                        })
                      }
                      className="flex h-8 w-8 items-center justify-center rounded bg-academic-hover border border-academic-border text-academic-text hover:bg-academic-border transition-colors"
                      title="Open Source Page"
                      aria-label="Open Source Page"
                    >
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </button>
                  </>
                )}
              </div>
            </div>
          </header>

          {paper.content_error && (
            <section className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
              {paper.content_error}
            </section>
          )}

          {paper.pdf_view_url ? (
            <>
              {/* Example replacement:
                  old: render parsed sections directly
                  new: PdfPaperViewer renders pages from a locally typeset preview with lazy mounting,
                  keeping figures/tables and pagination close to the compiled paper layout. */}
              <PdfPaperViewer
                paperId={paper.paper_id}
                pdfUrl={paper.pdf_view_url}
                paperTitle={paper.title}
                annotations={annotations}
                onCreateAnnotation={onCreateAnnotation}
                onOpenReference={onOpenReference}
                selectionZoomEnabled={selectionZoomEnabled}
                onSelectionZoomChange={setSelectionZoomEnabled}
                fallback={
                  paper.original_sections.length > 0 ? (
                    <PreactDocumentRenderer
                      paper={paper}
                      enablePerfLog={false}
                      onOpenReference={onOpenReference}
                    />
                  ) : (
                    <section className="text-center text-academic-muted py-12">
                      <i className="fa-regular fa-file-lines text-4xl mb-3 opacity-30"></i>
                      <p className="text-sm">No readable LaTeX content is available for this paper yet.</p>
                    </section>
                  )
                }
              />
            </>
          ) : paper.original_sections.length > 0 ? (
            <PreactDocumentRenderer
              paper={paper}
              enablePerfLog={false}
              onOpenReference={onOpenReference}
            />
          ) : (
            <section className="text-center text-academic-muted py-12">
              <i className="fa-regular fa-file-lines text-4xl mb-3 opacity-30"></i>
              <p className="text-sm">No readable LaTeX content is available for this paper yet.</p>
            </section>
          )}
        </div>
      </article>
    </div>
  )
}

function AnnotationPanel({
  annotations,
  onUpdateAnnotationNote,
}: {
  annotations: ReaderAnnotation[]
  onUpdateAnnotationNote: (annotationId: string, note: string) => void
}) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [activeTab, setActiveTab] = useState<'deepRead' | 'jumpResult' | 'notes'>('notes')

  const handleNotesClick = () => {
    if (isCollapsed) {
      setIsCollapsed(false)
      setActiveTab('notes')
    } else if (activeTab === 'notes') {
      setIsCollapsed(true)
    } else {
      setActiveTab('notes')
    }
  }

  // Listen for toggle notes event
  useEffect(() => {
    const handleToggleNotes = () => {
      handleNotesClick()
    }

    const handleOpenNotes = () => {
      setIsCollapsed(false)
      setActiveTab('notes')
    }

    window.addEventListener('toggleNotes', handleToggleNotes)
    window.addEventListener('openNotes', handleOpenNotes)

    return () => {
      window.removeEventListener('toggleNotes', handleToggleNotes)
      window.removeEventListener('openNotes', handleOpenNotes)
    }
  }, [isCollapsed, activeTab])

  return (
    <div
      className={`absolute inset-y-0 right-0 z-20 flex w-80 justify-end transition-opacity duration-200 ${
        isCollapsed ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
      }`}
    >
      <aside
        className={`pointer-events-auto h-full w-80 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.12)] border-l-2 border-academic-border flex flex-col overflow-hidden transition-transform duration-300 ease-out ${
          isCollapsed ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{ contain: 'layout paint style', willChange: 'transform' }}
      >
        {!isCollapsed && (
          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2">
            {activeTab === 'notes' && (
              <>
                {annotations.length > 0 ? (
                  annotations.map((annotation) => (
                    <div key={annotation.id} className="bg-academic-hover rounded-lg p-3 border border-transparent hover:border-academic-border transition-colors">
                      <div className="text-xs text-academic-muted mb-2 flex justify-between items-center">
                        <span>Page {annotation.pageNumber}</span>
                        <span>{new Date(annotation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <blockquote className="text-xs font-serif italic border-l-2 border-academic-accent pl-2 text-academic-text/80 mb-3">
                        "{annotation.quote}"
                      </blockquote>
                      <textarea
                        className="w-full bg-white border border-academic-border rounded-md p-2 text-sm resize-none focus:outline-none focus:border-academic-accent transition-colors"
                        rows={3}
                        placeholder="Add your thoughts here..."
                        value={annotation.note}
                        onChange={(event) => onUpdateAnnotationNote(annotation.id, event.currentTarget.value)}
                      />
                    </div>
                  ))
                ) : null}

                <div className="border-2 border-dashed border-academic-border rounded-lg p-6 text-center text-academic-muted hover:bg-academic-hover hover:border-academic-muted transition-all">
                  <i className="fa-solid fa-highlighter mb-2"></i>
                  <p className="text-xs">
                    {annotations.length > 0
                      ? 'Select more text in the viewer and click 标记 to add another note anchor.'
                      : 'Select text in the viewer and click 标记 to create your first annotation.'}
                  </p>
                </div>
              </>
            )}

            {activeTab === 'deepRead' && (
              <div className="text-center text-academic-muted py-8">
                <i className="fa-solid fa-brain text-3xl mb-3 opacity-30"></i>
                <p className="text-sm">深度阅读功能开发中...</p>
              </div>
            )}

            {activeTab === 'jumpResult' && (
              <div className="text-center text-academic-muted py-8">
                <i className="fa-solid fa-arrow-right text-3xl mb-3 opacity-30"></i>
                <p className="text-sm">跳转结果功能开发中...</p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
