# 记忆系统设计

## 概述

Labora 的记忆系统负责存储和检索以下信息：

- 会话上下文
- 文献元数据与本地文件
- 阅读笔记与深读结果
- 研究过程产物（问题、报告、摘要、知识关系）

核心原则有两点：

1. 文献库不是独立于记忆系统之外的附属模块，而是长期记忆中的一个核心子域。
2. 搜索、下载、打开、解析、深读、记笔记，应该围绕同一份 canonical paper record 演进，而不是散落在多个互不相干的表或服务里。

---

## 设计目标

### 1. 单一事实来源

每篇文献在系统里只应该有一个主记录，统一承载：

- 外部来源标识：`arXiv`、`DOI`、`URL`
- 基础元数据：标题、作者、摘要、年份、标签
- 本地状态：是否下载、文件路径、校验信息
- 内容状态：是否解析、是否切块、是否已向量化
- 使用状态：最近打开时间、最近下载时间、最近分析时间

### 2. 本地优先，联网可选

记忆系统必须支持两种搜索模式：

- 本地搜索：只查已进入记忆系统的文献
- 联网搜索：查询外部来源，并和本地记忆合并，标记哪些结果已经下载到本地

### 3. 可插拔但不割裂

短期记忆、长期记忆、图记忆仍然保持可插拔；但“文献存储区”必须被抽象为长期记忆接口的一部分，而不是单独绕开 `MemoryManager` 的旁路服务。

---

## 分层架构

```
记忆系统
├── 短期记忆 IShortTermMemory
│   ├── 会话上下文
│   ├── 任务状态
│   └── 热门文献缓存
│
├── 长期记忆 ILongTermMemory
│   ├── 文献存储区 Literature Store
│   ├── 阅读笔记区 Notes Store
│   ├── 对话归档区 Conversation Store
│   └── 研究成果区 Research Store
│
└── 图记忆 IGraphMemory（可选）
    ├── 引用关系
    ├── 论文-概念关系
    └── 作者/主题关系
```

---

## 当前实现缺口

结合当前代码，现阶段的缺口主要有：

- `SQLiteMemory` 里的 `papers` 表只够存最基础的论文信息，不足以表达下载状态、本地文件、解析状态和访问历史。
- 阅读笔记 `reading_notes` 已经在长期记忆里，但它依赖的文献主记录仍然过于薄弱。
- 文献搜索/下载近期引入了单独的 `LiteratureLibrary` 服务，这说明系统已经有“文献库”的需求，但它还没有正式并入记忆系统抽象。
- `MemoryManager` 目前只暴露了 `add_paper/get_paper/search_papers/add_note/get_notes`，缺少文献库所需的高层操作。

所以接下来的设计目标不是“再加一个表”，而是把“文献库”提升为长期记忆中的一级能力。

---

## 长期记忆的内部子域

### 1. 文献存储区

负责存储论文本体及其本地化状态，是本次补全设计的重点。

### 2. 阅读笔记区

负责存储用户笔记、AI 深读摘要、引用片段、批注等，全部通过 `paper_id` 关联到文献存储区。

### 3. 对话归档区

负责存储研究会话中的问题、用户反馈、agent 推理结果，供后续恢复上下文和回顾研究轨迹。

### 4. 研究成果区

负责存储综述、研究报告、问题拆解、候选方向和最终输出物。

---

## 文献存储区设计

### 文献主键策略

每篇文献需要一个稳定的 `paper_id`，作为系统内主键。

推荐规则：

- arXiv 论文：`arxiv:1706.03762`
- DOI 论文：`doi:10.1145/1234567`
- 仅 URL 可识别的网页/报告：`url:<normalized_hash>`
- 用户导入本地文件：`local:<file_hash>`

同时保留来源侧字段：

- `source`: `arXiv` / `DOI` / `URL` / `local`
- `source_id`: 例如 `1706.03762`
- `doi`
- `url`

这样可以同时满足：

- 统一内部关联
- 多来源去重
- 支持后续扩展非 arXiv 论文源

