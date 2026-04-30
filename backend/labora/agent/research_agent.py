"""
Research Agent — Plan-Act-Observe-Reflect iterative core loop.

Produces a structured LaTeX research document through iterative
exploration, reading, synthesis, and user-guided refinement.

Architecture (LangGraph StateGraph with interrupts):
  init → plan → [INTERRUPT: user confirms action]
       → act_* (routed by action type)
       → observe → reflect → [INTERRUPT: user decides continue/done]
       → plan (loop) or finalize → END
"""

import json
import logging
from datetime import datetime, timezone
from typing import TypedDict, Optional, Literal

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from labora.core import config
from labora.tools import arxiv_search
from labora.agent.paper_reader import read_paper
from labora.agent.deep_reader import run_deep_reading
from labora.agent.prompts import (
    PLAN_SYSTEM, build_plan_prompt,
    REFLECT_SYSTEM, build_reflect_prompt,
    SYNTHESIZE_SYSTEM, build_synthesize_prompt,
    COMPARE_SYSTEM, build_compare_prompt,
    EDIT_SYSTEM, build_edit_prompt,
    ASK_USER_SYSTEM, build_ask_user_prompt,
    INIT_SYSTEM, build_init_document_prompt,
)
from labora.tools.semantic_scholar import fetch_references_sync, fetch_citations_sync

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 15
VALID_ACTIONS = {
    "search", "skim", "deep_read", "compare",
    "trace_citation", "synthesize", "edit_document", "ask_user",
}
CONFIRM_RESPONSES = {"confirm", "yes", "y", "accept", "ok", "执行", "确认", "同意"}
REPLAN_RESPONSES = {"reject", "no", "n", "拒绝", "否", "修改"}
AUTO_CONFIRM_ACTIONS = {"search", "skim", "compare", "trace_citation", "ask_user"}
HUMAN_CONFIRM_ACTIONS = {"deep_read", "synthesize", "edit_document"}


# ── State ───────────────────────────────────────────────────────────────────────────

class ResearchAgentState(TypedDict, total=False):
    # User input
    research_question: str
    initial_direction: str
    user_response: str  # Set by API on resume

    # Document output
    document: str
    document_versions: list[dict]
    current_version_index: int

    # Knowledge accumulation
    literature_map: dict       # paper_id -> {title, year, authors, status}
    reading_notes: dict        # paper_id -> skim or deep_read results
    insights: list[str]
    open_questions: list[str]

    # Loop control
    planned_action: dict       # {type, params, rationale}
    action_result: dict        # Result from last action
    action_history: list[dict] # Past actions for context
    reflection: dict           # {summary, gaps, recommendation, should_continue, reason}
    iteration_count: int

    # Interaction
    pending_prompt: str
    interrupt_type: str        # confirm_action | continue_decision | user_question

    # Status
    error: str
    status: str                # running | interrupted | completed | failed


# ── Helpers ─────────────────────────────────────────────────────────────────────────

def _get_llm(temperature: float = 0) -> ChatOpenAI:
    return ChatOpenAI(**config.get_openai_kwargs(), temperature=temperature)


def _parse_json(content: str) -> dict:
    """Extract JSON from LLM response, handling markdown code blocks."""
    text = content.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())


def _invoke_json(llm: ChatOpenAI, system: str, prompt: str) -> dict:
    response = llm.invoke([
        SystemMessage(content=system),
        HumanMessage(content=prompt),
    ])
    return _parse_json(response.content)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_paper_id(paper_id: str) -> str:
    return paper_id.replace("arxiv:", "")


def _is_blank_figure_edit(action: dict) -> bool:
    """Blank figure placeholders are low-risk scaffolding and can run without approval."""
    params = action.get("params", {})
    text = json.dumps(params, ensure_ascii=False).lower()
    has_figure = any(
        keyword in text
        for keyword in ("blank figure", "empty figure", "placeholder figure", "空白图", "占位图")
    )
    has_create_intent = any(
        keyword in text
        for keyword in ("create", "insert", "add", "新增", "创建", "插入", "添加")
    )
    return action.get("type") == "edit_document" and has_figure and has_create_intent


