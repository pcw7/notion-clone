/**
 * 공개 API 의 rich text — 우리 런 ↔ 노션 `rich_text` (API-2 · F-09-01 · F-09-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ (노션 API `2025-09-03` 의 모양) · `contracts/rich-text.ts`(우리 런은 이미 노션의 모양이다)
 *
 * 내보내기 — 저장된 런을 거의 그대로 준다. 다른 것은 셋:
 *   · `href` 는 파생값이라 다시 계산한다(글자 런은 링크 주소 · 페이지 멘션은 앱의 페이지 주소)
 *   · 사람 멘션은 노션처럼 `user: {object:'user', id}`
 *   · 멘션의 `plain_text` 는 저장된 것 그대로다 — 이름 · 제목을 싣지 않는다(저장하지 않는 값이다 · `contracts/rich-text.ts` 멘션 절)
 *
 * 받기 — 노션의 요청 모양(`type` 생략 · `annotations` 일부만 · `plain_text` · `href` 없음)을 우리 런으로 채운다. **엄격하게** — 틀리면 그
 * 자리를 영어로 말한다(노션의 `body failed validation` 말투). 받는 것: 글자(링크 포함) · 수식 · 사람 멘션 · 페이지 멘션. 그 밖의 멘션(날짜 ·
 * 데이터베이스 · 링크 미리보기 …)은 `validation_error`(우리 칸이 그리지 않는다).
 */

