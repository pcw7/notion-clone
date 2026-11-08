/**
 * 주소 붙여넣기 — 링크로 넣고 메뉴를 연다 (44번 트랙 EM-2 · F-09-18 · 정본 §3.4 [보강 EM-2])
 *
 * 항상 실리는 쪽이라 작게 둔다 — 주소 판별 · 붙여넣기 명령 · 열린 범위를 쥔 플러그인뿐이다. 메뉴 판은 지연 로드하고
 * (`paste-url-menu.tsx`), 고른 뒤의 변형은 `paste-url-apply.ts` 가 한다.
 *
 * 열린 범위는 매핑으로 따라간다(다른 사람의 편집 포함). 그 범위가 더는 그 주소의 링크가 아니면 닫는다 — 아무것도 바꾸지 않는다.
 * 키 · 마우스 · 조합 입력은 메뉴가 먹는 키(↑↓ · Enter · Esc)를 뺀 모두 닫는다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { isBookmarkUrl } from '../block/bookmark-block.ts'


export type PasteUrlRange = { readonly from: number; readonly to: number; readonly url: string }

export const pasteUrlKey = new PluginKey<PasteUrlRange | null>('pasteUrl')

/** 평문이 주소 하나인가 — 앞뒤 공백을 떼고 공백 · 줄바꿈이 없고 http(s) · 2,048자 이하(북마크 · 임베드와 같은 계약). 아니면 null. */
export function pastedUrlOf(plain: string | null | undefined): string | null {
  const text = (plain ?? '').trim()
  if (text === '' || /\s/.test(text)) return null
  return isBookmarkUrl(text) ? text : null
}

/** 그 범위가 그 주소를 링크로 든 글자인가 — 글자가 같고 모든 조각에 같은 href 의 링크 마크가 있다. */
export function holdsLink(doc: PmNode, from: number, to: number, url: string): boolean {
  if (from >= to || from < 0 || to > doc.content.size) return false
  if (doc.textBetween(from, to, '￼', '￼') !== url) return false
  let ok = true
  doc.nodesBetween(from, to, (node) => {
    if (!node.isInline) return true
    if (!node.marks.some((m) => m.type.name === 'link' && m.attrs.href === url)) ok = false
    return false
  })
  return ok
}

export function pasteUrlState(state: EditorState): PasteUrlRange | null {
  return pasteUrlKey.getState(state) ?? null
}

/** 메뉴를 닫는다 — 아무것도 바꾸지 않는다. */
export function closePasteUrlMenu(tr: Transaction): Transaction {
  return tr.setMeta(pasteUrlKey, { close: true })
}

/** 주소 붙여넣기를 받을 자리인가 — 글자 선택이고 링크 마크를 받는 글 자리(코드 블록 같은 평문 본문은 아니다). 동기로 가른다: 아니면 기본 붙여넣기로 넘어간다. */
export function canPasteUrl(state: EditorState): boolean {
  const sel = state.selection
  const link = state.schema.marks.link
  if (!(sel instanceof TextSelection) || !link) return false
  const parent = sel.$from.parent
  return parent.inlineContent && parent.type.spec.code !== true && parent.type.allowsMarkType(link)
}

/**
 * 주소 하나를 붙여넣었다. 글자 선택이 있으면 그 선택에 링크를 걸고(메뉴 없음), 없으면 주소를 링크 글자로 넣고 메뉴를 연다.
 * 붙여넣는 그 순간에 넣는다(늦게 넣으면 그 사이 친 글자와 자리가 엇갈린다) — 메뉴의 화면만 지연 로드다. 받을 자리가 아니면 false.
 */
export function pasteUrlCommand(url: string): Command {
  return (state, dispatch) => {
    const link = state.schema.marks.link
    const { $from, from, to } = state.selection as TextSelection
    if (!link || !('$cursor' in state.selection) /* 글자 선택(TextSelection)만 */ || !$from.parent.inlineContent || $from.parent.type.spec.code === true || !$from.parent.type.allowsMarkType(link)) return false
    if (dispatch) {
      const mark = link.create({ href: url })
      if (from !== to) {
        dispatch(state.tr.addMark(from, to, mark).scrollIntoView())
      } else {
        const marks = mark.addToSet($from.marks().filter((m) => m.type !== link))
        const tr = state.tr.insert(from, state.schema.text(url, marks))
        dispatch(tr.setMeta(pasteUrlKey, { open: { from, to: from + url.length, url } }).scrollIntoView())
      }
    }
    return true
  }
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

/** 열려 있으면 닫는다(아무것도 바꾸지 않는다) — DOM 핸들러 모양이라 false 를 돌려 이벤트는 그대로 흐른다. */
const closeOpen = (view: EditorView): boolean => {
  if (pasteUrlState(view.state) !== null) view.dispatch(closePasteUrlMenu(view.state.tr))
  return false
}

export function pasteUrlPlugin(): Plugin<PasteUrlRange | null> {
  return new Plugin<PasteUrlRange | null>({
    key: pasteUrlKey,
    state: {
      init: () => null,
      apply: (tr, prev, _old, next) => {
        const meta = tr.getMeta(pasteUrlKey) as { close?: boolean; open?: PasteUrlRange } | undefined
        if (meta?.close) return null
        if (meta?.open) return meta.open
        if (prev === null || !tr.docChanged) return prev
        const from = tr.mapping.map(prev.from, 1)
        const to = tr.mapping.map(prev.to, -1)
        return holdsLink(next.doc, from, to, prev.url) ? { from, to, url: prev.url } : null
      },
    },
    props: {
      // 메뉴가 먹는 키(↑↓ · Enter · Esc)는 화면이 먼저 받아 여기까지 오지 않는다 — 여기 온 키는 다른 입력이다.
      // 마우스 · 조합 시작 · 다른 붙여넣기도 같다(새 붙여넣기가 메뉴를 열면 이 핸들러 뒤에 다시 열린다).
      handleKeyDown: (view, event) => (MODIFIER_KEYS.has(event.key) ? false : closeOpen(view)),
      handleTextInput: closeOpen,
      handleDOMEvents: { mousedown: closeOpen, compositionstart: closeOpen, paste: closeOpen },
    },
  })
}
