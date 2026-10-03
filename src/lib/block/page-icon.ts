/**
 * 페이지 아이콘 — 저장 모양 · 읽기 · 받기 (잔여 묶음 8c-1 · 8c-4 · F-02-05 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 페이지 아이콘
 *
 * **자리는 페이지 행의 `block.format.page_icon` 이다** — 제목(`properties.title`)과 달리 모습이다(노션 내부 모델과 같은 자리 ·
 * 복제(#110)가 이미 `format` 을 통째로 사본에 옮긴다). 데이터베이스 자신의 아이콘은 `database.icon` 이고 모양이 같다(8c-3b).
 * 값은 셋 중 하나다 — 이모지는 노션 공개 API 의 icon 객체 모양, 이미지(8c-4)는 **이미지 블록의 `source` 와 같은 모양**이다:
 *
 *   { "type": "emoji", "emoji": "🌱" }
 *   { "type": "file", "file_id": "…uuid…" }          우리가 호스팅하는 파일 — 주소는 파생값이다(FS2 · `pageIconSrc`)
 *   { "type": "external", "url": "https://…" }       외부 이미지 — 값 자체가 주소다(http · https 만 · `isSafeImageUrl`)
 *
 * 파일 아이콘은 그 파일의 **참조**다 — `file.ref_count` 에 센다(아이콘을 바꾸는 명령 · 복제가 같은 트랜잭션에서 · `icon-file.ts`).
 *
 * ⚠ **본문(Y.Doc)은 아이콘을 싣지 않는다** — 하위 페이지 참조 노드가 행의 `format` 을 받아 오던 길(`rowsToDoc` → `docToPm`)로 볼 수
 * 없는 하위 페이지의 아이콘이 부모 본문을 타고 퍼진다(제목이 그랬다 — §3.2-22). 본문의 `format` 을 거르는 `normalizeFormat` 이
 * 이 키를 늘 버린다(`types.ts`).
 */

import { isSingleEmoji } from '../contracts/emoji.ts'
import { isUuid } from '../ids.ts'
import { imageContentPath, isSafeImageUrl } from './image.ts'

/** `block.format` 의 키. 본문(Y.Doc)의 `format` 에는 없다(머리말). */
export const PAGE_ICON_KEY = 'page_icon'

/**
 * 외부 이미지 주소의 상한(글자 수) — 아이콘은 사이드바 · 목록의 모든 줄이 함께 읽는다. 긴 주소 하나가 트리 조회를 부풀리지 않게
 * 둔다(DB 의 CHECK(0039)과 같은 값). 브라우저 · 서버가 흔히 받는 주소 길이(2KB 안팎)에 맞췄다.
 */
export const MAX_ICON_URL_LENGTH = 2048

export type EmojiIcon = { readonly type: 'emoji'; readonly emoji: string }
export type FileIcon = { readonly type: 'file'; readonly file_id: string }
export type ExternalIcon = { readonly type: 'external'; readonly url: string }
/** 이미지 아이콘(8c-4) — 올린 파일 또는 외부 주소. */
export type ImageIcon = FileIcon | ExternalIcon
export type PageIcon = EmojiIcon | ImageIcon

function isIconUrl(url: unknown): url is string {
  return isSafeImageUrl(url) && url.length <= MAX_ICON_URL_LENGTH && !/\s/.test(url)
}

/**
 * 저장된 값(`format.page_icon` · `database.icon`)을 읽는다 — **관대하게.** 모양이 아니면 없는 것(null)이다 — 아이콘 하나가
 * 망가졌다고 사이드바가 500 이 되면 안 된다(제목의 `readTitle` 과 같은 규칙). DB 의 CHECK(0039)이 모양을 막지만 grapheme 은 못 센다.
 */
export function readPageIcon(raw: unknown): PageIcon | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as { type?: unknown; emoji?: unknown; file_id?: unknown; url?: unknown }
  if (r.type === 'emoji') return typeof r.emoji === 'string' && isSingleEmoji(r.emoji) ? { type: 'emoji', emoji: r.emoji } : null
  if (r.type === 'file') return typeof r.file_id === 'string' && isUuid(r.file_id) ? { type: 'file', file_id: r.file_id.toLowerCase() } : null
  if (r.type === 'external') return isIconUrl(r.url) ? { type: 'external', url: r.url } : null
  return null
}

