# Research Agent Core Loop — Implementation Plan

## Context

Labora 目前有三个线性 AI 能力（Paper Reader, Research Workflow, Deep Reader），都没有反馈循环。真实研究是迭代的：读论文时发现新的搜索方向，合成时发现 gaps 需要回头补文献。本次改造将 Research Workflow 重构为 Plan→Act→Observe→Reflect 的迭代式核心循环，以产出结构化 LaTeX 研究文档为目标。

## Design Summary

```
User Input → Init (ResearchContext + LaTeX skeleton)
  → Plan (LLM 决策下一步动作)
  → [USER INTERRUPT: confirm/reject action]
  → Act (执行工具: search/skim/deep_read/compare/trace/synthesize/edit/ask_user)
  → Observe (更新 context)
  → Reflect (LLM 评估进展)
  → [USER INTERRUPT: continue/done]
  → loop back to Plan OR Finalize
```

- **2 个中断点**: Plan 后 (确认动作), Reflect 后 (继续/结束)
- **8 种 Action**: search, skim, deep_read, compare, trace_citation, synthesize, edit_document, ask_user
- **edit_document**: 增量修改, 批量确认, 版本管理+回退
- **deep_reader**: 作为 tool 复用, 不修改
- **paper_reader**: 保留作为 `skim` action（快速浏览），deep_reader 作为 `deep_read`（精读），两档阅读并存

## Files to Create

### 1. `backend/labora/agent/research_agent.py` (NEW — core agent, ~500 lines)

LangGraph StateGraph with:

**Nodes:**
- `init_node` — 创建 ResearchContext, LaTeX 骨架, 初始化版本历史
- `plan_node` — LLM 分析当前 context, 输出 planned_action `{type, params, rationale}`
- `act_search` — 调用 arxiv_search, 结果加入 literature_map
- `act_skim` — 调用 read_paper() (paper_reader), 快速提取 4 基础字段，结果存入 reading_notes
- `act_deep_read` — 调用 run_deep_reading() (deep_reader), 三阶段精读，结果存入 reading_notes
- `act_compare` — LLM 横向比较指定论文, 提取 insights
- `act_trace_citation` — 调用 Semantic Scholar API, 追踪引用链
- `act_synthesize` — LLM 阶段性综合当前知识, 更新 document
- `act_edit_document` — LLM 生成增量修改, 创建新版本
- `act_ask_user` — 生成方向性问题, 设置 interrupt
- `observe_node` — 提取 action 结果中的关键信息, 更新 context
- `reflect_node` — LLM 评估: 信息够了吗? gaps? 方向需要调整吗?
- `finalize_node` — 整理 LaTeX 文档, 保存到 SQLite

**Edges:**
- init → plan
- plan → [USER INTERRUPT: interrupt_before]
- plan → action_router (conditional: action type → act_*)
- act_* → observe
- observe → reflect
- reflect → [USER INTERRUPT: interrupt_before]
- reflect → continue_router (conditional: continue → plan, done → finalize)
- finalize → END

**State (ResearchAgentState):**
```python
class ResearchAgentState(TypedDict):
    research_question: str
    initial_direction: str
    document: str                    # LaTeX content
    document_versions: list[dict]    # [{index, content, description, edit_type, timestamp}]
    current_version_index: int
    literature_map: dict             # paper_id -> {meta, status}
    reading_notes: dict              # paper_id -> deep_reader results
    insights: list[str]
    open_questions: list[str]
    planned_action: dict             # {type, params, rationale}
    action_result: dict
    reflection: dict                 # {summary, gaps, recommendation, should_continue}
    iteration_count: int
    pending_prompt: str
    error: str
    status: str                      # running|interrupted|completed|failed
    interrupt_type: str              # confirm_action|continue_decision|user_question
```

**Key functions:**
- `create_research_agent_graph()` → compiled StateGraph with SqliteSaver checkpointer
- `run_agent(question, direction, db_path)` → starts agent, returns state at first interrupt

### 2. `backend/labora/agent/prompts.py` (NEW — prompt templates, ~100 lines)

Shared prompt constants for plan, reflect, synthesize, compare, edit_document nodes.

### 3. `backend/labora/persistence/agent_store.py` (NEW — SQLite CRUD, ~150 lines)

Tables:
```sql
CREATE TABLE IF NOT EXISTS agent_tasks (
    task_id TEXT PRIMARY KEY,
    research_question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_document_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    version_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    edit_type TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES agent_tasks(task_id)
);
```

Methods: `create_task`, `update_task_status`, `get_task`, `save_version`, `get_versions`, `get_version`, `rollback_to_version`

