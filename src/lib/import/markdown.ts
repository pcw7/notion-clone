/**
 * 마크다운 → 본문 — 잔여 묶음 8m-1 (F-09-12 · 순수 · DB 없음)
 *
 * 정본: 09-api-integrations.md F-09-12 *"Markdown / TXT — 1 파일 = 1 페이지. 헤딩·리스트·코드블록 변환. 앵커 링크와 비표준 확장(각주 등)은
 *       미지원 … 클론 시 현실적 대안: v1은 Markdown/ZIP 두 개만"* · 00-canonical-data-model.md §3.4 [보강] 가져오기
 *
 * 파서는 `marked`(MIT · 의존성 없음)의 **렉서만** 쓴다 — HTML 로 그리지 않고 토큰 나무를 우리 블록으로 옮긴다. CommonMark 의 모서리(느슨한 ·
 * 빽빽한 목록 · 이스케이프 · 울타리)를 손으로 다시 만들지 않는다.
 *
 *   · 첫 블록이 `# 제목` 이면 페이지 제목이 된다(우리 · 노션의 내보내기가 그렇게 쓴다) — 본문에서 뺀다
 *   · 헤딩 1~3(4~6 은 3) · 문단 · 글머리표 · 번호 · 할 일(`- [ ]` · `- [x]`) · 코드(언어) · 인용 · 구분선 · 외부 이미지(http · https)
 *   · 문단 하나가 통째로 `$$ … $$` 이면 블록 수식(Phase 2 1a — 우리 · 노션의 내보내기가 블록 수식을 그렇게 쓴다)
 *   · 글자 속의 수식(Phase 2 1b) — 우리 내보내기의 `` `$식$` ``(코드 스팬)과 노션 내보내기의 `$식$` · `$$식$$`. `$` 하나짜리는 pandoc 의
 *     규칙으로만 잡는다 — 여는 `$` 바로 뒤와 닫는 `$` 바로 앞이 공백이 아니고, 닫는 `$` 뒤가 숫자가 아니다(`$5 와 $10` 은 글자다).
 *     식 안의 `*` · `_` 가 강조로 읽히지 않게 렉서의 확장으로 먼저 떼어 낸다
 *   · 우리 내보내기의 HTML 꼴을 되돌린다 — `<details><summary>` 는 토글, `<aside>` 는 콜아웃(왕복이 닫힌다)
 *   · 글자의 꾸밈 — 굵게 · 기울임 · 취소선 · 코드 · 링크(http · https · mailto 만) · 줄바꿈
 *   · **옮기지 못한 것은 세어 돌려준다**(`ImportLosses`) — 표(행마다 문단으로 남긴다) · 그 밖의 HTML · 로컬 이미지 · 글자 안의 이미지 ·
 *     위험한 링크 · 꾸밈이 너무 많은 줄(앞 99 조각만 꾸밈을 지킨다). 조용히 버리지 않는다
 *   · 주석(`<!-- … -->`)과 링크 정의는 내용이 아니다 — 세지 않고 지나간다
 *   · **ZIP 안의 상대 주소**(8m-2b · `ImportLinks`) — 다른 페이지의 `.md` 링크는 페이지 멘션, 한 줄짜리 링크 문단이 직속 하위 페이지를 가리키면
 *     그 하위의 **참조 블록**(우리 · 노션의 내보내기가 하위 페이지를 그렇게 쓴다 — 왕복이 닫힌다), 한 줄짜리 이미지는 올린 파일의 이미지 블록.
 *     주소를 푸는 일(경로 · 이름 맞추기)은 부르는 쪽이 한다 — 이 모듈은 주소 문자열만 넘긴다
 */

import { randomUUID } from 'node:crypto'

import { Marked, type Token, type TokenizerExtension, type Tokens } from 'marked'

