/**
 * 코드 블록의 문법 강조 — ProseMirror 데코레이션 (잔여 묶음 8a-3 · F-01-14)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 코드 블록 ① · ④ — 코드 본문은 서식 없는 평문 런이다. 강조는 **저장하지 않는다**
 *       01-block-editor.md F-01-14 엣지 케이스 *"대용량 — 10000줄 코드 붙여넣기 → 하이라이팅 가상화 또는 임계 초과 시 비활성"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 데코레이션으로 칠한다 — 문서에는 아무것도 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 코드 블록은 평문 노드(`code_block` · `text*` · 마크 없음)라 색을 마크로 넣을 수 없고, 넣어서도 안 된다 — 강조는 보는 사람의
 * 화면이지 본문이 아니다(Y.Doc · 로그 · 행에 남지 않는다). 편집기 DOM 에 직접 칠하면 PM 이 다시 그리며 지운다(HANDOFF §6).
 * 클래스는 highlight.js 의 이름(`hljs-keyword` …) 그대로이고 색은 `editor.css` 가 정한다. 같은 글자에 코멘트 하이라이트가 겹치면
 * PM 이 한 `span` 에 클래스를 합친다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 언제 다시 칠하는가 — 문서가 바뀌면 다시 짓고, 토큰은 기억한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 데코레이션 집합은 **문서가 바뀔 때마다 새로 짓는다** — 옛 집합을 `map` 으로 따라가면 y-prosemirror 가 원격 변경을 루트 교체로 쓸 때
 * 그 범위의 데코레이션이 지워진다(코멘트 하이라이트가 겪었다 · `comment/highlight.ts` 머리말). 비싼 것은 토큰을 읽는 것이므로 블록마다
 * **(글자, 계획)이 같으면 지난 토큰을 그대로** 쓴다(`BlockMemo`) — 다른 블록을 고치면 이 블록은 다시 읽지 않는다.
 *
 * 글자가 바뀐 블록은 다시 읽는다. 단 **미룬다**:
 *   · 읽을 글자가 `SYNC_MAX_CHARS` 를 넘으면 — highlight.js 는 촘촘한 JS 100줄에 ~12ms 를 쓴다(8a-3 에서 쟀다 · 1만 줄 770ms). 글자를
 *     칠 때마다 그만큼 멈추지 않게, 지금은 옛 데코레이션을 따라 옮겨(`map`) 그리고 손을 멈춘 뒤(`REFRESH_DELAY_MS`) 다시 읽는다
 *   · 한글 조합 중이면 크기와 상관없이 — 조합하는 글자마다 다시 읽지 않고, 조합 중인 글자 둘레의 `span` 을 바꾸지 않으려고. 조합
 *     트랜잭션에는 PM 이 `composition` 메타를 단다. 뷰는 조합이 끝날 때까지 다시 읽기를 미룬다. ⚠ **증명하지 못한 방어** — PM 이
 *     조합 중인 텍스트 노드를 스스로 지켜서, 헤드리스(CDP 의 IME)에서는 이 미루기를 빼도 조합 중에 코드의 DOM 이 다시 그려지지
 *     않았다(8a-3 반사실 e4 · e5). 실제 IME 에서 조합이 끊기는 장면은 세우지 못했다
 * 옮긴 데코레이션이 루트 교체로 지워졌으면 그 블록은 다시 읽을 때까지 글자로 보인다(짧다 — 지우는 것보다 낫다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 큰 블록 — 보이는 줄만 칠한다(가상화)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `FULL_MAX_CHARS` 를 넘는 블록은 **보이는 줄 ± `WINDOW_MARGIN_LINES`** 만 칠한다. 데코레이션 수와 읽는 글자가 블록 크기와 상관없이
 * 묶인다(1만 줄을 다 칠하면 범위 12만 개 · `span` 12만 개). 창 앞의 `CONTEXT_LINES` 줄을 **함께 읽되 칠하지 않는다** — 창 위에서 시작한
 * 여러 줄 주석 · 문자열을 그 상태로 창을 읽게(그보다 멀리서 시작한 것은 틀릴 수 있다 · 받아들인다). 창 하나가 `WINDOW_MAX_CHARS`
 * 를 넘으면(한 줄이 수십만 자인 압축 코드) 여백을 버리고, 그래도 넘으면 칠하지 않는다(F-01-14 *"임계 초과 시 비활성"*).
 *
 * 보이는 줄은 뷰가 잰다(`visibleLinesOf` — 줄 머리의 화면 좌표를 이분 탐색 · 줄바꿈 켜짐에서도 맞다). 스크롤 · 크기 변화 · 갱신마다
 * 한 프레임에 한 번 재고, 보이는 줄이 칠한 줄 밖으로 나가면 메타 트랜잭션으로 알린다. 갱신마다 재는 것은 스크롤 없이 보이는 줄이 바뀌는
 * 경우(줄바꿈 토글 · scroll anchoring 이 없는 브라우저)를 위한 **증명하지 못한 방어**다 — 붙여넣기는 PM 의 scrollIntoView 가 스크롤
 * 이벤트를 내서 빼도 통과했다(8a-3 반사실 e8). 재기 전(처음 · 검사)에는 처음
 * `DEFAULT_WINDOW_LINES` 줄이 창이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 문법은 지연 로드 — 들어오면 다시 그린다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 상태의 `apply` 는 동기라 문법을 기다릴 수 없다. 준비되지 않은 문법은 `missing` 에 적고 칠하지 않는다. 뷰가 불러 들어오면 메타
 * 트랜잭션으로 다시 그리게 한다(`code-grammars.ts`). 불러오기에 실패한 문법은 이 세션에 칠하지 않는다(다시 조르지 않는다).
 *
 * 메타 트랜잭션은 문서를 바꾸지 않는다 — 읽기 전용 편집기에서도 보내도 된다(협업 바인딩이 쓸 것이 없다).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { codeLanguageOf } from '../block/code.ts'
import { grammarOf, grammarStatus, highlightTokens, loadGrammar, type TokenRange } from './code-grammars.ts'
import { isPlainTextNode } from './schema.ts'

/** 이만큼(읽을 글자)까지는 고칠 때마다 곧바로 다시 읽는다 — 촘촘한 JS 60줄쯤 · ~7ms. 넘으면 손을 멈춘 뒤에. */
export const SYNC_MAX_CHARS = 3_000
/** 이만큼까지의 블록은 통째로 칠한다 — 촘촘한 JS 400줄쯤 · 한 번에 ~35ms. 넘으면 보이는 줄만(창). */
export const FULL_MAX_CHARS = 20_000
/** 창 — 보이는 줄의 위아래로 더 칠하는 줄. 스크롤이 이만큼 가기 전에는 다시 읽지 않는다. */
export const WINDOW_MARGIN_LINES = 80
/** 창 하나가 칠하는 글자의 상한 — 넘으면 여백을 버리고, 그래도 넘으면 칠하지 않는다. */
export const WINDOW_MAX_CHARS = 20_000
/** 창 앞에서 함께 읽는(칠하지 않는) 줄 — 창 위에서 시작한 주석 · 문자열의 상태를 잇는다. */
export const CONTEXT_LINES = 100
/** 문맥으로 읽는 글자의 상한. */
export const CONTEXT_MAX_CHARS = 8_000
/** 뷰가 재기 전의 창 — 처음 이만큼의 줄. */
export const DEFAULT_WINDOW_LINES = 60
/** 미룬 블록을 다시 읽기까지 손을 멈춘 시간. */
export const REFRESH_DELAY_MS = 150