def _requires_human_confirmation(action: dict) -> bool:
    action_type = action.get("type", "")
    if action_type in AUTO_CONFIRM_ACTIONS:
        return False
    if _is_blank_figure_edit(action):
        return False
    if action_type in HUMAN_CONFIRM_ACTIONS:
        return True
    return True


# ── Nodes ───────────────────────────────────────────────────────────────────────────

def init_node(state: ResearchAgentState) -> ResearchAgentState:
    """Initialize research context: create document skeleton, set up version tracking."""
    question = state.get("research_question", "")
    direction = state.get("initial_direction", "")

    llm = _get_llm(temperature=0.3)
    data = _invoke_json(llm, INIT_SYSTEM, build_init_document_prompt(question, direction))
    document = data.get("document", "")

    version = {
        "index": 0,
        "content": document,
        "description": "Initial document skeleton",
        "edit_type": "init",
        "timestamp": _now_iso(),
    }

    state["document"] = document
    state["document_versions"] = [version]
    state["current_version_index"] = 0
    state["literature_map"] = {}
    state["reading_notes"] = {}
    state["insights"] = []
    state["open_questions"] = [question] if question else []
    state["action_history"] = []
    state["iteration_count"] = 0
    state["status"] = "running"
    state["error"] = ""

    logger.info("Agent initialized for question: %s", question[:80])
    return state


def plan_node(state: ResearchAgentState) -> ResearchAgentState:
    """LLM analyzes current context and decides the next action."""
    if state.get("error"):
        return state

    # Check iteration limit
    iteration = state.get("iteration_count", 0)
    if iteration >= MAX_ITERATIONS:
        logger.info("Max iterations (%d) reached, forcing finalize", MAX_ITERATIONS)
        state["planned_action"] = {
            "type": "synthesize",
            "params": {"section": "Conclusion", "focus": "Final synthesis"},
            "rationale": "达到最大迭代次数，进行最终综合",
        }
        return state

    # Process user response if present
    user_response = state.pop("user_response", None)

    llm = _get_llm(temperature=0)
    prompt = build_plan_prompt(state)
    data = _invoke_json(llm, PLAN_SYSTEM, prompt)

    action_type = data.get("type", "search")
    if action_type not in VALID_ACTIONS:
        action_type = "search"

    state["planned_action"] = {
        "type": action_type,
        "params": data.get("params", {}),
        "rationale": data.get("rationale", ""),
    }
    state["status"] = "running"
    state["interrupt_type"] = ""
    state["pending_prompt"] = ""

    logger.info("Plan: %s — %s", action_type, data.get("rationale", "")[:80])
    return state


def plan_router(state: ResearchAgentState) -> str:
    action = state.get("planned_action", {})
    action_type = action.get("type", "search")
    if action_type not in VALID_ACTIONS:
        action_type = "search"
    if _requires_human_confirmation(action):
        return "confirm_action"
    return action_type


def confirm_action_node(state: ResearchAgentState) -> ResearchAgentState:
    """Pause for human confirmation only when the planned action needs it."""
    action = state.get("planned_action", {})
    action_type = action.get("type", "search")
    params = action.get("params", {})
    rationale = action.get("rationale", "")

    state["interrupt_type"] = "confirm_action"
    state["status"] = "interrupted"
    state["pending_prompt"] = (
        f"建议动作: {action_type}\n理由: {rationale}\n"
        f"参数: {json.dumps(params, ensure_ascii=False)}\n\n"
        "确认执行此动作？(yes/no/修改)"
    )
    return state


def action_router(state: ResearchAgentState) -> str:
    """Conditional edge: route to the appropriate action node."""
    user_response = state.get("user_response", "").strip().lower()
    if user_response and user_response not in CONFIRM_RESPONSES:
        if user_response not in REPLAN_RESPONSES:
            open_qs = state.get("open_questions", [])
            guidance = f"User guidance for replanning: {state.get('user_response', '')}"
            if guidance not in open_qs:
                state["open_questions"] = open_qs + [guidance]
        state["status"] = "running"
        state["pending_prompt"] = ""
        return "plan_node"

    action = state.get("planned_action", {})
    action_type = action.get("type", "search")
    if action_type not in VALID_ACTIONS:
        action_type = "search"
    return action_type


# ── Action Nodes ────────────────────────────────────────────────────────────────────

