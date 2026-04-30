"""
深度阅读分析 Pipeline

三阶段渐进式论文分析：
  Stage 1 — 核心理解（TL;DR、研究问题、核心洞察、方法概述）
  Stage 2 — 深度分析（关键技术、实验发现、批判性阅读）
  Stage 3 — 学术脉络（前驱论文、后继论文、领域定位）
"""

import json
import logging
from typing import Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel

from labora.core import config
from labora.tools.semantic_scholar import fetch_references_sync, fetch_citations_sync

logger = logging.getLogger(__name__)

MAX_PAPER_CHARS = 30000


# ── Data Models ─────────────────────────────────────────────────────────────────

class Stage1Result(BaseModel):
    """阶段一：核心理解"""
    tl_dr: str
    research_problem: str
    core_insight: str
    method_overview: list[str]


class KeyTechnique(BaseModel):
    name: str
    description: str


class KeyResult(BaseModel):
    metric: str
    value: str
    interpretation: str


class CriticalReading(BaseModel):
    strengths: list[str]
    limitations: list[str]
    reproducibility: str


class Stage2Result(BaseModel):
    """阶段二：深度分析"""
    key_techniques: list[KeyTechnique]
    differences_from_baseline: str
    assumptions: list[str]
    experimental_setup: str
    key_results: list[KeyResult]
    surprising_findings: list[str]
    critical_reading: CriticalReading


class RelatedPaper(BaseModel):
    """关联论文（前驱或后继）"""
    arxiv_id: str
    title: str
    authors: list[str]
    year: Optional[str] = None
    relevance: Optional[str] = None


class Stage3Result(BaseModel):
    """阶段三：学术脉络"""
    predecessor_papers: list[RelatedPaper]
    successor_papers: list[RelatedPaper]
    field_position: str


# ── Helpers ──────────────────────────────────────────────────────────────────────

def _truncate_text(text: str, max_chars: int = MAX_PAPER_CHARS) -> str:
    """截断过长文本以适配 LLM 上下文窗口"""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[... content truncated due to length ...]"


def _parse_llm_json(response_content: str) -> dict:
    """从 LLM 响应中解析 JSON，自动处理 markdown 代码块"""
    content = response_content.strip()
    if content.startswith("```json"):
        content = content[7:]
    elif content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    return json.loads(content.strip())


def _invoke_json(llm: ChatOpenAI, system_prompt: str, user_prompt: str) -> dict:
    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ])
    return _parse_llm_json(response.content)


def _normalize_authors(authors) -> list[str]:
    if isinstance(authors, str):
        return [author.strip() for author in authors.split(",") if author.strip()]
    if isinstance(authors, list):
        normalized = []
        for author in authors:
            if isinstance(author, str):
                name = author
            elif isinstance(author, dict):
                name = author.get("name") or author.get("author") or ""
            else:
                name = str(author)
            name = name.strip()
            if name:
                normalized.append(name)
        return normalized
    return []


def _normalize_year(year) -> Optional[str]:
    if year is None:
        return None
    normalized = str(year).strip()
    return normalized or None


def _clean_related_papers(papers: list[dict]) -> list[RelatedPaper]:
    """清洗并去重关联论文列表"""
    seen = set()
    cleaned = []
    for p in papers:
        arxiv_id = (p.get("arxiv_id") or "").strip()
        if not arxiv_id or arxiv_id in seen:
            continue
        seen.add(arxiv_id)
        cleaned.append(RelatedPaper(
            arxiv_id=arxiv_id,
            title=p.get("title", "Unknown Title"),
            authors=_normalize_authors(p.get("authors", [])),
            year=_normalize_year(p.get("year")),
            relevance=p.get("relevance"),
        ))
    return cleaned


# ── Stage Functions ──────────────────────────────────────────────────────────────

