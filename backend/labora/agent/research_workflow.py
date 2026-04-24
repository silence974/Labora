"""
协作研究主工作流

实现 LangGraph 主工作流，支持中断和恢复：
1. Initial Explorer - 初步探索研究方向
2. Question Generator - 生成澄清问题
3. Direction Refiner - 细化研究方向
4. Core Paper Selector - 选择核心论文
5. Collaborative Reader - 协作阅读论文
6. Knowledge Organizer - 组织知识
7. Synthesizer - 生成综述报告
"""

from typing import TypedDict, List, Dict, Optional
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from labora.tools import arxiv_search
from labora.agent import read_paper
from labora.memory.manager import MemoryManager
from labora.core import config


class ResearchWorkflowState(TypedDict):
    """研究工作流状态"""
    # 用户输入
    research_question: str  # 研究问题
    user_responses: Dict[str, str]  # 用户回答的问题

    # 探索阶段
    initial_papers: Optional[List[Dict]]  # 初步搜索的论文
    clarifying_questions: Optional[List[str]]  # 澄清问题

    # 细化阶段
    refined_direction: Optional[str]  # 细化后的研究方向
    search_queries: Optional[List[str]]  # 搜索查询

    # 论文选择
    candidate_papers: Optional[List[Dict]]  # 候选论文
    selected_papers: Optional[List[str]]  # 选中的论文 ID

    # 阅读阶段
    paper_analyses: Optional[Dict[str, Dict]]  # 论文分析结果

    # 综述生成
    synthesis: Optional[str]  # 综述报告

    # 错误处理
    error: Optional[str]  # 错误信息


def initial_explorer(state: ResearchWorkflowState) -> ResearchWorkflowState:
    """
    初步探索研究方向

    根据用户的研究问题，进行初步的文献搜索，了解研究领域的基本情况
    """
    try:
        question = state["research_question"]

        # 使用 LLM 生成搜索查询
        llm = ChatOpenAI(**config.get_openai_kwargs(), temperature=0)
        response = llm.invoke([
            SystemMessage(content="你是一位科研助手，擅长将研究问题转化为文献搜索查询。"),
            HumanMessage(content=f"""
研究问题：{question}

请生成 2-3 个 ArXiv 搜索查询，用于初步探索这个研究方向。
返回 JSON 格式：{{"queries": ["query1", "query2", "query3"]}}
""")
        ])

        import json
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]

        queries = json.loads(content.strip())["queries"]

        # 搜索论文
        all_papers = []
        for query in queries[:2]:  # 限制搜索次数
            papers = arxiv_search.invoke({"query": query, "max_results": 5})
            all_papers.extend(papers)

        # 去重
        seen_ids = set()
        unique_papers = []
        for paper in all_papers:
            if paper["id"] not in seen_ids:
                seen_ids.add(paper["id"])
                unique_papers.append(paper)

        state["initial_papers"] = unique_papers[:10]
        return state

    except Exception as e:
        state["error"] = f"Initial exploration failed: {str(e)}"
        return state


def question_generator(state: ResearchWorkflowState) -> ResearchWorkflowState:
    """
    生成澄清问题

    基于初步探索的结果，生成问题来澄清用户的研究方向
    """
    if state.get("error"):
        return state

    try:
        question = state["research_question"]
        papers = state["initial_papers"]

        # 构建论文摘要
        papers_summary = "\n".join([
            f"- {p['title']} ({p['year']})"
            for p in papers[:5]
        ])

        llm = ChatOpenAI(**config.get_openai_kwargs(), temperature=0)
        response = llm.invoke([
            SystemMessage(content="你是一位科研助手，擅长通过提问来澄清研究方向。"),
            HumanMessage(content=f"""
研究问题：{question}

初步搜索到的相关论文：
{papers_summary}

请生成 2-3 个澄清问题，帮助用户细化研究方向。问题应该关注：
1. 具体的研究子领域或方法
2. 时间范围或应用场景
3. 关注的核心问题

返回 JSON 格式：{{"questions": ["问题1", "问题2", "问题3"]}}
""")
        ])

        import json
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]

        questions = json.loads(content.strip())["questions"]
        state["clarifying_questions"] = questions

        # 这里应该设置中断点，等待用户回答
        # 在 LangGraph 中通过 interrupt 实现

        return state

    except Exception as e:
        state["error"] = f"Question generation failed: {str(e)}"
        return state


def direction_refiner(state: ResearchWorkflowState) -> ResearchWorkflowState:
    """
    细化研究方向

    根据用户的回答，细化研究方向并生成更精确的搜索查询
    """
    if state.get("error"):
        return state

    try:
        question = state["research_question"]
        responses = state.get("user_responses", {})

        # 构建上下文
        context = f"原始问题：{question}\n\n"
        for q, a in responses.items():
            context += f"Q: {q}\nA: {a}\n\n"

        llm = ChatOpenAI(**config.get_openai_kwargs(), temperature=0)
        response = llm.invoke([
            SystemMessage(content="你是一位科研助手，擅长细化研究方向。"),
            HumanMessage(content=f"""
{context}

基于以上信息，请：
1. 总结细化后的研究方向（1-2 句话）
2. 生成 3-5 个精确的搜索查询

返回 JSON 格式：
{{
  "refined_direction": "细化后的研究方向",
  "queries": ["query1", "query2", "query3"]
}}
""")
        ])

        import json
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]

        result = json.loads(content.strip())
        state["refined_direction"] = result["refined_direction"]
        state["search_queries"] = result["queries"]

        return state

    except Exception as e:
        state["error"] = f"Direction refinement failed: {str(e)}"
        return state


