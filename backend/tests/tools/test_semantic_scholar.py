"""Tests for Semantic Scholar API wrapper."""

import pytest
from unittest.mock import Mock, AsyncMock, patch

from labora.tools.semantic_scholar import (
    _normalize_s2_paper,
    _extract_arxiv_id_from_s2,
    fetch_paper_details,
    fetch_references,
    fetch_citations,
    fetch_references_sync,
    fetch_citations_sync,
)


class TestNormalizeS2Paper:
    def test_extract_arxiv_id(self):
        paper = {"externalIds": {"ArXiv": "2301.12345", "DOI": "10.xxx"}}
        assert _extract_arxiv_id_from_s2(paper) == "2301.12345"

    def test_extract_arxiv_id_missing(self):
        paper = {"externalIds": {"DOI": "10.xxx"}}
        assert _extract_arxiv_id_from_s2(paper) is None

    def test_normalize_full_paper(self):
        paper = {
            "paperId": "s2id123",
            "title": "Test Paper",
            "authors": [{"name": "Author A"}, {"name": "Author B"}],
            "year": 2023,
            "venue": "NeurIPS",
            "citationCount": 42,
            "referenceCount": 30,
            "abstract": "A great paper",
            "externalIds": {"ArXiv": "2301.12345"},
        }
        result = _normalize_s2_paper(paper)
        assert result["title"] == "Test Paper"
        assert result["authors"] == ["Author A", "Author B"]
        assert result["year"] == "2023"
        assert result["venue"] == "NeurIPS"
        assert result["citation_count"] == 42
        assert result["arxiv_id"] == "2301.12345"

    def test_normalize_minimal_paper(self):
        result = _normalize_s2_paper({})
        assert result["title"] == "Unknown Title"
        assert result["authors"] == []
        assert result["year"] is None


class TestFetchPaperDetails:
    @pytest.mark.asyncio
    async def test_returns_paper_on_success(self):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "paperId": "s2id",
            "title": "Attention Is All You Need",
            "authors": [{"name": "Vaswani"}],
            "year": 2017,
            "externalIds": {"ArXiv": "1706.03762"},
        }

        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_paper_details("1706.03762")
            assert result is not None
            assert result["title"] == "Attention Is All You Need"

    @pytest.mark.asyncio
    async def test_returns_none_on_404(self):
        mock_response = Mock()
        mock_response.status_code = 404

        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_paper_details("nonexistent")
            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_error(self):
        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = Exception("Network error")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_paper_details("1706.03762")
            assert result is None


class TestFetchReferences:
    @pytest.mark.asyncio
    async def test_returns_references(self):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {
                    "citedPaper": {
                        "title": "Predecessor Paper",
                        "authors": [{"name": "Author X"}],
                        "year": 2015,
                        "externalIds": {"ArXiv": "1501.00001"},
                    }
                }
            ]
        }

        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_references("1706.03762")
            assert len(result) == 1
            assert result[0]["title"] == "Predecessor Paper"

    @pytest.mark.asyncio
    async def test_returns_empty_on_error(self):
        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = Exception("Timeout")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_references("1706.03762")
            assert result == []


class TestFetchCitations:
    @pytest.mark.asyncio
    async def test_returns_citations(self):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {
                    "citingPaper": {
                        "title": "Successor Paper",
                        "authors": [{"name": "Author Y"}],
                        "year": 2020,
                        "externalIds": {"ArXiv": "2001.00001"},
                    }
                }
            ]
        }

        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_citations("1706.03762")
            assert len(result) == 1
            assert result[0]["title"] == "Successor Paper"

    @pytest.mark.asyncio
    async def test_returns_empty_on_error(self):
        with patch("labora.tools.semantic_scholar.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = Exception("Timeout")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await fetch_citations("1706.03762")
            assert result == []
