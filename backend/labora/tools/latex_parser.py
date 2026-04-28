import re
import tarfile
import tempfile
from pathlib import Path
from typing import Dict, Optional, Set, Union
import urllib.request
from langchain_core.tools import tool


TABLE_ENV_PATTERN = re.compile(
    r"\\begin\{(?P<env>table\*?|wraptable)\}(?P<args>(?:\[[^\]]*\]|\{[^{}]*\})*)(?P<body>.*?)\\end\{(?P=env)\}",
    re.DOTALL | re.IGNORECASE,
)
TABULAR_ENV_PATTERN = re.compile(
    r"\\begin\{(?P<env>tabular\*?|tabularx|longtable|array)\}(?P<args>(?:\[[^\]]*\]|\{[^{}]*\})*)(?P<body>.*?)\\end\{(?P=env)\}",
    re.DOTALL | re.IGNORECASE,
)
FIGURE_ENV_PATTERN = re.compile(
    r"\\begin\{(?P<env>figure\*?|wrapfigure)\}(?P<args>(?:\[[^\]]*\]|\{[^{}]*\})*)(?P<body>.*?)\\end\{(?P=env)\}",
    re.DOTALL | re.IGNORECASE,
)
CAPTION_PATTERN = re.compile(
    r"\\caption(?:\[[^\]]*\])?\{(?P<caption>.*?)\}",
    re.DOTALL | re.IGNORECASE,
)
INCLUDE_GRAPHICS_PATTERN = re.compile(
    r"\\includegraphics(?:\[[^\]]*\])?\{(?P<path>[^}]*)\}",
    re.IGNORECASE,
)
HREF_PATTERN = re.compile(
    r"\\href\{(?P<url>[^}]*)\}\{(?P<label>.*?)\}",
    re.DOTALL | re.IGNORECASE,
)
URL_PATTERN = re.compile(
    r"\\url\{(?P<url>[^}]*)\}",
    re.DOTALL | re.IGNORECASE,
)
TABLE_LINE_BREAK = "__LABORA_TABLE_LINE_BREAK__"


