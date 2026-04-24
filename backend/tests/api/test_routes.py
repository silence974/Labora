"""
API 路由测试
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, Mock
import time

from labora.api.app import create_app


@pytest.fixture
def client():
    """创建测试客户端"""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def mock_env(monkeypatch):
    """设置测试环境变量"""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")


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