### 文献生命周期

一篇文献在系统中的状态流转建议如下：

1. `discovered`
   通过本地搜索或联网搜索被发现，但尚未下载
2. `downloaded`
   PDF 或源码已下载到本地
3. `parsed`
   文本、章节或 chunk 已解析完成
4. `embedded`
   已生成向量，可参与语义检索
5. `analyzed`
   已产生深读摘要、关键观点、阅读笔记或知识关系

这些状态不一定要用单一枚举字段硬编码，但需要在数据模型中可推导、可查询。

### 存储职责

文献存储区至少需要负责以下信息：

### 元数据层

- 标题
- 作者
- 摘要
- 年份
- venue / journal / conference
- 标签、分类
- 来源链接

### 本地文件层

- 是否已下载
- 本地文件路径
- 文件类型：pdf / tex / markdown / txt
- 文件大小
- 文件 hash
- MIME type
- 下载时间

### 内容解析层

- 原始全文文本
- 分章节文本
- 切块结果
- parser 版本
- 解析时间
- 解析状态

### 使用状态层

- 最近访问时间
- 最近打开时间
- 最近下载时间
- 最近分析时间
- 是否收藏 / 置顶

---

## 逻辑数据模型

为了兼顾 SQLite 和 PostgreSQL，逻辑上建议拆成 3 个文献子表；阅读笔记表继续单独存在，但通过 `paper_id` 依附于文献主记录。在轻量实现里也可以折叠进 JSON 字段，但逻辑边界应保持一致。

### 1. `literature_items`

文献主表，负责 canonical metadata。

```sql
CREATE TABLE literature_items (
    paper_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    doi TEXT,
    title TEXT NOT NULL,
    abstract TEXT,
    authors TEXT NOT NULL,          -- SQLite: JSON string; PG: TEXT[]
    year TEXT,
    venue TEXT,
    url TEXT,
    pdf_url TEXT,
    tags TEXT NOT NULL,             -- SQLite: JSON string; PG: TEXT[]
    status TEXT NOT NULL DEFAULT 'discovered',
    first_seen_at TIMESTAMP,
    last_accessed_at TIMESTAMP,
    last_opened_at TIMESTAMP,
    downloaded_at TIMESTAMP,
    parsed_at TIMESTAMP,
    analyzed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data TEXT                       -- 扩展字段 / 原始 metadata JSON
);
```

### 2. `literature_files`

文献文件表，负责本地文件和下载状态。

```sql
CREATE TABLE literature_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    file_type TEXT NOT NULL,        -- pdf / tex / txt / md
    storage_backend TEXT NOT NULL,  -- local / s3 / oss
    local_path TEXT,
    remote_url TEXT,
    file_hash TEXT,
    size_bytes INTEGER,
    mime_type TEXT,
    is_primary BOOLEAN DEFAULT TRUE,
    downloaded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES literature_items(paper_id)
);
```

### 3. `literature_contents`

文献内容表，负责解析结果和后续检索输入。

```sql
CREATE TABLE literature_contents (
    paper_id TEXT PRIMARY KEY,
    abstract_text TEXT,
    full_text TEXT,
    sections_json TEXT,
    chunk_count INTEGER DEFAULT 0,
    parse_status TEXT DEFAULT 'pending',
    embedding_status TEXT DEFAULT 'pending',
    parser_version TEXT,
    parsed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES literature_items(paper_id)
);
```

### 4. `reading_notes`

阅读笔记表可以沿用现有设计，但它应明确依附于文献存储区，而不是孤立存在。

```sql
CREATE TABLE reading_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES literature_items(paper_id)
);
```

---

## 检索设计

### 本地搜索

本地搜索应优先针对 `literature_items` 做 metadata 检索：

- `paper_id`
- `title`
- `abstract`
- `authors`
- `tags`
- `year`
- `source`

如果 `literature_contents` 已存在解析结果，还可以扩展到：

- 全文关键词检索
- chunk 级别语义检索

### 联网搜索

联网搜索不直接写数据库作为强制动作，而是分两步：

