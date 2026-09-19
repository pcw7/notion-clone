/**
 * 코멘트가 달린 글자에 하이라이트를 그린다 — F-05-07 (코멘트 4b조각)
 *
 * 정본: 05-collaboration-sync.md F-05-07 — *"입력창이 열리고 코멘트를 작성하면 해당 텍스트에 하이라이트가 남는다"*,
 *       엣지 케이스 *"두 스레드가 겹치는 범위 → 하이라이트 중첩 렌더"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 데코레이션으로 그린다 — DOM 에 직접 달지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 편집기 DOM 에 속성 · 클래스를 직접 달면 ProseMirror 가 다시 그리며 지우고 선택까지 새로 만든다(HANDOFF §6 — 실제로
 * 당했다). 데코레이션은 문서의 일부가 아니라 **그리기 지시**라 Y.Doc 에도 로그에도 남지 않는다 — 하이라이트는 본문이
 * 아니라 코멘트의 것이기 때문에 그것이 맞다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자리는 **문서가 바뀔 때마다 Y.Doc 에 다시 묻는다**
 * ──────────────────────────────────────────────────────────────────────
 *
 * 앵커는 Yjs 상대 위치라 Y.Doc 만 풀 수 있다(`anchor.ts`). 처음에는 한 번만 풀고 그 뒤는 `DecorationSet.map` 으로
 * 따라가려 했는데 — **원격 편집에서 하이라이트가 통째로 사라졌다**(검사가 잡았다). y-prosemirror 는 원격 변경을
 * 자리 고치기가 아니라 루트 교체(`tr.replace` 의 Fitter)로 쓰는 일이 있고, 그러면 그 범위의 데코레이션이 지워진다
 * (HANDOFF §3.3-92 가 경고한 "바인딩의 다른 경로").
 *
 * 그래서 문서가 바뀔 때마다 다시 푼다. 재어 보니 그럴 만했다 — `bodyView` 가 200블록에서 **0.39ms**, 20블록에서
 * 0.018ms 다(진단). 스레드가 없으면 아예 돌지 않는다.
 *
 * 다시 푸는 자리는 **플러그인 뷰**다. 상태의 `apply` 에서 풀면 안 된다 — 내 편집은 ProseMirror 가 먼저 적용하고
 * y-prosemirror 가 **그 뒤에** Y.Doc 에 쓰므로, `apply` 시점의 Y.Doc 은 아직 옛 본문이다. 뷰의 `update` 는 그 쓰기
 * 뒤에 돌아 내 편집 · 원격 편집 모두에서 Y.Doc 이 최신이다.
 *
 * 길이 0 이 된 하이라이트는 그리지 않는다(고아는 패널이 원문 스냅샷으로 보여 준다, §3.3-129).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type * as Y from 'yjs'

import { bodyView, resolveTextRangeAnchor, type TextRangeAnchor } from './anchor.ts'

/** 하이라이트가 붙는 클래스. `editor.css` 가 그린다. */
export const HIGHLIGHT_CLASS = 'blk-comment'

export type AnchoredThread = {
  readonly discussionId: string
  readonly blockId: string
  readonly anchor: TextRangeAnchor
}

type HighlightState = {
  readonly threads: readonly AnchoredThread[]
  readonly set: DecorationSet
}

type HighlightMeta = {
  readonly threads?: readonly AnchoredThread[]
  readonly draw?: readonly Decoration[]
}

export const commentHighlightKey = new PluginKey<HighlightState>('commentHighlight')

/** 지금 그려진 하이라이트 — 검사가 본다. */
export function drawnHighlights(state: { plugins: unknown }): DecorationSet {
  return commentHighlightKey.getState(state as never)?.set ?? DecorationSet.empty
}

/** 블록 안 오프셋 → 문서 위치. 블록이 문서에 없으면 null. */
function rangeInDoc(doc: PmNode, blockId: string, start: number, end: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name !== 'blockContainer' || String(node.attrs.blockId ?? '') !== blockId) return true
    // 컨테이너 앞이 `pos` → 내용 노드 앞이 `pos + 1` → 글자의 시작이 `pos + 2`(`anchor.ts` 와 같은 셈).
    const first = pos + 2
    const last = pos + 1 + node.child(0).nodeSize - 1
    // **마지막 방어다.** `resolveTextRangeAnchor` 가 이미 그 블록 안인지 보고 주므로 여기까지 오는 값은 범위 안이다
    // (반사실로 확인했다 — 이 줄을 빼도 실패하는 검사가 없다). 그래도 둔다: 범위를 벗어난 위치로
    // `DecorationSet.create` 를 부르면 **편집기가 통째로 던진다**. 그리기가 편집을 막는 것보다 안 그리는 것이 낫다.
    if (first + end > last) return false
    found = { from: first + start, to: first + end }
    return false
  })
  return found
}

