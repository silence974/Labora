"""
Research Agent REST API.

Provides endpoints for the interactive Plan-Act-Observe-Reflect agent loop.
The agent runs on LangGraph's interrupt mechanism — it stops at plan_node and
reflect_node waiting for user input, then resumes via /resume.
"""

import json
import logging
import queue
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Callable, Iterator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from labora.agent.research_agent import create_research_agent_graph
from labora.agent.deep_reader import run_deep_reading
from labora.persistence.agent_store import AgentStore
from labora.services.literature_library import LiteratureLibrary
from labora.core import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research-agent", tags=["research-agent"])

# ── In-memory graph cache ──────────────────────────────────────────────────────────
# Each agent run uses a shared compiled graph. The checkpointer is in-memory
# (MemorySaver), so all active threads share the same graph instance.
_graph = None
_store = None


def _get_graph():
    global _graph
    if _graph is None:
        _graph = create_research_agent_graph()
    return _graph


def _get_store() -> AgentStore:
    global _store
    if _store is None:
        _store = AgentStore(config.db_path)
    return _store


# ── Request/Response Models ────────────────────────────────────────────────────────


class StartRequest(BaseModel):
    research_question: str = Field(..., min_length=1, description="研究命题或问题")
    initial_direction: str = Field(default="", description="初始研究方向或想法")
    research_id: Optional[str] = Field(default=None, description="已有研究 ID；为空时创建新研究")


class CreateResearchRequest(BaseModel):
    title: str = Field(..., min_length=1, description="研究标题")
    research_question: str = Field(default="", description="研究问题")


class ReferenceAttachment(BaseModel):
    kind: str = "paper"
    label: str = ""
    href: str = ""
    paperId: Optional[str] = None
    paper_id: Optional[str] = None
    title: Optional[str] = None
    authors: list[str] = []
    year: Optional[str] = None
    abstract: Optional[str] = None


class ResumeRequest(BaseModel):
    user_response: str = Field(default="", description="用户对中断提示的回复")
    references: list[ReferenceAttachment] = Field(default_factory=list, description="随本次回复附加的可引用对象")


class RollbackRequest(BaseModel):
    version_index: int = Field(..., ge=0, description="要回退到的版本号")


class AgentStateResponse(BaseModel):
    task_id: str
    research_id: Optional[str] = None
    status: str  # running | interrupted | completed | failed
    interrupt_type: Optional[str] = None
    pending_prompt: Optional[str] = None
    research_question: str = ""
    initial_direction: str = ""
    document: str = ""
    document_versions: list[dict] = []
    current_version_index: int = 0
    literature_map: dict = {}
    reading_notes: dict = {}
    insights: list[str] = []
    open_questions: list[str] = []
    planned_action: Optional[dict] = None
    action_result: Optional[dict] = None
    reflection: Optional[dict] = None
    iteration_count: int = 0
    action_history: list[dict] = []
    nodes: list[dict] = []
    error: Optional[str] = None


class AgentResultResponse(BaseModel):
    task_id: str
    document: str
    document_versions: list[dict]
    literature_map: dict
    reading_notes: dict
    insights: list[str]
    iteration_count: int


class TaskListItem(BaseModel):
    task_id: str
    research_id: Optional[str] = None
    research_question: str
    status: str
    created_at: str
    updated_at: str


class ResearchListItem(BaseModel):
    research_id: str
    title: str
    research_question: str = ""
    document: str = ""
    status: str
    latest_task_id: Optional[str] = None
    session_count: int = 0
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_step_event(
    state: dict,
    label: str,
    description: str = "",
    *,
    status: str = "completed",
    detail: str = "",
    kind: str = "step",
    progress: Optional[int] = None,
) -> dict:
    step = {
        "label": label,
        "description": description,
        "status": status,
        "detail": detail,
        "kind": kind,
        "timestamp": _now_iso(),
    }
    if progress is not None:
        step["progress"] = progress
    state["step_events"] = [
        *[item for item in state.get("step_events", []) if isinstance(item, dict)],
        step,
    ]
    return step


def _persist_step_event(
    store: AgentStore,
    task_id: str,
    state: dict,
    label: str,
    description: str = "",
    *,
    status: str = "completed",
    detail: str = "",
    kind: str = "step",
    progress: Optional[int] = None,
) -> dict:
    step = _append_step_event(
        state,
        label,
        description,
        status=status,
        detail=detail,
        kind=kind,
        progress=progress,
    )
    return store.add_step_node(task_id, step)


