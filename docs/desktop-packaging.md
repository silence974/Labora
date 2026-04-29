# 桌面应用打包设计

## 概述

Labora 打包为跨平台桌面应用（Windows/macOS/Linux），用户无需安装 Python 或 Node.js。

## 技术架构

```
┌─────────────────────────────────────────┐
│         Electron 桌面容器                │
│  ┌───────────────────────────────────┐  │
│  │  React + Vite + Pretext           │  │
│  │  (论文阅读器)                      │  │
│  └───────────────────────────────��───┘  │
│              ↓ HTTP                     │
│  ┌───────────────────────────────────┐  │
│  │  Python FastAPI                   │  │
│  │  (PyInstaller 打包)                │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 项目结构

```
Labora/
├── frontend/          # React + Vite + Pretext
│   ├── src/
│   │   ├── components/
│   │   │   └── PaperReader/  # 使用 Pretext 排版
│   │   └── services/
│   └── package.json
│
├── backend/           # Python FastAPI
│   ├── labora/
│   │   ├── api/
│   │   ├── core/
│   │   ├── agent/
│   │   └── memory/
│   ├── main.py
│   ├── pyproject.toml    # uv 项目配置
│   └── labora.spec       # PyInstaller 配置
│
├── desktop/           # Electron
│   ├── src/
│   │   ├── main.ts           # 主进程
│   │   └── python-manager.ts # Python 进程管理
│   └── electron-builder.yml
│
└── scripts/           # 构建脚本
    ├── build-frontend.sh
    ├── build-backend.sh
    └── build-desktop.sh
```

## 核心组件

### 1. Pretext 文本布局（前端）

**使用场景**：论文阅读器的文本排版

```typescript
// 核心：使用 Pretext 进行文本布局
import { Pretext } from 'pretext';

const pretext = new Pretext({
  canvas: canvasElement,
  width: 800,
  fontSize: 16,
  lineHeight: 24
});

pretext.layout(paperContent);
pretext.render();
```

### 2. Python 后端（FastAPI）

**核心功能**：
- 提供 REST API
- 执行 LangGraph 工作流
- 管理记忆系统

**依赖管理**：使用 uv（10-100x 快于 pip）

**打包**：使用 PyInstaller 打包为独立可执行文件

```bash
# 安装依赖
uv sync

# 打包
uv run pyinstaller labora.spec --clean
```

### 3. Electron 桌面层

**核心职责**：
- 启动和管理 Python 进程
- 加载前端页面
- 处理应用生命周期

**关键流程**：
```
启动 Electron
  ↓
启动 Python 后端进程
  ↓
等待 Python 服务就绪（轮询 /health）
  ↓
加载前端页面
  ↓
应用就绪
```

## 构建流程

### npm 分发

当前仓库支持把 Linux AppImage 包装成 npm 包。适合给已经安装 Node.js/npm 的 Linux x64 用户使用。

维护者打包：

```bash
npm run pack:npm
```

这会先执行完整桌面端打包，然后生成：

```bash
labora-desktop-0.1.0.tgz
```

本地验证安装：

```bash
npm install -g ./labora-desktop-0.1.0.tgz
labora
```

发布到 npm registry：

```bash
npm publish
```

用户安装：

```bash
npm install -g labora-desktop
labora
```

注意：npm 包内包含 AppImage，包体大小接近 AppImage 本身。当前包只声明支持 Linux x64。

### 0. Python 项目配置（pyproject.toml）
```toml
[project]
name = "labora"
version = "0.1.0"
description = "科研文献研究助手"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.104.0",
    "uvicorn>=0.24.0",
    "langgraph>=0.0.20",
    "langchain>=0.1.0",
    "redis>=5.0.0",
    "psycopg2-binary>=2.9.9",
    "pgvector>=0.2.3",
    "pypdf>=3.17.0",
    "arxiv>=2.1.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.uv]
dev-dependencies = [
    "pyinstaller>=6.0.0",
    "pytest>=7.4.0",
]
```

### 1. 前端构建
```bash
cd frontend
npm install
npm run build
# 产物：frontend/dist/
```

### 2. Python 打包
```bash
cd backend

