from pathlib import Path

from labora.tools.latex_typesetter import compile_latex_archive_to_pdf


class TestLatexTypesetter:
    def test_compile_latex_archive_to_pdf(self, tmp_path: Path):
        source_archive = tmp_path / "sample.tar.gz"
        source_archive.write_text(
            r"""
\documentclass{article}
\usepackage{graphicx}
\begin{document}
\section{Introduction}
Hello typeset preview.
\end{document}
""".strip(),
            encoding="utf-8",
        )
        output_pdf = tmp_path / "output.pdf"

        compiled_pdf = compile_latex_archive_to_pdf(source_archive, output_pdf)

        assert compiled_pdf == output_pdf
        assert compiled_pdf.exists()
        assert compiled_pdf.read_bytes().startswith(b"%PDF")
