import { useState } from 'preact/hooks'
import ReactMarkdown from 'react-markdown'
import './ResearchWorkflow.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8765'

type TaskStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed'

interface ResearchResult {
  research_question: string
  refined_direction: string
  selected_papers: string[]
  synthesis: string
}

export function ResearchWorkflow() {
  const [question, setQuestion] = useState('')
  const [status, setStatus] = useState<TaskStatus>('idle')
  const [stage, setStage] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ResearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startResearch = async () => {
    if (!question.trim()) return

    try {
      setStatus('pending')
      setError(null)

      const response = await fetch(`${API_BASE}/api/research/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ research_question: question }),
      })

      if (!response.ok) throw new Error('Failed to start research')

      const data = await response.json()
      pollStatus(data.task_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('failed')
    }
  }

  const pollStatus = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/research/${id}/status`)
        if (!response.ok) throw new Error('Failed to get status')

        const data = await response.json()
        setStatus(data.status)
        setStage(data.stage)
        setProgress(data.progress || 0)

        if (data.status === 'completed') {
          clearInterval(interval)
          fetchResult(id)
        } else if (data.status === 'failed') {
          clearInterval(interval)
          setError(data.error || 'Task failed')
        }
      } catch (err) {
        clearInterval(interval)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStatus('failed')
      }
    }, 2000)
  }

  const fetchResult = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/research/${id}/result`)
      if (!response.ok) throw new Error('Failed to get result')

      const data = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const reset = () => {
    setQuestion('')
    setStatus('idle')
    setStage(null)
    setProgress(0)
    setResult(null)
    setError(null)
  }

  const getStageLabel = (stage: string | null) => {
    const stages: Record<string, string> = {
      initial_explorer: '初步探索',
      question_generator: '生成问题',
      direction_refiner: '细化方向',
      core_paper_selector: '选择论文',
      collaborative_reader: '阅读论文',
      synthesizer: '生成综述',
      completed: '已完成',
    }
    return stage ? stages[stage] || stage : '准备中'
  }

  return (
    <div className="research-workflow">
      <h2>研究工作流</h2>

      {status === 'idle' && (
        <div className="input-section">
          <label htmlFor="question">请输入您的研究问题：</label>
          <textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            placeholder="例如：What are the recent advances in transformer architectures?"
            rows={4}
          />
          <button onClick={startResearch} disabled={!question.trim()}>
            开始研究
          </button>
        </div>
      )}

      {(status === 'pending' || status === 'running') && (
        <div className="progress-section">
          <h3>研究进行中...</h3>
          <div className="stage-info">
            <p>当前阶段：{getStageLabel(stage)}</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="progress-text">{progress}%</p>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="error-section">
          <h3>研究失败</h3>
          <p className="error-message">{error}</p>
          <button onClick={reset}>重新开始</button>
        </div>
      )}

      {status === 'completed' && result && (
        <div className="result-section">
          <h3>研究完成</h3>

          <div className="result-meta">
            <p><strong>研究问题：</strong>{result.research_question}</p>
            <p><strong>细化方向：</strong>{result.refined_direction}</p>
            <p>
              <strong>选中论文：</strong>
              {result.selected_papers.join(', ')}
            </p>
          </div>

          <div className="synthesis">
            <h4>综述报告</h4>
            <div className="markdown-content">
              <ReactMarkdown>{result.synthesis}</ReactMarkdown>
            </div>
          </div>

          <button onClick={reset}>开始新研究</button>
        </div>
      )}
    </div>
  )
}
