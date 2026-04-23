# MVP 任务清单

## MVP 范围

MVP 聚焦核心价值：用户输入研究方向 → 协作式文献检索与阅读 → 生成研究综述。

**不包含**：知识图谱（Neo4j）、Obsidian 集成、CLI 模式、高级并行检索

---

## Task 1: 项目脚手架 ✅

**描述**：建立 frontend / backend / desktop 三层项目结构，并完成开发环境的联调。

**验收标准**：
- [x] `cd backend && uv run python main.py` 启动成功，`GET /health` 返回 `{"status": "ok"}`
- [x] `cd frontend && npm run dev` 启动成功，浏览器访问 `localhost:5173` 看到应用页面
- [x] 前端能通过 `fetch` 调用后端 `/health` 并显示状态
- [ ] ~~`cd desktop && npm run dev` 启动成功~~（暂缓，专注 Web 模式）
- [ ] ~~Electron 启动时自动拉起 Python 进程~~（暂缓，专注 Web 模式）

**完成时间**：2026-04-22

---

## Task 2: 可插拔记忆系统（MVP 实现） ✅

**描述**：实现 `IShortTermMemory`、`ILongTermMemory` 接口，提供 MVP 所需的两个具体实现。

**验收标准**：
- [x] `InMemoryCache` 通过 `IShortTermMemory` 接口的所有单元测试（set/get/delete/TTL）
- [x] `SQLiteMemory` 通过 `ILongTermMemory` 接口的所有单元测试（add_paper/search_papers/add_note）
- [x] `MemoryManager` 可通过配置文件切换后端，切换后单元测试全部通过
- [x] `MemoryManager.save_paper_analysis()` 调用后，数据可通过 `get_paper()` 正确取回
- [x] 代码中没有对 SQLite/内存直接操作，全部通过接口访问

**测试结果**：20 个单元测试全部通过  
**完成时间**：2026-04-22

---

## Task 3: 学术搜索工具 ✅

**描述**：实现 ArXiv 搜索工具，能够根据查询词返回论文列表。

**验收标准**：
- [x] `arxiv_tool.search("attention mechanism", max_results=10)` 在 3 秒内返回结果
- [x] 返回结果包含 `title`、`abstract`、`authors`、`arxiv_id`、`year` 字段
- [x] 搜索 "Attention Is All You Need" 时，原始论文出现在前 3 条结果中
- [x] 网络不可用时抛出明确的异常，而不是静默失败
- [x] 有对应的单元测试（使用 mock HTTP 响应，不依赖真实网络）

**测试结果**：8 个单元测试全部通过（包含真实 API 调用和 mock 测试）  
**完成时间**：2026-04-22

---

## Task 4: PDF 解析工具

**描述**：实现 PDF 解析工具，提取论文各章节的文本内容。

**验收标准**：
- [ ] 解析一篇标准的 ArXiv 论文 PDF，在 10 秒内返回结果
- [ ] 能正确识别并提取 abstract、introduction、method、conclusion 章节
- [ ] 提取的文本字符数 ≥ 原始 PDF 文字字符数的 90%
- [ ] 对 10 篇测试 PDF（来自 `tests/fixtures/papers/`）章节识别准确率 ≥ 80%
- [ ] 无法解析时返回降级结果（至少返回全文文本），不崩溃

---

## Task 5: 论文阅读子图

**描述**：实现 LangGraph 论文阅读子图（pdf_parser → section_parser → information_extractor → concept_extractor → note_generator）。

**验收标准**：
- [ ] 子图可独立调用：`subgraph.invoke({"paper_id": "arxiv:2301.12345"})` 正常返回
- [ ] 返回结果包含 `key_information`（背景/方法/贡献/局限性）和 `note`（Markdown 格式）
- [ ] 对 5 篇标注论文，`key_information` 中关键贡献的提取 F1 ≥ 0.7
- [ ] 完整执行时间 < 60 秒/篇
- [ ] 子图节点不直接调用记忆系统底层，全部通过 `MemoryManager` 接口

---

## Task 6: 协作研究主工作流

**描述**：实现 LangGraph 主工作流（Initial Explorer → Question Generator → Direction Refiner → Core Paper Selector → Collaborative Reader → Knowledge Organizer → Synthesizer），支持中断和恢复。

