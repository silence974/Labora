import katex from 'katex'
import 'katex/dist/katex.min.css'
import { memo } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { LiteratureContentSection, LiteratureDetail } from '../api/literature'
import { findReferenceMatches } from '../utils/literatureLinks'
import type { LiteratureReferenceTarget } from '../utils/literatureLinks'

type ContentBlockType = 'paragraph' | 'table' | 'image' | 'latex'

interface ContentBlockBase {
  id: string
  type: ContentBlockType
}

interface ParagraphBlock extends ContentBlockBase {
  type: 'paragraph'
  content: string
}

interface TableBlock extends ContentBlockBase {
  type: 'table'
  headers: string[]
  rows: string[][]
}

interface ImageBlock extends ContentBlockBase {
  type: 'image'
  src: string | null
  alt: string
  assetLabel?: string
}

interface LatexBlock extends ContentBlockBase {
  type: 'latex'
  latex: string
  displayMode: boolean
}

type ContentBlock = ParagraphBlock | TableBlock | ImageBlock | LatexBlock

interface RenderPage {
  id: string
  pageNumber: number
  sectionKey: string
  sectionTitle: string
  isContinuation: boolean
  blocks: ContentBlock[]
}

const INITIAL_RENDERED_PAGES = 4
const PAGE_BATCH_SIZE = 4
const PAGE_RENDER_BUDGET = 3200

const INLINE_LATEX_PATTERN = /(\$\$[\s\S]+?\$\$|(?<!\$)\$[^$\n]+\$(?!\$))/g
const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.*?)\)$/
const DIRECT_IMAGE_PATTERN = /^https?:\/\/\S+\.(?:png|jpe?g|gif|svg|webp|avif)(?:\?\S*)?$/i
const FIGURE_PLACEHOLDER_PATTERN = /^\[FIGURE\]\s*(.+)$/i

type InlineFragment =
  | {
      kind: 'text'
      key: string
      value: string
    }
  | {
      kind: 'latex'
      key: string
      value: string
      displayMode: boolean
    }
  | {
      kind: 'reference'
      key: string
      label: string
      href: string
      isArxiv: boolean
      paperId?: string
    }

function shouldLogPerformance(enablePerfLog?: boolean): boolean {
  return Boolean(
    enablePerfLog &&
      import.meta.env.DEV &&
      typeof window !== 'undefined' &&
      (window as unknown as { __LABORA_ENABLE_RENDER_PROFILING__?: boolean })
        .__LABORA_ENABLE_RENDER_PROFILING__ !== false,
  )
}

function measure<T>(label: string, enabled: boolean, callback: () => T): T {
  if (!enabled) {
    return callback()
  }

  console.time(label)
  try {
    return callback()
  } finally {
    console.timeEnd(label)
  }
}

function parseTableBlock(block: string, blockId: string): TableBlock | null {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2 || !lines.every((line) => line.startsWith('|') && line.endsWith('|'))) {
    return null
  }

  const rows = lines.map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  )

  const secondRow = rows[1] ?? []
  const looksLikeDivider = secondRow.every((cell) => /^:?-{3,}:?$/.test(cell))
  if (!looksLikeDivider) {
    return null
  }

  return {
    id: blockId,
    type: 'table',
    headers: rows[0],
    rows: rows.slice(2),
  }
}

function parseImageBlock(block: string, blockId: string): ImageBlock | null {
  const normalized = block.trim()
  const figurePlaceholderMatch = normalized.match(FIGURE_PLACEHOLDER_PATTERN)
  if (figurePlaceholderMatch) {
    return {
      id: blockId,
      type: 'image',
      alt: figurePlaceholderMatch[1] || 'Embedded figure',
      src: null,
    }
  }

  const markdownMatch = normalized.match(MARKDOWN_IMAGE_PATTERN)
  if (markdownMatch) {
    const src = markdownMatch[2].trim()
    const isRemoteAsset = /^https?:\/\//i.test(src) || src.startsWith('data:image/')
    return {
      id: blockId,
      type: 'image',
      alt: markdownMatch[1] || 'Embedded figure',
      src: isRemoteAsset ? src : null,
      assetLabel: src,
    }
  }

  if (DIRECT_IMAGE_PATTERN.test(normalized)) {
    return {
      id: blockId,
      type: 'image',
      alt: 'Embedded figure',
      src: normalized,
    }
  }

  return null
}

