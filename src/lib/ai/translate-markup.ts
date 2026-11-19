/**
 * 번역의 표지 — 한 블록의 rich text ↔ 번역에 보내는 글 (AI-4 · F-10-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑥ ⑨ · 10-ai-features.md F-10-03
 *
 * 서식 · 링크 · 멘션을 지키려고 런을 글로 바꿔 보낸다. 모델은 글만 옮기고 표지는 그대로 돌려준다:
 *
 *   서식 없는 글          그대로                     (번역한다)
 *   서식 · 링크가 있는 글  `<t3>굵은 글</t3>`         (번역한다 — 그 번호의 런의 서식 · 링크를 되돌린다 · 어순에 따라 자리를 옮겨도 된다)
 *   멘션 · 수식 · 인라인 코드  `⟦4⟧`                  (번역하지 않는다 — 원래 런을 그대로 되돌린다)
 *
 * 번호는 한 단위 안에서 1 부터 하나씩(꼬리표와 자리표가 한 줄의 번호를 함께 쓴다). 링크 주소 · 멘션 대상은 보내지 않는다 — 번호가 원래
 * 런을 가리킨다. 원문에 표지처럼 보이는 글(`<t1>` · `⟦` · `⟧`)이 있으면 그 조각은 자리표로 감싼다(번역하지 않는다 — 되돌릴 때 헷갈리지 않게).
 *
 * 되읽기는 엄격하다 — 보낸 번호가 모두 꼭 한 번씩 · 꼬리표는 겹치지 않고 닫힌다 · 모르는 번호 · 남은 표지 글자가 없다. 하나라도 어기면 null
 * (그 단위는 원문을 둔다 · 건너뜀으로 센다).
 */

import {
  DEFAULT_ANNOTATIONS,
  MAX_RICH_TEXT_RUNS,
  type Annotations,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import { canonicalizeRuns } from '../editor/rich-text-ops.ts'

/** 번호 → 원래 런. 꼬리표면 서식 · 링크의 원본, 자리표면 그대로 되돌릴 런. */
export type MarkupSlots = {
  readonly spans: ReadonlyMap<number, RichTextRun>
  readonly atoms: ReadonlyMap<number, RichTextRun>
}

export type UnitMarkup = { readonly text: string; readonly slots: MarkupSlots }

/** 원문 안의 표지처럼 보이는 글 — 자리표로 감싼다. */
const LITERAL = /<\s*\/?\s*t\s*\d+\s*>?|[⟦⟧]/gi

const isDefault = (a: Annotations): boolean =>
  !a.bold && !a.italic && !a.strikethrough && !a.underline && !a.code && (a.color ?? 'default') === 'default'

const contentOf = (run: RichTextRun): string => (run.type === 'text' ? (run.text?.content ?? run.plain_text ?? '') : '')

/** 같은 런의 다른 글 — 서식 · 링크는 그대로. */
function withText(run: RichTextRun, content: string): RichTextRun {
  return { ...run, plain_text: content, text: { content, link: run.text?.link ?? null } }
}

/** 런들을 보내는 글로. 번역할 글자(문자)가 하나도 없으면 `translatable` 이 false 다(보내지 않는다). */
export function runsToMarkup(runs: readonly RichTextRun[]): UnitMarkup & { readonly translatable: boolean } {
  const spans = new Map<number, RichTextRun>()
  const atoms = new Map<number, RichTextRun>()
  let next = 1
  let text = ''
  let words = ''
  const atom = (run: RichTextRun): string => {
    const n = next++
    atoms.set(n, run)
    return `⟦${n}⟧`
  }
  /** 글을 표지처럼 보이는 조각과 나머지로 — 조각은 같은 서식의 자리표. */
  const plain = (run: RichTextRun, content: string): string => {
    let out = ''
    let at = 0
    for (const m of content.matchAll(LITERAL)) {
      out += content.slice(at, m.index)
      words += content.slice(at, m.index)
      out += atom(withText(run, m[0]))
      at = m.index + m[0].length
    }
    out += content.slice(at)
    words += content.slice(at)
    return out
  }

  for (const run of runs) {
    if (run.type !== 'text') {
      text += atom(run)
      continue
    }
    const content = contentOf(run)
    if (content === '') continue
    const ann = run.annotations ?? DEFAULT_ANNOTATIONS
    const link = run.text?.link ?? null
    if (ann.code) {
      text += atom(run)
    } else if (isDefault(ann) && link === null) {
      text += plain(run, content)
    } else if (content.trim() === '') {
      // 서식만 있는 빈칸 — 모델이 지우기 쉽다
      text += atom(run)
    } else {
      const n = next++
      spans.set(n, run)
      text += `<t${n}>${plain(run, content)}</t${n}>`
    }
  }
  return { text, slots: { spans, atoms }, translatable: /\p{L}/u.test(words) }
}

const TOKEN = /<\s*t\s*(\d+)\s*>|<\s*\/\s*t\s*(\d+)\s*>|⟦\s*(\d+)\s*⟧/gi
/** 토큰을 뺀 글에 남으면 안 되는 표지 조각. */
const STRAY = /[⟦⟧]|<\s*\/?\s*t\s*\d/i

/**
 * 돌아온 글 → 런. 엄격하다(머리말) — 어기면 null.
 *
 * @param singleLine 제목 — 줄바꿈을 빈칸으로 접는다
 */
export function markupToRuns(text: string, slots: MarkupSlots, singleLine = false): RichTextRun[] | null {
  const out: RichTextRun[] = []
  const seen = new Set<number>()
  let open: RichTextRun | null = null
  let openId = 0
  let at = 0
  const push = (content: string): boolean => {
    if (content === '') return true
    if (STRAY.test(content)) return false
    const flat = singleLine ? content.replace(/\s*[\r\n]+\s*/g, ' ') : content
    out.push(open === null ? plainRun(flat) : withText(open, flat))
    return true
  }

  for (const m of text.matchAll(TOKEN)) {
    if (!push(text.slice(at, m.index))) return null
    at = m.index + m[0].length
    const [, openTag, closeTag, atomTag] = m
    if (openTag !== undefined) {
      const n = Number(openTag)
      const span = slots.spans.get(n)
      if (span === undefined || open !== null || seen.has(n)) return null
      seen.add(n)
      open = span
      openId = n
    } else if (closeTag !== undefined) {
      if (open === null || Number(closeTag) !== openId) return null
      open = null
    } else {
      const n = Number(atomTag)
      const run = slots.atoms.get(n)
      if (run === undefined || seen.has(n)) return null
      seen.add(n)
      out.push(run)
    }
  }
  if (!push(text.slice(at))) return null
  if (open !== null || seen.size !== slots.spans.size + slots.atoms.size) return null
  const runs = canonicalizeRuns(out)
  return runs.length > MAX_RICH_TEXT_RUNS ? null : runs
}

function plainRun(content: string): RichTextRun {
  return { type: 'text', annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: content, href: null, text: { content, link: null } }
}
