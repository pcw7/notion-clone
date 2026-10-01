/**
 * 목차에 헤딩을 싣는다 — 노드 데코레이션 (잔여 묶음 8b-1 · F-01-16 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 목차 — 내용은 저장하지 않고 그릴 때 계산한다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 데코레이션인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 목차는 **다른 블록**(헤딩)이 바뀌면 다시 그려야 한다. 그런데 노드 뷰는 자기 노드나 자기 데코레이션이 바뀔 때만 불린다.
 * 그래서 이 플러그인이 문서가 바뀔 때마다 헤딩을 모아 **목차 노드마다 노드 데코레이션**을 달고, 그 `spec` 에 목록을 싣는다.
 * PM 은 노드 데코레이션의 `spec` 을 값의 동일성으로 견주므로(`compareObjs`) — **헤딩이 그대로면 지난 목록 객체를 다시 넘겨**
 * 노드 뷰가 불리지 않는다. 헤딩이 바뀌면 새 목록 → 데코레이션이 달라져 PM 이 노드 뷰의 `update` 를 부른다(`toc-view.ts`).
 * 데코레이션의 속성은 비어 있다 — DOM 에는 아무것도 달지 않는다(편집기 DOM 에 직접 다는 것의 함정 · HANDOFF §6).
 *
 * 집합은 문서가 바뀔 때마다 새로 짓는다 — y-prosemirror 의 루트 교체에도 남는다(8a-3 이 정한 것). 목차가 없는 문서에서는
 * 헤딩의 글자를 읽지도 않는다(트랜잭션마다 도는 자리다). 읽은 헤딩의 런은 노드 객체로 기억한다 — 고치지 않은 헤딩은 다시
 * 옮기지 않는다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { TOC_TYPE, headingLevelOf, tocEntries, type TocEntry, type TocHeading } from '../block/toc.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import { mentionDisplay, mentionTargetOf, type MentionKind } from './mention-label.ts'
import { inlineToRuns } from './pm-adapter.ts'
import { blockTypeOfNode } from './schema.ts'

export type TocState = {
  /** 지금 목차가 보일 줄 — 목차가 없는 문서면 빈 배열. 바뀌지 않았으면 같은 객체다. */
  readonly entries: readonly TocEntry[]
  readonly set: DecorationSet
}

/** 목차 노드 데코레이션의 spec — 노드 뷰가 읽는다. */
export type TocDecorationSpec = { readonly toc: readonly TocEntry[] }

export const tocPluginKey = new PluginKey<TocState>('toc')

const EMPTY: TocState = { entries: [], set: DecorationSet.empty }

/** 지금 상태 — 검사가 본다. */
export function tocState(state: EditorState): TocState {
  return tocPluginKey.getState(state) ?? EMPTY
}

/** 노드 뷰가 받은 데코레이션에서 목록을 꺼낸다 — 없으면 null. */
export function tocEntriesFrom(decorations: readonly Decoration[]): readonly TocEntry[] | null {
  for (const decoration of decorations) {
    const toc = (decoration.spec as Partial<TocDecorationSpec> | undefined)?.toc
    if (toc !== undefined) return toc
  }
  return null
}

/**
 * 목차 한 줄의 글자 — 헤딩의 런을 평문으로. 멘션은 칩과 같은 글자(`mention-label.ts` — 이름은 노드에 없어 `mentionLabel` 로 찾는다),
 * 수식은 식 그대로. 줄바꿈은 공백으로 접는다(목차는 한 줄씩이다).
 */
export function tocEntryText(
  title: readonly RichTextRun[],
  mentionLabel: (kind: MentionKind, id: string) => string | null | undefined,
): string {
  let out = ''
  for (const run of title) {
    if (run.type === 'mention') {
      const target = mentionTargetOf(run.mention)
      out += target === null ? (run.plain_text ?? '') : mentionDisplay(target.kind, mentionLabel(target.kind, target.id)).text
    } else if (run.type === 'equation') {
      out += typeof run.equation?.expression === 'string' ? run.equation.expression : ''
    } else {
      out += run.plain_text ?? ''
    }
  }
  return out.replace(/\s*\n\s*/g, ' ').trim()
}

/** 헤딩 내용 노드 → 런. 노드는 불변이라 같은 객체면 같은 런이다. */
const runsOfNode = new WeakMap<PmNode, readonly RichTextRun[]>()
function titleOf(content: PmNode): readonly RichTextRun[] {
  let runs = runsOfNode.get(content)
  if (runs === undefined) {
    runs = inlineToRuns(content.content)
    runsOfNode.set(content, runs)
  }
  return runs
}

/** 같은 줄들인가 — 런은 협업 참여자가 쓴 값에서 왔으니 던지지 않는 비교로. */
function sameEntries(a: readonly TocEntry[], b: readonly TocEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].level !== b[i].level || a[i].depth !== b[i].depth) return false
    if (a[i].title !== b[i].title && !sameJsonValue(a[i].title, b[i].title)) return false
  }
  return true
}

function build(doc: PmNode, prev: TocState): TocState {
  const headings: { readonly id: string; readonly level: 1 | 2 | 3; readonly content: PmNode }[] = []
  const tocs: { readonly pos: number; readonly node: PmNode }[] = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'blockGroup') return true
    if (name !== 'blockContainer') return false
    const content = node.firstChild
    if (content !== null) {
      const type = blockTypeOfNode(content.type.name)
      const level = headingLevelOf(type)
      if (level !== null) headings.push({ id: String(node.attrs.blockId ?? ''), level, content })
      else if (type === TOC_TYPE) tocs.push({ pos: pos + 1, node: content })
    }
    return true
  })
  if (tocs.length === 0) return prev.entries.length === 0 && prev.set === DecorationSet.empty ? prev : EMPTY

  const fresh = tocEntries(headings.map((h): TocHeading => ({ id: h.id, level: h.level, title: titleOf(h.content) })))
  const entries = sameEntries(fresh, prev.entries) ? prev.entries : fresh
  const spec: TocDecorationSpec = { toc: entries }
  return {
    entries,
    set: DecorationSet.create(doc, tocs.map(({ pos, node }) => Decoration.node(pos, pos + node.nodeSize, {}, spec))),
  }
}

/** 목차. 편집 플러그인 목록에 든다(`create-editor.ts`). */
export function tocPlugin(): Plugin<TocState> {
  return new Plugin<TocState>({
    key: tocPluginKey,
    state: {
      init: (_config, state) => build(state.doc, EMPTY),
      apply: (tr, prev) => (tr.docChanged ? build(tr.doc, prev) : prev),
    },
    props: {
      decorations: (state) => tocState(state).set,
    },
  })
}
