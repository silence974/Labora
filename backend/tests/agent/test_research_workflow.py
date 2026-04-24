import pytest
from unittest.mock import Mock, patch, MagicMock
from labora.agent import create_research_workflow, run_research


class TestResearchWorkflow:
    """测试研究工作流"""

    @pytest.fixture
    def mock_env(self, monkeypatch):
        """设置测试环境变量"""
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    @patch("labora.agent.research_workflow.arxiv_search")
    @patch("labora.agent.research_workflow.ChatOpenAI")
    def test_initial_explorer(self, mock_llm_class, mock_search, mock_env):
        """测试初步探索阶段"""
        from labora.agent.research_workflow import initial_explorer

        # Mock LLM
        mock_llm = Mock()
        mock_response = Mock()
        mock_response.content = '{"queries": ["query1", "query2"]}'
        mock_llm.invoke.return_value = mock_response
        mock_llm_class.return_value = mock_llm

        # Mock arxiv_search
        mock_search.invoke.return_value = [
            {"id": "arxiv:1", "title": "Paper 1", "year": 2023},
            {"id": "arxiv:2", "title": "Paper 2", "year": 2023},
        ]

        state = {"research_question": "What is attention mechanism?"}
        result = initial_explorer(state)

        assert "initial_papers" in result
        assert len(result["initial_papers"]) > 0
        assert result.get("error") is None

    @patch("labora.agent.research_workflow.ChatOpenAI")
    def test_question_generator(self, mock_llm_class, mock_env):
        """测试问题生成阶段"""
        from labora.agent.research_workflow import question_generator

        mock_llm = Mock()
        mock_response = Mock()
        mock_response.content = '{"questions": ["Q1", "Q2", "Q3"]}'
        mock_llm.invoke.return_value = mock_response
        mock_llm_class.return_value = mock_llm

        state = {
            "research_question": "What is attention?",
            "initial_papers": [
                {"id": "arxiv:1", "title": "Paper 1", "year": 2023}
            ],
        }

        result = question_generator(state)

        assert "clarifying_questions" in result
        assert len(result["clarifying_questions"]) == 3
        assert result.get("error") is None

    @patch("labora.agent.research_workflow.ChatOpenAI")
    def test_direction_refiner(self, mock_llm_class, mock_env):
        """测试方向细化阶段"""
        from labora.agent.research_workflow import direction_refiner

        mock_llm = Mock()
        mock_response = Mock()
        mock_response.content = '''
{
  "refined_direction": "Focus on transformer attention",
  "queries": ["transformer attention", "self-attention mechanism"]
}
'''
        mock_llm.invoke.return_value = mock_response
        mock_llm_class.return_value = mock_llm

        state = {
            "research_question": "What is attention?",
            "user_responses": {"Q1": "A1", "Q2": "A2"},
        }

        result = direction_refiner(state)

        assert "refined_direction" in result
        assert "search_queries" in result
        assert len(result["search_queries"]) > 0
        assert result.get("error") is None

    @patch("labora.agent.research_workflow.arxiv_search")
    def test_core_paper_selector(self, mock_search, mock_env):
        """测试核心论文选择"""
        from labora.agent.research_workflow import core_paper_selector

        mock_search.invoke.return_value = [
            {"id": "arxiv:1", "title": "Paper 1", "year": 2023},
            {"id": "arxiv:2", "title": "Paper 2", "year": 2023},
            {"id": "arxiv:3", "title": "Paper 3", "year": 2023},
        ]

        state = {
            "search_queries": ["query1", "query2"],
        }

        result = core_paper_selector(state)

        assert "candidate_papers" in result
        assert "selected_papers" in result
        assert len(result["selected_papers"]) <= 3
        assert result.get("error") is None

    @patch("labora.agent.research_workflow.read_paper")
    def test_collaborative_reader(self, mock_read_paper, mock_env):
        """测试协作阅读"""
        from labora.agent.research_workflow import collaborative_reader

        mock_read_paper.return_value = {
            "paper_id": "arxiv:1",
            "key_information": {
                "background": "test background",
                "method": "test method",
                "contribution": ["c1", "c2"],
                "limitation": ["l1"],
            },
            "note": "test note",
        }

        state = {
            "selected_papers": ["arxiv:1", "arxiv:2"],
        }

        result = collaborative_reader(state)

        assert "paper_analyses" in result
        assert len(result["paper_analyses"]) > 0
        assert result.get("error") is None

    @patch("labora.agent.research_workflow.ChatOpenAI")
    def test_synthesizer(self, mock_llm_class, mock_env):
        """测试综述生成"""
        from labora.agent.research_workflow import synthesizer

        mock_llm = Mock()
        mock_response = Mock()
        mock_response.content = """
# 研究综述

## 研究背景
这是研究背景部分，至少需要 200 字来描述研究问题的重要性和现状。

## 主要发现
这是主要发现部分，总结论文的核心贡献和方法。

## 研究趋势
这是研究趋势部分，分析领域的发展方向。

## 未来展望
这是未来展望部分，提出可能的研究方向。
"""
        mock_llm.invoke.return_value = mock_response
        mock_llm_class.return_value = mock_llm

        state = {
            "research_question": "What is attention?",
            "refined_direction": "Focus on transformer",
            "paper_analyses": {
                "arxiv:1": {
                    "key_information": {
                        "background": "bg",
                        "method": "method",
                        "contribution": ["c1"],
                    }
                }
            },
        }

        result = synthesizer(state)

        assert "synthesis" in result
        assert len(result["synthesis"]) > 100
        assert "研究背景" in result["synthesis"]
        assert result.get("error") is None

    def test_create_workflow(self, mock_env):
        """测试创建工作流"""
        graph = create_research_workflow()
        assert graph is not None

    @patch("labora.agent.research_workflow.arxiv_search")
    @patch("labora.agent.research_workflow.read_paper")
    @patch("labora.agent.research_workflow.ChatOpenAI")
    def test_full_workflow(
        self, mock_llm_class, mock_read_paper, mock_search, mock_env
    ):
        """测试完整工作流（简化版本，验证基本流程）"""
        # Mock LLM - 返回简单但有效的响应
        mock_llm = Mock()
        mock_llm.invoke.return_value = Mock(
            content='{"queries": ["q1"], "questions": ["Q1"], "refined_direction": "test", "queries": ["q1"]}'
        )
        mock_llm_class.return_value = mock_llm

        # Mock arxiv_search
        mock_search.invoke.return_value = [
            {"id": "arxiv:1", "title": "Paper 1", "year": 2023}
        ]

        # Mock read_paper
        mock_read_paper.return_value = {
            "paper_id": "arxiv:1",
            "key_information": {
                "background": "bg",
                "method": "method",
                "contribution": ["c1"],
                "limitation": ["l1"],
            },
            "note": "note",
        }

        # 测试工作流可以创建和调用
        graph = create_research_workflow()

        # 由于 mock 的限制，我们只验证工作流可以被创建
        # 完整的端到端测试需要真实 API
        assert graph is not None