### 4. `backend/labora/api/routes/research_agent.py` (NEW — REST API, ~200 lines)

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/research-agent/start` | Start agent, returns state at first interrupt |
| POST | `/api/research-agent/{task_id}/resume` | Resume with user response, returns next state |
| GET | `/api/research-agent/{task_id}/state` | Get current agent state |
| GET | `/api/research-agent/{task_id}/result` | Get final document + versions |
| POST | `/api/research-agent/{task_id}/rollback` | Rollback to a previous version |
| GET | `/api/research-agent/` | List all tasks |

Resume flow: API receives user response → updates state with response → invokes graph again → graph runs until next interrupt or end → returns new state to frontend.

### 5. `frontend/src/api/researchAgent.ts` (NEW — API client, ~80 lines)

TypeScript API client mirroring the backend endpoints. Types for ResearchAgentState, PlannedAction, DocumentVersion, etc.

### 6. `frontend/src/components/ResearchAgentPanel.tsx` (NEW — main UI, ~350 lines)

Agent lifecycle state machine: `idle → starting → waiting_confirm → running → waiting_decision → running → ... → completed`

Renders:
- Start form (research question + direction)
- Action confirmation card (when waiting_confirm)
- Running indicator (during Act/Observe/Reflect phases)
- Continue/done decision card (when waiting_decision)
- Final document with editor + version history

### 7. `frontend/src/components/AgentActionCard.tsx` (NEW, ~80 lines)

Displays planned action: type icon, rationale, params summary. Accept/Reject buttons.

### 8. `frontend/src/components/AgentReflectionCard.tsx` (NEW, ~80 lines)

Displays reflection: gaps summary, progress. Continue/Finalize buttons.

### 9. `frontend/src/components/LaTeXEditor.tsx` (NEW, ~150 lines)

Based on the unused EditorLayout.tsx. Monospace textarea for LaTeX, basic toolbar, document stats.

### 10. `frontend/src/components/DocumentVersionHistory.tsx` (NEW, ~100 lines)

Timeline of versions. Click to preview or rollback. Shows diff between current and selected.

## Files to Modify

### 11. `backend/labora/agent/__init__.py`
- Add exports: `create_research_agent_graph`, `run_agent`
- Keep existing exports (`read_paper`, `run_deep_reading`, etc.) unchanged
- `create_research_workflow` / `run_research` 保留导出，但在 docstring 标注推荐使用新的 research_agent

### 12. `backend/labora/api/app.py`
- Mount research_agent router at `/api/research-agent`

### 13. `backend/labora/core/config.py`
- Add `max_agent_iterations` (default: 15)

### 14. `frontend/src/components/ResearchDashboard.tsx`
- Add `'researchAgent'` to `activeLeftDoc` union type
- Add agent icon button in left sidebar
- Render `<ResearchAgentPanel />` when `activeLeftDoc === 'researchAgent'`

## Files NOT Changed

- `backend/labora/agent/deep_reader.py` — Used as-is
- `backend/labora/agent/paper_reader.py` — 保留作为 skim tool，代码不变
- `backend/labora/agent/research_workflow.py` — 保留作为参考，不再作为主要入口
- `backend/labora/api/routes/research.py` — Kept for backward compat
- `backend/labora/api/routes/deep_read.py` — Unchanged
- `backend/labora/api/routes/literature.py` — Unchanged
- `backend/labora/api/routes/papers.py` — Unchanged
- `backend/labora/tools/*.py` — Unchanged
- `backend/labora/memory/*.py` — Unchanged
- `backend/labora/services/*.py` — Unchanged

## Implementation Order

1. **prompts.py** — prompt templates (no dependencies)
2. **agent_store.py** — SQLite persistence (no dependencies)
3. **research_agent.py** — core agent graph (depends on 1, 2)
4. **agent/__init__.py** — update exports
5. **config.py** — add max_agent_iterations
6. **research_agent.py (API)** — REST endpoints (depends on 3)
7. **app.py** — mount router
8. **Frontend API client** — researchAgent.ts
9. **Frontend components** — AgentActionCard, AgentReflectionCard, LaTeXEditor, DocumentVersionHistory, ResearchAgentPanel
10. **ResearchDashboard.tsx** — integration

## Verification

1. `cd backend && python -m pytest tests/agent/test_research_agent.py -v` — unit tests for each node
2. Start backend: `cd backend && python main.py`
3. Start frontend: `cd frontend && npm run dev`
4. Manual test: enter research question → confirm search action → see papers found → confirm deep_read → see results → continue loop → finalize → verify LaTeX document with versions
5. Test rollback: edit document → create version → rollback to previous → verify content restored
6. Test error paths: reject action → verify agent generates alternative plan
