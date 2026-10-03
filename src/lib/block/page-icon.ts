/**
 * 페이지 아이콘 — 저장 모양 · 읽기 · 받기 (잔여 묶음 8c-1 · F-02-05 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 페이지 아이콘
 *
 * **자리는 페이지 행의 `block.format.page_icon` 이다** — 제목(`properties.title`)과 달리 모습이다(노션 내부 모델과 같은 자리 ·
 * 복제(#110)가 이미 `format` 을 통째로 사본에 옮긴다). 값은 노션 공개 API 의 icon 객체 모양 — 지금은 이모지 하나다:
 *
 *   { "type": "emoji", "emoji": "🌱" }
 *
 * 이미지(업로드 · 외부 URL)는 다음 조각이다 — 이미지 블록의 `source` 와 같은 모양(`{type:'file', file_id}` · `{type:'external', url}`)으로
 * 넓힌다(그때 DB 의 CHECK(0037)도 넓힌다).
 *
 * ⚠ **본문(Y.Doc)은 아이콘을 싣지 않는다** — 하위 페이지 참조 노드가 행의 `format` 을 받아 오던 길(`rowsToDoc` → `docToPm`)로 볼 수
 * 없는 하위 페이지의 아이콘이 부모 본문을 타고 퍼진다(제목이 그랬다 — §3.2-22). 본문의 `format` 을 거르는 `normalizeFormat` 이
 * 이 키를 늘 버린다(`types.ts`).
 */

import { isSingleEmoji } from '../contracts/emoji.ts'

/** `block.format` 의 키. 본문(Y.Doc)의 `format` 에는 없다(머리말). */
export const PAGE_ICON_KEY = 'page_icon'

export type PageIcon = { readonly type: 'emoji'; readonly emoji: string }

/**
 * 저장된 값(`format.page_icon`)을 읽는다 — **관대하게.** 모양이 아니면 없는 것(null)이다 — 아이콘 하나가 망가졌다고 사이드바가
 * 500 이 되면 안 된다(제목의 `readTitle` 과 같은 규칙). DB 의 CHECK(0037)이 모양을 막지만 grapheme 은 못 센다.
 */
export function readPageIcon(raw: unknown): PageIcon | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as { type?: unknown; emoji?: unknown }
  if (r.type !== 'emoji' || typeof r.emoji !== 'string' || !isSingleEmoji(r.emoji)) return null
  return { type: 'emoji', emoji: r.emoji }
}

/** 페이지 행의 `format` 에서 아이콘을 읽는다. */
export function pageIconOfFormat(format: unknown): PageIcon | null {
  if (typeof format !== 'object' || format === null || Array.isArray(format)) return null
  return readPageIcon((format as Record<string, unknown>)[PAGE_ICON_KEY])
}

/**
 * 받은 값(라우트 · 화면) — **엄격하게.** `null` 은 지우기, `{ type: 'emoji', emoji }` 는 이모지 한 글자만(앞뒤 공백은 벗긴다 ·
 * `type` 은 생략할 수 있다 — 노션 API 가 `{ "emoji": "🥬" }` 를 받는 것과 같다). 그 밖은 `undefined`(→ `invalid_icon`).
 */
export function parsePageIconInput(raw: unknown): PageIcon | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as { type?: unknown; emoji?: unknown }
  if (r.type !== undefined && r.type !== 'emoji') return undefined
  if (typeof r.emoji !== 'string') return undefined
  const emoji = r.emoji.trim()
  return isSingleEmoji(emoji) ? { type: 'emoji', emoji } : undefined
}

export function samePageIcon(a: PageIcon | null, b: PageIcon | null): boolean {
  if (a === null || b === null) return a === b
  return a.type === b.type && a.emoji === b.emoji
}

/**
 * 아이콘이 없는 페이지의 기본 표시 — 회색 문서 글리프(F-02-05). **그림(SVG)이다** — 줄의 글자(`textContent`)에 섞이지 않는다
 * (8c-1 · §3.3-232). React(`page-icon-view.tsx`)와 노드 뷰의 DOM(`editor/page-icon-dom.ts`)이 이 모양 하나를 그린다.
 */
export const PAGE_GLYPH: IconGlyph = {
  viewBox: '0 0 16 16',
  paths: ['M4 1.75h5.25L12.5 5v9.25H4z', 'M9.25 1.75V5h3.25'],
}

/**
 * 아이콘이 없는 **데이터베이스**의 기본 표시 — 회색 표 글리프(8c-3b). 전에는 글자 `▦` 였다 — 줄의 글자에 섞여, 페이지 글리프가
 * 그림인 까닭(§3.3-232)을 데이터베이스만 어겼다. 사이드바 · teamspace 화면의 데이터베이스 줄이 그린다.
 */
export const DATABASE_GLYPH: IconGlyph = {
  viewBox: '0 0 16 16',
  paths: ['M2 3h12v10H2z', 'M2 6.5h12', 'M6.5 6.5V13'],
}

/** 기본 글리프의 모양 — 16×16 안의 선(채우지 않는다). */
export type IconGlyph = { readonly viewBox: string; readonly paths: readonly string[] }

/** 저장할 모양 — 받은 객체의 다른 키는 싣지 않는다. */
export function pageIconJson(icon: PageIcon): { type: 'emoji'; emoji: string } {
  return { type: 'emoji', emoji: icon.emoji }
}
