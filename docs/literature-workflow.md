# 文献研究工作流设计

## 核心理念

Labora 采用**人机协作**的研究模式，而非全自动化。AI 作为研究助手，与用户一起：
- 探索研究方向
- 阅读和理解文献
- 发散思考和讨论
- 整理知识和形成观点

## 人类研究流程

真实的科研过程是迭代式、交互式的：

1. **产生问题/兴趣** - 用户输入可能是研究方向、命题或想法
2. **初步探索 + 提问** - 搜索文献后给出细分方向，向用户提问（0-10个问题）
3. **协作式精读** - 和用户一起阅读核心文献，产生子页面
4. **发散式扩展** - 配合用户的提问和笔记，延展思考
5. **整理和讨论** - AI整理知识，有疑问时与用户讨论，可能回到前面步骤
6. **迭代深化** - 总结后循环，直到用户确认停止

## LangGraph 工作流

Labora 的 Agent 系统基于 **LangGraph** 框架实现，支持：
- 人机交互检查点（interrupt）
- 灵活的条件分支和循环
- 协作式工作流
- 流式输出

### 状态定义

```python
class LiteratureResearchState(TypedDict):
    # 用户输入
    user_input: str  # 研究方向/命题/想法
    research_question: str  # 明确的研究问题
    
    # 初步探索阶段
    initial_papers: List[Dict]  # 初步检索的论文
    refined_directions: List[str]  # 细分的研究方向
    user_questions: List[Dict]  # 向用户提出的问题
    user_answers: Dict[str, str]  # 用户的回答
    
    # 精读阶段
    core_papers: List[str]  # 核心论文列表
    current_reading_paper: str  # 当前正在读的论文
    reading_sessions: Dict[str, Dict]  # 阅读会话（论文ID -> 阅读结果）
    user_notes: Dict[str, List[str]]  # 用户笔记（论文ID -> 笔记列表）
    
    # 扩展阅读阶段
    extended_papers: List[str]  # 扩展阅读的论文
    user_thoughts: List[str]  # 用户的思考和想法
    discussion_history: List[Dict]  # 讨论历史
    
    # 整理思考阶段
    knowledge_map: Dict  # 知识关系图
    key_findings: List[str]  # 关键发现
    open_questions: List[str]  # 待解决的问题
    ai_questions_to_user: List[str]  # AI向用户提出的问题
    
    # 总结阶段
    synthesis_report: str  # 综述报告
    
    # 控制流
    current_phase: str  # 当前阶段
    iteration_count: int  # 迭代次数
    user_wants_to_stop: bool  # 用户是否想停止
    next_action: str  # 下一步动作
```

### 工作流图

```
START
  ↓
[1] Initial Explorer (初步探索)
  ↓
[2] Question Generator (生成问题) → [INTERRUPT] 等待用户回答
  ↓
[3] Direction Refiner (明确方向)
  ↓
[4] Core Paper Selector (选择核心论文) → [INTERRUPT] 用户确认
  ↓
[5] Collaborative Reader (协作阅读) → [INTERRUPT] 用户参与阅读
  ↓                                      ↓
  └──────────────────────────────────→ [用户想继续读？]
                                          ↙        ↘
                                        YES        NO
                                         ↓          ↓
                                    返回阅读    [6] Extension Thinker
                                                    ↓
                                          [INTERRUPT] 用户发散思考
                                                    ↓
                                          [7] Knowledge Organizer
                                                    ↓
                                          [INTERRUPT] AI提问讨论
                                                    ↓
                                          [8] Synthesizer (总结)
                                                    ↓
                                          [INTERRUPT] 用户确认
                                                    ↓
                                              [继续研究？]
                                                ↙      ↘
                                              YES      NO
                                               ↓        ↓
                                          返回探索    END
```

### LangGraph 实现框架

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint import MemorySaver
from typing import TypedDict, List, Dict

# 状态定义见上文

# 1. 初步探索节点
def initial_explorer(state: LiteratureResearchState) -> LiteratureResearchState:
    """初步探索：快速检索文献，了解研究现状"""
    user_input = state["user_input"]
    
    # 快速检索相关文献（10-20篇）
    papers = quick_search(user_input, limit=20)
    state["initial_papers"] = papers
    
    # 分析文献，识别细分方向
    directions = llm.analyze_research_directions(papers, user_input)
    state["refined_directions"] = directions
    state["current_phase"] = "exploration"
    
    return state