def core_paper_selector(state: ResearchWorkflowState) -> ResearchWorkflowState:
    """
    选择核心论文

    基于细化的研究方向，搜索并选择核心论文
    """
    if state.get("error"):
        return state

    try:
        queries = state["search_queries"]

        # 搜索论文
        all_papers = []
        for query in queries[:3]:  # 限制搜索次数
            papers = arxiv_search.invoke({"query": query, "max_results": 5})
            all_papers.extend(papers)

        # 去重
        seen_ids = set()
        unique_papers = []
        for paper in all_papers:
            if paper["id"] not in seen_ids:
                seen_ids.add(paper["id"])
                unique_papers.append(paper)

        state["candidate_papers"] = unique_papers[:15]

        # 自动选择前 3 篇（MVP 简化版本，后续可以让用户选择）
        state["selected_papers"] = [p["id"] for p in unique_papers[:3]]

        return state

    except Exception as e:
        state["error"] = f"Paper selection failed: {str(e)}"
        return state


def collaborative_reader(state: ResearchWorkflowState) -> ResearchWorkflowState:
    """
    协作阅读论文

    使用论文阅读子图分析选中的论文
    """
    if state.get("error"):
        return state

    try:
        selected_papers = state["selected_papers"]
        analyses = {}

        for paper_id in selected_papers:
            try:
                # 调用论文阅读子图
                result = read_paper(paper_id)
                analyses[paper_id] = result
            except Exception as e:
                print(f"Warning: Failed to read paper {paper_id}: {e}")
                continue

        state["paper_analyses"] = analyses
        return state

    except Exception as e:
        state["error"] = f"Collaborative reading failed: {str(e)}"
        return state


def synthesizer(state: ResearchWorkflowState) -> ResearchWorkflowState:
    """
    生成综述报告

    基于论文分析结果，生成研究综述
    """
    if state.get("error"):
        return state

    try:
        question = state["research_question"]
        direction = state["refined_direction"]
        analyses = state["paper_analyses"]

        # 构建论文摘要
        papers_content = []
        for paper_id, analysis in analyses.items():
            key_info = analysis["key_information"]
            papers_content.append(f"""
论文：{paper_id}
背景：{key_info.get('background', 'N/A')}
方法：{key_info.get('method', 'N/A')}
贡献：{', '.join(key_info.get('contribution', []))}
""")

        papers_text = "\n---\n".join(papers_content)

        llm = ChatOpenAI(**config.get_openai_kwargs(), temperature=0.3)
        response = llm.invoke([
            SystemMessage(content="你是一位资深科研人员，擅长撰写文献综述。"),
            HumanMessage(content=f"""
研究问题：{question}
研究方向：{direction}

已阅读的论文：
{papers_text}

请撰写一份研究综述报告（至少 800 字），包含以下部分：
1. 研究背景（说明研究问题的重要性和现状）
2. 主要发现（总结论文的核心贡献和方法）
3. 研究趋势（分析领域的发展方向）
4. 未来展望（提出可能的研究方向）

使用 Markdown 格式，包含标题和段落。
""")
        ])

        state["synthesis"] = response.content
        return state

    except Exception as e:
        state["error"] = f"Synthesis failed: {str(e)}"
        return state


def create_research_workflow(
    checkpointer: Optional[MemorySaver] = None,
    memory_manager: Optional[MemoryManager] = None
) -> StateGraph:
    """
    创建研究工作流

    Args:
        checkpointer: LangGraph checkpointer（用于状态持久化和恢复）
        memory_manager: 记忆管理器（用于保存论文和笔记）

    Returns:
        编译后的 StateGraph
    """
    workflow = StateGraph(ResearchWorkflowState)

    # 添加节点
    workflow.add_node("initial_explorer", initial_explorer)
    workflow.add_node("question_generator", question_generator)
    workflow.add_node("direction_refiner", direction_refiner)
    workflow.add_node("core_paper_selector", core_paper_selector)
    workflow.add_node("collaborative_reader", collaborative_reader)
    workflow.add_node("synthesizer", synthesizer)

    # 定义边
    workflow.set_entry_point("initial_explorer")
    workflow.add_edge("initial_explorer", "question_generator")
    workflow.add_edge("question_generator", "direction_refiner")
    workflow.add_edge("direction_refiner", "core_paper_selector")
    workflow.add_edge("core_paper_selector", "collaborative_reader")
    workflow.add_edge("collaborative_reader", "synthesizer")
    workflow.add_edge("synthesizer", END)

    # 编译图（带 checkpointer）
    return workflow.compile(checkpointer=checkpointer)


# 便捷函数
def run_research(
    research_question: str,
    checkpointer: Optional[MemorySaver] = None,
    memory_manager: Optional[MemoryManager] = None
) -> Dict:
    """
    运行研究工作流（便捷函数）

    Args:
        research_question: 研究问题
        checkpointer: Checkpointer（可选）
        memory_manager: 记忆管理器（可选）

    Returns:
        包含 synthesis 的字典
    """
    graph = create_research_workflow(checkpointer, memory_manager)
    result = graph.invoke({"research_question": research_question})

    if result.get("error"):
        raise RuntimeError(result["error"])

    return {
        "research_question": result["research_question"],
        "refined_direction": result.get("refined_direction"),
        "selected_papers": result.get("selected_papers"),
        "synthesis": result.get("synthesis"),
    }
