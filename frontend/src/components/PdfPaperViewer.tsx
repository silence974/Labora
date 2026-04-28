import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { findReferenceMatches, resolveReferenceTarget } from '../utils/literatureLinks'
import type { LiteratureReferenceTarget } from '../utils/literatureLinks'

const DEFAULT_PAGE_RATIO = 1.414
const PAGE_ROOT_MARGIN = '1400px 0px'
const VECTOR_RENDER_OVERSCAN = 1.18
const MAX_VECTOR_RENDER_BOOST = 2.6
const RERENDER_THRESHOLD = 1.04
const TEXT_SELECTION_TOP_INSET_RATIO = 0.14
const TEXT_SELECTION_HEIGHT_RATIO = 0.76
const CONTENT_LEFT_SAFE_PADDING_CSS = 30
const MAX_LEFT_CLAMP_CSS = 64
const SIDEBAR_LEFT_ZONE_RATIO = 0.22
const SIDEBAR_ROTATION_SIN_THRESHOLD = 0.72
const SIDEBAR_MIN_TEXT_LENGTH = 8

export interface ReaderAnnotationRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ReaderAnnotation {
  id: string
  paperId: string
  pageNumber: number
  quote: string
  note: string
  createdAt: string
  rects: ReaderAnnotationRect[]
}

interface PositionedTextSpan {
  id: string
  text: string
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  fontFamily: string
  scaleX: number
  rotation: number
}

interface PageCropBounds {
  left: number
  top: number
  width: number
  height: number
}

interface RenderedPageSnapshot {
  canvas: HTMLCanvasElement
  textSpans: PositionedTextSpan[]
  cropBounds: PageCropBounds
  viewport: {
    convertToViewportRectangle(rect: number[]): number[]
  }
}

interface PdfPageLinkOverlay {
  id: string
  left: number
  top: number
  width: number
  height: number
  href?: string
  paperId?: string
  dest?: unknown
  title: string
}

const HORIZONTAL_TEXT_SIN_THRESHOLD = 0.35
const MAIN_CONTENT_LEFT_PERCENTILE = 0.08
const LEFT_GUTTER_CLAMP_RATIO = 0.08

let pdfRuntimePromise: Promise<{
  getDocument: typeof import('pdfjs-dist').getDocument
  Util: typeof import('pdfjs-dist').Util
}> | null = null

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfModule, workerModule]) => {
      pdfModule.GlobalWorkerOptions.workerSrc = workerModule.default
      return {
        getDocument: pdfModule.getDocument,
        Util: pdfModule.Util,
      }
    })
  }

  return pdfRuntimePromise
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isMostlyHorizontal(rotation: number) {
  return Math.abs(Math.sin(rotation)) <= HORIZONTAL_TEXT_SIN_THRESHOLD
}

function isLikelyLeftSidebarSpan(span: PositionedTextSpan, pageWidthCss: number) {
  return (
    Math.abs(Math.sin(span.rotation)) >= SIDEBAR_ROTATION_SIN_THRESHOLD &&
    span.left <= pageWidthCss * SIDEBAR_LEFT_ZONE_RATIO &&
    span.text.trim().length >= SIDEBAR_MIN_TEXT_LENGTH
  )
}

function containsSelectionNode(container: HTMLElement, node: Node | null): boolean {
  if (!node) {
    return false
  }

  const target = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  return Boolean(target && container.contains(target))
}

function buildPdfLinkTitle(href?: string, paperId?: string, hasDestination?: boolean) {
  if (paperId) {
    return `Open arXiv reference ${paperId}`
  }

  if (href) {
    return `Open link ${href}`
  }

  if (hasDestination) {
    return 'Jump to linked location'
  }

  return 'Open link'
}

function clampOverlayRect(
  left: number,
  top: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
) {
  const clampedLeft = clamp(left, 0, pageWidth)
  const clampedTop = clamp(top, 0, pageHeight)
  const clampedRight = clamp(left + width, clampedLeft, pageWidth)
  const clampedBottom = clamp(top + height, clampedTop, pageHeight)

  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(0, clampedRight - clampedLeft),
    height: Math.max(0, clampedBottom - clampedTop),
  }
}