def _state_to_response(
    task_id: str,
    state: dict,
    nodes: Optional[list[dict]] = None,
    research_id: Optional[str] = None,
) -> AgentStateResponse:
    """Convert internal agent state to API response model."""
    return AgentStateResponse(
        task_id=task_id,
        research_id=research_id or state.get("research_id"),
        status=state.get("status", "running"),
        interrupt_type=state.get("interrupt_type"),
        pending_prompt=state.get("pending_prompt"),
        research_question=state.get("research_question", ""),
        initial_direction=state.get("initial_direction", ""),
        document=state.get("document", ""),
        document_versions=state.get("document_versions", []),
        current_version_index=state.get("current_version_index", 0),
        literature_map=state.get("literature_map", {}),
        reading_notes=state.get("reading_notes", {}),
        insights=state.get("insights", []),
        open_questions=state.get("open_questions", []),
        planned_action=state.get("planned_action"),
        action_result=state.get("action_result"),
        reflection=state.get("reflection"),
        iteration_count=state.get("iteration_count", 0),
        action_history=state.get("action_history", []),
        nodes=nodes or state.get("nodes", []),
        error=state.get("error"),
    )


def _state_payload(
    task_id: str,
    state: dict,
    nodes: Optional[list[dict]] = None,
    research_id: Optional[str] = None,
) -> dict:
    return _state_to_response(
        task_id,
        state,
        nodes=nodes,
        research_id=research_id,
    ).model_dump()


def _json_line(event: str, **payload) -> str:
    return json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n"


def _format_json_block(value: object) -> str:
    return json.dumps(value or {}, ensure_ascii=False, indent=2)


def _format_planned_action(action: Optional[dict]) -> str:
    if not action:
        return "### Planned Action\n\nNo planned action was returned."

    return "\n\n".join([
        "### Planned Action",
        f"**Type:** `{action.get('type', '')}`",
        f"**Rationale:** {action.get('rationale') or 'None provided.'}",
        "**Params:**",
        "```json",
        _format_json_block(action.get("params", {})),
        "```",
    ])


def _format_agent_prompt(state: dict) -> tuple[str, Optional[list[dict]]]:
    if state.get("status") == "completed":
        return "### Research Completed\n\nDocument is ready.", None

    if state.get("interrupt_type") == "confirm_action":
        return _format_planned_action(state.get("planned_action")), [
            {"label": "Accept", "value": "confirm"},
            {"label": "Reject", "value": "reject"},
        ]

    if state.get("interrupt_type") == "continue_decision":
        reflection = state.get("reflection") or {}
        gaps = reflection.get("gaps") or []
        gap_text = "\n".join(f"- {gap}" for gap in gaps) if gaps else "- No major gaps reported."
        content = "\n\n".join([
            "### Progress Review",
            reflection.get("summary") or state.get("pending_prompt") or "The agent has reviewed the current progress.",
            "#### Gaps",
            gap_text,
            "#### Recommendation",
            reflection.get("recommendation") or "Continue or finalize this research session.",
        ])
        return content, [
            {"label": "Continue", "value": "continue"},
            {"label": "Finalize", "value": "done"},
        ]

    if state.get("interrupt_type") == "error_recovery" or state.get("error"):
        content = "\n\n".join([
            "### Agent Error",
            state.get("pending_prompt") or state.get("error") or "The last agent step failed.",
        ])
        return content, [
            {"label": "Retry", "value": "retry"},
            {"label": "Replan", "value": "replan"},
            {"label": "Finalize", "value": "done"},
        ]

    content = (
        f"### Agent Response\n\n{state.get('pending_prompt')}"
        if state.get("pending_prompt")
        else "### Agent Response\n\nWaiting for your response."
    )
    return content, None


def _start_message(request: StartRequest) -> str:
    parts = ["### Research Question", request.research_question]
    if request.initial_direction:
        parts.extend(["### Initial Direction", request.initial_direction])
    return "\n\n".join(parts)


def _research_title_from_question(question: str) -> str:
    title = " ".join(question.strip().split())
    if not title:
        return "Untitled Research"
    return title[:80]


def _response_message(user_response: str) -> str:
    label_map = {
        "confirm": "Accept this action",
        "done": "Finalize and finish",
        "continue": "Continue research",
        "retry": "Retry last step",
        "reject": "Reject this action",
        "replan": "Replan next step",
    }
    return label_map.get(user_response, user_response)


def _message_for_response(request: ResumeRequest) -> str:
    content = _response_message(request.user_response) if request.user_response else ""
    if content:
        return content
    if request.references:
        return f"附加了 {len(request.references)} 个可引用对象"
    return ""


def _reference_to_message_payload(reference: ReferenceAttachment) -> dict:
    return {
        "kind": reference.kind,
        "label": reference.label,
        "href": reference.href,
        "paperId": reference.paperId or reference.paper_id,
        "title": reference.title,
        "authors": reference.authors,
        "year": reference.year,
        "abstract": reference.abstract,
    }


def _normalize_paper_id(value: str) -> str:
    return value.replace("arxiv:", "").strip()


