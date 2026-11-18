/**
 * AI 로 고치기 — 고른 글 읽기 · 바꿀 자리 다시 찾기 · 바꾸기 · 아래에 넣기 (AI-3 · F-10-02 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑥ · 10-ai-features.md F-10-02 엣지 케이스 표
 *
 * 이 파일은 창(`ai-edit-bar.tsx`)과 함께 지연 로드된다.
 *
 *   · **읽기**(`editSnapshot`) — 글 선택(TextSelection)이 걸친 글 블록. 한 블록 안이면 고른 조각만(인라인 마크다운 — 굵게 · 기울임 · 코드 ·
 *     링크) · 여러 블록이면 그 블록들을 통째로(블록마다 하나 · 종류 · 깊이 · 코드 언어 · 체크). **글이 아닌 블록**(이미지 · 표 · DB · 임베드 ·
 *     구분선 · 컬럼의 틀 …)은 싣지 않고 센다 — 하나라도 있으면 바꾸기를 하지 않는다(바꾸면 그 블록이 사라진다 · 아래에 넣기만)
 *   · **바꿀 자리 다시 찾기**(`locateEditTarget`) — ProseMirror 의 위치 매핑은 쓰지 않는다: 협업 바인딩(y-prosemirror)은 다른 사람의 변경을
 *     문서 전체를 갈아 끼우는 트랜잭션으로 들여와 매핑이 한 점으로 무너진다. 대신 **블록 id + 그때의 글**로 다시 찾는다 — 한 블록의 조각은
 *     그 자리의 글이 같으면 그 자리, 아니면 블록 안에서 그 글이 꼭 한 번 나올 때 그 자리(앞에 누가 글을 쳐 밀렸다). 블록들은 id 가 모두
 *     살아 있고 글이 같고 여전히 이어진 형제(고르지 않은 자식 · 글 아닌 블록 없이)일 때만. 아니면 null — 바꾸지 않는다(아래에 넣기로)
 *   · **바꾸기** — 한 블록의 조각은 그 범위만 인라인으로(마크다운 → 서식 · 블록 문법은 버리고 한 줄로 · 코드는 글 그대로) · 블록들은 그
 *     블록들을 결과 블록들로(가져오기의 변환 · 첫 블록의 id 를 지킨다). 둘 다 트랜잭션 하나 — Ctrl+Z 한 번에 원문이 돌아온다
 *   · **아래에 넣기**는 묻기와 같은 명령(`insertAiBlocksCommand` — 고른 마지막 블록 아래). 할 일 뽑기는 결과를 할 일 블록으로 고정한다
 */