**验收标准**：
- [ ] 输入研究问题，工作流能走完全部阶段并输出综述报告
- [ ] 6 个中断点（`__interrupt__`）均能正确暂停，等待用户输入后继续
- [ ] 用户回答问题后，LangGraph Checkpointer 能正确恢复工作流状态，不丢失上下文
- [ ] 综述报告长度 ≥ 800 字，包含"研究背景"和"主要发现"两个部分
- [ ] 工作流异常终止时，有明确的错误信息，不静默挂起

**设计说明**：
- 实现 `SQLiteCheckpointer` 继承 LangGraph 的 `BaseCheckpointSaver`，用于工作流状态管理
- 与 Task 2 的 `MemoryManager` 职责分离：
  - `MemoryManager` - 业务数据（论文、笔记）
  - `SQLiteCheckpointer` - 工作流状态（LangGraph checkpoint）

---

## Task 7: 研究交互界面（前端）

**描述**：实现研究工作流的前端交互界面，包括问题输入、中断点响应、进度展示。

**验收标准**：
- [ ] 用户输入研究方向后，能看到当前工作流阶段的状态（探索中 / 等待回答 / 阅读中）
- [ ] 中断点出现时，界面弹出对应的交互组件（问答 / 确认 / 选择），样式正确
- [ ] 工作流进度可视化：已完成阶段 / 当前阶段 / 剩余阶段清晰可见
- [ ] 综述报告以 Markdown 形式渲染，标题、列表、段落格式正确
- [ ] agent browser 可以完成"输入问题 → 回答问题 → 查看综述"的完整操作路径

---

## Task 8: 论文阅读器（前端）

**描述**：实现论文阅读器组件，展示阅读子图输出的结构化内容，支持用户添加笔记。

**验收标准**：
- [ ] 能展示论文的 title、abstract、key_information（各章节分块显示）
- [ ] 用户可以在阅读器中输入笔记，笔记通过 API 保存，刷新后不丢失
- [ ] 概念列表中的每个概念可以点击查看定义或相关论文
- [ ] agent browser 可完成"打开论文 → 阅读内容 → 添加笔记"的操作路径
- [ ] 论文加载中有 loading 状态，加载失败有错误提示

---

## Task 9: API 层与前后端集成

**描述**：实现 FastAPI 接口层，完成前后端完整联调。

**验收标准**：
- [ ] `POST /api/research/start` 能启动工作流并返回 `task_id`
- [ ] `GET /api/research/{task_id}/status` 返回当前阶段和中断信息
- [ ] `POST /api/research/{task_id}/respond` 提交用户回答并恢复工作流
- [ ] WebSocket `/ws/{task_id}` 能实时推送工作流进度事件
- [ ] 前端通过以上接口完成完整研究流程，无需手动刷新页面

---

## Task 10: Electron 打包与 MVP 验收

**描述**：完成 Electron 桌面应用打包，进行端到端验收测试。

**验收标准**：
- [ ] `./scripts/build-all.sh` 一键构建成功，产出对应平台的安装包
- [ ] 安装后双击启动，无需手动配置 Python 或 Node.js
- [ ] 完整走通以下场景：输入研究方向 → 回答 AI 提问 → 协作阅读 2 篇论文 → 查看综述
- [ ] 以上场景在全新机器上（无开发环境）执行成功
- [ ] 应用退出时 Python 进程被正确终止（`ps aux` 中无残留进程）

---

## 任务依赖关系

```
Task 1 (脚手架)
  ├── Task 2 (记忆系统)
  │     └── Task 5 (阅读子图)
  │           └── Task 6 (主工作流)
  ├── Task 3 (搜索工具) ──→ Task 6
  ├── Task 4 (PDF 解析) ──→ Task 5
  ├── Task 7 (研究界面)
  │     └── Task 9 (API 集成) ──→ Task 10 (打包)
  └── Task 8 (阅读器) ──→ Task 9
```

**关键路径**：Task 1 → 2 → 5 → 6 → 9 → 10

## MVP 完成定义

- [ ] 所有 10 个任务的验收标准全部通过
- [ ] 端到端场景在打包后的应用上可复现
- [ ] 核心路径无阻断性 Bug
