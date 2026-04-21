# 测试方案

## 测试理念

Labora 是一个 AI 驱动的研究助手，测试需要覆盖：
- **功能正确性** - 各组件是否正常工作
- **输出质量** - AI 生成内容的质量
- **性能指标** - 响应时间、资源消耗
- **用户体验** - 人机交互的流畅度

## 测试分层

```
┌─────────────────────────────────────────┐
│  E2E 测试 (端到端用户场景)               │
├─────────────────────────────────────────┤
│  工作流测试 (LangGraph 工作流)           │
├─────────────────────────────────────────┤
│  集成测试 (组件间交互)                   │
├─────────────────────────────────────────┤
│  单元测试 (独立组件)                     │
└─────────────────────────────────────────┘
```

## 1. 单元测试

### 1.1 工具层测试

**学术搜索工具**：
```python
def test_arxiv_search():
    """测试 Arxiv 搜索工具"""
    results = arxiv_tool.search("transformer", max_results=10)
    
    # 量化指标
    assert len(results) == 10
    assert all("title" in r for r in results)
    assert all("abstract" in r for r in results)
    
    # 相关性检查（人工标注的测试集）
    relevant_count = sum(1 for r in results if is_relevant(r, "transformer"))
    precision = relevant_count / len(results)
    assert precision >= 0.7  # 至少 70% 相关
```

**量化指标**：
- ✅ **召回率 (Recall)**: 找到的相关论文 / 所有相关论文
- ✅ **精确率 (Precision)**: 相关论文 / 返回的所有论文
- ✅ **响应时间**: < 3 秒
- ✅ **成功率**: > 95%

**PDF 解析工具**：
```python
def test_pdf_parser():
    """测试 PDF 解析准确率"""
    test_pdfs = load_test_dataset()  # 人工标注的测试集
    
    for pdf_path, ground_truth in test_pdfs:
        parsed = pdf_parser.parse(pdf_path)
        
        # 章节识别准确率
        section_accuracy = calculate_section_accuracy(
            parsed["sections"], 
            ground_truth["sections"]
        )
        assert section_accuracy >= 0.85
        
        # 文本提取完整性
        text_completeness = len(parsed["text"]) / len(ground_truth["text"])
        assert 0.95 <= text_completeness <= 1.05
```

**量化指标**：
- ✅ **章节识别准确率**: > 85%
- ✅ **文本提取完整性**: 95-105%
- ✅ **处理时间**: < 10 秒/篇

### 1.2 记忆系统测试

**向量检索测试**：
```python
def test_vector_search():
    """测试向量检索质量"""
    # 准备测试数据
    papers = load_test_papers()
    memory.batch_add_papers(papers)
    
    # 测试查询
    test_queries = [
        ("attention mechanism", ["paper_1", "paper_3", "paper_5"]),
        ("transformer architecture", ["paper_2", "paper_4"]),
    ]
    
    for query, expected_ids in test_queries:
        results = memory.search_papers(query, top_k=10)
        result_ids = [r["id"] for r in results]
        
        # 计算 Precision@K
        precision_at_5 = len(set(result_ids[:5]) & set(expected_ids)) / 5
        assert precision_at_5 >= 0.6
        
        # 计算 MRR (Mean Reciprocal Rank)
        mrr = calculate_mrr(result_ids, expected_ids)
        assert mrr >= 0.7
```

**量化指标**：
- ✅ **Precision@5**: > 60%
- ✅ **Precision@10**: > 50%
- ✅ **MRR (Mean Reciprocal Rank)**: > 0.7
- ✅ **查询延迟**: < 100ms

## 2. 集成测试

### 2.1 论文阅读子图测试