/**
 * 지금 풀리는 스레드들의 하이라이트.
 *
 * 풀리지 않거나(그 글자가 없다) 길이가 0 인 스레드는 빠진다 — 본문에 그릴 자리가 없다.
 * 겹치는 범위는 데코레이션 둘로 남는다(05 F-05-07 의 "중첩 렌더").
 */
export function commentDecorations(doc: PmNode, ydoc: Y.Doc, threads: readonly AnchoredThread[]): Decoration[] {
  if (threads.length === 0) return []
  // 본문 변환은 한 번만 한다 — 스레드마다 하면 스레드 수만큼 문서를 펼친다.
  const view = bodyView(ydoc)
  const out: Decoration[] = []
  for (const thread of threads) {
    const range = resolveTextRangeAnchor(ydoc, thread.blockId, thread.anchor, view)
    if (range === null || range.start === range.end) continue
    const at = rangeInDoc(doc, thread.blockId, range.start, range.end)
    if (at === null) continue
    out.push(
      Decoration.inline(
        at.from,
        at.to,
        { class: HIGHLIGHT_CLASS, 'data-discussion-id': thread.discussionId },
        { discussionId: thread.discussionId },
      ),
    )
  }
  return out
}

export type HighlightOptions = {
  /** 앵커를 푸는 본문. 편집기가 붙어 있는 바로 그 Y.Doc 이어야 한다. */
  readonly ydoc: Y.Doc
  /** 하이라이트를 누르면 부른다 — 패널이 그 스레드를 연다. */
  readonly onOpen?: (discussionId: string) => void
}

type Dispatcher = {
  readonly state: EditorState
  dispatch(tr: Transaction): void
}

/**
 * 하이라이트 플러그인.
 *
 * 그릴 스레드는 밖에서 넣고(`setCommentThreads`), 그것을 **언제 다시 푸는가**는 여기가 안다(머리말).
 * 네트워크는 모른다 — 목록을 읽어 오는 것은 화면의 몫이다.
 */
export function commentHighlightPlugin(options: HighlightOptions): Plugin {
  return new Plugin({
    key: commentHighlightKey,
    state: {
      init: (): HighlightState => ({ threads: [], set: DecorationSet.empty }),
      apply(tr, value): HighlightState {
        const meta = tr.getMeta(commentHighlightKey) as HighlightMeta | undefined
        const threads = meta?.threads ?? value.threads
        if (meta?.draw !== undefined) return { threads, set: DecorationSet.create(tr.doc, [...meta.draw]) }
        // 다시 풀기 전까지의 한 프레임은 매핑으로 버틴다 — 내 편집에서는 이것만으로도 자리가 맞는다.
        return { threads, set: value.set.map(tr.mapping, tr.doc) }
      },
    },
    view(view) {
      /** 마지막으로 그린 (문서, 스레드 목록). 같은 것에 두 번 그리지 않는다 — 그리기가 또 트랜잭션이기 때문이다. */
      let drawnDoc: PmNode | null = null
      let drawnThreads: readonly AnchoredThread[] | null = null

      const redraw = (target: Dispatcher): void => {
        const value = commentHighlightKey.getState(target.state)
        if (value === undefined) return
        if (drawnDoc === target.state.doc && drawnThreads === value.threads) return
        drawnDoc = target.state.doc
        drawnThreads = value.threads
        const draw = commentDecorations(target.state.doc, options.ydoc, value.threads)
        target.dispatch(target.state.tr.setMeta(commentHighlightKey, { draw } satisfies HighlightMeta))
      }

      redraw(view as unknown as Dispatcher)
      return { update: (updated) => redraw(updated as unknown as Dispatcher) }
    },
    props: {
      decorations: (state) => commentHighlightKey.getState(state)?.set,
      handleClick(view, pos) {
        if (options.onOpen === undefined) return false
        const hit = commentHighlightKey.getState(view.state)?.set.find(pos, pos).at(-1)
        const id = (hit?.spec as { discussionId?: string } | undefined)?.discussionId
        if (id === undefined) return false
        options.onOpen(id)
        // 캐럿은 그대로 둔다 — 하이라이트를 눌러도 글을 계속 쓸 수 있어야 한다.
        return false
      },
    },
  })
}

/** 그릴 스레드를 넣는다. 문서를 바꾸지 않는 트랜잭션이라 Y.Doc 에 아무것도 쓰지 않는다. */
export function setCommentThreads(view: Dispatcher, threads: readonly AnchoredThread[]): void {
  view.dispatch(view.state.tr.setMeta(commentHighlightKey, { threads } satisfies HighlightMeta))
}
