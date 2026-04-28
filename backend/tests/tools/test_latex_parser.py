import pytest
from labora.tools import parse_latex_from_arxiv, parse_latex_from_file
from labora.tools.latex_parser import _clean_latex, _parse_sections


class TestLatexParserTool:
    """测试 LaTeX 解析工具函数"""

    def test_parse_from_arxiv_id(self):
        """测试从 ArXiv ID 下载并解析（真实 API 调用）"""
        # 使用 Attention Is All You Need 论文
        arxiv_id = "1706.03762"

        sections = parse_latex_from_arxiv.invoke({"arxiv_id": arxiv_id})

        # 验证至少提取到一些章节
        assert len(sections) > 0

        # 验证提取到内容（可能是 full_text 或具体章节）
        if "full_text" in sections:
            # 降级到 full_text
            assert len(sections["full_text"]) > 1000
            assert "attention" in sections["full_text"].lower() or "transformer" in sections["full_text"].lower()
        else:
            # 提取到了具体章节
            assert any(len(content) > 100 for content in sections.values())
            full_text = "\n\n".join(f"## {k}\n{v}" for k, v in sections.items())
            assert "attention" in full_text.lower() or "transformer" in full_text.lower()

    def test_parse_sections_from_sample_latex(self):
        """测试解析示例 LaTeX 内容"""
        sample_latex = r"""
\documentclass{article}
\begin{document}

\begin{abstract}
This is a test abstract about machine learning and neural networks.
\end{abstract}

\section{Introduction}
This is the introduction section. We discuss the background of the problem.

\section{Method}
Our method uses a novel approach based on transformers.

\section{Results}
We achieved 95\% accuracy on the test set.

\section{Conclusion}
In conclusion, our method works well.

\end{document}
"""
        sections = _parse_sections(sample_latex)

        assert "abstract" in sections
        assert "introduction" in sections
        assert "method" in sections
        assert "results" in sections
        assert "conclusion" in sections

        # 验证内容
        assert "machine learning" in sections["abstract"]
        assert "background" in sections["introduction"]
        assert "transformers" in sections["method"]
        assert "95" in sections["results"]

    def test_clean_latex_commands(self):
        """测试清理 LaTeX 命令"""
        latex_text = r"""
This is a test \cite{paper2023} with some \textbf{bold text} and
a reference to Figure~\ref{fig:1}. We have an equation $x = y + z$
and a display equation:
\begin{equation}
E = mc^2
\end{equation}
"""
        cleaned = _clean_latex(latex_text)

        # 验证命令被移除
        assert "\\cite" not in cleaned
        assert "\\textbf" not in cleaned
        assert "\\ref" not in cleaned
        assert "\\begin" not in cleaned

        # 验证文本保留
        assert "test" in cleaned
        assert "bold text" in cleaned

        # 验证公式被替换
        assert "[MATH]" in cleaned or "[EQUATION]" in cleaned

    def test_parse_time_limit(self):
        """测试解析时间 < 10 秒"""
        import time

        arxiv_id = "1706.03762"

        start = time.time()
        sections = parse_latex_from_arxiv.invoke({"arxiv_id": arxiv_id})
        elapsed = time.time() - start

        assert elapsed < 10.0
        assert len(sections) > 0

    def test_get_full_text(self):
        """测试获取完整文本"""
        sections = {
            "abstract": "This is abstract",
            "introduction": "This is intro",
            "method": "This is method",
        }

        full_text = "\n\n".join(f"## {k}\n{v}" for k, v in sections.items())

        assert "abstract" in full_text.lower()
        assert "This is abstract" in full_text
        assert "This is intro" in full_text
        assert "This is method" in full_text

    def test_fallback_to_full_text(self):
        """测试无法识别章节时的降级处理"""
        # 没有明确章节标记的 LaTeX
        latex_content = "This is just plain text without sections."

        sections = _parse_sections(latex_content)

        # 应该返回 full_text
        assert "full_text" in sections
        assert "plain text" in sections["full_text"]

    def test_case_insensitive_section_matching(self):
        """测试章节匹配不区分大小写"""
        latex_content = r"""
\section{INTRODUCTION}
This is uppercase introduction.

\section{Method}
This is mixed case method.
"""
        sections = _parse_sections(latex_content)

        assert "introduction" in sections
        assert "method" in sections

    def test_parse_invalid_arxiv_id(self):
        """测试无效的 ArXiv ID"""
        with pytest.raises(RuntimeError):
            parse_latex_from_arxiv.invoke({"arxiv_id": "invalid_id_9999.99999"})

    def test_alternative_section_names(self):
        """测试识别章节的替代名称"""
        latex_content = r"""
\section{Approach}
Our approach is novel.

\section{Experiments}
We ran experiments.

\section{Discussion}
We discuss the results.
"""
        sections = _parse_sections(latex_content)

        # Approach 应该被识别为 method
        assert "method" in sections
        assert "novel" in sections["method"]

        # Experiments 应该被识别为 results
        assert "results" in sections

        # Discussion 应该被识别为 conclusion
        assert "conclusion" in sections

    def test_parse_all_sections_in_order(self):
        """测试保留全部章节并维持原始顺序"""
        latex_content = r"""
\begin{abstract}
Abstract text.
\end{abstract}

\section{Background}
Background text.

\section{Related Work}
Related work text.

\section{Method}
Method text.

\subsection{Training Details}
Training details text.

\section{Appendix}
Appendix text.
"""
        sections = _parse_sections(latex_content)

        assert list(sections.keys()) == [
            "abstract",
            "background",
            "related_work",
            "method",
            "training_details",
            "appendix",
        ]
        assert sections["related_work"] == "Related work text."
        assert sections["training_details"] == "Training details text."

    def test_clean_latex_keeps_tabular_as_markdown_table(self):
        """测试 tabular 环境会被转换成前端可渲染的 Markdown 表格"""
        latex_content = r"""
\section{Results}
Before the table.

\begin{table}[h]
\caption{Main benchmark results}
\begin{tabular}{lcc}
Model & Accuracy & PPL \\
FBI-LLM & 68.1 & 26.9 \\
OPT & 57.8 & 30.5 \\
\end{tabular}
\end{table}
"""
        sections = _parse_sections(latex_content)

        assert "results" in sections
        assert "Table: Main benchmark results" in sections["results"]
        assert "| Model | Accuracy | PPL |" in sections["results"]
        assert "| FBI-LLM | 68.1 | 26.9 |" in sections["results"]

    def test_clean_latex_keeps_figure_caption_readable(self):
        """测试 figure 环境不会以原始 LaTeX 垃圾文本泄露到正文里"""
        latex_content = r"""
\section{Results}
\begin{wrapfigure}{r}{0.4\textwidth}
\includegraphics[width=0.4\textwidth]{figs/plot.pdf}
\caption{Scaling trend during training}
\end{wrapfigure}
"""
        sections = _parse_sections(latex_content)

        assert "results" in sections
        assert "![Scaling trend during training](figs/plot.pdf)" in sections["results"]
        assert "wrapfigure" not in sections["results"]
