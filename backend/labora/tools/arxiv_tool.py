import arxiv
from typing import List, Dict, Optional
from langchain_core.tools import tool


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


@tool
def arxiv_search(query: str, max_results: int = 10) -> List[Dict]:
    """
    搜索 ArXiv 论文

    Args:
        query: 搜索查询词
        max_results: 最大返回结果数（默认 10）

    Returns:
        论文列表，每篇论文包含 id, title, abstract, authors, year, arxiv_id 等字段
    """
    try:
        client = arxiv.Client()
        search = arxiv.Search(
            query=query,
            max_results=max_results,
            sort_by=arxiv.SortCriterion.Relevance,
        )

        results = []
        for paper in client.results(search):
            results.append(_format_paper(paper))

        return results

    except Exception as e:
        raise RuntimeError(f"ArXiv search failed: {str(e)}") from e


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
        client = arxiv.Client()
        search = arxiv.Search(id_list=[arxiv_id])
        results = list(client.results(search))

        if not results:
            return None

        return _format_paper(results[0])

    except Exception as e:
        raise RuntimeError(f"Failed to fetch paper {arxiv_id}: {str(e)}") from e
