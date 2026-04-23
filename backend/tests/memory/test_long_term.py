import pytest
import tempfile
import os
from labora.memory import SQLiteMemory


class TestSQLiteMemory:
    """测试 SQLiteMemory 实现"""

    @pytest.fixture
    def memory(self):
        """创建临时数据库"""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as f:
            db_path = f.name

        mem = SQLiteMemory(db_path)
        yield mem

        # 清理
        if os.path.exists(db_path):
            os.unlink(db_path)

    def test_add_and_get_paper(self, memory):
        """测试添加和获取论文"""
        paper = {
            "id": "arxiv:2301.12345",
            "title": "Test Paper",
            "abstract": "This is a test abstract",
            "authors": ["Alice", "Bob"],
            "year": 2023,
            "arxiv_id": "2301.12345",
        }

        paper_id = memory.add_paper(paper)
        assert paper_id == "arxiv:2301.12345"

        retrieved = memory.get_paper(paper_id)
        assert retrieved is not None
        assert retrieved["title"] == "Test Paper"
        assert retrieved["authors"] == ["Alice", "Bob"]

    def test_get_nonexistent_paper(self, memory):
        """测试获取不存在的论文"""
        result = memory.get_paper("nonexistent")
        assert result is None

    def test_search_papers(self, memory):
        """测试搜索论文"""
        papers = [
            {
                "id": "paper1",
                "title": "Attention Mechanism in NLP",
                "abstract": "This paper discusses attention",
            },
            {
                "id": "paper2",
                "title": "Transformer Architecture",
                "abstract": "A new architecture for NLP",
            },
            {
                "id": "paper3",
                "title": "Computer Vision Methods",
                "abstract": "Methods for image processing",
            },
        ]

        for paper in papers:
            memory.add_paper(paper)

        # 搜索 "attention"
        results = memory.search_papers("attention")
        assert len(results) >= 1
        assert any("Attention" in r["title"] for r in results)

        # 搜索 "NLP"
        results = memory.search_papers("NLP")
        assert len(results) >= 2

    def test_add_and_get_notes(self, memory):
        """测试添加和获取笔记"""
        paper = {"id": "paper1", "title": "Test Paper"}
        memory.add_paper(paper)

        note = {
            "summary": "This is a summary",
            "key_points": ["Point 1", "Point 2"],
        }

        note_id = memory.add_note("paper1", "user1", note)
        assert note_id > 0

        notes = memory.get_notes("paper1", "user1")
        assert len(notes) == 1
        assert notes[0]["content"]["summary"] == "This is a summary"

    def test_multiple_notes(self, memory):
        """测试同一论文的多条笔记"""
        paper = {"id": "paper1", "title": "Test Paper"}
        memory.add_paper(paper)

        memory.add_note("paper1", "user1", {"content": "Note 1"})
        memory.add_note("paper1", "user1", {"content": "Note 2"})

        notes = memory.get_notes("paper1", "user1")
        assert len(notes) == 2

    def test_notes_isolation_by_user(self, memory):
        """测试不同用户的笔记隔离"""
        paper = {"id": "paper1", "title": "Test Paper"}
        memory.add_paper(paper)

        memory.add_note("paper1", "user1", {"content": "User 1 note"})
        memory.add_note("paper1", "user2", {"content": "User 2 note"})

        user1_notes = memory.get_notes("paper1", "user1")
        user2_notes = memory.get_notes("paper1", "user2")

        assert len(user1_notes) == 1
        assert len(user2_notes) == 1
        assert user1_notes[0]["content"]["content"] == "User 1 note"
        assert user2_notes[0]["content"]["content"] == "User 2 note"

    def test_update_paper(self, memory):
        """测试更新论文（INSERT OR REPLACE）"""
        paper = {"id": "paper1", "title": "Original Title"}
        memory.add_paper(paper)

        updated_paper = {"id": "paper1", "title": "Updated Title"}
        memory.add_paper(updated_paper)

        retrieved = memory.get_paper("paper1")
        assert retrieved["title"] == "Updated Title"
