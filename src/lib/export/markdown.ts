/**
 * 페이지 본문 → Markdown — F-09-14 (Markdown 익스포트) · F-09-22 (직렬화기)
 *
 * 정본: 09-api-integrations.md F-09-14 · F-09-22
 *       01-block-editor.md F-01-02 (enhanced markdown) · F-01-12 (색 내보내기)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 표준 트랙이다 — 노션 enhanced markdown 을 그대로 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 01 문서는 노션의 enhanced markdown(`<callout>` · `{color="…"}` · 탭 들여쓰기)을
 * *"그대로 채택하는 것이 가장 저렴하다"* 고 하고, 이 기능을 소유한 09 문서는
 * F-09-22 클론 대안에서 *"커스텀 태그를 만들지 말고 표준 문법을 채택해 기존 마크다운
 * 생태계 도구를 그대로 쓴다"* 고 한다. 소유 문서(09)를 따른다. 이유는 받는 쪽이다 —
 * 익스포트 파일을 여는 것은 우리 앱이 아니라 GitHub · 에디터 · 다른 노트 앱이고,
 * 그 도구들에서 `{color="red"}` 는 글자로, 탭 들여쓰기는 **코드 블록**으로 보인다.
 *
 * 그래서 CommonMark + GFM(취소선 · 할 일) 에, 모든 렌더러가 통과시키는 HTML 블록
 * 셋(`<details>` 토글 · `<aside>` 콜아웃 · `<u>` 밑줄)만 더한다. 노션 자신의 Markdown
 * 익스포트가 쓰는 모양과 같다(F-09-14: *"노션의 export ZIP 레이아웃을 그대로 채택"*).
 *
 * 표현할 수 없는 것은 버리되 **조용히 버리지 않는다.** `losses` 로 센다 —
 * F-09-14 가 가장 크게 경고한 실패가 *"백업이라 믿었는데 구멍이 있는 상태"* 이고,
 * 익스포트 보고서(`_export_report.json`)가 이 숫자를 싣는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 클립보드 평문(`plainTextForBlocks`)과 왜 따로인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 그쪽은 **사람이 평문 입력칸에 붙여 넣을 글자**라 이스케이프하지 않는다 — 메모장에
 * `\*` 가 보이면 안 된다. 이쪽은 **파서가 읽는 파일**이라 이스케이프하지 않으면 `*별*`
 * 이라고 쓴 글자가 기울임이 되고 `1. ` 로 시작한 문장이 목록이 된다. 계약이 다르다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 굵게를 `**` 로 쓸 수 없는 자리가 있다 (실측)
 * ──────────────────────────────────────────────────────────────────────
 *
 * CommonMark 의 강조 구분자는 양옆 글자로 여닫힘이 정해진다(flanking 규칙).
 * `**"인용"**입니다` 는 닫는 `**` 앞이 문장부호이고 뒤가 글자라 **닫히지 않는다** —
 * micromark 로 실측하면 별표가 그대로 보인다. 한국어는 조사가 붙어 이 모양이 흔하다.
 * 그런 자리에서만 `<strong>` 으로 떨어뜨린다. 늘 HTML 로 쓰면 안전하지만 파일을
 * 사람이 읽을 수 없게 되고, `**중요**합니다` 처럼 되는 자리까지 버릴 이유가 없다.
 *
 * DOM 도 DB 도 모른다. 링크를 어디로 걸지는 호출자(`MarkdownLinks`)가 정한다 —
 * 같은 페이지가 ZIP 안에서는 상대 경로, 범위 밖에서는 웹 주소가 되기 때문이다.
 */