# 2. 问题生成节点
def question_generator(state: LiteratureResearchState) -> LiteratureResearchState:
    """生成问题：向用户提问以明确研究方向"""
    directions = state["refined_directions"]
    papers = state["initial_papers"]
    
    # 生成 0-10 个问题
    questions = llm.generate_clarifying_questions(
        user_input=state["user_input"],
        directions=directions,
        papers=papers
    )
    
    state["user_questions"] = questions
    
    # 设置中断点，等待用户回答
    if questions:
        state["__interrupt__"] = {
            "type": "questions",
            "questions": questions,
            "message": "为了更好地帮助您，我有几个问题想了解："
        }
    
    return state

# 3. 方向明确节点
def direction_refiner(state: LiteratureResearchState) -> LiteratureResearchState:
    """根据用户回答明确研究方向"""
    user_answers = state.get("user_answers", {})
    
    # 根据用户回答，明确研究问题
    research_question = llm.refine_research_question(
        user_input=state["user_input"],
        directions=state["refined_directions"],
        user_answers=user_answers
    )
    
    state["research_question"] = research_question
    state["current_phase"] = "direction_refined"
    
    return state

# 4. 核心论文选择节点
def core_paper_selector(state: LiteratureResearchState) -> LiteratureResearchState:
    """选择核心论文供精读"""
    papers = state["initial_papers"]
    question = state["research_question"]
    
    # 选择 3-5 篇核心论文
    core_papers = llm.select_core_papers(papers, question, top_k=5)
    state["core_papers"] = [p["id"] for p in core_papers]
    
    # 中断，让用户确认或调整
    state["__interrupt__"] = {
        "type": "confirmation",
        "message": "我建议精读以下论文，您可以调整选择：",
        "papers": core_papers,
        "allow_edit": True
    }
    
    return state

# 5. 协作阅读节点
def collaborative_reader(state: LiteratureResearchState) -> LiteratureResearchState:
    """与用户一起阅读论文"""
    core_papers = state["core_papers"]
    current_paper = state.get("current_reading_paper")
    
    # 如果没有当前论文，选择第一篇未读的
    if not current_paper:
        read_papers = set(state.get("reading_sessions", {}).keys())
        unread = [p for p in core_papers if p not in read_papers]
        if unread:
            current_paper = unread[0]
            state["current_reading_paper"] = current_paper
        else:
            # 所有核心论文都读完了
            state["current_phase"] = "core_reading_done"
            return state
    
    # 调用阅读子图
    reading_subgraph = create_paper_reading_subgraph()
    reading_result = reading_subgraph.invoke({
        "paper_id": current_paper,
        "collaborative_mode": True  # 协作模式
    })
    
    # 保存阅读结果
    if "reading_sessions" not in state:
        state["reading_sessions"] = {}
    state["reading_sessions"][current_paper] = reading_result
    
    # 中断，展示阅读结果，询问用户
    state["__interrupt__"] = {
        "type": "reading_session",
        "paper_id": current_paper,
        "summary": reading_result["key_information"],
        "message": "我们一起读完了这篇论文。您有什么想法或笔记吗？",
        "options": ["继续读下一篇", "重新读这篇", "跳到扩展阅读"]
    }
    
    # 清除当前论文，准备下一篇
    state["current_reading_paper"] = None
    state["current_phase"] = "collaborative_reading"
    
    return state

# 6. 扩展思考节点
def extension_thinker(state: LiteratureResearchState) -> LiteratureResearchState:
    """发散式扩展阅读和思考"""
    reading_sessions = state["reading_sessions"]
    user_notes = state.get("user_notes", {})
    
    # 基于已读论文和用户笔记，建议扩展方向
    suggestions = llm.suggest_extensions(
        reading_sessions=reading_sessions,
        user_notes=user_notes,
        research_question=state["research_question"]
    )
    
    state["current_phase"] = "extension"
    
    # 中断，与用户讨论扩展方向
    state["__interrupt__"] = {
        "type": "discussion",
        "message": "基于我们读过的论文，我有一些扩展思考的建议：",
        "suggestions": suggestions,
        "prompt": "您对哪个方向感兴趣？或者您有其他想法？"
    }
    
    return state

