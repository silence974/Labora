"""Tests for the 3-stage deep reading pipeline."""

import json
import pytest
from unittest.mock import Mock, patch

from labora.agent.deep_reader import (
    _truncate_text,
    _parse_llm_json,
    _clean_related_papers,
    run_stage_1,
    run_stage_2,
    run_stage_3,
    run_deep_reading,
    Stage1Result,
    Stage2Result,
    Stage3Result,
    RelatedPaper,
    MAX_PAPER_CHARS,
)


class TestTruncateText:
    def test_no_truncation_for_short_text(self):
        text = "short text"
        assert _truncate_text(text) == text

    def test_truncation_for_long_text(self):
        text = "x" * (MAX_PAPER_CHARS + 100)
        result = _truncate_text(text)
        assert len(result) <= MAX_PAPER_CHARS + 100  # includes truncation message
        assert "truncated" in result.lower()

    def test_custom_max_chars(self):
        text = "x" * 200
        result = _truncate_text(text, max_chars=100)
        assert len(result) < 200


class TestParseLLMJson:
    def test_plain_json(self):
        result = _parse_llm_json('{"key": "value"}')
        assert result == {"key": "value"}

    def test_json_with_code_block(self):
        result = _parse_llm_json('```json\n{"key": "value"}\n```')
        assert result == {"key": "value"}

    def test_json_with_generic_code_block(self):
        result = _parse_llm_json('```\n{"key": "value"}\n```')
        assert result == {"key": "value"}


class TestCleanRelatedPapers:
    def test_deduplication(self):
        papers = [
            {"arxiv_id": "2301.1", "title": "Paper A", "authors": ["A"]},
            {"arxiv_id": "2301.1", "title": "Paper A Duplicate", "authors": ["A"]},
        ]
        result = _clean_related_papers(papers)
        assert len(result) == 1

    def test_skips_empty_arxiv_id(self):
        papers = [
            {"arxiv_id": "", "title": "No ID", "authors": []},
            {"arxiv_id": "2301.1", "title": "Has ID", "authors": ["A"]},
        ]
        result = _clean_related_papers(papers)
        assert len(result) == 1
        assert result[0].arxiv_id == "2301.1"

    def test_normalizes_author_string_and_numeric_year(self):
        papers = [
            {
                "arxiv_id": "2006.11239",
                "title": "Many Authors",
                "authors": "Dan Hendrycks, Collin Burns, Steven Basart",
                "year": 2020,
            }
        ]
        result = _clean_related_papers(papers)
        assert result[0].authors == ["Dan Hendrycks", "Collin Burns", "Steven Basart"]
        assert result[0].year == "2020"

    def test_normalizes_author_dicts(self):
        papers = [
            {
                "arxiv_id": "2006.11240",
                "title": "Dict Authors",
                "authors": [{"name": "Alice"}, {"author": "Bob"}],
            }
        ]
        result = _clean_related_papers(papers)
        assert result[0].authors == ["Alice", "Bob"]


class TestStage1:
    @pytest.fixture
    def mock_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def test_extracts_core_understanding(self, mock_env):
        mock_response = Mock()
        mock_response.content = json.dumps({
            "tl_dr": "This paper proposes a novel attention mechanism.",
            "research_problem": "How to model long-range dependencies efficiently.",
            "core_insight": "Replace recurrence with self-attention for global context.",
            "method_overview": [
                "Step 1: Encode input sequence",
                "Step 2: Apply multi-head attention",
                "Step 3: Feed-forward projection",
            ],
        })

        mock_llm = Mock()
        mock_llm.invoke.return_value = mock_response

        result = run_stage_1("test paper content", "Test Paper", mock_llm)
        assert isinstance(result, Stage1Result)
        assert "attention" in result.tl_dr.lower()
        assert len(result.method_overview) == 3


class TestStage2:
    @pytest.fixture
    def mock_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def test_extracts_deep_analysis(self, mock_env):
        mock_response = Mock()
        mock_response.content = json.dumps({
            "key_techniques": [
                {"name": "Self-Attention", "description": "Global context modeling"},
            ],
            "differences_from_baseline": "Unlike RNNs, this processes all tokens in parallel.",
            "assumptions": ["Sufficient training data available"],
            "experimental_setup": "Evaluated on WMT translation tasks.",
            "key_results": [
                {
                    "metric": "BLEU",
                    "value": "28.4",
                    "interpretation": "State-of-the-art translation quality.",
                }
            ],
            "surprising_findings": ["Attention heads learn syntactic patterns"],
            "critical_reading": {
                "strengths": ["Elegant architecture"],
                "limitations": ["Quadratic complexity in sequence length"],
                "reproducibility": "Code available on GitHub.",
            },
        })

        mock_llm = Mock()
        mock_llm.invoke.return_value = mock_response

        result = run_stage_2("test paper content", "Test Paper", mock_llm)
        assert isinstance(result, Stage2Result)
        assert len(result.key_techniques) == 1
        assert result.key_techniques[0].name == "Self-Attention"
        assert len(result.critical_reading.strengths) == 1


