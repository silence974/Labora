import pytest
from fastapi import HTTPException

from labora.api.routes.research_agent import _persist_error_snapshot, _get_resume_state
from labora.persistence.agent_store import AgentStore


def test_persist_error_snapshot_sets_resumable_interrupt_state(tmp_path):
    store = AgentStore(str(tmp_path / "agent.db"))
    task_id = store.create_task(
        research_question="test question",
        initial_direction="test direction",
        thread_id="thread-1",
    )
    task = store.get_task(task_id) or {}

    state = _persist_error_snapshot(store, task_id, task, RuntimeError("connection refused"))
    stored_state = store.get_state_snapshot(task_id) or {}
    stored_task = store.get_task(task_id) or {}

    assert stored_task.get("status") == "interrupted"
    assert state.get("status") == "interrupted"
    assert stored_state.get("status") == "interrupted"
    assert stored_state.get("interrupt_type") == "error_recovery"
    assert "retry" in (stored_state.get("pending_prompt") or "")
    assert stored_state.get("error") == "connection refused"


def test_persist_error_snapshot_preserves_existing_state_content(tmp_path):
    store = AgentStore(str(tmp_path / "agent.db"))
    task_id = store.create_task(
        research_question="test question",
        initial_direction="test direction",
        thread_id="thread-2",
    )
    task = store.get_task(task_id) or {}
    store.save_state_snapshot(
        task_id,
        {
            "status": "running",
            "document": "draft content",
            "literature_map": {"arxiv:1": {"title": "Paper 1"}},
            "iteration_count": 2,
            "thread_id": "thread-2",
        },
    )

    state = _persist_error_snapshot(store, task_id, task, RuntimeError("network timeout"))

    assert state.get("document") == "draft content"
    assert state.get("literature_map") == {"arxiv:1": {"title": "Paper 1"}}
    assert state.get("iteration_count") == 2
    assert state.get("status") == "interrupted"
    assert state.get("interrupt_type") == "error_recovery"


class _InactiveGraph:
    class _State:
        values = None

    def get_state(self, config_dict):
        return self._State()


def test_get_resume_state_upgrades_failed_snapshot_to_resumable(tmp_path):
    store = AgentStore(str(tmp_path / "agent.db"))
    task_id = store.create_task(
        research_question="test question",
        initial_direction="test direction",
        thread_id="thread-3",
    )
    store.save_state_snapshot(
        task_id,
        {
            "status": "failed",
            "error": "legacy failure",
            "research_question": "test question",
            "thread_id": "thread-3",
        },
    )

    state, resume_node = _get_resume_state(
        graph=_InactiveGraph(),
        config_dict={"configurable": {"thread_id": "thread-3"}},
        store=store,
        task_id=task_id,
    )

    assert resume_node == "reflect_node"
    assert state.get("status") == "interrupted"
    assert state.get("interrupt_type") == "error_recovery"
    assert "retry" in (state.get("pending_prompt") or "")


def test_get_resume_state_still_rejects_non_resumable_snapshot(tmp_path):
    store = AgentStore(str(tmp_path / "agent.db"))
    task_id = store.create_task(
        research_question="test question",
        initial_direction="test direction",
        thread_id="thread-4",
    )
    store.save_state_snapshot(
        task_id,
        {
            "status": "running",
            "research_question": "test question",
            "thread_id": "thread-4",
        },
    )

    with pytest.raises(HTTPException) as exc:
        _get_resume_state(
            graph=_InactiveGraph(),
            config_dict={"configurable": {"thread_id": "thread-4"}},
            store=store,
            task_id=task_id,
        )

    assert exc.value.status_code == 409