def run_stage_1(paper_text: str, paper_title: str, llm: ChatOpenAI) -> Stage1Result:
    """阶段一：核心理解 — TL;DR、研究问题、核心洞察、方法概述"""
    truncated = _truncate_text(paper_text)

    system_prompt = (
        "你是一位资深的科研论文审稿专家。你的任务是用最精炼的语言提取论文的核心要旨，"
        "让读者在 30 秒内理解这篇论文在做什么、为什么重要、与以往有何不同。"
    )

    user_prompt = f"""
请仔细阅读以下论文内容，提取核心理解信息。

论文标题：{paper_title}

论文内容：
{truncated}

请以 JSON 格式返回以下信息：
1. tl_dr: 一句话概括这篇论文的核心贡献（30 字以内）
2. research_problem: 这篇论文试图解决什么研究问题？（2-3 句话）
3. core_insight: 与以往方法相比，这篇论文的核心思路转变或关键洞察是什么？（2-3 句话）
4. method_overview: 技术路线的高层概述，拆解为 3-5 个关键步骤，每步一句话

返回格式：
{{
  "tl_dr": "...",
  "research_problem": "...",
  "core_insight": "...",
  "method_overview": ["步骤1: ...", "步骤2: ...", "步骤3: ..."]
}}
"""
    data = _invoke_json(llm, system_prompt, user_prompt)
    return Stage1Result(**data)


def run_stage_2(paper_text: str, paper_title: str, llm: ChatOpenAI) -> Stage2Result:
    """阶段二：深度分析 — 技术细节、实验发现、批判性阅读"""
    truncated = _truncate_text(paper_text)

    system_prompt = (
        "你是一位资深科研审稿人，以批判性思维审视论文。"
        "你需要深入分析论文的技术细节和实验设计，同时给出独立的批判性评价。"
    )

    user_prompt = f"""
请仔细阅读以下论文内容，进行深度分析。

论文标题：{paper_title}

论文内容：
{truncated}

请以 JSON 格式返回以下信息：
1. key_techniques: 论文中最关键的 3-5 个技术方法或技巧，每个包含 name（技术名称）和 description（1-2 句话描述其作用）
2. differences_from_baseline: 该方法与 baseline/前驱工作的本质区别是什么？（设计哲学层面的不同，不只是表面差异，3-4 句话）
3. assumptions: 该方法成立的前提假设有哪些？列出 2-4 个
4. experimental_setup: 实验设计的逻辑是什么？核心实验验证了哪些主张？（3-4 句话）
5. key_results: 最重要的 3-5 个实验发现，每个包含 metric（指标名）、value（数值或结论）、interpretation（该结果说明了什么）
6. surprising_findings: 有哪些反直觉或出乎意料的发现？（如果没有则返回空数组）
7. critical_reading: 批判性评价，包含：
   - strengths: 方法论的亮点（2-3 个要点）
   - limitations: 潜在问题或局限（至少包含作者未提及的 1-2 个，2-3 个要点）
   - reproducibility: 可复现性评估（一句话说明代码/数据可用性和实验细节充分程度）

返回格式：
{{
  "key_techniques": [{{"name": "...", "description": "..."}}, ...],
  "differences_from_baseline": "...",
  "assumptions": ["...", "..."],
  "experimental_setup": "...",
  "key_results": [{{"metric": "...", "value": "...", "interpretation": "..."}}, ...],
  "surprising_findings": ["...", "..."],
  "critical_reading": {{
    "strengths": ["...", "..."],
    "limitations": ["...", "..."],
    "reproducibility": "..."
  }}
}}
"""
    data = _invoke_json(llm, system_prompt, user_prompt)
    return Stage2Result(**data)