import { CODE_LANGUAGES, PLAIN_TEXT_LANGUAGE } from '../block/code.ts'
import { clampExpression, displayMathOf } from '../block/equation.ts'
import {
  DEFAULT_ANNOTATIONS,
  equationRun,
  MAX_RICH_TEXT_RUNS,
  pageMentionRun,
  sameAnnotations,
  splitText,
  type Annotations,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'

export type ImportLosses = {
  /** 표 — 행마다 문단(칸은 ` | ` 로)으로 남겼다. */
  tables: number
  /** 블록으로 옮길 수 없는 HTML(토글 · 콜아웃의 꼴이 아닌 것). */
  html: number
  /** 이미지 — 로컬 경로 · 글자 안의 이미지(외부 주소만 블록이 된다). */
  images: number
  /** 링크 — http · https · mailto 가 아닌 주소는 글자만 남겼다. */
  links: number
  /** 꾸밈 — 한 줄의 조각이 상한을 넘어 뒤쪽을 평문으로 합쳤다. */
  formatting: number
}

export const emptyImportLosses = (): ImportLosses => ({ tables: 0, html: 0, images: 0, links: 0, formatting: 0 })

export type MarkdownImport = {
  /** 첫 블록이 `# 제목` 이면 그 글자 — 아니면 null(부르는 쪽이 파일 이름을 쓴다). */
  readonly title: string | null
  readonly doc: EditorDoc
  readonly losses: ImportLosses
  /** 본문에 참조 블록으로 세운 하위 페이지(문서 순서) — 부르는 쪽이 나머지 하위를 끝에 단다. */
  readonly pageRefs: readonly string[]
}

/**
 * 상대 주소를 푸는 쪽 — ZIP 가져오기(8m-2b)만 준다. 낱 파일 가져오기에는 상대 주소가 가리킬 것이 없다(잃은 링크 · 이미지로 센다).
 * http · https · mailto 는 묻지 않는다.
 */
export type ImportLinks = {
  /** 링크 → 페이지. `child` 면 이 페이지의 직속 하위다 — 한 줄짜리 링크 문단이 그 참조 블록이 된다. 모르면 null. */
  readonly page: (href: string) => { readonly id: string; readonly child: boolean } | null
  /** 이미지 → 올릴 파일의 id. 모르는 · 받지 않는 파일이면 null. */
  readonly image: (href: string) => string | null
}

/** 변환 한 번의 문맥 — 잃은 것을 세고, 주소를 풀고, 세운 참조를 적는다(같은 하위를 두 번 세우지 않는다). */
type Convert = { readonly losses: ImportLosses; readonly links: ImportLinks | null; readonly placed: string[] }

type Marks = Partial<Pick<Annotations, 'bold' | 'italic' | 'strikethrough' | 'code'>>

/** 글자 속의 수식 — `$$식$$` 또는 pandoc 규칙의 `$식$`(머리말). 렉서가 강조 · 코드보다 먼저 본다. */
const INLINE_MATH: TokenizerExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    const at = src.indexOf('$')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const match = /^\$\$([^$\n]+?)\$\$/.exec(src) ?? /^\$(?!\$)(?=\S)([^$\n]*?[^\s\\$])\$(?!\d)/.exec(src)
    if (match === null || (match[1] ?? '').trim() === '') return undefined
    return { type: 'inlineMath', raw: match[0], text: match[1] ?? '' }
  },
}

const LEXER = new Marked({ gfm: true }).use({ extensions: [INLINE_MATH] })

/** 우리 내보내기의 인라인 수식 — 코드 스팬 안의 `$식$`(`export/markdown.ts`). */
const CODE_SPAN_MATH = /^\$([^$]+)\$$/

const SAFE_LINK = /^(https?:|mailto:)/i

