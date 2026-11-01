/**
 * 북마크 메타의 HTML 파서 — 32번 트랙 F-4a (정본 §3.4 [보강 F-4] ③)
 *
 * 가져온 HTML 의 앞부분에서 제목 · 설명 · 그림 · 사이트 이름을 읽는다. 외부 의존 없이 정규식으로 — 문서 전체를 DOM 으로 세우지 않는다(남의
 * 페이지를 서버에서 파싱하는 일이라 작고 예측 가능해야 한다). 읽는 차례는 OpenGraph → twitter → 일반(`<title>` · `description`).
 *
 * 순수 모듈이다 — 바깥 요청 · DB 를 모른다.
 */

export const MAX_PREVIEW_TITLE = 300
export const MAX_PREVIEW_DESCRIPTION = 1000
export const MAX_PREVIEW_SITE = 200
export const MAX_PREVIEW_IMAGE_URL = 2048

export type ParsedPreview = {
  readonly title: string | null
  readonly description: string | null
  readonly imageUrl: string | null
  readonly siteName: string | null
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** HTML 엔티티를 푼다 — 이름 몇 개 · 십진 · 십육진. 모르는 이름은 그대로. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[lower] ?? whole
  })
}

/** 공백을 접고(제어 문자는 공백으로) 자르고 비면 null. */
function clean(raw: string | undefined, max: number): string | null {
  if (raw === undefined) return null
  // 제어 문자는 공백으로
  const text = decodeEntities(raw).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** 태그 하나의 속성들 — 이름은 소문자. 따옴표 없는 값도 받는다. */
function attributesOf(tag: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  for (const m of tag.matchAll(re)) {
    const name = m[1].toLowerCase()
    if (!out.has(name)) out.set(name, m[3] ?? m[4] ?? m[5] ?? '')
  }
  return out
}

/** 그림 주소 — 최종 주소 기준으로 풀고 http · https · 상한 안만. */
function resolveImage(raw: string | undefined, baseUrl: string): string | null {
  if (raw === undefined) return null
  const text = decodeEntities(raw).trim()
  if (text === '') return null
  try {
    const url = new URL(text, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.length <= MAX_PREVIEW_IMAGE_URL ? url.href : null
  } catch {
    return null
  }
}

/**
 * HTML 에서 메타를 읽는다. `baseUrl` 은 리다이렉트를 따라간 **최종 주소**(상대 그림 주소의 기준).
 * `<body>` 앞까지만 본다 — 없으면 전체(이미 상한으로 자른 글이다).
 */
export function parsePreview(html: string, baseUrl: string): ParsedPreview {
  const bodyAt = html.search(/<body[\s>]/i)
  const head = bodyAt >= 0 ? html.slice(0, bodyAt) : html
  const metas = new Map<string, string>()
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributesOf(m[0])
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase()
    const content = attrs.get('content')
    if (key !== '' && content !== undefined && !metas.has(key)) metas.set(key, content)
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  return {
    title: clean(metas.get('og:title') ?? metas.get('twitter:title') ?? titleTag, MAX_PREVIEW_TITLE),
    description: clean(metas.get('og:description') ?? metas.get('twitter:description') ?? metas.get('description'), MAX_PREVIEW_DESCRIPTION),
    imageUrl: resolveImage(metas.get('og:image') ?? metas.get('og:image:url') ?? metas.get('twitter:image'), baseUrl),
    siteName: clean(metas.get('og:site_name'), MAX_PREVIEW_SITE),
  }
}
