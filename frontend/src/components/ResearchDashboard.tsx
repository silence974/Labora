import { useEffect, useRef, useState } from 'preact/hooks'
import type { KeyboardEvent, MouseEvent } from 'preact/compat'
import { deepReadApi } from '../api/deepRead'
import type { DeepReadResult } from '../api/deepRead'
import { literatureApi } from '../api/literature'
import type { LiteratureDetail, LiteratureItem, RecentPaper } from '../api/literature'
import { PreactDocumentRenderer } from './PreactDocumentRenderer'
import { PdfPaperViewer } from './PdfPaperViewer'
import type { ReaderAnnotation } from './PdfPaperViewer'
import type { LiteratureReferenceTarget } from '../utils/literatureLinks'

interface StartDeepReadDetail {
  paperTitle?: string
  paperUrl?: string
  paperContent?: string
}

function openDownloadLink(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
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

export function ResearchDashboard() {
  const [showDocDetails, setShowDocDetails] = useState(false)
  const [activeLeftDoc, setActiveLeftDoc] = useState<'methodology' | 'litReview' | 'dataAnalysis'>('methodology')

  return (
    <div className="w-full h-screen bg-academic-bg flex flex-col overflow-hidden relative">

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
      <main className="flex-1 flex overflow-hidden">

        <div className="flex-1 min-w-0 flex overflow-hidden">
          {/* Leftmost Sidebar */}
          <aside className="w-12 bg-academic-panel border-r border-academic-border flex flex-col items-center py-4 shrink-0 z-20 shadow-sm transition-all hover:w-40 group">
            <div className="mb-6 w-full px-2">
              <button className="w-full h-10 rounded-lg flex items-center pl-3 text-academic-muted hover:bg-academic-hover hover:text-academic-accent transition-colors relative group/btn">
                <i className="fa-solid fa-file-circle-plus"></i>
                <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none">New Doc</span>
              </button>
            </div>

            <div className="flex-1 w-full flex flex-col gap-2 px-2 overflow-y-auto">
              <div
                className={`w-full h-10 rounded-lg flex items-center pl-3 cursor-pointer relative group/item transition-colors ${
                  activeLeftDoc === 'methodology'
                    ? 'bg-academic-hover border border-academic-border text-academic-accent'
                    : 'text-academic-muted hover:bg-academic-hover hover:text-academic-text'
                }`}
                onClick={() => setActiveLeftDoc('methodology')}
              >
                <i className="fa-solid fa-file-lines"></i>
                <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">Methodology...</span>
              </div>

              <div
                className={`w-full h-10 rounded-lg flex items-center pl-3 cursor-pointer relative group/item transition-colors ${
                  activeLeftDoc === 'litReview'
                    ? 'bg-academic-hover border border-academic-border text-academic-accent'
                    : 'text-academic-muted hover:bg-academic-hover hover:text-academic-text'
                }`}
                onClick={() => setActiveLeftDoc('litReview')}
              >
                <i className="fa-regular fa-file-pdf"></i>
                <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">Lit Review</span>
              </div>

              <div
                className={`w-full h-10 rounded-lg flex items-center pl-3 cursor-pointer relative group/item transition-colors ${
                  activeLeftDoc === 'dataAnalysis'
                    ? 'bg-academic-hover border border-academic-border text-academic-accent'
                    : 'text-academic-muted hover:bg-academic-hover hover:text-academic-text'
                }`}
                onClick={() => setActiveLeftDoc('dataAnalysis')}
              >
                <i className="fa-regular fa-file-word"></i>
                <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">Data Analysis</span>
              </div>
            </div>

            <div className="mt-auto w-full px-2 pt-4 border-t border-academic-border">
              <button className="w-full h-10 rounded-lg flex items-center pl-3 text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors relative group/btn">
                <i className="fa-solid fa-box-archive"></i>
                <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none">Archive</span>
              </button>
            </div>
          </aside>

          {/* Left Workspace */}
          <LeftWorkspace
            showDocDetails={showDocDetails}
            onCloseDetails={() => setShowDocDetails(false)}
            activeLeftDoc={activeLeftDoc}
            setActiveLeftDoc={setActiveLeftDoc}
          />
        </div>

        {/* Right Workspace */}
        <RightWorkspace />

      </main>
    </div>
  )
}

function LeftWorkspace({ showDocDetails, onCloseDetails, activeLeftDoc, setActiveLeftDoc }: {
  showDocDetails: boolean
  onCloseDetails: () => void
  activeLeftDoc: 'methodology' | 'litReview' | 'dataAnalysis'
  setActiveLeftDoc: (doc: 'methodology' | 'litReview' | 'dataAnalysis') => void
}) {
  const [deepReadProgress, setDeepReadProgress] = useState(0)
  const [openReadResults, setOpenReadResults] = useState<string[]>([])
  const [activeReadResult, setActiveReadResult] = useState<string | null>(null)
  const [currentResult, setCurrentResult] = useState<DeepReadResult | null>(null)

  // Listen for deep read events
  useEffect(() => {
    const handleStartDeepRead = async (event: Event) => {
      const detail = (event as CustomEvent<StartDeepReadDetail>).detail
      const paperTitle = detail?.paperTitle || 'Untitled Paper'

      setActiveLeftDoc('litReview')
      setDeepReadProgress(0)

      try {
        // 启动深度阅读任务
        const { task_id } = await deepReadApi.startDeepRead({
          paper_title: paperTitle,
          paper_url: detail?.paperUrl,
          paper_content: detail?.paperContent
        })

        // 添加到打开的标签
        setOpenReadResults(prev => [...prev, task_id])
        setActiveReadResult(task_id)

        // 轮询任务状态
        const result = await deepReadApi.pollUntilComplete(task_id, (progress) => {
          setDeepReadProgress(progress)
        })

        setCurrentResult(result)
      } catch (error) {
        console.error('Deep read failed:', error)
      }
    }

    const handleJumpToResult = () => {
      setActiveLeftDoc('litReview')
    }

    window.addEventListener('startDeepRead', handleStartDeepRead as EventListener)
    window.addEventListener('jumpToResult', handleJumpToResult)

    return () => {
      window.removeEventListener('startDeepRead', handleStartDeepRead as EventListener)
      window.removeEventListener('jumpToResult', handleJumpToResult)
    }
  }, [setActiveLeftDoc])

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-academic-bg border-r border-academic-border h-full overflow-hidden p-2">

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

      {activeLeftDoc === 'methodology' ? (
        <>
          {/* Editor Toolbar */}
          <div className="bg-academic-panel border-b-2 border-academic-border py-1 px-6 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-text hover:bg-academic-hover transition-colors font-serif font-bold text-xs" title="Bold">B</button>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-text hover:bg-academic-hover transition-colors font-serif italic text-xs" title="Italic">I</button>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-text hover:bg-academic-hover transition-colors font-serif underline text-xs" title="Underline">U</button>
              <div className="w-px h-3 bg-academic-border mx-1"></div>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors text-xs" title="Heading 1">H1</button>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors text-xs" title="Heading 2">H2</button>
              <div className="w-px h-3 bg-academic-border mx-1"></div>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors text-xs"><i className="fa-solid fa-list-ul"></i></button>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors text-xs"><i className="fa-solid fa-list-ol"></i></button>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors text-xs"><i className="fa-solid fa-link"></i></button>
              <div className="w-px h-3 bg-academic-border mx-1"></div>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-academic-accent bg-red-50 hover:bg-red-100 transition-colors text-xs" title="Insert Math"><i className="fa-solid fa-square-root-variable"></i></button>
            </div>
            <span className="text-xs text-academic-muted bg-academic-hover px-2 py-1 rounded">LaTeX Ready</span>
          </div>

          {/* Editor Area */}
          <div className="flex-1 overflow-y-auto bg-white p-8">
            <div className="max-w-4xl mx-auto">
              <input
                type="text"
                defaultValue="Methodology: Comparing CNNs and Vision Transformers"
                className="w-full font-serif text-2xl font-bold mb-3 outline-none text-academic-text bg-transparent placeholder-academic-muted border-b border-transparent focus:border-academic-border pb-2 transition-colors"
                placeholder="Report Title..."
              />

              <div className="font-serif text-sm leading-relaxed text-academic-text/90 space-y-2">
                <p>In this section, we analyze the fundamental differences between Convolutional Neural Networks (CNNs) and Vision Transformers (ViTs) in handling computer vision tasks.</p>

                <h3 className="text-lg font-bold mt-6 mb-3">1. Receptive Fields and Inductive Bias</h3>
                <p>CNNs inherently possess a strong inductive bias towards translation invariance and locality, processing images through hierarchical local receptive fields. This makes them highly efficient for capturing local textures and edges early in the network.</p>

                <div className="my-5 p-5 bg-academic-bg border border-academic-border rounded-lg font-mono text-xs text-academic-muted relative group">
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <button className="w-6 h-6 rounded bg-white shadow flex items-center justify-center hover:text-academic-accent"><i className="fa-solid fa-copy"></i></button>
                    <button className="w-6 h-6 rounded bg-white shadow flex items-center justify-center hover:text-academic-accent"><i className="fa-solid fa-play"></i></button>
                  </div>
                  \begin{'{'}equation{'}'}
                  <br />
                  y_i = \sum_{'{'}j \in \mathcal{'{'}N{'}'}(i){'}'} w_j x_{'{'}i+j{'}'} + b
                  <br />
                  \end{'{'}equation{'}'}
                  <div className="mt-2 pt-2 border-t border-academic-border border-dashed font-serif italic text-academic-text text-center">
                    Rendered: <span className="latex-math">y<sub>i</sub> = &sum;<sub>j &isin; N(i)</sub> w<sub>j</sub> x<sub>i+j</sub> + b</span>
                  </div>
                </div>

                <p>Conversely, as noted in recent literature, Vision Transformers rely on the self-attention mechanism, which globally connects all patches of an image from the very first layer. This allows ViTs to capture long-range dependencies immediately, reducing the inductive bias but requiring larger datasets for effective training.</p>
              </div>
            </div>
          </div>

          {/* Bottom Split - LLM Research Area - Only in Methodology */}
          <div className="h-[320px] shrink-0 border-t-2 border-academic-border bg-academic-panel flex overflow-hidden">
            <ResearchProgress />
            <AIChat />
          </div>
        </>
      ) : activeLeftDoc === 'litReview' ? (
        <div className="flex-1 flex gap-2">
          {/* Middle Column: Tabs and List */}
          <div className="w-64 flex flex-col gap-2 shrink-0">
            {/* Top: Open Read Results Tabs */}
            <div className="h-1/2 bg-white border-2 border-academic-border rounded flex flex-col overflow-hidden">
              <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
                <h3 className="font-serif text-xs font-bold flex items-center gap-2">
                  <i className="fa-solid fa-folder-open text-academic-accent text-xs"></i>
                  当前打开
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {openReadResults.map((resultId, index) => (
                  <div
                    key={resultId}
                    className={`flex items-center justify-between px-3 py-2 rounded text-xs font-medium transition-colors cursor-pointer ${
                      activeReadResult === resultId
                        ? 'bg-academic-accent text-white'
                        : 'bg-academic-hover text-academic-text hover:bg-academic-border'
                    }`}
                    onClick={() => setActiveReadResult(resultId)}
                  >
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-file-lines"></i>
                      <span>阅读结果 {index + 1}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenReadResults(prev => prev.filter(id => id !== resultId))
                        if (activeReadResult === resultId && openReadResults.length > 1) {
                          setActiveReadResult(openReadResults[0] === resultId ? openReadResults[1] : openReadResults[0])
                        }
                      }}
                      className="hover:text-red-500"
                    >
                      <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom: All Read Results List with Search */}
            <div className="h-1/2 bg-white border-2 border-academic-border rounded flex flex-col overflow-hidden">
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
                    className="w-full bg-academic-bg border border-academic-border rounded py-1.5 pl-3 pr-8 text-xs focus:outline-none focus:border-academic-accent transition-colors"
                  />
                  <button className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded bg-academic-accent text-white flex items-center justify-center hover:bg-red-700 transition-colors">
                    <i className="fa-solid fa-magnifying-glass text-[10px]"></i>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                <div className="bg-academic-hover border border-academic-border rounded p-2 hover:bg-academic-border transition-colors cursor-pointer">
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="text-xs font-medium text-academic-text">Transformers in Vision</h4>
                    <span className="text-[10px] text-academic-muted">2h</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] rounded">完成</span>
                    <span className="px-1.5 py-0.5 bg-white text-[10px] rounded">12引用</span>
                  </div>
                </div>

                <div className="bg-academic-hover border border-academic-border rounded p-2 hover:bg-academic-border transition-colors cursor-pointer">
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="text-xs font-medium text-academic-text">Attention Is All You Need</h4>
                    <span className="text-[10px] text-academic-muted">1d</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] rounded">完成</span>
                    <span className="px-1.5 py-0.5 bg-white text-[10px] rounded">8引用</span>
                  </div>
                </div>

                <div className="bg-academic-hover border border-academic-border rounded p-2 hover:bg-academic-border transition-colors cursor-pointer">
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="text-xs font-medium text-academic-text">An Image is Worth 16x16 Words</h4>
                    <span className="text-[10px] text-academic-muted">3d</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] rounded">45%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Current Read Result Content */}
          <div className="flex-1 bg-white border-2 border-academic-border rounded overflow-hidden">
            {openReadResults.length > 0 ? (
              <DeepReadResultView progress={deepReadProgress} result={currentResult} />
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

function DeepReadResultView({ progress, result }: { progress: number; result: DeepReadResult | null }) {
  return (
    <div className="flex-1 bg-white overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-serif text-2xl font-bold mb-6 text-academic-text">深度阅读结果</h2>

        {/* Progress Section */}
        <div className="mb-8 p-6 bg-academic-hover border border-academic-border rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif text-lg font-bold text-academic-text">阅读进度</h3>
            <span className="text-sm font-medium text-academic-accent">{progress}%</span>
          </div>
          <div className="w-full bg-white h-3 rounded-full overflow-hidden border border-academic-border">
            <div
              className="bg-academic-accent h-full rounded-full transition-all duration-500 relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
            </div>
          </div>
          {progress < 100 ? (
            <p className="text-xs text-academic-muted mt-3">正在分析文献内容...</p>
          ) : (
            <p className="text-xs text-academic-accent mt-3">✓ 分析完成</p>
          )}
        </div>

        {/* Results Section */}
        {progress >= 100 && result && (
          <div className="space-y-6">
            <div className="p-6 bg-white border border-academic-border rounded-lg">
              <h4 className="font-serif text-base font-bold mb-3 text-academic-text">摘要</h4>
              <p className="text-sm text-academic-text/90">{result.summary}</p>
            </div>

            <div className="p-6 bg-white border border-academic-border rounded-lg">
              <h4 className="font-serif text-base font-bold mb-3 text-academic-text">核心观点</h4>
              <ul className="space-y-2 text-sm text-academic-text/90">
                {result.key_points.map((point, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-academic-accent">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-6 bg-white border border-academic-border rounded-lg">
              <h4 className="font-serif text-base font-bold mb-3 text-academic-text">关键引用</h4>
              {result.key_quotes.map((quote, index) => (
                <div key={index} className="mb-4 last:mb-0">
                  <blockquote className="text-sm font-serif italic border-l-2 border-academic-accent pl-4 text-academic-text/80 mb-1">
                    {quote.text}
                  </blockquote>
                  <p className="text-xs text-academic-muted pl-4">— {quote.section}</p>
                </div>
              ))}
            </div>

            <div className="p-6 bg-white border border-academic-border rounded-lg">
              <h4 className="font-serif text-base font-bold mb-3 text-academic-text">引用统计</h4>
              <p className="text-sm text-academic-text/90">本文共被引用 <span className="font-bold text-academic-accent">{result.citations_count}</span> 次</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResearchProgress() {
  return (
    <div className="w-1/2 border-r-2 border-academic-border flex flex-col">
      <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
        <h3 className="font-serif text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-bars-progress text-academic-accent text-xs"></i>
          Research Progress
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="relative pl-4 space-y-5 before:absolute before:inset-y-0 before:left-[23px] before:w-px before:bg-academic-border">
          {/* Completed */}
          <div className="relative z-10 flex gap-3 opacity-60">
            <div className="w-4 h-4 rounded-full bg-academic-accent text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
              <i className="fa-solid fa-check text-[8px]"></i>
            </div>
            <div>
              <h4 className="font-medium text-xs text-academic-text">Literature Review</h4>
              <p className="text-[10px] text-academic-muted mt-1">Found 12 relevant papers on ViT vs CNN.</p>
            </div>
          </div>

          {/* Active */}
          <div className="relative z-10 flex gap-3">
            <div className="w-4 h-4 rounded-full border-2 border-academic-accent bg-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-academic-accent animate-pulse"></div>
            </div>
            <div className="w-full pr-4">
              <h4 className="font-medium text-xs text-academic-accent flex items-center gap-2">
                Methodology Drafting
                <span className="px-1.5 py-0.5 rounded-sm bg-red-50 text-[9px] border border-red-100">In Progress</span>
              </h4>
              <div className="w-full bg-academic-hover h-1.5 rounded-full mt-2 overflow-hidden border border-academic-border">
                <div className="bg-academic-accent h-full rounded-full w-[60%] relative">
                  <div className="absolute inset-0 bg-white/20 w-full animate-shimmer"></div>
                </div>
              </div>
              <p className="text-[10px] text-academic-muted mt-1.5">Drafting section on Receptive Fields...</p>
            </div>
          </div>

          {/* Pending */}
          <div className="relative z-10 flex gap-3 opacity-50">
            <div className="w-4 h-4 rounded-full border-2 border-academic-border bg-white shrink-0 mt-0.5"></div>
            <div>
              <h4 className="font-medium text-xs">Data Analysis</h4>
              <p className="text-[10px] text-academic-muted mt-1">Awaiting methodology completion.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AIChat() {
  return (
    <div className="w-1/2 flex flex-col bg-white">
      <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center justify-between px-3">
        <h3 className="font-serif text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-robot text-academic-accent text-xs"></i>
          LLM Assistant
        </h3>
        <div className="flex gap-2">
          <button className="text-academic-muted hover:text-academic-text transition-colors"><i className="fa-solid fa-clock-rotate-left text-xs"></i></button>
          <button className="text-academic-muted hover:text-academic-text transition-colors"><i className="fa-solid fa-ellipsis-vertical text-xs"></i></button>
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 border border-academic-border">
            <img src="https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg" className="w-full h-full object-cover" alt="User" />
          </div>
          <div className="bg-academic-bg border border-academic-border rounded-lg rounded-tl-none p-2.5 text-xs text-academic-text max-w-[85%]">
            Can you summarize the main difference in inductive bias between CNNs and ViTs?
          </div>
        </div>

        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full bg-academic-accent text-white flex items-center justify-center shrink-0 font-serif font-bold text-[10px]">
            R
          </div>
          <div className="bg-academic-hover border border-academic-border rounded-lg rounded-tl-none p-2.5 text-xs text-academic-text max-w-[90%] space-y-2 shadow-sm">
            <p>Certainly. The core differences are:</p>
            <ul className="list-disc pl-4 space-y-1 text-academic-text/90">
              <li><strong>CNNs:</strong> High inductive bias (locality, translation invariance) via local receptive fields. Good for small data.</li>
              <li><strong>ViTs:</strong> Low inductive bias. Uses global self-attention from layer 1. Requires more data but scales better.</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-academic-border flex justify-end gap-2">
              <button className="text-[10px] text-academic-muted hover:text-academic-accent"><i className="fa-regular fa-copy"></i> Copy</button>
              <button className="text-[10px] text-academic-muted hover:text-academic-accent"><i className="fa-solid fa-plus"></i> Add to Editor</button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Input */}
      <div className="p-3 border-t border-academic-border bg-white shrink-0">
        <div className="relative flex items-center">
          <button className="absolute left-2 text-academic-muted hover:text-academic-accent transition-colors"><i className="fa-solid fa-paperclip text-xs"></i></button>
          <input type="text" className="w-full bg-academic-bg border border-academic-border rounded-full py-2 pl-8 pr-10 text-xs focus:outline-none focus:border-academic-accent transition-colors text-academic-text" placeholder="Ask about your research..." />
          <button className="absolute right-1 w-7 h-7 rounded-full bg-academic-accent text-white flex items-center justify-center hover:bg-red-700 transition-colors">
            <i className="fa-solid fa-arrow-up text-[10px]"></i>
          </button>
        </div>
      </div>
    </div>
  )
}

function RightWorkspace() {
  const [showSearch, setShowSearch] = useState(true)
  const [openPapers, setOpenPapers] = useState<LiteratureDetail[]>([])
  const [activePaperId, setActivePaperId] = useState<string | null>(null)
  const [isDownloadingPaper, setIsDownloadingPaper] = useState(false)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([])
  const [referencePreview, setReferencePreview] = useState<ReferencePreviewState>({ kind: 'closed' })
  const referencePreviewRequestTokenRef = useRef(0)

  const activePaper = openPapers.find((paper) => paper.paper_id === activePaperId) ?? null
  const isSearchVisible = showSearch || openPapers.length === 0
  const isReferencePreviewOpen = referencePreview.kind !== 'closed'

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

  return (
    <section className="relative flex-1 flex flex-col bg-academic-bg p-2 overflow-hidden border-l-2 border-academic-border">
      <div className="bg-academic-panel border-b border-academic-border p-2 mb-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {openPapers.length === 0 ? (
            <button className="px-3 py-1 text-sm font-medium text-academic-muted border-b-2 border-academic-accent">
              Literature Search
            </button>
          ) : (
            <>
              {openPapers.map((paper) => (
                <button
                  key={paper.paper_id}
                  className={`px-3 py-1 text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activePaperId === paper.paper_id && !showSearch
                      ? 'border-b-2 border-academic-accent text-academic-text'
                      : 'text-academic-muted hover:text-academic-text'
                  }`}
                  onClick={() => {
                    setShowSearch(false)
                    setActivePaperId(paper.paper_id)
                  }}
                >
                  <span>{paper.title}</span>
                  <i
                    className="fa-solid fa-xmark text-xs hover:text-red-500 cursor-pointer"
                    onClick={(event) => handleClosePaper(paper.paper_id, event)}
                  ></i>
                </button>
              ))}
              <button
                className="w-6 h-6 flex items-center justify-center text-academic-muted hover:text-academic-text transition-colors ml-2"
                onClick={() => setShowSearch(true)}
              >
                <i className="fa-solid fa-plus text-xs"></i>
              </button>
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

      <div className={`flex-1 gap-2 overflow-hidden ${isSearchVisible ? 'hidden' : 'flex'}`}>
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

              <div className="visible-scrollbar space-y-3 flex-1 min-h-0 overflow-y-auto pr-1">
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
              </div>

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
          <div className="visible-scrollbar flex-1 min-h-0 p-4 overflow-y-auto">
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
                    {paper.is_downloaded && paper.local_source_url && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          openDownloadLink(paper.local_source_url!)
                        }}
                        className="shrink-0 text-xs text-academic-accent hover:text-red-700"
                      >
                        LaTeX
                      </button>
                    )}
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
          </div>
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

  return (
    <div className="relative flex-[2] min-w-0">
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
                {paper.url && (
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
      className={`relative shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${
        isCollapsed ? 'w-0' : 'w-80'
      }`}
    >
      <aside
        className={`h-full w-80 bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden transition-opacity duration-200 ${
          isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
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
