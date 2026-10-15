/**
 * 페이지 안 찾기 — 편집기의 문서 모델에서 찾고 데코레이션으로 그린다 (플랫폼 잔여 10b · F-07-05)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 페이지 안 찾기
 *       07-search-navigation.md F-07-05 *"인덱스가 아니라 클라이언트 문서 모델이 대상"* · *"하이라이트는 decoration — DOM 에 직접 `<mark>` 을
 *       넣으면 편집 모델이 오염되고 undo 스택이 깨진다"*
 *
 * 서버를 묻지 않는다 — 협업 서버가 아직 받지 않은 글자도 찾는다. 문서 · Y.Doc · 되돌리기 기록에 아무것도 쓰지 않는다(상태는 플러그인의 것 ·
 * 바꾸는 것은 메타 트랜잭션뿐).
 *
 *   · 글자 블록마다 찾는다 — 블록을 넘는 매칭은 없다. 원자(멘션 · 이모지 · 인라인 수식 · 줄바꿈)는 한 칸의 자리표시(`ATOM`)라 매칭이 넘지 않는다.
 *     자리는 글자 블록의 내용 시작 + 글자 번호다(텍스트 노드의 크기는 글자 수, 원자는 1 — 둘을 이어 붙인 문자열의 번호가 곧 자리)
 *   · 대소문자를 가리지 않는다 — 소문자로 바꿔 길이가 달라지는 블록(`İ` 같은 글자)은 그대로 비교한다(번호가 어긋나지 않게)
 *   · 다른 사람이 고치면 다시 찾고, 지금 매칭은 옛 자리를 매핑해 그 뒤의 첫 매칭으로 옮긴다(07 *"전역 offset 이 아니라 앵커링"*)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** 매칭의 상한 — 카운터는 `1000+`. 데코레이션이 트랜잭션마다 다시 그려지는 자리다. */
export const MAX_FIND_MATCHES = 1000
/** 검색어의 상한 — 이보다 길면 자른다. */
export const MAX_FIND_QUERY = 200

/** 매칭의 클래스(`editor.css`). 지금 것은 둘 다. */
export const FIND_CLASS = 'blk-find'
export const FIND_CURRENT_CLASS = 'blk-find-current'

/** 원자 노드의 자리표시 — 검색어에 들어올 수 없는 글자(U+FFFC OBJECT REPLACEMENT CHARACTER). */
const ATOM = '￼'

export type FindMatch = { readonly from: number; readonly to: number }

export type FindState = {
  readonly query: string
  readonly matches: readonly FindMatch[]
  /** 지금 매칭의 번호 — 매칭이 없으면 -1. */
  readonly current: number
  readonly decorations: DecorationSet
}

type FindMeta = { readonly query: string; readonly near: number } | { readonly step: 1 | -1 }

export const findPluginKey = new PluginKey<FindState>('findInPage')

const EMPTY: FindState = { query: '', matches: [], current: -1, decorations: DecorationSet.empty }

/** 검색어를 다듬는다 — 상한으로 자르고 원자의 자리표시를 지운다(그 글자로는 아무것도 찾지 않는다). 공백은 그대로(찾는 말의 일부다). */
export function normalizeFindQuery(raw: string): string {
  return raw.slice(0, MAX_FIND_QUERY).split(ATOM).join('')
}

/** 이 문서에서 검색어의 매칭 — 문서 순서 · 겹치지 않게 · 상한까지. 빈 검색어는 없다. */
export function findMatches(doc: PmNode, rawQuery: string): FindMatch[] {
  const query = normalizeFindQuery(rawQuery)
  if (query === '') return []
  const lowerQuery = query.toLowerCase()
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_FIND_MATCHES) return false
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : ATOM.repeat(child.nodeSize)
    })
    const lowerText = text.toLowerCase()
    // 소문자로 바꿔 길이가 달라지면 번호가 어긋난다 — 그 블록은 그대로 비교한다
    const [haystack, needle] = lowerText.length === text.length ? [lowerText, lowerQuery] : [text, query]
    const start = pos + 1
    for (let at = haystack.indexOf(needle); at !== -1 && matches.length < MAX_FIND_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ from: start + at, to: start + at + needle.length })
    }
    return false
  })
  return matches
}