/** 기본 HTML 엔티티를 되돌린다 — `<summary>` 안처럼 HTML 로 쓴 글자. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, ''))

// ── 글자 ──────────────────────────────────────────────────────────────

function runsOf(tokens: readonly Token[] | undefined, marks: Marks, cx: Convert, link: string | null = null): RichTextRun[] {
  const out: RichTextRun[] = []
  const push = (content: string, extra: Marks = {}, href: string | null = link) => {
    if (content === '') return
    const annotations: Annotations = { ...DEFAULT_ANNOTATIONS, ...marks, ...extra }
    for (const piece of splitText(content)) {
      out.push({ type: 'text', annotations, plain_text: piece, href, text: { content: piece, link: href === null ? null : { url: href } } } as RichTextRun)
    }
  }
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        const t = token as Tokens.Text
        if (t.tokens !== undefined && t.tokens.length > 0) out.push(...runsOf(t.tokens, marks, cx, link))
        else push(t.text)
        break
      }
      case 'strong':
        out.push(...runsOf((token as Tokens.Strong).tokens, { ...marks, bold: true }, cx, link))
        break
      case 'em':
        out.push(...runsOf((token as Tokens.Em).tokens, { ...marks, italic: true }, cx, link))
        break
      case 'del':
        out.push(...runsOf((token as Tokens.Del).tokens, { ...marks, strikethrough: true }, cx, link))
        break
      case 'codespan': {
        const text = (token as Tokens.Codespan).text
        const math = CODE_SPAN_MATH.exec(text)?.[1]
        if (math !== undefined && math.trim() !== '') out.push(equationRun(clampExpression(math), marks))
        else push(text, { code: true })
        break
      }
      case 'inlineMath':
        out.push(equationRun(clampExpression((token as unknown as { text: string }).text), marks))
        break
      case 'br':
        push('\n')
        break
      case 'link': {
        const l = token as Tokens.Link
        if (SAFE_LINK.test(l.href)) {
          out.push(...runsOf(l.tokens, marks, cx, l.href))
          break
        }
        // ZIP 안의 다른 페이지 — 멘션이 된다(링크 글자 대신 그 페이지의 제목이 보인다).
        const page = cx.links?.page(l.href) ?? null
        if (page !== null) {
          out.push(pageMentionRun(page.id, marks))
          break
        }
        cx.losses.links += 1
        out.push(...runsOf(l.tokens, marks, cx, null))
        break
      }
      case 'image':
        // 글자 안의 이미지 — 블록이 될 수 없다. 대체 글자를 남긴다.
        cx.losses.images += 1
        push((token as Tokens.Image).text)
        break
      case 'html':
        // 글자 안의 HTML(`<u>` 따위) — 태그를 벗기고 글자만.
        push(stripTags((token as Tokens.HTML).text))
        break
      default:
        if ('text' in token && typeof token.text === 'string') push(token.text)
    }
  }
  return out
}

/** 이웃한 같은 꾸밈 · 같은 링크의 조각을 합치고, 상한을 넘으면 뒤쪽을 평문으로 합친다. */
function compact(runs: readonly RichTextRun[], losses: ImportLosses): RichTextRun[] {
  const merged: RichTextRun[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    const content = run.text?.content ?? ''
    const lastContent = last?.text?.content ?? ''
    // 글자 조각끼리만 합친다 — 멘션(8m-2b)은 글자가 없어 합치면 사라진다.
    if (
      last !== undefined &&
      last.type === 'text' &&
      run.type === 'text' &&
      sameAnnotations(last.annotations, run.annotations) &&
      (last.text?.link?.url ?? null) === (run.text?.link?.url ?? null) &&
      lastContent.length + content.length <= 2000
    ) {
      const joined = lastContent + content
      merged[merged.length - 1] = { ...last, plain_text: joined, text: { content: joined, link: last.text?.link ?? null } } as RichTextRun
    } else {
      merged.push(run)
    }
  }
  if (merged.length <= MAX_RICH_TEXT_RUNS) return merged
  losses.formatting += 1
  const head = merged.slice(0, MAX_RICH_TEXT_RUNS - 1)
  const tail = merged.slice(MAX_RICH_TEXT_RUNS - 1).map((r) => r.text?.content ?? '').join('')
  const plain = splitText(tail).slice(0, 1)[0] ?? ''
  return [...head, { type: 'text', annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: plain, href: null, text: { content: plain, link: null } } as RichTextRun]
}

const inline = (tokens: readonly Token[] | undefined, cx: Convert): RichTextRun[] => compact(runsOf(tokens, {}, cx), cx.losses)
const plainRuns = (text: string, cx: Convert): RichTextRun[] => inline([{ type: 'text', raw: text, text } as Tokens.Text], cx)

// ── 블록 ──────────────────────────────────────────────────────────────

/**
 * 울타리의 언어 → 저장하는 이름(`CODE_LANGUAGES` 의 id — 노션 API 의 이름). 정보 문자열 전체 → 첫 낱말 순으로 id · 별칭을 찾는다(`ascii art`
 * 처럼 공백이 든 이름이 있다). 모르는 언어는 평문(null) — 화면의 언어 고르개가 모르는 값을 들고 있지 않게.
 */
