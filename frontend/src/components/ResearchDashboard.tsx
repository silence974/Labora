import { useState } from 'react'

export function ResearchDashboard() {
  const [showDocDetails, setShowDocDetails] = useState(false)

  return (
    <div className="w-full h-screen bg-academic-bg flex flex-col overflow-hidden relative">

      {/* Header */}
      <header className="bg-academic-panel border-b border-academic-border h-12 flex items-center justify-between shrink-0 shadow-sm z-10 relative" style={{ paddingLeft: '20px', paddingRight: '24px' }}>
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-academic-accent text-white rounded flex items-center justify-center font-serif font-bold text-lg">
            R
          </div>
          <h1 className="font-serif text-xl font-bold tracking-tight">Research Assistant</h1>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <button className="text-academic-muted hover:text-academic-accent transition-colors">
            <i className="fa-solid fa-gear"></i>
          </button>
        </div>
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
              className="w-full h-10 rounded-lg bg-academic-hover border border-academic-border flex items-center pl-3 text-academic-accent cursor-pointer relative group/item"
              onClick={() => setShowDocDetails(!showDocDetails)}
            >
              <i className="fa-solid fa-file-lines"></i>
              <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-events-none truncate w-28">Methodology...</span>
            </div>

            <div className="w-full h-10 rounded-lg flex items-center pl-3 text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors cursor-pointer relative group/item">
              <i className="fa-regular fa-file-pdf"></i>
              <span className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-academic-text pointer-names-none truncate w-28">Lit Review</span>
            </div>

            <div className="w-full h-10 rounded-lg flex items-center pl-3 text-academic-muted hover:bg-academic-hover hover:text-academic-text transition-colors cursor-pointer relative group/item">
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
        <LeftWorkspace showDocDetails={showDocDetails} onCloseDetails={() => setShowDocDetails(false)} />

        {/* Right Workspace */}
        <RightWorkspace />

      </main>
    </div>
  )
}

function LeftWorkspace({ showDocDetails, onCloseDetails }: { showDocDetails: boolean; onCloseDetails: () => void }) {
  return (
    <section className="flex-[1.2] flex flex-col bg-academic-bg border-r border-academic-border shrink-0 h-full overflow-hidden relative !p-2">

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

      {/* Editor Toolbar */}
      <div className="bg-academic-panel border-b-2 border-academic-border flex items-center justify-between shrink-0" style={{ padding: '4px 24px' }}>
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-academic-muted bg-academic-hover px-2 py-1 rounded">LaTeX Ready</span>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-y-auto bg-white relative" style={{ padding: '32px' }}>
        <div className="max-w-4xl mx-auto">
          <input
            type="text"
            defaultValue="Methodology: Comparing CNNs and Vision Transformers"
            className="w-full font-serif text-2xl font-bold !mb-3 outline-none text-academic-text bg-transparent placeholder-academic-muted border-b border-transparent focus:border-academic-border pb-2 transition-colors"
            placeholder="Report Title..."
          />

          <div className="font-serif text-sm leading-relaxed text-academic-text/90 !space-y-2">
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

      {/* Bottom Split - LLM Research Area */}
      <div className="h-[320px] shrink-0 border-t-2 border-academic-border bg-academic-panel flex overflow-hidden">
        <ResearchProgress />
        <AIChat />
      </div>
    </section>
  )
}

function ResearchProgress() {
  return (
    <div className="w-1/2 border-r-2 border-academic-border flex flex-col">
      <div className="border-b border-academic-border bg-academic-hover flex items-center justify-between shrink-0" style={{ padding: '6px 12px', height: '32px' }}>
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
      <div className="border-b border-academic-border bg-academic-hover flex items-center justify-between shrink-0" style={{ padding: '6px 12px', height: '32px' }}>
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
  return (
    <section className="flex-1 flex flex-col bg-academic-bg !p-2 overflow-hidden relative border-l-2 border-academic-border">

      {/* Toolbar */}
      <div className="bg-academic-panel border-b border-academic-border p-2 mb-2 flex items-center shrink-0">
        <div className="flex items-center gap-1">
          <button className="px-3 py-1 text-sm font-medium border-b-2 border-academic-accent text-academic-text">Paper 1</button>
          <button className="px-3 py-1 text-sm font-medium text-academic-muted hover:text-academic-text transition-colors">Paper 2</button>
          <button className="px-3 py-1 text-sm font-medium text-academic-muted hover:text-academic-text transition-colors">Paper 3</button>
          <button className="w-6 h-6 flex items-center justify-center text-academic-muted hover:text-academic-text transition-colors ml-2">
            <i className="fa-solid fa-plus text-xs"></i>
          </button>
        </div>
      </div>

      {/* Split View Area */}
      <div className="flex-1 flex gap-2 overflow-hidden">
        <LaTeXViewer />
        <AnnotationPanel />
      </div>
    </section>
  )
}

function LaTeXViewer() {
  return (
    <article className="flex-[2] bg-white shadow-soft border-2 border-academic-border overflow-y-auto relative" style={{ padding: '20px 32px 32px 32px' }}>
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-12 border-b border-academic-border pb-8">
          <h1 className="font-serif text-3xl font-bold leading-tight mb-6">Transformers in Vision: A Comprehensive Survey</h1>
          <div className="flex justify-center gap-8 text-sm font-serif">
            <div className="text-center">
              <p className="font-bold">Kai Han</p>
              <p className="text-academic-muted text-xs mt-1">Noah's Ark Lab</p>
            </div>
            <div className="text-center">
              <p className="font-bold">Yunhe Wang</p>
              <p className="text-academic-muted text-xs mt-1">Huawei Technologies</p>
            </div>
          </div>
        </header>

        <section className="mb-10">
          <h2 className="font-serif text-lg font-bold mb-4 uppercase tracking-wider text-center">Abstract</h2>
          <p className="font-serif text-sm leading-relaxed text-justify text-academic-text/90">
            Transformer, first applied to the field of natural language processing, is a type of deep neural network mainly based on the self-attention mechanism. Thanks to its strong representation capabilities, researchers are looking at ways to apply transformer to computer vision tasks. In this paper, we review the application of transformer models in computer vision...
          </p>
        </section>

        <section className="mb-10">
          <h2 className="font-serif text-xl font-bold mb-4 border-b border-academic-border pb-2">1. Introduction</h2>
          <p className="font-serif text-sm leading-relaxed text-justify text-academic-text/90 mb-4">
            Deep learning has achieved tremendous success in various computer vision tasks. The convolutional neural network (CNN) is the fundamental component of modern vision systems. However, recently, the Transformer architecture has shown great potential to become a strong alternative to CNNs.
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
  return (
    <aside className="flex-1 bg-white shadow-soft border-2 border-academic-border flex flex-col overflow-hidden">
      <div className="p-4 border-b border-academic-border bg-academic-hover flex items-center justify-between">
        <h3 className="font-serif font-bold text-sm flex items-center gap-2">
          <i className="fa-regular fa-pen-to-square text-academic-accent"></i>
          Reading Notes
        </h3>
        <div className="flex gap-2">
          <button className="w-6 h-6 rounded flex items-center justify-center text-academic-muted hover:bg-white hover:shadow-sm transition-all"><i className="fa-solid fa-highlighter text-xs text-yellow-500"></i></button>
          <button className="w-6 h-6 rounded flex items-center justify-center text-academic-muted hover:bg-white hover:shadow-sm transition-all"><i className="fa-solid fa-message text-xs"></i></button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
      </div>
    </aside>
  )
}