function dedupePageLinks(links: PdfPageLinkOverlay[]): PdfPageLinkOverlay[] {
  const deduped: PdfPageLinkOverlay[] = []

  links.forEach((link) => {
    const targetKey = link.paperId || link.href || String(link.dest || '')
    const duplicate = deduped.some(
      (candidate) =>
        (candidate.paperId || candidate.href || String(candidate.dest || '')) === targetKey &&
        Math.abs(candidate.left - link.left) < 18 &&
        Math.abs(candidate.top - link.top) < 12,
    )

    if (!duplicate) {
      deduped.push(link)
    }
  })

  return deduped
}

async function navigatePdfDestination(
  pdfDocument: PDFDocumentProxy,
  destination: unknown,
) {
  const resolvedDestination =
    typeof destination === 'string'
      ? await pdfDocument.getDestination(destination)
      : destination

  if (!Array.isArray(resolvedDestination) || resolvedDestination.length === 0) {
    return
  }

  const pageReference = resolvedDestination[0]
  if (!pageReference || typeof pageReference !== 'object') {
    return
  }

  try {
    const pageIndex = await pdfDocument.getPageIndex(pageReference as never)
    const pageNode = document.querySelector<HTMLElement>(
      `[data-pdf-page-number="${pageIndex + 1}"]`,
    )
    pageNode?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch {
    // Ignore unresolved PDF destinations; external links and arXiv refs still work.
  }
}

function computeAutoCropBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  padding: number,
): PageCropBounds {
  const rowStride = Math.max(1, Math.floor(width / 1200))
  const columnStride = Math.max(1, Math.floor(height / 1600))

  const isContentPixel = (offset: number) => {
    const alpha = pixels[offset + 3]
    if (alpha === 0) {
      return false
    }

    return (
      pixels[offset] < 248 ||
      pixels[offset + 1] < 248 ||
      pixels[offset + 2] < 248
    )
  }

  const rowHasContent = (y: number) => {
    for (let x = 0; x < width; x += rowStride) {
      if (isContentPixel((y * width + x) * 4)) {
        return true
      }
    }
    return false
  }

  const columnHasContent = (x: number) => {
    for (let y = 0; y < height; y += columnStride) {
      if (isContentPixel((y * width + x) * 4)) {
        return true
      }
    }
    return false
  }

  let top = 0
  while (top < height && !rowHasContent(top)) {
    top += 1
  }

  let bottom = height - 1
  while (bottom > top && !rowHasContent(bottom)) {
    bottom -= 1
  }

  let left = 0
  while (left < width && !columnHasContent(left)) {
    left += 1
  }

  let right = width - 1
  while (right > left && !columnHasContent(right)) {
    right -= 1
  }

  if (top >= bottom || left >= right) {
    return {
      left: 0,
      top: 0,
      width,
      height,
    }
  }

  const paddedLeft = Math.max(0, left - padding)
  const paddedTop = Math.max(0, top - padding)
  const paddedRight = Math.min(width, right + padding)
  const paddedBottom = Math.min(height, bottom + padding)

  return {
    left: paddedLeft,
    top: paddedTop,
    width: Math.max(1, paddedRight - paddedLeft),
    height: Math.max(1, paddedBottom - paddedTop),
  }
}

function computePrimaryContentLeft(spans: PositionedTextSpan[]) {
  const horizontalLefts = spans
    .filter(
      (span) =>
        isMostlyHorizontal(span.rotation) &&
        span.width >= 10 &&
        span.height >= 6 &&
        span.text.trim().length > 0,
    )
    .map((span) => span.left)
    .sort((leftA, leftB) => leftA - leftB)

  if (horizontalLefts.length === 0) {
    return null
  }

  const percentileIndex = Math.min(
    horizontalLefts.length - 1,
    Math.floor((horizontalLefts.length - 1) * MAIN_CONTENT_LEFT_PERCENTILE),
  )

  return horizontalLefts[percentileIndex]
}

function hasLeftSidebarContent(spans: PositionedTextSpan[], pageWidthCss: number) {
  return spans.some((span) => isLikelyLeftSidebarSpan(span, pageWidthCss))
}