export function codeLanguageFromFence(info: string | undefined): string | null {
  const raw = (info ?? '').trim().toLowerCase()
  if (raw === '') return null
  const find = (name: string) => CODE_LANGUAGES.find((l) => l.id === name) ?? CODE_LANGUAGES.find((l) => l.aliases?.includes(name))
  const id = (find(raw) ?? find(raw.split(/\s+/)[0] ?? ''))?.id ?? null
  return id === PLAIN_TEXT_LANGUAGE ? null : id
}

const block = (type: EditorBlock['type'], title: RichTextRun[], extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title,
  ...extra,
})

/** 목록 항목 · 인용의 안 — 첫 글자 토큰이 제목, 나머지가 자식. */
function splitHead(tokens: readonly Token[], cx: Convert): { title: RichTextRun[]; rest: Token[] } {
  const items = tokens.filter((t) => t.type !== 'checkbox' && t.type !== 'space')
  const first = items[0]
  if (first !== undefined && (first.type === 'text' || first.type === 'paragraph')) {
    const t = first as Tokens.Text | Tokens.Paragraph
    return { title: inline(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Tokens.Text], cx), rest: items.slice(1) }
  }
  return { title: [], rest: items }
}

/** 한 무리의 토큰 → 블록들. `<details>` · `<aside>` 는 짝이 맞는 닫는 토큰까지를 자식으로 묶는다. */
function blocksOf(tokens: readonly Token[], cx: Convert): EditorBlock[] {
  const out: EditorBlock[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    switch (token.type) {
      case 'space':
      case 'def':
        break
      case 'heading': {
        const h = token as Tokens.Heading
        const type = h.depth <= 1 ? 'heading_1' : h.depth === 2 ? 'heading_2' : 'heading_3'
        out.push(block(type, inline(h.tokens, cx)))
        break
      }
      case 'paragraph': {
        const p = token as Tokens.Paragraph
        const math = displayMathOf(p.text)
        if (math !== null) {
          out.push(block('equation', [], { properties: { expression: clampExpression(math) } }))
          break
        }
        const only = p.tokens.filter((t) => !(t.type === 'text' && (t as Tokens.Text).text.trim() === ''))
        if (only.length === 1 && only[0]!.type === 'image') {
          const image = only[0] as Tokens.Image
          const caption = image.text ? { caption: plainRuns(image.text, cx) } : {}
          if (/^https?:\/\//i.test(image.href)) {
            out.push(block('image', [], { properties: { source: { type: 'external', url: image.href }, ...caption } }))
            break
          }
          // ZIP 안의 이미지 — 부르는 쪽이 올릴 파일의 id 를 준다.
          const fileId = cx.links?.image(image.href) ?? null
          if (fileId !== null) out.push(block('image', [], { properties: { source: { type: 'file', file_id: fileId }, ...caption } }))
          else cx.losses.images += 1
          break
        }
        // 한 줄짜리 링크가 직속 하위 페이지를 가리킨다 — 그 하위의 참조 블록이 된다(블록 id 가 곧 하위 페이지의 id). 둘째부터는 멘션이다.
        if (only.length === 1 && only[0]!.type === 'link' && cx.links !== null && !SAFE_LINK.test((only[0] as Tokens.Link).href)) {
          const target = cx.links.page((only[0] as Tokens.Link).href)
          if (target !== null && target.child && !cx.placed.includes(target.id)) {
            cx.placed.push(target.id)
            out.push({ id: target.id, type: 'page', title: [] })
            break
          }
        }
        out.push(block('paragraph', inline(p.tokens, cx)))
        break
      }
      case 'list': {
        const list = token as Tokens.List
        for (const item of list.items) {
          const { title, rest } = splitHead(item.tokens, cx)
          const type = item.task ? 'to_do' : list.ordered ? 'numbered_list_item' : 'bulleted_list_item'
          const children = blocksOf(rest, cx)
          out.push(
            block(type, title, {
              ...(item.task ? { properties: { checked: item.checked === true } } : {}),
              ...(children.length > 0 ? { children } : {}),
            }),
          )
        }
        break
      }
      case 'code': {
        const c = token as Tokens.Code
        const language = codeLanguageFromFence(c.lang)
        out.push(block('code', plainRuns(c.text, cx), language === null ? {} : { properties: { language } }))
        break
      }
      case 'blockquote': {
        const { title, rest } = splitHead((token as Tokens.Blockquote).tokens, cx)
        const children = blocksOf(rest, cx)
        out.push(block('quote', title, children.length > 0 ? { children } : {}))
        break
      }
      case 'hr':
        out.push(block('divider', []))
        break
      case 'table': {
        // 표는 블록이 없다 — 행마다 문단(칸은 " | ")으로 남긴다. 내용은 잃지 않는다.
        cx.losses.tables += 1
        const t = token as Tokens.Table
        const row = (cells: readonly Tokens.TableCell[]) =>
          block('paragraph', compact(cells.flatMap((cell, k) => [...(k > 0 ? plainRuns(' | ', cx) : []), ...runsOf(cell.tokens, {}, cx)]), cx.losses))
        out.push(row(t.header), ...t.rows.map(row))
        break
      }
      case 'html': {
        const html = (token as Tokens.HTML).text.trim()
        if (/^<!--[\s\S]*-->$/.test(html)) break
        const opener = /^<(details|aside)\b[^>]*>/i.exec(html)
        if (opener !== null) {
          const tag = opener[1]!.toLowerCase()
          // 같은 토큰 안에 닫는 태그까지 있으면(자식 없이 한 덩이) 그것으로, 아니면 짝이 맞는 닫는 토큰까지가 자식이다.
          const selfClosed = new RegExp(`</${tag}>\\s*$`, 'i').test(html)
          let depth = 1
          let j = i + 1
          if (!selfClosed) {
            for (; j < tokens.length; j += 1) {
              const t = tokens[j]!
              if (t.type !== 'html') continue
              const text = (t as Tokens.HTML).text
              if (new RegExp(`^\\s*<${tag}\\b`, 'i').test(text)) depth += 1
              if (new RegExp(`</${tag}>\\s*$`, 'i').test(text)) depth -= 1
              if (depth === 0) break
            }
          }
          const inner = selfClosed ? [] : tokens.slice(i + 1, j)
          if (tag === 'details') {
            const summary = /<summary>([\s\S]*?)<\/summary>/i.exec(html)?.[1] ?? ''
            const children = blocksOf(inner, cx)
            out.push(block('toggle', plainRuns(stripTags(summary).trim(), cx), children.length > 0 ? { children } : {}))
          } else {
            const { title, rest } = splitHead(inner, cx)
            const children = blocksOf(rest, cx)
            out.push(block('callout', title, children.length > 0 ? { children } : {}))
          }
          i = selfClosed ? i : j
          break
        }
        // 짝 없이 남은 닫는 태그 — 지나간다(위의 묶기가 먹지 못한 경우).
        if (/^<\/(details|aside)>$/i.test(html)) break
        cx.losses.html += 1
        break
      }
      default:
        cx.losses.html += 1
    }
  }
  return out
}

