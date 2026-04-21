# 记忆系统设计

## 概述

记忆系统负责存储和检索对话历史、论文数据、研究成果和知识图谱。采用**可插拔的三层架构**：短期记忆、长期记忆和图记忆。

## 核心概念

**知识库是记忆系统的一部分**：
- 用户的论文、笔记、研究报告都存储在**长期记忆**中
- 不区分"知识库"和"记忆"，统一为"记忆系统"

**可插拔架构**：
- 整个记忆系统可插拔（可替换为自定义实现）
- 各层组件独立可插拔（短期/长期/图记忆可单独替换或禁用）
- 基于接口编程，支持多种后端实现

## 三层架构

```
记忆系统（可插拔）
├── 短期记忆接口 (IShortTermMemory)
│   ├── RedisMemory（默认实现）
│   ├── InMemoryCache（轻量级实现）
│   └── 自定义实现...
│
├── 长期记忆接口 (ILongTermMemory)
│   ├── PostgreSQLMemory + pgvector（默认实现）
│   ├── SQLiteMemory（单机实现）
│   └── 自定义实现...
│
└── 图记忆接口 (IGraphMemory，可选)
    ├── Neo4jMemory（默认实现）
    ├── NetworkXMemory（内存图）
    └── 自定义实现...
```

## 1. 短期记忆（Redis）

### 接口定义
```python
class IShortTermMemory(ABC):
    @abstractmethod
    def set(self, key: str, value: Any, ttl: int = None) -> bool:
        """设置缓存"""
        
    @abstractmethod
    def get(self, key: str) -> Any:
        """获取缓存"""
        
    @abstractmethod
    def delete(self, key: str) -> bool:
        """删除缓存"""
        
    @abstractmethod
    def exists(self, key: str) -> bool:
        """检查键是否存在"""
```

### 默认实现：RedisMemory
**用途**：
- 会话上下文缓存（最近 N 条消息）
- 任务状态追踪
- 实时数据交换

**数据结构**：
```
session:{session_id}:context = {
    "messages": [...],
    "current_paper": "...",
    "user_id": "..."
}
TTL: 1 hour

task:{task_id}:status = {
    "status": "running",
    "progress": 0.6,
    "current_node": "paper_reader"
}
TTL: 24 hours
```

### 替代实现
- **InMemoryCache**: 进程内内存缓存，适合单机开发
- **Memcached**: 分布式缓存替代方案

## 2. 长期记忆（PostgreSQL + pgvector）

### 接口定义
```python
class ILongTermMemory(ABC):
    @abstractmethod
    def add_paper(self, paper: Dict) -> str:
        """添加论文"""
        
    @abstractmethod
    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        """搜索论文（向量 + 关键词混合检索）"""
        
    @abstractmethod
    def get_paper(self, paper_id: str) -> Dict:
        """获取论文详情"""
        
    @abstractmethod
    def add_note(self, paper_id: str, user_id: str, note: Dict) -> int:
        """添加阅读笔记"""
        
    @abstractmethod
    def save_conversation(self, session_id: str, user_id: str, 
                         role: str, content: str) -> int:
        """保存对话历史"""
```

### 默认实现：PostgreSQLMemory + pgvector

### 核心表结构

```sql
-- 论文表
CREATE TABLE papers (
    id VARCHAR(255) PRIMARY KEY,
    title TEXT,
    authors TEXT[],
    abstract TEXT,
    content TEXT,
    year INT,
    arxiv_id VARCHAR(50),
    pdf_path VARCHAR(500),
    embedding vector(1536)
);

-- 阅读笔记表
CREATE TABLE reading_notes (
    id SERIAL PRIMARY KEY,
    paper_id VARCHAR(255),
    user_id VARCHAR(255),
    summary TEXT,
    key_contributions TEXT[],
    personal_notes TEXT,
    tags TEXT[]
);

-- 研究报告表
CREATE TABLE research_reports (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    title VARCHAR(500),
    question TEXT,
    content TEXT,
    paper_ids TEXT[],
    embedding vector(1536)
);

-- 对话历史表
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255),
    user_id VARCHAR(255),
    role VARCHAR(50),
    content TEXT,
    embedding vector(1536)
);
```

### 向量检索

**索引**：
```sql
CREATE INDEX ON papers USING hnsw (embedding vector_cosine_ops);
```

**检索策略**：
- 向量相似度（语义匹配）
- 关键词匹配（精确匹配）
- 时间衰减（新鲜度）
- 可信度加权

