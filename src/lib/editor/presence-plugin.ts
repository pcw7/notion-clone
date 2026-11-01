/**
 * 접속자 표시(AW-1 · F-05-03 · 정본 §3.7 presence [보강 AW-1] ②) — 편집기 쪽 둘:
 *
 *   ① 다른 사람이 있는 블록에 표시 — 노드 데코레이션으로 그 블록 컨테이너에 속성만 단다(`data-presence` = 첫 사람의 글자 · 이름들 ·
 *      색). 위젯을 끼우지 않는다 — 글자 흐름 · IME · 캐럿 계산에 끼어들지 않게. 그림은 CSS(`::after`)가 그린다.
 *   ② 내 자리를 알린다 — 선택이 바뀌거나 편집 가능 여부가 바뀔 때 `deps.onLocalPresence` 로(블록 선택이면 고른 블록들 · 아니면 캐럿의
 *      블록). 같은 자리면 부르는 쪽이 거른다(`sameLocalPresence`).
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { presenceInitial, type LocalPresence, type PresencePeer } from '../collab/presence.ts'
import { BlockSelection } from './block-selection.ts'
import { containerAt } from './pm-blocks.ts'

export const presencePluginKey = new PluginKey<PresenceMarkers>('presence')

/** 블록 id → 그 블록에 있는 다른 사람들. */
type PresenceMarkers = ReadonlyMap<string, readonly PresencePeer[]>

const EMPTY: PresenceMarkers = new Map()

/** 동료 목록을 블록별로 묶는다 — 자리가 없는 사람(페이지만 보고 있다)은 블록에 표시하지 않는다. */
export function markersOf(peers: readonly PresencePeer[]): PresenceMarkers {
  const out = new Map<string, PresencePeer[]>()
  for (const peer of peers) {
    if (peer.blockId === null) continue
    const list = out.get(peer.blockId) ?? []
    list.push(peer)
    out.set(peer.blockId, list)
  }
  return out
}

/** 동료 목록을 편집기에 싣는다(메타 트랜잭션 · 문서를 고치지 않는다 · 되돌리기에 쌓이지 않는다). */
export function setPresenceMarkers(view: EditorView, peers: readonly PresencePeer[]): void {
  view.dispatch(view.state.tr.setMeta(presencePluginKey, markersOf(peers)).setMeta('addToHistory', false))
}

/** 지금 내 자리 — 블록 선택이면 고른 블록들 · 아니면 캐럿의 블록. */
export function localPresenceOf(state: EditorState, editable: boolean): LocalPresence {
  const mode = editable ? 'edit' : 'view'
  if (state.selection instanceof BlockSelection) return { cursor: null, block_selection: state.selection.blockIds, mode }
  const info = containerAt(state.selection.$from)
  return { cursor: info === null ? null : { block_id: info.id }, block_selection: [], mode }
}

function decorationsOf(state: EditorState, markers: PresenceMarkers): DecorationSet {
  if (markers.size === 0) return DecorationSet.empty
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    const peers = markers.get(String(node.attrs.blockId ?? ''))
    if (peers !== undefined && peers.length > 0) {
      const first = peers[0] as PresencePeer
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          'data-presence': presenceInitial(first.name),
          'data-presence-names': peers.map((p) => p.name).join(', '),
          style: `--presence-color: ${first.color}`,
        }),
      )
    }
    return true
  })
  return DecorationSet.create(state.doc, decorations)
}

export function presencePlugin(onLocalPresence?: (local: LocalPresence) => void): Plugin<PresenceMarkers> {
  return new Plugin<PresenceMarkers>({
    key: presencePluginKey,
    state: {
      init: () => EMPTY,
      apply: (tr: Transaction, value: PresenceMarkers) => (tr.getMeta(presencePluginKey) as PresenceMarkers | undefined) ?? value,
    },
    props: {
      decorations: (state) => decorationsOf(state, presencePluginKey.getState(state) ?? EMPTY),
    },
    view: (view) => {
      let editable = view.editable
      onLocalPresence?.(localPresenceOf(view.state, editable))
      return {
        update: (next, prev) => {
          if (next.state.selection.eq(prev.selection) && next.editable === editable) return
          editable = next.editable
          onLocalPresence?.(localPresenceOf(next.state, editable))
        },
      }
    },
  })
}