/** 마크다운 → 본문. 첫 블록이 `# 제목` 이면 제목으로 뺀다. `links` 는 ZIP 안의 상대 주소를 푼다(8m-2b). */
export function markdownToDoc(source: string, links: ImportLinks | null = null): MarkdownImport {
  const cx: Convert = { losses: emptyImportLosses(), links, placed: [] }
  const tokens = LEXER.lexer(source.replace(/^﻿/, ''))
  const first = tokens.find((t) => t.type !== 'space')
  let title: string | null = null
  let rest: readonly Token[] = tokens
  if (first !== undefined && first.type === 'heading' && (first as Tokens.Heading).depth === 1) {
    title = (first as Tokens.Heading).text.trim()
    rest = tokens.slice(tokens.indexOf(first) + 1)
  }
  const blocks = blocksOf(rest, cx)
  return { title: title === '' ? null : title, doc: { blocks }, losses: cx.losses, pageRefs: cx.placed }
}

/** 평문 → 본문. 빈 줄로 나뉜 덩이가 문단 하나다(덩이 안의 줄바꿈은 그대로). */
export function textToDoc(source: string): MarkdownImport {
  const cx: Convert = { losses: emptyImportLosses(), links: null, placed: [] }
  const paragraphs = source
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '')
  return { title: null, doc: { blocks: paragraphs.map((p) => block('paragraph', plainRuns(p, cx))) }, losses: cx.losses, pageRefs: [] }
}
