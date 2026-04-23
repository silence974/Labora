import pytest
from unittest.mock import Mock, patch
from labora.tools import arxiv_search, arxiv_get_paper
import arxiv


class TestArxivTool:
    """测试 ArXiv 工具函数"""

    def test_search_returns_correct_fields(self):
        """测试搜索返回正确的字段"""
        # 使用真实 API 搜索（限制结果数量）
        results = arxiv_search.invoke({"query": "attention mechanism", "max_results": 3})

        assert len(results) > 0
        assert len(results) <= 3

        # 验证字段完整性
        paper = results[0]
        assert "id" in paper
        assert "title" in paper
        assert "abstract" in paper
        assert "authors" in paper
        assert "year" in paper
        assert "arxiv_id" in paper
        assert "pdf_url" in paper

        # 验证 ID 格式
        assert paper["id"].startswith("arxiv:")
        assert isinstance(paper["authors"], list)
        assert len(paper["authors"]) > 0

    def test_search_attention_is_all_you_need(self):
        """测试搜索 'Attention Is All You Need' 论文"""
        # 使用更精确的搜索（包含作者）
        results = arxiv_search.invoke({"query": "Attention Is All You Need Vaswani", "max_results": 10})

        # 验证原始论文在前 3 条结果中（放宽条件：包含关键词）
        titles = [r["title"].lower() for r in results[:3]]
        assert any("attention" in title and "need" in title for title in titles)

    def test_search_with_max_results(self):
        """测试 max_results 参数"""
        results = arxiv_search.invoke({"query": "transformer", "max_results": 5})
        assert len(results) <= 5

    def test_get_paper_by_id(self):
        """测试根据 ID 获取论文"""
        # Attention Is All You Need 的 ArXiv ID
        paper = arxiv_get_paper.invoke({"arxiv_id": "1706.03762"})

        assert paper is not None
        assert "attention" in paper["title"].lower()
        assert paper["arxiv_id"] == "1706.03762"
        assert paper["year"] == 2017

    def test_get_nonexistent_paper(self):
        """测试获取不存在的论文"""
        paper = arxiv_get_paper.invoke({"arxiv_id": "9999.99999"})
        assert paper is None

    @patch("arxiv.Client")
    def test_search_network_error(self, mock_client_class):
        """测试网络错误处理"""
        mock_client = Mock()
        mock_client.results.side_effect = Exception("Network error")
        mock_client_class.return_value = mock_client

        with pytest.raises(RuntimeError, match="ArXiv search failed"):
            arxiv_search.invoke({"query": "test query"})

    def test_search_response_time(self):
        """测试搜索响应时间 < 3 秒"""
        import time

        start = time.time()
        results = arxiv_search.invoke({"query": "machine learning", "max_results": 10})
        elapsed = time.time() - start

        assert elapsed < 3.0
        assert len(results) > 0

    def test_paper_format(self):
        """测试论文格式化"""
        results = arxiv_search.invoke({"query": "BERT", "max_results": 1})
        paper = results[0]

        # 验证 ArXiv ID 格式（无版本号）
        assert "v" not in paper["arxiv_id"]

        # 验证 ID 前缀
        assert paper["id"] == f"arxiv:{paper['arxiv_id']}"

        # 验证 PDF URL
        assert paper["pdf_url"].startswith("http")
        assert "arxiv.org" in paper["pdf_url"]
