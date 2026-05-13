from labora.persistence.agent_store import AgentStore


def test_agent_store_persists_state_snapshot_and_messages(tmp_path):
    store = AgentStore(str(tmp_path / "labora.db"))
    task_id = store.create_task("What is RAG?", "focus on memory")

    state = {
        "status": "interrupted",
        "research_question": "What is RAG?",
        "planned_action": {"type": "search", "params": {"query": "RAG"}},
    }
    store.save_state_snapshot(task_id, state)
    store.add_message(task_id, "user", "What is RAG?")
    store.add_message(
        task_id,
        "assistant",
        "### Planned Action",
        [{"label": "Accept", "value": "confirm"}],
    )

    restored = AgentStore(str(tmp_path / "labora.db"))
    messages = restored.get_messages(task_id)

    assert restored.get_state_snapshot(task_id) == state
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "What is RAG?"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "### Planned Action"
    assert messages[1]["actions"] == [{"label": "Accept", "value": "confirm"}]
