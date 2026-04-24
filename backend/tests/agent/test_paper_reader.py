import pytest
from unittest.mock import Mock, patch
from labora.agent import read_paper, create_paper_reader_graph


class TestPaperReader:
    """测试论文阅读子图"""

    @pytest.fixture
    def mock_env(self, monkeypatch):
        """设置测试环境变量"""
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    @patch("labora.agent.paper_reader.arxiv_get_paper")
    @patch("labora.agent.paper_reader.parse_latex_from_arxiv")
    @patch("labora.agent.paper_reader.ChatOpenAI")
    def test_read_paper_success(self, mock_llm_class, mock_parse, mock_get_paper, mock_env):
        """测试成功读取论文"""
        # Mock arxiv_get_paper
        mock_get_paper.invoke.return_value = {
            "id": "arxiv:2301.12345",
            "title": "Test Paper",
            "authors": ["Author A", "Author B"],
            "published": "2023-01-01",
            "abstract": "Test abstract",
        }

        # Mock parse_latex_from_arxiv
        mock_parse.invoke.return_value = {
            "abstract": "This is a test paper about machine learning.",
            "introduction": "Machine learning is important.",
            "method": "We propose a novel approach.",
            "results": "Our method achieves 95% accuracy.",
            "conclusion": "We demonstrated effectiveness.",
        }

        # Mock ChatOpenAI
        mock_llm = Mock()
        mock_response = Mock()
        mock_response.content = """
{
  "background": "Machine learning is widely used in various domains.",
  "method": "The paper proposes a novel neural network architecture.",
  "contribution": [
    "Novel architecture design",
    "State-of-the-art performance",
    "Efficient training method"
  ],
  "limitation": [
    "Limited to specific datasets",
    "High computational cost"
  ]
}
"""
        mock_llm.invoke.return_value = mock_response
        mock_llm_class.return_value = mock_llm

        # 调用 read_paper
        result = read_paper("arxiv:2301.12345")

        # 验证结果
        assert result["paper_id"] == "arxiv:2301.12345"
        assert "key_information" in result
        assert "note" in result

        key_info = result["key_information"]
        assert "background" in key_info
        assert "method" in key_info
        assert "contribution" in key_info
        assert "limitation" in key_info
        assert isinstance(key_info["contribution"], list)
        assert len(key_info["contribution"]) == 3

        note = result["note"]
        assert "# Test Paper" in note
        assert "Author A" in note
        assert "研究背景" in note
        assert "核心方法" in note
        assert "主要贡献" in note
        assert "局限性" in note

    @patch("labora.agent.paper_reader.arxiv_get_paper")
    def test_read_paper_not_found(self, mock_get_paper, mock_env):
        """测试论文不存在"""
        mock_get_paper.invoke.return_value = None

        with pytest.raises(RuntimeError, match="not found"):
            read_paper("arxiv:9999.99999")

    @patch("labora.agent.paper_reader.arxiv_get_paper")
    @patch("labora.agent.paper_reader.parse_latex_from_arxiv")
    def test_read_paper_parse_error(self, mock_parse, mock_get_paper, mock_env):
        """测试解析失败"""
        mock_get_paper.invoke.return_value = {
            "id": "arxiv:2301.12345",
            "title": "Test Paper",
            "authors": ["Author A"],
            "published": "2023-01-01",
        }

        mock_parse.invoke.side_effect = Exception("Parse failed")

        with pytest.raises(RuntimeError, match="Failed to parse"):
            read_paper("arxiv:2301.12345")

    def test_create_graph(self, mock_env):
        """测试创建子图"""
        graph = create_paper_reader_graph()
        assert graph is not None

    @patch("labora.agent.paper_reader.arxiv_get_paper")
    @patch("labora.agent.paper_reader.parse_latex_from_arxiv")
    @patch("labora.agent.paper_reader.ChatOpenAI")
    def test_graph_invoke(self, mock_llm_class, mock_parse, mock_get_paper, mock_env):
        """测试子图独立调用"""
        # Mock 数据
        mock_get_paper.invoke.return_value = {
            "id": "arxiv:2301.12345",
            "title": "Test Paper",
            "authors": ["Author A"],
            "published": "2023-01-01",
        }

        mock_parse.invoke.return_value = {
            "abstract": "Test abstract",
            "introduction": "Test intro",
        }

        mock_llm = Mock()
        mock_response = Mock()
        mock_response.content = '{"background": "test", "method": "test", "contribution": ["c1"], "limitation": ["l1"]}'
        mock_llm.invoke.return_value = mock_response
        mock_llm_class.return_value = mock_llm

        # 创建并调用子图
        graph = create_paper_reader_graph()
        result = graph.invoke({"paper_id": "arxiv:2301.12345"})

        # 验证状态
        assert result["paper_id"] == "arxiv:2301.12345"
        assert result["arxiv_id"] == "2301.12345"
        assert result["paper_metadata"] is not None
        assert result["sections"] is not None
        assert result["key_information"] is not None
        assert result["note"] is not None
        assert result.get("error") is None