function parseLatexBlock(block: string, blockId: string): LatexBlock | null {
  const normalized = block.trim()

  if (normalized === '[EQUATION]' || normalized === '[MATH]') {
    return {
      id: blockId,
      type: 'latex',
      latex: '\\text{Formula omitted during LaTeX extraction}',
      displayMode: true,
    }
  }

  if (normalized.startsWith('$$') && normalized.endsWith('$$')) {
    return {
      id: blockId,
      type: 'latex',
      latex: normalized.slice(2, -2).trim(),
      displayMode: true,
    }
  }

  return null
}

function parseSectionBlocks(section: LiteratureContentSection, pageNumber: number): ContentBlock[] {
  const normalizedContent = section.content.replace(/\r\n/g, '\n').trim()
  if (!normalizedContent) {
    return []
  }

  const rawBlocks = normalizedContent
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const blocks = rawBlocks.length > 0 ? rawBlocks : [normalizedContent]

  return blocks.map((block, blockIndex) => {
    const blockId = `${section.key}-page-${pageNumber}-block-${blockIndex + 1}`
    return (
      parseTableBlock(block, blockId) ??
      parseImageBlock(block, blockId) ??
      parseLatexBlock(block, blockId) ?? {
        id: blockId,
        type: 'paragraph',
        content: block,
      }
    )
  })
}

function estimateBlockWeight(block: ContentBlock): number {
  switch (block.type) {
    case 'table':
      return 1600 + block.rows.length * 180
    case 'image':
      return 1800
    case 'latex':
      return 900 + block.latex.length * 2
    case 'paragraph':
    default:
      return Math.max(380, Math.ceil(block.content.length * 0.75))
  }
}

function buildRenderPages(
  paper: LiteratureDetail,
  enablePerfLog?: boolean,
): RenderPage[] {
  return measure(
    `[PreactDocumentRenderer] paginate:${paper.paper_id}`,
    shouldLogPerformance(enablePerfLog),
    () => {
      const pages: RenderPage[] = []
      let pageNumber = 1

      for (const section of paper.original_sections) {
        const sectionBlocks = parseSectionBlocks(section, pageNumber)
        if (sectionBlocks.length === 0) {
          continue
        }

        let pageBlocks: ContentBlock[] = []
        let currentWeight = 0
        let continuationIndex = 0

        const pushPage = () => {
          if (pageBlocks.length === 0) {
            return
          }

          pages.push({
            id: `${paper.paper_id}-${section.key}-${pageNumber}`,
            pageNumber,
            sectionKey: section.key,
            sectionTitle: section.title,
            isContinuation: continuationIndex > 0,
            blocks: pageBlocks,
          })

          pageNumber += 1
          continuationIndex += 1
          pageBlocks = []
          currentWeight = 0
        }

        for (const block of sectionBlocks) {
          const blockWeight = estimateBlockWeight(block)
          if (
            pageBlocks.length > 0 &&
            currentWeight + blockWeight > PAGE_RENDER_BUDGET
          ) {
            pushPage()
          }

          pageBlocks.push(block)
          currentWeight += blockWeight
        }

        pushPage()
      }

      return pages
    },
  )
}

function renderKatexHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    })
  } catch {
    return katex.renderToString('\\text{Formula rendering failed}', {
      displayMode: true,
      throwOnError: false,
      strict: 'ignore',
    })
  }
}

