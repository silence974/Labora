"""
文献搜索、详情与下载 API 路由
"""

from __future__ import annotations

import asyncio
import html
import math
import mimetypes
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
from httpx import HTTPStatusError, HTTPError, TimeoutException
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from labora.core import config
from labora.services import LiteratureLibrary
from labora.tools import (
    arxiv_get_paper,
    arxiv_search,
    compile_latex_archive_to_pdf,
    is_latex_compiler_available,
)
from labora.tools.latex_parser import parse_latex_from_archive

router = APIRouter()
library = LiteratureLibrary()
ORIGINAL_CONTENT_VERSION = 4
EXTERNAL_PREVIEW_ALLOWED_SCHEMES = {"http", "https"}


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


def _resolve_pdf_preview_mode() -> str:
    configured_mode = config.pdf_preview_mode
    if configured_mode == "auto":
        return "compile" if is_latex_compiler_available() else "remote"
    return configured_mode


def _validate_external_preview_url(url: str) -> str:
    normalized_url = url.strip()
    parsed = urlparse(normalized_url)
    if parsed.scheme.lower() not in EXTERNAL_PREVIEW_ALLOWED_SCHEMES or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Only http/https external URLs are supported")
    return normalized_url


def _inject_external_preview_base(html_content: str, source_url: str) -> str:
    base_tag = f'<base href="{html.escape(source_url, quote=True)}">'
    lowercase_content = html_content.lower()

    if "<head" in lowercase_content:
        head_close_index = lowercase_content.find(">", lowercase_content.find("<head"))
        if head_close_index != -1:
            return (
                html_content[: head_close_index + 1]
                + base_tag
                + html_content[head_close_index + 1 :]
            )

    return f"<head>{base_tag}</head>{html_content}"


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
    # Fetch more than needed so we can slice for pagination without extra API calls.
    # arxiv package handles rate limiting internally.
    fetch_count = start + page_size

    raw_results = await asyncio.to_thread(
        arxiv_search.invoke,
        {"query": query, "max_results": fetch_count},
    )

    total = len(raw_results)
    page_items = raw_results[start : start + page_size]

    items: List[Dict[str, Any]] = []
    for paper in page_items:
        paper_id = paper.get("arxiv_id", "")
        items.append(
            {
                "id": f"arxiv:{paper_id}",
                "paper_id": paper_id,
                "arxiv_id": paper_id,
                "title": paper.get("title", ""),
                "abstract": paper.get("abstract"),
                "authors": paper.get("authors", []),
                "year": str(paper.get("year")) if paper.get("year") else "",
                "source": "arXiv",
                "url": f"https://arxiv.org/abs/{paper_id}" if paper_id else None,
                "source_url": _build_source_url(paper_id),
                "tags": paper.get("categories", [])[:5],
                "categories": paper.get("categories", []),
                "primary_category": paper.get("primary_category"),
                "published": paper.get("published"),
                "updated": paper.get("updated"),
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
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(response.content)


async def _ensure_pdf_preview_fallback(paper: Dict[str, Any]) -> Path:
    normalized_id = _normalize_paper_id(
        str(
            paper.get("paper_id")
            or paper.get("arxiv_id")
            or paper.get("id")
            or ""
        )
    )
    pdf_url = paper.get("pdf_url") or (
        f"https://arxiv.org/pdf/{normalized_id}.pdf" if normalized_id else None
    )
    if not normalized_id or not pdf_url:
        raise RuntimeError("No upstream PDF URL is available for preview fallback")

    fallback_pdf_path = library.resolve_fallback_pdf_path(normalized_id)
    if fallback_pdf_path.exists():
        return fallback_pdf_path

    await _download_binary(pdf_url, fallback_pdf_path)
    return fallback_pdf_path


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
        except (HTTPError, TimeoutException) as exc:
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
        except Exception as exc:
            search_result = library.search_papers_paginated(
                query=query,
                year=search_request.year,
                source=source,
                page=page,
                page_size=page_size,
            )
            notice = (
                "arXiv API is currently unavailable. "
                "Showing cached local results instead."
            )

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
        except (HTTPError, TimeoutException) as exc:
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
    preview_mode = _resolve_pdf_preview_mode()

    if preview_mode == "disabled":
        raise HTTPException(status_code=404, detail="PDF preview is disabled by configuration")

    stored_paper = library.get_paper(normalized_id) or _build_minimal_paper(normalized_id)
    paper = await _ensure_local_source_download(stored_paper)

    local_path = paper.get("local_path")
    if not local_path:
        raise HTTPException(status_code=404, detail="LaTeX source is not available for preview")

    source_archive = Path(local_path)
    if not source_archive.exists():
        raise HTTPException(status_code=404, detail="LaTeX source archive not found")

    compiled_pdf_path = library.resolve_compiled_pdf_path(normalized_id)
    preview_pdf_path: Path
    preview_source: str

    if preview_mode == "remote":
        try:
            preview_pdf_path = await _ensure_pdf_preview_fallback(paper)
            preview_source = "arxiv_pdf_fallback"
        except Exception as fallback_exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch upstream PDF preview ({fallback_exc})",
            ) from fallback_exc
    else:
        try:
            preview_pdf_path = await asyncio.to_thread(
                compile_latex_archive_to_pdf,
                source_archive,
                compiled_pdf_path,
            )
            preview_source = "compiled_latex_pdf"
        except Exception as compile_exc:
            try:
                preview_pdf_path = await _ensure_pdf_preview_fallback(paper)
                preview_source = "arxiv_pdf_fallback"
            except Exception as fallback_exc:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Failed to compile LaTeX preview "
                        f"({compile_exc}); fallback PDF fetch also failed ({fallback_exc})"
                    ),
                ) from compile_exc

    library.upsert_paper(
        {
            **paper,
            "compiled_pdf_path": str(preview_pdf_path) if preview_source == "compiled_latex_pdf" else None,
            "preview_pdf_path": str(preview_pdf_path),
            "preview_source": preview_source,
        },
        mark_accessed=True,
        mark_downloaded=_has_local_source_file(paper),
        local_path=paper.get("local_path"),
    )

    return FileResponse(
        preview_pdf_path,
        media_type="application/pdf",
        filename=f"{normalized_id}.pdf",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f'inline; filename="{normalized_id}.pdf"',
        },
    )


@router.get("/external-preview")
async def get_external_preview(url: str = Query(..., min_length=1)):
    """
    代理外部网页预览，移除原站禁止 iframe 的响应头影响。
    """
    normalized_url = _validate_external_preview_url(url)

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            upstream_response = await client.get(
                normalized_url,
                headers={
                    "User-Agent": "Labora/0.1 external-preview",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            )
            upstream_response.raise_for_status()
    except (HTTPError, TimeoutException) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to load external page preview: {exc}",
        ) from exc

    content_type = upstream_response.headers.get("content-type", "text/html; charset=utf-8")
    cache_headers = {
        "Cache-Control": "no-store",
    }

    if "text/html" in content_type.lower():
        proxied_html = _inject_external_preview_base(
            upstream_response.text,
            str(upstream_response.url),
        )
        return Response(
            content=proxied_html,
            media_type="text/html",
            headers=cache_headers,
        )

    return Response(
        content=upstream_response.content,
        media_type=content_type.split(";")[0].strip() or "application/octet-stream",
        headers=cache_headers,
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
