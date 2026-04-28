"""
文献搜索、详情与下载 API 路由
"""

from __future__ import annotations

import asyncio
import math
import mimetypes
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from labora.services import LiteratureLibrary
from labora.tools import arxiv_get_paper, arxiv_search, compile_latex_archive_to_pdf
from labora.tools.latex_parser import parse_latex_from_archive

router = APIRouter()
library = LiteratureLibrary()
ORIGINAL_CONTENT_VERSION = 3


class LiteratureSearchRequest(BaseModel):
    """文献搜索请求"""

    query: str
    year: Optional[str] = None
    source: Optional[str] = None
    limit: int = 20
    online: bool = False
    page: int = 1
    page_size: int = 10


class LiteratureItem(BaseModel):
    """文献条目"""

    paper_id: str
    title: str
    authors: List[str]
    year: str
    abstract: Optional[str] = None
    source: str
    url: Optional[str] = None
    source_url: Optional[str] = None
    pdf_url: Optional[str] = None
    pdf_view_url: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    is_downloaded: bool = False
    local_source_url: Optional[str] = None


class LiteratureContentSection(BaseModel):
    """原文内容分段。"""

    key: str
    title: str
    content: str


class LiteratureDetail(LiteratureItem):
    """文献详情"""

    published: Optional[str] = None
    updated: Optional[str] = None
    original_sections: List[LiteratureContentSection] = Field(default_factory=list)
    original_text: Optional[str] = None
    content_source: Optional[str] = None
    content_error: Optional[str] = None


class LiteratureSearchResponse(BaseModel):
    """文献搜索响应"""

    query: str
    page: int
    page_size: int
    total: int
    total_pages: int
    has_prev: bool
    has_next: bool
    notice: Optional[str] = None
    results: List[LiteratureItem]


class LiteratureDownloadResponse(BaseModel):
    """文献下载响应"""

    paper_id: str
    source: str
    source_url: str
    download_url: str
    local_source_url: str


def _normalize_paper_id(paper_id: str) -> str:
    return LiteratureLibrary.normalize_paper_id(paper_id)


SECTION_TITLE_MAP = {
    "abstract": "Abstract",
    "introduction": "Introduction",
    "method": "Method",
    "results": "Results",
    "conclusion": "Conclusion",
    "full_text": "Full Text",
}

def _build_source_url(paper_id: str) -> Optional[str]:
    normalized_id = _normalize_paper_id(paper_id)
    if not normalized_id:
        return None
    return f"https://arxiv.org/e-print/{normalized_id}"


def _build_local_source_url(request: Request, paper_id: str) -> str:
    return str(
        request.url_for(
            "get_downloaded_literature_file",
            paper_id=_normalize_paper_id(paper_id),
        )
    )


def _build_pdf_view_url(request: Request, paper_id: str) -> str:
    return str(
        request.url_for(
            "get_literature_pdf_view",
            paper_id=_normalize_paper_id(paper_id),
        )
    )


def _build_minimal_paper(paper_id: str) -> Dict[str, Any]:
    normalized_id = _normalize_paper_id(paper_id)
    return {
        "id": f"arxiv:{normalized_id}",
        "paper_id": normalized_id,
        "arxiv_id": normalized_id,
        "title": normalized_id,
        "authors": [],
        "year": "",
        "source": "arXiv",
        "url": f"https://arxiv.org/abs/{normalized_id}" if normalized_id else None,
        "source_url": _build_source_url(normalized_id),
        "pdf_url": f"https://arxiv.org/pdf/{normalized_id}.pdf" if normalized_id else None,
        "tags": [],
    }


def _has_local_source_file(record: Optional[Dict[str, Any]]) -> bool:
    if not record:
        return False

    local_path = record.get("local_path")
    if not local_path:
        return False

    path = Path(local_path)
    if not path.exists():
        return False

    return path.suffix.lower() != ".pdf"