# 7. 知识整理节点
def knowledge_organizer(state: LiteratureResearchState) -> LiteratureResearchState:
    """整理知识，构建关系图"""
    reading_sessions = state["reading_sessions"]
    user_thoughts = state.get("user_thoughts", [])
    
    # 构建知识图谱
    knowledge_map = llm.build_knowledge_map(
        papers=reading_sessions,
        user_thoughts=user_thoughts
    )
    
    # 识别关键发现和待解决问题
    key_findings = llm.extract_key_findings(knowledge_map)
    open_questions = llm.identify_open_questions(knowledge_map)
    
    state["knowledge_map"] = knowledge_map
    state["key_findings"] = key_findings
    state["open_questions"] = open_questions
    state["current_phase"] = "organizing"
    
    # 如果有疑问，向用户提问
    if open_questions:
        ai_questions = llm.generate_discussion_questions(open_questions)
        state["ai_questions_to_user"] = ai_questions
        
        state["__interrupt__"] = {
            "type": "discussion",
            "message": "在整理知识时，我有一些疑问想和您讨论：",
            "questions": ai_questions
        }
    
    return state

# 8. 综述生成节点
def synthesizer(state: LiteratureResearchState) -> LiteratureResearchState:
    """生成研究综述"""
    report = llm.generate_synthesis_report(
        research_question=state["research_question"],
        knowledge_map=state["knowledge_map"],
        key_findings=state["key_findings"],
        open_questions=state["open_questions"],
        user_thoughts=state.get("user_thoughts", [])
    )
    
    state["synthesis_report"] = report
    state["current_phase"] = "synthesis"
    state["iteration_count"] = state.get("iteration_count", 0) + 1
    
    # 中断，展示综述，询问用户是否继续
    state["__interrupt__"] = {
        "type": "synthesis_review",
        "report": report,
        "message": "这是目前的研究综述。您想继续深化研究，还是结束？",
        "options": ["继续深化", "结束研究", "回到某个阶段"]
    }
    
    return state

# 条件边函数
def should_continue_reading(state: LiteratureResearchState) -> str:
    """判断是否继续阅读"""
    next_action = state.get("next_action", "")
    
    if next_action == "continue_reading":
        return "continue"
    elif next_action == "extension":
        return "extension"
    else:
        return "organize"

def should_continue_research(state: LiteratureResearchState) -> str:
    """判断是否继续研究"""
    if state.get("user_wants_to_stop", False):
        return "end"
    
    next_action = state.get("next_action", "")
    if next_action == "continue":
        return "continue"
    elif next_action == "back_to_reading":
        return "back_to_reading"
    else:
        return "end"

# 构建工作流
def create_collaborative_research_workflow() -> StateGraph:
    """创建人机协作的研究工作流"""
    workflow = StateGraph(LiteratureResearchState)
    
    # 添加节点
    workflow.add_node("initial_explorer", initial_explorer)
    workflow.add_node("question_generator", question_generator)
    workflow.add_node("direction_refiner", direction_refiner)
    workflow.add_node("core_paper_selector", core_paper_selector)
    workflow.add_node("collaborative_reader", collaborative_reader)
    workflow.add_node("extension_thinker", extension_thinker)
    workflow.add_node("knowledge_organizer", knowledge_organizer)
    workflow.add_node("synthesizer", synthesizer)
    
    # 设置入口
    workflow.set_entry_point("initial_explorer")
    
    # 线性流程（初步探索 → 提问 → 明确方向 → 选择论文）
    workflow.add_edge("initial_explorer", "question_generator")
    workflow.add_edge("question_generator", "direction_refiner")
    workflow.add_edge("direction_refiner", "core_paper_selector")
    workflow.add_edge("core_paper_selector", "collaborative_reader")
    
    # 阅读阶段的条件分支
    workflow.add_conditional_edges(
        "collaborative_reader",
        should_continue_reading,
        {
            "continue": "collaborative_reader",  # 继续读下一篇
            "extension": "extension_thinker",    # 进入扩展阶段
            "organize": "knowledge_organizer"    # 直接整理
        }
    )
    
    # 扩展 → 整理 → 综述
    workflow.add_edge("extension_thinker", "knowledge_organizer")
    workflow.add_edge("knowledge_organizer", "synthesizer")
    
    # 综述后的条件分支
    workflow.add_conditional_edges(
        "synthesizer",
        should_continue_research,
        {
            "continue": "initial_explorer",      # 继续深化，回到探索
            "back_to_reading": "collaborative_reader",  # 回到阅读
            "end": END
        }
    )
    
    # 使用检查点支持人机交互
    checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)

