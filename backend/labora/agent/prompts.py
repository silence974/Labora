"""
Research agent prompt templates.

Each prompt is a function that takes context and returns a (system_prompt, user_prompt) tuple.
"""

import json


# ── Plan Node ──────────────────────────────────────────────────────────────────────

PLAN_SYSTEM = """你是一位资深科研导师，正在指导一项文献研究。你的任务是分析当前研究进展，决定下一步最优动作。

可用动作：
1. search —— 搜索新论文。适用场景：需要探索新方向、补充文献、当前文献不足。
   params: {query: str, max_results: int (默认5)}
2. skim —— 快速浏览某篇论文（提取背景、方法、贡献、局限性4个基础字段）。
   params: {paper_id: str}
3. deep_read —— 深度阅读某篇论文（三阶段：核心理解→深度分析→学术脉络）。
   params: {paper_id: str}
4. compare —— 横向比较多篇论文的方法或结果。
   params: {paper_ids: [str, ...], focus: str (比较维度，如"方法论"、"实验结果"、"假设前提")}
5. trace_citation —— 沿引用关系追踪前驱或后继论文。
   params: {paper_id: str, direction: "predecessors"|"successors"}
6. synthesize —— 阶段性综合当前已知信息，更新研究文档的某个章节。
   params: {section: str (如"Related Work"、"Method Comparison"、"Research Gaps"), focus: str}
7. edit_document —— 增量修改LaTeX文档内容。
   params: {target: str (修改目标段落/章节), instruction: str (修改说明)}
8. ask_user —— 遇到方向性选择时向用户提问。
   params: {question: str, options: [str, ...] (可选, 2-4个选项)}

决策原则：
- 早期应优先 search + skim 建立文献地图，不要一上来就 deep_read
- 当 literature_map 中有 3+ 篇未精读的高相关论文时，优先 deep_read
- 当 open_questions 非空且可以通过搜索解决时，优先 search
- 不要重复阅读已精读过的论文
- 每 5-8 轮迭代应有一次 synthesize，将碎片信息整合进文档
- 重要的论文先 skim 再决定是否 deep_read
- 当 insights 积累足够时，考虑 compare 寻找跨论文规律
- edit_document 用于小幅修改，synthesize 用于写新章节

返回 JSON 格式，不要额外解释。"""


def build_plan_prompt(state: dict) -> str:
    """Build the user prompt for plan_node."""
    question = state.get("research_question", "")
    direction = state.get("initial_direction", "")
    iteration = state.get("iteration_count", 0)
    literature = state.get("literature_map", {})
    reading_notes = state.get("reading_notes", {})
    insights = state.get("insights", [])
    open_questions = state.get("open_questions", [])
    document = state.get("document", "")
    action_history = state.get("action_history", [])

    lit_summary = _summarize_literature(literature, reading_notes)
    history_summary = _summarize_history(action_history)

    return f"""## 研究命题
{question}

## 研究方向
{direction}

## 当前迭代
第 {iteration} 轮

## 文献地图
{lit_summary if lit_summary else "（空）尚未搜索任何论文"}

## 已提取的洞察
{json.dumps(insights, ensure_ascii=False, indent=2) if insights else "（空）"}

## 待解决问题
{json.dumps(open_questions, ensure_ascii=False, indent=2) if open_questions else "（空）"}

## 当前文档（最后500字符）
{document[-500:] if document else "（空）尚未创建文档"}

## 历史动作
{history_summary if history_summary else "（无）"}

请决定下一步最优动作，返回 JSON：
{{"type": "动作类型", "params": {{...}}, "rationale": "选择此动作的理由（一句话）"}}"""


# ── Reflect Node ───────────────────────────────────────────────────────────────────

REFLECT_SYSTEM = """你是一位严格的科研导师，正在审阅一项文献研究的进展。你的任务是评估当前状态，判断研究是否充分。

评估维度：
1. 文献覆盖度：核心方向的论文是否足够？有没有重要方向被遗漏？
2. 阅读深度：关键论文是否已经深度阅读？理解是否到位？
3. 信息完整性：是否足以回答研究命题？有哪些 gaps？
4. 方向正确性：当前方向是否仍然合理？是否需要调整？

判断标准：
- 如果核心论文 < 3 篇且尚未 deep_read，应继续
- 如果 open_questions 中有关键问题未解决，应继续
- 如果最近 2 轮没有产生新 insight，可能需要调整方向
- 如果文献覆盖充分 + 核心论文已精读 + 文档结构完整，可以考虑结束

返回 JSON 格式，不要额外解释。"""