def _paper_to_item_dict(paper: Dict[str, Any]) -> Dict[str, Any]:
    normalized_id = _normalize_paper_id(
        str(
            paper.get("paper_id")
            or paper.get("arxiv_id")
            or paper.get("id")
            or ""
        )
    )
    tags = paper.get("tags") or paper.get("categories") or []
    if paper.get("primary_category"):
        tags = [paper["primary_category"], *tags]
    tags = list(dict.fromkeys([tag for tag in tags if tag]))[:5]

    return {
        "paper_id": normalized_id,
        "title": paper.get("title") or normalized_id,
        "authors": paper.get("authors") or [],
        "year": str(paper.get("year") or ""),
        "abstract": paper.get("abstract"),
        "source": paper.get("source") or "arXiv",
        "url": paper.get("url") or (
            f"https://arxiv.org/abs/{normalized_id}" if normalized_id else None
        ),
        "source_url": paper.get("source_url") or _build_source_url(normalized_id),
        "pdf_url": paper.get("pdf_url") or (
            f"https://arxiv.org/pdf/{normalized_id}.pdf" if normalized_id else None
        ),
        "tags": tags,
        "published": paper.get("published"),
        "updated": paper.get("updated"),
        "original_sections": paper.get("original_sections") or [],
        "original_text": paper.get("original_text"),
        "content_source": paper.get("content_source"),
        "content_error": paper.get("content_error"),
    }


def _enrich_with_local_state(
    request: Request,
    item_data: Dict[str, Any],
    stored_paper: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    record = stored_paper or library.get_paper(item_data["paper_id"])
    item_data["pdf_view_url"] = _build_pdf_view_url(request, item_data["paper_id"])
    if _has_local_source_file(record):
        item_data["is_downloaded"] = True
        item_data["local_source_url"] = _build_local_source_url(request, item_data["paper_id"])
    else:
        item_data["is_downloaded"] = False
        item_data["local_source_url"] = None
    return item_data


async def _search_arxiv(query: str, limit: int) -> List[Dict[str, Any]]:
    return await asyncio.to_thread(
        arxiv_search.invoke,
        {"query": query, "max_results": limit},
    )


async def _search_arxiv_paginated(
    query: str,
    *,
    page: int,
    page_size: int,
    year: Optional[str] = None,
) -> Dict[str, Any]:
    start = (page - 1) * page_size
    search_query = f"all:{query}"
    if year:
        search_query = (
            f"({search_query}) AND "
            f"submittedDate:[{year}01010000 TO {year}12312359]"
        )

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(
            "https://export.arxiv.org/api/query",
            params={
                "search_query": search_query,
                "start": start,
                "max_results": page_size,
                "sortBy": "relevance",
                "sortOrder": "descending",
            },
        )
        response.raise_for_status()

    root = ET.fromstring(response.text)
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
    }

    total_results_text = root.findtext("opensearch:totalResults", default="0", namespaces=ns)
    total = int(total_results_text)
    items: List[Dict[str, Any]] = []

    for entry in root.findall("atom:entry", ns):
        paper_id = entry.findtext("atom:id", default="", namespaces=ns).split("/")[-1]
        title = entry.findtext("atom:title", default="", namespaces=ns).strip().replace("\n", " ")
        abstract = entry.findtext("atom:summary", default="", namespaces=ns).strip().replace("\n", " ")
        published = entry.findtext("atom:published", default="", namespaces=ns)
        updated = entry.findtext("atom:updated", default="", namespaces=ns)

        authors = [
            author.findtext("atom:name", default="", namespaces=ns)
            for author in entry.findall("atom:author", ns)
        ]

        tags = [category.get("term") for category in entry.findall("atom:category", ns) if category.get("term")]

        items.append(
            {
                "id": f"arxiv:{paper_id}",
                "paper_id": paper_id,
                "arxiv_id": paper_id,
                "title": title,
                "abstract": abstract or None,
                "authors": [author for author in authors if author],
                "year": published[:4] if published else "",
                "source": "arXiv",
                "url": f"https://arxiv.org/abs/{paper_id}" if paper_id else None,
                "source_url": _build_source_url(paper_id),
                "tags": tags[:5],
                "categories": tags,
                "primary_category": tags[0] if tags else None,
                "published": published or None,
                "updated": updated or None,
            }
        )

    total_pages = math.ceil(total / page_size) if page_size > 0 else 0
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "has_prev": page > 1,
        "has_next": page < total_pages,
    }