function computeContentAwareCropBounds({
  pixels,
  width,
  height,
  padding,
  spans,
  availableWidth,
  devicePixelRatio,
}: {
  pixels: Uint8ClampedArray
  width: number
  height: number
  padding: number
  spans: PositionedTextSpan[]
  availableWidth: number
  devicePixelRatio: number
}): PageCropBounds {
  const detectedCropBounds = computeAutoCropBounds(pixels, width, height, padding)
  const pageWidthCss = width / devicePixelRatio
  const detectedCropLeftCss = detectedCropBounds.left / devicePixelRatio

  if (!hasLeftSidebarContent(spans, pageWidthCss)) {
    return detectedCropBounds
  }

  const primaryContentLeft = computePrimaryContentLeft(spans)
  const clampedLeftCss =
    primaryContentLeft === null
      ? detectedCropLeftCss
      : Math.max(
          detectedCropLeftCss,
          Math.min(
            primaryContentLeft - CONTENT_LEFT_SAFE_PADDING_CSS,
            detectedCropLeftCss + MAX_LEFT_CLAMP_CSS,
          ),
        )
  const shouldClampLeft =
    clampedLeftCss - detectedCropLeftCss >
    availableWidth * LEFT_GUTTER_CLAMP_RATIO

  const cropLeft = shouldClampLeft
    ? Math.min(
        detectedCropBounds.left + detectedCropBounds.width - 1,
        Math.max(
          detectedCropBounds.left,
          Math.round(clampedLeftCss * devicePixelRatio),
        ),
      )
    : detectedCropBounds.left

  return {
    left: cropLeft,
    top: detectedCropBounds.top,
    width: Math.max(1, detectedCropBounds.width - (cropLeft - detectedCropBounds.left)),
    height: detectedCropBounds.height,
  }
}