import { Selection, TextSelection, type Command, type EditorState } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import type { EditBlock, EditBlockKind, EditPreset, EditSelection } from '../ai/edit-prompt.ts'
import { codeLanguageOf } from '../block/code.ts'
import { textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { aiAnswerBlocks } from './ai-insert.ts'
import { withFreshBlockIds } from './block-clipboard.ts'
import type { EditorBlock } from './document.ts'
import { containerFor, inlineToRuns, newBlockId, runsToInline } from './pm-adapter.ts'
import { blockTypeOf, describeContainer, findContainerById, isLayoutContainer, type ContainerInfo } from './pm-blocks.ts'
import { blockSchema, isPlainTextNode } from './schema.ts'

/** 글 블록의 종류 — 이 밖의 블록은 싣지 않는다. */
const KIND_OF: Readonly<Record<string, EditBlockKind>> = {
  paragraph: 'paragraph',
  heading_1: 'heading_1',
  heading_2: 'heading_2',
  heading_3: 'heading_3',
  bulleted_list_item: 'bulleted_list_item',
  numbered_list_item: 'numbered_list_item',
  to_do: 'to_do',
  toggle: 'toggle',
  quote: 'quote',
  callout: 'callout',
  code: 'code',
}

/** 인라인 원자(멘션 · 수식 · 줄바꿈)의 자리 — 글자 하나 = 위치 하나가 되게(대조용 지문). */
const OBJECT = '￼'

/** 내용 노드의 [from, to) 지문 — 글은 그대로 · 원자는 한 글자. 길이가 위치 수와 같다. */
const fingerprintOf = (content: PmNode, from = 0, to = content.content.size): string => content.textBetween(from, to, '\n', OBJECT)

export type EditTarget =
  | { readonly kind: 'inline'; readonly blockId: string; readonly start: number; readonly end: number; readonly fingerprint: string; readonly code: boolean }
  | { readonly kind: 'blocks'; readonly ids: readonly string[]; readonly fingerprints: readonly string[] }

export type EditSnapshot = {
  /** 서버에 보내는 고른 글. */
  readonly selection: EditSelection
  /** 바꿀 자리 — 바꾸기 직전에 다시 찾는다(`locateEditTarget`). */
  readonly target: EditTarget
  /** 싣지 않은 블록(글이 아닌 것)의 수. */
  readonly skipped: number
  /** 바꿀 수 있는 모양인가 — 글 아닌 블록이 없고, 블록들이면 이어진 형제다. */
  readonly replaceable: boolean
  /** 고른 마지막 글 블록 — 창이 그 아래에 서고 · 아래에 넣기가 그 아래에 넣는다. */
  readonly anchorId: string
  /** 보이는 글자 수(최소 길이 가드). */
  readonly chars: number
}

// ── 인라인 마크다운 ───────────────────────────────────────────────────

/** 런 → 인라인 마크다운(굵게 · 기울임 · 취소선 · 코드 · 링크만 — 보이는 그대로에 가깝게). 멘션 · 수식은 보이는 글자다. */
export function runsToEditMarkdown(runs: readonly RichTextRun[]): string {
  let out = ''
  for (const run of runs) {
    const content = run.type === 'text' ? (run.text?.content ?? '') : run.type === 'equation' ? (run.equation?.expression ?? '') : (run.plain_text ?? '')
    if (content === '') continue
    if (run.type !== 'text') {
      out += content
      continue
    }
    // 구분자 옆에 공백이 오면 마크다운이 서식으로 읽지 않는다 — 앞뒤 공백은 밖으로
    const lead = /^\s*/.exec(content)![0]
    const trail = content.length > lead.length ? /\s*$/.exec(content)![0] : ''
    let core = content.slice(lead.length, content.length - trail.length)
    if (core === '') {
      out += content
      continue
    }
    const a = run.annotations
    if (a.code) core = `\`${core}\``
    if (a.strikethrough) core = `~~${core}~~`
    if (a.italic) core = `*${core}*`
    if (a.bold) core = `**${core}**`
    const link = run.text?.link?.url ?? null
    if (link !== null) core = `[${core}](${link})`
    out += lead + core + trail
  }
  return out
}

// ── 읽기 ─────────────────────────────────────────────────────────────

type Covered = { readonly info: ContainerInfo; readonly level: number; readonly kind: EditBlockKind; readonly start: number; readonly end: number }

/** 컨테이너의 둥지 깊이 — 조상 컨테이너의 수. */
function levelOf(doc: PmNode, pos: number): number {
  const $pos = doc.resolve(pos)
  let n = 0
  for (let d = $pos.depth; d > 0; d -= 1) if ($pos.node(d).type.name === 'blockContainer') n += 1
  return n
}

function editBlockOf(c: Covered, depth: number, whole: boolean): EditBlock {
  const content = c.info.contentNode
  const from = whole ? 0 : c.start
  const to = whole ? content.content.size : c.end
  const code = c.kind === 'code' || isPlainTextNode(content)
  const props = (content.attrs.props ?? {}) as Record<string, unknown>
  return {
    kind: c.kind,
    text: code ? content.textBetween(from, to, '\n', '') : runsToEditMarkdown(inlineToRuns(content.content.cut(from, to))),
    depth,
    language: c.kind === 'code' ? codeLanguageOf(props) : null,
    checked: c.kind === 'to_do' && props.checked === true,
  }
}

/**
 * 지금 선택의 고른 글 — 글 선택이 아니거나 걸친 글 블록이 없으면 null. 한 블록에서 고른 글자가 있는 것만 걸친 것으로 본다(세 번 눌러 고른
 * 줄이 다음 블록의 머리에서 끝나도 그 블록은 들지 않는다 · 안에 통째로 든 빈 블록은 든다).
 */
export function editSnapshot(state: EditorState): EditSnapshot | null {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return null
  const { from, to } = sel
  const covered: Covered[] = []
  let skipped = 0
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    const info = describeContainer(node, pos)
    const content = info.contentNode
    const contentEnd = info.contentPos + content.nodeSize
    if (contentEnd <= from || info.contentPos >= to) return true // 조상의 내용 · 범위 밖
    const kind = KIND_OF[blockTypeOf(content)]
    if (kind === undefined || !content.isTextblock) {
      // 글이 아닌 블록 — 싣지 않는다. 컬럼의 틀은 안의 블록을 계속 본다
      skipped += 1
      return isLayoutContainer(node)
    }
    const s = Math.max(from, info.contentPos + 1)
    const e = Math.min(to, contentEnd - 1)
    const inside = info.contentPos >= from && contentEnd <= to
    if (e > s || inside) covered.push({ info, level: levelOf(state.doc, pos), kind, start: s - info.contentPos - 1, end: Math.max(s, e) - info.contentPos - 1 })
    return true
  })
  if (covered.length === 0) return null

  const last = covered.at(-1)!
  if (covered.length === 1 && skipped === 0) {
    const c = covered[0]!
    const block = editBlockOf(c, 0, false)
    return {
      selection: { inline: true, blocks: [block] },
      target: { kind: 'inline', blockId: c.info.id, start: c.start, end: c.end, fingerprint: fingerprintOf(c.info.contentNode, c.start, c.end), code: c.kind === 'code' },
      skipped,
      replaceable: true,
      anchorId: c.info.id,
      chars: block.text.trim().length,
    }
  }

  const top = Math.min(...covered.map((c) => c.level))
  const blocks = covered.map((c) => editBlockOf(c, c.level - top, true))
  const target: EditTarget = { kind: 'blocks', ids: covered.map((c) => c.info.id), fingerprints: covered.map((c) => fingerprintOf(c.info.contentNode)) }
  return {
    selection: { inline: false, blocks },
    target,
    skipped,
    replaceable: skipped === 0 && locateEditTarget(state.doc, target) !== null,
    anchorId: last.info.id,
    chars: blocks.reduce((n, b) => n + b.text.trim().length, 0),
  }
}

