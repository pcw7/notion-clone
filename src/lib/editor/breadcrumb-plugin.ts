/**
 * breadcrumb 블록에 경로를 싣는다 — 노드 데코레이션 (잔여 묶음 8b-2 · F-01-16 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] breadcrumb — 내용을 저장하지 않고 그릴 때 계산한다
 *
 * 목차(`toc-plugin.ts`)와 같은 길이다(8b-1 이 정한 것) — 노드 뷰는 자기 노드 · 자기 데코레이션이 바뀔 때만 불리므로, breadcrumb 노드마다
 * 속성 없는 노드 데코레이션을 달고 `spec.breadcrumb` 에 경로를 싣는다. 다른 점은 경로가 **문서가 아니라 서버의 데이터**라는 것이다
 * (조상의 제목 · 권한 · teamspace — 머리의 breadcrumb 과 같은 `block/breadcrumb.ts`). 그래서
 *   · 처음 경로는 편집기를 만들 때 받고(`initial`), 바뀌면(제목을 고친 뒤 · 옮긴 뒤 서버가 다시 그린다) 화면이 **메타 트랜잭션**으로
 *     넣는다(`setBreadcrumbTrail`) — 문서를 바꾸지 않으니 읽기 전용에서도 된다
 *   · 같은 경로면 지난 객체를 그대로 둔다(`sameTrail`) — 서버가 다시 그릴 때마다 새 배열이 와도 노드 뷰가 다시 그리지 않는다
 *   · 경로는 **보는 사람마다 다르다**(볼 수 있는 조상만) — 문서에 넣으면 협업 참여자 사이에 남의 권한으로 거른 경로가 퍼진다
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { BREADCRUMB_TYPE, sameTrail, type BreadcrumbTrail } from '../block/breadcrumb.ts'
import { blockTypeOfNode } from './schema.ts'

export type BreadcrumbState = {
  /** 지금 경로 — 아직 받지 않았으면 null. */
  readonly trail: BreadcrumbTrail | null
  readonly set: DecorationSet
}

/** breadcrumb 노드 데코레이션의 spec — 노드 뷰가 읽는다. */
export type BreadcrumbDecorationSpec = { readonly breadcrumb: BreadcrumbTrail | null }

type BreadcrumbMeta = { readonly trail: BreadcrumbTrail | null }

export const breadcrumbPluginKey = new PluginKey<BreadcrumbState>('breadcrumb')

/** 지금 상태 — 검사가 본다. */
export function breadcrumbState(state: EditorState): BreadcrumbState {
  return breadcrumbPluginKey.getState(state) ?? { trail: null, set: DecorationSet.empty }
}

/** 노드 뷰가 받은 데코레이션에서 경로를 꺼낸다 — 데코레이션이 없으면 undefined, 경로를 아직 모르면 null. */
export function breadcrumbFrom(decorations: readonly Decoration[]): BreadcrumbTrail | null | undefined {
  for (const decoration of decorations) {
    const spec = decoration.spec as Partial<BreadcrumbDecorationSpec> | undefined
    if (spec !== undefined && 'breadcrumb' in spec) return spec.breadcrumb ?? null
  }
  return undefined
}

/** 경로를 넣는 트랜잭션 — 화면이 서버에서 새 경로를 받았을 때. */
export function setBreadcrumbTrail(tr: Transaction, trail: BreadcrumbTrail | null): Transaction {
  return tr.setMeta(breadcrumbPluginKey, { trail } satisfies BreadcrumbMeta)
}

function decorate(doc: PmNode, trail: BreadcrumbTrail | null): DecorationSet {
  const decorations: Decoration[] = []
  const spec: BreadcrumbDecorationSpec = { breadcrumb: trail }
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'blockGroup') return true
    if (name !== 'blockContainer') return false
    const content = node.firstChild
    if (content !== null && blockTypeOfNode(content.type.name) === BREADCRUMB_TYPE) {
      decorations.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, {}, spec))
    }
    return true
  })
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations)
}

/** breadcrumb. 편집 플러그인 목록에 든다(`create-editor.ts`). `initial` 은 편집기를 만들 때의 경로. */
export function breadcrumbPlugin(initial: () => BreadcrumbTrail | null = () => null): Plugin<BreadcrumbState> {
  return new Plugin<BreadcrumbState>({
    key: breadcrumbPluginKey,
    state: {
      init: (_config, state) => {
        const trail = initial()
        return { trail, set: decorate(state.doc, trail) }
      },
      apply(tr, prev) {
        const meta = tr.getMeta(breadcrumbPluginKey) as BreadcrumbMeta | undefined
        const trail = meta === undefined || sameTrail(meta.trail, prev.trail) ? prev.trail : meta.trail
        if (!tr.docChanged && trail === prev.trail) return prev
        // 문서가 바뀌면 새로 짓는다 — 루트 교체에도 남는다(8a-3 이 정한 것). 경로가 같으면 spec 의 값이 같아 노드 뷰가 불리지 않는다.
        return { trail, set: decorate(tr.doc, trail) }
      },
    },
    props: {
      decorations: (state) => breadcrumbState(state).set,
    },
  })
}