class TestStage3:
    @pytest.fixture
    def mock_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    @patch("labora.agent.deep_reader.fetch_references_sync")
    @patch("labora.agent.deep_reader.fetch_citations_sync")
    def test_with_s2_data(self, mock_citations, mock_references, mock_env):
        mock_references.return_value = [
            {"title": "Predecessor", "arxiv_id": "1501.00001", "authors": ["X"], "year": "2015"}
        ]
        mock_citations.return_value = [
            {"title": "Successor", "arxiv_id": "2001.00001", "authors": ["Y"], "year": "2020"}
        ]

        mock_response = Mock()
        mock_response.content = json.dumps({
            "predecessor_papers": [
                {
                    "arxiv_id": "1501.00001",
                    "title": "Predecessor",
                    "authors": ["X"],
                    "year": "2015",
                    "relevance": "直接基础",
                }
            ],
            "successor_papers": [
                {
                    "arxiv_id": "2001.00001",
                    "title": "Successor",
                    "authors": ["Y"],
                    "year": "2020",
                    "relevance": "改进本文方法",
                }
            ],
            "field_position": "Pioneering work in attention-based architectures.",
        })

        mock_llm = Mock()
        mock_llm.invoke.return_value = mock_response

        result = run_stage_3("2301.12345", "paper text", "Test Paper", mock_llm)
        assert isinstance(result, Stage3Result)
        assert len(result.predecessor_papers) == 1
        assert len(result.successor_papers) == 1
        assert result.field_position != ""

    @patch("labora.agent.deep_reader.fetch_references_sync")
    @patch("labora.agent.deep_reader.fetch_citations_sync")
    def test_degraded_on_s2_failure(self, mock_citations, mock_references, mock_env):
        mock_references.side_effect = Exception("Network error")
        mock_citations.return_value = []

        mock_response = Mock()
        mock_response.content = json.dumps({
            "predecessor_papers": [],
            "successor_papers": [],
            "field_position": "Position unclear due to limited data.",
        })

        mock_llm = Mock()
        mock_llm.invoke.return_value = mock_response

        result = run_stage_3("2301.12345", "paper text", "Test Paper", mock_llm)
        assert isinstance(result, Stage3Result)
        assert result.predecessor_papers == []


class TestRunDeepReading:
    @pytest.fixture
    def mock_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    @patch("labora.agent.deep_reader.ChatOpenAI")
    def test_orchestrates_all_stages(self, mock_llm_class, mock_env):
        mock_llm = Mock()

        def stage_response(content):
            r = Mock()
            r.content = content
            return r

        mock_llm.invoke.side_effect = [
            stage_response(json.dumps({"tl_dr": "TLDR"})),
            stage_response(json.dumps({"research_problem": "Problem"})),
            stage_response(json.dumps({"core_insight": "Insight"})),
            stage_response(json.dumps({"method_overview": ["Step 1"]})),
            stage_response(json.dumps({"key_techniques": []})),
            stage_response(json.dumps({"differences_from_baseline": "Different"})),
            stage_response(json.dumps({"assumptions": []})),
            stage_response(json.dumps({"experimental_setup": "Setup"})),
            stage_response(json.dumps({"key_results": []})),
            stage_response(json.dumps({
                "surprising_findings": [],
                "critical_reading": {
                    "strengths": [], "limitations": [], "reproducibility": "Good",
                },
            })),
            stage_response(json.dumps({"predecessor_papers": []})),
            stage_response(json.dumps({"successor_papers": []})),
            stage_response(json.dumps({"field_position": "A pioneer."})),
        ]

        mock_llm_class.return_value = mock_llm

        progress_calls = []

        with patch("labora.agent.deep_reader.fetch_references_sync", return_value=[]):
            with patch("labora.agent.deep_reader.fetch_citations_sync", return_value=[]):
                result = run_deep_reading(
                    "2301.12345",
                    "paper content",
                    "Test Paper",
                    on_progress=lambda p, s, r: progress_calls.append((p, s)),
                )

        assert result["paper_id"] == "2301.12345"
        assert "1" in result["stages"]
        assert "2" in result["stages"]
        assert "3" in result["stages"]
        # Check progress callbacks
        assert progress_calls == [
            (5, 1),
            (10, 1),
            (15, 1),
            (20, 1),
            (25, 1),
            (30, 1),
            (35, 2),
            (40, 2),
            (45, 2),
            (50, 2),
            (55, 2),
            (60, 2),
            (65, 2),
            (70, 3),
            (75, 3),
            (80, 3),
            (85, 3),
            (90, 3),
            (95, 3),
            (100, 3),
        ]

    @patch("labora.agent.deep_reader.ChatOpenAI")
    def test_stage_failure_preserves_partial_results(self, mock_llm_class, mock_env):
        mock_llm = Mock()

        def stage_response(content):
            r = Mock()
            r.content = content
            return r

        # Stage 1 succeeds, Stage 2 fails, Stage 3 has no LLM responses left.
        mock_llm.invoke.side_effect = [
            stage_response(json.dumps({"tl_dr": "TLDR"})),
            stage_response(json.dumps({"research_problem": "Problem"})),
            stage_response(json.dumps({"core_insight": "Insight"})),
            stage_response(json.dumps({"method_overview": ["Step 1"]})),
            Exception("LLM error in stage 2"),
        ]

        mock_llm_class.return_value = mock_llm

        with patch("labora.agent.deep_reader.fetch_references_sync", return_value=[]):
            with patch("labora.agent.deep_reader.fetch_citations_sync", return_value=[]):
                result = run_deep_reading(
                    "2301.12345",
                    "paper content",
                    "Test Paper",
                )

        assert "1" in result["stages"]
        assert "error" in result["stages"]["2"]
        assert "error" in result["stages"]["3"]