# 使用示例
def run_collaborative_research(user_input: str, thread_id: str = "default"):
    """运行协作式研究"""
    workflow = create_collaborative_research_workflow()
    
    # 初始状态
    initial_state = {
        "user_input": user_input,
        "current_phase": "start",
        "iteration_count": 0,
        "user_wants_to_stop": False
    }
    
    # 配置（支持中断和恢复）
    config = {"configurable": {"thread_id": thread_id}}
    
    # 流式执行
    for event in workflow.stream(initial_state, config):
        node_name = list(event.keys())[0]
        node_output = event[node_name]
        
        # 检查是否有中断
        if "__interrupt__" in node_output:
            interrupt_info = node_output["__interrupt__"]
            # 展示给用户，等待输入
            user_response = handle_interrupt(interrupt_info)
            
            # 更新状态并继续
            updated_state = update_state_with_user_response(
                node_output, 
                user_response
            )
            
            # 从中断点恢复
            workflow.update_state(config, updated_state)
        
        yield event
```

## 核心节点

### 1. Initial Explorer（初步探索）
**职责**：快速检索文献，识别研究方向

**输入**：用户的研究方向/命题/想法  
**输出**：初步论文列表、细分研究方向  
**特点**：快速、广泛，不求深入

### 2. Question Generator（问题生成）
**职责**：向用户提问以明确研究方向

**输出**：0-10 个问题  
**中断点**：等待用户回答  
**示例问题**：
- 您更关注理论还是应用？
- 您对哪个时间段的研究感兴趣？
- 您希望深入哪个子领域？

### 3. Direction Refiner（方向明确）
**职责**：根据用户回答明确研究问题

**输入**：用户回答  
**输出**：明确的研究问题  

### 4. Core Paper Selector（核心论文选择）
**职责**：选择 3-5 篇核心论文供精读

**中断点**：用户确认或调整论文列表  
**特点**：用户可以添加/删除论文

### 5. Collaborative Reader（协作阅读）
**职责**：与用户一起阅读论文

**流程**：
1. 调用论文阅读子图
2. 展示阅读结果（摘要、方法、贡献等）
3. 询问用户想法和笔记
4. 用户选择：继续读下一篇 / 重新读 / 跳到扩展

**中断点**：每篇论文读完后  
**特点**：协作式，用户全程参与

### 6. Extension Thinker（扩展思考）
**职责**：发散式扩展阅读和思考

**流程**：
1. 基于已读论文，建议扩展方向
2. 用户提出想法或问题
3. AI 配合延展思考
4. 可能检索更多论文

**中断点**：持续对话，用户主导  
**特点**：开放式、发散式

### 7. Knowledge Organizer（知识整理）
**职责**：整理知识，构建关系图

**流程**：
1. 自动构建知识图谱
2. 识别关键发现和待解决问题
3. 如有疑问，向用户提问讨论
4. 可能回到前面阶段补充阅读

**中断点**：有疑问时  
**特点**：AI 主动思考，遇到问题与用户讨论

### 8. Synthesizer（综述生成）
**职责**：生成研究综述

**输出**：结构化的综述报告  
**中断点**：展示综述，询问是否继续  
**用户选择**：
- 继续深化研究（回到探索）
- 回到某个阶段补充
- 结束研究

## 工具集

### 学术搜索工具
- **ArxivTool** - Arxiv 论文检索
- **SemanticScholarTool** - Semantic Scholar API
- **PubMedTool** - 医学文献检索
- **GoogleScholarTool** - Google Scholar 检索

### 文献处理工具
- **PDFParserTool** - PDF 解析和内容提取
- **CitationAnalyzerTool** - 引用关系分析
- **TextAnalysisTool** - 文本分析和信息提取
- **ObsidianExportTool** - 导出笔记到 Obsidian Vault

### 笔记管理工具
- **NoteGeneratorTool** - 自动生成结构化笔记
- **ConceptExtractorTool** - 提取关键概念并建立链接
- **AnnotationTool** - PDF 标注和高亮管理

### 辅助工具
- **TranslationTool** - 多语言翻译
- **WebSearchTool** - Web 搜索（补充信息）
- **VisualizationTool** - 数据可视化

## 数据存储

### 论文元数据
```sql
CREATE TABLE papers (
    id VARCHAR(255) PRIMARY KEY,
    title TEXT,
    authors TEXT[],
    abstract TEXT,
    year INT,
    arxiv_id VARCHAR(50),
    pdf_path VARCHAR(500)
);
```

### 阅读笔记
```sql
CREATE TABLE reading_notes (
    id SERIAL PRIMARY KEY,
    paper_id VARCHAR(255),
    user_id VARCHAR(255),
    summary TEXT,
    key_contributions TEXT[],
    personal_notes TEXT,
    tags TEXT[]
);
```

### 知识图谱（Neo4j）
```cypher
(:Paper)-[:CITES]->(:Paper)
(:Paper)-[:PROPOSES]->(:Concept)
(:Paper)-[:DISCUSSES]->(:Concept)
(:Concept)-[:RELATED_TO]->(:Concept)
```

## 输出格式

### 文献综述报告（Markdown）

```markdown
# 研究问题综述

