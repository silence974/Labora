import arxiv
import json
import logging
import threading
import time
from pathlib import Path
from typing import List, Dict, Optional
from langchain_core.tools import tool

from labora.core import config
from labora.tools.arxiv_rate_limiter import wait_for_arxiv_request_slot

logger = logging.getLogger(__name__)

DEFAULT_MAX_RESULTS = 20
MAX_RESULTS_CAP = 20
MAX_RETRIES = 5
BACKOFF_SECONDS = 2.0
MAX_BACKOFF_SECONDS = 20.0
CACHE_PATH = Path(config.data_dir) / "cache" / "arxiv_search.json"
_CACHE_LOCK = threading.Lock()


def _format_paper(paper: arxiv.Result) -> Dict:
    """格式化论文信息"""
    # 提取 ArXiv ID（去掉版本号）
    arxiv_id = paper.entry_id.split("/")[-1].split("v")[0]

    return {
        "id": f"arxiv:{arxiv_id}",
        "title": paper.title,
        "abstract": paper.summary,
        "authors": [author.name for author in paper.authors],
        "year": paper.published.year if paper.published else None,
        "arxiv_id": arxiv_id,
        "pdf_url": paper.pdf_url,
        "published": paper.published.isoformat() if paper.published else None,
        "updated": paper.updated.isoformat() if paper.updated else None,
        "categories": paper.categories,
        "primary_category": paper.primary_category,
    }


def _normalize_query(query: str) -> str:
    return " ".join(query.strip().lower().split())


def _normalize_max_results(max_results: int) -> int:
    try:
        requested = int(max_results)
    except (TypeError, ValueError):
        requested = DEFAULT_MAX_RESULTS
    return max(1, min(requested, MAX_RESULTS_CAP))


def _load_search_cache() -> dict:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Failed to read arXiv search cache at %s", CACHE_PATH)
        return {}


def _get_cached_search(query: str, max_results: int) -> Optional[List[Dict]]:
    cache_key = _normalize_query(query)
    if not cache_key:
        return None

    with _CACHE_LOCK:
        cache = _load_search_cache()
        cached = cache.get(cache_key)
    if not isinstance(cached, dict):
        return None
    results = cached.get("results")
    if not isinstance(results, list):
        return None
    return results[:max_results]


def _save_cached_search(query: str, results: List[Dict]) -> None:
    cache_key = _normalize_query(query)
    if not cache_key:
        return

    with _CACHE_LOCK:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        cache = _load_search_cache()
        cache[cache_key] = {
            "query": query,
            "cached_at": time.time(),
            "results": results,
        }
        tmp_path = CACHE_PATH.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(CACHE_PATH)


def _search_arxiv_once(query: str, max_results: int) -> List[Dict]:
    wait_for_arxiv_request_slot()
    client = arxiv.Client(
        page_size=max_results,
        delay_seconds=3.0,
        num_retries=0,
    )
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.Relevance,
    )

    return [_format_paper(paper) for paper in client.results(search)]


@tool
def arxiv_search(query: str, max_results: int = DEFAULT_MAX_RESULTS) -> List[Dict]:
    """
    搜索 ArXiv 论文

    Args:
        query: 搜索查询词
        max_results: 最大返回结果数（默认 20，最多 20）

    Returns:
        论文列表，每篇论文包含 id, title, abstract, authors, year, arxiv_id 等字段
    """
    normalized_max_results = _normalize_max_results(max_results)
    cached = _get_cached_search(query, normalized_max_results)
    if cached is not None:
        return cached

    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            results = _search_arxiv_once(query, normalized_max_results)
            _save_cached_search(query, results)
            return results
        except Exception as e:
            last_error = e
            if attempt >= MAX_RETRIES:
                break

            wait_seconds = min(MAX_BACKOFF_SECONDS, BACKOFF_SECONDS * (2 ** attempt))
            logger.warning(
                "ArXiv search failed for query %r on attempt %s/%s; retrying in %.1fs: %s",
                query,
                attempt + 1,
                MAX_RETRIES + 1,
                wait_seconds,
                e,
            )
            time.sleep(wait_seconds)

    raise RuntimeError(
        f"ArXiv search failed after {MAX_RETRIES} retries: {last_error}"
    ) from last_error


@tool
def arxiv_get_paper(arxiv_id: str) -> Optional[Dict]:
    """
    根据 ArXiv ID 获取论文详情

    Args:
        arxiv_id: ArXiv ID（如 "2301.12345"）

    Returns:
        论文信息字典，不存在返回 None
    """
    try:
        wait_for_arxiv_request_slot()
        client = arxiv.Client(
            page_size=1,
            delay_seconds=3.0,
            num_retries=0,
        )
        search = arxiv.Search(id_list=[arxiv_id])
        results = list(client.results(search))

        if not results:
            return None

        return _format_paper(results[0])

    except Exception as e:
        raise RuntimeError(f"Failed to fetch paper {arxiv_id}: {str(e)}") from e
