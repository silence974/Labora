# Labora - 科研文献研究助手

基于 LangGraph 的智能文献研究助手，专注于学术文献阅读、分析和知识管理。

## 项目概述

Labora 是一个专为科研工作者设计的 AI 研究助手，能够：
- 📚 **文献检索与管理**: 自动检索学术论文（ArXiv）、整理文献库
- 🔍 **深度阅读分析**: 理解论文内容、提取关键信息、总结要点
- 💡 **研究问题探索**: 多轮迭代式深度研究、生成综述报告
- 📝 **笔记与标注**: 自动生成阅读笔记、文献标注

## 功能特性

### 核心功能
- **研究工作流**：输入研究问题 → 自动探索文献 → 选择核心论文 → 协作阅读 → 生成综述报告
- **论文阅读器**：输入 ArXiv ID → 自动解析 LaTeX 源码 → 提取关键信息 → 生成结构化笔记
- **可插拔记忆系统**：支持短期缓存（InMemoryCache）和长期存储（SQLite）
- **学术搜索**：集成 ArXiv API，支持关键词搜索和论文详情获取

### 技术架构
- **后端**：FastAPI + LangGraph + LangChain + OpenAI
- **前端**：React + TypeScript + Vite
- **数据库**：SQLite（论文和笔记存储）
- **工具**：ArXiv API + LaTeX 解析

## 快速开始

### 前置要求
- Python 3.10+
- Node.js 18+
- uv（Python 包管理器）
- OpenAI API Key

### 1. 配置 API 密钥

创建 `.env` 文件（或使用 `~/.config/labora/config.json`）：

```bash
# 方式 1：使用 .env 文件
cp .env.example .env
# 编辑 .env 文件，填入你的 OpenAI API Key

# 方式 2：使用 JSON 配置文件
mkdir -p ~/.config/labora
cp config.json.example ~/.config/labora/config.json
# 编辑 config.json 文件
```

详见 [配置文档](docs/configuration.md)

### 2. 启动后端

```bash
cd backend
uv sync
uv run python main.py
```

后端将在 `http://127.0.0.1:8765` 启动

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端将在 `http://localhost:5173` 启动

### 4. 访问应用

在浏览器中打开 `http://localhost:5173`

## 使用指南

### 研究工作流

1. 点击"研究工作流"标签
2. 输入研究问题，例如：
   - "What are the recent advances in transformer architectures?"
   - "How does attention mechanism work in NLP?"
3. 点击"开始研究"
4. 等待工作流完成（约 1-2 分钟）
5. 查看生成的综述报告

### 论文阅读器

1. 点击"论文阅读器"标签
2. 输入 ArXiv ID，例如：
   - `1706.03762`（Attention Is All You Need）
   - `arxiv:1706.03762`（带前缀也可以）
3. 点击"开始阅读"
4. 等待阅读完成（约 10-20 秒）
5. 查看提取的关键信息和生成的笔记

## 项目结构

```
Labora/
├── backend/                 # 后端服务
│   ├── labora/
│   │   ├── agent/          # LangGraph 工作流
│   │   │   ├── paper_reader.py      # 论文阅读子图
│   │   │   └── research_workflow.py # 研究主工作流
│   │   ├── api/            # FastAPI 路由
│   │   │   └── routes/
│   │   │       ├── research.py      # 研究工作流 API
│   │   │       └── papers.py        # 论文相关 API
│   │   ├── core/           # 核心配置
│   │   │   └── config.py            # 配置管理
│   │   ├── memory/         # 记忆系统
│   │   │   ├── interface.py         # 抽象接口
│   │   │   ├── short_term.py        # 短期缓存
│   │   │   ├── long_term.py         # 长期存储
│   │   │   └── manager.py           # 记忆管理器
│   │   └── tools/          # 工具集
│   │       ├── arxiv_tool.py        # ArXiv 搜索
│   │       └── latex_parser.py      # LaTeX 解析
│   ├── tests/              # 测试（60+ 个测试）
│   └── main.py             # 入口文件
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── components/
│   │   │   ├── ResearchWorkflow.tsx # 研究工作流组件
│   │   │   └── PaperReader.tsx      # 论文阅读器组件
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── docs/                   # 文档
│   ├── mvp-tasks.md        # MVP 任务清单
│   └── configuration.md    # 配置说明
└── README.md
```

## API 文档

### 研究工作流 API

- `POST /api/research/start` - 启动研究任务
- `GET /api/research/{task_id}/status` - 查询任务状态
- `GET /api/research/{task_id}/result` - 获取研究结果
- `GET /api/research/` - 列出所有任务
- `DELETE /api/research/{task_id}` - 删除任务

### 论文相关 API

- `POST /api/papers/search` - 搜索论文
- `GET /api/papers/{paper_id}` - 获取论文详情
- `POST /api/papers/read` - 启动论文阅读任务
- `GET /api/papers/read/{task_id}/status` - 查询阅读任务状态
- `GET /api/papers/read/{task_id}/result` - 获取阅读结果

## 测试

### 运行所有测试

```bash
cd backend
uv run pytest tests/ -v
```

### 运行特定测试

```bash
# 记忆系统测试
uv run pytest tests/memory/ -v

# 工具测试
uv run pytest tests/tools/ -v

# Agent 测试
uv run pytest tests/agent/ -v

# API 测试
uv run pytest tests/api/ -v
```

### 测试统计

- 总测试数：60+
- 单元测试：全部通过
- 集成测试：需要 OPENAI_API_KEY

## 开发

### 后端开发

```bash
cd backend

# 安装依赖
uv sync

# 运行测试
uv run pytest

# 启动开发服务器
uv run python main.py
```

### 前端开发

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## MVP 完成情况

- ✅ Task 1: 项目脚手架
- ✅ Task 2: 可插拔记忆系统
- ✅ Task 3: ArXiv 搜索工具
- ✅ Task 4: LaTeX 解析工具
- ✅ Task 5: 论文阅读子图
- ✅ Task 6: 协作研究主工作流
- ✅ Task 7: 研究交互界面
- ✅ Task 8: 论文阅读器
- ✅ Task 9: API 层与前后端集成
- ⚠️ Task 10: Electron 打包（暂缓，Web 模式可用）

详见 [MVP 任务清单](docs/mvp-tasks.md)

## 文档

详细文档请查看 [docs/](docs/) 目录：
- [MVP 任务清单](docs/mvp-tasks.md) - 10 个任务、每个任务含可验收标准
- [配置说明](docs/configuration.md) - API 密钥配置方式

## 许可证

MIT License
