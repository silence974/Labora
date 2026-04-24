import './TopBar.css'

interface TopBarProps {
  backendStatus: 'checking' | 'ok' | 'error'
}

export function TopBar({ backendStatus }: TopBarProps) {
  const getStatusText = () => {
    switch (backendStatus) {
      case 'checking': return '连接中...'
      case 'ok': return '所有更改已保存'
      case 'error': return '后端连接失败'
    }
  }

  return (
    <header className="top-bar">
      <div className="top-bar-content">
        <div className="top-bar-left">
          <h1 className="app-title">Labora</h1>
        </div>
        <div className="top-bar-right">
          <span className={`status-text status-${backendStatus}`}>
            {getStatusText()}
          </span>
          <div className="user-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
          </div>
        </div>
      </div>
    </header>
  )
}