import {
  DEFAULT_ANNOTATIONS,
  MAX_EQUATION,
  MAX_LINK_URL,
  MAX_RICH_TEXT_RUNS,
  MAX_RUN_CONTENT,
  equationRun,
  isColor,
  normalizeRichText,
  pageMentionRun,
  userMentionRun,
  validateRichText,
  type Annotations,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import { canonicalizeRuns } from '../editor/rich-text-ops.ts'
import { parseApiId, shownValue } from './v1-protocol.ts'

/** 노션의 rich text 객체(응답). */
export type ApiRichText = {
  readonly type: 'text' | 'mention' | 'equation'
  readonly text?: { readonly content: string; readonly link: { readonly url: string } | null }
  readonly mention?: Readonly<Record<string, unknown>>
  readonly equation?: { readonly expression: string }
  readonly annotations: Annotations
  readonly plain_text: string
  readonly href: string | null
}

/**
 * 응답이 앱의 주소를 만드는 길 — 앱의 출처(게시 주소 · 다음 쪽 주소) · 페이지 멘션의 `href` · 페이지의 `url` · 올린 파일의 서명 주소
 * (API-7 · `file-url.ts` — 노션의 `file: {url, expiry_time}`).
 */
export type ApiLinks = {
  readonly origin: string
  readonly pageUrl: (pageId: string) => string
  readonly fileUrl: (fileId: string) => { readonly url: string; readonly expiry_time: string }
}

const FLAGS = ['bold', 'italic', 'strikethrough', 'underline', 'code'] as const

function annotationsOf(raw: unknown): Annotations {
  const a = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: Annotations = { ...DEFAULT_ANNOTATIONS }
  for (const flag of FLAGS) if (typeof a[flag] === 'boolean') out[flag] = a[flag] as boolean
  if (isColor(a.color)) out.color = a.color
  return out
}

/** 저장된 런 → 노션의 rich text. 읽기는 관대하게 — 모양이 틀린 런은 그 글자만 남긴다(`plain_text`). */
export function toApiRichText(runs: readonly RichTextRun[], links: ApiLinks): ApiRichText[] {
  const out: ApiRichText[] = []
  for (const run of runs) {
    if (typeof run !== 'object' || run === null) continue
    const annotations = annotationsOf(run.annotations)
    const plain = typeof run.plain_text === 'string' ? run.plain_text : ''
    if (run.type === 'equation' && typeof run.equation?.expression === 'string') {
      out.push({ type: 'equation', equation: { expression: run.equation.expression }, annotations, plain_text: run.equation.expression, href: null })
      continue
    }
    if (run.type === 'mention' && typeof run.mention === 'object' && run.mention !== null) {
      const m = run.mention as { type?: unknown; user?: { id?: unknown }; page?: { id?: unknown } }
      if (m.type === 'user' && typeof m.user?.id === 'string') {
        out.push({ type: 'mention', mention: { type: 'user', user: { object: 'user', id: m.user.id } }, annotations, plain_text: plain, href: null })
      } else if (m.type === 'page' && typeof m.page?.id === 'string') {
        out.push({ type: 'mention', mention: { type: 'page', page: { id: m.page.id } }, annotations, plain_text: plain, href: links.pageUrl(m.page.id) })
      } else {
        out.push({ type: 'mention', mention: { ...run.mention }, annotations, plain_text: plain, href: null })
      }
      continue
    }
    const content = typeof run.text?.content === 'string' ? run.text.content : plain
    const url = typeof run.text?.link?.url === 'string' ? run.text.link.url : null
    out.push({ type: 'text', text: { content, link: url === null ? null : { url } }, annotations, plain_text: content, href: url })
  }
  return out
}

export type RichTextParse = { readonly ok: true; readonly runs: RichTextRun[] } | { readonly ok: false; readonly message: string }

const bad = (message: string): RichTextParse => ({ ok: false, message })

/** 받은 `annotations` — 일부만 와도 된다(나머지는 기본). 틀린 값은 그 자리를 말한다. */
function parseAnnotations(raw: unknown, path: string): Annotations | string {
  if (raw === undefined || raw === null) return { ...DEFAULT_ANNOTATIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return `${path} should be an object, instead was ${shownValue(raw)}.`
  const a = raw as Record<string, unknown>
  const out: Annotations = { ...DEFAULT_ANNOTATIONS }
  for (const flag of FLAGS) {
    if (a[flag] === undefined) continue
    if (typeof a[flag] !== 'boolean') return `${path}.${flag} should be a boolean, instead was ${shownValue(a[flag])}.`
    out[flag] = a[flag] as boolean
  }
  if (a.color !== undefined) {
    if (!isColor(a.color)) return `${path}.color should be a valid color, instead was ${shownValue(a.color)}.`
    out.color = a.color
  }
  return out
}

/** 런 하나의 종류 — `type` 이 없으면 있는 키로 고른다(노션의 요청이 그렇다). */
function kindOf(item: Record<string, unknown>): unknown {
  if (item.type !== undefined) return item.type
  if ('text' in item) return 'text'
  if ('mention' in item) return 'mention'
  if ('equation' in item) return 'equation'
  return undefined
}

/**
 * 노션의 rich text 배열(요청) → 우리 런. 빈 배열은 "비운다" 다. 이웃한 같은 서식의 글자 런은 합친다(`normalizeRichText` — 노션도 합쳐
 * 돌려줄 수 있다). `path` 는 오류 글의 자리(`body.properties.Name.title`).
 */
export function parseApiRichText(raw: unknown, path: string): RichTextParse {
  if (!Array.isArray(raw)) return bad(`${path} should be an array, instead was ${shownValue(raw)}.`)
  if (raw.length > MAX_RICH_TEXT_RUNS) return bad(`${path} should have at most ${MAX_RICH_TEXT_RUNS} items, instead had ${raw.length}.`)
  const runs: RichTextRun[] = []
  for (const [i, value] of raw.entries()) {
    const at = `${path}[${i}]`
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad(`${at} should be an object, instead was ${shownValue(value)}.`)
    const item = value as Record<string, unknown>
    const annotations = parseAnnotations(item.annotations, `${at}.annotations`)
    if (typeof annotations === 'string') return bad(annotations)
    const kind = kindOf(item)

    if (kind === 'text') {
      const text = item.text as Record<string, unknown> | undefined
      if (typeof text !== 'object' || text === null) return bad(`${at}.text should be defined, instead was ${shownValue(text)}.`)
      if (typeof text.content !== 'string') return bad(`${at}.text.content should be a string, instead was ${shownValue(text.content)}.`)
      if (text.content.length > MAX_RUN_CONTENT) {
        return bad(`${at}.text.content.length should be ≤ ${MAX_RUN_CONTENT}, instead was ${text.content.length}.`)
      }
      let link: { url: string } | null = null
      if (text.link !== undefined && text.link !== null) {
        const url = (text.link as { url?: unknown }).url
        if (typeof url !== 'string' || url.trim() === '') return bad(`${at}.text.link.url should be a string, instead was ${shownValue(url)}.`)
        if (url.length > MAX_LINK_URL) return bad(`${at}.text.link.url.length should be ≤ ${MAX_LINK_URL}, instead was ${url.length}.`)
        link = { url }
      }
      runs.push({ type: 'text', annotations, plain_text: text.content, href: link?.url ?? null, text: { content: text.content, link } })
      continue
    }

    if (kind === 'equation') {
      const expression = (item.equation as { expression?: unknown } | undefined)?.expression
      if (typeof expression !== 'string') return bad(`${at}.equation.expression should be a string, instead was ${shownValue(expression)}.`)
      if (expression.length > MAX_EQUATION) return bad(`${at}.equation.expression.length should be ≤ ${MAX_EQUATION}, instead was ${expression.length}.`)
      runs.push(equationRun(expression, annotations))
      continue
    }

    if (kind === 'mention') {
      const mention = item.mention as Record<string, unknown> | undefined
      if (typeof mention !== 'object' || mention === null) return bad(`${at}.mention should be defined, instead was ${shownValue(mention)}.`)
      const mentionKind = mention.type ?? ('user' in mention ? 'user' : 'page' in mention ? 'page' : undefined)
      if (mentionKind === 'user' || mentionKind === 'page') {
        const target = mention[mentionKind] as { id?: unknown } | undefined
        const id = parseApiId(target?.id)
        if (id === null) return bad(`${at}.mention.${mentionKind}.id should be a valid uuid, instead was ${shownValue(target?.id)}.`)
        runs.push(mentionKind === 'user' ? userMentionRun(id, annotations) : pageMentionRun(id, annotations))
        continue
      }
      return bad(`${at}.mention.type ${shownValue(mentionKind)} is not supported. Use "user" or "page".`)
    }

    return bad(`${at}.type should be "text", "mention" or "equation", instead was ${shownValue(item.type)}.`)
  }
  // 합친 뒤 2000자 단위로 다시 쪼갠다(`canonicalizeRuns`) — 노션은 긴 글을 2000자 조각 여럿으로 보내라고 한다. 합치기만 하면 같은
  // 서식의 조각들이 2000자를 넘는 런 하나가 되어 아래 검사가 거부했다(API-3 이 찾았다).
  const normalized = canonicalizeRuns(normalizeRichText(runs))
  // 마지막 방어 — 위에서 만든 런이 계약을 어기면 우리의 잘못이다(던지지 않고 거부한다)
  const issues = validateRichText(normalized, path)
  return issues.length === 0 ? { ok: true, runs: normalized } : bad(`${issues[0].path} is invalid.`)
}