def build_reflect_prompt(state: dict) -> str:
    """Build the user prompt for reflect_node."""
    question = state.get("research_question", "")
    literature = state.get("literature_map", {})
    reading_notes = state.get("reading_notes", {})
    insights = state.get("insights", [])
    open_questions = state.get("open_questions", [])
    action_result = state.get("action_result", {})
    iteration = state.get("iteration_count", 0)
    document = state.get("document", "")

    lit_summary = _summarize_literature(literature, reading_notes)

    return f"""## 研究命题
{question}

## 当前轮次
第 {iteration} 轮

## 文献概况
{lit_summary if lit_summary else "（空）"}

## 已提取洞察
{json.dumps(insights, ensure_ascii=False, indent=2) if insights else "（空）"}

## 待解决问题
{json.dumps(open_questions, ensure_ascii=False, indent=2) if open_questions else "（空）"}

## 最近一次动作的结果摘要
{json.dumps(action_result, ensure_ascii=False, indent=2) if action_result else "（空）"}

## 当前文档长度
{len(document)} 字符

请评估研究进展，返回 JSON：
{{"summary": "本轮进展摘要（一句话）", "gaps": ["尚存的gap1", "gap2"], "recommendation": "下一步建议（一句话）", "should_continue": true/false, "reason": "判断理由（一句话）"}}"""


# ── Act Synthesize ─────────────────────────────────────────────────────────────────

SYNTHESIZE_SYSTEM = """你是一位科研综述写作专家。请根据已有的论文阅读笔记和洞察，撰写 Markdown 格式的研究文档章节。

写作要求：
- 使用 Markdown 格式（## 标题、**加粗**、- 列表等）
- 数学公式使用 $...$ (行内) 或 $$...$$ (块级) LaTeX 语法
- 引用的论文使用 [paper_id] 格式标注
- 客观、准确、有条理
- 每个观点尽可能有论文支撑
- 如果某个观点只有单篇论文支撑，标注出来
- 不要编造未读过的论文信息

返回 JSON 格式，不要额外解释。"""


def build_synthesize_prompt(state: dict, section: str, focus: str) -> str:
    """Build the user prompt for act_synthesize."""
    literature = state.get("literature_map", {})
    reading_notes = state.get("reading_notes", {})
    insights = state.get("insights", [])
    document = state.get("document", "")

    notes_summary = _summarize_reading_notes(reading_notes)

    return f"""## 要撰写的章节
{section}

## 写作重点
{focus}

## 论文阅读笔记
{notes_summary}

## 已有洞察
{json.dumps(insights, ensure_ascii=False, indent=2) if insights else "（空）"}

## 当前文档（供参考，请在此基础之上修改）
{document if document else "（空）请从头开始写"}

请撰写或更新该章节的 Markdown 内容，返回 JSON：
{{"section": "{section}", "content": "Markdown 格式的章节内容，公式用 $...$ 或 $$...$$", "citations": ["paper_id1", "paper_id2"]}}"""


# ── Act Compare ─────────────────────────────────────────────────────────────────────

COMPARE_SYSTEM = """你是一位科研审稿人，擅长横向比较多篇论文。请找出论文之间的共性和差异，提炼深层规律。

分析维度：
1. 方法论层面：技术路线的异同、设计哲学的差异
2. 实验结果：性能对比、数据集选择、评估标准的差异
3. 假设前提：各自成立的假设条件有何不同
4. 局限性：各论文的局限是否存在共性

返回 JSON 格式，不要额外解释。"""


def build_compare_prompt(paper_ids: list[str], focus: str, reading_notes: dict) -> str:
    """Build the user prompt for act_compare."""
    papers_info = []
    for pid in paper_ids:
        notes = reading_notes.get(pid, {})
        if notes:
            papers_info.append(f"### {pid}\n{json.dumps(notes, ensure_ascii=False, indent=2)}")
        else:
            papers_info.append(f"### {pid}\n（未深度阅读）")

    papers_text = "\n\n".join(papers_info)

    return f"""## 比较维度
{focus}

## 论文信息
{papers_text}

请进行比较分析，返回 JSON：
{{"commonalities": ["共性1", "共性2"], "differences": ["差异1", "差异2"], "insights": ["深层规律1", "规律2"], "recommendation": "基于比较的建议"}}"""


# ── Act Edit Document ───────────────────────────────────────────────────────────────

EDIT_SYSTEM = """你是一位 Markdown 文档编辑。请根据指令对文档进行增量修改。

修改原则：
- 最小化改动：只修改指令要求的部分，不动其他内容
- 保留原有 Markdown 格式和引用
- 数学公式保持 $...$ 或 $$...$$ LaTeX 语法
- 如果是新增内容，确保与前后文连贯
- 返回完整的修改后文档内容（不是 diff）

返回 JSON 格式，不要额外解释。"""