/** 페이지 행의 `format` 에서 아이콘을 읽는다. */
export function pageIconOfFormat(format: unknown): PageIcon | null {
  if (typeof format !== 'object' || format === null || Array.isArray(format)) return null
  return readPageIcon((format as Record<string, unknown>)[PAGE_ICON_KEY])
}

/**
 * 받은 값(라우트 · 화면) — **엄격하게.** `null` 은 지우기. 셋 중 하나만 받는다(앞뒤 공백은 벗긴다 · 다른 키는 버린다):
 *   · `{ type: 'emoji', emoji }` — 이모지 한 글자만. `type` 은 생략할 수 있다(노션 API 가 `{ "emoji": "🥬" }` 를 받는 것과 같다)
 *   · `{ type: 'file', file_id }` — uuid. **그 파일이 이 워크스페이스의 이미지인지는 명령이 DB 에서 본다**(`icon-file.ts`)
 *   · `{ type: 'external', url }` — http · https 의 절대 주소 · 공백 없음 · `MAX_ICON_URL_LENGTH` 이하
 * 그 밖은 `undefined`(→ `invalid_icon`).
 */
export function parsePageIconInput(raw: unknown): PageIcon | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as { type?: unknown; emoji?: unknown; file_id?: unknown; url?: unknown }
  if (r.type === 'file') {
    if (typeof r.file_id !== 'string') return undefined
    const fileId = r.file_id.trim()
    return isUuid(fileId) ? { type: 'file', file_id: fileId.toLowerCase() } : undefined
  }
  if (r.type === 'external') {
    if (typeof r.url !== 'string') return undefined
    const url = r.url.trim()
    return isIconUrl(url) ? { type: 'external', url } : undefined
  }
  if (r.type !== undefined && r.type !== 'emoji') return undefined
  if (typeof r.emoji !== 'string') return undefined
  const emoji = r.emoji.trim()
  return isSingleEmoji(emoji) ? { type: 'emoji', emoji } : undefined
}

export function samePageIcon(a: PageIcon | null, b: PageIcon | null): boolean {
  if (a === null || b === null) return a === b
  return pageIconKey(a) === pageIconKey(b)
}

/**
 * 아이콘 하나를 가리키는 글자 — 같은가를 견주고, 화면의 `data-page-icon` 에 싣는다(검사가 읽는다). 이모지는 그 글자 그대로(8c-1 부터의
 * 값), 이미지는 종류를 앞에 붙인다(`file:{id}` · `external:{url}`).
 */
export function pageIconKey(icon: PageIcon): string {
  if (icon.type === 'emoji') return icon.emoji
  return icon.type === 'file' ? `file:${icon.file_id}` : `external:${icon.url}`
}

/** 이 아이콘이 가리키는 우리 파일 — 파일 아이콘이 아니면 null. 참조 수를 셀 때 쓴다. */
export function iconFileId(icon: PageIcon | null): string | null {
  return icon !== null && icon.type === 'file' ? icon.file_id : null
}

/**
 * 이미지 아이콘을 보여줄 주소 — 올린 파일은 **세션으로 인증되는 우리 경로**(이미지 블록과 같은 `imageContentPath` · 서명 URL 을
 * 저장하지 않는다 — FS2), 외부 이미지는 그 주소. 워크스페이스를 모르면(경로 밖) null.
 */
export function pageIconSrc(icon: ImageIcon, workspaceId: string | null | undefined): string | null {
  if (icon.type === 'external') return icon.url
  return typeof workspaceId === 'string' && workspaceId !== '' ? imageContentPath(workspaceId, icon.file_id) : null
}

/** 읽는 이에게 말할 이름 — 이모지는 그 글자, 이미지는 무엇인지. */
export function pageIconLabel(icon: PageIcon): string {
  if (icon.type === 'emoji') return icon.emoji
  return icon.type === 'file' ? '올린 이미지' : '링크 이미지'
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
export function pageIconJson(icon: PageIcon): Record<string, string> {
  if (icon.type === 'emoji') return { type: 'emoji', emoji: icon.emoji }
  return icon.type === 'file' ? { type: 'file', file_id: icon.file_id } : { type: 'external', url: icon.url }
}