/** 줄 번호 둘 — 처음과 끝(둘 다 포함). */
export type Lines = readonly [number, number]

export type HighlightPlan = {
  /** 이것이 같고 글자가 같으면 지난 토큰을 쓴다. */
  readonly key: string
  /** 읽기 시작하는 오프셋(창 앞의 문맥). */
  readonly scanFrom: number
  /** 칠하는 범위 `[from, to)`. */
  readonly from: number
  readonly to: number
  /** 창이면 칠하는(칠하려던) 줄 — 뷰가 보이는 줄과 견준다. 통째면 null. */
  readonly lines: Lines | null
  /** 창 하나가 상한을 넘어 칠하지 않는다. */
  readonly skip: boolean
  /** 읽을 글자 수 — 곧바로 읽을지 미룰지를 가른다. */
  readonly cost: number
}

/** 지난 글자의 줄 머리 — 큰 블록은 글자를 칠 때마다 계획을 세우므로 같은 글자면 다시 세지 않는다. */
let lastLineStarts: { readonly text: string; readonly starts: readonly number[] } | null = null

/** 줄 머리의 오프셋들 — 첫 줄은 0, 나머지는 `\n` 다음. */
export function lineStartsOf(text: string): readonly number[] {
  if (lastLineStarts !== null && lastLineStarts.text === text) return lastLineStarts.starts
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  lastLineStarts = { text, starts }
  return starts
}