/** 자리 `near` 부터의 첫 매칭(캐럿 뒤) — 없으면 처음으로 돌아간다. 매칭이 없으면 -1. */
export function matchIndexFrom(matches: readonly FindMatch[], near: number): number {
  if (matches.length === 0) return -1
  const at = matches.findIndex((m) => m.from >= near)
  return at === -1 ? 0 : at
}

/** 다음 · 이전 — 끝에서 돌아 감는다. */
export function stepIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return step === 1 ? 0 : count - 1
  return (current + step + count) % count
}

/** 카운터 — 검색어가 없으면 빈 말 · 없으면 `0/0` · 상한이면 `n/1000+`. */
export function findCounter(state: Pick<FindState, 'query' | 'matches' | 'current'>): string {
  if (state.query === '') return ''
  const total = state.matches.length >= MAX_FIND_MATCHES ? `${MAX_FIND_MATCHES}+` : String(state.matches.length)
  return `${state.current + 1}/${total}`
}

/**
 * 이 자리를 숨기는 접힌 블록 — 자리가 그 블록의 **자식 묶음** 안에 있고 그 블록이 접혀 있으면. 자기 내용(토글의 제목 줄) 안이면 숨겨지지
 * 않았다. 바깥에서 안쪽 순.
 */
export function collapsedAncestorsAt(doc: PmNode, pos: number, isCollapsed: (blockId: string) => boolean): string[] {
  const $pos = doc.resolve(pos)
  const hidden: string[] = []
  for (let depth = 1; depth < $pos.depth; depth += 1) {
    const node = $pos.node(depth)
    if (node.type.name !== 'blockContainer') continue
    if ($pos.node(depth + 1).type.name !== 'blockGroup') continue
    const id = String(node.attrs.blockId ?? '')
    if (id !== '' && isCollapsed(id)) hidden.push(id)
  }
  return hidden
}

function decorate(doc: PmNode, matches: readonly FindMatch[], current: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? `${FIND_CLASS} ${FIND_CURRENT_CLASS}` : FIND_CLASS })),
  )
}

function stateFor(doc: PmNode, query: string, current: (matches: readonly FindMatch[]) => number): FindState {
  const matches = findMatches(doc, query)
  const index = current(matches)
  return { query, matches, current: index, decorations: decorate(doc, matches, index) }
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findPluginKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(findPluginKey) as FindMeta | undefined
        if (meta !== undefined && 'query' in meta) {
          const query = normalizeFindQuery(meta.query)
          return query === '' ? EMPTY : stateFor(tr.doc, query, (matches) => matchIndexFrom(matches, meta.near))
        }
        if (meta !== undefined && 'step' in meta) {
          const current = stepIndex(prev.current, prev.matches.length, meta.step)
          return { ...prev, current, decorations: decorate(tr.doc, prev.matches, current) }
        }
        if (prev.query === '' || !tr.docChanged) return prev
        // 문서가 바뀌었다(내 편집 · 남의 편집) — 다시 찾고, 지금 매칭은 옛 자리를 따라 옮긴다
        const anchor = prev.matches[prev.current]
        return stateFor(tr.doc, prev.query, (matches) => (anchor === undefined ? -1 : matchIndexFrom(matches, tr.mapping.map(anchor.from, -1))))
      },
    },
    props: {
      decorations: (state) => findPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  })
}

/** 지금 찾기 상태 — 플러그인이 없으면(다른 편집기) 빈 상태. */
export function findStateOf(state: EditorState): FindState {
  return findPluginKey.getState(state) ?? EMPTY
}

/** 검색어를 바꾼다 — 자리 `near`(보통 캐럿) 뒤의 첫 매칭이 지금 것. 빈 말이면 찾기를 끝낸다. */
export function setFindQuery(tr: Transaction, query: string, near = 0): Transaction {
  return tr.setMeta(findPluginKey, { query, near } satisfies FindMeta)
}

/** 다음(1) · 이전(-1) 매칭으로. */
export function stepFind(tr: Transaction, step: 1 | -1): Transaction {
  return tr.setMeta(findPluginKey, { step } satisfies FindMeta)
}