import { readCaption, readImageSource, type ImageSource } from '../block/image.ts'
import { PAGE_TYPE, UNSUPPORTED_TYPE } from '../block/types.ts'
import {
  DEFAULT_ANNOTATIONS,
  textRun,
  toPlainText,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'

// ── 계약 ──────────────────────────────────────────────────────────────

export type PageLinkTarget = {
  /** 문서에 넣을 주소. ZIP 안이면 상대 경로다. */
  readonly href: string
  /** 링크 글자. 권한을 통과한 제목이어야 한다 — 호출자가 고른다. */
  readonly title: string
}

export type MarkdownLinks = {
  /** 하위 페이지 참조를 어디로 잇는가. `null` 이면 그 참조를 문서에서 **뺀다**. */
  readonly page: (pageId: string) => PageLinkTarget | null
  /** 이미지 주소. `null` 이면 그 이미지를 뺀다. */
  readonly image: (source: ImageSource) => string | null
}

/** Markdown 으로 옮기지 못한 것. 전부 0 이면 무손실이다. */
export type MarkdownLosses = {
  /** 글자색 · 배경색 · 블록 색. 표준 마크다운에는 색이 없다(F-01-12). */
  readonly color: number
  /** 문단 · 제목 밑에 있던 자식 블록. 마크다운은 문단을 들여 쓸 수 없어 같은 층으로 폈다. */
  readonly flattened: number
  /** `http` · `https` · `mailto` · `tel` 이 아닌 링크. 글자만 남겼다. */
  readonly unsafeLink: number
  /** 이 앱이 모르는 블록. 타입과 id 를 주석으로 남겼다. */
  readonly unsupported: number
  /** `links.page` 가 뺀 하위 페이지 참조. */
  readonly omittedPages: number
  /** `links.image` 가 뺀 이미지. 출처가 없는 빈 이미지 블록은 세지 않는다. */
  readonly omittedImages: number
}

type Counters = { -readonly [K in keyof MarkdownLosses]: number }

export function emptyLosses(): MarkdownLosses {
  return { color: 0, flattened: 0, unsafeLink: 0, unsupported: 0, omittedPages: 0, omittedImages: 0 }
}

export type MarkdownResult = {
  readonly markdown: string
  readonly losses: MarkdownLosses
}

export type MarkdownPage = {
  readonly title: readonly RichTextRun[]
  readonly doc: EditorDoc
}

/**
 * 페이지 하나를 Markdown 파일 내용으로.
 *
 * 첫 줄은 `# 제목` 이다(노션 익스포트와 같다 — 파일 이름이 잘려도 제목이 남는다).
 * 같은 입력이면 같은 글자가 나온다. 끝은 줄바꿈 하나다.
 */
export function pageToMarkdown(
  page: MarkdownPage,
  links: MarkdownLinks,
  options: { readonly untitled: string },
): MarkdownResult {
  const losses = emptyLosses() as Counters
  const ctx: Ctx = { links, losses }

  const title = toPlainText(page.title).trim() === '' ? [textRun(options.untitled)] : page.title
  const body = renderSiblings(page.doc.blocks, ctx).lines
  const lines = [headingLine(1, title, ctx), ...(body.length > 0 ? ['', ...body] : [])]

  return { markdown: `${lines.join('\n')}\n`, losses: { ...losses } }
}

// ── 글자 분류 ─────────────────────────────────────────────────────────
//
// micromark(`micromark-util-character`)와 같은 정의다: 공백은 `\s`, 문장부호는
// 유니코드 P · S 범주. 다르게 두면 "우리는 닫힌다고 봤는데 렌더러는 안 닫힌다"가 생긴다.

const WHITESPACE = /\s/u
const PUNCTUATION = /[\p{P}\p{S}]/u

function isPunctuation(ch: string | undefined): boolean {
  return ch !== undefined && PUNCTUATION.test(ch)
}

/** 공백도 문장부호도 아닌 글자. 줄 끝·문서 끝(`undefined`)은 공백으로 친다. */
function isWordLike(ch: string | undefined): boolean {
  return ch !== undefined && !WHITESPACE.test(ch) && !PUNCTUATION.test(ch)
}

function firstChar(s: string): string | undefined {
  return s === '' ? undefined : String.fromCodePoint(s.codePointAt(0) ?? 0)
}

function lastChar(s: string): string | undefined {
  if (s === '') return undefined
  const code = s.charCodeAt(s.length - 1)
  // 이모지 같은 서로게이트 쌍은 두 칸이 한 글자다.
  return code >= 0xdc00 && code <= 0xdfff && s.length >= 2 ? s.slice(-2) : s.slice(-1)
}

// ── 이스케이프 ────────────────────────────────────────────────────────

/**
 * 줄 어디서든 서식으로 읽힐 수 있는 글자.
 *
 * `~` 는 하나만 있어도 GFM 취소선이다(`~one~` → 실측 `<del>`). `|` 는 문단의 마지막
 * 줄을 표 머리로 만들 수 있다. `>` · `#` 처럼 **줄머리에서만** 뜻이 있는 것은
 * `escapeLineStart` 가 따로 본다 — 여기 넣으면 `a > b` 가 `a \> b` 로 읽기 싫어진다.
 */
const INLINE_SPECIAL = /[\\`*_[\]<~|]/g
/** `&copy;` · `&#35;` 는 문자 참조로 풀린다. 참조처럼 생긴 `&` 만 막는다. */
const ENTITY_LIKE = /&(?=#?[A-Za-z0-9]+;)/g

function escapeText(text: string): string {
  return text.replace(INLINE_SPECIAL, '\\$&').replace(ENTITY_LIKE, '\\&')
}

/**
 * 한 줄의 머리. 블록 머리와 줄바꿈(Shift+Enter) 뒤가 여기 온다.
 *
 * 우리가 만드는 문법(`*` `~` `<` `[` `` ` `` `\` `!`)은 이 규칙에 걸리는 글자로
 * 시작하지 않으므로, 서식을 입힌 **뒤의** 줄에 적용해도 된다.
 */
function escapeLineStart(line: string): string {
  // 줄머리 공백은 지워지거나 네 칸이면 코드 블록이 된다. 첫 칸을 문자 참조로 바꿔
  // 글자로 남긴다(실측: `&#32;   네 칸` → 공백 네 개가 보인다).
  if (line.startsWith(' ')) return `&#32;${line.slice(1)}`
  if (line.startsWith('\t')) return `&#9;${line.slice(1)}`
  // 제목 · 인용 · 목록 · setext 밑줄
  if (/^[#>+=-]/.test(line)) return `\\${line}`
  // 번호 목록. `1.` 과 `1)` 둘 다다.
  return line.replace(/^(\d+)([.)])/, '$1\\$2')
}

function escapeLineStarts(text: string): string {
  return text.split('\n').map(escapeLineStart).join('\n')
}

/** 줄바꿈 → 역슬래시 강제 줄바꿈. 문단 끝의 역슬래시는 줄바꿈이 아니라 글자라서 양끝은 떼어낸다. */
function hardBreaks(text: string): string {
  return text.replace(/\n/g, '\\\n')
}

function trimBreaks(inline: string): string {
  return inline.replace(/^(?:\\\n)+/, '').replace(/(?:\\\n)+$/, '')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 코드 스팬. 내용 안의 가장 긴 백틱 줄보다 한 개 긴 울타리를 쓴다.
 *
 * 줄바꿈은 공백으로 바꾼다 — 렌더러도 그렇게 읽고, 그대로 두면 목록 들여쓰기가
 * 코드 내용 안에 끼어든다.
 */
function codeSpan(content: string): string {
  const text = content.replace(/\n/g, ' ')
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  // 양끝이 백틱이면 울타리와 붙는다. 양끝이 모두 공백이면 렌더러가 한 칸씩 벗긴다.
  const pad =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '')
      ? ' '
      : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

// ── 링크 ──────────────────────────────────────────────────────────────

const SAFE_LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * 파일에 링크로 남겨도 되는 주소인가.
 *
 * 익스포트 파일은 우리 앱 밖의 렌더러가 연다. `javascript:` 링크를 그대로 두면 그
 * 렌더러의 소독에 기대게 된다. 스킴이 없는 주소(상대 경로 · `#앵커`)는 받는다.
 *
 * 브라우저는 주소의 탭 · 줄바꿈을 **지우고** 해석한다(`java\tscript:`). 그래서 스킴은
 * 제어 문자와 공백을 걷어낸 모양으로 판정한다.
 */
export function isSafeLinkUrl(url: string): boolean {
  let probe = ''
  for (const ch of url) if (ch.charCodeAt(0) > 0x20 && ch !== '\x7f') probe += ch
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(probe)
  return scheme === null || SAFE_LINK_SCHEMES.has(scheme[1].toLowerCase())
}

/** 링크 목적지. 공백 · 괄호 · 꺾쇠 · 역슬래시 · 따옴표 · 제어 문자를 퍼센트 인코딩한다. */
function linkDestination(url: string): string {
  let out = ''
  for (const ch of url) {
    const code = ch.charCodeAt(0)
    out +=
      code <= 0x20 || code === 0x7f || '()<>\\"'.includes(ch)
        ? `%${code.toString(16).toUpperCase().padStart(2, '0')}`
        : ch
  }
  return out
}

// ── 인라인 ────────────────────────────────────────────────────────────

type Emphasis = 'bold' | 'italic' | 'strike'

const MD_DELIMITER: Readonly<Record<Emphasis, string>> = { bold: '**', italic: '*', strike: '~~' }
const HTML_TAG: Readonly<Record<Emphasis, string>> = { bold: 'strong', italic: 'em', strike: 'del' }

type RunParts = {
  /** 구분자 밖으로 뺀 앞뒤 공백. `** 굵게**` 는 굵게로 읽히지 않는다. */
  readonly lead: string
  readonly core: string
  readonly trail: string
  readonly code: boolean
  /** 바깥 → 안 순서. */
  readonly emphasis: readonly Emphasis[]
  readonly underline: boolean
  readonly link: string | null
}

function partsOf(run: RichTextRun, losses: Counters): RunParts | null {
  const annotations = { ...DEFAULT_ANNOTATIONS, ...run.annotations }
  let code = annotations.code
  let content: string
  if (run.type === 'equation') {
    // 수식은 표준 마크다운이 없다. 코드 스팬에 `$…$` 로 남기면 렌더러가 건드리지 않고
    // 사람이 알아본다(`$` 만 쓰면 식 안의 `*` · `_` 가 강조로 읽힌다).
    content = `$${run.equation?.expression ?? run.plain_text ?? ''}$`
    code = true
  } else if (run.type === 'text') {
    content = run.text?.content ?? ''
  } else {
    content = run.plain_text ?? ''
  }
  content = content.replace(/\r\n?/g, '\n')
  if (content === '') return null

  if (annotations.color !== 'default') losses.color += 1

  let link = run.type === 'text' ? (run.text?.link?.url ?? null) : null
  if (link !== null && !isSafeLinkUrl(link)) {
    losses.unsafeLink += 1
    link = null
  }

  const emphasis: Emphasis[] = []
  if (annotations.bold) emphasis.push('bold')
  if (annotations.italic) emphasis.push('italic')
  if (annotations.strikethrough) emphasis.push('strike')

  if (emphasis.length === 0) {
    return { lead: '', core: content, trail: '', code, emphasis, underline: annotations.underline, link }
  }
  const lead = /^\s*/u.exec(content)?.[0] ?? ''
  const rest = content.slice(lead.length)
  const trail = /\s*$/u.exec(rest)?.[0] ?? ''
  const core = rest.slice(0, rest.length - trail.length)
  // 공백뿐인 런에 건 굵게는 보이지 않는다. 구분자를 쓸 자리도 없다.
  if (core === '') {
    return { lead: '', core: content, trail: '', code, emphasis: [], underline: annotations.underline, link }
  }
  return { lead, core, trail, code, emphasis, underline: annotations.underline, link }
}

/**
 * 이 런이 출력에 **글자로 시작하는가** — 앞 런의 닫는 구분자가 성립하는지 가른다.
 *
 * 서식 · 링크 · 코드가 있으면 출력은 문법 글자(`*` `[` `<` `` ` ``)로 시작하므로
 * 어느 쪽으로 쓰든 문장부호다. 그래서 앞 런은 뒤 런의 결정을 기다리지 않아도 된다.
 */
function startsWordLike(parts: RunParts | undefined): boolean {
  if (parts === undefined || parts.lead !== '') return false
  if (parts.code || parts.link !== null || parts.underline || parts.emphasis.length > 0) return false
  return isWordLike(firstChar(escapeText(parts.core)))
}

function leadingRunLength(s: string): number {
  let n = 0
  while (n < s.length && s[n] === s[0]) n += 1
  return n
}

/**
 * 가장 바깥 구분자열이 CommonMark 에서 **실제로 여닫히는가**.
 *
 * 같은 글자의 구분자는 하나로 붙는다(`**` + `*` → `***`). 그 덩어리의 여닫힘은
 * 덩어리 **바로 옆** 글자로 정해진다 — 안쪽이 다른 글자의 구분자(`~~`)면 그것이
 * 옆 글자이고, 아니면 내용의 첫 · 끝 글자다.
 */
function delimitersHold(
  md: readonly Emphasis[],
  inner: string,
  before: string | undefined,
  afterIsWordLike: boolean,
): boolean {
  const open = md.map((e) => MD_DELIMITER[e]).join('')
  const close = [...md].reverse().map((e) => MD_DELIMITER[e]).join('')
  // 앞 출력이 같은 글자로 끝나면(앞 런의 닫는 `**`) 두 구분자열이 붙어 짝이 뒤섞인다.
  if (before === open[0]) return false

  const openRun = leadingRunLength(open)
  const afterOpen = openRun < open.length ? open[openRun] : firstChar(inner)
  const closeRun = leadingRunLength([...close].reverse().join(''))
  const beforeClose = closeRun < close.length ? close[close.length - closeRun - 1] : lastChar(inner)

  // left-flanking: 뒤가 문장부호면 앞은 공백이나 문장부호여야 한다.
  const opens = !(isPunctuation(afterOpen) && isWordLike(before))
  // right-flanking: 앞이 문장부호면 뒤는 공백이나 문장부호여야 한다.
  const closes = !(isPunctuation(beforeClose) && afterIsWordLike)
  return opens && closes
}

/** RichText[] → 인라인 Markdown. 줄머리 이스케이프는 블록이 한다(줄의 시작을 블록만 안다). */
export function richTextToMarkdown(
  runs: readonly RichTextRun[],
  losses: MarkdownLosses = emptyLosses(),
): string {
  const counters = losses as Counters
  const parts = runs.map((run) => partsOf(run, counters)).filter((p): p is RunParts => p !== null)

  let out = ''
  parts.forEach((p, i) => {
    const inner = p.code ? codeSpan(p.core) : hardBreaks(escapeText(p.core))
    const md = [...p.emphasis]
    const html: Emphasis[] = []

    // 밑줄 · 링크로 감싸면 구분자 옆은 `<u>` · `[` 같은 문장부호라 늘 성립한다.
    // 실제 이웃 글자와 맞닿는 것은 그것들이 없을 때의 가장 바깥 구분자뿐이다.
    if (!p.underline && p.link === null) {
      const before = p.lead !== '' ? lastChar(p.lead) : lastChar(out)
      const afterIsWordLike = p.trail === '' && startsWordLike(parts[i + 1])
      while (md.length > 0 && !delimitersHold(md, inner, before, afterIsWordLike)) {
        // 바깥 하나를 HTML 로. 그 안쪽 구분자는 `<strong>` 의 꺾쇠와 맞닿아 성립한다.
        html.push(md.shift() as Emphasis)
      }
    }

    let body = inner
    for (const e of [...md].reverse()) body = `${MD_DELIMITER[e]}${body}${MD_DELIMITER[e]}`
    for (const e of [...html].reverse()) body = `<${HTML_TAG[e]}>${body}</${HTML_TAG[e]}>`
    if (p.underline) body = `<u>${body}</u>`
    if (p.link !== null) body = `[${body}](${linkDestination(p.link)})`

    out += hardBreaks(p.lead) + body + hardBreaks(p.trail)
  })
  return out
}

/**
 * RichText[] → 인라인 HTML. HTML 블록 **안**(`<summary>`)은 마크다운이 해석되지 않는다.
 *
 * 줄바꿈은 `<br>` 이어야 한다 — 빈 줄이 생기면 그 자리에서 HTML 블록이 끝난다.
 */
export function richTextToHtml(
  runs: readonly RichTextRun[],
  losses: MarkdownLosses = emptyLosses(),
): string {
  const counters = losses as Counters
  const text = (s: string): string => escapeHtml(s).replace(/\n/g, '<br>')

  let out = ''
  for (const run of runs) {
    const p = partsOf(run, counters)
    if (p === null) continue
    let body = p.code ? `<code>${escapeHtml(p.core.replace(/\n/g, ' '))}</code>` : text(p.core)
    for (const e of [...p.emphasis].reverse()) body = `<${HTML_TAG[e]}>${body}</${HTML_TAG[e]}>`
    if (p.underline) body = `<u>${body}</u>`
    if (p.link !== null) body = `<a href="${escapeHtml(linkDestination(p.link))}">${body}</a>`
    out += text(p.lead) + body + text(p.trail)
  }
  return out
}

// ── 블록 ──────────────────────────────────────────────────────────────

type Ctx = { readonly links: MarkdownLinks; readonly losses: Counters }

/** 같은 목록으로 이어지는 표지. 할 일과 글머리표는 둘 다 `-` 라 한 목록이 된다. */
const LIST_FAMILY: Readonly<Record<string, '-' | '.'>> = {
  bulleted_list_item: '-',
  to_do: '-',
  numbered_list_item: '.',
}

/** 자식을 자기 안에 둘 수 있는 블록. 나머지(문단 · 제목)의 자식은 같은 층으로 편다. */
const NESTS: ReadonlySet<string> = new Set([
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
])

/**
 * 문단 밑 자식을 같은 층으로 편다.
 *
 * 마크다운에는 **문단을 들여 쓰는 문법이 없다.** 네 칸 들여 쓰면 코드 블록이 되고
 * (노션 enhanced markdown 의 탭 들여쓰기가 다른 렌더러에서 그렇게 보인다), 지우면
 * 같은 층이 된다. 코드 블록으로 보이는 백업보다 층을 잃은 백업이 낫다. 센다.
 */
function flattenNonContainers(blocks: readonly EditorBlock[], losses: Counters): EditorBlock[] {
  const out: EditorBlock[] = []
  for (const block of blocks) {
    const children = block.children ?? []
    if (children.length > 0 && !NESTS.has(block.type)) {
      losses.flattened += children.length
      out.push({ ...block, children: [] }, ...flattenNonContainers(children, losses))
    } else {
      out.push(block)
    }
  }
  return out
}

type Rendered = { readonly lines: string[]; readonly firstType: string | null }

function renderSiblings(blocks: readonly EditorBlock[], ctx: Ctx): Rendered {
  const lines: string[] = []
  let firstType: string | null = null
  let last: EditorBlock | null = null
  /** `last` 뒤에 그리지 않은 형제(빈 문단 · 뺀 참조)가 있었는가. */
  let skipped = false
  let previousType: string | null = null
  let number = 0

  for (const block of flattenNonContainers(blocks, ctx.losses)) {
    // 번호는 바로 앞 형제가 번호 목록일 때만 잇는다 — 에디터가 보여주는 번호와 같다.
    number = block.type === 'numbered_list_item' ? (previousType === block.type ? number + 1 : 1) : 0
    previousType = block.type

    const own = renderBlock(block, ctx, number)
    if (own.length === 0) {
      skipped = true
      continue
    }

    if (last !== null) {
      const family = LIST_FAMILY[block.type]
      const sameFamily = family !== undefined && LIST_FAMILY[last.type] === family
      if (sameFamily && skipped) {
        // 빈 줄만 두면 두 목록이 **하나로 합쳐진다**(번호도 이어진다). 주석이 목록을 끊는다.
        lines.push('', '<!-- -->', '')
      } else if (!sameFamily) {
        // 목록 항목끼리만 붙여 쓴다(빈 줄을 두면 목록이 느슨해져 항목마다 문단이 된다).
        //
        // 앞 항목이 토글로 끝나도 붙여 써도 된다. `</details>` 는 들여 쓴 **항목 안**에 있고,
        // 들여쓰기가 모자란 다음 `- 항목` 줄이 그 항목을 닫는다 — 게으른 이어짐은 문단에만
        // 있어서 HTML 블록이 다음 항목을 삼킬 수 없다. (처음에는 여기서 띄웠는데 그 분기를
        // 빼도 검사가 전부 통과했다. 반사실이 그 주장이 틀렸다는 것을 보여줬다.)
        lines.push('')
      }
    } else {
      firstType = block.type
    }

    lines.push(...own)
    last = block
    skipped = false
  }

  return { lines, firstType }
}

/** 블록 제목을 줄 단위 Markdown 으로. 비었으면 빈 배열. */
function textLines(block: EditorBlock, ctx: Ctx): string[] {
  const inline = trimBreaks(richTextToMarkdown(block.title ?? [], ctx.losses))
  return inline === '' ? [] : escapeLineStarts(inline).split('\n')
}

function headingLine(level: number, title: readonly RichTextRun[], ctx: Ctx): string {
  // ATX 제목은 한 줄이다. 줄바꿈은 공백으로 접는다.
  const inline = richTextToMarkdown(title, ctx.losses).replace(/\\\n/g, ' ').trim()
  const hashes = '#'.repeat(level)
  if (inline === '') return hashes
  // 끝의 ` #` 은 닫는 표지로 읽혀 사라진다(`# C #` → "C").
  const content = escapeLineStart(inline).replace(/([ \t])(#+)([ \t]*)$/, '$1\\$2$3')
  return `${hashes} ${content}`
}

function indentLines(lines: readonly string[], pad: string): string[] {
  return lines.map((line) => (line === '' ? '' : pad + line))
}

function listItem(marker: string, block: EditorBlock, ctx: Ctx): string[] {
  // 목록 항목의 내용은 표지 뒤 칸에서 시작한다. 이어지는 줄과 자식은 그 칸에 맞춘다.
  // 할 일의 `[ ] ` 는 내용이므로 들여쓰기는 `- ` 두 칸이다.
  const pad = ' '.repeat(marker.startsWith('- [') ? 2 : marker.length)
  const text = textLines(block, ctx)
  const head =
    text.length === 0 ? [marker.trimEnd()] : [marker + text[0], ...indentLines(text.slice(1), pad)]

  const children = renderSiblings(block.children ?? [], ctx)
  if (children.lines.length === 0) return head
  // 목록은 문단을 끊고 들어올 수 있다. 그 밖의 자식 앞에 빈 줄이 없으면 항목 글자의
  // 이어지는 줄로 읽힌다(`- a` 다음 `  문단` → "a 문단").
  const gap = children.firstType !== null && LIST_FAMILY[children.firstType] !== undefined ? [] : ['']
  return [...head, ...gap, ...indentLines(children.lines, pad)]
}

function renderBlock(block: EditorBlock, ctx: Ctx, number: number): string[] {
  const { links, losses } = ctx
  const blockColor = block.format?.block_color
  if (blockColor !== undefined && blockColor !== 'default') losses.color += 1

  switch (block.type) {
    case 'paragraph':
      // 빈 문단은 표현할 수 없다 — 빈 줄은 몇 개든 하나로 접힌다.
      return textLines(block, ctx)

    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return [headingLine(Number(block.type.slice(-1)), block.title ?? [], ctx)]

    case 'bulleted_list_item':
      return listItem('- ', block, ctx)

    case 'numbered_list_item':
      return listItem(`${number}. `, block, ctx)

    case 'to_do': {
      const checked = (block.properties as { checked?: unknown } | undefined)?.checked === true
      return listItem(`- [${checked ? 'x' : ' '}] `, block, ctx)
    }

    case 'toggle': {
      const summary = `<summary>${richTextToHtml(block.title ?? [], losses)}</summary>`
      const children = renderSiblings(block.children ?? [], ctx).lines
      // 자식은 빈 줄로 HTML 블록과 떨어져야 마크다운으로 해석된다.
      return children.length === 0
        ? ['<details>', summary, '</details>']
        : ['<details>', summary, '', ...children, '', '</details>']
    }

    case 'quote': {
      const text = textLines(block, ctx)
      const children = renderSiblings(block.children ?? [], ctx).lines
      const body = text.length > 0 && children.length > 0 ? [...text, '', ...children] : [...text, ...children]
      return (body.length === 0 ? [''] : body).map((line) => (line === '' ? '>' : `> ${line}`))
    }

    case 'callout': {
      const text = textLines(block, ctx)
      const children = renderSiblings(block.children ?? [], ctx).lines
      const body = text.length > 0 && children.length > 0 ? [...text, '', ...children] : [...text, ...children]
      return body.length === 0 ? ['<aside>', '</aside>'] : ['<aside>', '', ...body, '', '</aside>']
    }

    case 'divider':
      return ['---']

    case 'image': {
      const source = readImageSource(block.properties)
      // 출처가 없는 이미지 블록은 정상 상태다(빈 블록). 잃은 것이 없다.
      if (source === null) return []
      const href = links.image(source)
      if (href === null) {
        losses.omittedImages += 1
        return []
      }
      const alt = escapeText(readCaption(block.properties).replace(/\s+/g, ' ').trim())
      return [`![${alt}](${linkDestination(href)})`]
    }

    case PAGE_TYPE: {
      const target = links.page(block.id)
      if (target === null) {
        losses.omittedPages += 1
        return []
      }
      const label = escapeText(target.title.replace(/\s+/g, ' ').trim())
      return [`[${label}](${linkDestination(target.href)})`]
    }

    case UNSUPPORTED_TYPE: {
      const original = (block.properties as { original_type?: unknown } | undefined)?.original_type
      losses.unsupported += 1
      return [unsupportedComment(typeof original === 'string' ? original : '', block.id)]
    }

    default:
      // `rowsToDoc` 가 모르는 타입을 `unsupported` 로 바꾸므로 여기 오면 계약 밖의 값이다.
      // 버리지 않고 같은 표시를 남긴다.
      losses.unsupported += 1
      return [unsupportedComment(block.type, block.id)]
  }
}

/**
 * 모르는 블록의 흔적. 렌더러에는 보이지 않고, 임포터(F-09-12)가 원본을 찾을 단서가 된다
 * (F-09-22 클론 대안: *"미지원 블록은 주석으로 보존"*).
 *
 * 타입 이름은 저장된 문자열이라 `-->` 가 들어 있으면 주석 밖으로 나온다. 모양을 강제한다.
 */
function unsupportedComment(type: string, id: string): string {
  const safeType = /^[a-z0-9_]{1,64}$/.test(type) ? type : 'unknown'
  const safeId = isUuid(id) ? ` id="${id}"` : ''
  return `<!-- unsupported block type="${safeType}"${safeId} -->`
}