/** 오프셋 `offset` 이상에서 시작하는 첫 줄. */
function firstLineAtOrAfter(starts: readonly number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 한 블록을 어떻게 칠할지 — 작으면 통째로, 크면 보이는 줄(`seen` · 없으면 처음 `DEFAULT_WINDOW_LINES` 줄) ± 여백의 창과 그 앞의 문맥
 * (머리말 "큰 블록").
 */
export function planHighlight(text: string, grammar: string, seen?: Lines): HighlightPlan {
  if (text.length <= FULL_MAX_CHARS) {
    return { key: `${grammar}|all`, scanFrom: 0, from: 0, to: text.length, lines: null, skip: false, cost: text.length }
  }
  const starts = lineStartsOf(text)
  const last = starts.length - 1
  const clamp = (line: number): number => Math.min(Math.max(line, 0), last)
  const startOf = (line: number): number => starts[line]
  // 줄 끝의 줄바꿈까지 — 다음 줄 머리(마지막 줄은 글자 끝).
  const endOf = (line: number): number => (line === last ? text.length : starts[line + 1])
  const a = clamp(seen?.[0] ?? 0)
  const b = clamp(Math.max(a, seen?.[1] ?? DEFAULT_WINDOW_LINES - 1))
  let first = clamp(a - WINDOW_MARGIN_LINES)
  let end = clamp(b + WINDOW_MARGIN_LINES)
  if (endOf(end) - startOf(first) > WINDOW_MAX_CHARS) {
    first = a
    end = b
  }
  const skip = endOf(end) - startOf(first) > WINDOW_MAX_CHARS
  let context = clamp(first - CONTEXT_LINES)
  if (startOf(first) - startOf(context) > CONTEXT_MAX_CHARS) context = firstLineAtOrAfter(starts, startOf(first) - CONTEXT_MAX_CHARS)
  const scanFrom = startOf(context)
  return {
    key: `${grammar}|${context}|${first}|${end}${skip ? '|skip' : ''}`,
    scanFrom,
    from: startOf(first),
    to: endOf(end),
    lines: [first, end],
    skip,
    cost: skip ? 0 : endOf(end) - scanFrom,
  }
}

// ── 플러그인 상태 ─────────────────────────────────────────────────────

/** 블록 하나의 지난 토큰 — 그 글자 · 그 계획으로 읽었다. */
type BlockMemo = { readonly text: string; readonly key: string; readonly ranges: readonly TokenRange[] }

/** 창으로 칠하는 블록 — 뷰가 보이는 줄을 잴 때 쓴다. */
export type WindowedBlock = {
  readonly blockId: string
  /** 코드 글자의 첫 위치. */
  readonly contentStart: number
  readonly text: string
  /** 칠한(칠하려던) 줄. */
  readonly lines: Lines
}

export type CodeHighlightState = {
  readonly set: DecorationSet
  readonly memos: ReadonlyMap<string, BlockMemo>
  /** 뷰가 잰 보이는 줄(블록 id 마다). */
  readonly windows: ReadonlyMap<string, Lines>
  /** 다시 읽기를 미룬 블록 — 지금은 옮긴 데코레이션으로 그린다. */
  readonly stale: ReadonlySet<string>
  /** 불러와야 할 문법. */
  readonly missing: ReadonlySet<string>
  readonly windowed: readonly WindowedBlock[]
}

type HighlightMeta = {
  /** 뷰가 잰 보이는 줄. */
  readonly windows?: readonly (readonly [string, Lines])[]
  /** 미룬 블록을 지금 다시 읽는다. */
  readonly refresh?: true
  /** 문법이 들어왔다(또는 실패했다) — 다시 짓는다. */
  readonly loaded?: string
}

export const codeHighlightKey = new PluginKey<CodeHighlightState>('codeHighlight')

const EMPTY: CodeHighlightState = {
  set: DecorationSet.empty,
  memos: new Map(),
  windows: new Map(),
  stale: new Set(),
  missing: new Set(),
  windowed: [],
}

/** 지금 상태 — 검사 · 뷰가 본다. */
export function codeHighlightState(state: EditorState): CodeHighlightState {
  return codeHighlightKey.getState(state) ?? EMPTY
}

/** 코드 블록마다 — 내용 노드 · 글자의 첫 위치 · 컨테이너의 블록 id. 인라인 안으로는 들어가지 않는다(트랜잭션마다 도는 자리다). */
function forEachCodeBlock(doc: PmNode, visit: (node: PmNode, contentStart: number, blockId: string) => void): void {
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'blockGroup') return true
    if (name !== 'blockContainer') return false
    const content = node.firstChild
    // 컨테이너 앞이 `pos` → 내용 노드 앞이 `pos + 1` → 글자의 시작이 `pos + 2`. 평문 노드는 레지스트리의 칸으로 묻는다(타입 이름이 아니라).
    if (content !== null && isPlainTextNode(content)) visit(content, pos + 2, String(node.attrs.blockId ?? ''))
    return true
  })
}