def build_edit_prompt(document: str, target: str, instruction: str) -> str:
    """Build the user prompt for act_edit_document."""
    return f"""## 当前文档
{document}

## 修改目标
{target}

## 修改说明
{instruction}

请返回 JSON：
{{"modified_document": "完整修改后的文档内容", "change_description": "一句话描述改动", "edit_type": "add|modify|delete|restructure"}}"""


# ── Act Ask User ────────────────────────────────────────────────────────────────────

ASK_USER_SYSTEM = """你是一位科研导师，在遇到方向性选择时需要向研究者提问。你的问题应该帮助澄清研究方向、缩小搜索范围或确认假设。

问题应：
- 聚焦、具体，不泛泛而问
- 提供 2-4 个选项让研究者更容易回答
- 基于当前已有的信息和 gaps 来提问

返回 JSON 格式，不要额外解释。"""


def build_ask_user_prompt(state: dict) -> str:
    """Build the user prompt for act_ask_user."""
    question = state.get("research_question", "")
    insights = state.get("insights", [])
    open_questions = state.get("open_questions", [])

    return f"""## 研究命题
{question}

## 当前洞察
{json.dumps(insights, ensure_ascii=False, indent=2) if insights else "（空）"}

## 待解决问题
{json.dumps(open_questions, ensure_ascii=False, indent=2) if open_questions else "（空）"}

请生成 1 个关键问题帮助研究者明确方向，返回 JSON：
{{"question": "问题内容", "options": ["选项A", "选项B", "选项C"]}}"""


# ── Init Document ───────────────────────────────────────────────────────────────────

INIT_SYSTEM = """你是一位科研文档撰写专家。请根据研究命题和初始方向，创建一个 Markdown 研究文档骨架。

文档应包含以下基本结构（Markdown 格式）：
- # 标题
- ## Introduction 研究背景和问题陈述
- ## Related Work 相关工作（待填充）
- ## Methodology 方法论分析（待填充）
- ## Discussion 讨论（待填充）
- ## Conclusion 结论（待填充）

每个章节先写一个占位段落表明意图。
数学公式使用 $...$ (行内) 或 $$...$$ (块级) LaTeX 语法。

返回 JSON 格式，不要额外解释。"""


def build_init_document_prompt(question: str, direction: str) -> str:
    """Build the user prompt for document initialization."""
    return f"""## 研究命题
{question}

## 初始方向
{direction if direction else "（未指定）"}

请创建 Markdown 文档骨架，返回 JSON：
{{"document": "完整 Markdown 文档内容，公式用 $...$ 或 $$...$$"}}"""


# ── Helpers ─────────────────────────────────────────────────────────────────────────

def _summarize_literature(literature: dict, reading_notes: dict) -> str:
    """Summarize the literature map for prompt context."""
    if not literature:
        return ""

    lines = []
    for paper_id, meta in literature.items():
        status = meta.get("status", "found")
        title = meta.get("title", paper_id)
        year = meta.get("year", "?")
        has_notes = " [已读]" if paper_id in reading_notes else ""
        lines.append(f"- {paper_id}: {title} ({year}) — {status}{has_notes}")

    return "\n".join(lines)


def _summarize_reading_notes(reading_notes: dict) -> str:
    """Summarize reading notes for prompt context."""
    if not reading_notes:
        return "（无）"

    summaries = []
    for paper_id, notes in reading_notes.items():
        if isinstance(notes, dict):
            # Deep reader results have stages
            if "stages" in notes:
                stages = notes.get("stages", {})
                s1 = stages.get("1", {})
                s2 = stages.get("2", {})
                tl_dr = s1.get("tl_dr", "") if isinstance(s1, dict) else ""
                key_tech = s2.get("key_techniques", []) if isinstance(s2, dict) else []
                summaries.append(
                    f"### {paper_id}\n"
                    f"TL;DR: {tl_dr}\n"
                    f"Key techniques: {json.dumps(key_tech, ensure_ascii=False)}"
                )
            # Skim results have key_information
            elif "key_information" in notes:
                ki = notes["key_information"]
                summaries.append(
                    f"### {paper_id}\n"
                    f"Method: {ki.get('method', '')}\n"
                    f"Contribution: {json.dumps(ki.get('contribution', []), ensure_ascii=False)}"
                )
            else:
                summaries.append(f"### {paper_id}\n{json.dumps(notes, ensure_ascii=False, indent=2)[:300]}")
        else:
            summaries.append(f"### {paper_id}\n{str(notes)[:300]}")

    return "\n\n".join(summaries)


def _summarize_history(action_history: list) -> str:
    """Summarize action history for prompt context."""
    if not action_history:
        return ""

    lines = []
    for i, action in enumerate(action_history[-10:]):  # Last 10 actions only
        lines.append(f"{i + 1}. [{action.get('type', '?')}] {action.get('rationale', '')}")

    return "\n".join(lines)
