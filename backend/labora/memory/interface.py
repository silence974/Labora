from abc import ABC, abstractmethod
from typing import Any, Optional, List, Dict


class IShortTermMemory(ABC):
    """短期记忆接口（缓存层）"""

    @abstractmethod
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """
        设置缓存

        Args:
            key: 缓存键
            value: 缓存值
            ttl: 过期时间（秒），None 表示永不过期

        Returns:
            是否设置成功
        """
        pass

    @abstractmethod
    def get(self, key: str) -> Any:
        """
        获取缓存

        Args:
            key: 缓存键

        Returns:
            缓存值，不存在或已过期返回 None
        """
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        """
        删除缓存

        Args:
            key: 缓存键

        Returns:
            是否删除成功
        """
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        """
        检查键是否存在

        Args:
            key: 缓存键

        Returns:
            是否存在
        """
        pass


class ILongTermMemory(ABC):
    """长期记忆接口（持久化层）"""

    @abstractmethod
    def add_paper(self, paper: Dict) -> str:
        """
        添加论文

        Args:
            paper: 论文信息字典，必须包含 id, title, abstract 等字段

        Returns:
            论文 ID
        """
        pass

    @abstractmethod
    def get_paper(self, paper_id: str) -> Optional[Dict]:
        """
        获取论文详情

        Args:
            paper_id: 论文 ID

        Returns:
            论文信息字典，不存在返回 None
        """
        pass

    @abstractmethod
    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        """
        搜索论文（关键词匹配）

        Args:
            query: 搜索查询
            top_k: 返回结果数量

        Returns:
            论文列表
        """
        pass

    @abstractmethod
    def add_note(self, paper_id: str, user_id: str, note: Dict) -> int:
        """
        添加阅读笔记

        Args:
            paper_id: 论文 ID
            user_id: 用户 ID
            note: 笔记内容字典

        Returns:
            笔记 ID
        """
        pass

    @abstractmethod
    def get_notes(self, paper_id: str, user_id: str) -> List[Dict]:
        """
        获取论文的笔记

        Args:
            paper_id: 论文 ID
            user_id: 用户 ID

        Returns:
            笔记列表
        """
        pass

