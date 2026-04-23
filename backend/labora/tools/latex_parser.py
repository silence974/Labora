import re
import tarfile
import tempfile
from pathlib import Path
from typing import Dict
import urllib.request
from langchain_core.tools import tool


def _clean_latex(text: str) -> str:
    """清理 LaTeX 命令，提取纯文本"""
    # 移除常见的 LaTeX 命令
    text = re.sub(r"\\cite\{[^}]*\}", "", text)  # 引用
    text = re.sub(r"\\ref\{[^}]*\}", "", text)  # 引用
    text = re.sub(r"\\label\{[^}]*\}", "", text)  # 标签
    text = re.sub(r"\\begin\{equation\}.*?\\end\{equation\}", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\\begin\{align\}.*?\\end\{align\}", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\$\$.*?\$\$", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\$.*?\$", "[MATH]", text)
    text = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", text)  # 简单命令
    text = re.sub(r"\\[a-zA-Z]+", "", text)  # 无参数命令
    text = re.sub(r"[{}]", "", text)  # 花括号
    text = re.sub(r"\s+", " ", text)  # 多余空白

    return text.strip()


def _parse_sections(latex_content: str) -> Dict[str, str]:
    """解析 LaTeX 内容，提取各章节"""
    # 预处理：移除注释
    latex_content = re.sub(r"%.*", "", latex_content)

    section_patterns = {
        "abstract": [
            r"\\begin\{abstract\}(.*?)\\end\{abstract\}",
            r"\\abstract\{(.*?)\}",
        ],
        "introduction": [
            r"\\section\*?\{Introduction\}(.*?)(?=\\section|\Z)",
            r"\\section\*?\{INTRODUCTION\}(.*?)(?=\\section|\Z)",
        ],
        "method": [
            r"\\section\*?\{Method[s]?\}(.*?)(?=\\section|\Z)",
            r"\\section\*?\{Approach\}(.*?)(?=\\section|\Z)",
            r"\\section\*?\{Methodology\}(.*?)(?=\\section|\Z)",
        ],
        "results": [
            r"\\section\*?\{Results?\}(.*?)(?=\\section|\Z)",
            r"\\section\*?\{Experiments?\}(.*?)(?=\\section|\Z)",
        ],
        "conclusion": [
            r"\\section\*?\{Conclusion[s]?\}(.*?)(?=\\section|\Z)",
            r"\\section\*?\{Discussion\}(.*?)(?=\\section|\Z)",
        ],
    }

    sections = {}

    for section_name, patterns in section_patterns.items():
        for pattern in patterns:
            match = re.search(pattern, latex_content, re.DOTALL | re.IGNORECASE)
            if match:
                raw_text = match.group(1)
                clean_text = _clean_latex(raw_text)
                sections[section_name] = clean_text.strip()
                break

    # 如果没有提取到任何章节，返回全文
    if not sections:
        sections["full_text"] = _clean_latex(latex_content)

    return sections


@tool
def parse_latex_from_arxiv(arxiv_id: str) -> Dict[str, str]:
    """
    从 ArXiv ID 下载并解析 LaTeX 源码

    Args:
        arxiv_id: ArXiv ID（如 "2301.12345"）

    Returns:
        包含各章节内容的字典，键为章节名（abstract, introduction, method, results, conclusion）
        如果无法识别章节，返回 {"full_text": "..."}
    """
    try:
        # ArXiv 源码下载 URL
        source_url = f"https://arxiv.org/e-print/{arxiv_id}"

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            tar_path = tmpdir_path / "source.tar.gz"

            # 下载源码包
            urllib.request.urlretrieve(source_url, tar_path)

            # 解压
            with tarfile.open(tar_path, "r:gz") as tar:
                tar.extractall(tmpdir_path, filter='data')

            # 查找主 .tex 文件
            tex_files = list(tmpdir_path.glob("*.tex"))

            if not tex_files:
                raise RuntimeError("No .tex file found in source package")

            # 优先选择文件名包含 main/paper 的，否则选第一个
            main_tex = None
            for tex_file in tex_files:
                if any(keyword in tex_file.stem.lower() for keyword in ["main", "paper"]):
                    main_tex = tex_file
                    break

            if not main_tex:
                main_tex = tex_files[0]

            # 读取内容
            with open(main_tex, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            return _parse_sections(content)

    except Exception as e:
        raise RuntimeError(f"Failed to parse LaTeX for {arxiv_id}: {str(e)}") from e


@tool
def parse_latex_from_file(tex_file_path: str) -> Dict[str, str]:
    """
    从本地 .tex 文件解析

    Args:
        tex_file_path: .tex 文件路径

    Returns:
        包含各章节内容的字典
    """
    with open(tex_file_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    return _parse_sections(content)