async def _get_arxiv_paper(paper_id: str) -> Optional[Dict[str, Any]]:
    return await asyncio.to_thread(
        arxiv_get_paper.invoke,
        {"arxiv_id": _normalize_paper_id(paper_id)},
    )


async def _download_binary(url: str, destination: Path) -> None:
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        destination.write_bytes(response.content)


def _humanize_section_title(key: str) -> str:
    if key in SECTION_TITLE_MAP:
        return SECTION_TITLE_MAP[key]
    return key.replace("_", " ").title()


def _build_original_sections(
    parsed_sections: Dict[str, str],
    fallback_abstract: Optional[str] = None,
) -> List[Dict[str, str]]:
    sections: List[Dict[str, str]] = []
    for key, content in parsed_sections.items():
        normalized_content = (content or "").strip()
        if not normalized_content:
            continue
        sections.append(
            {
                "key": key,
                "title": _humanize_section_title(key),
                "content": normalized_content,
            }
        )

    if sections or not fallback_abstract:
        return sections

    return [
        {
            "key": "abstract",
            "title": "Abstract",
            "content": fallback_abstract.strip(),
        }
    ]


def _join_original_sections(sections: List[Dict[str, str]]) -> Optional[str]:
    if not sections:
        return None

    parts: List[str] = []
    for section in sections:
        title = section["title"]
        content = section["content"]
        if section["key"] == "full_text":
            parts.append(content)
        else:
            parts.append(f"{title}\n{content}")
    return "\n\n".join(parts)


async def _load_original_content(paper: Dict[str, Any]) -> Dict[str, Any]:
    cached_sections = paper.get("original_sections") or []
    cached_text = paper.get("original_text")
    if (cached_sections or cached_text) and paper.get("content_version") == ORIGINAL_CONTENT_VERSION:
        return {
            "original_sections": cached_sections,
            "original_text": cached_text,
            "content_source": paper.get("content_source"),
            "content_error": paper.get("content_error"),
            "content_version": ORIGINAL_CONTENT_VERSION,
        }

    normalized_id = _normalize_paper_id(
        str(
            paper.get("paper_id")
            or paper.get("arxiv_id")
            or paper.get("id")
            or ""
        )
    )
    source_url = paper.get("source_url") or _build_source_url(normalized_id)
    local_path = paper.get("local_path")
    fallback_abstract = paper.get("abstract")

    try:
        if _has_local_source_file(paper):
            parsed_sections = await asyncio.to_thread(parse_latex_from_archive, local_path)
            content_source = "local_latex"
        else:
            if not source_url:
                raise RuntimeError("No LaTeX source URL available")
            with tempfile.TemporaryDirectory() as tmpdir:
                archive_path = Path(tmpdir) / "source.tar"
                await _download_binary(source_url, archive_path)
                parsed_sections = await asyncio.to_thread(parse_latex_from_archive, archive_path)
            content_source = "arxiv_latex"

        original_sections = _build_original_sections(parsed_sections, fallback_abstract)
        return {
            "original_sections": original_sections,
            "original_text": _join_original_sections(original_sections),
            "content_source": content_source,
            "content_error": None,
            "content_version": ORIGINAL_CONTENT_VERSION,
        }
    except Exception as exc:
        original_sections = _build_original_sections({}, fallback_abstract)
        return {
            "original_sections": original_sections,
            "original_text": _join_original_sections(original_sections),
            "content_source": "abstract_fallback" if original_sections else None,
            "content_error": f"Failed to parse LaTeX source: {exc}",
            "content_version": ORIGINAL_CONTENT_VERSION,
        }


async def _ensure_local_source_download(paper: Dict[str, Any]) -> Dict[str, Any]:
    """确保论文源码已缓存到本地；失败时返回原数据并附带下载错误。"""
    if _has_local_source_file(paper):
        return paper

    normalized_id = _normalize_paper_id(
        str(
            paper.get("paper_id")
            or paper.get("arxiv_id")
            or paper.get("id")
            or ""
        )
    )
    source_url = paper.get("source_url") or _build_source_url(normalized_id)
    if not normalized_id or not source_url:
        return paper

    destination = library.resolve_download_path(normalized_id)
    if not destination.exists():
        try:
            await _download_binary(source_url, destination)
        except httpx.HTTPError as exc:
            return {
                **paper,
                "source_url": source_url,
                "download_error": f"Failed to auto-download LaTeX source: {exc}",
            }

    return {
        **paper,
        "source_url": source_url,
        "local_path": str(destination),
    }


