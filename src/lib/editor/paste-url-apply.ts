/**
 * 주소 붙여넣기 — 넣기와 메뉴에서 고른 것의 적용 (EM-2 · 정본 §3.4 [보강 EM-2] ①~④)
 *
 * 한 트랜잭션이다 — 되돌리기 한 번이면 링크로 돌아간다(앞뒤로 되돌리기 걸음을 끊는다). 메뉴가 열린 동안 범위가 바뀌어 더는 그 주소의 링크가
 * 아니면 아무것도 하지 않고 닫는다. 지연 로드되는 쪽이다(번들 예산).
 *
 * ⚠ 편집기의 다른 모듈(`paste-url` · `pm-adapter` · `pm-blocks` · `code-block` · `mention-menu` …)을 **가져오지 않는다.** 지연 청크가 첫 번들의
 * 모듈을 가져오면 번들러가 그 모듈과 그 의존(ProseMirror 전체)을 공용 청크로 떼어 첫 번들이 따로 압축되며 ~2.5KB(gzip) 부푼다. 그래서 플러그인 키는
 * 부르는 쪽이 넘기고(`PasteUrlKey`), 노드는 스키마에서 이름으로 만들고, 되돌리기 걸음을 끊는 일도 부르는 쪽이 넘긴다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorState, PluginKey, Transaction } from '@tiptap/pm/state'

import type { PasteUrlChoice } from './paste-url-choices.ts'

/** 열린 범위 — `paste-url.ts` 의 `PasteUrlRange` 와 같은 모양(그쪽을 가져오지 않는다). */
export type PasteUrlOpen = { readonly from: number; readonly to: number; readonly url: string }
export type PasteUrlKey = PluginKey<PasteUrlOpen | null>

/** 그 범위가 그 주소를 링크로 든 글자인가 — `paste-url.ts` 의 `holdsLink` 와 같다(가져오지 않으려 둔 사본). */
function holdsUrlLink(doc: PmNode, from: number, to: number, url: string): boolean {
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

const closeOnly = (state: EditorState, key: PasteUrlKey): Transaction => state.tr.setMeta(key, { close: true })


/** 글이 든 블록 컨테이너 — 위치 · 안의 내용 노드 · 자식 그룹. */
export type PasteUrlContainer = {
  readonly id: string
  readonly pos: number
  readonly node: PmNode
  readonly contentPos: number
  readonly contentNode: PmNode
  /** 자식 그룹 앞의 위치 — 없으면 null. */
  readonly groupPos: number | null
}

export function containerOfPos(doc: PmNode, pos: number): PasteUrlContainer | null {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name !== 'blockContainer') continue
    const at = $pos.before(depth)
    const contentNode = node.child(0)
    return {
      id: String(node.attrs.blockId ?? ''),
      pos: at,
      node,
      contentPos: at + 1,
      contentNode,
      groupPos: node.childCount > 1 ? at + 1 + contentNode.nodeSize : null,
    }
  }
  return null
}

/** 그 문단이 붙여넣은 링크 하나뿐인가 — 문단이고 자식이 없고 글이 그 범위뿐이다(그러면 문단을 블록으로 바꾼다). */
export function isOnlyLink(info: PasteUrlContainer, from: number, to: number): boolean {
  const content = info.contentNode
  return (
    content.type.name === 'paragraph' &&
    info.groupPos === null &&
    from === info.contentPos + 1 &&
    to === info.contentPos + 1 + content.content.size
  )
}

function blockNode(state: EditorState, type: 'bookmark' | 'embed', url: string, id: string): PmNode {
  const { blockContainer } = state.schema.nodes
  return blockContainer.create({ blockId: id }, [state.schema.nodes[type].create({ props: { url }, format: {} })])
}

/**
 * 고른 것의 트랜잭션. 링크로 두기 · 범위가 달라졌다 · 적용할 수 없다면 닫기만 하는(문서를 바꾸지 않는) 트랜잭션이다.
 * `pageId` 는 페이지 멘션일 때의 대상.
 */
export function pasteUrlTransaction(
  state: EditorState,
  key: PasteUrlKey,
  choice: PasteUrlChoice,
  pageId: string | null,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): Transaction {
  const close = closeOnly(state, key)
  const range = key.getState(state) ?? null
  if (range === null || choice === 'link' || !holdsUrlLink(state.doc, range.from, range.to, range.url)) return close
  const { from, to, url } = range

  if (choice === 'mention') {
    const node =
      pageId === null ? undefined : state.schema.nodes.mention?.create({ mention: { type: 'page', page: { id: pageId } }, plainText: '' })
    if (node === undefined) return close
    return state.tr.replaceWith(from, to, [node, state.schema.text(' ')]).setMeta(key, { close: true })
  }

  const info = containerOfPos(state.doc, from)
  if (info === null) return close
  const tr = state.tr
  try {
    if (isOnlyLink(info, from, to)) {
      tr.replaceWith(info.pos, info.pos + info.node.nodeSize, blockNode(state, choice, url, info.id))
    } else {
      tr.delete(from, to)
      // 문단 바로 뒤 — 자식이 있으면 그 첫 자리(붙여넣은 블록과 같다).
      const at = info.groupPos !== null ? tr.mapping.map(info.groupPos) + 1 : tr.mapping.map(info.pos + info.node.nodeSize)
      tr.insert(at, blockNode(state, choice, url, newId()))
    }
  } catch {
    // 수선이 오기 전 스키마를 어긴 문서 — 아무것도 바꾸지 않는다.
    return close
  }
  return tr.setMeta(key, { close: true }).scrollIntoView()
}

/** 고른 것을 적용한다 — 앞뒤로 되돌리기 걸음을 끊어(`separate`) 한 번에 링크로 돌아오게 한다. */
export function applyPasteUrlChoice(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  env: { readonly key: PasteUrlKey; readonly separate: (state: EditorState) => void },
  choice: PasteUrlChoice,
  pageId: string | null,
): void {
  const tr = pasteUrlTransaction(view.state, env.key, choice, pageId)
  if (!tr.docChanged) {
    view.dispatch(tr)
    return
  }
  env.separate(view.state)
  view.dispatch(tr)
  env.separate(view.state)
}
