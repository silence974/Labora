"""
Semantic Scholar API 工具

提供免费的 Semantic Scholar Academic Graph API 封装：
- 论文详情查询
- 引用关系查询（前驱/后继论文）
"""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

S2_BASE_URL = "https://api.semanticscholar.org/graph/v1"
DEFAULT_FIELDS = (
    "title,authors,year,venue,citationCount,referenceCount,abstract,externalIds"
)
REFERENCE_FIELDS = "title,authors,year,externalIds,citationCount,abstract"
DEFAULT_TIMEOUT = 15.0
DEFAULT_LIMIT = 20


def _extract_arxiv_id_from_s2(s2_paper: dict) -> str | None:
    """从 Semantic Scholar 论文数据中提取 ArXiv ID"""
    ext_ids = s2_paper.get("externalIds") or {}
    arxiv_id = ext_ids.get("ArXiv")
    return arxiv_id


def _normalize_s2_paper(paper: dict) -> dict:
    """将 S2 API 响应标准化为统一格式"""
    authors = paper.get("authors") or []
    return {
        "title": paper.get("title", "Unknown Title"),
        "authors": [a.get("name", "") for a in authors],
        "year": str(paper.get("year")) if paper.get("year") else None,
        "venue": paper.get("venue", ""),
        "citation_count": paper.get("citationCount", 0),
        "reference_count": paper.get("referenceCount", 0),
        "arxiv_id": _extract_arxiv_id_from_s2(paper),
        "s2_paper_id": paper.get("paperId"),
        "abstract": paper.get("abstract", ""),
    }


async def fetch_paper_details(arxiv_id: str) -> dict | None:
    """
    通过 ArXiv ID 查询 Semantic Scholar 论文详情

    Args:
        arxiv_id: ArXiv ID（如 "2301.12345"）

    Returns:
        标准化后的论文字典，未找到则返回 None
    """
    url = f"{S2_BASE_URL}/paper/ArXiv:{arxiv_id}"
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            response = await client.get(
                url,
                params={"fields": DEFAULT_FIELDS},
            )
            if response.status_code == 404:
                logger.warning("S2 paper not found for arxiv:%s", arxiv_id)
                return None
            response.raise_for_status()
            data = response.json()
            return _normalize_s2_paper(data)
    except Exception as e:
        logger.error("S2 API error fetching paper %s: %s", arxiv_id, e)
        return None


async def fetch_references(arxiv_id: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
    """
    获取论文的参考文献列表（前驱论文）

    Args:
        arxiv_id: 论文的 ArXiv ID
        limit: 返回数量上限

    Returns:
        标准化后的前驱论文列表，失败时返回空列表
    """
    url = f"{S2_BASE_URL}/paper/ArXiv:{arxiv_id}/references"
    papers = []
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            response = await client.get(
                url,
                params={
                    "fields": REFERENCE_FIELDS,
                    "offset": 0,
                    "limit": limit,
                },
            )
            response.raise_for_status()
            data = response.json()
            for item in data.get("data", []):
                cited = item.get("citedPaper")
                if cited:
                    papers.append(_normalize_s2_paper(cited))
        return papers
    except Exception as e:
        logger.error("S2 API error fetching references for %s: %s", arxiv_id, e)
        return []


async def fetch_citations(arxiv_id: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
    """
    获取引用该论文的论文列表（后继论文）

    Args:
        arxiv_id: 论文的 ArXiv ID
        limit: 返回数量上限

    Returns:
        标准化后的后继论文列表，失败时返回空列表
    """
    url = f"{S2_BASE_URL}/paper/ArXiv:{arxiv_id}/citations"
    papers = []
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            response = await client.get(
                url,
                params={
                    "fields": REFERENCE_FIELDS,
                    "offset": 0,
                    "limit": limit,
                },
            )
            response.raise_for_status()
            data = response.json()
            for item in data.get("data", []):
                citing = item.get("citingPaper")
                if citing:
                    papers.append(_normalize_s2_paper(citing))
        return papers
    except Exception as e:
        logger.error("S2 API error fetching citations for %s: %s", arxiv_id, e)
        return []


def fetch_references_sync(arxiv_id: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
    """同步版本的 fetch_references，供非异步上下文使用"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return asyncio.run(fetch_references(arxiv_id, limit))
    except RuntimeError:
        pass
    return asyncio.run(fetch_references(arxiv_id, limit))


def fetch_citations_sync(arxiv_id: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
    """同步版本的 fetch_citations，供非异步上下文使用"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return asyncio.run(fetch_citations(arxiv_id, limit))
    except RuntimeError:
        pass
    return asyncio.run(fetch_citations(arxiv_id, limit))
