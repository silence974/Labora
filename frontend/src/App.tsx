import { useEffect, useState } from 'react'
import { ResearchWorkflow } from './components/ResearchWorkflow'
import { PaperReader } from './components/PaperReader'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8765'

type BackendStatus = 'checking' | 'ok' | 'error'
type ActiveTab = 'research' | 'reader'

function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')
  const [activeTab, setActiveTab] = useState<ActiveTab>('research')

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then(res => res.json())
      .then(data => setBackendStatus(data.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setBackendStatus('error'))
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Labora</h1>
        <p className="subtitle">科研文献研究助手</p>
        <div className={`status status-${backendStatus}`}>
          {backendStatus === 'checking' && '正在连接后端…'}
          {backendStatus === 'ok' && '后端已连接'}
          {backendStatus === 'error' && '后端连接失败'}
        </div>
      </header>

      {backendStatus === 'ok' && (
        <>
          <nav className="app-nav">
            <button
              className={activeTab === 'research' ? 'active' : ''}
              onClick={() => setActiveTab('research')}
            >
              研究工作流
            </button>
            <button
              className={activeTab === 'reader' ? 'active' : ''}
              onClick={() => setActiveTab('reader')}
            >
              论文阅读器
            </button>
          </nav>

          <main className="app-main">
            {activeTab === 'research' && <ResearchWorkflow />}
            {activeTab === 'reader' && <PaperReader />}
          </main>
        </>
      )}

      {backendStatus === 'error' && (
        <main className="app-main">
          <div className="error-notice">
            <h2>无法连接到后端服务</h2>
            <p>请确保后端服务正在运行：</p>
            <pre>cd backend && uv run python main.py</pre>
          </div>
        </main>
      )}
    </div>
  )
}

export default App
