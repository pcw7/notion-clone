/**
 * 서식 툴바의 규칙 — 고른 글자 위의 굵게 · 기울임 · 밑줄 · 취소선 · 코드 · 링크 · 수식 · 색 (Phase 2 1e-2 · F-01-03 · F-01-21 · DOM 없음)
 *
 * 정본: 01-block-editor.md F-01-03 시나리오 1 *"텍스트를 드래그 선택 → 플로팅 툴바 등장 → `B` 클릭 또는 Cmd/Ctrl+B"* · 시나리오 2
 * *"Cmd/Ctrl+K → URL 입력창"* · F-01-21 시나리오 5 *"텍스트를 선택한 상태에서는 플로팅 툴바의 `A` 드롭다운 → 선택 범위만"*
 *
 * 화면(`format-toolbar.tsx`)은 그리기 · 포커스만 한다. 언제 보이는지 · 무엇이 켜졌는지 · 링크 주소를 어떻게 다듬는지는 여기서 정한다.
 *
 *   · **보이는 때** — 비지 않은 글자 선택(TextSelection — 양 끝은 늘 인라인 내용 안이다) · 평문 본문(코드 블록)이 아님. 블록 선택 · 셀 사각
 *     선택 · 노드 선택(원자)에는 서지 않는다 — 그 선택의 서식 길은 블록 메뉴 · 키다. 읽기 전용 · 끄는 동안은 화면이 끈다
 *   · **켜짐 표시** — 고른 범위에 걸린 서식(`activeFormats` — 일부에만 걸려도 켜짐) · 첫 글자의 색(`activeColor`) · 첫 글자의 링크
 *   · **링크 주소 다듬기**(`normalizeLinkInput`) — 앞뒤 공백을 걷고, 스킴이 없으면 `https://` 를 붙이고, http · https · mailto 만
 *     받는다(그 밖의 스킴 — `javascript:` 따위 — 는 거부). 비우면 링크를 뗀다. 계약의 상한(`MAX_LINK_URL`)을 넘으면 거부
 */

import type { EditorState } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

import { MAX_LINK_URL, type Color } from '../contracts/rich-text.ts'
import { activeColor, activeFormats } from './marks.ts'
import { blockSchema, isPlainTextNode, type BooleanMark } from './schema.ts'

export type FormatToolbarState = {
  /** 고른 범위에 걸린 서식 — 일부에만 걸려도 켜짐이다(`activeFormats`). */
  readonly formats: readonly BooleanMark[]
  /** 첫 글자의 색 — 없으면 `default`. */
  readonly color: Color
  /** 첫 글자의 링크 — 없으면 null. */
  readonly link: string | null
}

/** 지금 선택에 서식 툴바를 세울 것인가 — 세우면 그 상태, 아니면 null(머리말의 "보이는 때"). */
export function formatToolbarState(state: EditorState): FormatToolbarState | null {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return null
  const { $from, $to } = sel
  if (isPlainTextNode($from.parent) || isPlainTextNode($to.parent)) return null
  const link = blockSchema.marks.link.isInSet(state.doc.nodeAt($from.pos)?.marks ?? $from.marks())
  return {
    formats: activeFormats(state),
    color: activeColor(state),
    link: typeof link?.attrs.href === 'string' ? link.attrs.href : null,
  }
}

/** 링크 입력의 결과 — 걸 주소(null 이면 링크를 뗀다) 또는 받을 수 없는 입력. */
export type LinkInput = { readonly ok: true; readonly href: string | null } | { readonly ok: false; readonly reason: 'scheme' | 'too_long' }

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto'])

/** 링크 입력을 다듬는다(머리말). 스킴은 제어 문자 · 공백을 걷어낸 모양으로 판정한다 — 브라우저가 `java\tscript:` 를 그렇게 읽는다. */
export function normalizeLinkInput(raw: string): LinkInput {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, href: null }
  let probe = ''
  for (const ch of trimmed) if (ch.charCodeAt(0) > 0x20 && ch !== '\x7f') probe += ch
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(probe)?.[1]?.toLowerCase()
  // `localhost:3000` · `example.com:8080` 처럼 스킴 자리에 호스트가 온 것은 스킴이 아니다 — 뒤가 숫자(포트)면 주소로 본다.
  const hostWithPort = scheme !== undefined && /^[A-Za-z][A-Za-z0-9+.-]*:\d/.test(probe)
  let href: string
  if (scheme !== undefined && !hostWithPort) {
    if (!ALLOWED_SCHEMES.has(scheme)) return { ok: false, reason: 'scheme' }
    href = trimmed
  } else {
    href = `https://${trimmed}`
  }
  if (href.length > MAX_LINK_URL) return { ok: false, reason: 'too_long' }
  return { ok: true, href }
}

/** 툴바 버튼 — 화면이 이 순서로 그린다. 라벨은 스크린리더 · 툴팁, 기호는 버튼의 글자. */
export const FORMAT_BUTTONS: readonly { readonly mark: BooleanMark; readonly label: string; readonly glyph: string; readonly shortcut: string }[] = [
  { mark: 'bold', label: '굵게', glyph: 'B', shortcut: 'Mod-B' },
  { mark: 'italic', label: '기울임', glyph: 'I', shortcut: 'Mod-I' },
  { mark: 'underline', label: '밑줄', glyph: 'U', shortcut: 'Mod-U' },
  { mark: 'strikethrough', label: '취소선', glyph: 'S', shortcut: 'Mod-Shift-S' },
  { mark: 'code', label: '코드', glyph: '<>', shortcut: 'Mod-E' },
]