def _extract_reference_paper_id(reference: ReferenceAttachment) -> str:
    explicit_id = reference.paperId or reference.paper_id
    if explicit_id:
        return _normalize_paper_id(explicit_id)

    match = re.search(
        r"arxiv\.org/(?:abs|pdf|html|e-print)/([A-Za-z.-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?",
        reference.href,
    )
    return _normalize_paper_id(match.group(1)) if match else ""


def _load_existing_deep_read(paper_id: str) -> Optional[dict]:
    try:
        import sqlite3

        with sqlite3.connect(config.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM deep_read_results WHERE paper_id = ? AND status = 'completed'",
                (paper_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "paper_title": row["paper_title"],
            "stages": json.loads(row["stages"] or "{}"),
        }
    except Exception:
        logger.debug("Failed to load existing deep read result for %s", paper_id, exc_info=True)
        return None


def _save_reference_deep_read(
    paper_id: str,
    paper_title: str,
    stages: dict,
    *,
    status: str = "completed",
    progress: int = 100,
    current_stage: int = 3,
    task_id: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    try:
        import sqlite3

        now = _now_iso()
        with sqlite3.connect(config.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS deep_read_results (
                    paper_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    paper_title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    current_stage INTEGER NOT NULL DEFAULT 0,
                    stages TEXT NOT NULL DEFAULT '{}',
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO deep_read_results (
                    paper_id, task_id, paper_title, status, progress,
                    current_stage, stages, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                    task_id = excluded.task_id,
                    paper_title = excluded.paper_title,
                    status = excluded.status,
                    progress = excluded.progress,
                    current_stage = excluded.current_stage,
                    stages = excluded.stages,
                    error = excluded.error,
                    updated_at = excluded.updated_at
                """,
                (
                    paper_id,
                    task_id or f"agent-ref-{uuid.uuid4().hex[:12]}",
                    paper_title,
                    status,
                    progress,
                    current_stage,
                    json.dumps(stages, ensure_ascii=False),
                    error,
                    now,
                    now,
                ),
            )
            conn.commit()
    except Exception:
        logger.debug("Failed to save reference deep read result for %s", paper_id, exc_info=True)


def _load_paper_text(paper_id: str, abstract: str = "") -> str:
    try:
        from labora.tools.latex_parser import parse_latex_from_arxiv

        sections = parse_latex_from_arxiv.invoke({"arxiv_id": paper_id})
        if sections:
            return "\n\n".join(sections.values())
    except Exception:
        logger.debug("Failed to parse LaTeX for referenced paper %s", paper_id, exc_info=True)
    return abstract


def _attach_reference_context(
    state: dict,
    references: list[ReferenceAttachment],
    on_step: Optional[Callable[[str, str, str, str, Optional[int]], None]] = None,
) -> dict:
    if not references:
        return state

    next_state = dict(state)
    literature_map = dict(next_state.get("literature_map") or {})
    reading_notes = dict(next_state.get("reading_notes") or {})
    insights = list(next_state.get("insights") or [])
    action_history = list(next_state.get("action_history") or [])
    library = LiteratureLibrary()

    for reference in references:
        paper_id = _extract_reference_paper_id(reference)
        if not paper_id:
            open_questions = list(next_state.get("open_questions") or [])
            note = f"User attached reference link: {reference.label or reference.href} ({reference.href})"
            if note not in open_questions:
                open_questions.append(note)
            next_state["open_questions"] = open_questions
            continue

        library_paper = library.get_paper(paper_id) or {}
        existing_meta = literature_map.get(paper_id, {})
        paper_title = (
            reference.title
            or reference.label
            or library_paper.get("title")
            or existing_meta.get("title")
            or paper_id
        )
        authors = reference.authors or library_paper.get("authors") or existing_meta.get("authors") or []
        abstract = reference.abstract or library_paper.get("abstract") or existing_meta.get("abstract") or ""
        year = reference.year or library_paper.get("year") or existing_meta.get("year") or ""

        existing_deep_read = _load_existing_deep_read(paper_id)
        if existing_deep_read:
            stages = existing_deep_read.get("stages") or {}
            paper_title = existing_deep_read.get("paper_title") or paper_title
            if on_step:
                on_step(
                    "Run: attach reference",
                    f"Loaded existing deep-read result for {paper_id}.",
                    "completed",
                    "",
                    100,
                )
        else:
            reference_task_id = f"agent-ref-{uuid.uuid4().hex[:12]}"
            if on_step:
                on_step(
                    "Run: load reference paper",
                    f"Loading source text for {paper_id}.",
                    "completed",
                    "",
                    0,
                )
            paper_text = _load_paper_text(paper_id, abstract)
            _save_reference_deep_read(
                paper_id,
                paper_title,
                {},
                status="running",
                progress=0,
                current_stage=0,
                task_id=reference_task_id,
            )
            reference_stages: dict = {}

            def handle_progress(progress: int, stage: int, stage_result) -> None:
                stage_payload = (
                    stage_result.model_dump()
                    if hasattr(stage_result, "model_dump")
                    else stage_result
                )
                if stage_payload is not None:
                    reference_stages[str(stage)] = stage_payload
                stage_complete_progress = {1: 30, 2: 65, 3: 100}.get(stage, 100)
                _save_reference_deep_read(
                    paper_id,
                    paper_title,
                    reference_stages,
                    status="running",
                    progress=progress,
                    current_stage=stage,
                    task_id=reference_task_id,
                )
                if on_step:
                    on_step(
                        f"Run: reference deep read stage {stage}",
                        f"Reading reference {paper_id}: stage {stage} progress {progress}%.",
                        "completed" if progress >= stage_complete_progress else "active",
                        json.dumps(stage_payload, ensure_ascii=False, indent=2) if stage_payload is not None else "",
                        progress,
                    )

            if on_step:
                on_step(
                    "Run: deep read reference",
                    f"Deep reading attached paper {paper_id}.",
                    "active",
                    "",
                    0,
                )
            result = run_deep_reading(
                paper_id=f"arxiv:{paper_id}",
                paper_text=paper_text or abstract,
                paper_title=paper_title,
                on_progress=handle_progress,
            )
            stages = result.get("stages", {})
            _save_reference_deep_read(
                paper_id,
                paper_title,
                stages,
                status="completed",
                progress=100,
                current_stage=3,
                task_id=reference_task_id,
            )

        literature_map[paper_id] = {
            **existing_meta,
            "title": paper_title,
            "year": year,
            "authors": authors[:5] if isinstance(authors, list) else [str(authors)],
            "abstract": abstract[:500],
            "status": "deep_read",
        }
        reading_notes[paper_id] = {
            "stages": stages,
            "read_level": "deep",
            "source": "conversation_reference",
        }

        stage1 = stages.get("1", {}) if isinstance(stages, dict) else {}
        if isinstance(stage1, dict):
            core = stage1.get("core_insight") or stage1.get("tl_dr")
            if core:
                insight = f"[{paper_id}] {core}"
                if insight not in insights:
                    insights.append(insight)

        action_history.append({
            "type": "reference_context",
            "paper_id": paper_id,
            "rationale": "User attached this paper to the conversation.",
        })

    next_state["literature_map"] = literature_map
    next_state["reading_notes"] = reading_notes
    next_state["insights"] = insights
    next_state["action_history"] = action_history
    return next_state


def _save_assistant_prompt(store: AgentStore, task_id: str, state: dict) -> None:
    content, actions = _format_agent_prompt(state)
    store.add_message_node(task_id, "assistant", content, actions)


def _persist_state_snapshot(store: AgentStore, task_id: str, state: dict) -> None:
    document = state.get("document", "")
    versions = state.get("document_versions", [])
    task = store.get_task(task_id) or {}
    research_id = task.get("research_id") or state.get("research_id")
    if research_id and document:
        store.update_research_document(research_id, document)
    if document and versions:
        latest = versions[-1]
        store.save_version(
            task_id, document,
            description=latest.get("description", "Update"),
            edit_type=latest.get("edit_type", "snapshot"),
        )
    store.update_task(task_id, state.get("status", "running"))
    store.save_state_snapshot(task_id, state)


def _persist_missing_step_events(store: AgentStore, task_id: str, state: dict) -> None:
    existing_count = len([
        node for node in store.get_nodes(task_id)
        if isinstance(node.get("payload"), dict) and node["payload"].get("step")
    ])
    step_events = [
        step
        for step in state.get("step_events", [])
        if isinstance(step, dict)
    ]
    for step in step_events[existing_count:]:
        store.add_step_node(task_id, step)


def _persist_error_snapshot(
    store: AgentStore,
    task_id: str,
    task: dict,
    error: Exception,
) -> dict:
    previous_state = store.get_state_snapshot(task_id) or {}
    error_text = str(error)
    state = {
        **previous_state,
        "status": "interrupted",
        "interrupt_type": "error_recovery",
        "pending_prompt": (
            f"上一步执行失败:\n{error_text}\n\n"
            "你可以输入 retry（重试）、replan（重新规划）、done（结束），"
            "或直接输入自然语言继续引导。"
        ),
        "error": error_text,
        "research_question": previous_state.get("research_question") or task.get("research_question", ""),
        "initial_direction": previous_state.get("initial_direction") or task.get("initial_direction", ""),
        "thread_id": previous_state.get("thread_id") or task.get("thread_id"),
    }
    store.update_task(task_id, "interrupted")
    store.save_state_snapshot(task_id, state)
    return state


def _get_state_from_graph_or_store(
    graph,
    config_dict: dict,
    store: AgentStore,
    task_id: str,
) -> dict:
    try:
        graph_state = graph.get_state(config_dict)
        if graph_state is not None and graph_state.values:
            return dict(graph_state.values)
    except Exception:
        logger.debug("Graph state unavailable for task %s, falling back to store", task_id)

    state = store.get_state_snapshot(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="State not found")
    return state


def _get_live_graph_state(graph, config_dict: dict) -> dict:
    graph_state = graph.get_state(config_dict)
    if graph_state is None or not graph_state.values:
        raise HTTPException(
            status_code=409,
            detail="Agent runtime state is not active; historical conversation can be viewed but cannot be resumed.",
        )
    return dict(graph_state.values)


def _infer_interrupt_node(state: dict) -> Optional[str]:
    interrupt_type = state.get("interrupt_type")
    if interrupt_type == "confirm_action":
        return "confirm_action_node"
    if interrupt_type in {"continue_decision", "error_recovery"}:
        return "reflect_node"
    if interrupt_type == "user_question":
        return "act_ask_user"
    if state.get("status") == "interrupted":
        return "reflect_node"
    return None


def _upgrade_snapshot_to_resumable_error_state(
    store: AgentStore,
    task_id: str,
    snapshot: dict,
) -> dict:
    if _infer_interrupt_node(snapshot):
        return snapshot

    error_text = str(snapshot.get("error") or "").strip()
    if snapshot.get("status") == "failed" or error_text:
        task = store.get_task(task_id) or {}
        return _persist_error_snapshot(
            store,
            task_id,
            task,
            RuntimeError(error_text or "Unknown agent error"),
        )

    return snapshot


def _get_resume_state(
    graph,
    config_dict: dict,
    store: AgentStore,
    task_id: str,
) -> tuple[dict, Optional[str]]:
    try:
        return _get_live_graph_state(graph, config_dict), None
    except HTTPException:
        snapshot = store.get_state_snapshot(task_id)
        if not snapshot:
            raise

        snapshot = _upgrade_snapshot_to_resumable_error_state(store, task_id, snapshot)
        interrupt_node = _infer_interrupt_node(snapshot)
        if not interrupt_node:
            raise HTTPException(
                status_code=409,
                detail="Agent runtime state is not active and the stored snapshot is not resumable.",
            )
        return snapshot, interrupt_node


def _node_message(node_name: str, state: dict) -> str:
    if node_name == "init_node":
        return "Created the initial document skeleton."
    if node_name == "plan_node":
        action = state.get("planned_action", {})
        action_type = action.get("type")
        return f"Planned next action: {action_type}." if action_type else "Planned the next action."
    if node_name == "confirm_action_node":
        return "Waiting for confirmation before running this action."
    if node_name.startswith("act_"):
        result = state.get("action_result", {})
        action = result.get("action") or node_name.removeprefix("act_")
        return f"Finished action: {action}."
    if node_name == "observe_node":
        return "Updated the research context."
    if node_name == "reflect_node":
        return "Generated a progress review."
    if node_name == "finalize_node":
        return "Finalized the research document."
    return f"Completed {node_name}."


def _stream_graph_run(
    *,
    graph,
    task_id: str,
    config_dict: dict,
    input_state: Optional[dict],
    base_state: Optional[dict] = None,
    store: AgentStore,
) -> Iterator[str]:
    running_state = dict(base_state or input_state or {})
    persisted_step_count = len(running_state.get("step_events", []) or [])
    for update in graph.stream(input_state, config_dict, stream_mode="updates"):
        if "__interrupt__" in update:
            continue
        for node_name, node_state in update.items():
            if not isinstance(node_state, dict):
                continue
            running_state.update(node_state)
            step_events = running_state.get("step_events", []) or []
            for step in step_events[persisted_step_count:]:
                node_payload = store.add_step_node(task_id, step)
                yield _json_line("node", node=node_payload)
            persisted_step_count = len(step_events)

            payload = {
                "node": node_name,
                "message": _node_message(node_name, running_state),
                "state": _state_payload(
                    task_id,
                    running_state,
                    nodes=store.get_nodes(task_id),
                ),
            }
            action_result = running_state.get("action_result")
            if node_name.startswith("act_") and action_result:
                payload["action_result"] = action_result
            yield _json_line("state", **payload)


# ── Endpoints ──────────────────────────────────────────────────────────────────────


@router.get("/researches")
async def list_researches():
    """List research report containers."""
    store = _get_store()
    return {"researches": store.list_researches()}


@router.post("/researches")
async def create_research(request: CreateResearchRequest):
    """Create an empty research report container."""
    store = _get_store()
    research_id = store.create_research(
        title=request.title,
        research_question=request.research_question,
    )
    research = store.get_research(research_id)
    return {"research": research}


@router.get("/researches/{research_id}/sessions")
async def list_research_sessions(research_id: str):
    """List agent sessions under one research."""
    store = _get_store()
    if store.get_research(research_id) is None:
        raise HTTPException(status_code=404, detail="Research not found")
    return {"sessions": store.list_research_tasks(research_id)}


@router.post("/sessions/{task_id}/clear")
async def clear_session(task_id: str):
    """Clear one session's conversation/runtime history without deleting the report."""
    store = _get_store()
    if store.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    store.clear_task_session(task_id)
    return {"task_id": task_id, "status": "cleared"}


@router.delete("/sessions/{task_id}")
async def delete_session(task_id: str):
    """Delete one session from the sidebar without deleting the report."""
    store = _get_store()
    if store.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    store.delete_task_session(task_id)
    return {"task_id": task_id, "status": "deleted"}


@router.post("/start", response_model=AgentStateResponse)
async def start_agent(request: StartRequest):
    """Start a new research agent run.

    The agent initializes the research context and document skeleton,
    then stops at the first plan interrupt, returning a proposed action
    for user confirmation.
    """
    store = _get_store()
    graph = _get_graph()
    thread_id = uuid.uuid4().hex[:12]
    config_dict = {"configurable": {"thread_id": thread_id}}
    research_id = request.research_id
    if research_id and store.get_research(research_id) is None:
        raise HTTPException(status_code=404, detail="Research not found")
    if research_id is None:
        research_id = store.create_research(
            title=_research_title_from_question(request.research_question),
            research_question=request.research_question,
        )
    task_id = store.create_task(
        research_question=request.research_question,
        initial_direction=request.initial_direction,
        thread_id=thread_id,
        research_id=research_id,
    )
    store.add_message_node(task_id, "user", _start_message(request))

    try:
        state = graph.invoke({
            "research_question": request.research_question,
            "initial_direction": request.initial_direction,
        }, config_dict)
    except Exception as e:
        logger.exception("Failed to start agent")
        error_state = _persist_error_snapshot(store, task_id, store.get_task(task_id) or {}, e)
        _save_assistant_prompt(store, task_id, error_state)
        raise HTTPException(status_code=500, detail=str(e))

    state["thread_id"] = thread_id
    state["research_id"] = research_id

    _persist_state_snapshot(store, task_id, state)
    _persist_missing_step_events(store, task_id, state)
    _save_assistant_prompt(store, task_id, state)

    return _state_to_response(
        task_id,
        state,
        nodes=store.get_nodes(task_id),
        research_id=research_id,
    )


@router.post("/start/stream")
async def start_agent_stream(request: StartRequest):
    store = _get_store()
    graph = _get_graph()
    thread_id = uuid.uuid4().hex[:12]
    research_id = request.research_id
    if research_id and store.get_research(research_id) is None:
        raise HTTPException(status_code=404, detail="Research not found")
    if research_id is None:
        research_id = store.create_research(
            title=_research_title_from_question(request.research_question),
            research_question=request.research_question,
        )
    task_id = store.create_task(
        research_question=request.research_question,
        initial_direction=request.initial_direction,
        thread_id=thread_id,
        research_id=research_id,
    )
    store.add_message_node(task_id, "user", _start_message(request))
    config_dict = {"configurable": {"thread_id": thread_id}}
    initial_state = {
        "research_question": request.research_question,
        "initial_direction": request.initial_direction,
        "research_id": research_id,
    }

    def events() -> Iterator[str]:
        yield _json_line("status", task_id=task_id, research_id=research_id, message="Starting research agent.")
        try:
            yield from _stream_graph_run(
                graph=graph,
                task_id=task_id,
                config_dict=config_dict,
                input_state=initial_state,
                store=store,
            )
            graph_state = graph.get_state(config_dict)
            state = dict(graph_state.values or {})
            state["thread_id"] = thread_id
            state["research_id"] = research_id
            _persist_state_snapshot(store, task_id, state)
            _save_assistant_prompt(store, task_id, state)
            yield _json_line(
                "final",
                state=_state_payload(
                    task_id,
                    state,
                    nodes=store.get_nodes(task_id),
                    research_id=research_id,
                ),
            )
        except Exception as e:
            logger.exception("Failed to stream agent start")
            error_state = _persist_error_snapshot(store, task_id, store.get_task(task_id) or {}, e)
            _save_assistant_prompt(store, task_id, error_state)
            yield _json_line(
                "error",
                task_id=task_id,
                research_id=research_id,
                message=str(e),
                state=_state_payload(
                    task_id,
                    error_state,
                    nodes=store.get_nodes(task_id),
                    research_id=research_id,
                ),
            )

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.post("/{task_id}/resume", response_model=AgentStateResponse)
async def resume_agent_endpoint(task_id: str, request: ResumeRequest):
    """Resume a paused agent with the user's response.

    The agent continues from the interrupt point and runs until the next
    interrupt (plan_node or reflect_node) or until completion.
    """
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    thread_id = task.get("thread_id", task_id)
    research_id = task.get("research_id")
    graph = _get_graph()

    config_dict = {"configurable": {"thread_id": thread_id}}

    try:
        live_state, resume_from_node = _get_resume_state(graph, config_dict, store, task_id)
        update_state = {}
        message = _message_for_response(request)
        if message:
            store.add_message_node(
                task_id,
                "user",
                message,
                references=[_reference_to_message_payload(item) for item in request.references],
            )
        if request.references:
            _persist_step_event(
                store,
                task_id,
                live_state,
                "Run: deep read attached references",
                f"Preparing {len(request.references)} attached reference(s) for agent context.",
                status="active",
                progress=0,
            )
            _persist_state_snapshot(store, task_id, {**live_state, "status": "running"})

            def persist_reference_step(
                label: str,
                description: str,
                status: str,
                detail: str,
                progress: Optional[int] = None,
            ) -> None:
                _persist_step_event(
                    store,
                    task_id,
                    live_state,
                    label,
                    description,
                    status=status,
                    detail=detail,
                    progress=progress,
                )

            live_state = _attach_reference_context(
                live_state,
                request.references,
                on_step=persist_reference_step,
            )
            _persist_step_event(
                store,
                task_id,
                live_state,
                "Run: attach references",
                f"Attached {len(request.references)} reference(s) to agent context.",
                progress=100,
            )
            update_state.update(live_state)
        if request.user_response:
            update_state["user_response"] = request.user_response
        if resume_from_node:
            graph.update_state(
                config_dict,
                {**live_state, **update_state},
                as_node=resume_from_node,
            )
        elif update_state:
            graph.update_state(config_dict, update_state)
        state = graph.invoke(None, config_dict)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to resume agent")
        error_state = _persist_error_snapshot(store, task_id, task, e)
        _save_assistant_prompt(store, task_id, error_state)
        raise HTTPException(status_code=500, detail=str(e))

    _persist_state_snapshot(store, task_id, state)
    _persist_missing_step_events(store, task_id, state)
    _save_assistant_prompt(store, task_id, state)

    return _state_to_response(
        task_id,
        state,
        nodes=store.get_nodes(task_id),
        research_id=research_id,
    )


@router.post("/{task_id}/resume/stream")
async def resume_agent_stream(task_id: str, request: ResumeRequest):
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    thread_id = task.get("thread_id", task_id)
    research_id = task.get("research_id")
    graph = _get_graph()
    config_dict = {"configurable": {"thread_id": thread_id}}

    try:
        base_state, resume_from_node = _get_resume_state(graph, config_dict, store, task_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get state before streaming resume")
        raise HTTPException(status_code=500, detail=str(e))

    update_state = {}
    message = _message_for_response(request)
    if message:
        store.add_message_node(
            task_id,
            "user",
            message,
            references=[_reference_to_message_payload(item) for item in request.references],
        )
    if request.user_response:
        update_state["user_response"] = request.user_response
        base_state["user_response"] = request.user_response

    initial_reference_event = None
    if request.references:
        initial_reference_event = _persist_step_event(
            store,
            task_id,
            base_state,
            "Run: deep read attached references",
            f"Preparing {len(request.references)} attached reference(s) for agent context.",
            status="active",
            detail=json.dumps(
                [_reference_to_message_payload(item) for item in request.references],
                ensure_ascii=False,
                indent=2,
            ),
            progress=0,
        )
        base_state["status"] = "running"
        store.update_task(task_id, "running")
        store.save_state_snapshot(task_id, base_state)

    def events() -> Iterator[str]:
        yield _json_line("status", task_id=task_id, research_id=research_id, message="Resuming research agent.")
        try:
            if initial_reference_event:
                yield _json_line("node", node=initial_reference_event)
            if request.references:
                reference_queue: queue.Queue[tuple[str, object]] = queue.Queue()

                def persist_reference_step(
                    label: str,
                    description: str,
                    status: str,
                    detail: str,
                    progress: Optional[int] = None,
                ) -> None:
                    event = _persist_step_event(
                        store,
                        task_id,
                        base_state,
                        label,
                        description,
                        status=status,
                        detail=detail,
                        progress=progress,
                    )
                    reference_queue.put(("node", event))

                def attach_references_worker() -> None:
                    try:
                        enriched_state = _attach_reference_context(
                            base_state,
                            request.references,
                            on_step=persist_reference_step,
                        )
                        reference_queue.put(("state", enriched_state))
                    except Exception as exc:
                        reference_queue.put(("error", exc))
                    finally:
                        reference_queue.put(("done", None))

                worker = threading.Thread(target=attach_references_worker, daemon=True)
                worker.start()
                enriched_state = None
                while True:
                    event_type, payload = reference_queue.get()
                    if event_type == "node":
                        yield _json_line("node", node=payload)
                    elif event_type == "state":
                        enriched_state = payload
                    elif event_type == "error":
                        raise payload
                    elif event_type == "done":
                        break
                worker.join()
                if not isinstance(enriched_state, dict):
                    raise RuntimeError("Reference context attachment did not produce agent state")
                base_state.update(enriched_state)
                update_state.update(enriched_state)
                _persist_state_snapshot(store, task_id, base_state)
                completed_reference_event = _persist_step_event(
                    store,
                    task_id,
                    base_state,
                    "Run: attach references",
                    f"Attached {len(request.references)} reference(s) to agent context.",
                    status="completed",
                    progress=100,
                )
                yield _json_line("node", node=completed_reference_event)
            if resume_from_node:
                graph.update_state(
                    config_dict,
                    {**base_state, **update_state},
                    as_node=resume_from_node,
                )
            elif update_state:
                graph.update_state(config_dict, update_state)
            yield from _stream_graph_run(
                graph=graph,
                task_id=task_id,
                config_dict=config_dict,
                input_state=None,
                base_state=base_state,
                store=store,
            )
            graph_state = graph.get_state(config_dict)
            state = dict(graph_state.values or {})
            state["thread_id"] = thread_id
            state["research_id"] = research_id
            _persist_state_snapshot(store, task_id, state)
            _save_assistant_prompt(store, task_id, state)
            yield _json_line(
                "final",
                state=_state_payload(
                    task_id,
                    state,
                    nodes=store.get_nodes(task_id),
                    research_id=research_id,
                ),
            )
        except Exception as e:
            logger.exception("Failed to stream agent resume")
            error_state = _persist_error_snapshot(store, task_id, task, e)
            _save_assistant_prompt(store, task_id, error_state)
            yield _json_line(
                "error",
                task_id=task_id,
                research_id=research_id,
                message=str(e),
                state=_state_payload(
                    task_id,
                    error_state,
                    nodes=store.get_nodes(task_id),
                    research_id=research_id,
                ),
            )

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.get("/{task_id}/state", response_model=AgentStateResponse)
async def get_agent_state(task_id: str):
    """Get the current state of an agent run."""
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    thread_id = task.get("thread_id", task_id)
    research_id = task.get("research_id")
    graph = _get_graph()

    try:
        config_dict = {"configurable": {"thread_id": thread_id}}
        stored_snapshot = store.get_state_snapshot(task_id)
        if (
            task.get("status") == "running"
            and stored_snapshot
            and stored_snapshot.get("status") == "running"
        ):
            state_dict = stored_snapshot
        else:
            state_dict = _get_state_from_graph_or_store(graph, config_dict, store, task_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get agent state")
        raise HTTPException(status_code=500, detail=str(e))

    return _state_to_response(
        task_id,
        state_dict,
        nodes=store.get_nodes(task_id),
        research_id=research_id,
    )


@router.get("/{task_id}/result", response_model=AgentResultResponse)
async def get_agent_result(task_id: str):
    """Get the final research document and metadata."""
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Agent has not completed yet")

    thread_id = task.get("thread_id", task_id)
    graph = _get_graph()

    try:
        config_dict = {"configurable": {"thread_id": thread_id}}
        state_dict = _get_state_from_graph_or_store(graph, config_dict, store, task_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get agent result")
        raise HTTPException(status_code=500, detail=str(e))

    return AgentResultResponse(
        task_id=task_id,
        document=state_dict.get("document", ""),
        document_versions=state_dict.get("document_versions", []),
        literature_map=state_dict.get("literature_map", {}),
        reading_notes=state_dict.get("reading_notes", {}),
        insights=state_dict.get("insights", []),
        iteration_count=state_dict.get("iteration_count", 0),
    )


@router.post("/{task_id}/rollback")
async def rollback_document(task_id: str, request: RollbackRequest):
    """Rollback to a previous document version.

    Creates a new version that copies the target version's content.
    """
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    target = store.get_version(task_id, request.version_index)
    if target is None:
        raise HTTPException(status_code=404, detail="Version not found")

    thread_id = task.get("thread_id", task_id)
    graph = _get_graph()

    try:
        config_dict = {"configurable": {"thread_id": thread_id}}

        # Update the document in the live state
        graph.update_state(config_dict, {
            "document": target["content"],
            "current_version_index": request.version_index,
        })

        # Save rollback as a new version
        new_index = store.save_version(
            task_id,
            target["content"],
            description=f"Rollback to version {request.version_index}",
            edit_type="rollback",
        )

        # Also update the state with the new version index
        graph.update_state(config_dict, {
            "current_version_index": new_index,
        })

    except Exception as e:
        logger.exception("Failed to rollback")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "task_id": task_id,
        "document": target["content"],
        "current_version_index": new_index,
    }


@router.get("/")
async def list_agent_tasks():
    """List all research agent tasks."""
    store = _get_store()
    tasks = store.list_tasks()
    return {"tasks": tasks}
