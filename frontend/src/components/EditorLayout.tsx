import { useState } from 'react'
import './EditorLayout.css'

export function EditorLayout() {
  const [content, setContent] = useState(`# Methodology: Comparing CNNs and Vision Transformers

## Introduction
This section explores the fundamental differences between Convolutional Neural Networks (CNNs) and Vision Transformers (ViTs) in computer vision tasks.

## Mathematical Foundation
The core operation in CNNs can be expressed as:

y = Σ w_{i,j} * x_{i,j} + b

Where w represents the convolutional kernel weights and x represents the input feature map.

## Key Differences
- **CNNs**: Local receptive fields, translation invariance
- **Vision Transformers**: Global attention, position embeddings
- **Computational Complexity**: O(n²) for ViT vs O(k²n²) for CNN`)

  const [references] = useState([
    { id: 1, title: 'Attention Is All You Need', authors: 'Vaswani et al.', year: 2017 },
    { id: 2, title: 'An Image is Worth 16x16 Words', authors: 'Dosovitskiy et al.', year: 2020 },
    { id: 3, title: 'Deep Residual Learning', authors: 'He et al.', year: 2016 }
  ])

  return (
    <div className="editor-layout">
      {/* Left Sidebar */}
      <aside className="doc-sidebar">
        <div className="sidebar-header">
          <h3>Documents</h3>
          <button className="new-doc-btn">+</button>
        </div>
        <nav className="doc-list">
          <div className="doc-item active">
            <span className="doc-icon">📄</span>
            <span>Methodology</span>
          </div>
          <div className="doc-item">
            <span className="doc-icon">📝</span>
            <span>Literature Review</span>
          </div>
          <div className="doc-item">
            <span className="doc-icon">📊</span>
            <span>Results Analysis</span>
          </div>
        </nav>
      </aside>

      {/* Main Editor */}
      <main className="editor-main">
        <div className="editor-toolbar">
          <button className="toolbar-btn" title="Bold"><strong>B</strong></button>
          <button className="toolbar-btn" title="Italic"><em>I</em></button>
          <button className="toolbar-btn" title="Heading">H1</button>
          <button className="toolbar-btn" title="Heading 2">H2</button>
          <button className="toolbar-btn" title="Heading 3">H3</button>
          <div className="toolbar-divider"></div>
          <button className="toolbar-btn" title="Bullet List">•</button>
          <button className="toolbar-btn" title="Numbered List">1.</button>
          <div className="toolbar-divider"></div>
          <button className="toolbar-btn" title="Equation">∑</button>
          <button className="toolbar-btn" title="Code">&lt;/&gt;</button>
        </div>

        <div className="editor-content">
          <textarea
            className="editor-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing..."
          />
        </div>
      </main>

      {/* Right Panel */}
      <aside className="right-panel">
        <div className="panel-tabs">
          <button className="panel-tab active">References</button>
          <button className="panel-tab">AI Assistant</button>
        </div>

        <div className="references-section">
          <h4>Referenced Papers</h4>
          <div className="reference-list">
            {references.map(ref => (
              <div key={ref.id} className="reference-item">
                <div className="ref-title">{ref.title}</div>
                <div className="ref-meta">{ref.authors} ({ref.year})</div>
              </div>
            ))}
          </div>
        </div>

        <div className="ai-assistant-section">
          <div className="chat-messages">
            <div className="assistant-message">
              How can I help you with your research today?
            </div>
          </div>
          <div className="chat-input-container">
            <input
              type="text"
              className="chat-input"
              placeholder="Ask about your research..."
            />
            <button className="send-btn">→</button>
          </div>
        </div>
      </aside>
    </div>
  )
}