def run_stage_3(
    arxiv_id: str,
    paper_text: str,
    paper_title: str,
    llm: ChatOpenAI,
) -> Stage3Result:
    """阶段三：学术脉络 — S2 API 获取引用关系 + LLM 融合分析"""
    truncated = _truncate_text(paper_text)

    # 1. 从 Semantic Scholar 获取引用数据
    logger.info("Fetching S2 references and citations for %s", arxiv_id)
    try:
        s2_refs = fetch_references_sync(arxiv_id, limit=15)
    except Exception as e:
        logger.warning("S2 references fetch failed: %s", e)
        s2_refs = []
    try:
        s2_cites = fetch_citations_sync(arxiv_id, limit=15)
    except Exception as e:
        logger.warning("S2 citations fetch failed: %s", e)
        s2_cites = []

    refs_json = json.dumps(s2_refs, ensure_ascii=False, indent=2)
    cites_json = json.dumps(s2_cites, ensure_ascii=False, indent=2)

    # 2. LLM 融合分析
    system_prompt = (
        "你是一位熟悉学术脉络的科研人员。"
        "你需要将论文放在学术发展的上下游中理解，找到它的前驱和后继工作。"
    )

    user_prompt = f"""
请分析这篇论文的学术脉络（前驱和后继）。

论文标题：{paper_title}
ArXiv ID：{arxiv_id}

论文内容（重点关注 Related Work 部分）：
{truncated}

Semantic Scholar 返回的参考文献列表（本文引用的论文 = 前驱）：
{refs_json}

Semantic Scholar 返回的引用列表（引用本文的论文 = 后继）：
{cites_json}

请以 JSON 格式返回：
1. predecessor_papers: 从参考文献和论文内容中，筛选出最重要的 3-5 篇前驱论文。每篇包含：
   - arxiv_id: ArXiv ID（如果 Semantic Scholar 提供了的话，格式如 "2301.12345"）
   - title: 论文标题
   - authors: 作者列表
   - year: 发表年份
   - relevance: 一句话说明这篇前驱论文与本文的具体关系（如"直接基础"、"竞品方法"、"理论来源"、"启发式改进对象"等）
2. successor_papers: 从 Semantic Scholar 引用列表中，筛选出最重要的 3-5 篇后继论文。字段同上。
   - relevance: 一句话说明这篇后继论文与本文的关系（如"改进本文方法"、"应用本文方法到新领域"、"对本文的理论分析"、"后续对比的 baseline"等）
3. field_position: 一段话（3-4 句）描述这篇论文在所在研究领域中的位置和角色。是开创性工作、统一框架、增量改进还是新的视角？

注意：
- 对于 predecessor_papers，如果 Semantic Scholar 数据不足，请从论文内容的 Related Work 部分提取
- 只保留有 arxiv_id 的论文（除非找不到 arxiv_id 但又很重要的论文，此时 arxiv_id 留空字符串）
- 按重要性排序
- 作者列表最多保留 3 位

返回格式：
{{
  "predecessor_papers": [
    {{"arxiv_id": "...", "title": "...", "authors": ["..."], "year": "...", "relevance": "..."}},
    ...
  ],
  "successor_papers": [
    {{"arxiv_id": "...", "title": "...", "authors": ["..."], "year": "...", "relevance": "..."}},
    ...
  ],
  "field_position": "..."
}}
"""
    data = _invoke_json(llm, system_prompt, user_prompt)

    # 清洗并标准化关联论文
    predecessors = _clean_related_papers(data.get("predecessor_papers", []))
    successors = _clean_related_papers(data.get("successor_papers", []))

    return Stage3Result(
        predecessor_papers=predecessors,
        successor_papers=successors,
        field_position=data.get("field_position", ""),
    )


# ── Progressive Stage Functions ─────────────────────────────────────────────────

def run_stage_1_progressive(
    paper_text: str,
    paper_title: str,
    llm: ChatOpenAI,
    on_step: callable,
) -> Stage1Result:
    """阶段一：按核心理解子版块逐项生成并上报真实进度。"""
    truncated = _truncate_text(paper_text)
    system_prompt = (
        "你是一位资深的科研论文审稿专家。你的回答必须是严格 JSON，"
        "不要输出 markdown 代码块之外的解释。"
    )
    base_context = f"""
论文标题：{paper_title}

论文内容：
{truncated}
"""

    partial: dict = {}

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"tl_dr": "..."}，用 30 字以内概括这篇论文的核心贡献。',
    )
    partial["tl_dr"] = data.get("tl_dr", "")
    on_step(10, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"research_problem": "..."}，用 2-3 句话说明这篇论文试图解决什么研究问题。',
    )
    partial["research_problem"] = data.get("research_problem", "")
    on_step(15, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"core_insight": "..."}，用 2-3 句话说明这篇论文相对以往方法的关键洞察。',
    )
    partial["core_insight"] = data.get("core_insight", "")
    on_step(20, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"method_overview": ["...", "..."]}，将技术路线拆解为 3-5 个关键步骤。',
    )
    partial["method_overview"] = data.get("method_overview", [])
    on_step(25, partial.copy())

    result = Stage1Result(
        tl_dr=partial.get("tl_dr", ""),
        research_problem=partial.get("research_problem", ""),
        core_insight=partial.get("core_insight", ""),
        method_overview=partial.get("method_overview", []),
    )
    on_step(30, result)
    return result