type BuildInput = {
  readonly prev: CodeHighlightState
  readonly windows: ReadonlyMap<string, Lines>
  /** 문서가 바뀌었으면 그 매핑 — 미룬 블록의 옛 데코레이션을 옮긴다. */
  readonly mapping: Transaction['mapping'] | null
  readonly refresh: boolean
  readonly composing: boolean
}

function build(doc: PmNode, input: BuildInput): CodeHighlightState {
  const decorations: Decoration[] = []
  const memos = new Map<string, BlockMemo>()
  const windows = new Map<string, Lines>()
  const stale = new Set<string>()
  const missing = new Set<string>()
  const windowed: WindowedBlock[] = []
  let mapped: DecorationSet | null = null
  const mappedSet = (): DecorationSet => (mapped ??= input.mapping === null ? input.prev.set : input.prev.set.map(input.mapping, doc))

  forEachCodeBlock(doc, (node, contentStart, blockId) => {
    // props 는 Y attr 이라 무엇이든 될 수 있다(8a-2) — `codeLanguageOf` 는 `?.language` 만 읽고 문자열이 아니면 null 이다.
    const grammar = grammarOf(codeLanguageOf(node.attrs.props as Readonly<Record<string, unknown>> | undefined))
    if (grammar === null) return
    const status = grammarStatus(grammar)
    if (status === 'failed') return
    if (status !== 'ready') {
      missing.add(grammar)
      return
    }
    const text = node.textContent
    const seen = input.windows.get(blockId)
    if (seen !== undefined) windows.set(blockId, seen)
    const plan = planHighlight(text, grammar, seen)
    if (plan.lines !== null) windowed.push({ blockId, contentStart, text, lines: plan.lines })
    const old = input.prev.memos.get(blockId)
    if (old !== undefined && old.key === plan.key && old.text !== text && !input.refresh && (input.composing || plan.cost > SYNC_MAX_CHARS)) {
      // 미룬다 — 옛 데코레이션을 옮겨 그리고 뷰가 손을 멈춘 뒤 다시 읽게 한다(머리말).
      decorations.push(...mappedSet().find(contentStart, contentStart + node.content.size))
      memos.set(blockId, old)
      stale.add(blockId)
      return
    }
    const memo: BlockMemo =
      old !== undefined && old.key === plan.key && old.text === text
        ? old
        : { text, key: plan.key, ranges: plan.skip ? [] : highlightTokens(grammar, text, plan) }
    memos.set(blockId, memo)
    for (const range of memo.ranges) {
      decorations.push(Decoration.inline(contentStart + range.from, contentStart + range.to, { class: range.className }))
    }
  })

  return { set: DecorationSet.create(doc, decorations), memos, windows, stale, missing, windowed }
}

// ── 뷰 — 문법 불러오기 · 미룬 블록 · 보이는 줄 ─────────────────────────

