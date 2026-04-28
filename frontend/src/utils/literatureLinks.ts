export interface LiteratureReferenceTarget {
  label: string
  href: string
  isArxiv: boolean
  paperId?: string
}

export interface LiteratureReferenceMatch {
  start: number
  end: number
  target: LiteratureReferenceTarget
}

const ARXIV_ID_SOURCE = String.raw`(?:[a-zA-Z.-]+\/\d{7}|\d{4}\.\d{4,5})`
const ARXIV_TEXT_PATTERN = new RegExp(
  String.raw`\barXiv:\s*(${ARXIV_ID_SOURCE}(?:v\d+)?)\b`,
  'i',
)
const ARXIV_URL_PATTERN = new RegExp(
  String.raw`https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html|e-print)\/(${ARXIV_ID_SOURCE}(?:v\d+)?)(?:\.pdf)?`,
  'i',
)
const URL_PATTERN = /https?:\/\/[^\s<>()\]]+/i
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const PLAIN_REFERENCE_PATTERN = new RegExp(
  String.raw`https?:\/\/[^\s<>()\]]+|\barXiv:\s*${ARXIV_ID_SOURCE}(?:v\d+)?\b`,
  'gi',
)

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:]+$/g, '')
}

export function extractArxivPaperId(value: string): string | null {
  const normalized = trimTrailingPunctuation(value.trim())
  const urlMatch = normalized.match(ARXIV_URL_PATTERN)
  if (urlMatch?.[1]) {
    return urlMatch[1]
  }

  const textMatch = normalized.match(ARXIV_TEXT_PATTERN)
  if (textMatch?.[1]) {
    return textMatch[1]
  }

  return null
}

export function resolveReferenceTarget(
  value: string,
  explicitLabel?: string,
): LiteratureReferenceTarget | null {
  const candidate = trimTrailingPunctuation(value.trim())
  if (!candidate) {
    return null
  }

  const arxivPaperId = extractArxivPaperId(candidate)
  if (arxivPaperId) {
    return {
      label: explicitLabel?.trim() || candidate,
      href: `https://arxiv.org/abs/${arxivPaperId}`,
      isArxiv: true,
      paperId: arxivPaperId,
    }
  }

  const urlMatch = candidate.match(URL_PATTERN)
  if (!urlMatch) {
    return null
  }

  const href = trimTrailingPunctuation(urlMatch[0])
  return {
    label: explicitLabel?.trim() || href,
    href,
    isArxiv: false,
  }
}

export function findReferenceMatches(text: string): LiteratureReferenceMatch[] {
  const matches: LiteratureReferenceMatch[] = []
  let cursor = 0
  MARKDOWN_LINK_PATTERN.lastIndex = 0

  for (const markdownMatch of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawMatch = markdownMatch[0]
    const label = markdownMatch[1]
    const href = markdownMatch[2]
    if (typeof markdownMatch.index !== 'number') {
      continue
    }

    matches.push(
      ...findPlainReferenceMatches(text.slice(cursor, markdownMatch.index), cursor),
    )

    const target = resolveReferenceTarget(href, label)
    if (target) {
      matches.push({
        start: markdownMatch.index,
        end: markdownMatch.index + rawMatch.length,
        target,
      })
    }

    cursor = markdownMatch.index + rawMatch.length
  }

  matches.push(...findPlainReferenceMatches(text.slice(cursor), cursor))
  return matches
}

function findPlainReferenceMatches(
  text: string,
  offset: number,
): LiteratureReferenceMatch[] {
  const matches: LiteratureReferenceMatch[] = []
  PLAIN_REFERENCE_PATTERN.lastIndex = 0

  for (const referenceMatch of text.matchAll(PLAIN_REFERENCE_PATTERN)) {
    const rawMatch = referenceMatch[0]
    if (typeof referenceMatch.index !== 'number') {
      continue
    }

    const target = resolveReferenceTarget(rawMatch)
    if (!target) {
      continue
    }

    matches.push({
      start: offset + referenceMatch.index,
      end: offset + referenceMatch.index + rawMatch.length,
      target,
    })
  }

  return matches
}