## 1. 研究背景
[背景介绍]

## 2. 核心论文综述
### 2.1 论文标题 (作者, 年份)
- 核心贡献：...
- 方法：...
- 结果：...
- 局限性：...

## 3. 方法演进
[演进图]

## 4. 主要发现
1. ...
2. ...

## 5. 研究空白
1. ...
2. ...

## 6. 未来方向
1. ...
2. ...

## 参考文献
[1] ...
[2] ...
```

## 性能优化

1. **并行检索** - 同时查询多个数据源
2. **增量阅读** - 优先阅读高相关性论文
3. **缓存机制** - 缓存已解析的 PDF
4. **批量处理** - 批量调用 LLM API
5. **流式输出** - 实时展示研究进度

## LangGraph 高级特性

### 1. 人机交互检查点
```python
from langgraph.checkpoint import MemorySaver

# 添加检查点支持
checkpointer = MemorySaver()
workflow = create_research_workflow()
app = workflow.compile(checkpointer=checkpointer)

# 在关键节点暂停，等待用户确认
def paper_selector_with_approval(state: LiteratureResearchState):
    selected = llm.select_papers(state["papers_found"])
    # 暂停并等待用户确认
    return {"papers_selected": selected, "__interrupt__": "请确认选中的论文"}
```

### 2. 论文阅读子图（Sub-graph）

论文阅读是一个复杂的过程，拆分为独立的子工作流：

```python
from typing import TypedDict

# 子图状态定义
class PaperReadingState(TypedDict):
    paper_id: str
    pdf_content: str
    parsed_sections: Dict[str, str]
    key_information: Dict
    concepts: List[str]
    note: str

# 子图节点函数
def pdf_parser_node(state: PaperReadingState) -> PaperReadingState:
    """PDF 解析节点"""
    paper_id = state["paper_id"]
    # 下载并解析 PDF
    pdf_path = download_paper(paper_id)
    content = pdf_parser.extract_text(pdf_path)
    state["pdf_content"] = content
    return state

def section_parser_node(state: PaperReadingState) -> PaperReadingState:
    """章节解析节点"""
    content = state["pdf_content"]
    # 识别并提取各个章节
    sections = {
        "abstract": extract_abstract(content),
        "introduction": extract_section(content, "introduction"),
        "method": extract_section(content, "method"),
        "results": extract_section(content, "results"),
        "conclusion": extract_section(content, "conclusion")
    }
    state["parsed_sections"] = sections
    return state

def information_extractor_node(state: PaperReadingState) -> PaperReadingState:
    """信息提取节点"""
    sections = state["parsed_sections"]
    # 使用 LLM 提取关键信息
    key_info = {
        "background": llm.extract_background(sections["introduction"]),
        "problem": llm.extract_problem(sections["introduction"]),
        "method": llm.extract_method(sections["method"]),
        "contributions": llm.extract_contributions(sections),
        "results": llm.extract_results(sections["results"]),
        "limitations": llm.extract_limitations(sections)
    }
    state["key_information"] = key_info
    return state

def concept_extractor_node(state: PaperReadingState) -> PaperReadingState:
    """概念提取节点"""
    key_info = state["key_information"]
    # 提取关键概念
    concepts = llm.extract_concepts(key_info)
    state["concepts"] = concepts
    return state

def note_generator_node(state: PaperReadingState) -> PaperReadingState:
    """笔记生成节点"""
    key_info = state["key_information"]
    concepts = state["concepts"]
    
    # 生成结构化笔记
    note = f"""# {state['paper_id']}

## 核心贡献
{format_list(key_info['contributions'])}

## 研究方法
{key_info['method']}

## 主要结果
{key_info['results']}

## 局限性
{key_info['limitations']}

## 关键概念
{format_concepts_with_links(concepts)}
"""
    state["note"] = note
    return state