### 替代实现
- **SQLiteMemory**: 单机轻量级实现，适合个人使用
- **ObsidianMemory**: 基于 Obsidian Vault 的文件系统实现，支持双向链接和标签
- **QdrantMemory**: 专用向量数据库，适合大规模数据
- **MilvusMemory**: 分布式向量数据库，适合企业级部署

## 3. 图记忆（Neo4j，可选）

### 接口定义
```python
class IGraphMemory(ABC):
    @abstractmethod
    def add_node(self, node_type: str, node_id: str, properties: Dict) -> bool:
        """添加节点"""
        
    @abstractmethod
    def add_edge(self, from_id: str, to_id: str, 
                relation: str, properties: Dict = None) -> bool:
        """添加关系"""
        
    @abstractmethod
    def get_related_papers(self, paper_id: str, max_depth: int = 2) -> List[Dict]:
        """获取相关论文"""
        
    @abstractmethod
    def get_citation_network(self, paper_ids: List[str]) -> Dict:
        """获取引用网络"""
```

### 默认实现：Neo4jMemory

### 图模型

```cypher
// 节点
(:Paper {id, title, year})
(:Concept {name, definition})
(:Author {name})

// 关系
(:Paper)-[:CITES]->(:Paper)
(:Paper)-[:PROPOSES]->(:Concept)
(:Paper)-[:DISCUSSES]->(:Concept)
(:Author)-[:AUTHORED]->(:Paper)
(:Concept)-[:RELATED_TO]->(:Concept)
```

### 图查询

- 查找相关论文（通过引用关系）
- 追踪研究脉络
- 发现研究社区
- 识别关键论文（PageRank）

### 替代实现
- **NetworkXMemory**: 内存图实现，适合小规模数据
- **None**: 可完全禁用图记忆功能

## 统一的记忆管理器

### 插件化架构

```python
class MemoryManager:
    """可插拔的记忆管理器"""
    
    def __init__(
        self,
        short_term: IShortTermMemory = None,
        long_term: ILongTermMemory = None,
        graph: IGraphMemory = None
    ):
        # 使用依赖注入，支持自定义实现
        self.short_term = short_term or self._create_default_short_term()
        self.long_term = long_term or self._create_default_long_term()
        self.graph = graph  # 可选，None 表示禁用
    
    def _create_default_short_term(self) -> IShortTermMemory:
        """创建默认短期记忆实现"""
        return RedisMemory(config.redis_url)
    
    def _create_default_long_term(self) -> ILongTermMemory:
        """创建默认长期记忆实现"""
        return PostgreSQLMemory(config.database_url)
    
    # 会话管理
    def add_message(self, session_id, user_id, role, content):
        """添加消息到短期和长期记忆"""
        # 短期：缓存最近消息
        self.short_term.set(f"session:{session_id}:context", ...)
        # 长期：持久化存储
        self.long_term.save_conversation(session_id, user_id, role, content)
    
    def get_context(self, session_id) -> List[Dict]:
        """获取会话上下文（优先从短期记忆）"""
        context = self.short_term.get(f"session:{session_id}:context")
        if not context:
            context = self.long_term.get_recent_messages(session_id)
            self.short_term.set(f"session:{session_id}:context", context)
        return context
    
    # 论文管理
    def add_paper(self, paper: Dict) -> str:
        """添加论文到长期记忆和图记忆"""
        paper_id = self.long_term.add_paper(paper)
        if self.graph:
            self.graph.add_node("Paper", paper_id, paper)
        return paper_id
    
    def save_paper_analysis(self, paper_id: str, analysis: Dict, 
                           note: str, user_id: str) -> str:
        """保存论文分析结果（高层接口，供工作流节点调用）"""
        # 保存论文信息
        self.long_term.add_paper({
            "id": paper_id,
            **analysis
        })
        
        # 保存笔记
        self.long_term.add_note(paper_id, user_id, {"content": note})
        
        # 更新图记忆（如果启用）
        if self.graph:
            self.graph.add_node("Paper", paper_id, analysis)
            # 添加概念关系
            for concept in analysis.get("concepts", []):
                self.graph.add_node("Concept", concept, {})
                self.graph.add_edge(paper_id, concept, "DISCUSSES")
        
        return paper_id
    
    def search_papers(self, query: str, top_k: int) -> List[Dict]:
        """搜索论文"""
        return self.long_term.search_papers(query, top_k)
    
    def get_paper(self, paper_id: str) -> Dict:
        """获取论文（带缓存）"""
        cache_key = f"paper:{paper_id}"
        paper = self.short_term.get(cache_key)
        if not paper:
            paper = self.long_term.get_paper(paper_id)
            self.short_term.set(cache_key, paper, ttl=3600)
        return paper
    
    # 笔记管理
    def add_note(self, paper_id, user_id, note: Dict) -> int:
        """添加阅读笔记"""
        return self.long_term.add_note(paper_id, user_id, note)
    
    def get_notes(self, paper_id, user_id) -> List[Dict]:
        """获取笔记"""
        return self.long_term.get_notes(paper_id, user_id)
    
    # 研究任务
    def save_research(self, task: Dict) -> int:
        """保存研究报告"""
        return self.long_term.save_research(task)
    
    def get_research_history(self, user_id) -> List[Dict]:
        """获取研究历史"""
        return self.long_term.get_research_history(user_id)
    
    # 图查询（仅当启用图记忆时）
    def get_related_papers(self, paper_id, max_depth=2) -> List[Dict]:
        """获取相关论文"""
        if not self.graph:
            return []
        return self.graph.get_related_papers(paper_id, max_depth)
    
    def get_citation_network(self, paper_ids) -> Dict:
        """获取引用网络"""
        if not self.graph:
            return {}
        return self.graph.get_citation_network(paper_ids)
```