def run_stage_2_progressive(
    paper_text: str,
    paper_title: str,
    llm: ChatOpenAI,
    on_step: callable,
) -> Stage2Result:
    """阶段二：按深度分析子版块逐项生成并上报真实进度。"""
    truncated = _truncate_text(paper_text)
    system_prompt = (
        "你是一位资深科研审稿人，以批判性思维审视论文。"
        "你的回答必须是严格 JSON，不要输出额外解释。"
    )
    base_context = f"""
论文标题：{paper_title}

论文内容：
{truncated}
"""

    partial: dict = {}

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"key_techniques": [{"name": "...", "description": "..."}]}，列出 3-5 个关键技术。',
    )
    partial["key_techniques"] = data.get("key_techniques", [])
    on_step(40, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"differences_from_baseline": "..."}，说明该方法与 baseline/前驱工作的本质区别。',
    )
    partial["differences_from_baseline"] = data.get("differences_from_baseline", "")
    on_step(45, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"assumptions": ["...", "..."]}，列出该方法成立的 2-4 个前提假设。',
    )
    partial["assumptions"] = data.get("assumptions", [])
    on_step(50, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"experimental_setup": "..."}，用 3-4 句话说明实验设计逻辑。',
    )
    partial["experimental_setup"] = data.get("experimental_setup", "")
    on_step(55, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"key_results": [{"metric": "...", "value": "...", "interpretation": "..."}]}，列出 3-5 个关键实验结果。',
    )
    partial["key_results"] = data.get("key_results", [])
    on_step(60, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + """
请返回以下 JSON：
{
  "surprising_findings": ["...", "..."],
  "critical_reading": {
    "strengths": ["...", "..."],
    "limitations": ["...", "..."],
    "reproducibility": "..."
  }
}
""",
    )
    partial["surprising_findings"] = data.get("surprising_findings", [])
    partial["critical_reading"] = data.get(
        "critical_reading",
        {"strengths": [], "limitations": [], "reproducibility": ""},
    )

    result = Stage2Result(
        key_techniques=partial.get("key_techniques", []),
        differences_from_baseline=partial.get("differences_from_baseline", ""),
        assumptions=partial.get("assumptions", []),
        experimental_setup=partial.get("experimental_setup", ""),
        key_results=partial.get("key_results", []),
        surprising_findings=partial.get("surprising_findings", []),
        critical_reading=partial.get(
            "critical_reading",
            {"strengths": [], "limitations": [], "reproducibility": ""},
        ),
    )
    on_step(65, result)
    return result


