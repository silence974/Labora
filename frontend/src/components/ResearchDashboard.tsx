import { useState, useEffect } from 'react'
import { deepReadApi } from '../api/deepRead'
import type { DeepReadResult } from '../api/deepRead'

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
    const handleStartDeepRead = async () => {
      setActiveLeftDoc('litReview')
      setDeepReadProgress(0)

      try {
        // 启动深度阅读任务
        const { task_id } = await deepReadApi.startDeepRead({
          paper_title: 'Transformers in Vision: A Comprehensive Survey',
          paper_url: 'https://arxiv.org/abs/2101.01169'
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

    window.addEventListener('startDeepRead', handleStartDeepRead)
    window.addEventListener('jumpToResult', handleJumpToResult)

    return () => {
      window.removeEventListener('startDeepRead', handleStartDeepRead)
      window.removeEventListener('jumpToResult', handleJumpToResult)
    }
  }, [setActiveLeftDoc])

  return (
    <section className="flex-[1.2] flex flex-col bg-academic-bg border-r border-academic-border h-full overflow-hidden p-2">

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
  const [showSearch, setShowSearch] = useState(false)
  const [openPapers, setOpenPapers] = useState<Array<{ id: string; title: string }>>([
    { id: 'paper1', title: 'Transformers in Vision' },
    { id: 'paper2', title: 'Attention Is All You Need' },
    { id: 'paper3', title: 'An Image is Worth 16x16 Words' }
  ])
  const [activePaper, setActivePaper] = useState<string>('paper1')

  const handleClosePaper = (paperId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newOpenPapers = openPapers.filter(p => p.id !== paperId)
    setOpenPapers(newOpenPapers)

    // 如果关闭的是当前激活的论文，切换到第一个可用的论文
    if (activePaper === paperId && newOpenPapers.length > 0) {
      setActivePaper(newOpenPapers[0].id)
    }
  }

  const handleOpenPaper = (paperId: string, paperTitle: string) => {
    // 检查论文是否已经打开
    const isAlreadyOpen = openPapers.some(p => p.id === paperId)

    if (!isAlreadyOpen) {
      // 添加新论文到打开列表
      setOpenPapers([...openPapers, { id: paperId, title: paperTitle }])
    }

    // 切换到该论文并关闭搜索页面
    setActivePaper(paperId)
    setShowSearch(false)
  }

  return (
    <section className="flex-1 flex flex-col bg-academic-bg p-2 overflow-hidden border-l-2 border-academic-border">

      {/* Toolbar */}
      <div className="bg-academic-panel border-b border-academic-border p-2 mb-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {openPapers.length === 0 ? (
            <button
              className="px-3 py-1 text-sm font-medium text-academic-muted border-b-2 border-academic-accent"
            >
              blank
            </button>
          ) : (
            <>
              {openPapers.map((paper) => (
                <button
                  key={paper.id}
                  className={`px-3 py-1 text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activePaper === paper.id && !showSearch
                      ? 'border-b-2 border-academic-accent text-academic-text'
                      : 'text-academic-muted hover:text-academic-text'
                  }`}
                  onClick={() => {
                    setShowSearch(false)
                    setActivePaper(paper.id)
                  }}
                >
                  <span>{paper.title}</span>
                  <i
                    className="fa-solid fa-xmark text-xs hover:text-red-500 cursor-pointer"
                    onClick={(e) => handleClosePaper(paper.id, e)}
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

        {/* Right side buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const event = new CustomEvent('startDeepRead')
              window.dispatchEvent(event)
            }}
            className="w-8 h-8 flex items-center justify-center rounded bg-academic-accent text-white hover:bg-red-700 transition-colors"
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

      {/* Split View Area */}
      {showSearch || openPapers.length === 0 ? (
        <LiteratureSearch onOpenPaper={handleOpenPaper} />
      ) : (
        <div className="flex-1 flex gap-2 overflow-hidden">
          <LaTeXViewer activePaper={activePaper} />
          <AnnotationPanel />
        </div>
      )}
    </section>
  )
}

function LiteratureSearch({ onOpenPaper }: { onOpenPaper: (paperId: string, paperTitle: string) => void }) {
  return (
    <div className="flex-1 flex flex-col gap-2 overflow-hidden">
      {/* Search Section */}
      <div className="h-1/2 bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden">
        <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
          <h3 className="font-serif text-xs font-bold flex items-center gap-2">
            <i className="fa-solid fa-magnifying-glass text-academic-accent text-xs"></i>
            Literature Search
          </h3>
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {/* Search Input */}
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search by title, author, keywords..."
                className="w-full bg-academic-bg border border-academic-border rounded-md py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-academic-accent transition-colors"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded bg-academic-accent text-white flex items-center justify-center hover:bg-red-700 transition-colors">
                <i className="fa-solid fa-magnifying-glass text-xs"></i>
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mb-4">
            <select className="px-3 py-1 text-xs border border-academic-border rounded bg-white text-academic-text focus:outline-none focus:border-academic-accent">
              <option>All Years</option>
              <option>2024</option>
              <option>2023</option>
              <option>2022</option>
            </select>
            <select className="px-3 py-1 text-xs border border-academic-border rounded bg-white text-academic-text focus:outline-none focus:border-academic-accent">
              <option>All Sources</option>
              <option>arXiv</option>
              <option>IEEE</option>
              <option>ACM</option>
            </select>
            <button className="px-3 py-1 text-xs border border-academic-border rounded bg-white text-academic-muted hover:text-academic-text hover:border-academic-accent transition-colors">
              <i className="fa-solid fa-filter text-xs mr-1"></i>
              More Filters
            </button>
          </div>

          {/* Search Results Placeholder */}
          <div className="text-center text-academic-muted py-8">
            <i className="fa-solid fa-magnifying-glass text-3xl mb-3 opacity-30"></i>
            <p className="text-sm">Enter keywords to search for literature</p>
          </div>
        </div>
      </div>

      {/* Recent History Section */}
      <div className="h-1/2 bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden">
        <div className="h-8 border-b border-academic-border bg-academic-hover flex items-center px-3">
          <h3 className="font-serif text-xs font-bold flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left text-academic-accent text-xs"></i>
            Recent Papers
          </h3>
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {/* History Item */}
          <div
            className="mb-3 p-3 border border-academic-border rounded-lg hover:bg-academic-hover transition-colors cursor-pointer"
            onClick={() => onOpenPaper('paper1', 'Transformers in Vision')}
          >
            <h4 className="text-sm font-medium text-academic-text mb-1">Transformers in Vision: A Comprehensive Survey</h4>
            <p className="text-xs text-academic-muted mb-2">Kai Han, Yunhe Wang • 2023</p>
            <div className="flex gap-2">
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">Computer Vision</span>
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">Transformers</span>
            </div>
          </div>

          <div
            className="mb-3 p-3 border border-academic-border rounded-lg hover:bg-academic-hover transition-colors cursor-pointer"
            onClick={() => onOpenPaper('paper2', 'Attention Is All You Need')}
          >
            <h4 className="text-sm font-medium text-academic-text mb-1">Attention Is All You Need</h4>
            <p className="text-xs text-academic-muted mb-2">Vaswani et al. • 2017</p>
            <div className="flex gap-2">
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">NLP</span>
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">Attention</span>
            </div>
          </div>

          <div
            className="mb-3 p-3 border border-academic-border rounded-lg hover:bg-academic-hover transition-colors cursor-pointer"
            onClick={() => onOpenPaper('paper3', 'An Image is Worth 16x16 Words')}
          >
            <h4 className="text-sm font-medium text-academic-text mb-1">An Image is Worth 16x16 Words</h4>
            <p className="text-xs text-academic-muted mb-2">Dosovitskiy et al. • 2021</p>
            <div className="flex gap-2">
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">Vision Transformer</span>
            </div>
          </div>

          <div
            className="mb-3 p-3 border border-academic-border rounded-lg hover:bg-academic-hover transition-colors cursor-pointer"
            onClick={() => onOpenPaper('paper4', 'BERT: Pre-training of Deep Bidirectional Transformers')}
          >
            <h4 className="text-sm font-medium text-academic-text mb-1">BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding</h4>
            <p className="text-xs text-academic-muted mb-2">Devlin et al. • 2018</p>
            <div className="flex gap-2">
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">NLP</span>
              <span className="px-2 py-0.5 bg-academic-hover text-xs rounded">Pre-training</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LaTeXViewer({ activePaper }: { activePaper: string }) {
  // 根据不同的 paper 显示不同的内容
  const paperContent: Record<string, {
    title: string
    authors: Array<{ name: string; affiliation: string }>
    abstract: string
    content: string
  }> = {
    paper1: {
      title: 'Transformers in Vision: A Comprehensive Survey',
      authors: [
        { name: 'Kai Han', affiliation: "Noah's Ark Lab" },
        { name: 'Yunhe Wang', affiliation: 'Huawei Technologies' }
      ],
      abstract: 'Transformer, first applied to the field of natural language processing, is a type of deep neural network mainly based on the self-attention mechanism. Thanks to its strong representation capabilities, researchers are looking at ways to apply transformer to computer vision tasks. In this paper, we review the application of transformer models in computer vision...',
      content: 'Deep learning has achieved tremendous success in various computer vision tasks. The convolutional neural network (CNN) is the fundamental component of modern vision systems. However, recently, the Transformer architecture has shown great potential to become a strong alternative to CNNs.'
    },
    paper2: {
      title: 'Attention Is All You Need',
      authors: [
        { name: 'Ashish Vaswani', affiliation: 'Google Brain' },
        { name: 'Noam Shazeer', affiliation: 'Google Brain' }
      ],
      abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
      content: 'The Transformer follows this overall architecture using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder. The attention function can be described as mapping a query and a set of key-value pairs to an output.'
    },
    paper3: {
      title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
      authors: [
        { name: 'Alexey Dosovitskiy', affiliation: 'Google Research' },
        { name: 'Lucas Beyer', affiliation: 'Google Research' }
      ],
      abstract: 'While the Transformer architecture has become the de-facto standard for natural language processing tasks, its applications to computer vision remain limited. In vision, attention is either applied in conjunction with convolutional networks, or used to replace certain components of convolutional networks.',
      content: 'We show that this reliance on CNNs is not necessary and a pure transformer applied directly to sequences of image patches can perform very well on image classification tasks. When pre-trained on large amounts of data and transferred to multiple mid-sized or small image recognition benchmarks, Vision Transformer (ViT) attains excellent results.'
    }
  }

  const paper = paperContent[activePaper] || paperContent.paper1

  return (
    <article className="flex-[2] bg-white shadow-soft border-2 border-academic-border overflow-y-auto p-8 pt-5">
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-12 border-b border-academic-border pb-8">
          <h1 className="font-serif text-3xl font-bold leading-tight mb-6">{paper.title}</h1>
          <div className="flex justify-center gap-8 text-sm font-serif">
            {paper.authors.map((author, index) => (
              <div key={index} className="text-center">
                <p className="font-bold">{author.name}</p>
                <p className="text-academic-muted text-xs mt-1">{author.affiliation}</p>
              </div>
            ))}
          </div>
        </header>

        <section className="mb-10">
          <h2 className="font-serif text-lg font-bold mb-4 uppercase tracking-wider text-center">Abstract</h2>
          <p className="font-serif text-sm leading-relaxed text-justify text-academic-text/90">
            {paper.abstract}
          </p>
        </section>

        <section className="mb-10">
          <h2 className="font-serif text-xl font-bold mb-4 border-b border-academic-border pb-2">1. Introduction</h2>
          <p className="font-serif text-sm leading-relaxed text-justify text-academic-text/90 mb-4">
            {paper.content}
          </p>

          <p className="font-serif text-sm leading-relaxed text-justify text-academic-text/90 bg-yellow-50 border-l-2 border-yellow-400 pl-3 py-1 cursor-pointer hover:bg-yellow-100 transition-colors">
            The self-attention mechanism <span className="latex-math text-xs ml-1">(Eq. 1)</span> allows the model to capture long-range dependencies across the entire image, which is a significant advantage over the local receptive fields of standard convolutions.
          </p>

          <div className="my-8 text-center bg-academic-hover py-6 rounded-lg border border-academic-border">
            <p className="font-serif italic text-sm text-academic-muted mb-2">Equation 1: Self-Attention</p>
            <p className="font-serif text-lg">
              <span className="latex-math">Attention(Q, K, V) = softmax(QK<sup>T</sup> / &radic;d<sub>k</sub>)V</span>
            </p>
          </div>
        </section>
      </div>
    </article>
  )
}

function AnnotationPanel() {
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

    window.addEventListener('toggleNotes', handleToggleNotes)

    return () => {
      window.removeEventListener('toggleNotes', handleToggleNotes)
    }
  }, [isCollapsed, activeTab])

  return (
    <div className={`relative flex items-start justify-end transition-all duration-300 ${isCollapsed ? 'flex-none' : 'flex-1'}`}>
      {/* Panel and Bookmarks Container */}
      <div className="flex items-start">
        {/* Expanded Panel */}
        <aside className={`bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden transition-all duration-300 ${
          isCollapsed ? 'w-0 opacity-0 border-0' : 'w-80 opacity-100'
        }`}>
          {!isCollapsed && (
            <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2">
              {activeTab === 'notes' && (
                <>
                  <div className="bg-academic-hover rounded-lg p-3 border border-transparent hover:border-academic-border transition-colors">
                    <div className="text-xs text-academic-muted mb-2 flex justify-between items-center">
                      <span>Section 1. Introduction</span>
                      <span>10:42 AM</span>
                    </div>
                    <blockquote className="text-xs font-serif italic border-l-2 border-academic-accent pl-2 text-academic-text/80 mb-3">
                      "The self-attention mechanism allows the model to capture long-range dependencies..."
                    </blockquote>
                    <textarea
                      className="w-full bg-white border border-academic-border rounded-md p-2 text-sm resize-none focus:outline-none focus:border-academic-accent transition-colors"
                      rows={3}
                      placeholder="Add your thoughts here..."
                      defaultValue="Crucial point for my methodology comparison section. Need to contrast this with CNN receptive fields."
                    />
                    <div className="mt-2 flex justify-end">
                      <button className="text-xs font-medium text-academic-accent hover:text-red-700">Save Note</button>
                    </div>
                  </div>

                  <div className="border-2 border-dashed border-academic-border rounded-lg p-6 text-center text-academic-muted hover:bg-academic-hover hover:border-academic-muted transition-all cursor-pointer">
                    <i className="fa-solid fa-plus mb-2"></i>
                    <p className="text-xs">Select text in the viewer to add a new annotation</p>
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
    </div>
  )
}