def act_search(state: ResearchAgentState) -> ResearchAgentState:
    """Search arXiv for papers matching a query."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    query = params.get("query", state.get("research_question", ""))
    max_results = params.get("max_results", 5)

    try:
        results = arxiv_search.invoke({"query": query, "max_results": max_results})
    except Exception as e:
        logger.error("Search failed: %s", e)
        state["error"] = f"Search failed: {e}"
        return state

    lit_map = state.get("literature_map", {})
    new_count = 0
    for paper in results:
        pid = _normalize_paper_id(paper.get("id", ""))
        if pid and pid not in lit_map:
            lit_map[pid] = {
                "title": paper.get("title", "Unknown"),
                "year": paper.get("year", ""),
                "authors": paper.get("authors", [])[:5],
                "abstract": paper.get("abstract", "")[:500],
                "status": "found",
            }
            new_count += 1

    state["literature_map"] = lit_map
    state["action_result"] = {
        "action": "search",
        "query": query,
        "total_found": len(results),
        "new_added": new_count,
        "paper_ids": [_normalize_paper_id(p.get("id", "")) for p in results],
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "search",
        "query": query,
        "result_count": new_count,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Search '%s': %d found, %d new", query, len(results), new_count)
    return state


def act_skim(state: ResearchAgentState) -> ResearchAgentState:
    """Quickly skim a paper using paper_reader (4 basic fields)."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    paper_id = params.get("paper_id", "")

    try:
        result = read_paper(f"arxiv:{_normalize_paper_id(paper_id)}")
    except Exception as e:
        logger.error("Skim failed for %s: %s", paper_id, e)
        state["error"] = f"Skim failed for {paper_id}: {e}"
        return state

    reading_notes = state.get("reading_notes", {})
    reading_notes[paper_id] = {
        "key_information": result.get("key_information", {}),
        "note": result.get("note", ""),
        "read_level": "skim",
    }
    state["reading_notes"] = reading_notes

    # Update literature map status
    lit_map = state.get("literature_map", {})
    if paper_id in lit_map:
        lit_map[paper_id]["status"] = "skimmed"

    state["action_result"] = {"action": "skim", "paper_id": paper_id, "result": result}
    state["action_history"] = state.get("action_history", []) + [{
        "type": "skim",
        "paper_id": paper_id,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Skimmed: %s", paper_id)
    return state


def act_deep_read(state: ResearchAgentState) -> ResearchAgentState:
    """Deep read a paper using the three-stage deep_reader pipeline."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    paper_id = _normalize_paper_id(params.get("paper_id", ""))

    # Get paper text from literature library or use abstract as fallback
    lit_map = state.get("literature_map", {})
    paper_meta = lit_map.get(paper_id, {})
    paper_title = paper_meta.get("title", paper_id)
    paper_text = paper_meta.get("abstract", "")

    try:
        # Attempt to fetch full text from tools
        from labora.tools.latex_parser import parse_latex_from_arxiv
        sections = parse_latex_from_arxiv.invoke({"arxiv_id": paper_id})
        if sections:
            paper_text = "\n\n".join(sections.values())
    except Exception:
        pass

    try:
        result = run_deep_reading(
            paper_id=f"arxiv:{paper_id}",
            paper_text=paper_text or paper_meta.get("abstract", ""),
            paper_title=paper_title,
        )
    except Exception as e:
        logger.error("Deep read failed for %s: %s", paper_id, e)
        state["error"] = f"Deep read failed for {paper_id}: {e}"
        return state

    reading_notes = state.get("reading_notes", {})
    reading_notes[paper_id] = {
        "stages": result.get("stages", {}),
        "read_level": "deep",
    }
    state["reading_notes"] = reading_notes

    if paper_id in lit_map:
        lit_map[paper_id]["status"] = "deep_read"

    state["action_result"] = {
        "action": "deep_read",
        "paper_id": paper_id,
        "stages_summary": {
            k: "error" if isinstance(v, dict) and "error" in v else "ok"
            for k, v in result.get("stages", {}).items()
        },
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "deep_read",
        "paper_id": paper_id,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Deep read: %s", paper_id)
    return state


def act_compare(state: ResearchAgentState) -> ResearchAgentState:
    """Cross-compare multiple papers using LLM."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    paper_ids = params.get("paper_ids", [])
    focus = params.get("focus", "方法论")

    reading_notes = state.get("reading_notes", {})
    llm = _get_llm(temperature=0.3)
    prompt = build_compare_prompt(paper_ids, focus, reading_notes)
    data = _invoke_json(llm, COMPARE_SYSTEM, prompt)

    insights = state.get("insights", [])
    new_insights = data.get("insights", [])
    insights.extend(new_insights)
    state["insights"] = insights

    state["action_result"] = {
        "action": "compare",
        "paper_ids": paper_ids,
        "focus": focus,
        "commonalities": data.get("commonalities", []),
        "differences": data.get("differences", []),
        "new_insights": new_insights,
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "compare",
        "paper_ids": paper_ids,
        "focus": focus,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Compared %d papers on '%s': %d insights", len(paper_ids), focus, len(new_insights))
    return state


def act_trace_citation(state: ResearchAgentState) -> ResearchAgentState:
    """Trace citation chain via Semantic Scholar API."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    paper_id = _normalize_paper_id(params.get("paper_id", ""))
    direction = params.get("direction", "predecessors")

    result_papers = []
    try:
        if direction == "predecessors":
            s2_data = fetch_references_sync(paper_id, limit=10)
        else:
            s2_data = fetch_citations_sync(paper_id, limit=10)

        lit_map = state.get("literature_map", {})
        for ref in s2_data:
            ref_id = _normalize_paper_id(ref.get("arxiv_id") or ref.get("paperId", ""))
            if ref_id and ref_id not in lit_map:
                lit_map[ref_id] = {
                    "title": ref.get("title", "Unknown"),
                    "year": str(ref.get("year", "")),
                    "authors": ref.get("authors", [])[:5] if isinstance(ref.get("authors"), list) else [],
                    "status": "found",
                    "source": f"citation_trace_{direction}",
                }
                result_papers.append(ref_id)
        state["literature_map"] = lit_map
    except Exception as e:
        logger.error("Citation trace failed for %s: %s", paper_id, e)
        state["error"] = f"Citation trace failed: {e}"
        return state

    state["action_result"] = {
        "action": "trace_citation",
        "paper_id": paper_id,
        "direction": direction,
        "new_papers": result_papers,
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "trace_citation",
        "paper_id": paper_id,
        "direction": direction,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Citation trace %s for %s: %d new papers", direction, paper_id, len(result_papers))
    return state


def act_synthesize(state: ResearchAgentState) -> ResearchAgentState:
    """Synthesize current knowledge into a document section."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    section = params.get("section", "Discussion")
    focus = params.get("focus", "")

    llm = _get_llm(temperature=0.3)
    prompt = build_synthesize_prompt(state, section, focus)
    data = _invoke_json(llm, SYNTHESIZE_SYSTEM, prompt)

    new_content = data.get("content", "")
    citations = data.get("citations", [])

    # Append or integrate the new section into the document
    current_doc = state.get("document", "")
    updated_doc = _integrate_section(current_doc, section, new_content)

    version = {
        "index": state.get("current_version_index", 0) + 1,
        "content": updated_doc,
        "description": f"Synthesize section: {section}",
        "edit_type": "synthesize",
        "timestamp": _now_iso(),
    }

    state["document"] = updated_doc
    state["document_versions"] = state.get("document_versions", []) + [version]
    state["current_version_index"] = version["index"]

    state["action_result"] = {
        "action": "synthesize",
        "section": section,
        "focus": focus,
        "citations": citations,
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "synthesize",
        "section": section,
        "focus": focus,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Synthesized section '%s': %d chars", section, len(new_content))
    return state


def act_edit_document(state: ResearchAgentState) -> ResearchAgentState:
    """Incrementally edit the LaTeX document with version tracking."""
    action = state.get("planned_action", {})
    params = action.get("params", {})
    target = params.get("target", "document")
    instruction = params.get("instruction", "")

    current_doc = state.get("document", "")

    llm = _get_llm(temperature=0)
    prompt = build_edit_prompt(current_doc, target, instruction)
    data = _invoke_json(llm, EDIT_SYSTEM, prompt)

    modified_doc = data.get("modified_document", current_doc)
    change_desc = data.get("change_description", instruction)
    edit_type = data.get("edit_type", "modify")

    version = {
        "index": state.get("current_version_index", 0) + 1,
        "content": modified_doc,
        "description": change_desc,
        "edit_type": edit_type,
        "timestamp": _now_iso(),
    }

    state["document"] = modified_doc
    state["document_versions"] = state.get("document_versions", []) + [version]
    state["current_version_index"] = version["index"]

    state["action_result"] = {
        "action": "edit_document",
        "target": target,
        "change_description": change_desc,
        "edit_type": edit_type,
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "edit_document",
        "target": target,
        "instruction": instruction,
        "rationale": action.get("rationale", ""),
    }]
    logger.info("Edit document: %s — %s", edit_type, change_desc[:80])
    return state


def act_ask_user(state: ResearchAgentState) -> ResearchAgentState:
    """Generate a directional question for the user."""
    llm = _get_llm(temperature=0)
    prompt = build_ask_user_prompt(state)
    data = _invoke_json(llm, ASK_USER_SYSTEM, prompt)

    question_text = data.get("question", "")
    options = data.get("options", [])

    state["pending_prompt"] = question_text
    if options:
        state["pending_prompt"] += "\n\n选项:\n" + "\n".join(
            f"  {i+1}. {opt}" for i, opt in enumerate(options)
        )
    state["interrupt_type"] = "user_question"
    state["status"] = "interrupted"

    state["action_result"] = {
        "action": "ask_user",
        "question": question_text,
        "options": options,
    }
    state["action_history"] = state.get("action_history", []) + [{
        "type": "ask_user",
        "question": question_text,
        "rationale": state.get("planned_action", {}).get("rationale", ""),
    }]
    logger.info("Ask user: %s", question_text[:80])
    return state


# ── Observe Node ────────────────────────────────────────────────────────────────────

def observe_node(state: ResearchAgentState) -> ResearchAgentState:
    """Extract key information from action results and update context."""
    if state.get("error"):
        return state

    action_result = state.get("action_result", {})
    action_type = action_result.get("action", "")

    # Extract insights from reading actions
    if action_type == "deep_read":
        paper_id = action_result.get("paper_id", "")
        notes = state.get("reading_notes", {}).get(paper_id, {})
        stages = notes.get("stages", {})
        s1 = stages.get("1", {})
        if isinstance(s1, dict) and s1.get("tl_dr"):
            insight = f"[{paper_id}] {s1['tl_dr']}"
            insights = state.get("insights", [])
            if insight not in insights:
                insights.append(insight)
            state["insights"] = insights

            # If open_questions had something about this paper, remove it
            open_qs = state.get("open_questions", [])
            state["open_questions"] = [
                q for q in open_qs if paper_id not in q
            ]

    elif action_type == "skim":
        paper_id = action_result.get("paper_id", "")
        notes = state.get("reading_notes", {}).get(paper_id, {})
        ki = notes.get("key_information", {})
        if ki.get("contribution"):
            contribs = ki["contribution"]
            if isinstance(contribs, list):
                for c in contribs[:2]:
                    insight = f"[{paper_id}] {c}"
                    insights = state.get("insights", [])
                    if insight not in insights:
                        insights.append(insight)
                state["insights"] = insights

    elif action_type == "compare":
        # compare already updates insights in act_compare
        pass

    elif action_type == "search":
        result = action_result
        new_ids = result.get("paper_ids", [])
        if new_ids:
            open_qs = state.get("open_questions", [])
            open_qs.append(f"Need to review {len(new_ids)} new papers from search")
            state["open_questions"] = open_qs

    elif action_type == "trace_citation":
        result = action_result
        new_ids = result.get("new_papers", [])
        if new_ids:
            open_qs = state.get("open_questions", [])
            open_qs.append(f"Citation trace found {len(new_ids)} related papers")
            state["open_questions"] = open_qs

    state["iteration_count"] = state.get("iteration_count", 0) + 1

    return state


# ── Reflect Node ────────────────────────────────────────────────────────────────────

def reflect_node(state: ResearchAgentState) -> ResearchAgentState:
    """LLM evaluates progress: enough info? gaps? continue or done?"""
    if state.get("error"):
        return state

    llm = _get_llm(temperature=0)
    prompt = build_reflect_prompt(state)
    data = _invoke_json(llm, REFLECT_SYSTEM, prompt)

    state["reflection"] = {
        "summary": data.get("summary", ""),
        "gaps": data.get("gaps", []),
        "recommendation": data.get("recommendation", ""),
        "should_continue": data.get("should_continue", True),
        "reason": data.get("reason", ""),
    }

    # Update open_questions with identified gaps
    gaps = data.get("gaps", [])
    if gaps:
        open_qs = state.get("open_questions", [])
        for gap in gaps:
            if gap not in open_qs:
                open_qs.append(gap)
        state["open_questions"] = open_qs

    state["interrupt_type"] = "continue_decision"
    state["status"] = "interrupted"
    state["pending_prompt"] = (
        f"进展评估:\n{data.get('summary', '')}\n\n"
        f"尚存 gaps:\n" + "\n".join(f"  - {g}" for g in gaps) + "\n\n"
        f"建议: {data.get('recommendation', '')}\n\n"
        f"是否继续研究？(continue/done)"
    )

    logger.info("Reflect: should_continue=%s, gaps=%d",
                data.get("should_continue"), len(gaps))
    return state


def continue_router(state: ResearchAgentState) -> str:
    """Conditional edge: continue or finalize based on reflection."""
    reflection = state.get("reflection", {})
    should_continue = reflection.get("should_continue", True)

    # User can override via response
    user_response = state.get("user_response", "").strip().lower()
    if user_response in ("done", "stop", "finalize", "结束", "no"):
        should_continue = False
    elif user_response in ("continue", "yes", "继续", "y"):
        should_continue = True

    if should_continue:
        return "plan_node"
    return "finalize_node"


# ── Finalize Node ───────────────────────────────────────────────────────────────────

def finalize_node(state: ResearchAgentState) -> ResearchAgentState:
    """Finalize the research document: ensure completeness, add metadata."""
    document = state.get("document", "")

    # Add a generation note
    gen_note = (
        f"\n\n---\n"
        f"*Generated by Labora Research Agent*\n"
        f"- Date: {_now_iso()}\n"
        f"- Research question: {state.get('research_question', '')}\n"
        f"- Iterations: {state.get('iteration_count', 0)}\n"
        f"- Papers reviewed: {len(state.get('reading_notes', {}))}\n"
    )
    document += gen_note

    # Final version snapshot
    version = {
        "index": state.get("current_version_index", 0) + 1,
        "content": document,
        "description": "Finalized document",
        "edit_type": "finalize",
        "timestamp": _now_iso(),
    }

    state["document"] = document
    state["document_versions"] = state.get("document_versions", []) + [version]
    state["current_version_index"] = version["index"]
    state["status"] = "completed"
    state["pending_prompt"] = "研究完成。文档已生成。"

    logger.info("Agent finalized: %d versions, %d chars document",
                len(state.get("document_versions", [])), len(document))
    return state


# ── Document Helper ─────────────────────────────────────────────────────────────────

def _integrate_section(document: str, section: str, new_content: str) -> str:
    """Integrate a new or updated section into the Markdown document."""
    if not document:
        return new_content

    import re
    # Match both "## Section" and "# Section" style headings
    section_pattern = re.compile(rf'^##\s+{re.escape(section)}\s*$', re.MULTILINE)
    match = section_pattern.search(document)
    if match:
        idx = match.start()
        # Find the next heading at the same level
        next_sec = re.search(r'^##\s+', document[match.end():], re.MULTILINE)
        if next_sec:
            end = match.end() + next_sec.start()
            return document[:idx] + new_content + "\n\n" + document[end:]
        else:
            return document[:idx] + new_content
    else:
        # Append before Conclusion or at end
        concl_match = re.search(r'^##\s+Conclusion', document, re.MULTILINE)
        if concl_match:
            return document[:concl_match.start()] + new_content + "\n\n" + document[concl_match.start():]
        else:
            return document + "\n\n" + new_content


# ── Graph Construction ──────────────────────────────────────────────────────────────

def create_research_agent_graph(
    checkpointer: Optional[MemorySaver] = None,
) -> StateGraph:
    """Create the research agent LangGraph StateGraph.

    Args:
        checkpointer: LangGraph checkpointer for state persistence across interrupts.

    Returns:
        Compiled StateGraph ready for invocation.
    """
    workflow = StateGraph(ResearchAgentState)

    # Add nodes
    workflow.add_node("init_node", init_node)
    workflow.add_node("plan_node", plan_node)
    workflow.add_node("confirm_action_node", confirm_action_node)
    workflow.add_node("act_search", act_search)
    workflow.add_node("act_skim", act_skim)
    workflow.add_node("act_deep_read", act_deep_read)
    workflow.add_node("act_compare", act_compare)
    workflow.add_node("act_trace_citation", act_trace_citation)
    workflow.add_node("act_synthesize", act_synthesize)
    workflow.add_node("act_edit_document", act_edit_document)
    workflow.add_node("act_ask_user", act_ask_user)
    workflow.add_node("observe_node", observe_node)
    workflow.add_node("reflect_node", reflect_node)
    workflow.add_node("finalize_node", finalize_node)

    # Entry
    workflow.set_entry_point("init_node")
    workflow.add_edge("init_node", "plan_node")

    # Plan → action routing
    workflow.add_conditional_edges(
        "plan_node",
        plan_router,
        {
            "confirm_action": "confirm_action_node",
            "search": "act_search",
            "skim": "act_skim",
            "deep_read": "act_deep_read",
            "compare": "act_compare",
            "trace_citation": "act_trace_citation",
            "synthesize": "act_synthesize",
            "edit_document": "act_edit_document",
            "ask_user": "act_ask_user",
        },
    )

    # Confirmed plans → action routing
    workflow.add_conditional_edges(
        "confirm_action_node",
        action_router,
        {
            "plan_node": "plan_node",
            "search": "act_search",
            "skim": "act_skim",
            "deep_read": "act_deep_read",
            "compare": "act_compare",
            "trace_citation": "act_trace_citation",
            "synthesize": "act_synthesize",
            "edit_document": "act_edit_document",
            "ask_user": "act_ask_user",
        },
    )

    # All actions → observe
    for action_name in VALID_ACTIONS:
        workflow.add_edge(f"act_{action_name}", "observe_node")

    # Observe → reflect
    workflow.add_edge("observe_node", "reflect_node")

    # Reflect → continue or finalize
    workflow.add_conditional_edges(
        "reflect_node",
        continue_router,
        {
            "plan_node": "plan_node",
            "finalize_node": "finalize_node",
        },
    )

    # Finalize → END
    workflow.add_edge("finalize_node", END)

    # Compile with checkpointer and interrupt points
    if checkpointer is None:
        checkpointer = MemorySaver()

    return workflow.compile(
        checkpointer=checkpointer,
        interrupt_after=["confirm_action_node", "act_ask_user", "reflect_node"],
    )


# ── Convenience Functions ───────────────────────────────────────────────────────────

def run_agent(
    research_question: str,
    initial_direction: str = "",
    checkpointer: Optional[MemorySaver] = None,
    thread_id: Optional[str] = None,
) -> dict:
    """Start a new research agent run.

    The agent runs until the first interrupt point (plan_node) and returns
    the current state, including the planned action for user confirmation.

    Args:
        research_question: The research question or proposition.
        initial_direction: Optional initial direction or idea.
        checkpointer: LangGraph checkpointer.
        thread_id: Unique thread ID for the run.

    Returns:
        Current ResearchAgentState at first interrupt.
    """
    graph = create_research_agent_graph(checkpointer)

    if thread_id is None:
        import uuid
        thread_id = uuid.uuid4().hex[:12]

    config_dict = {"configurable": {"thread_id": thread_id}}

    initial_state = {
        "research_question": research_question,
        "initial_direction": initial_direction,
    }

    result = graph.invoke(initial_state, config_dict)
    result["thread_id"] = thread_id
    return result


def resume_agent(
    graph: StateGraph,
    thread_id: str,
    user_response: str = "",
) -> dict:
    """Resume a paused agent run after user input.

    Args:
        graph: The compiled agent graph.
        thread_id: Thread ID of the paused run.
        user_response: User's response to the interrupt prompt.

    Returns:
        Updated ResearchAgentState (at next interrupt or completion).
    """
    config_dict = {"configurable": {"thread_id": thread_id}}

    if user_response:
        graph.update_state(config_dict, {"user_response": user_response})

    result = graph.invoke(None, config_dict)
    result["thread_id"] = thread_id
    return result