1. 查询外部来源（当前可先支持 arXiv）
2. 用 `paper_id` 回查本地文献存储区，补齐：
   - `is_downloaded`
   - `local_path`
   - 最近访问时间
   - 是否已解析 / 已分析

这样联网结果既保留“外部最新结果”，又能即时展示“是否已下载到本地”。

### 推荐的搜索行为

- 开关关闭：只搜本地文献库
- 开关开启：查外部来源，并回查本地状态
- 本地搜索结果一定来自长期记忆
- 联网搜索结果可以是临时结果，但一旦用户打开、下载或深读，就应写回文献存储区

---

## 长期记忆接口补全

当前 `ILongTermMemory` 只有基础论文和笔记接口，不足以表达文献库能力。建议扩展为下面这组接口。

```python
class ILongTermMemory(ABC):
    # ---------- 文献主记录 ----------
    @abstractmethod
    def upsert_literature(self, paper: Dict) -> str:
        """创建或更新文献主记录"""

    @abstractmethod
    def get_literature(self, paper_id: str) -> Optional[Dict]:
        """获取文献主记录"""

    @abstractmethod
    def search_literature(
        self,
        query: str,
        top_k: int = 10,
        year: Optional[str] = None,
        source: Optional[str] = None,
    ) -> List[Dict]:
        """搜索本地文献库"""

    @abstractmethod
    def list_recent_literature(self, limit: int = 10) -> List[Dict]:
        """获取最近访问的文献"""

    @abstractmethod
    def mark_literature_accessed(self, paper_id: str) -> bool:
        """记录访问时间"""

    # ---------- 本地文件 ----------
    @abstractmethod
    def attach_literature_file(self, paper_id: str, file_info: Dict) -> bool:
        """挂接本地文件，并更新下载状态"""

    @abstractmethod
    def get_literature_files(self, paper_id: str) -> List[Dict]:
        """获取文献文件列表"""

    # ---------- 内容解析 ----------
    @abstractmethod
    def save_literature_content(self, paper_id: str, content: Dict) -> bool:
        """保存解析结果，如全文、章节、chunk"""

    @abstractmethod
    def get_literature_content(self, paper_id: str) -> Optional[Dict]:
        """获取解析结果"""

    # ---------- 兼容现有论文接口 ----------
    @abstractmethod
    def add_paper(self, paper: Dict) -> str:
        """兼容旧接口，内部应委托给 upsert_literature"""

    @abstractmethod
    def get_paper(self, paper_id: str) -> Optional[Dict]:
        """兼容旧接口，内部应委托给 get_literature"""

    @abstractmethod
    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        """兼容旧接口，可作为 search_literature 的简化包装"""

    # ---------- 笔记 ----------
    @abstractmethod
    def add_note(self, paper_id: str, user_id: str, note: Dict) -> int:
        """添加阅读笔记"""

    @abstractmethod
    def get_notes(self, paper_id: str, user_id: str) -> List[Dict]:
        """获取阅读笔记"""
```

关键点：

- `add_paper/get_paper/search_papers` 可以保留，避免一次性打断现有代码。
- 但从设计上看，新的主接口应该是 `upsert_literature/get_literature/search_literature`。

---

## MemoryManager 高层接口建议

`MemoryManager` 需要把“文献库”提升为一级能力，而不是只暴露论文 CRUD。

```python
class MemoryManager:
    # ---------- 文献 ----------
    def upsert_literature(self, paper: Dict) -> str: ...
    def get_literature(self, paper_id: str) -> Optional[Dict]: ...
    def search_literature(self, query: str, top_k: int = 10, **filters) -> List[Dict]: ...
    def list_recent_literature(self, limit: int = 10) -> List[Dict]: ...
    def mark_literature_accessed(self, paper_id: str) -> bool: ...

    # ---------- 文件 ----------
    def attach_literature_file(self, paper_id: str, file_info: Dict) -> bool: ...
    def get_literature_files(self, paper_id: str) -> List[Dict]: ...

    # ---------- 解析内容 ----------
    def save_literature_content(self, paper_id: str, content: Dict) -> bool: ...
    def get_literature_content(self, paper_id: str) -> Optional[Dict]: ...

    # ---------- 兼容旧接口 ----------
    def add_paper(self, paper: Dict) -> str: ...
    def get_paper(self, paper_id: str) -> Optional[Dict]: ...
    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]: ...
```