### 配置系统

```yaml
# config.yaml
memory:
  # 短期记忆配置
  short_term:
    type: redis  # redis | inmemory | memcached
    url: redis://localhost:6379/0
  
  # 长期记忆配置
  long_term:
    type: postgresql  # postgresql | sqlite | qdrant | milvus
    url: postgresql://localhost:5432/labora
    vector_dimension: 1536
  
  # 图记忆配置（可选）
  graph:
    enabled: true  # 设为 false 禁用图记忆
    type: neo4j  # neo4j | networkx | null
    url: bolt://localhost:7687
```

### 使用示例

```python
# 1. 使用默认实现
memory = MemoryManager()

# 2. 使用自定义实现
from labora.memory import SQLiteMemory, InMemoryCache

memory = MemoryManager(
    short_term=InMemoryCache(),
    long_term=SQLiteMemory("./data/labora.db"),
    graph=None  # 禁用图记忆
)

# 3. 从配置文件创建
memory = MemoryManager.from_config("config.yaml")

# 4. 自定义实现
class MyCustomMemory(ILongTermMemory):
    def add_paper(self, paper: Dict) -> str:
        # 自定义实现
        pass

memory = MemoryManager(
    long_term=MyCustomMemory()
)
```

## 检索策略

### 混合检索
```python
def hybrid_search(query: str, filters: Dict = None) -> List[Dict]:
    """
    1. 向量检索（语义相似度）
    2. 关键词匹配（精确匹配）
    3. 时间衰减（优先近期）
    4. 图关系增强（引用网络）
    """
```

### 上下文窗口管理
- 滑动窗口：保持最近 N 条消息
- 摘要压缩：长对话自动摘要
- 重要性采样：保留关键信息

## 性能优化

1. **批量操作** - 批量插入向量
2. **异步写入** - 使用消息队列
3. **缓存热数据** - Redis 缓存常用论文
4. **索引优化** - HNSW 向量索引
5. **分区表** - 按时间分区历史数据

## 数据迁移

### 初期方案
- PostgreSQL + pgvector（单一数据库，简单）
- InMemoryCache（开发环境）

### 扩展方案
- 专用向量库（Qdrant/Milvus）- 数据量 > 100 万时迁移
- Neo4j 图数据库 - 需要复杂关系查询时启用

### 迁移策略
由于采用可插拔架构，迁移只需：
1. 实现新的接口（如 `QdrantMemory(ILongTermMemory)`）
2. 更新配置文件
3. 运行数据迁移脚本
4. 重启服务

无需修改业务代码。

## 扩展自定义实现

### Obsidian 集成

**ObsidianMemory** 将 Obsidian Vault 作为长期记忆后端，支持：