@router.post("/search", response_model=LiteratureSearchResponse)
async def search_literature(
    request: Request,
    search_request: LiteratureSearchRequest,
):
    """搜索文献，默认搜索本地库，开启 online 后联网搜索 arXiv。"""
    query = search_request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    source = search_request.source.strip() if search_request.source else None
    results: List[LiteratureItem] = []
    page = max(search_request.page, 1)
    page_size = max(1, min(search_request.page_size or search_request.limit, 50))
    total = 0
    total_pages = 0
    has_prev = False
    has_next = False
    notice: Optional[str] = None

    if search_request.online:
        if source and source.lower() != "arxiv":
            return LiteratureSearchResponse(
                query=query,
                page=page,
                page_size=page_size,
                total=0,
                total_pages=0,
                has_prev=False,
                has_next=False,
                notice=None,
                results=[],
            )

        try:
            search_result = await _search_arxiv_paginated(
                query,
                page=page,
                page_size=page_size,
                year=search_request.year,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                search_result = library.search_papers_paginated(
                    query=query,
                    year=search_request.year,
                    source=source,
                    page=page,
                    page_size=page_size,
                )
                notice = (
                    "arXiv is temporarily rate limiting requests. "
                    "Showing cached local results instead."
                )
            else:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to search arXiv: {exc}",
                ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to search arXiv: {exc}",
            ) from exc

        for paper in search_result["items"]:
            stored_paper = library.upsert_paper(paper)
            item_data = _paper_to_item_dict(stored_paper)
            item_data = _enrich_with_local_state(request, item_data, stored_paper)
            results.append(LiteratureItem(**item_data))
        total = search_result["total"]
        total_pages = search_result["total_pages"]
        has_prev = search_result["has_prev"]
        has_next = search_result["has_next"]
    else:
        search_result = library.search_papers_paginated(
            query=query,
            year=search_request.year,
            source=source,
            page=page,
            page_size=page_size,
        )
        for paper in search_result["items"]:
            item_data = _paper_to_item_dict(paper)
            item_data = _enrich_with_local_state(request, item_data, paper)
            results.append(LiteratureItem(**item_data))
        total = search_result["total"]
        total_pages = search_result["total_pages"]
        has_prev = search_result["has_prev"]
        has_next = search_result["has_next"]

    return LiteratureSearchResponse(
        query=query,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
        has_prev=has_prev,
        has_next=has_next,
        notice=notice,
        results=results,
    )


@router.get("/papers/{paper_id}", response_model=LiteratureDetail)
async def get_literature_paper_detail(request: Request, paper_id: str):
    """
    获取文献详情与原文内容，并记录最近访问。
    """
    normalized_id = _normalize_paper_id(paper_id)

    stored_paper = library.get_paper(normalized_id)
    if stored_paper and stored_paper.get("title"):
        paper = stored_paper
    else:
        try:
            paper = await _get_arxiv_paper(normalized_id)
        except Exception:
            paper = None

        if not paper:
            paper = _build_minimal_paper(normalized_id)

    paper = {
        **paper,
        "source_url": paper.get("source_url") or _build_source_url(normalized_id),
    }
    paper = await _ensure_local_source_download(paper)
    paper.update(await _load_original_content(paper))
    download_error = paper.pop("download_error", None)
    if download_error:
        existing_error = paper.get("content_error")
        paper["content_error"] = f"{download_error}. {existing_error}" if existing_error else download_error

    stored_paper = library.upsert_paper(
        paper,
        mark_accessed=True,
        mark_downloaded=_has_local_source_file(paper),
        local_path=paper.get("local_path"),
    )
    item_data = _paper_to_item_dict(stored_paper)
    item_data = _enrich_with_local_state(request, item_data, stored_paper)
    return LiteratureDetail(**item_data)