function buildTextFragments(text: string, keyPrefix: string): InlineFragment[] {
  const fragments: InlineFragment[] = []
  const matches = findReferenceMatches(text)
  let cursor = 0

  matches.forEach((match, index) => {
    if (match.start > cursor) {
      fragments.push({
        kind: 'text',
        key: `${keyPrefix}-text-${index}`,
        value: text.slice(cursor, match.start),
      })
    }

    fragments.push({
      kind: 'reference',
      key: `${keyPrefix}-reference-${index}`,
      label: match.target.label,
      href: match.target.href,
      isArxiv: match.target.isArxiv,
      paperId: match.target.paperId,
    })
    cursor = match.end
  })

  if (cursor < text.length) {
    fragments.push({
      kind: 'text',
      key: `${keyPrefix}-tail`,
      value: text.slice(cursor),
    })
  }

  return fragments
}

const InlineLatexText = memo(function InlineLatexText({
  text,
  onOpenReference,
}: {
  text: string
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  const fragments = useMemo(() => {
    const parts = text.split(INLINE_LATEX_PATTERN).filter(Boolean)
    return parts.flatMap((part, index) => {
      const isDisplay = part.startsWith('$$') && part.endsWith('$$')
      const isInline = part.startsWith('$') && part.endsWith('$') && !isDisplay

      if (!isDisplay && !isInline) {
        return buildTextFragments(part, `text-${index}`)
      }

      const latex = isDisplay ? part.slice(2, -2).trim() : part.slice(1, -1).trim()
      return [{
        kind: 'latex' as const,
        key: `latex-${index}`,
        value: renderKatexHtml(latex, isDisplay),
        displayMode: isDisplay,
      }]
    })
  }, [text])

  return (
    <>
      {fragments.map((fragment) =>
        fragment.kind === 'text' ? (
          <span key={fragment.key}>{fragment.value}</span>
        ) : fragment.kind === 'reference' ? (
          <a
            key={fragment.key}
            href={fragment.href}
            className="literature-inline-link rounded-sm"
            onClick={(event) => {
              if (onOpenReference) {
                event.preventDefault()
                onOpenReference({
                  label: fragment.label,
                  href: fragment.href,
                  isArxiv: fragment.isArxiv,
                  paperId: fragment.paperId,
                })
              }
            }}
          >
            {fragment.label}
          </a>
        ) : (
          <span
            key={fragment.key}
            className={fragment.displayMode ? 'my-3 block overflow-x-auto' : 'inline-block align-middle px-1'}
            dangerouslySetInnerHTML={{ __html: fragment.value }}
          />
        ),
      )}
    </>
  )
})

const ParagraphBlockView = memo(function ParagraphBlockView({
  block,
  onOpenReference,
}: {
  block: ParagraphBlock
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  return (
    <p className="font-serif text-[15px] leading-8 text-academic-text/90">
      <InlineLatexText text={block.content} onOpenReference={onOpenReference} />
    </p>
  )
})

const LatexBlockView = memo(function LatexBlockView({ block }: { block: LatexBlock }) {
  const html = useMemo(
    () => renderKatexHtml(block.latex, block.displayMode),
    [block.displayMode, block.latex],
  )

  return (
    <div className="overflow-x-auto rounded-lg border border-academic-border bg-academic-hover/60 px-4 py-3">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
})

const TableBlockView = memo(function TableBlockView({
  block,
  onOpenReference,
}: {
  block: TableBlock
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-academic-border bg-white">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-academic-hover">
          <tr>
            {block.headers.map((header, index) => (
              <th
                key={`${block.id}-header-${index}`}
                className="border-b border-academic-border px-3 py-2 font-semibold text-academic-text"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${block.id}-row-${rowIndex}`} className="even:bg-academic-hover/30">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${block.id}-cell-${rowIndex}-${cellIndex}`}
                  className="border-b border-academic-border/70 px-3 py-2 align-top text-academic-text/90"
                >
                  <InlineLatexText text={cell} onOpenReference={onOpenReference} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

const ImageBlockView = memo(function ImageBlockView({ block }: { block: ImageBlock }) {
  if (!block.src) {
    return (
      <figure className="rounded-lg border border-dashed border-academic-border bg-academic-hover/30 p-5">
        <div className="flex min-h-[160px] items-center justify-center rounded-lg bg-white/80 px-6 text-center">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-academic-muted">
              Figure
            </p>
            <p className="font-serif text-sm leading-7 text-academic-text/90">
              {block.alt}
            </p>
            {block.assetLabel ? (
              <p className="text-xs text-academic-muted">
                Source asset: {block.assetLabel}
              </p>
            ) : null}
          </div>
        </div>
      </figure>
    )
  }

  return (
    <figure className="overflow-hidden rounded-lg border border-academic-border bg-academic-hover/40 p-3">
      <img
        src={block.src}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        className="mx-auto max-h-[480px] w-auto rounded object-contain"
      />
      <figcaption className="mt-3 text-center text-xs text-academic-muted">
        {block.alt}
      </figcaption>
    </figure>
  )
})

const BlockRenderer = memo(function BlockRenderer({
  block,
  onOpenReference,
}: {
  block: ContentBlock
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  switch (block.type) {
    case 'table':
      return <TableBlockView block={block} onOpenReference={onOpenReference} />
    case 'image':
      return <ImageBlockView block={block} />
    case 'latex':
      return <LatexBlockView block={block} />
    case 'paragraph':
    default:
      return <ParagraphBlockView block={block} onOpenReference={onOpenReference} />
  }
})

const RenderPageView = memo(function RenderPageView({
  page,
  onOpenReference,
}: {
  page: RenderPage
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  return (
    <section
      className="rounded-xl border border-academic-border bg-white p-6 shadow-sm"
      style={{
        contentVisibility: 'auto',
        contain: 'layout paint style',
        containIntrinsicSize: '960px',
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-academic-border pb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-academic-muted">
            {page.sectionTitle}
            {page.isContinuation ? ' · Continued' : ''}
          </p>
          <h2 className="mt-1 font-serif text-xl font-bold text-academic-text">
            {page.sectionTitle}
          </h2>
        </div>
        <span className="shrink-0 rounded-full bg-academic-hover px-2.5 py-1 text-[11px] text-academic-muted">
          Page {page.pageNumber}
        </span>
      </div>

      <div className="space-y-5">
        {page.blocks.map((block) => (
          <BlockRenderer
            key={block.id}
            block={block}
            onOpenReference={onOpenReference}
          />
        ))}
      </div>
    </section>
  )
})

export function PreactDocumentRenderer({
  paper,
  enablePerfLog = false,
  onOpenReference,
}: {
  paper: LiteratureDetail
  enablePerfLog?: boolean
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  // Optimization: useMemo keeps expensive block parsing/page batching off the hot path.
  const pages = useMemo(
    () => buildRenderPages(paper, enablePerfLog),
    [enablePerfLog, paper],
  )

  // Optimization: render only the first few pages eagerly; the rest mount on demand.
  const [visiblePageCount, setVisiblePageCount] = useState(
    Math.min(INITIAL_RENDERED_PAGES, pages.length),
  )
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisiblePageCount(Math.min(INITIAL_RENDERED_PAGES, pages.length))
  }, [pages.length, paper.paper_id])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || visiblePageCount >= pages.length) {
      return
    }

    // Optimization: IntersectionObserver postpones mounting of off-screen pages.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisiblePageCount((current) => Math.min(current + PAGE_BATCH_SIZE, pages.length))
        }
      },
      { rootMargin: '1200px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [pages.length, visiblePageCount])

  const visiblePages = pages.slice(0, visiblePageCount)

  return (
    <>
      <div className="space-y-8">
        {visiblePages.map((page) => (
          <RenderPageView
            key={page.id}
            page={page}
            onOpenReference={onOpenReference}
          />
        ))}
      </div>

      {visiblePageCount < pages.length ? (
        <div ref={loadMoreRef} className="py-8 text-center text-xs text-academic-muted">
          正在按需渲染后续页面… 还剩 {pages.length - visiblePageCount} 页
        </div>
      ) : pages.length > 0 ? (
        <div className="py-6 text-center text-xs text-academic-muted">
          全文共 {pages.length} 页，已全部渲染完成。
        </div>
      ) : null}
    </>
  )
}
