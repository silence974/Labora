import pytest

from labora.agent.research_agent import continue_router, plan_node, reflect_node, _invoke_json


def test_reflect_node_interrupts_for_error_recovery():
    state = {
        "error": "Search failed: rate limited",
        "status": "running",
        "interrupt_type": "",
        "pending_prompt": "",
    }

    result = reflect_node(state)

    assert result["status"] == "interrupted"
    assert result["interrupt_type"] == "error_recovery"
    assert "Search failed: rate limited" in result["pending_prompt"]


def test_continue_router_replans_after_error():
    state = {
        "error": "Search failed",
        "user_response": "replan",
    }

    assert continue_router(state) == "plan_node"


def test_plan_node_clears_error_before_replanning(monkeypatch):
    def fake_invoke_json(llm, system, prompt):
        return {
            "type": "search",
            "params": {"query": "fallback query"},
            "rationale": "Recover from failed search",
        }

    monkeypatch.setattr("labora.agent.research_agent._get_llm", lambda temperature=0: object())
    monkeypatch.setattr("labora.agent.research_agent._invoke_json", fake_invoke_json)

    state = {
        "error": "Search failed",
        "user_response": "replan",
        "iteration_count": 1,
        "open_questions": [],
    }

    result = plan_node(state)

    assert result["error"] == ""
    assert result["status"] == "running"
    assert result["planned_action"]["type"] == "search"


def test_invoke_json_retries_connection_error_then_succeeds(monkeypatch):
    class FakeResponse:
        content = '{"type":"search","params":{},"rationale":"ok"}'

    class FlakyLLM:
        def __init__(self):
            self.calls = 0

        def invoke(self, messages):
            self.calls += 1
            if self.calls < 3:
                raise Exception("Connection error.")
            return FakeResponse()

    monkeypatch.setattr("labora.agent.research_agent.time.sleep", lambda _: None)

    llm = FlakyLLM()
    result = _invoke_json(llm, "system", "prompt")

    assert llm.calls == 3
    assert result["type"] == "search"


def test_invoke_json_raises_helpful_error_after_connection_failures(monkeypatch):
    class AlwaysFailLLM:
        def invoke(self, messages):
            raise Exception("Connection refused")

    monkeypatch.setattr("labora.agent.research_agent.time.sleep", lambda _: None)
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:7890")

    with pytest.raises(RuntimeError) as exc:
        _invoke_json(AlwaysFailLLM(), "system", "prompt")

    message = str(exc.value)
    assert "Failed to reach OpenAI API" in message
    assert "HTTPS_PROXY=http://127.0.0.1:7890" in message
