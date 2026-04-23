import { useEffect, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8765'

type BackendStatus = 'checking' | 'ok' | 'error'

function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')

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

      <main className="app-main">
        <p>项目骨架已就绪，后续任务将在此基础上构建功能。</p>
      </main>
    </div>
  )
}

export default App