def _clean_link_label(text: str) -> str:
    text = re.sub(
        r"\\(?:textbf|textit|emph|underline|mathrm|mathbf|operatorname)\{([^}]*)\}",
        r"\1",
        text,
    )
    text = re.sub(r"[{}]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _preserve_latex_links(text: str) -> str:
    def replace_href(match: re.Match[str]) -> str:
        url = match.group("url").strip()
        label = _clean_link_label(match.group("label"))
        if not url:
            return label
        return f"[{label or url}]({url})"

    def replace_url(match: re.Match[str]) -> str:
        return match.group("url").strip()

    text = HREF_PATTERN.sub(replace_href, text)
    return URL_PATTERN.sub(replace_url, text)


def _clean_latex_inline(text: str) -> str:
    escaped_amp = "__LABORA_ESCAPED_AMP__"
    escaped_percent = "__LABORA_ESCAPED_PERCENT__"
    escaped_hash = "__LABORA_ESCAPED_HASH__"
    escaped_underscore = "__LABORA_ESCAPED_UNDERSCORE__"

    text = text.replace(r"\&", escaped_amp)
    text = text.replace(r"\%", escaped_percent)
    text = text.replace(r"\#", escaped_hash)
    text = text.replace(r"\_", escaped_underscore)
    text = _preserve_latex_links(text)

    text = re.sub(r"\\cite\{[^}]*\}", "", text)
    text = re.sub(r"\\ref\{[^}]*\}", "", text)
    text = re.sub(r"\\label\{[^}]*\}", "", text)
    text = re.sub(r"\\begin\{equation\}.*?\\end\{equation\}", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\\begin\{align\*?\}.*?\\end\{align\*?\}", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\$\$.*?\$\$", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\$.*?\$", "[MATH]", text)
    text = re.sub(r"\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\(?:textbf|textit|emph|underline|mathrm|mathbf|operatorname)\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\*?(?:\[[^\]]*\])?", "", text)
    text = re.sub(r"[{}]", "", text)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", " ", text)
    text = re.sub(r"\s+", " ", text)

    text = text.replace(escaped_amp, "&")
    text = text.replace(escaped_percent, "%")
    text = text.replace(escaped_hash, "#")
    text = text.replace(escaped_underscore, "_")
    return text.strip()


def _normalize_markdown_table_rows(rows: list[list[str]]) -> Optional[str]:
    normalized_rows = [
        [cell.strip() for cell in row]
        for row in rows
        if any(cell.strip() for cell in row)
    ]
    if len(normalized_rows) < 2:
        return None

    column_count = max(len(row) for row in normalized_rows)
    padded_rows = [
        row + [""] * (column_count - len(row))
        for row in normalized_rows
    ]
    header = padded_rows[0]
    divider = ["---"] * column_count
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(divider) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in padded_rows[1:])
    return TABLE_LINE_BREAK.join(lines)


def _convert_tabular_to_markdown(tabular_content: str) -> Optional[str]:
    escaped_amp = "__LABORA_ESCAPED_AMP__"
    body = tabular_content.replace(r"\&", escaped_amp)
    body = re.sub(r"\\(?:toprule|midrule|bottomrule|hline)\b", "", body)
    body = re.sub(r"\\(?:cline|cmidrule|specialrule)\*?(?:\[[^\]]*\])?\{[^}]*\}", "", body)
    body = re.sub(r"\\addlinespace(?:\[[^\]]*\])?", "", body)
    body = re.sub(r"\\(?:small|footnotesize|scriptsize|tiny|normalsize|centering)\b", "", body)
    body = re.sub(r"\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", body)
    body = re.sub(r"\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", body)

    rows: list[list[str]] = []
    for raw_row in re.split(r"(?<!\\)\\\\(?:\[[^\]]*\])?", body):
        stripped_row = raw_row.strip()
        if not stripped_row:
            continue

        cells = [
            _clean_latex_inline(cell.replace(escaped_amp, r"\&"))
            for cell in re.split(r"(?<!\\)&", stripped_row)
        ]
        if any(cell for cell in cells):
            rows.append(cells)

    return _normalize_markdown_table_rows(rows)


def _extract_caption(block: str) -> Optional[str]:
    match = CAPTION_PATTERN.search(block)
    if not match:
        return None

    caption = _clean_latex_inline(match.group("caption"))
    return caption or None


def _replace_table_environments(text: str) -> str:
    def replace_table(match: re.Match[str]) -> str:
        body = match.group("body")
        caption = _extract_caption(body)
        tables: list[str] = []

        def collect_tabular(tabular_match: re.Match[str]) -> str:
            markdown = _convert_tabular_to_markdown(tabular_match.group("body"))
            if markdown:
                tables.append(markdown)
            return "\n"

        TABULAR_ENV_PATTERN.sub(collect_tabular, body)

        parts: list[str] = []
        if caption:
            parts.append(f"Table: {caption}")
        parts.extend(tables)
        return "\n\n" + "\n\n".join(parts) + "\n\n" if parts else "\n\n"

    text = TABLE_ENV_PATTERN.sub(replace_table, text)

    def replace_bare_tabular(match: re.Match[str]) -> str:
        markdown = _convert_tabular_to_markdown(match.group("body"))
        if not markdown:
            return "\n"
        return "\n\n" + markdown + "\n\n"

    return TABULAR_ENV_PATTERN.sub(replace_bare_tabular, text)


def _replace_figure_environments(text: str) -> str:
    def replace_figure(match: re.Match[str]) -> str:
        body = match.group("body")
        caption = _extract_caption(body)
        image_match = INCLUDE_GRAPHICS_PATTERN.search(body)
        image_path = image_match.group("path").strip() if image_match else None

        if caption and image_path:
            return f"\n\n![{caption}]({image_path})\n\n"
        if caption:
            return f"\n\n[FIGURE] {caption}\n\n"
        if image_path:
            return f"\n\n![Embedded figure]({image_path})\n\n"
        return "\n\n"

    return FIGURE_ENV_PATTERN.sub(replace_figure, text)


def _clean_latex(text: str) -> str:
    """清理 LaTeX 命令，提取纯文本"""
    paragraph_break = "__LABORA_PARAGRAPH_BREAK__"
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _replace_table_environments(text)
    text = _replace_figure_environments(text)
    text = _preserve_latex_links(text)
    text = re.sub(r"\n\s*\n+", paragraph_break, text)

    # 移除常见的 LaTeX 命令
    text = re.sub(r"\\cite\{[^}]*\}", "", text)  # 引用
    text = re.sub(r"\\ref\{[^}]*\}", "", text)  # 引用
    text = re.sub(r"\\label\{[^}]*\}", "", text)  # 标签
    text = re.sub(r"\\begin\{equation\}.*?\\end\{equation\}", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\\begin\{align\*?\}.*?\\end\{align\*?\}", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\$\$.*?\$\$", "[EQUATION]", text, flags=re.DOTALL)
    text = re.sub(r"\$.*?\$", "[MATH]", text)
    text = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", text)  # 简单命令
    text = re.sub(r"\\[a-zA-Z]+", "", text)  # 无参数命令
    text = re.sub(r"[{}]", "", text)  # 花括号
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.replace(TABLE_LINE_BREAK, "\n")
    text = text.replace(paragraph_break, "\n\n")
    text = re.sub(r"(?:\n\s*){3,}", "\n\n", text)

    return text.strip()


SECTION_HEADING_PATTERN = re.compile(
    r"\\(?P<command>section|subsection|subsubsection|paragraph)\*?\{(?P<title>[^}]*)\}",
    re.IGNORECASE,
)


def _slugify_title(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    return slug or "section"


def _canonical_section_key(title: str) -> str:
    slug = _slugify_title(title)

    if slug == "introduction":
        return "introduction"
    if slug in {"method", "methods", "approach", "methodology"}:
        return "method"
    if slug in {"results", "result", "experiments", "experiment", "evaluation"}:
        return "results"
    if slug in {"conclusion", "conclusions", "discussion"}:
        return "conclusion"

    return slug


def _make_unique_section_key(base_key: str, sections: Dict[str, str]) -> str:
    key = base_key
    suffix = 2
    while key in sections:
        key = f"{base_key}_{suffix}"
        suffix += 1
    return key


def _extract_abstract(latex_content: str) -> Optional[str]:
    for pattern in [
        r"\\begin\{abstract\}(.*?)\\end\{abstract\}",
        r"\\abstract\{(.*?)\}",
    ]:
        match = re.search(pattern, latex_content, re.DOTALL | re.IGNORECASE)
        if not match:
            continue

        clean_text = _clean_latex(match.group(1))
        if clean_text:
            return clean_text.strip()

    return None


def _extract_document_body(latex_content: str) -> str:
    document_match = re.search(
        r"\\begin\{document\}(.*?)\\end\{document\}",
        latex_content,
        re.DOTALL | re.IGNORECASE,
    )
    if document_match:
        return document_match.group(1)
    return latex_content


def _parse_sections(latex_content: str) -> Dict[str, str]:
    """解析 LaTeX 内容，提取按出现顺序排列的全部章节。"""
    latex_content = re.sub(r"(?<!\\)%.*", "", latex_content)
    document_body = _extract_document_body(latex_content)
    sections: Dict[str, str] = {}

    abstract = _extract_abstract(document_body) or _extract_abstract(latex_content)
    if abstract:
        sections["abstract"] = abstract

    heading_matches = list(SECTION_HEADING_PATTERN.finditer(document_body))
    for index, match in enumerate(heading_matches):
        title = match.group("title").strip()
        if not title:
            continue

        start = match.end()
        end = heading_matches[index + 1].start() if index + 1 < len(heading_matches) else len(document_body)
        content = _clean_latex(document_body[start:end]).strip()
        if not content:
            continue

        base_key = _canonical_section_key(title)
        if base_key in sections:
            title_key = _slugify_title(title)
            if title_key != base_key and title_key not in sections:
                key = title_key
            else:
                key = _make_unique_section_key(title_key, sections)
        else:
            key = base_key

        sections[key] = content

    if sections:
        return sections

    full_text = _clean_latex(document_body)
    if full_text:
        return {"full_text": full_text}

    return {}


def _extract_source_archive(archive_path: Path, target_dir: Path) -> None:
    """解压源码包；如果下载结果本身就是 .tex 文本，则写成主文件。"""
    try:
        with tarfile.open(archive_path, "r:*") as tar:
            tar.extractall(target_dir, filter="data")
            return
    except tarfile.ReadError:
        pass

    try:
        raw_text = archive_path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        raise RuntimeError("Failed to read downloaded source package") from exc

    fallback_tex = target_dir / "main.tex"
    fallback_tex.write_text(raw_text, encoding="utf-8")


def _resolve_include_path(base_dir: Path, target: str) -> Optional[Path]:
    candidate = (base_dir / target).resolve()
    candidates = [candidate]

    if not candidate.suffix:
        candidates.append(candidate.with_suffix(".tex"))

    for path in candidates:
        if path.exists() and path.is_file():
            return path

    return None


def _expand_includes(tex_file: Path, visited: Optional[Set[Path]] = None) -> str:
    visited = visited or set()
    resolved = tex_file.resolve()
    if resolved in visited:
        return ""

    visited.add(resolved)
    content = tex_file.read_text(encoding="utf-8", errors="ignore")

    include_pattern = re.compile(r"\\(?:input|include)\{([^}]+)\}")

    def replace_include(match: re.Match[str]) -> str:
        include_path = _resolve_include_path(tex_file.parent, match.group(1).strip())
        if not include_path:
            return "\n"
        return "\n" + _expand_includes(include_path, visited) + "\n"

    return include_pattern.sub(replace_include, content)


def _find_main_tex(source_dir: Path) -> Path:
    tex_files = sorted(source_dir.rglob("*.tex"))
    if not tex_files:
        raise RuntimeError("No .tex file found in source package")

    def score(tex_file: Path) -> tuple[int, int]:
        file_score = 0
        stem = tex_file.stem.lower()

        if any(keyword in stem for keyword in ["main", "paper", "article", "ms"]):
            file_score += 5

        preview = tex_file.read_text(encoding="utf-8", errors="ignore")[:20000]
        if "\\documentclass" in preview:
            file_score += 10
        if "\\begin{document}" in preview:
            file_score += 6

        depth_penalty = len(tex_file.relative_to(source_dir).parts)
        return file_score, -depth_penalty

    return max(tex_files, key=score)


def parse_latex_from_archive(archive_path: Union[str, Path]) -> Dict[str, str]:
    """从本地源码归档中解析 LaTeX 内容。"""
    archive = Path(archive_path)
    if not archive.exists():
        raise RuntimeError(f"Source archive not found: {archive}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        _extract_source_archive(archive, tmpdir_path)
        main_tex = _find_main_tex(tmpdir_path)
        content = _expand_includes(main_tex)
        return _parse_sections(content)


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
            tar_path = tmpdir_path / "source.tar"

            # 下载源码包
            urllib.request.urlretrieve(source_url, tar_path)

            return parse_latex_from_archive(tar_path)

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
    tex_file = Path(tex_file_path)
    content = _expand_includes(tex_file)
    return _parse_sections(content)