// ── 바꿀 자리 다시 찾기 ───────────────────────────────────────────────

/** 블록들의 바꿀 범위 — 고른 조상이 없는 것들이 한 부모의 이어진 형제이고, 그 범위의 컨테이너가 모두 고른 것일 때. */
function blocksSpan(doc: PmNode, infos: readonly ContainerInfo[]): { from: number; to: number } | null {
  const ids = new Set(infos.map((i) => i.id))
  const coveredAncestor = (pos: number): boolean => {
    const $pos = doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d -= 1) {
      const n = $pos.node(d)
      if (n.type.name === 'blockContainer' && ids.has(String(n.attrs.blockId ?? ''))) return true
    }
    return false
  }
  const tops = infos.filter((i) => !coveredAncestor(i.pos))
  if (tops.length === 0) return null
  const $first = doc.resolve(tops[0]!.pos)
  for (const [k, t] of tops.entries()) {
    const $t = doc.resolve(t.pos)
    if ($t.depth !== $first.depth || $t.start() !== $first.start() || $t.index() !== $first.index() + k) return null
  }
  const from = tops[0]!.pos
  const to = tops.at(-1)!.pos + tops.at(-1)!.node.nodeSize
  let clean = true
  doc.nodesBetween(from, to, (node, pos) => {
    if (!clean) return false
    if (pos >= from && node.type.name === 'blockContainer' && !ids.has(String(node.attrs.blockId ?? ''))) clean = false
    return clean
  })
  return clean ? { from, to } : null
}

