"""
论文阅读子图

实现 LangGraph 子图，用于解析和分析单篇论文：
1. 下载并解析 LaTeX 源码
2. 提取关键信息（背景、方法、贡献、局限性）
3. 生成结构化笔记
"""

from typing import TypedDict, Dict, Optional
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from labora.tools import parse_latex_from_arxiv, arxiv_get_paper
from labora.memory.manager import MemoryManager
from labora.core import config


class PaperReaderState(TypedDict):
    """论文阅读子图状态"""
    paper_id: str  # ArXiv ID (e.g., "arxiv:2301.12345")
    arxiv_id: str  # 纯 ArXiv ID (e.g., "2301.12345")
    paper_metadata: Optional[Dict]  # 论文元数据
    sections: Optional[Dict]  # 解析后的章节内容
    key_information: Optional[Dict]  # 提取的关键信息
    note: Optional[str]  # 生成的笔记
    error: Optional[str]  # 错误信息


def fetch_paper_metadata(state: PaperReaderState) -> PaperReaderState:
    """获取论文元数据"""
    try:
        arxiv_id = state["paper_id"].replace("arxiv:", "")
        state["arxiv_id"] = arxiv_id

        # 使用 arxiv_get_paper 工具获取元数据
        metadata = arxiv_get_paper.invoke({"arxiv_id": arxiv_id})

        if not metadata:
            state["error"] = f"Paper {arxiv_id} not found"
            return state

        state["paper_metadata"] = metadata
        return state

    except Exception as e:
        state["error"] = f"Failed to fetch metadata: {str(e)}"
        return state


def parse_paper_sections(state: PaperReaderState) -> PaperReaderState:
    """解析论文章节"""
    if state.get("error"):
        return state

    try:
        arxiv_id = state["arxiv_id"]

        # 使用 parse_latex_from_arxiv 工具解析 LaTeX
        sections = parse_latex_from_arxiv.invoke({"arxiv_id": arxiv_id})

        state["sections"] = sections
        return state

    except Exception as e:
        state["error"] = f"Failed to parse paper: {str(e)}"
        return state


def extract_key_information(state: PaperReaderState) -> PaperReaderState:
    """提取关键信息（背景、方法、贡献、局限性）"""
    if state.get("error"):
        return state

    try:
        sections = state["sections"]
        metadata = state["paper_metadata"]

        # 构建提示词
        sections_text = "\n\n".join([
            f"## {section_name}\n{content}"
            for section_name, content in sections.items()
        ])

        prompt = f"""
你是一位资深的科研文献分析专家。请仔细阅读以下论文内容，提取关键信息。

论文标题：{metadata.get('title', 'Unknown')}

论文内容：
{sections_text}

请提取以下关键信息（以 JSON 格式返回）：
1. background: 研究背景和动机（2-3 句话）
2. method: 核心方法和技术路线（3-4 句话）
3. contribution: 主要贡献和创新点（3-5 个要点）
4. limitation: 局限性和未来工作（2-3 个要点）

返回格式：
{{
  "background": "...",
  "method": "...",
  "contribution": ["...", "...", "..."],
  "limitation": ["...", "..."]
}}
"""

        # 使用 LLM 提取信息
        llm = ChatOpenAI(**config.get_openai_kwargs(), temperature=0)
        response = llm.invoke([
            SystemMessage(
                content="你是一位科研文献分析专家，擅长提取论文的关键信息。"
            ),
            HumanMessage(content=prompt)
        ])

        # 解析 JSON 响应
        import json
        content = response.content.strip()

        # 移除可能的 markdown 代码块标记
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]

        key_info = json.loads(content.strip())
        state["key_information"] = key_info

        return state

    except Exception as e:
        state["error"] = f"Failed to extract information: {str(e)}"
        return state


def generate_note(state: PaperReaderState) -> PaperReaderState:
    """生成结构化笔记（Markdown 格式）"""
    if state.get("error"):
        return state

    try:
        metadata = state["paper_metadata"]
        key_info = state["key_information"]

        # 构建 Markdown 笔记
        note_parts = [
            f"# {metadata.get('title', 'Unknown Title')}",
            "",
            f"**作者**: {', '.join(metadata.get('authors', [])[:3])}{'...' if len(metadata.get('authors', [])) > 3 else ''}",
            f"**发表时间**: {metadata.get('published', 'Unknown')}",
            f"**ArXiv ID**: {state['arxiv_id']}",
            "",
            "## 研究背景",
            key_info.get("background", ""),
            "",
            "## 核心方法",
            key_info.get("method", ""),
            "",
            "## 主要贡献",
        ]

        for i, contrib in enumerate(key_info.get("contribution", []), 1):
            note_parts.append(f"{i}. {contrib}")

        note_parts.extend([
            "",
            "## 局限性",
        ])

        for i, limit in enumerate(key_info.get("limitation", []), 1):
            note_parts.append(f"{i}. {limit}")

        note = "\n".join(note_parts)
        state["note"] = note

        return state

    except Exception as e:
        state["error"] = f"Failed to generate note: {str(e)}"
        return state


def create_paper_reader_graph(memory_manager: Optional[MemoryManager] = None) -> StateGraph:
    """
    创建论文阅读子图

    Args:
        memory_manager: 记忆管理器（可选，用于保存分析结果）

    Returns:
        LangGraph StateGraph 实例
    """
    # 创建状态图
    workflow = StateGraph(PaperReaderState)

    # 添加节点
    workflow.add_node("fetch_metadata", fetch_paper_metadata)
    workflow.add_node("parse_sections", parse_paper_sections)
    workflow.add_node("extract_information", extract_key_information)
    workflow.add_node("generate_note", generate_note)

    # 定义边
    workflow.set_entry_point("fetch_metadata")
    workflow.add_edge("fetch_metadata", "parse_sections")
    workflow.add_edge("parse_sections", "extract_information")
    workflow.add_edge("extract_information", "generate_note")
    workflow.add_edge("generate_note", END)

    # 编译图
    return workflow.compile()


# 导出便捷函数
def read_paper(paper_id: str, memory_manager: Optional[MemoryManager] = None) -> Dict:
    """
    读取并分析论文（便捷函数）

    Args:
        paper_id: 论文 ID (e.g., "arxiv:2301.12345")
        memory_manager: 记忆管理器（可选）

    Returns:
        包含 key_information 和 note 的字典
    """
    graph = create_paper_reader_graph(memory_manager)
    result = graph.invoke({"paper_id": paper_id})

    if result.get("error"):
        raise RuntimeError(result["error"])

    return {
        "paper_id": result["paper_id"],
        "key_information": result["key_information"],
        "note": result["note"],
    }