```python
def test_paper_reading_subgraph():
    """测试论文阅读子图的完整流程"""
    subgraph = create_paper_reading_subgraph()
    
    test_paper_id = "arxiv:2301.12345"
    initial_state = {"paper_id": test_paper_id}
    
    # 执行子图
    start_time = time.time()
    result = subgraph.invoke(initial_state)
    execution_time = time.time() - start_time
    
    # 量化指标
    assert execution_time < 30  # 30秒内完成
    assert "key_information" in result
    assert "note" in result
    
    # 信息提取完整性（与人工标注对比）
    ground_truth = load_ground_truth(test_paper_id)
    completeness = calculate_information_completeness(
        result["key_information"],
        ground_truth
    )
    assert completeness >= 0.8  # 至少提取 80% 的关键信息
```

**量化指标**：
- ✅ **执行时间**: < 30 秒/篇
- ✅ **信息提取完整性**: > 80%
- ✅ **笔记结构完整性**: 100%（必须包含所有章节）
- ✅ **概念提取准确率**: > 75%

### 2.2 记忆系统集成测试

```python
def test_memory_integration():
    """测试记忆系统的集成"""
    memory = MemoryManager(
        short_term=RedisMemory(),
        long_term=PostgreSQLMemory(),
        graph=Neo4jMemory()
    )
    
    # 测试论文保存和检索
    paper = create_test_paper()
    paper_id = memory.save_paper_analysis(
        paper_id=paper["id"],
        analysis=paper["analysis"],
        note=paper["note"],
        user_id="test_user"
    )
    
    # 验证数据一致性
    retrieved = memory.get_paper(paper_id)
    assert retrieved["id"] == paper_id
    
    # 验证缓存命中
    start_time = time.time()
    cached = memory.get_paper(paper_id)  # 第二次应该从缓存读取
    cache_time = time.time() - start_time
    assert cache_time < 0.01  # 缓存读取 < 10ms
```

**量化指标**：
- ✅ **数据一致性**: 100%
- ✅ **缓存命中率**: > 80%
- ✅ **缓存读取延迟**: < 10ms
- ✅ **数据库写入延迟**: < 100ms

## 3. 工作流测试

### 3.1 完整工作流测试

```python
def test_collaborative_research_workflow():
    """测试完整的协作研究工作流"""
    workflow = create_collaborative_research_workflow()
    
    # 模拟用户输入
    test_cases = [
        {
            "user_input": "Transformer 在 NLP 中的应用",
            "expected_phases": ["exploration", "direction_refined", 
                               "collaborative_reading", "synthesis"],
            "max_time": 300,  # 5分钟
        }
    ]
    
    for test_case in test_cases:
        start_time = time.time()
        
        # 执行工作流（模拟用户交互）
        result = run_workflow_with_mock_user(
            workflow, 
            test_case["user_input"]
        )
        
        execution_time = time.time() - start_time
        
        # 量化指标
        assert execution_time < test_case["max_time"]
        assert result["current_phase"] == "synthesis"
        assert len(result["synthesis_report"]) > 1000  # 至少1000字
        
        # 验证经历的阶段
        phases = result["phase_history"]
        for expected_phase in test_case["expected_phases"]:
            assert expected_phase in phases
```

**量化指标**：
- ✅ **完整流程执行时间**: < 5 分钟（模拟用户交互）
- ✅ **阶段完成率**: 100%（所有必需阶段都执行）
- ✅ **综述长度**: > 1000 字
- ✅ **错误率**: < 5%

### 3.2 人机交互测试

```python
def test_interrupt_and_resume():
    """测试中断和恢复机制"""
    workflow = create_collaborative_research_workflow()
    config = {"configurable": {"thread_id": "test_thread"}}
    
    # 执行到第一个中断点
    events = list(workflow.stream(initial_state, config))
    
    # 验证中断
    last_event = events[-1]
    assert "__interrupt__" in list(last_event.values())[0]
    
    # 模拟用户响应
    user_response = {"answers": {"q1": "理论", "q2": "2020-2024"}}
    workflow.update_state(config, user_response)
    
    # 从中断点恢复
    resume_start = time.time()
    events = list(workflow.stream(None, config))
    resume_time = time.time() - resume_start
    
    # 量化指标
    assert resume_time < 1  # 恢复时间 < 1秒
    assert len(events) > 0  # 成功恢复执行
```

