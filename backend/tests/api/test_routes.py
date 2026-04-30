"""
API 路由测试
"""

import pytest
import httpx
from fastapi.testclient import TestClient
from unittest.mock import patch, Mock
import time
from pathlib import Path
from urllib.parse import urlparse

from labora.api.app import create_app
from labora.services import LiteratureLibrary


@pytest.fixture
def client():
    """创建测试客户端"""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def mock_env(monkeypatch):
    """设置测试环境变量"""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")


@pytest.fixture
def temp_literature_library(tmp_path, monkeypatch):
    """使用临时目录隔离文献库数据"""
    library = LiteratureLibrary(
        db_path=str(tmp_path / "literature.db"),
        download_dir=str(tmp_path / "papers"),
        preview_dir=str(tmp_path / "paper_previews"),
    )
    monkeypatch.setattr("labora.api.routes.literature.library", library)
    return library


class TestHealthAPI:
    """测试健康检查 API"""

    def test_health_check(self, client):
        """测试健康检查端点"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"


class TestPapersAPI:
    """测试论文相关 API"""

    @patch("labora.api.routes.papers.arxiv_search")
    def test_search_papers(self, mock_search, client, mock_env):
        """测试搜索论文"""
        mock_search.invoke.return_value = [
            {
                "id": "arxiv:1706.03762",
                "title": "Attention Is All You Need",
                "authors": ["Vaswani et al."],
                "year": 2017,
            }
        ]

        response = client.post(
            "/api/papers/search",
            json={"query": "attention mechanism", "max_results": 10}
        )

        assert response.status_code == 200
        data = response.json()
        assert "papers" in data
        assert len(data["papers"]) == 1
        assert data["papers"][0]["title"] == "Attention Is All You Need"

    @patch("labora.api.routes.papers.memory_manager")
    @patch("labora.api.routes.papers.arxiv_get_paper")
    def test_get_paper_detail(self, mock_get_paper, mock_memory, client, mock_env):
        """测试获取论文详情"""
        # Mock memory_manager 返回 None（未缓存）
        mock_memory.get_paper.return_value = None

        mock_get_paper.invoke.return_value = {
            "id": "arxiv:1706.03762",
            "title": "Attention Is All You Need",
            "abstract": "Test abstract",
            "authors": ["Vaswani et al."],
            "year": 2017,
        }

        response = client.get("/api/papers/1706.03762")

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Attention Is All You Need"

    @patch("labora.api.routes.papers.read_paper")
    def test_start_read_paper(self, mock_read_paper, client, mock_env):
        """测试启动论文阅读"""
        mock_read_paper.return_value = {
            "paper_id": "arxiv:1706.03762",
            "key_information": {
                "background": "test",
                "method": "test",
                "contribution": ["c1"],
                "limitation": ["l1"],
            },
            "note": "test note",
        }

        response = client.post(
            "/api/papers/read",
            json={"paper_id": "arxiv:1706.03762"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["status"] == "pending"

        # 等待后台任务完成
        task_id = data["task_id"]
        time.sleep(0.5)

        # 获取状态
        status_response = client.get(f"/api/papers/read/{task_id}/status")
        assert status_response.status_code == 200


class TestResearchAPI:
    """测试研究工作流 API"""

    @patch("labora.api.routes.research.run_research")
    def test_start_research(self, mock_run_research, client, mock_env):
        """测试启动研究工作流"""
        mock_run_research.return_value = {
            "research_question": "What is attention?",
            "refined_direction": "test direction",
            "selected_papers": ["arxiv:1"],
            "synthesis": "# Test Synthesis\n\n## 研究背景\nTest",
        }

        response = client.post(
            "/api/research/start",
            json={"research_question": "What is attention mechanism?"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["status"] == "pending"

        # 等待后台任务完成
        task_id = data["task_id"]
        time.sleep(0.5)

        # 获取状态
        status_response = client.get(f"/api/research/{task_id}/status")
        assert status_response.status_code == 200
        status_data = status_response.json()
        assert status_data["task_id"] == task_id

    def test_get_nonexistent_task(self, client):
        """测试获取不存在的任务"""
        response = client.get("/api/research/nonexistent-task-id/status")
        assert response.status_code == 404

    @patch("labora.api.routes.research.run_research")
    def test_get_research_result(self, mock_run_research, client, mock_env):
        """测试获取研究结果"""
        mock_run_research.return_value = {
            "research_question": "What is attention?",
            "refined_direction": "test direction",
            "selected_papers": ["arxiv:1"],
            "synthesis": "# Test Synthesis\n\n## 研究背景\nTest",
        }

        # 启动任务
        response = client.post(
            "/api/research/start",
            json={"research_question": "What is attention?"}
        )
        task_id = response.json()["task_id"]

        # 等待完成
        time.sleep(0.5)

        # 获取结果
        result_response = client.get(f"/api/research/{task_id}/result")
        assert result_response.status_code == 200
        result_data = result_response.json()
        assert "synthesis" in result_data

    def test_list_tasks(self, client):
        """测试列出任务"""
        response = client.get("/api/research/")
        assert response.status_code == 200
        data = response.json()
        assert "tasks" in data


class FakeDownloadResponse:
    def __init__(
        self,
        content: bytes = b"%PDF-1.4 test",
        headers: dict[str, str] | None = None,
    ):
        self.content = content
        self.headers = headers or {"content-type": "application/pdf"}

    def raise_for_status(self):
        return None


class FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, *args, **kwargs):
        return FakeDownloadResponse()


class TestLiteratureAPI:
    """测试文献搜索与下载 API"""

    @patch("labora.api.routes.literature._search_arxiv_paginated")
    def test_search_literature_online(self, mock_search, client, temp_literature_library):
        """测试联网搜索文献"""
        mock_search.return_value = {
            "items": [
                {
                    "id": "arxiv:1706.03762",
                    "paper_id": "1706.03762",
                    "arxiv_id": "1706.03762",
                    "title": "Attention Is All You Need",
                    "abstract": "Test abstract",
                    "authors": ["Ashish Vaswani", "Noam Shazeer"],
                    "year": 2017,
                    "pdf_url": "https://arxiv.org/pdf/1706.03762.pdf",
                    "categories": ["cs.CL", "cs.LG"],
                    "primary_category": "cs.CL",
                    "source": "arXiv",
                    "url": "https://arxiv.org/abs/1706.03762",
                }
            ],
            "total": 37,
            "page": 2,
            "page_size": 10,
            "total_pages": 4,
            "has_prev": True,
            "has_next": True,
        }

        response = client.post(
            "/api/literature/search",
            json={"query": "attention", "page": 2, "page_size": 10, "online": True},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 37
        assert data["page"] == 2
        assert data["page_size"] == 10
        assert data["total_pages"] == 4
        assert data["has_prev"] is True
        assert data["has_next"] is True
        assert data["results"][0]["paper_id"] == "1706.03762"
        assert data["results"][0]["is_downloaded"] is False
        assert data["results"][0]["pdf_view_url"].endswith("/api/literature/pdf/1706.03762")

    @patch("labora.api.routes.literature._search_arxiv_paginated")
    def test_search_literature_online_rate_limited_falls_back_to_local(
        self,
        mock_search,
        client,
        temp_literature_library,
    ):
        """测试联网搜索遇到 arXiv 429 时回退到本地缓存"""
        temp_literature_library.upsert_paper(
            {
                "id": "arxiv:2501.00001",
                "paper_id": "2501.00001",
                "arxiv_id": "2501.00001",
                "title": "LLM Cached Paper",
                "abstract": "Cached abstract",
                "authors": ["Test Author"],
                "year": "2025",
                "source": "arXiv",
                "tags": ["cs.LG"],
            }
        )

        request = httpx.Request("GET", "https://export.arxiv.org/api/query")
        response = httpx.Response(429, request=request)
        mock_search.side_effect = httpx.HTTPStatusError(
            "rate limited",
            request=request,
            response=response,
        )

        api_response = client.post(
            "/api/literature/search",
            json={"query": "LLM", "page": 1, "page_size": 10, "online": True},
        )

        assert api_response.status_code == 200
        data = api_response.json()
        assert data["notice"] is not None
        assert "rate limiting" in data["notice"]
        assert len(data["results"]) == 1
        assert data["results"][0]["title"] == "LLM Cached Paper"

    def test_search_literature_local_pagination(self, client, temp_literature_library):
        """测试本地搜索分页"""
        for index in range(1, 6):
            temp_literature_library.upsert_paper(
                {
                    "id": f"arxiv:2501.0000{index}",
                    "paper_id": f"2501.0000{index}",
                    "arxiv_id": f"2501.0000{index}",
                    "title": f"LLM Systems Paper {index}",
                    "abstract": "Local paper",
                    "authors": ["Test Author"],
                    "year": "2025",
                    "source": "arXiv",
                    "tags": ["cs.LG"],
                },
                mark_accessed=True,
            )

        response = client.post(
            "/api/literature/search",
            json={"query": "LLM", "page": 2, "page_size": 2, "online": False},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        assert data["page"] == 2
        assert data["page_size"] == 2
        assert data["total_pages"] == 3
        assert data["has_prev"] is True
        assert data["has_next"] is True
        assert len(data["results"]) == 2

    @patch("labora.api.routes.literature._load_original_content")
    @patch("labora.api.routes.literature.arxiv_get_paper")
    def test_get_paper_detail_records_recent(
        self,
        mock_get_paper,
        mock_load_original_content,
        client,
        temp_literature_library,
    ):
        """测试打开论文详情后会写入最近记录"""
        mock_load_original_content.return_value = {
            "original_sections": [
                {
                    "key": "introduction",
                    "title": "Introduction",
                    "content": "This is the original introduction.",
                }
            ],
            "original_text": "Introduction\nThis is the original introduction.",
            "content_source": "arxiv_latex",
            "content_error": None,
        }
        mock_get_paper.invoke.return_value = {
            "id": "arxiv:1706.03762",
            "arxiv_id": "1706.03762",
            "title": "Attention Is All You Need",
            "abstract": "Test abstract",
            "authors": ["Ashish Vaswani", "Noam Shazeer"],
            "year": 2017,
            "pdf_url": "https://arxiv.org/pdf/1706.03762.pdf",
            "published": "2017-06-12T00:00:00",
        }

        detail_response = client.get("/api/literature/papers/1706.03762")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["paper_id"] == "1706.03762"
        assert detail["title"] == "Attention Is All You Need"
        assert detail["original_sections"][0]["title"] == "Introduction"
        assert detail["content_source"] == "arxiv_latex"
        assert detail["pdf_view_url"].endswith("/api/literature/pdf/1706.03762")

        recent_response = client.get("/api/literature/recent")
        assert recent_response.status_code == 200
        recent = recent_response.json()["papers"]
        assert len(recent) == 1
        assert recent[0]["paper_id"] == "1706.03762"

    @patch("labora.api.routes.literature.arxiv_get_paper")
    def test_get_paper_detail_auto_downloads_latex(
        self,
        mock_get_paper,
        client,
        temp_literature_library,
        monkeypatch,
    ):
        """测试打开未下载论文时会自动缓存 LaTeX 源码"""
        mock_get_paper.invoke.return_value = {
            "id": "arxiv:1706.03762",
            "arxiv_id": "1706.03762",
            "title": "Attention Is All You Need",
            "abstract": "Test abstract",
            "authors": ["Ashish Vaswani", "Noam Shazeer"],
            "year": 2017,
            "source_url": "https://arxiv.org/e-print/1706.03762",
        }

        async def fake_download_binary(url, destination):
            destination.write_text(
                "\\begin{abstract}Test abstract\\end{abstract}\\section{Introduction}Test intro",
                encoding="utf-8",
            )

        monkeypatch.setattr(
            "labora.api.routes.literature._download_binary",
            fake_download_binary,
        )

        detail_response = client.get("/api/literature/papers/1706.03762")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["paper_id"] == "1706.03762"
        assert detail["is_downloaded"] is True
        assert detail["local_source_url"].endswith("/api/literature/files/1706.03762")
        assert detail["content_source"] == "local_latex"
        assert detail["original_sections"][0]["title"] == "Abstract"

        stored_file = temp_literature_library.resolve_download_path("1706.03762")
        assert stored_file.exists()

    def test_get_literature_pdf_proxy(self, client, temp_literature_library, monkeypatch):
        """测试页面内排版预览端点会编译本地 LaTeX 源码"""
        source_archive = temp_literature_library.resolve_download_path("1706.03762")
        source_archive.write_text("\\documentclass{article}\\begin{document}Test\\end{document}", encoding="utf-8")

        temp_literature_library.upsert_paper(
            {
                "id": "arxiv:1706.03762",
                "paper_id": "1706.03762",
                "arxiv_id": "1706.03762",
                "title": "Attention Is All You Need",
                "local_path": str(source_archive),
            }
        )

        def fake_compile_latex_archive_to_pdf(archive_path, output_pdf_path):
            assert str(archive_path).endswith("1706.03762.tar.gz")
            output_path = temp_literature_library.resolve_compiled_pdf_path("1706.03762")
            output_path.write_bytes(b"%PDF-1.4 compiled preview")
            return output_path

        monkeypatch.setattr(
            "labora.api.routes.literature.compile_latex_archive_to_pdf",
            fake_compile_latex_archive_to_pdf,
        )
        monkeypatch.setattr(
            "labora.api.routes.literature.config.pdf_preview_mode",
            "compile",
        )

        response = client.get("/api/literature/pdf/1706.03762")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/pdf")
        assert response.headers["content-disposition"].startswith("inline;")
        assert response.content.startswith(b"%PDF-1.4")

    def test_get_literature_pdf_proxy_falls_back_to_upstream_pdf(
        self,
        client,
        temp_literature_library,
        monkeypatch,
    ):
        """测试本地 LaTeX 编译失败时回退到上游 PDF"""
        source_archive = temp_literature_library.resolve_download_path("2402.17764")
        source_archive.write_text("\\documentclass{article}\\begin{document}Test\\end{document}", encoding="utf-8")

        temp_literature_library.upsert_paper(
            {
                "id": "arxiv:2402.17764",
                "paper_id": "2402.17764",
                "arxiv_id": "2402.17764",
                "title": "Fallback Preview Paper",
                "local_path": str(source_archive),
                "pdf_url": "https://arxiv.org/pdf/2402.17764.pdf",
            }
        )

        def fake_compile_latex_archive_to_pdf(*args, **kwargs):
            raise RuntimeError("File `bbm.sty' not found.")

        monkeypatch.setattr(
            "labora.api.routes.literature.compile_latex_archive_to_pdf",
            fake_compile_latex_archive_to_pdf,
        )
        monkeypatch.setattr(
            "labora.api.routes.literature.httpx.AsyncClient",
            FakeAsyncClient,
        )
        monkeypatch.setattr(
            "labora.api.routes.literature.config.pdf_preview_mode",
            "compile",
        )

        response = client.get("/api/literature/pdf/2402.17764")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/pdf")
        assert response.content.startswith(b"%PDF-1.4")

        stored_paper = temp_literature_library.get_paper("2402.17764")
        assert stored_paper is not None
        assert stored_paper["preview_source"] == "arxiv_pdf_fallback"
        assert Path(stored_paper["preview_pdf_path"]).exists()

    def test_get_literature_pdf_proxy_remote_mode_skips_local_compile(
        self,
        client,
        temp_literature_library,
        monkeypatch,
    ):
        """测试 remote 模式下不依赖本地 TeX 编译，直接走上游 PDF"""
        source_archive = temp_literature_library.resolve_download_path("2402.17764")
        source_archive.write_text("\\documentclass{article}\\begin{document}Test\\end{document}", encoding="utf-8")

        temp_literature_library.upsert_paper(
            {
                "id": "arxiv:2402.17764",
                "paper_id": "2402.17764",
                "arxiv_id": "2402.17764",
                "title": "Remote Preview Paper",
                "local_path": str(source_archive),
                "pdf_url": "https://arxiv.org/pdf/2402.17764.pdf",
            }
        )

        def fail_if_compile_called(*args, **kwargs):
            raise AssertionError("compile_latex_archive_to_pdf should not be called in remote mode")

        monkeypatch.setattr(
            "labora.api.routes.literature.compile_latex_archive_to_pdf",
            fail_if_compile_called,
        )
        monkeypatch.setattr(
            "labora.api.routes.literature.httpx.AsyncClient",
            FakeAsyncClient,
        )
        monkeypatch.setattr(
            "labora.api.routes.literature.config.pdf_preview_mode",
            "remote",
        )

        response = client.get("/api/literature/pdf/2402.17764")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/pdf")
        assert response.content.startswith(b"%PDF-1.4")

        stored_paper = temp_literature_library.get_paper("2402.17764")
        assert stored_paper is not None
        assert stored_paper["preview_source"] == "arxiv_pdf_fallback"
        assert Path(stored_paper["preview_pdf_path"]).exists()

    def test_get_external_preview_proxy_html(self, client, monkeypatch):
        """测试外链预览端点会代理 HTML 并注入 base href"""

        class FakeExternalPreviewResponse:
            def __init__(self):
                self.text = (
                    "<!doctype html><html><head><title>TinyLlama</title></head>"
                    '<body><a href="/jzhang38">Repo</a></body></html>'
                )
                self.content = self.text.encode("utf-8")
                self.headers = {"content-type": "text/html; charset=utf-8"}
                self.url = httpx.URL("https://github.com/jzhang38/TinyLlama")

            def raise_for_status(self):
                return None

        class FakeExternalPreviewClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, *args, **kwargs):
                assert url == "https://github.com/jzhang38/TinyLlama"
                return FakeExternalPreviewResponse()

        monkeypatch.setattr(
            "labora.api.routes.literature.httpx.AsyncClient",
            FakeExternalPreviewClient,
        )

        response = client.get(
            "/api/literature/external-preview",
            params={"url": "https://github.com/jzhang38/TinyLlama"},
        )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert '<base href="https://github.com/jzhang38/TinyLlama">' in response.text
        assert "TinyLlama" in response.text

    @patch("labora.api.routes.literature.arxiv_get_paper")
    def test_download_literature(
        self,
        mock_get_paper,
        client,
        temp_literature_library,
        monkeypatch,
    ):
        """测试下载文献并通过本地文件端点访问"""
        mock_get_paper.invoke.return_value = {
            "id": "arxiv:1706.03762",
            "arxiv_id": "1706.03762",
            "title": "Attention Is All You Need",
            "abstract": "Test abstract",
            "authors": ["Ashish Vaswani", "Noam Shazeer"],
            "year": 2017,
            "pdf_url": "https://arxiv.org/pdf/1706.03762.pdf",
        }
        monkeypatch.setattr(
            "labora.api.routes.literature.httpx.AsyncClient",
            FakeAsyncClient,
        )

        download_response = client.get("/api/literature/download/1706.03762?source=arXiv")
        assert download_response.status_code == 200
        payload = download_response.json()
        assert payload["paper_id"] == "1706.03762"
        assert payload["local_source_url"].endswith("/api/literature/files/1706.03762")

        stored_file = temp_literature_library.resolve_download_path("1706.03762")
        assert stored_file.exists()

        file_path = urlparse(payload["local_source_url"]).path
        file_response = client.get(file_path)
        assert file_response.status_code == 200
        assert file_response.headers["content-type"].startswith("application/")

        recent_response = client.get("/api/literature/recent")
        recent = recent_response.json()["papers"]
        assert recent[0]["is_downloaded"] is True


class TestDeepReadAPI:
    """测试深度阅读 API"""

    @patch("labora.api.routes.deep_read.run_deep_reading")
    def test_start_deep_read(self, mock_run, client, mock_env):
        """测试启动深度阅读任务"""
        mock_run.return_value = {
            "paper_id": "2301.12345",
            "paper_title": "Test Paper",
            "stages": {
                "1": {"tl_dr": "test"},
                "2": {"key_techniques": []},
                "3": {"predecessor_papers": []},
            },
        }

        response = client.post(
            "/api/deep-read/start",
            json={
                "paper_id": "2301.12345",
                "paper_title": "Test Paper",
                "paper_content": "Paper full text content",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["status"] == "pending"

    @patch("labora.api.routes.deep_read.run_deep_reading")
    def test_start_deep_read_minimal(self, mock_run, client, mock_env):
        """测试最小参数启动深度阅读"""
        mock_run.return_value = {
            "paper_id": "2301.12345",
            "paper_title": "2301.12345",
            "stages": {},
        }

        response = client.post(
            "/api/deep-read/start",
            json={"paper_id": "2301.12345"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data

    def test_get_nonexistent_task(self, client):
        """测试获取不存在的任务"""
        response = client.get("/api/deep-read/nonexistent/status")
        assert response.status_code == 404

    def test_list_tasks(self, client):
        """测试列出所有任务"""
        response = client.get("/api/deep-read/")
        assert response.status_code == 200
        data = response.json()
        assert "tasks" in data
        assert isinstance(data["tasks"], list)

    @patch("labora.api.routes.deep_read.run_deep_reading")
    def test_delete_task(self, mock_run, client, mock_env):
        """测试删除任务"""
        mock_run.return_value = {"stages": {}}
        # Create a task first
        start_resp = client.post(
            "/api/deep-read/start",
            json={"paper_id": "2301.12345", "paper_title": "T"},
        )
        task_id = start_resp.json()["task_id"]

        # Delete it
        response = client.delete(f"/api/deep-read/{task_id}")
        assert response.status_code == 200
        assert response.json()["task_id"] == task_id

        # Verify deleted
        status_resp = client.get(f"/api/deep-read/{task_id}/status")
        assert status_resp.status_code == 404

    @patch("labora.api.routes.deep_read.run_deep_reading")
    def test_progressive_status_includes_stages(self, mock_run, client, mock_env):
        """测试渐进式状态返回包含阶段结果"""
        # Configure mock to simulate progressive results
        progress_values = []

        def mock_run_with_progress(*args, **kwargs):
            on_progress = kwargs.get("on_progress")
            if on_progress:
                from labora.agent.deep_reader import Stage1Result, Stage2Result, Stage3Result
                on_progress(33, 1, Stage1Result(
                    tl_dr="Test TLDR",
                    research_problem="A problem",
                    core_insight="An insight",
                    method_overview=["Step 1"],
                ))
                on_progress(66, 2, Stage2Result(
                    key_techniques=[],
                    differences_from_baseline="Different",
                    assumptions=[],
                    experimental_setup="Setup",
                    key_results=[],
                    surprising_findings=[],
                    critical_reading={"strengths": [], "limitations": [], "reproducibility": "Good"},
                ))
            return {
                "paper_id": "2301.12345",
                "paper_title": "Test",
                "stages": {"1": {"tl_dr": "x"}, "2": {"key_techniques": []}, "3": {}},
            }

        mock_run.side_effect = mock_run_with_progress

        response = client.post(
            "/api/deep-read/start",
            json={
                "paper_id": "2301.12345",
                "paper_title": "Test Paper",
                "paper_content": "content",
            },
        )
        task_id = response.json()["task_id"]

        # Status should show current_stage and stages
        status_resp = client.get(f"/api/deep-read/{task_id}/status")
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        assert "current_stage" in status_data
        assert "stages" in status_data

    @patch("labora.api.routes.deep_read.run_deep_reading")
    def test_result_is_unique_per_paper(self, mock_run, client, mock_env):
        """同一篇文献只保存一份深度阅读结果"""
        paper_id = "9999.00001"

        mock_run.return_value = {
            "paper_id": paper_id,
            "paper_title": "Stored Paper",
            "stages": {"1": {"tl_dr": "stored"}},
        }

        first_response = client.post(
            "/api/deep-read/start",
            json={"paper_id": paper_id, "paper_title": "First Title"},
        )
        second_response = client.post(
            "/api/deep-read/start",
            json={"paper_id": paper_id, "paper_title": "Second Title"},
        )

        assert first_response.status_code == 200
        assert second_response.status_code == 200

        list_response = client.get("/api/deep-read/")
        assert list_response.status_code == 200
        matches = [
            item
            for item in list_response.json()["tasks"]
            if item["paper_id"] == paper_id
        ]
        assert len(matches) == 1
        assert matches[0]["paper_title"] == "Second Title"

    @patch("labora.api.routes.deep_read.run_deep_reading")
    def test_get_result_by_paper(self, mock_run, client, mock_env):
        """可以按文献 ID 查询已有深度阅读结果"""
        paper_id = "9999.00002"
        mock_run.return_value = {
            "paper_id": paper_id,
            "paper_title": "Lookup Paper",
            "stages": {"1": {"tl_dr": "lookup"}},
        }

        start_response = client.post(
            "/api/deep-read/start",
            json={"paper_id": paper_id, "paper_title": "Lookup Paper"},
        )
        assert start_response.status_code == 200

        response = client.get(f"/api/deep-read/paper/{paper_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["paper_id"] == paper_id
        assert data["paper_title"] == "Lookup Paper"
