import './Sidebar.css'

interface SidebarProps {
  activeView: 'research' | 'reader' | 'settings'
  onViewChange: (view: 'research' | 'reader' | 'settings') => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <button
        className={`sidebar-btn ${activeView === 'research' ? 'active' : ''}`}
        onClick={() => onViewChange('research')}
        title="研究工作流"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </button>

      <button
        className={`sidebar-btn ${activeView === 'reader' ? 'active' : ''}`}
        onClick={() => onViewChange('reader')}
        title="论文阅读器"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </button>

      <button
        className={`sidebar-btn ${activeView === 'settings' ? 'active' : ''}`}
        onClick={() => onViewChange('settings')}
        title="设置"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6m-9-9h6m6 0h6" />
          <path d="M4.22 4.22l4.24 4.24m7.08 0l4.24-4.24M4.22 19.78l4.24-4.24m7.08 0l4.24 4.24" />
        </svg>
      </button>
    </aside>
  )
}