/** 바꿀 자리를 지금 문서에서 다시 찾는다(머리말) — 고른 글이 바뀌었으면 null. */
export function locateEditTarget(doc: PmNode, target: EditTarget): { from: number; to: number } | null {
  if (target.kind === 'inline') {
    const info = findContainerById(doc, target.blockId)
    if (info === null || !info.contentNode.isTextblock) return null
    const content = info.contentNode
    const base = info.contentPos + 1
    if (target.end <= content.content.size && fingerprintOf(content, target.start, target.end) === target.fingerprint) {
      return { from: base + target.start, to: base + target.end }
    }
    const whole = fingerprintOf(content)
    const at = whole.indexOf(target.fingerprint)
    if (target.fingerprint === '' || at < 0 || whole.indexOf(target.fingerprint, at + 1) >= 0) return null
    return { from: base + at, to: base + at + target.fingerprint.length }
  }
  const infos: ContainerInfo[] = []
  for (const [i, id] of target.ids.entries()) {
    const info = findContainerById(doc, id)
    if (info === null || !info.contentNode.isTextblock || fingerprintOf(info.contentNode) !== target.fingerprints[i]) return null
    infos.push(info)
  }
  return blocksSpan(doc, infos)
}

// ── 결과 → 문서 ───────────────────────────────────────────────────────

/** 결과 → 블록. 할 일 뽑기는 할 일 블록만(글이 있는 블록을 할 일로 · 깊이는 펴서 · 코드는 뺀다). */
export function editAnswerBlocks(markdown: string, preset: EditPreset): readonly EditorBlock[] {
  const blocks = aiAnswerBlocks(markdown)
  if (preset !== 'action_items') return blocks
  const out: EditorBlock[] = []
  const walk = (list: readonly EditorBlock[]) => {
    for (const b of list) {
      const title = b.title ?? []
      if (b.type !== 'code' && toPlainText(title).trim() !== '') {
        out.push({ id: b.id, type: 'to_do', title, properties: { checked: b.type === 'to_do' && b.properties?.checked === true }, format: {}, children: [] })
      }
      walk(b.children ?? [])
    }
  }
  walk(blocks)
  return out
}

/** 결과 → 한 줄의 인라인 런 — 블록 문법은 버리고 블록들의 글을 공백으로 잇는다. */
export function inlineRunsOf(markdown: string): RichTextRun[] {
  const runs: RichTextRun[] = []
  const walk = (list: readonly EditorBlock[]) => {
    for (const b of list) {
      const title = b.title ?? []
      if (toPlainText(title).trim() !== '') {
        if (runs.length > 0) runs.push(textRun(' '))
        runs.push(...title)
      }
      walk(b.children ?? [])
    }
  }
  walk(aiAnswerBlocks(markdown))
  return runs
}

/** 코드의 결과 — 울타리로 감쌌으면 안만, 끝 줄바꿈은 뺀다. */
export function codeTextOf(markdown: string): string {
  const fenced = /^\s*(`{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(markdown)
  return (fenced ? fenced[2]! : markdown).replace(/\n+$/, '')
}

/**
 * 바꾸기 — 바꿀 자리를 다시 찾아(못 찾으면 false · 화면이 아래에 넣기를 권한다) 트랜잭션 하나로 바꾼다. 캐럿은 바꾼 글의 끝.
 *
 * @param newId 새 블록의 id(시험이 정한다) — 블록들을 바꿀 때 첫 블록은 고른 첫 블록의 id 를 지킨다
 */
export function replaceSelectionCommand(target: EditTarget, markdown: string, preset: EditPreset, newId: () => string = newBlockId): Command {
  return (state, dispatch) => {
    const at = locateEditTarget(state.doc, target)
    if (at === null) return false
    let nodes: readonly PmNode[]
    if (target.kind === 'inline') {
      if (target.code) {
        const text = codeTextOf(markdown)
        nodes = text === '' ? [] : [blockSchema.text(text)]
      } else {
        nodes = runsToInline(inlineRunsOf(markdown))
      }
    } else {
      const blocks = withFreshBlockIds(editAnswerBlocks(markdown, preset), newId)
      nodes = blocks.map((b, i) => containerFor(i === 0 ? { ...b, id: target.ids[0]! } : b))
    }
    if (nodes.length === 0) return false
    if (!dispatch) return true
    const size = nodes.reduce((n, node) => n + node.nodeSize, 0)
    const tr = state.tr.replaceWith(at.from, at.to, nodes)
    tr.setSelection(target.kind === 'inline' ? TextSelection.create(tr.doc, at.from + size) : Selection.near(tr.doc.resolve(at.from + size), -1))
    dispatch(tr.scrollIntoView())
    return true
  }
}