**量化指标**：
- ✅ **中断响应时间**: < 100ms
- ✅ **恢复时间**: < 1 秒
- ✅ **状态保持准确性**: 100%
- ✅ **中断点覆盖率**: 100%（所有中断点都测试）

## 4. 端到端测试

### 4.1 真实场景测试

```python
def test_real_research_scenario():
    """测试真实研究场景"""
    # 准备测试场景
    scenarios = [
        {
            "name": "综述型研究",
            "input": "总结近三年 Transformer 的改进工作",
            "expected_papers_count": (5, 15),
            "expected_report_sections": ["背景", "方法演进", "主要发现"],
        },
        {
            "name": "问题探索型研究",
            "input": "如何提高 Transformer 的推理效率",
            "expected_papers_count": (3, 10),
            "expected_report_sections": ["问题分析", "现有方案", "研究空白"],
        }
    ]
    
    for scenario in scenarios:
        result = run_full_research(scenario["input"])
        
        # 论文数量
        papers_count = len(result["reading_sessions"])
        assert scenario["expected_papers_count"][0] <= papers_count <= scenario["expected_papers_count"][1]
        
        # 报告结构
        report = result["synthesis_report"]
        for section in scenario["expected_report_sections"]:
            assert section in report
        
        # 报告质量（人工评估 + 自动指标）
        quality_score = evaluate_report_quality(report)
        assert quality_score >= 0.7  # 质量分 > 0.7
```

**量化指标**：
- ✅ **任务完成率**: > 90%
- ✅ **论文选择相关性**: > 80%（人工评估）
- ✅ **综述质量评分**: > 0.7（自动 + 人工）
- ✅ **用户满意度**: > 4.0/5.0

### 4.2 质量评估指标

**综述质量自动评估**：
```python
def evaluate_report_quality(report: str) -> float:
    """自动评估综述质量"""
    scores = []
    
    # 1. 结构完整性 (0-1)
    structure_score = check_report_structure(report)
    scores.append(structure_score)
    
    # 2. 内容丰富度 (0-1)
    richness_score = len(report) / 3000  # 期望 3000 字
    richness_score = min(richness_score, 1.0)
    scores.append(richness_score)
    
    # 3. 引用准确性 (0-1)
    citation_score = check_citations(report)
    scores.append(citation_score)
    
    # 4. 逻辑连贯性 (0-1) - 使用 LLM 评估
    coherence_score = llm_evaluate_coherence(report)
    scores.append(coherence_score)
    
    return sum(scores) / len(scores)
```

**人工评估维度**：
- ✅ **相关性**: 内容是否切题
- ✅ **完整性**: 是否覆盖关键方面
- ✅ **准确性**: 信息是否准确
- ✅ **可读性**: 是否易于理解
- ✅ **洞察力**: 是否有深度分析

## 5. 性能测试

### 5.1 负载测试

```python
def test_concurrent_users():
    """测试并发用户场景"""
    num_users = 10
    
    with ThreadPoolExecutor(max_workers=num_users) as executor:
        futures = []
        for i in range(num_users):
            future = executor.submit(
                run_research, 
                f"研究问题 {i}"
            )
            futures.append(future)
        
        # 等待所有任务完成
        results = [f.result() for f in futures]
    
    # 量化指标
    success_count = sum(1 for r in results if r["status"] == "success")
    success_rate = success_count / num_users
    assert success_rate >= 0.95  # 95% 成功率
```

**量化指标**：
- ✅ **并发用户数**: 支持 10+ 并发
- ✅ **成功率**: > 95%
- ✅ **平均响应时间**: < 10 秒
- ✅ **P95 响应时间**: < 30 秒

### 5.2 资源消耗测试