function PdfPageCanvas({
  paperId,
  pdfDocument,
  pageNumber,
  annotations,
  onCreateAnnotation,
  onOpenReference,
}: {
  paperId: string
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  annotations: ReaderAnnotation[]
  onCreateAnnotation?: (annotation: ReaderAnnotation) => void
  onOpenReference?: (target: LiteratureReferenceTarget) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)

  const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 2)
  const [hasRendered, setHasRendered] = useState(false)
  const [pageRatio, setPageRatio] = useState(DEFAULT_PAGE_RATIO)
  const [frameWidth, setFrameWidth] = useState(0)
  const [pageError, setPageError] = useState<string | null>(null)
  const [textSpans, setTextSpans] = useState<PositionedTextSpan[]>([])
  const [pageLinks, setPageLinks] = useState<PdfPageLinkOverlay[]>([])
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [pendingSelection, setPendingSelection] = useState<{
    quote: string
    rects: ReaderAnnotationRect[]
    anchorLeft: number
    anchorTop: number
  } | null>(null)

  useEffect(() => {
    const node = hostRef.current
    if (!node) {
      return
    }

    // Optimization: only render pages once they approach the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true)
        }
      },
      { rootMargin: PAGE_ROOT_MARGIN },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = frameRef.current
    if (!node) {
      return
    }

    const updateWidth = () => {
      setFrameWidth(node.clientWidth)
    }

    updateWidth()

    // Optimization: rerender the current page only when its container width changes.
    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if ((!isNearViewport && !hasRendered) || frameWidth === 0) {
      return
    }

    let cancelled = false

    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) {
          return
        }

        const { Util } = await loadPdfRuntime()
        const baseViewport = page.getViewport({ scale: 1 })
        setPageRatio(baseViewport.height / baseViewport.width)

        const availableWidth = Math.max(frameWidth, 1)
        const devicePixelRatio = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        if (!canvas) {
          return
        }

        const textContent = await page.getTextContent()
        const pageAnnotations = await page.getAnnotations()
        const baseScale = availableWidth / baseViewport.width

        const renderSnapshot = async (renderBoost: number): Promise<RenderedPageSnapshot> => {
          const renderScale = baseScale * renderBoost
          const viewport = page.getViewport({ scale: renderScale })
          const offscreenCanvas = document.createElement('canvas')
          offscreenCanvas.width = Math.max(1, Math.floor(viewport.width * devicePixelRatio))
          offscreenCanvas.height = Math.max(1, Math.floor(viewport.height * devicePixelRatio))

          const offscreenContext = offscreenCanvas.getContext('2d', { alpha: false })
          if (!offscreenContext) {
            throw new Error('Failed to create PDF render context')
          }

          offscreenContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

          const nextTextSpans = textContent.items
            .filter((item): item is typeof textContent.items[number] & { str: string; transform: number[]; width: number; height: number; fontName: string } => {
              return 'str' in item && typeof item.str === 'string' && item.str.trim().length > 0
            })
            .map((item, index) => {
              const textTransform = Util.transform(viewport.transform, item.transform)
              const fontHeight = Math.hypot(textTransform[2], textTransform[3])
              const rotation = Math.atan2(textTransform[1], textTransform[0])
              const style = textContent.styles[item.fontName]
              const fontFamily = style?.fontFamily || 'serif'

              offscreenContext.save()
              offscreenContext.font = `${Math.max(fontHeight, 1)}px ${fontFamily}`
              const measuredWidth = Math.max(offscreenContext.measureText(item.str).width, 1)
              offscreenContext.restore()

              const spanWidth = Math.max(item.width * renderScale, 1)
              const selectionTop = textTransform[5] - fontHeight + fontHeight * TEXT_SELECTION_TOP_INSET_RATIO
              const selectionHeight = Math.max(
                fontHeight * TEXT_SELECTION_HEIGHT_RATIO,
                1,
              )
              return {
                id: `${pageNumber}-text-${index + 1}`,
                text: item.str,
                left: textTransform[4],
                top: selectionTop,
                width: spanWidth,
                height: selectionHeight,
                fontSize: Math.max(fontHeight, 1),
                fontFamily,
                scaleX: spanWidth / measuredWidth,
                rotation,
              }
            })

          renderTaskRef.current?.cancel()
          const task = page.render({
            canvas: offscreenCanvas,
            canvasContext: offscreenContext,
            viewport,
          })
          renderTaskRef.current = task
          await task.promise

          return {
            canvas: offscreenCanvas,
            textSpans: nextTextSpans,
            cropBounds: computeContentAwareCropBounds({
              pixels: offscreenContext.getImageData(
                0,
                0,
                offscreenCanvas.width,
                offscreenCanvas.height,
              ).data,
              width: offscreenCanvas.width,
              height: offscreenCanvas.height,
              padding: Math.round(18 * devicePixelRatio),
              spans: nextTextSpans,
              availableWidth,
              devicePixelRatio,
            }),
            viewport,
          }
        }

        const initialSnapshot = await renderSnapshot(1)
        const initialCropWidthCss = initialSnapshot.cropBounds.width / devicePixelRatio
        const estimatedFillScale = availableWidth / Math.max(initialCropWidthCss, 1)
        const vectorRenderBoost = clamp(
          estimatedFillScale * VECTOR_RENDER_OVERSCAN,
          1,
          MAX_VECTOR_RENDER_BOOST,
        )
        const finalSnapshot =
          vectorRenderBoost > RERENDER_THRESHOLD
            ? await renderSnapshot(vectorRenderBoost)
            : initialSnapshot

        if (!cancelled) {
          const cropBounds = finalSnapshot.cropBounds

          const cropLeftCss = cropBounds.left / devicePixelRatio
          const cropTopCss = cropBounds.top / devicePixelRatio
          const cropWidthCss = cropBounds.width / devicePixelRatio
          const cropHeightCss = cropBounds.height / devicePixelRatio
          const displayScale = availableWidth / Math.max(cropWidthCss, 1)
          const displayWidthCss = cropWidthCss * displayScale
          const displayHeightCss = cropHeightCss * displayScale
          const outputWidth = Math.max(1, Math.round(cropBounds.width * displayScale))
          const outputHeight = Math.max(1, Math.round(cropBounds.height * displayScale))
          const mappedTextSpans = finalSnapshot.textSpans.map((span) => ({
            ...span,
            left: (span.left - cropLeftCss) * displayScale,
            top: (span.top - cropTopCss) * displayScale,
            width: span.width * displayScale,
            height: span.height * displayScale,
            fontSize: span.fontSize * displayScale,
          }))

          const context = canvas.getContext('2d', { alpha: false })
          if (!context) {
            return
          }

          canvas.width = outputWidth
          canvas.height = outputHeight
          canvas.style.width = `${displayWidthCss}px`
          canvas.style.height = `${displayHeightCss}px`
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.clearRect(0, 0, outputWidth, outputHeight)
          context.drawImage(
            finalSnapshot.canvas,
            cropBounds.left,
            cropBounds.top,
            cropBounds.width,
            cropBounds.height,
            0,
            0,
            outputWidth,
            outputHeight,
          )

          const annotationLinks = pageAnnotations.flatMap((annotation, index) => {
              const rect = Array.isArray(annotation.rect) ? annotation.rect : null
              if (!rect || rect.length !== 4) {
                return []
              }

              const href =
                typeof annotation.url === 'string'
                  ? annotation.url
                  : typeof annotation.unsafeUrl === 'string'
                    ? annotation.unsafeUrl
                    : undefined
              const linkTarget = href ? resolveReferenceTarget(href) : null
              const paperReferenceId = linkTarget?.paperId

              const viewportRect = finalSnapshot.viewport.convertToViewportRectangle(rect)
              const rawLeft = (Math.min(viewportRect[0], viewportRect[2]) - cropLeftCss) * displayScale
              const rawTop = (Math.min(viewportRect[1], viewportRect[3]) - cropTopCss) * displayScale
              const rawWidth = Math.abs(viewportRect[2] - viewportRect[0]) * displayScale
              const rawHeight = Math.abs(viewportRect[3] - viewportRect[1]) * displayScale
              const normalizedRect = clampOverlayRect(
                rawLeft,
                rawTop,
                rawWidth,
                rawHeight,
                displayWidthCss,
                displayHeightCss,
              )

              if (normalizedRect.width < 6 || normalizedRect.height < 6) {
                return []
              }

              return [{
                id: `${pageNumber}-annotation-link-${index + 1}`,
                left: normalizedRect.left,
                top: normalizedRect.top,
                width: normalizedRect.width,
                height: normalizedRect.height,
                href,
                paperId: paperReferenceId,
                dest: annotation.dest,
                title: buildPdfLinkTitle(href, paperReferenceId, Boolean(annotation.dest)),
              } satisfies PdfPageLinkOverlay]
            })

          const inferredTextLinks = mappedTextSpans
            .filter((span) => isMostlyHorizontal(span.rotation) && span.width >= 18)
            .flatMap((span) => {
              const matches = findReferenceMatches(span.text)
              if (matches.length === 0) {
                return []
              }

              const totalLength = Math.max(span.text.length, 1)
              return matches.flatMap((match, index) => {
                const startRatio = match.start / totalLength
                const widthRatio = Math.max((match.end - match.start) / totalLength, 0.16)
                const rawLeft = span.left + span.width * startRatio
                const rawWidth = span.width * widthRatio
                const normalizedRect = clampOverlayRect(
                  rawLeft,
                  span.top,
                  rawWidth,
                  span.height,
                  displayWidthCss,
                  displayHeightCss,
                )

                if (normalizedRect.width < 12 || normalizedRect.height < 8) {
                  return []
                }

                return [{
                  id: `${span.id}-text-link-${index + 1}`,
                  left: normalizedRect.left,
                  top: normalizedRect.top,
                  width: normalizedRect.width,
                  height: normalizedRect.height,
                  href: match.target.href,
                  paperId: match.target.paperId,
                  title: buildPdfLinkTitle(
                    match.target.href,
                    match.target.paperId,
                    false,
                  ),
                } satisfies PdfPageLinkOverlay]
              })
            })

          setPageRatio(displayHeightCss / displayWidthCss)
          setPageSize({ width: displayWidthCss, height: displayHeightCss })
          setTextSpans(mappedTextSpans)
          setPageLinks(dedupePageLinks([...annotationLinks, ...inferredTextLinks]))
          setHasRendered(true)
          setPageError(null)
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          setPageError(error instanceof Error ? error.message : 'Failed to render PDF page')
        }
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [frameWidth, hasRendered, isNearViewport, pageNumber, pdfDocument])

  useEffect(() => {
    setPendingSelection(null)
  }, [pageNumber, paperId])

  useEffect(() => {
    setPageLinks([])
  }, [pageNumber, paperId])

  const placeholderHeight = Math.max(frameWidth * pageRatio, 320)

  const commitSelection = () => {
    if (!pendingSelection || !onCreateAnnotation) {
      return
    }

    onCreateAnnotation({
      id: `${paperId}-${pageNumber}-${Date.now()}`,
      paperId,
      pageNumber,
      quote: pendingSelection.quote,
      note: '',
      createdAt: new Date().toISOString(),
      rects: pendingSelection.rects,
    })
    window.getSelection()?.removeAllRanges()
    setPendingSelection(null)
  }

  const handleSelectionCommitCandidate = () => {
    const selection = window.getSelection()
    const textLayer = textLayerRef.current
    const pageSurface = pageSurfaceRef.current

    if (!selection || selection.isCollapsed || !textLayer || !pageSurface) {
      setPendingSelection(null)
      return
    }

    if (
      !containsSelectionNode(textLayer, selection.anchorNode) ||
      !containsSelectionNode(textLayer, selection.focusNode)
    ) {
      setPendingSelection(null)
      return
    }

    const quote = selection.toString().replace(/\s+/g, ' ').trim()
    if (!quote) {
      setPendingSelection(null)
      return
    }

    const range = selection.getRangeAt(0)
    const layerRect = pageSurface.getBoundingClientRect()
    const rects = Array.from(range.getClientRects())
      .map((rect) => ({
        left: clamp((rect.left - layerRect.left) / layerRect.width, 0, 1),
        top: clamp((rect.top - layerRect.top) / layerRect.height, 0, 1),
        width: clamp(rect.width / layerRect.width, 0, 1),
        height: clamp(rect.height / layerRect.height, 0, 1),
      }))
      .filter((rect) => rect.width > 0.002 && rect.height > 0.002)

    if (rects.length === 0) {
      setPendingSelection(null)
      return
    }

    const firstRect = range.getBoundingClientRect()
    setPendingSelection({
      quote,
      rects,
      anchorLeft: clamp(firstRect.left - layerRect.left, 12, layerRect.width - 96),
      anchorTop: clamp(firstRect.top - layerRect.top - 40, 8, layerRect.height - 40),
    })
  }

  const handleLinkActivate = async (link: PdfPageLinkOverlay) => {
    setPendingSelection(null)

    if (link.paperId && onOpenReference) {
      onOpenReference({
        label: link.paperId,
        href: link.href ?? `https://arxiv.org/abs/${link.paperId}`,
        isArxiv: true,
        paperId: link.paperId,
      })
      return
    }

    if (link.dest != null) {
      await navigatePdfDestination(pdfDocument, link.dest)
      return
    }

    if (link.href && onOpenReference) {
      onOpenReference({
        label: link.href,
        href: link.href,
        isArxiv: false,
      })
      return
    }

    if (link.href) {
      window.open(link.href, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section ref={hostRef} className="w-full" data-pdf-page-number={pageNumber}>
      <div className="mx-auto mb-2 max-w-[1180px] px-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
        Page {pageNumber}
      </div>

      <div ref={frameRef} className="mx-auto w-full max-w-[1180px]">
        {pageError ? (
          <div className="flex min-h-[240px] w-full items-center justify-center rounded-lg border border-red-200 bg-red-50 px-6 text-center text-sm text-red-600">
            {pageError}
          </div>
        ) : (
          <div
            className="flex w-full items-center justify-center"
            style={{ minHeight: `${placeholderHeight}px` }}
          >
            <div
              ref={pageSurfaceRef}
              className="relative bg-white shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
              style={{
                width: pageSize.width > 0 ? `${pageSize.width}px` : '100%',
                height: pageSize.height > 0 ? `${pageSize.height}px` : `${placeholderHeight}px`,
              }}
            >
              {annotations.map((annotation) =>
                annotation.rects.map((rect, index) => (
                  <div
                    key={`${annotation.id}-rect-${index + 1}`}
                    className="pdf-page-highlight"
                    style={{
                      left: `${rect.left * pageSize.width}px`,
                      top: `${rect.top * pageSize.height}px`,
                      width: `${rect.width * pageSize.width}px`,
                      height: `${rect.height * pageSize.height}px`,
                    }}
                  />
                ))
              )}

              {isNearViewport ? (
                <>
                  <canvas
                    ref={canvasRef}
                    aria-label={`Typeset preview page ${pageNumber}`}
                    className="absolute inset-0 block max-w-full"
                  />
                  <div className="pdf-link-layer" aria-hidden="false">
                    {pageLinks.map((link) => (
                      <button
                        key={link.id}
                        type="button"
                        className="pdf-link-layer__anchor"
                        title={link.title}
                        aria-label={link.title}
                        style={{
                          left: `${link.left}px`,
                          top: `${link.top}px`,
                          width: `${link.width}px`,
                          height: `${link.height}px`,
                        }}
                        onClick={() => {
                          void handleLinkActivate(link)
                        }}
                      />
                    ))}
                  </div>
                  <div
                    ref={textLayerRef}
                    className="pdf-text-layer"
                    onMouseDown={() => setPendingSelection(null)}
                    onMouseUp={() => {
                      window.setTimeout(handleSelectionCommitCandidate, 0)
                    }}
                    style={{
                      width: `${pageSize.width}px`,
                      height: `${pageSize.height}px`,
                    }}
                  >
                    {textSpans.map((span) => (
                      <span
                        key={span.id}
                        className="pdf-text-layer__text"
                        style={{
                          left: `${span.left}px`,
                          top: `${span.top}px`,
                          width: `${span.width}px`,
                          height: `${span.height}px`,
                          fontSize: `${span.fontSize}px`,
                          fontFamily: span.fontFamily,
                          transform: `scaleX(${span.scaleX}) rotate(${span.rotation}rad)`,
                        }}
                      >
                        {span.text}
                      </span>
                    ))}
                  </div>

                  {pendingSelection ? (
                    <button
                      type="button"
                      className="absolute z-20 rounded-full bg-academic-accent px-3 py-1 text-xs font-medium text-white shadow-md hover:bg-red-700"
                      style={{
                        left: `${pendingSelection.anchorLeft}px`,
                        top: `${pendingSelection.anchorTop}px`,
                      }}
                      onClick={commitSelection}
                    >
                      标记
                    </button>
                  ) : null}
                </>
              ) : (
                <div
                  className="w-full border border-dashed border-slate-300 bg-white/70"
                  style={{
                    aspectRatio: `1 / ${pageRatio}`,
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export function PdfPaperViewer({
  paperId,
  pdfUrl,
  paperTitle,
  annotations,
  onCreateAnnotation,
  onOpenReference,
  fallback,
}: {
  paperId: string
  pdfUrl: string
  paperTitle: string
  annotations?: ReaderAnnotation[]
  onCreateAnnotation?: (annotation: ReaderAnnotation) => void
  onOpenReference?: (target: LiteratureReferenceTarget) => void
  fallback?: ComponentChildren
}) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let destroyLoadingTask: (() => void) | null = null

    // Optimization: import pdf.js only when the preview panel is actually opened.
    void loadPdfRuntime()
      .then(({ getDocument }) => {
        if (cancelled) {
          return
        }

        const loadingTask = getDocument({
          url: pdfUrl,
          withCredentials: false,
        })
        destroyLoadingTask = () => {
          void loadingTask.destroy()
        }

        return loadingTask.promise
          .then((nextDocument) => {
            if (cancelled) {
              void nextDocument.destroy()
              return
            }

            setPdfDocument((previous) => {
              if (previous) {
                void previous.destroy()
              }
              return nextDocument
            })
            setLoadError(null)
          })
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load typeset preview')
          setPdfDocument(null)
        }
      })

    return () => {
      cancelled = true
      destroyLoadingTask?.()
    }
  }, [pdfUrl])

  useEffect(() => {
    return () => {
      if (pdfDocument) {
        void pdfDocument.destroy()
      }
    }
  }, [pdfDocument])

  if (loadError) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          排版预览暂时不可用，当前回退到解析后的 LaTeX 正文。原因: {loadError}
        </div>
        {fallback}
      </div>
    )
  }

  if (!pdfDocument) {
    return (
      <section className="py-4">
        <div className="mx-auto max-w-[1180px] border border-slate-200 bg-white px-6 py-16 text-center shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
          <i className="fa-regular fa-file-lines text-4xl text-slate-400"></i>
          <p className="mt-4 font-serif text-lg text-academic-text">Loading typeset preview for {paperTitle}...</p>
          <p className="mt-2 text-sm text-academic-muted">正在使用本地 LaTeX 源码生成接近论文 PDF 的排版预览。</p>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {Array.from({ length: pdfDocument.numPages }, (_, index) => (
        <PdfPageCanvas
          key={`${pdfUrl}-page-${index + 1}`}
          paperId={paperId}
          pdfDocument={pdfDocument}
          pageNumber={index + 1}
          annotations={(annotations ?? []).filter((annotation) => annotation.pageNumber === index + 1)}
          onCreateAnnotation={onCreateAnnotation}
          onOpenReference={onOpenReference}
        />
      ))}

      <div className="text-center text-xs text-academic-muted">
        预览共 {pdfDocument.numPages} 页，页面会在接近视口时再渲染。
      </div>
    </div>
  )
}