def run_stage_3_progressive(
    arxiv_id: str,
    paper_text: str,
    paper_title: str,
    llm: ChatOpenAI,
    on_step: callable,
) -> Stage3Result:
    """阶段三：按引用数据和学术脉络子版块逐项生成并上报真实进度。"""
    truncated = _truncate_text(paper_text)
    partial: dict = {}

    logger.info("Fetching S2 references and citations for %s", arxiv_id)
    try:
        s2_refs = fetch_references_sync(arxiv_id, limit=15)
    except Exception as e:
        logger.warning("S2 references fetch failed: %s", e)
        s2_refs = []
    on_step(75, partial.copy())

    try:
        s2_cites = fetch_citations_sync(arxiv_id, limit=15)
    except Exception as e:
        logger.warning("S2 citations fetch failed: %s", e)
        s2_cites = []
    on_step(80, partial.copy())

    refs_json = json.dumps(s2_refs, ensure_ascii=False, indent=2)
    cites_json = json.dumps(s2_cites, ensure_ascii=False, indent=2)
    system_prompt = (
        "你是一位熟悉学术脉络的科研人员。你的回答必须是严格 JSON，"
        "不要输出额外解释。"
    )
    base_context = f"""
论文标题：{paper_title}
ArXiv ID：{arxiv_id}

论文内容（重点关注 Related Work 部分）：
{truncated}
"""

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + f"""
Semantic Scholar 返回的参考文献列表（本文引用的论文 = 前驱）：
{refs_json}

请返回 {{"predecessor_papers": [...]}}，筛选 3-5 篇最重要的前驱论文。每篇包含 arxiv_id、title、authors、year、relevance。
""",
    )
    partial["predecessor_papers"] = [
        paper.model_dump()
        for paper in _clean_related_papers(data.get("predecessor_papers", []))
    ]
    on_step(85, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + f"""
Semantic Scholar 返回的引用列表（引用本文的论文 = 后继）：
{cites_json}

请返回 {{"successor_papers": [...]}}，筛选 3-5 篇最重要的后继论文。每篇包含 arxiv_id、title、authors、year、relevance。
""",
    )
    partial["successor_papers"] = [
        paper.model_dump()
        for paper in _clean_related_papers(data.get("successor_papers", []))
    ]
    on_step(90, partial.copy())

    data = _invoke_json(
        llm,
        system_prompt,
        base_context + '\n请返回 {"field_position": "..."}，用 3-4 句话描述这篇论文在所在研究领域中的位置和角色。',
    )
    partial["field_position"] = data.get("field_position", "")
    on_step(95, partial.copy())

    result = Stage3Result(
        predecessor_papers=[RelatedPaper(**paper) for paper in partial["predecessor_papers"]],
        successor_papers=[RelatedPaper(**paper) for paper in partial["successor_papers"]],
        field_position=partial.get("field_position", ""),
    )
    on_step(100, result)
    return result


# ── Orchestrator ─────────────────────────────────────────────────────────────────

def run_deep_reading(
    paper_id: str,
    paper_text: str,
    paper_title: str,
    on_progress: callable = None,
) -> dict:
    """
    执行三阶段深度阅读分析

    Args:
        paper_id: 论文 ID（如 "2301.12345"）
        paper_text: 论文全文内容
        paper_title: 论文标题
        on_progress: 进度回调 (progress: int, stage: int, result: BaseModel) -> None

    Returns:
        {
            "paper_id": str,
            "paper_title": str,
            "stages": {1: stage1_dict, 2: stage2_dict, 3: stage3_dict},
        }
    """
    llm = ChatOpenAI(**config.get_openai_kwargs(), temperature=0)

    stages = {}
    arxiv_id = paper_id.replace("arxiv:", "")

    def notify(progress: int, stage: int, result=None) -> None:
        if on_progress:
            on_progress(progress, stage, result)

    # ── Stage 1 ──
    logger.info("Deep read [%s] starting stage 1", paper_id)
    notify(5, 1)
    try:
        stage1 = run_stage_1_progressive(
            paper_text,
            paper_title,
            llm,
            on_step=lambda progress, partial: notify(progress, 1, partial),
        )
        stages["1"] = stage1.model_dump()
    except Exception as e:
        logger.error("Stage 1 failed for %s: %s", paper_id, e)
        stages["1"] = {"error": str(e)}
        notify(30, 1, stages["1"])

    # ── Stage 2 ──
    logger.info("Deep read [%s] starting stage 2", paper_id)
    notify(35, 2)
    try:
        stage2 = run_stage_2_progressive(
            paper_text,
            paper_title,
            llm,
            on_step=lambda progress, partial: notify(progress, 2, partial),
        )
        stages["2"] = stage2.model_dump()
    except Exception as e:
        logger.error("Stage 2 failed for %s: %s", paper_id, e)
        stages["2"] = {"error": str(e)}
        notify(65, 2, stages["2"])

    # ── Stage 3 ──
    logger.info("Deep read [%s] starting stage 3", paper_id)
    notify(70, 3)
    try:
        stage3 = run_stage_3_progressive(
            arxiv_id,
            paper_text,
            paper_title,
            llm,
            on_step=lambda progress, partial: notify(progress, 3, partial),
        )
        stages["3"] = stage3.model_dump()
    except Exception as e:
        logger.error("Stage 3 failed for %s: %s", paper_id, e)
        stages["3"] = {"error": str(e)}
        notify(100, 3, stages["3"])

    return {
        "paper_id": paper_id,
        "paper_title": paper_title,
        "stages": stages,
    }
