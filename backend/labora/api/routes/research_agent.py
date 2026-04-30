"""
Research Agent REST API.

Provides endpoints for the interactive Plan-Act-Observe-Reflect agent loop.
The agent runs on LangGraph's interrupt mechanism — it stops at plan_node and
reflect_node waiting for user input, then resumes via /resume.
"""

import json
import logging
import uuid
from typing import Iterator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from labora.agent.research_agent import create_research_agent_graph
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


def _state_payload(task_id: str, state: dict) -> dict:
    return _state_to_response(task_id, state).model_dump()


def _json_line(event: str, **payload) -> str:
    return json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n"


def _persist_state_snapshot(store: AgentStore, task_id: str, state: dict) -> None:
    document = state.get("document", "")
    versions = state.get("document_versions", [])
    if document and versions:
        latest = versions[-1]
        store.save_version(
            task_id, document,
            description=latest.get("description", "Update"),
            edit_type=latest.get("edit_type", "snapshot"),
        )
    store.update_task(task_id, state.get("status", "running"))


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
) -> Iterator[str]:
    running_state = dict(base_state or input_state or {})
    for update in graph.stream(input_state, config_dict, stream_mode="updates"):
        if "__interrupt__" in update:
            continue
        for node_name, node_state in update.items():
            if not isinstance(node_state, dict):
                continue
            running_state.update(node_state)
            payload = {
                "node": node_name,
                "message": _node_message(node_name, running_state),
                "state": _state_payload(task_id, running_state),
            }
            action_result = running_state.get("action_result")
            if node_name.startswith("act_") and action_result:
                payload["action_result"] = action_result
            yield _json_line("state", **payload)


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
    thread_id = uuid.uuid4().hex[:12]
    config_dict = {"configurable": {"thread_id": thread_id}}

    try:
        state = graph.invoke({
            "research_question": request.research_question,
            "initial_direction": request.initial_direction,
        }, config_dict)
    except Exception as e:
        logger.exception("Failed to start agent")
        raise HTTPException(status_code=500, detail=str(e))

    task_id = store.create_task(
        research_question=request.research_question,
        initial_direction=request.initial_direction,
        thread_id=thread_id,
    )
    state["thread_id"] = thread_id

    _persist_state_snapshot(store, task_id, state)

    return _state_to_response(task_id, state)


@router.post("/start/stream")
async def start_agent_stream(request: StartRequest):
    store = _get_store()
    graph = _get_graph()
    thread_id = uuid.uuid4().hex[:12]
    task_id = store.create_task(
        research_question=request.research_question,
        initial_direction=request.initial_direction,
        thread_id=thread_id,
    )
    config_dict = {"configurable": {"thread_id": thread_id}}
    initial_state = {
        "research_question": request.research_question,
        "initial_direction": request.initial_direction,
    }

    def events() -> Iterator[str]:
        yield _json_line("status", task_id=task_id, message="Starting research agent.")
        try:
            yield from _stream_graph_run(
                graph=graph,
                task_id=task_id,
                config_dict=config_dict,
                input_state=initial_state,
            )
            graph_state = graph.get_state(config_dict)
            state = dict(graph_state.values or {})
            state["thread_id"] = thread_id
            _persist_state_snapshot(store, task_id, state)
            yield _json_line("final", state=_state_payload(task_id, state))
        except Exception as e:
            logger.exception("Failed to stream agent start")
            store.update_task(task_id, "failed")
            yield _json_line("error", task_id=task_id, message=str(e))

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
    graph = _get_graph()

    config_dict = {"configurable": {"thread_id": thread_id}}

    try:
        if request.user_response:
            graph.update_state(config_dict, {"user_response": request.user_response})
        state = graph.invoke(None, config_dict)
    except Exception as e:
        logger.exception("Failed to resume agent")
        store.update_task(task_id, "failed")
        raise HTTPException(status_code=500, detail=str(e))

    _persist_state_snapshot(store, task_id, state)

    return _state_to_response(task_id, state)


@router.post("/{task_id}/resume/stream")
async def resume_agent_stream(task_id: str, request: ResumeRequest):
    store = _get_store()
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    thread_id = task.get("thread_id", task_id)
    graph = _get_graph()
    config_dict = {"configurable": {"thread_id": thread_id}}

    try:
        graph_state = graph.get_state(config_dict)
        base_state = dict(graph_state.values or {})
    except Exception as e:
        logger.exception("Failed to get state before streaming resume")
        raise HTTPException(status_code=500, detail=str(e))

    def events() -> Iterator[str]:
        yield _json_line("status", task_id=task_id, message="Resuming research agent.")
        try:
            if request.user_response:
                graph.update_state(config_dict, {"user_response": request.user_response})
                base_state["user_response"] = request.user_response
            yield from _stream_graph_run(
                graph=graph,
                task_id=task_id,
                config_dict=config_dict,
                input_state=None,
                base_state=base_state,
            )
            graph_state = graph.get_state(config_dict)
            state = dict(graph_state.values or {})
            state["thread_id"] = thread_id
            _persist_state_snapshot(store, task_id, state)
            yield _json_line("final", state=_state_payload(task_id, state))
        except Exception as e:
            logger.exception("Failed to stream agent resume")
            store.update_task(task_id, "failed")
            yield _json_line("error", task_id=task_id, message=str(e))

    return StreamingResponse(events(), media_type="application/x-ndjson")


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
