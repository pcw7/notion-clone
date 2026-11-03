/**
 * 페이지의 모습 — 서체 · 작은 글씨 · 전체 폭 (36번 트랙 PL-1 · F-02-07 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강 PL-1] 페이지의 모습
 *
 * 02 F-02-07 *"페이지 단위로 서체(Default / Serif / Mono) · Small text · Full width 를 전환한다 · 전 페이지 기본값은 없다"*. 자리는 아이콘 · 커버와
 * 같은 **페이지 행의 `block.format`** 이다(정본 §3.6 R5 가 이미 `block.format.page_full_width` 를 일반 페이지의 자리로 적었다). **기본값이면 키가
 * 없다** — 서체는 `serif` · `mono` 일 때만, 두 토글은 켰을 때만(`true`) 적는다.
 *
 *   page_font        'serif' | 'mono'      없으면 기본(산세리프)
 *   page_small_text  true                  없으면 보통 글씨
 *   page_full_width  true                  없으면 가운데 좁은 칸
 *
 * 데이터베이스 행은 쓰지 않는다 — 행 페이지의 폭은 레이아웃(`page_layout.full_width` · R5)이 정한다. 본문(Y.Doc)은 싣지 않는다(아이콘 · 커버와 같다).
 */

export const PAGE_FONT_KEY = 'page_font'
export const PAGE_SMALL_TEXT_KEY = 'page_small_text'
export const PAGE_FULL_WIDTH_KEY = 'page_full_width'

/** 페이지 행의 모습 키 — 본문의 `format` 에서는 늘 버린다(`normalizeFormat` · `sanitizeBlockAttrs`). */
export const PAGE_APPEARANCE_KEYS = [PAGE_FONT_KEY, PAGE_SMALL_TEXT_KEY, PAGE_FULL_WIDTH_KEY] as const

export const PAGE_FONTS = ['default', 'serif', 'mono'] as const
export type PageFont = (typeof PAGE_FONTS)[number]

export type PageAppearance = {
  readonly font: PageFont
  readonly smallText: boolean
  readonly fullWidth: boolean
}

export const DEFAULT_PAGE_APPEARANCE: PageAppearance = { font: 'default', smallText: false, fullWidth: false }

const isPageFont = (value: unknown): value is PageFont => typeof value === 'string' && (PAGE_FONTS as readonly string[]).includes(value)

/** 페이지 행의 `format` 에서 읽는다 — 관대하게(모르는 값은 기본). */
export function pageAppearanceOfFormat(format: unknown): PageAppearance {
  if (typeof format !== 'object' || format === null || Array.isArray(format)) return DEFAULT_PAGE_APPEARANCE
  const f = format as Record<string, unknown>
  const font = f[PAGE_FONT_KEY]
  return {
    font: isPageFont(font) ? font : 'default',
    smallText: f[PAGE_SMALL_TEXT_KEY] === true,
    fullWidth: f[PAGE_FULL_WIDTH_KEY] === true,
  }
}

/** 받은 바꿈 — 준 칸만(부분). 객체가 아니거나 아는 칸의 값이 틀리면 null · 빈 객체도 null(바꿀 것이 없다). 모르는 칸은 읽지 않는다. */
export function parsePageAppearancePatch(raw: unknown): Partial<PageAppearance> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: { -readonly [K in keyof PageAppearance]?: PageAppearance[K] } = {}
  if (r.font !== undefined) {
    if (!isPageFont(r.font)) return null
    out.font = r.font
  }
  for (const key of ['smallText', 'fullWidth'] as const) {
    if (r[key] === undefined) continue
    if (typeof r[key] !== 'boolean') return null
    out[key] = r[key] as boolean
  }
  return Object.keys(out).length === 0 ? null : out
}

/** 합친 모습을 `format` 에 적을 값으로 — 기본값인 칸은 키를 지운다(null). */
export function appearanceFormatEntries(next: PageAppearance): Record<(typeof PAGE_APPEARANCE_KEYS)[number], string | true | null> {
  return {
    [PAGE_FONT_KEY]: next.font === 'default' ? null : next.font,
    [PAGE_SMALL_TEXT_KEY]: next.smallText ? true : null,
    [PAGE_FULL_WIDTH_KEY]: next.fullWidth ? true : null,
  }
}

export function samePageAppearance(a: PageAppearance, b: PageAppearance): boolean {
  return a.font === b.font && a.smallText === b.smallText && a.fullWidth === b.fullWidth
}