def obsidian_exporter_node(state: PaperReadingState) -> PaperReadingState:
    """Obsidian 导出节点（可选）"""
    # 通过统一的记忆管理器接口操作
    # 底层实现（Obsidian/PostgreSQL/etc）对节点透明
    if config.export_enabled:
        memory_manager.save_paper_analysis(
            paper_id=state["paper_id"],
            key_information=state["key_information"],
            concepts=state["concepts"],
            note=state["note"]
        )
    return state

# 创建论文阅读子图
def create_paper_reading_subgraph() -> StateGraph:
    """构建论文阅读子工作流"""
    subgraph = StateGraph(PaperReadingState)
    
    # 添加节点
    subgraph.add_node("pdf_parser", pdf_parser_node)
    subgraph.add_node("section_parser", section_parser_node)
    subgraph.add_node("information_extractor", information_extractor_node)
    subgraph.add_node("concept_extractor", concept_extractor_node)
    subgraph.add_node("note_generator", note_generator_node)
    subgraph.add_node("obsidian_exporter", obsidian_exporter_node)
    
    # 设置入口点
    subgraph.set_entry_point("pdf_parser")
    
    # 添加边（线性流程）
    subgraph.add_edge("pdf_parser", "section_parser")
    subgraph.add_edge("section_parser", "information_extractor")
    subgraph.add_edge("information_extractor", "concept_extractor")
    subgraph.add_edge("concept_extractor", "note_generator")
    subgraph.add_edge("note_generator", "obsidian_exporter")
    subgraph.add_edge("obsidian_exporter", END)
    
    return subgraph.compile()

# 在主工作流中使用
# workflow.add_node("paper_reader", paper_reader)  # paper_reader 内部调用子图
```

**子图优势**：
- 模块化：论文阅读逻辑独立封装
- 可复用：可单独调用处理单篇论文
- 可测试：便于单元测试和调试
- 可扩展：易于添加新的处理步骤（如图表提取、公式解析）

### 3. 并行执行
```python
from langgraph.graph import START

# 并行检索多个数据源
workflow.add_node("arxiv_search", arxiv_retriever)
workflow.add_node("semantic_scholar_search", semantic_scholar_retriever)
workflow.add_node("pubmed_search", pubmed_retriever)

# 从 START 并行执行
workflow.add_edge(START, "arxiv_search")
workflow.add_edge(START, "semantic_scholar_search")
workflow.add_edge(START, "pubmed_search")

# 汇总结果
workflow.add_node("merge_results", merge_search_results)
workflow.add_edge("arxiv_search", "merge_results")
workflow.add_edge("semantic_scholar_search", "merge_results")
workflow.add_edge("pubmed_search", "merge_results")
```

### 4. 动态路由
```python
def route_by_paper_type(state: LiteratureResearchState) -> str:
    """根据论文类型选择不同的处理流程"""
    paper_type = state["current_paper"]["type"]
    
    if paper_type == "survey":
        return "survey_analyzer"
    elif paper_type == "experimental":
        return "experiment_analyzer"
    else:
        return "general_analyzer"

workflow.add_conditional_edges(
    "paper_classifier",
    route_by_paper_type,
    {
        "survey_analyzer": "survey_analyzer",
        "experimental_analyzer": "experiment_analyzer",
        "general_analyzer": "general_analyzer"
    }
)
```

### 5. 记忆集成

工作流节点通过统一的 MemoryManager 接口操作记忆系统，底层实现对节点透明：

```python
from labora.memory import MemoryManager

class ResearchAgent:
    def __init__(self, memory: MemoryManager):
        self.memory = memory
        self.workflow = create_research_workflow()
    
    def paper_reader_with_memory(self, state: LiteratureResearchState):
        """论文阅读节点，集成记忆系统"""
        paper_id = state["current_paper_id"]
        
        # 通过统一接口检查缓存
        cached = self.memory.get_paper(paper_id)
        if cached:
            return {"papers_read": {paper_id: cached}}
        
        # 阅读并通过统一接口保存
        analysis = llm.analyze_paper(paper_id)
        note = generate_note(analysis)
        
        # 统一接口：底层可能是 PostgreSQL/Obsidian/SQLite
        self.memory.save_paper_analysis(
            paper_id=paper_id,
            analysis=analysis,
            note=note,
            user_id=state["user_id"]
        )
        
        return {"papers_read": {paper_id: analysis}}
```

**设计原则**：
- 节点只调用 `MemoryManager` 的高层接口
- 不直接操作 Redis/PostgreSQL/Obsidian 等底层实现
- 记忆后端的切换对工作流节点完全透明
- 所有底层细节封装在 `MemoryManager` 内部