```python
def test_resource_usage():
    """测试资源消耗"""
    import psutil
    
    process = psutil.Process()
    
    # 记录初始状态
    initial_memory = process.memory_info().rss / 1024 / 1024  # MB
    
    # 执行研究任务
    run_research("测试问题")
    
    # 记录最终状态
    final_memory = process.memory_info().rss / 1024 / 1024
    memory_increase = final_memory - initial_memory
    
    # 量化指标
    assert memory_increase < 500  # 内存增长 < 500MB
    assert final_memory < 2000  # 总内存 < 2GB
```

**量化指标**：
- ✅ **内存使用**: < 2GB
- ✅ **CPU 使用率**: < 80%
- ✅ **磁盘 I/O**: < 100MB/s
- ✅ **网络带宽**: < 10MB/s

## 6. 回归测试

### 6.1 黄金测试集

建立一个人工标注的黄金测试集：
- 10 个典型研究问题
- 每个问题的预期输出（论文列表、综述）
- 人工评估的质量基准

```python
def test_golden_dataset():
    """黄金测试集回归测试"""
    golden_cases = load_golden_dataset()
    
    for case in golden_cases:
        result = run_research(case["input"])
        
        # 与基准对比
        paper_overlap = calculate_paper_overlap(
            result["papers"],
            case["expected_papers"]
        )
        assert paper_overlap >= 0.6  # 至少 60% 重叠
        
        # 质量不能下降
        quality = evaluate_report_quality(result["report"])
        assert quality >= case["baseline_quality"] - 0.05  # 允许 5% 波动
```

## 7. 测试基础设施

### 7.1 测试数据管理

```
tests/
├── fixtures/
│   ├── papers/          # 测试论文 PDF
│   ├── ground_truth/    # 人工标注的正确答案
│   └── golden_dataset/  # 黄金测试集
├── mocks/
│   ├── llm_mock.py      # LLM 模拟（节省成本）
│   └── api_mock.py      # API 模拟
└── utils/
    ├── metrics.py       # 评估指标计算
    └── evaluators.py    # 质量评估器
```

### 7.2 CI/CD 集成

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Unit Tests
        run: pytest tests/unit --cov
      
      - name: Integration Tests
        run: pytest tests/integration
      
      - name: E2E Tests (Nightly)
        if: github.event_name == 'schedule'
        run: pytest tests/e2e
      
      - name: Performance Tests (Weekly)
        if: github.event_name == 'schedule'
        run: pytest tests/performance
```

## 8. 监控指标

### 生产环境监控

```python
# 实时监控指标
metrics = {
    "research_completion_rate": 0.92,      # 研究完成率
    "avg_execution_time": 180,             # 平均执行时间（秒）
    "user_satisfaction": 4.2,              # 用户满意度
    "paper_relevance_score": 0.85,         # 论文相关性
    "report_quality_score": 0.78,          # 综述质量
    "error_rate": 0.03,                    # 错误率
    "cache_hit_rate": 0.82,                # 缓存命中率
}
```

## 总结

### 关键量化指标

| 类别 | 指标 | 目标值 |
|------|------|--------|
| **功能** | 单元测试覆盖率 | > 80% |
| **功能** | 集成测试通过率 | > 95% |
| **质量** | 论文相关性 | > 80% |
| **质量** | 综述质量评分 | > 0.7 |
| **性能** | 平均响应时间 | < 10s |
| **性能** | P95 响应时间 | < 30s |
| **可靠性** | 错误率 | < 5% |
| **可靠性** | 任务完成率 | > 90% |
| **用户体验** | 用户满意度 | > 4.0/5.0 |

### 测试优先级

1. **P0（每次提交）**: 单元测试、关键集成测试
2. **P1（每日）**: 完整集成测试、工作流测试
3. **P2（每周）**: E2E 测试、性能测试
4. **P3（每月）**: 黄金测试集回归、人工质量评估