/** `y` 보다 위(같음 포함)에서 시작하는 마지막 줄 — 없으면 0. 줄 머리의 화면 위치는 줄 번호를 따라 늘어난다. */
function lastLineStartingAtOrAbove(top: (line: number) => number, last: number, y: number): number {
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (top(mid) <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 창으로 칠하는 블록의 보이는 줄 — 화면(창의 높이) 안에 든 줄의 처음과 끝. 화면 밖이면 null. 줄 머리의 좌표를 이분 탐색한다 —
 * 줄바꿈이 켜져 한 줄이 여러 줄로 보여도 맞다.
 */
export function visibleLinesOf(view: EditorView, block: WindowedBlock): Lines | null {
  const starts = lineStartsOf(block.text)
  const last = starts.length - 1
  const top = (line: number): number => view.coordsAtPos(block.contentStart + starts[line]).top
  const height = window.innerHeight
  try {
    if (top(0) >= height) return null
    if (view.coordsAtPos(block.contentStart + block.text.length).bottom <= 0) return null
    return [lastLineStartingAtOrAbove(top, last, 0), lastLineStartingAtOrAbove(top, last, height - 1)]
  } catch {
    // 문서가 그 사이에 바뀌어 위치가 낡았다 — 다음 갱신이 다시 잰다.
    return null
  }
}

function highlightView(view: EditorView): { update: (view: EditorView, prev: EditorState) => void; destroy: () => void } {
  let destroyed = false
  let frame: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const requested = new Set<string>()
  // 화면이 없는 뷰(검사의 `headless` — `testing/collab-peers.ts`)도 플러그인 뷰를 만든다. 보이는 줄 재기만 건너뛰고, 문법 불러오기 ·
  // 미룬 다시 읽기는 그대로 한다.
  const screen = typeof window === 'undefined' ? null : window

  const send = (meta: HighlightMeta): void => {
    if (destroyed) return
    view.dispatch(view.state.tr.setMeta(codeHighlightKey, meta))
  }

  const measure = (): void => {
    frame = null
    if (destroyed) return
    const changes: [string, Lines][] = []
    for (const block of codeHighlightState(view.state).windowed) {
      const seen = visibleLinesOf(view, block)
      if (seen !== null && (seen[0] < block.lines[0] || seen[1] > block.lines[1])) changes.push([block.blockId, seen])
    }
    if (changes.length > 0) send({ windows: changes })
  }
  const schedule = (): void => {
    if (screen === null || frame !== null || destroyed || codeHighlightState(view.state).windowed.length === 0) return
    frame = screen.requestAnimationFrame(measure)
  }

  const refreshLater = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (destroyed) return
      // 조합 중이면 끝날 때까지 미룬다 — 조합 중인 글자 둘레를 다시 그리지 않게(머리말 · 증명하지 못한 방어).
      if (view.composing) refreshLater()
      else send({ refresh: true })
    }, REFRESH_DELAY_MS)
  }

  const sync = (prev: EditorState | null): void => {
    const state = codeHighlightState(view.state)
    for (const grammar of state.missing) {
      if (requested.has(grammar)) continue
      requested.add(grammar)
      // 실패해도 다시 짓는다 — 실패한 문법은 `missing` 에서 빠져 다시 조르지 않는다.
      const done = (): void => send({ loaded: grammar })
      loadGrammar(grammar).then(done, done)
    }
    // 미룬 블록 — 문서가 바뀔 때마다 기다림을 새로 시작한다(손을 멈춘 뒤). 선택만 바뀌면 그대로 둔다.
    if (state.stale.size > 0 && (timer === null || (prev !== null && prev.doc !== view.state.doc))) refreshLater()
    schedule()
  }

  screen?.addEventListener('scroll', schedule, { capture: true, passive: true })
  screen?.addEventListener('resize', schedule)
  sync(null)

  return {
    update: (_view, prev) => sync(prev),
    destroy() {
      destroyed = true
      if (frame !== null) screen?.cancelAnimationFrame(frame)
      if (timer !== null) clearTimeout(timer)
      screen?.removeEventListener('scroll', schedule, { capture: true })
      screen?.removeEventListener('resize', schedule)
    },
  }
}

/** 코드 블록의 문법 강조. 편집 플러그인 목록에 든다(`create-editor.ts` — 두 편집기가 같은 목록을 쓴다). */
export function codeHighlightPlugin(): Plugin<CodeHighlightState> {
  return new Plugin<CodeHighlightState>({
    key: codeHighlightKey,
    state: {
      init: (_config, state) => build(state.doc, { prev: EMPTY, windows: new Map(), mapping: null, refresh: false, composing: false }),
      apply(tr, prev) {
        const meta = tr.getMeta(codeHighlightKey) as HighlightMeta | undefined
        if (!tr.docChanged && meta === undefined) return prev
        let windows = prev.windows
        if (meta?.windows !== undefined) {
          const next = new Map(prev.windows)
          for (const [blockId, lines] of meta.windows) next.set(blockId, lines)
          windows = next
        }
        return build(tr.doc, {
          prev,
          windows,
          mapping: tr.docChanged ? tr.mapping : null,
          refresh: meta?.refresh === true,
          composing: tr.getMeta('composition') !== undefined,
        })
      },
    },
    props: {
      decorations: (state) => codeHighlightState(state).set,
    },
    view: highlightView,
  })
}