```python
class ObsidianMemory(ILongTermMemory):
    """基于 Obsidian Vault 的记忆实现"""
    
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self.papers_dir = self.vault_path / "Papers"
        self.notes_dir = self.vault_path / "Notes"
        self.research_dir = self.vault_path / "Research"
    
    def add_paper(self, paper: Dict) -> str:
        """添加论文为 Markdown 文件"""
        paper_id = paper['id']
        file_path = self.papers_dir / f"{paper_id}.md"
        
        # 生成 Obsidian 格式的 Markdown
        content = f"""---
title: {paper['title']}
authors: {', '.join(paper['authors'])}
year: {paper['year']}
arxiv_id: {paper.get('arxiv_id', '')}
tags: [paper, {', '.join(paper.get('tags', []))}]
---

# {paper['title']}

## 元数据
- **作者**: {', '.join(paper['authors'])}
- **年份**: {paper['year']}
- **来源**: {paper.get('source', 'Unknown')}

## 摘要
{paper['abstract']}

## 相关论文
{self._generate_backlinks(paper)}

## 笔记
[[{paper_id}-notes]]
"""
        file_path.write_text(content, encoding='utf-8')
        return paper_id
    
    def add_note(self, paper_id: str, user_id: str, note: Dict) -> int:
        """添加笔记，支持双向链接"""
        note_file = self.notes_dir / f"{paper_id}-notes.md"
        
        content = f"""---
paper: [[{paper_id}]]
created: {datetime.now().isoformat()}
tags: [note, {', '.join(note.get('tags', []))}]
---

# 阅读笔记: [[{paper_id}]]

## 核心贡献
{self._format_list(note.get('key_contributions', []))}

## 个人思考
{note.get('personal_notes', '')}

## 相关概念
{self._generate_concept_links(note.get('concepts', []))}
"""
        note_file.write_text(content, encoding='utf-8')
        return hash(note_file)
    
    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        """搜索论文（基于文件名和内容）"""
        # 使用 Obsidian 的搜索或全文检索
        results = []
        for paper_file in self.papers_dir.glob("*.md"):
            content = paper_file.read_text(encoding='utf-8')
            if query.lower() in content.lower():
                results.append(self._parse_paper_file(paper_file))
        return results[:top_k]
    
    def _generate_backlinks(self, paper: Dict) -> str:
        """生成双向链接"""
        links = []
        for ref_id in paper.get('references', []):
            links.append(f"- [[{ref_id}]]")
        return '\n'.join(links) if links else "无"
    
    def _generate_concept_links(self, concepts: List[str]) -> str:
        """生成概念链接"""
        return '\n'.join([f"- [[{concept}]]" for concept in concepts])
```

**配置示例**：
```yaml
memory:
  long_term:
    type: obsidian
    vault_path: /path/to/your/obsidian/vault
    
  # 可选：同时启用数据库用于向量检索
  vector_search:
    type: postgresql
    url: postgresql://localhost:5432/labora
```

**Obsidian 集成特性**：
- ✅ **双向链接**: 论文、笔记、概念之间自动建立链接
- ✅ **标签系统**: 映射到 Obsidian 标签
- ✅ **图谱可视化**: 利用 Obsidian Graph View 查看知识网络
- ✅ **Markdown 格式**: 纯文本，易于版本控制和迁移
- ✅ **插件生态**: 可使用 Obsidian 插件扩展功能
- ✅ **离线访问**: 本地文件系统，无需网络

**文件组织结构**：
```
Obsidian Vault/
├── Papers/
│   ├── arxiv_2301_12345.md
│   ├── arxiv_2302_67890.md
│   └── ...
├── Notes/
│   ├── arxiv_2301_12345-notes.md
│   ├── arxiv_2302_67890-notes.md
│   └── ...
├── Research/
│   ├── transformer-survey.md
│   └── attention-mechanism-study.md
└── Concepts/
    ├── Attention-Mechanism.md
    ├── Transformer.md
    └── ...
```

**混合模式**：
可以同时使用 Obsidian（笔记管理）+ PostgreSQL（向量检索）：
```python
memory = MemoryManager(
    long_term=ObsidianMemory("/path/to/vault"),
    vector_search=PostgreSQLMemory("postgresql://..."),  # 用于语义搜索
    graph=None  # Obsidian 的双向链接已提供图谱功能
)
```

### 实现自定义记忆后端

```python
from labora.memory.interface import ILongTermMemory

class MyVectorDB(ILongTermMemory):
    """自定义向量数据库实现"""
    
    def __init__(self, connection_string: str):
        self.db = connect_to_my_db(connection_string)
    
    def add_paper(self, paper: Dict) -> str:
        # 实现添加论文逻辑
        embedding = self._generate_embedding(paper['abstract'])
        paper_id = self.db.insert(paper, embedding)
        return paper_id
    
    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        # 实现搜索逻辑
        query_embedding = self._generate_embedding(query)
        results = self.db.vector_search(query_embedding, top_k)
        return results
    
    # 实现其他必需方法...
```

### 注册自定义实现

```python
# 方式 1: 直接注入
memory = MemoryManager(long_term=MyVectorDB("connection_string"))

# 方式 2: 通过配置注册
from labora.memory import register_memory_backend

register_memory_backend("myvectordb", MyVectorDB)

# config.yaml
# memory:
#   long_term:
#     type: myvectordb
#     connection_string: "..."
```
