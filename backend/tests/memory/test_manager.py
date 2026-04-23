import pytest
import tempfile
import os
from labora.memory import InMemoryCache, SQLiteMemory, MemoryManager


class TestMemoryManager:
    """测试 MemoryManager 集成"""

    @pytest.fixture
    def manager(self):
        """创建带临时数据库的 MemoryManager"""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as f:
            db_path = f.name

        short_term = InMemoryCache()
        long_term = SQLiteMemory(db_path)
        mgr = MemoryManager(short_term=short_term, long_term=long_term)

        yield mgr

        # 清理
        if os.path.exists(db_path):
            os.unlink(db_path)

    def test_add_and_get_paper(self, manager):
        """测试通过 MemoryManager 添加和获取论文"""
        paper = {
            "id": "paper1",
            "title": "Test Paper",
            "abstract": "Test abstract",
        }

        paper_id = manager.add_paper(paper)
        assert paper_id == "paper1"

        retrieved = manager.get_paper(paper_id)
        assert retrieved is not None
        assert retrieved["title"] == "Test Paper"

    def test_paper_caching(self, manager):
        """测试论文缓存机制"""
        paper = {"id": "paper1", "title": "Test Paper"}
        manager.add_paper(paper)

        # 第一次获取（从数据库）
        result1 = manager.get_paper("paper1")
        assert result1 is not None

        # 第二次获取（从缓存）
        result2 = manager.get_paper("paper1")
        assert result2 is not None
        assert result2["title"] == result1["title"]

        # 验证缓存存在
        cache_key = "paper:paper1"
        assert manager.short_term.exists(cache_key)

    def test_save_paper_analysis(self, manager):
        """测试 save_paper_analysis 高层接口"""
        analysis = {
            "title": "Test Paper",
            "key_information": {
                "background": "Background info",
                "method": "Method description",
            },
            "concepts": ["concept1", "concept2"],
        }

        paper_id = manager.save_paper_analysis(
            paper_id="paper1",
            analysis=analysis,
            note="This is a note",
            user_id="user1",
        )

        assert paper_id == "paper1"

        # 验证论文已保存
        paper = manager.get_paper("paper1")
        assert paper is not None
        assert paper["title"] == "Test Paper"

        # 验证笔记已保存
        notes = manager.get_notes("paper1", "user1")
        assert len(notes) == 1
        assert notes[0]["content"]["content"] == "This is a note"

    def test_search_papers(self, manager):
        """测试搜索论文"""
        papers = [
            {"id": "p1", "title": "Attention Mechanism"},
            {"id": "p2", "title": "Transformer Model"},
        ]

        for paper in papers:
            manager.add_paper(paper)

        results = manager.search_papers("Attention")
        assert len(results) >= 1
        assert any("Attention" in r["title"] for r in results)

    def test_session_context(self, manager):
        """测试会话上下文管理"""
        context = {
            "messages": ["msg1", "msg2"],
            "current_paper": "paper1",
        }

        manager.set_session_context("session1", context, ttl=3600)

        retrieved = manager.get_session_context("session1")
        assert retrieved is not None
        assert retrieved["current_paper"] == "paper1"
        assert len(retrieved["messages"]) == 2

    def test_manager_without_long_term(self):
        """测试没有配置长期记忆时的错误处理"""
        manager = MemoryManager(short_term=InMemoryCache())

        with pytest.raises(RuntimeError, match="Long-term memory not configured"):
            manager.add_paper({"id": "p1", "title": "Test"})

    def test_manager_without_short_term(self):
        """测试没有配置短期记忆时的行为"""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as f:
            db_path = f.name

        try:
            manager = MemoryManager(long_term=SQLiteMemory(db_path))

            # 应该能正常添加和获取论文（只是没有缓存）
            paper = {"id": "p1", "title": "Test"}
            manager.add_paper(paper)

            retrieved = manager.get_paper("p1")
            assert retrieved is not None

            # 会话上下文应该返回 None
            assert manager.get_session_context("session1") is None

        finally:
            if os.path.exists(db_path):
                os.unlink(db_path)
