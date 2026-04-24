"""
论文阅读子图集成测试

使用真实 API 测试完整流程（需要 OPENAI_API_KEY）
"""

import pytest
import os
from labora.agent import read_paper


@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="Requires OPENAI_API_KEY environment variable"
)
class TestPaperReaderIntegration:
    """集成测试（需要真实 API）"""

    def test_read_real_paper(self):
        """测试读取真实论文（Attention Is All You Need）"""
        paper_id = "arxiv:1706.03762"

        result = read_paper(paper_id)

        # 验证返回结构
        assert result["paper_id"] == paper_id
        assert "key_information" in result
        assert "note" in result

        # 验证 key_information 结构
        key_info = result["key_information"]
        assert "background" in key_info
        assert "method" in key_info
        assert "contribution" in key_info
        assert "limitation" in key_info

        # 验证内容质量
        assert len(key_info["background"]) > 50
        assert len(key_info["method"]) > 50
        assert isinstance(key_info["contribution"], list)
        assert len(key_info["contribution"]) >= 2
        assert isinstance(key_info["limitation"], list)
        assert len(key_info["limitation"]) >= 1

        # 验证笔记格式
        note = result["note"]
        assert "# " in note  # 标题
        assert "研究背景" in note
        assert "核心方法" in note
        assert "主要贡献" in note
        assert "局限性" in note
        assert "1706.03762" in note

        # 验证关键词出现（Transformer 论文）
        note_lower = note.lower()
        assert any(keyword in note_lower for keyword in ["attention", "transformer", "neural"])

    def test_read_paper_execution_time(self):
        """测试执行时间 < 60 秒"""
        import time

        paper_id = "arxiv:1706.03762"

        start = time.time()
        result = read_paper(paper_id)
        elapsed = time.time() - start

        assert elapsed < 60.0
        assert result["paper_id"] == paper_id
        assert result["key_information"] is not None
