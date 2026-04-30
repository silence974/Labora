"""
Research Agent REST API.

Provides endpoints for the interactive Plan-Act-Observe-Reflect agent loop.
The agent runs on LangGraph's interrupt mechanism — it stops at plan_node and
reflect_node waiting for user input, then resumes via /resume.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from labora.agent.research_agent import create_research_agent_graph, run_agent, resume_agent
from labora.persistence.agent_store import AgentStore
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


class ResumeRequest(BaseModel):
    user_response: str = Field(default="", description="用户对中断提示的回复")


class RollbackRequest(BaseModel):
    version_index: int = Field(..., ge=0, description="要回退到的版本号")


class AgentStateResponse(BaseModel):
    task_id: str
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
    research_question: str
    status: str
    created_at: str
    updated_at: str


def _state_to_response(task_id: str, state: dict) -> AgentStateResponse:
    """Convert internal agent state to API response model."""
    return AgentStateResponse(
        task_id=task_id,
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
        error=state.get("error"),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────────


@router.post("/start", response_model=AgentStateResponse)
async def start_agent(request: StartRequest):
    """Start a new research agent run.

    The agent initializes the research context and document skeleton,
    then stops at the first plan interrupt, returning a proposed action
    for user confirmation.
    """
    store = _get_store()
    graph = _get_graph()

    try:
        state = run_agent(
            research_question=request.research_question,
            initial_direction=request.initial_direction,
        )
    except Exception as e:
        logger.exception("Failed to start agent")
        raise HTTPException(status_code=500, detail=str(e))

    thread_id = state.get("thread_id", "")
    task_id = store.create_task(
        research_question=request.research_question,
        initial_direction=request.initial_direction,
        thread_id=thread_id,
    )

    # Save initial document version
    document = state.get("document", "")
    versions = state.get("document_versions", [])
    if document and versions:
        store.save_version(
            task_id, document,
            description=versions[-1].get("description", "Initial"),
            edit_type=versions[-1].get("edit_type", "init"),
        )

    return _state_to_response(task_id, state)


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
    graph = _get_graph()

    try:
        state = resume_agent(graph, thread_id, request.user_response)
    except Exception as e:
        logger.exception("Failed to resume agent")
        store.update_task(task_id, "failed")
        raise HTTPException(status_code=500, detail=str(e))

    # Persist document versions
    document = state.get("document", "")
    versions = state.get("document_versions", [])
    if document and versions:
        latest = versions[-1]
        store.save_version(
            task_id, document,
            description=latest.get("description", "Update"),
            edit_type=latest.get("edit_type", "snapshot"),
        )

    status = state.get("status", "running")
    store.update_task(task_id, status)

    return _state_to_response(task_id, state)


@router.get("/{task_id}/state", response_model=AgentStateResponse)
async def get_agent_state(task_id: str):
    """Get the current state of an agent run."""
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    thread_id = task.get("thread_id", task_id)
    graph = _get_graph()

    try:
        config_dict = {"configurable": {"thread_id": thread_id}}
        state = graph.get_state(config_dict)
        if state is None or state.values is None:
            raise HTTPException(status_code=404, detail="State not found")
        state_dict = dict(state.values)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get agent state")
        raise HTTPException(status_code=500, detail=str(e))

    return _state_to_response(task_id, state_dict)


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
        state = graph.get_state(config_dict)
        if state is None or state.values is None:
            raise HTTPException(status_code=404, detail="State not found")
        state_dict = dict(state.values)
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
