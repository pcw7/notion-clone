/**
 * 행 페이지의 페이지 설정 — 백링크 표시 · 인라인 코멘트 표시 · 토론 · 속성 아이콘 · 전체 폭 (항목 레이아웃 3b-1 · F-16-09 · F-16-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 `page_layout` 의 다섯 칸 · [보강] 페이지 설정
 *       16-item-layout.md F-16-09 *"표시 정책 1개 enum"* · F-16-10 *"4개 모두 표시 정책이며 권한 · 데이터에 영향이 없다"*
 *
 * 다섯 칸은 레이아웃 머리(`page_layout`)에 있다 — 데이터베이스의 모든 행에 같다(일반 페이지는 페이지마다 갖는 것이 행에서는 레이아웃으로
 * 오른다 · 16 R5). 머리가 없으면 기본값이다 — 표의 칸 기본값과 같다(0044).
 *
 * 이 파일은 DB 를 모른다 — 화면(편집 모드)과 서버(`layout.ts` · 라우트)가 같은 타입 · 기본값 · 검사를 본다.
 */

export const BACKLINKS_MODES = ['always', 'hover', 'off'] as const
export type BacklinksMode = (typeof BACKLINKS_MODES)[number]

export const INLINE_COMMENT_MODES = ['default', 'minimal'] as const
export type InlineCommentMode = (typeof INLINE_COMMENT_MODES)[number]

export type PageSettings = {
  /** 백링크 — 늘 펼쳐 보임 · 접어 둠(눌러 펼친다) · 보이지 않음(F-16-09). */
  readonly backlinks: BacklinksMode
  /** 본문의 코멘트 표시 — 기본 · 옅게(F-16-10 · 코멘트는 그대로다 — 표시만). */
  readonly inlineComments: InlineCommentMode
  /** 페이지의 토론(코멘트 창)을 보인다. */
  readonly showDiscussions: boolean
  /** 속성 이름 앞의 유형 아이콘을 보인다. */
  readonly showPropertyIcons: boolean
  /** 페이지를 화면 폭으로 편다. */
  readonly fullWidth: boolean
}

/** 머리가 없을 때 — `page_layout` 칸의 기본값과 같다(0044). */
export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  backlinks: 'hover',
  inlineComments: 'default',
  showDiscussions: true,
  showPropertyIcons: true,
  fullWidth: false,
}

const isOneOf = <T extends string>(values: readonly T[], v: unknown): v is T => typeof v === 'string' && (values as readonly string[]).includes(v)

/**
 * 적용 요청의 `settings` — 준 칸만 바꾼다(부분). 객체가 아니거나 아는 칸의 값이 틀리면 null 이다. 모르는 칸은 읽지 않는다(앞으로 칸이
 * 늘어도 옛 화면이 깨지지 않게).
 */
export function parsePageSettings(raw: unknown): Partial<PageSettings> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: { -readonly [K in keyof PageSettings]?: PageSettings[K] } = {}
  if (r.backlinks !== undefined) {
    if (!isOneOf(BACKLINKS_MODES, r.backlinks)) return null
    out.backlinks = r.backlinks
  }
  if (r.inlineComments !== undefined) {
    if (!isOneOf(INLINE_COMMENT_MODES, r.inlineComments)) return null
    out.inlineComments = r.inlineComments
  }
  for (const key of ['showDiscussions', 'showPropertyIcons', 'fullWidth'] as const) {
    if (r[key] === undefined) continue
    if (typeof r[key] !== 'boolean') return null
    out[key] = r[key]
  }
  return out
}

/** 두 설정이 같은가. */
export const samePageSettings = (a: PageSettings, b: PageSettings): boolean =>
  a.backlinks === b.backlinks &&
  a.inlineComments === b.inlineComments &&
  a.showDiscussions === b.showDiscussions &&
  a.showPropertyIcons === b.showPropertyIcons &&
  a.fullWidth === b.fullWidth