建议缓存策略：

- `paper:{paper_id}` 缓存文献主记录
- `paper:{paper_id}:content` 缓存解析内容
- `search:local:{query_hash}` 可选缓存本地搜索结果

---

## 与搜索、下载、深读流程的关系

文献存储区需要成为下面流程的统一落点：

### 1. 搜索

- 本地搜索：直接查 `search_literature`
- 联网搜索：查外部，再回查 `get_literature`

### 2. 打开论文

- 若本地已有记录：更新 `last_opened_at` / `last_accessed_at`
- 若只是联网结果首次打开：先 `upsert_literature` 再打开

### 3. 下载论文

- 下载完成后调用 `attach_literature_file`
- 同步更新主表状态为 `downloaded`

### 4. 解析全文

- 解析完成后调用 `save_literature_content`
- 状态更新为 `parsed` / `embedded`

### 5. 深度阅读

- 深读结果和用户笔记都通过 `paper_id` 回写长期记忆
- 主表更新时间 `analyzed_at`

---

## SQLite 与 PostgreSQL 的实现建议

### SQLite 版本

适合作为当前单机开发和桌面应用默认实现：

- `authors/tags/sections_json/data` 使用 JSON string
- 本地搜索以 `LIKE` 为主
- 向量检索后续可延迟引入
- 优先保证“文献主记录 + 下载状态 + 最近访问”闭环

### PostgreSQL + pgvector 版本

适合作为默认生产设计：

- `authors/tags` 使用数组或 JSONB
- `data`、`sections_json` 使用 JSONB
- `full_text` 可配 `tsvector`
- chunk embedding 存 `pgvector`

---

## 与当前代码的映射关系

当前代码里已经出现了两个相关方向：

1. `backend/labora/memory/long_term.py`
   目前只有简化版 `papers` / `reading_notes`
2. `backend/labora/services/literature_library.py`
   已开始承担“本地文献库”的职责

设计上的结论应该是：

- `LiteratureLibrary` 不应长期停留在 memory 体系之外
- 它的职责最终应并入 `ILongTermMemory` 的一个实现中
- `MemoryManager` 应成为唯一稳定入口

可以把 `LiteratureLibrary` 看成“文献存储区”的前置原型，但最终不应与记忆系统并行存在两套抽象。

---

## 迁移计划

### Phase 1：接口补全

- 在 `ILongTermMemory` 中增加文献库接口
- 在 `MemoryManager` 中增加对应高层方法
- 保留旧接口作为兼容包装

### Phase 2：SQLite 落地

- 扩展 `SQLiteMemory`，正式引入：
  - `literature_items`
  - `literature_files`
  - `literature_contents`
- 将现有 `LiteratureLibrary` 逻辑迁移进去

### Phase 3：业务接线

- 搜索 API 改为通过 `MemoryManager.search_literature`
- 下载 API 改为通过 `MemoryManager.attach_literature_file`
- 深读结果改为通过 `MemoryManager.save_literature_content` 和 `add_note`

### Phase 4：高级检索

- 增加全文检索
- 增加 chunk 向量检索
- 增加图记忆关联

---

## 最终结论

文献存储区应该被明确设计为长期记忆中的核心子域，而不是“下载功能顺手写出来的一个本地缓存表”。

补全后的记忆系统应满足：

- 能存文献元数据
- 能存本地文件状态
- 能记录最近访问与下载状态
- 能承接全文解析和深读结果
- 能在联网搜索结果中标记本地下载状态
- 能通过 `MemoryManager` 统一读写

这会让后续的搜索、下载、阅读、深读、笔记、综述都围绕同一份文献主记录展开，避免系统继续分叉。