@router.get("/download/{paper_id}", response_model=LiteratureDownloadResponse)
async def download_literature(
    request: Request,
    paper_id: str,
    source: str = Query(default="arXiv"),
):
    """
    下载文献 LaTeX 源码到本地缓存目录，并返回可直接访问的文件 URL。
    """
    if source.strip().lower() != "arxiv":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported source: {source}",
        )

    normalized_id = _normalize_paper_id(paper_id)
    stored_paper = library.get_paper(normalized_id)

    if stored_paper is None:
        stored_paper = library.upsert_paper(
            _build_minimal_paper(normalized_id),
            mark_accessed=True,
        )

    source_url = stored_paper.get("source_url") or _build_source_url(normalized_id)
    if not source_url:
        raise HTTPException(status_code=400, detail="LaTeX source URL is not available")

    destination = library.resolve_download_path(normalized_id)

    if not destination.exists():
        try:
            await _download_binary(source_url, destination)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download LaTeX source: {exc}",
            ) from exc

    paper_with_content = {
        **stored_paper,
        "source_url": source_url,
    }

    if not paper_with_content.get("original_sections") and destination.exists():
        paper_with_content.update(await _load_original_content({**paper_with_content, "local_path": str(destination)}))

    stored_paper = library.upsert_paper(
        paper_with_content,
        mark_accessed=True,
        mark_downloaded=True,
        local_path=str(destination),
    )
    local_source_url = _build_local_source_url(request, normalized_id)

    return LiteratureDownloadResponse(
        paper_id=normalized_id,
        source=stored_paper.get("source", "arXiv"),
        source_url=source_url,
        download_url=local_source_url,
        local_source_url=local_source_url,
    )


@router.get("/files/{paper_id}", name="get_downloaded_literature_file")
async def get_downloaded_literature_file(paper_id: str):
    """
    提供已下载 LaTeX 源码文件。
    """
    normalized_id = _normalize_paper_id(paper_id)
    stored_paper = library.get_paper(normalized_id)
    if not stored_paper or not stored_paper.get("local_path"):
        raise HTTPException(status_code=404, detail="Downloaded file not found")

    file_path = Path(stored_paper["local_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Downloaded file not found")

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type, filename=file_path.name)


@router.get("/pdf/{paper_id}", name="get_literature_pdf_view")
async def get_literature_pdf_view(paper_id: str):
    """
    返回由本地 LaTeX 源码编译出的排版预览 PDF，用于前端按页渲染。
    """
    normalized_id = _normalize_paper_id(paper_id)
    stored_paper = library.get_paper(normalized_id) or _build_minimal_paper(normalized_id)
    paper = await _ensure_local_source_download(stored_paper)

    local_path = paper.get("local_path")
    if not local_path:
        raise HTTPException(status_code=404, detail="LaTeX source is not available for preview")

    source_archive = Path(local_path)
    if not source_archive.exists():
        raise HTTPException(status_code=404, detail="LaTeX source archive not found")

    compiled_pdf_path = library.resolve_compiled_pdf_path(normalized_id)

    try:
        compiled_pdf = await asyncio.to_thread(
            compile_latex_archive_to_pdf,
            source_archive,
            compiled_pdf_path,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to compile LaTeX preview: {exc}",
        ) from exc

    library.upsert_paper(
        {
            **paper,
            "compiled_pdf_path": str(compiled_pdf),
            "preview_source": "compiled_latex_pdf",
        },
        mark_accessed=True,
        mark_downloaded=_has_local_source_file(paper),
        local_path=paper.get("local_path"),
    )

    return FileResponse(
        compiled_pdf,
        media_type="application/pdf",
        filename=f"{normalized_id}.pdf",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f'inline; filename="{normalized_id}.pdf"',
        },
    )


@router.get("/recent")
async def get_recent_papers(
    request: Request,
    limit: int = Query(default=10, ge=1, le=50),
):
    """
    获取最近查看的文献。
    """
    papers = []
    for paper in library.list_recent_papers(limit=limit):
        item_data = _paper_to_item_dict(paper)
        item_data = _enrich_with_local_state(request, item_data, paper)
        papers.append(LiteratureItem(**item_data))

    return {"papers": papers}