# 安装 uv（如果未安装）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 同步依赖（自动创建虚拟环境和锁文件）
uv sync

# 使用 uv 运行 PyInstaller
uv run pyinstaller labora.spec --clean

# 产物：backend/dist/labora.exe (Windows)
```

### 3. Electron 打包
```bash
cd desktop
npm install
npm run build
npm run dist
# 产物：dist/desktop/Labora-Setup-0.1.0.exe
```

### 4. 一键构建
```bash
./scripts/build-all.sh
```

## 通信机制

### HTTP 通信
- 前端通过 HTTP 调用本地 Python API
- 地址：`http://127.0.0.1:8765`
- Python 启动时动态分配端口（避免冲突）

### 进程管理
- Electron 主进程负责启动 Python 子进程
- 应用退出时自动终止 Python 进程
- 异常时重启 Python 进程

## 配置文件

### PyInstaller 配置（labora.spec）
```python
# 关键配置
a = Analysis(
    ['main.py'],
    datas=[('labora/data', 'labora/data')],
    hiddenimports=['uvicorn.logging', ...],
)

exe = EXE(
    ...,
    name='labora',
    console=False,  # 生产环境隐藏控制台
)
```

### Electron Builder 配置
```yaml
appId: com.labora.app
productName: Labora

files:
  - frontend/**/*
  - dist/**/*

extraResources:
  - from: resources/backend
    to: backend

mac:
  target: [dmg, zip]
win:
  target: [nsis, portable]
linux:
  target: [AppImage, deb]
```

## 开发模式

### 前端开发
```bash
cd frontend && npm run dev
# http://localhost:5173
```

### 后端开发
```bash
cd backend

# 使用 uv 运行
uv run python main.py

# 或者激活虚拟环境后运行
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows
python main.py

# http://127.0.0.1:8765
```

### Electron 开发
```bash
# 终端 1: 前端
cd frontend && npm run dev

# 终端 2: 后端
cd backend && uv run python main.py

# 终端 3: Electron
cd desktop && npm run dev
```

### UI 调试（Agent Browser）
在本地开发时，可以使用 agent browser 进行 UI 自动化测试和调试：

```bash
# 前端开发服务器
cd frontend && npm run dev
# http://localhost:5173

# 后端服务
cd backend && uv run python main.py
# http://127.0.0.1:8765

# 使用 agent browser 访问前端进行调试
# Agent 可以自动测试 UI 交互、验证功能、截图等
```

**Agent Browser 使用场景**：
- 自动化 UI 功能测试
- 交互流程验证（论文阅读、搜索、标注等）
- 视觉回归测试
- 性能监控和分析

## uv 依赖管理

### 为什么使用 uv
- **极快速度**: 比 pip 快 10-100 倍
- **自动锁文件**: 自动生成 uv.lock 确保依赖一致性
- **虚拟环境管理**: 自动创建和管理 .venv
- **兼容性**: 完全兼容 pip 和 PyPI
- **Rust 实现**: 高性能、低内存占用

### 常用命令
```bash
# 初始化项目
uv init

# 安装依赖（自动创建虚拟环境）
uv sync

# 添加依赖
uv add fastapi uvicorn

# 添加开发依赖
uv add --dev pytest pyinstaller

# 运行命令
uv run python main.py
uv run pytest

# 更新依赖
uv lock --upgrade

# 导出 requirements.txt（兼容性）
uv pip compile pyproject.toml -o requirements.txt
```

## 发布流程

1. 更新版本号（pyproject.toml, package.json）
2. 同步依赖：`cd backend && uv sync`
3. 运行 `./scripts/build-all.sh`
4. 测试安装包
5. 发布到 GitHub Releases

## 关键注意事项

### 路径处理
- 使用 `path.join()` 确保跨平台
- 区分开发/生产环境的资源路径

### 进程管理
- 确保 Python 进程被正确终止
- 处理异常情况（端口占用、启动失败）

### 安全性
- 使用 `contextIsolation: true`
- 不在渲染进程使用 `nodeIntegration`

### 性能优化
- Python 使用 `--onefile` 打包
- 前端代码分割和懒加载
- 缓存常用数据
