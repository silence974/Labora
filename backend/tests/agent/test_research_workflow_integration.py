"""
研究工作流集成测试

使用真实 API 测试完整流程（需要 OPENAI_API_KEY）
"""

import pytest
import os
from labora.agent import run_research


@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="Requires OPENAI_API_KEY environment variable"
)
class TestResearchWorkflowIntegration:
    """集成测试（需要真实 API）"""

    def test_run_research_simple(self):
        """测试简单的研究工作流"""
        # 使用一个简单的研究问题
        result = run_research(
            research_question="What are the recent advances in attention mechanisms for transformers?"
        )

        # 验证返回结构
        assert "research_question" in result
        assert "refined_direction" in result
        assert "selected_papers" in result
        assert "synthesis" in result

        # 验证综述内容
        synthesis = result["synthesis"]
        assert len(synthesis) >= 800  # 至少 800 字
        assert "研究背景" in synthesis or "背景" in synthesis
        assert "主要发现" in synthesis or "发现" in synthesis

        # 验证选中的论文
        assert len(result["selected_papers"]) > 0
        assert len(result["selected_papers"]) <= 3

    def test_synthesis_quality(self):
        """测试综述质量"""
        result = run_research(
            research_question="What is the transformer architecture?"
        )

        synthesis = result["synthesis"]

        # 验证长度
        assert len(synthesis) >= 800

        # 验证包含必要部分
        assert "研究背景" in synthesis or "背景" in synthesis
        assert "主要发现" in synthesis or "发现" in synthesis

        # 验证 Markdown 格式
        assert "#" in synthesis  # 包含标题
        assert "\n\n" in synthesis  # 包含段落分隔

        print(f"\n综述长度: {len(synthesis)} 字符")
        print(f"选中论文数: {len(result['selected_papers'])}")
