# Labora - 科研文献研究助手

基于 LangGraph 的智能文献研究助手，专注于学术文献阅读、分析和知识管理。

## 项目概述

Labora 是一个专为科研工作者设计的 AI 研究助手，能够：
- 📚 **文献检索与管理**: 自动检索学术论文、整理文献库
- 🔍 **深度阅读分析**: 理解论文内容、提取关键信息、总结要点
- 🧠 **知识图谱构建**: 建立概念关系、追踪研究脉络
- 💡 **研究问题探索**: 多轮迭代式深度研究、生成综述报告
- 📝 **笔记与标注**: 管理阅读笔记、文献标注、研究想法
- 🔗 **Obsidian 集成**: 支持导出到 Obsidian，利用双向链接和知识图谱

## 技术栈

### 桌面应用
- Electron - 桌面容器
- React + Vite - 前端框架
- Pretext - 文本布局引擎（用于论文阅读器）
- TypeScript - 类型安全

### 技术栈

- **Python 3.10+** - 核心语言
- **uv** - 依赖管理（10-100x 快于 pip）
- **FastAPI** - API 服务
- **LangGraph** - Agent 编排
- **PyInstaller** - 打包为独立可执行文件

### 记忆层
- Redis - 短期记忆/缓存
- PostgreSQL + pgvector - 长期记忆/向量检索
- Neo4j - 知识图谱（可选）
- Obsidian - 笔记管理（可选集成）

## 项目结构

```
Labora/
├── frontend/          # 前端应用
├── backend/           # 后端服务
├── shared/            # 共享代码
├── docs/              # 项目文档
└── docker-compose.yml # 容器编排
```

## 快速开始

### 开发模式

```bash
# 克隆项目
git clone <repository-url>
cd Labora

# 1. 启动后端
cd backend
uv sync
uv run python main.py --port 8765

# 2. 启动前端（新终端）
cd frontend
npm install
npm run dev

# 3. 启动 Electron（新终端）
cd desktop
npm install
npm run dev
```

### 构建桌面应用

```bash
# 完整构建
./scripts/build-all.sh

# 或分步构建
./scripts/build-frontend.sh   # 构建前端
./scripts/build-backend.sh    # 打包 Python
./scripts/build-desktop.sh    # 打包 Electron

# 安装包位于 dist/desktop/
```

## 使用方式

### 桌面应用（推荐）
下载并安装适合你操作系统的版本：
- Windows: `Labora-Setup-0.1.0.exe`
- macOS: `Labora-0.1.0.dmg`
- Linux: `Labora-0.1.0.AppImage`

双击启动，无需安装 Python 或 Node.js。

### CLI 模式（开发者）
```bash
# 安装
pip install labora

# 交互式研究助手
labora chat

# 执行文献研究
labora research "Transformer 模型的最新进展" -o report.md

# 阅读单篇论文
labora read arxiv:2301.12345 --save-notes

# 搜索论文
labora search "attention mechanism" --source arxiv --year 2020-2024

# 管理文献库
labora library add paper.pdf --tags "NLP,Transformer"
labora library search "BERT"

# 启动 Web 服务
labora serve
```

### Web 模式（开发者）
```bash
# 启动服务
labora serve --port 8000

# 访问 Web 界面
# http://localhost:8000
```

## 文档

详细文档请查看 [docs/](docs/) 目录：

### 核心设计文档（6 个）
- [整体架构](docs/architecture.md) - 系统架构、技术选型、CLI/API 设计
- [桌面应用打包](docs/desktop-packaging.md) - Electron + Python 打包方案
- [文献研究工作流](docs/literature-workflow.md) - LangGraph 人机协作工作流
- [记忆系统](docs/memory.md) - 可插拔的三层记忆架构
- [测试方案](docs/testing.md) - 包含量化指标的完整测试方案
- [MVP 任务清单](docs/mvp-tasks.md) - 10 个任务、每个任务含可验收标准

### 快速链接
- **技术栈**：Electron + React + Pretext + Python + uv + FastAPI + LangGraph
- **核心功能**：文献检索、深度阅读、知识图谱、研究综述
- **部署方式**：桌面应用（主推）、CLI、Web（可选）

## 许可证

MIT License
