import time
from typing import Any, Optional, Dict, Tuple
from labora.memory.interface import IShortTermMemory


class InMemoryCache(IShortTermMemory):
    """基于内存的短期记忆实现"""

    def __init__(self):
        # 存储格式: {key: (value, expire_time)}
        # expire_time 为 None 表示永不过期
        self._store: Dict[str, Tuple[Any, Optional[float]]] = {}

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        expire_time = None
        if ttl is not None:
            expire_time = time.time() + ttl
        self._store[key] = (value, expire_time)
        return True

    def get(self, key: str) -> Any:
        if key not in self._store:
            return None

        value, expire_time = self._store[key]

        # 检查是否过期
        if expire_time is not None and time.time() > expire_time:
            del self._store[key]
            return None

        return value

    def delete(self, key: str) -> bool:
        if key in self._store:
            del self._store[key]
            return True
        return False

    def exists(self, key: str) -> bool:
        if key not in self._store:
            return False

        # 检查是否过期
        _, expire_time = self._store[key]
        if expire_time is not None and time.time() > expire_time:
            del self._store[key]
            return False

        return True
