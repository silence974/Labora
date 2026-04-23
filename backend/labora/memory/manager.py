from typing import Optional, Dict, List
from labora.memory.interface import IShortTermMemory, ILongTermMemory


class MemoryManager:
    """可插拔的记忆管理器"""

    def __init__(
        self,
        short_term: Optional[IShortTermMemory] = None,
        long_term: Optional[ILongTermMemory] = None,
    ):
        self.short_term = short_term
        self.long_term = long_term

    # ========== 论文管理 ==========

    def add_paper(self, paper: Dict) -> str:
        """添加论文到长期记忆"""
        if not self.long_term:
            raise RuntimeError("Long-term memory not configured")
        return self.long_term.add_paper(paper)

    def get_paper(self, paper_id: str) -> Optional[Dict]:
        """获取论文（带缓存）"""
        if not self.long_term:
            raise RuntimeError("Long-term memory not configured")

        # 尝试从缓存读取
        if self.short_term:
            cache_key = f"paper:{paper_id}"
            cached = self.short_term.get(cache_key)
            if cached:
                return cached

        # 从长期记忆读取
        paper = self.long_term.get_paper(paper_id)

        # 写入缓存
        if paper and self.short_term:
            self.short_term.set(cache_key, paper, ttl=3600)

        return paper

    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        """搜索论文"""
        if not self.long_term:
            raise RuntimeError("Long-term memory not configured")
        return self.long_term.search_papers(query, top_k)

    def save_paper_analysis(
        self, paper_id: str, analysis: Dict, note: str, user_id: str
    ) -> str:
        """
        保存论文分析结果（高层接口，供工作流节点调用）

        Args:
            paper_id: 论文 ID
            analysis: 分析结果（包含 key_information, concepts 等）
            note: 笔记内容
            user_id: 用户 ID

        Returns:
            论文 ID
        """
        if not self.long_term:
            raise RuntimeError("Long-term memory not configured")

        # 保存论文信息
        paper_data = {"id": paper_id, **analysis}
        self.long_term.add_paper(paper_data)

        # 保存笔记
        self.long_term.add_note(paper_id, user_id, {"content": note})

        return paper_id

    # ========== 笔记管理 ==========

    def add_note(self, paper_id: str, user_id: str, note: Dict) -> int:
        """添加阅读笔记"""
        if not self.long_term:
            raise RuntimeError("Long-term memory not configured")
        return self.long_term.add_note(paper_id, user_id, note)

    def get_notes(self, paper_id: str, user_id: str) -> List[Dict]:
        """获取笔记"""
        if not self.long_term:
            raise RuntimeError("Long-term memory not configured")
        return self.long_term.get_notes(paper_id, user_id)

    # ========== 会话管理（短期记忆）==========

    def set_session_context(self, session_id: str, context: Dict, ttl: int = 3600):
        """设置会话上下文"""
        if not self.short_term:
            raise RuntimeError("Short-term memory not configured")
        key = f"session:{session_id}:context"
        self.short_term.set(key, context, ttl=ttl)

    def get_session_context(self, session_id: str) -> Optional[Dict]:
        """获取会话上下文"""
        if not self.short_term:
            return None
        key = f"session:{session_id}:context"
        return self.short_term.get(key)
