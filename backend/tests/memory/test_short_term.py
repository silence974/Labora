import pytest
import time
from labora.memory import InMemoryCache


class TestInMemoryCache:
    """测试 InMemoryCache 实现"""

    def test_set_and_get(self):
        """测试基本的 set/get 操作"""
        cache = InMemoryCache()

        assert cache.set("key1", "value1") is True
        assert cache.get("key1") == "value1"

        # 测试不存在的键
        assert cache.get("nonexistent") is None

    def test_set_with_ttl(self):
        """测试 TTL 过期"""
        cache = InMemoryCache()

        cache.set("temp_key", "temp_value", ttl=1)
        assert cache.get("temp_key") == "temp_value"

        # 等待过期
        time.sleep(1.1)
        assert cache.get("temp_key") is None

    def test_delete(self):
        """测试删除操作"""
        cache = InMemoryCache()

        cache.set("key1", "value1")
        assert cache.delete("key1") is True
        assert cache.get("key1") is None

        # 删除不存在的键
        assert cache.delete("nonexistent") is False

    def test_exists(self):
        """测试 exists 检查"""
        cache = InMemoryCache()

        cache.set("key1", "value1")
        assert cache.exists("key1") is True
        assert cache.exists("nonexistent") is False

        # 测试过期键
        cache.set("temp_key", "temp_value", ttl=1)
        assert cache.exists("temp_key") is True
        time.sleep(1.1)
        assert cache.exists("temp_key") is False

    def test_overwrite(self):
        """测试覆盖已存在的键"""
        cache = InMemoryCache()

        cache.set("key1", "value1")
        cache.set("key1", "value2")
        assert cache.get("key1") == "value2"

    def test_complex_values(self):
        """测试复杂数据类型"""
        cache = InMemoryCache()

        # 字典
        cache.set("dict_key", {"a": 1, "b": 2})
        assert cache.get("dict_key") == {"a": 1, "b": 2}

        # 列表
        cache.set("list_key", [1, 2, 3])
        assert cache.get("list_key") == [1, 2, 3]
