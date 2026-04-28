import { useState } from 'preact/hooks'
import ReactMarkdown from 'react-markdown'
import './PaperReader.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8765'

interface KeyInformation {
  background: string
  method: string
  contribution: string[]
  limitation: string[]
}

interface PaperAnalysis {
  paper_id: string
  key_information: KeyInformation
  note: string
}

export function PaperReader() {
  const [paperId, setPaperId] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<PaperAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  const readPaper = async () => {
    if (!paperId.trim()) return

    try {
      setLoading(true)
      setError(null)

      // 启动阅读任务
      const startResponse = await fetch(`${API_BASE}/api/papers/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paperId }),
      })

      if (!startResponse.ok) throw new Error('Failed to start reading')

      const { task_id } = await startResponse.json()

      // 轮询任务状态
      await pollReadingTask(task_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  const pollReadingTask = async (taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const statusResponse = await fetch(
          `${API_BASE}/api/papers/read/${taskId}/status`
        )
        if (!statusResponse.ok) throw new Error('Failed to get status')

        const statusData = await statusResponse.json()

        if (statusData.status === 'completed') {
          clearInterval(interval)
          const resultResponse = await fetch(
            `${API_BASE}/api/papers/read/${taskId}/result`
          )
          if (!resultResponse.ok) throw new Error('Failed to get result')

          const result = await resultResponse.json()
          setAnalysis(result)
          setLoading(false)
        } else if (statusData.status === 'failed') {
          clearInterval(interval)
          setError(statusData.error || 'Reading failed')
          setLoading(false)
        }
      } catch (err) {
        clearInterval(interval)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      }
    }, 2000)
  }

  const reset = () => {
    setPaperId('')
    setAnalysis(null)
    setError(null)
  }

  return (
    <div className="paper-reader">
      <h2>论文阅读器</h2>

      {!analysis && (
        <div className="input-section">
          <label htmlFor="paper-id">请输入论文 ID：</label>
          <input
            id="paper-id"
            type="text"
            value={paperId}
            onChange={(e) => setPaperId(e.currentTarget.value)}
            placeholder="例如：arxiv:1706.03762 或 1706.03762"
            disabled={loading}
          />
          <button onClick={readPaper} disabled={!paperId.trim() || loading}>
            {loading ? '阅读中...' : '开始阅读'}
          </button>
        </div>
      )}

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={reset}>重试</button>
        </div>
      )}

      {loading && (
        <div className="loading-section">
          <div className="spinner"></div>
          <p>正在阅读论文，请稍候...</p>
        </div>
      )}

      {analysis && (
        <div className="analysis-section">
          <div className="analysis-header">
            <h3>{analysis.paper_id}</h3>
            <button onClick={reset} className="new-paper-btn">
              阅读新论文
            </button>
          </div>

          <div className="key-information">
            <h4>关键信息</h4>

            <div className="info-block">
              <h5>研究背景</h5>
              <p>{analysis.key_information.background}</p>
            </div>

            <div className="info-block">
              <h5>核心方法</h5>
              <p>{analysis.key_information.method}</p>
            </div>

            <div className="info-block">
              <h5>主要贡献</h5>
              <ul>
                {analysis.key_information.contribution.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="info-block">
              <h5>局限性</h5>
              <ul>
                {analysis.key_information.limitation.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="note-section">
            <h4>阅读笔记</h4>
            <div className="markdown-content">
              <ReactMarkdown>{analysis.note}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
