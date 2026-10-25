/**
 * 공개 화면의 본문 — 블록 · 글자 (게시 · 공유 6a-2a · F-06-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ③④⑤
 *
 * 서버 컴포넌트다 — 편집기(ProseMirror)를 띄우지 않고 브라우저 스크립트도 없다. 글자는 React 가 이스케이프한다. 날 HTML 을 넣는 곳은
 * KaTeX 의 출력 하나다(`trust: false` · 확장 상한 고정 — `editor/equation-render.ts`).
 *
 * 공개 밖을 가리킨 것은 받은 지도(`pages` · `people`)로 가린다 — 지도에 없는 페이지는 링크도 제목도 없다(읽는 쪽이 이미 걸렀다).
 */

import katex from 'katex'
import type { CSSProperties, ReactNode } from 'react'

import { codeCaptionRuns, codeLanguageOf } from '@/lib/block/code'
import { imageAltText, readCaption, readImageLayout, readImageSource } from '@/lib/block/image'
import { EQUATION_TYPE, equationExpressionOf } from '@/lib/block/equation'
import { calloutGlyph } from '@/lib/block/callout'
import { cellsOf, COLUMN_HEADER_KEY, ROW_HEADER_KEY, TABLE_TYPE } from '@/lib/block/table'
import { TOC_TYPE, headingsOfBlocks, tocEntries } from '@/lib/block/toc'
import { BREADCRUMB_TYPE } from '@/lib/block/breadcrumb'
import { COLUMN_RATIO_KEY, PAGE_TYPE } from '@/lib/block/types'
import { isSafeLinkUrl } from '@/lib/contracts/link-url'
import { customEmojiIdOfRun, mentionTarget, toPlainText, type RichTextRun } from '@/lib/contracts/rich-text'
import type { EditorBlock } from '@/lib/editor/document'
import { codeSegments, grammarOf, loadGrammar } from '@/lib/editor/code-grammars'
import { renderEquation } from '@/lib/editor/equation-render'
import type { PublicPageView } from '@/lib/publish/public-read'

/** 제목 없는 페이지의 이름. */
export const UNTITLED = '제목 없음'

/** 공개 화면이 칠하는 코드의 상한(10n-51 · HANDOFF §3.2-294 ③) — 편집기는 창으로 나눠 칠하지만 여기는 한 번에 그린다. 넘으면 평문. */
export const MAX_PUBLIC_HIGHLIGHT = 100_000

/**
 * 코드 블록의 글자 — 서버가 칠한다(10n-51 · HANDOFF §3.2-294). 편집기와 같은 문법 표 · 토큰 펴기를 쓰고 조각마다 `<span class>` 를 단다(글자는
 * React 가 이스케이프한다). 목록 밖 · 문법이 없는 언어 · 불러오기 실패 · 상한을 넘는 코드는 평문 — 공개 화면을 멈추지 않는다. 문법은 한 번
 * 불리면 이 서버에 남는다(`code-grammars.ts` 의 lowlight 인스턴스는 모듈에 하나).
 */
async function CodeText({ text, language }: { text: string; language: string | null }): Promise<ReactNode> {
  const grammar = grammarOf(language)
  if (grammar === null || text === '' || text.length > MAX_PUBLIC_HIGHLIGHT) return text
  try {
    await loadGrammar(grammar)
  } catch {
    return text
  }
  return codeSegments(grammar, text).map((segment, i) =>
    segment.className === null ? segment.text : <span key={i} className={segment.className}>{segment.text}</span>,
  )
}

/** 공개 화면 안의 주소 — 같은 기준 경로 아래(토큰 주소 · 사이트 주소 — 6c-1). 루트는 기준 경로 그대로다. */
export function publicHref(view: Pick<PublicPageView, 'base' | 'target'>, pageId: string): string {
  return pageId === view.target.rootId ? view.base : `${view.base}/${pageId}`
}

/** 페이지 제목의 글자 — 비었으면 "제목 없음". */
export function titleText(runs: readonly RichTextRun[] | undefined): string {
  const text = toPlainText(runs ?? []).trim()
  return text === '' ? UNTITLED : text
}

/** 공개 파일의 주소 — 블록 id 로 연다(파일 id 로 열지 않는다 · 정본 [보강] 공개 화면 ⑨). */
export function publicFileHref(view: Pick<PublicPageView, 'token'>, blockId: string, kind: 'image' | 'icon'): string {
  return `/p/${view.token}/blocks/${blockId}/${kind}`
}

/** 블록 제목 안의 커스텀 이모지 그림(7c-3c) — 블록 id 로 연다(정본 §3.4 [보강] 커스텀 이모지 ⑨). */
export function publicEmojiHref(view: Pick<PublicPageView, 'token'>, blockId: string, emojiId: string): string {
  return `/p/${view.token}/blocks/${blockId}/emoji/${emojiId}`
}

/** 헤딩의 앵커 — 목차가 가리킨다. */
const anchorOf = (blockId: string): string => `h-${blockId}`

// ── 글자 ──────────────────────────────────────────────────────────────

function linkOf(run: RichTextRun): string | null {
  const url = run.text?.link?.url ?? run.href
  return typeof url === 'string' && url !== '' && isSafeLinkUrl(url) ? url : null
}

function decorate(run: RichTextRun, content: ReactNode): ReactNode {
  const a = run.annotations
  let node = content
  if (a?.code) node = <code className="pub-code-inline">{node}</code>
  if (a?.bold) node = <strong>{node}</strong>
  if (a?.italic) node = <em>{node}</em>
  if (a?.strikethrough) node = <s>{node}</s>
  if (a?.underline) node = <u>{node}</u>
  if (a?.color && a.color !== 'default') node = <span className="blk-color" data-color={a.color}>{node}</span>
  return node
}

function RunView({ run, view, blockId }: { run: RichTextRun; view: PublicPageView; blockId?: string }): ReactNode {
  if (run.type === 'equation') {
    const expression = run.equation?.expression ?? run.plain_text ?? ''
    const drawn = renderEquation(katex, expression, false)
    return decorate(run, drawn.ok ? <span className="pub-equation" dangerouslySetInnerHTML={{ __html: drawn.html }} /> : <code>{expression}</code>)
  }
  if (run.type === 'mention') {
    // 커스텀 이모지(7c-3c) — 블록을 아는 자리는 그림(공개 경로 · 블록 id 로 연다), 모르는 자리(캡션 · 표 칸)와 지운 것은 `:이름:` 글자,
    // 이 워크스페이스에 없으면 그리지 않는다(정본 ⑨).
    const emojiId = customEmojiIdOfRun(run)?.toLowerCase()
    if (emojiId !== undefined) {
      const label = view.emoji.get(emojiId)
      if (label === undefined) return null
      if (label.deleted || blockId === undefined) return decorate(run, <span className="pub-emoji-text">:{label.name}:</span>)
      return (
        // eslint-disable-next-line @next/next/no-img-element -- 공개 화면은 최적화 경로를 거치지 않는다(토큰 경로)
        <img className="pub-emoji" src={publicEmojiHref(view, blockId, emojiId)} alt={`:${label.name}:`} title={`:${label.name}:`} referrerPolicy="no-referrer" />
      )
    }
    const target = mentionTarget(run)
    if (target?.kind === 'page') {
      const title = view.pages.get(target.id)
      // 열 수 없는 페이지 — 제목을 싣지 않는다(정본 [보강] 공개 화면 ④)
      if (title === undefined) return decorate(run, <span className="pub-mention pub-mention-hidden">비공개 페이지</span>)
      return decorate(run, <a className="pub-mention" href={publicHref(view, target.id)}>{titleText(title)}</a>)
    }
    if (target?.kind === 'user') {
      const name = view.people.get(target.id)
      return decorate(run, <span className="pub-mention">@{name ?? '알 수 없는 사람'}</span>)
    }
    return decorate(run, run.plain_text ?? '')
  }
  const text = run.text?.content ?? run.plain_text ?? ''
  const href = linkOf(run)
  const body = decorate(run, text)
  return href === null ? body : <a href={href} rel="noopener noreferrer nofollow" target="_blank">{body}</a>
}

/**
 * 런들을 그린다. `blockId` 는 이 런들이 그 블록의 제목일 때만 준다 — 커스텀 이모지의 그림은 블록 id 로 열기 때문이다(7c-3c). 주지 않으면
 * (캡션 · 표 칸) 이모지는 `:이름:` 글자다.
 */
export function RichText({ runs, view, blockId }: { runs: readonly RichTextRun[]; view: PublicPageView; blockId?: string }): ReactNode {
  return runs.map((run, i) => <RunView key={i} run={run} view={view} blockId={blockId} />)
}

// ── 블록 ──────────────────────────────────────────────────────────────

type ListKind = 'bulleted_list_item' | 'numbered_list_item'
const isListKind = (type: string): type is ListKind => type === 'bulleted_list_item' || type === 'numbered_list_item'

/** 형제 블록 — 이어지는 같은 종류의 목록 항목은 한 목록으로 묶는다. */
export function Blocks({ blocks, view }: { blocks: readonly EditorBlock[]; view: PublicPageView }): ReactNode {
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; ) {
    const block = blocks[i]!
    if (isListKind(block.type)) {
      const kind = block.type
      const items: EditorBlock[] = []
      while (i < blocks.length && blocks[i]!.type === kind) items.push(blocks[i++]!)
      const children = items.map((item) => (
        <li key={item.id} data-color={colorOf(item)}>
          <RichText runs={item.title} view={view} blockId={item.id} />
          {item.children && item.children.length > 0 && <Blocks blocks={item.children} view={view} />}
        </li>
      ))
      out.push(kind === 'numbered_list_item' ? <ol key={items[0]!.id}>{children}</ol> : <ul key={items[0]!.id}>{children}</ul>)
      continue
    }
    out.push(<Block key={block.id} block={block} view={view} />)
    i += 1
  }
  return out
}

function colorOf(block: EditorBlock): string | undefined {
  const color = block.format?.block_color
  return typeof color === 'string' && color !== 'default' ? color : undefined
}

function Children({ block, view }: { block: EditorBlock; view: PublicPageView }): ReactNode {
  return block.children && block.children.length > 0 ? <div className="pub-children"><Blocks blocks={block.children} view={view} /></div> : null
}

function Block({ block, view }: { block: EditorBlock; view: PublicPageView }): ReactNode {
  const color = colorOf(block)
  const props = (block.properties ?? {}) as Record<string, unknown>
  switch (block.type) {
    case 'paragraph':
      return (
        <div className="pub-block" data-color={color}>
          <p><RichText runs={block.title} view={view} blockId={block.id} /></p>
          <Children block={block} view={view} />
        </div>
      )
    case 'heading_1':
    case 'heading_2':
    case 'heading_3': {
      const Tag = (`h${Number(block.type.slice(-1)) + 1}`) as 'h2' | 'h3' | 'h4'
      return (
        <div className="pub-block" data-color={color}>
          <Tag id={anchorOf(block.id)} className={`pub-${block.type}`}><RichText runs={block.title} view={view} blockId={block.id} /></Tag>
          <Children block={block} view={view} />
        </div>
      )
    }
    case 'to_do': {
      const checked = props.checked === true
      return (
        <div className="pub-block pub-todo" data-color={color} data-checked={checked}>
          {/* 상자는 CSS 가 그린다(디자인-7b — 편집기와 같은 체크박스) · 뜻은 이름으로 */}
          <span className="pub-todo-box" role="img" aria-label={checked ? '완료' : '할 일'} />
          <span className="pub-todo-text"><RichText runs={block.title} view={view} blockId={block.id} /></span>
          <Children block={block} view={view} />
        </div>
      )
    }
    case 'toggle':
      return (
        <details className="pub-block pub-toggle" data-color={color}>
          <summary><RichText runs={block.title} view={view} blockId={block.id} /></summary>
          <Children block={block} view={view} />
        </details>
      )
    case 'quote':
      return (
        <blockquote className="pub-block pub-quote" data-color={color}>
          <RichText runs={block.title} view={view} blockId={block.id} />
          <Children block={block} view={view} />
        </blockquote>
      )
    case 'callout':
      return (
        <aside className="pub-block pub-callout" data-color={color}>
          <span className="pub-callout-icon" aria-hidden>
            {calloutGlyph(props)}
          </span>
          <div className="pub-callout-body">
            <RichText runs={block.title} view={view} blockId={block.id} />
            <Children block={block} view={view} />
          </div>
        </aside>
      )
    case 'divider':
      return <hr className="pub-divider" />
    case 'code': {
      const caption = codeCaptionRuns(props)
      const language = codeLanguageOf(props)
      return (
        <figure className="pub-block pub-code">
          <pre data-language={language ?? undefined}><code><CodeText text={toPlainText(block.title)} language={language} /></code></pre>
          {caption.length > 0 && <figcaption><RichText runs={caption} view={view} /></figcaption>}
        </figure>
      )
    }
    case EQUATION_TYPE: {
      const expression = equationExpressionOf(props)
      if (expression.trim() === '') return null
      const drawn = renderEquation(katex, expression, true)
      return drawn.ok
        ? <div className="pub-block pub-equation-block" dangerouslySetInnerHTML={{ __html: drawn.html }} />
        : <pre className="pub-block pub-equation-invalid">{expression}</pre>
    }
    case TABLE_TYPE: {
      const columnHeader = props[COLUMN_HEADER_KEY] === true
      const rowHeader = props[ROW_HEADER_KEY] === true
      const rows = (block.children ?? []).map((row) => ({ id: row.id, cells: cellsOf(row.properties) }))
      return (
        <div className="pub-block pub-table-wrap">
          <table className="pub-table">
            <tbody>
              {rows.map((row, r) => (
                <tr key={row.id}>
                  {row.cells.map((cell, c) => {
                    const head = (columnHeader && r === 0) || (rowHeader && c === 0)
                    const content = <RichText runs={cell} view={view} />
                    return head ? <th key={c}>{content}</th> : <td key={c}>{content}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'column_list':
      return (
        <div className="pub-block pub-columns">
          {(block.children ?? []).map((column) => {
            const ratio = (column.format as Record<string, unknown> | undefined)?.[COLUMN_RATIO_KEY]
            return (
              <div key={column.id} className="pub-column" style={{ flexGrow: typeof ratio === 'number' && ratio > 0 ? ratio : 1 }}>
                <Blocks blocks={column.children ?? []} view={view} />
              </div>
            )
          })}
        </div>
      )
    case 'column':
      return <Blocks blocks={block.children ?? []} view={view} />
    case TOC_TYPE:
      return <TableOfContents view={view} color={color} />
    case BREADCRUMB_TYPE:
      return (
        <nav className="pub-block pub-breadcrumb-block" aria-label="이동 경로" data-color={color}>
          <Trail view={view} />
        </nav>
      )
    case 'image': {
      const source = readImageSource(props)
      if (source === null) return null
      const caption = readCaption(props).trim()
      const src = source.kind === 'file' ? publicFileHref(view, block.id, 'image') : source.url
      // 폭 · 정렬(10n-63) — 편집기와 같은 규칙(`readImageLayout` · `public.css`)
      const layout = readImageLayout(block.format)
      return (
        <figure
          className="pub-block pub-image"
          data-width={layout.width ?? undefined}
          data-align={layout.align === 'left' ? undefined : layout.align}
          style={layout.width === null ? undefined : ({ '--pub-image-width': `${layout.width * 100}%` } as CSSProperties)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 공개 화면은 최적화 경로를 거치지 않는다(바깥 주소 · 토큰 경로) */}
          <img src={src} alt={imageAltText(block.format, props)} loading="lazy" referrerPolicy="no-referrer" />
          {caption !== '' && <figcaption>{caption}</figcaption>}
        </figure>
      )
    }
    case PAGE_TYPE: {
      // 읽는 쪽이 열 수 없는 참조를 이미 뺐다 — 그래도 지도에 없으면 그리지 않는다
      const title = view.pages.get(block.id)
      if (title === undefined) return null
      return (
        <a className="pub-block pub-page-ref" href={publicHref(view, block.id)}>
          <span aria-hidden="true">📄</span> {titleText(title)}
        </a>
      )
    }
    default:
      // 버튼 블록 · 모르는 블록은 그리지 않는다(정본 [보강] 공개 화면 ③)
      return null
  }
}

function TableOfContents({ view, color }: { view: PublicPageView; color: string | undefined }): ReactNode {
  const entries = tocEntries(headingsOfBlocks(view.doc.blocks))
  return (
    <nav className="pub-block pub-toc" aria-label="목차" data-color={color}>
      {entries.map((entry) => (
        <a key={entry.id} href={`#${anchorOf(entry.id)}`} style={{ paddingLeft: `${entry.depth * 1.25}rem` }}>
          <RichText runs={entry.title} view={view} />
        </a>
      ))}
    </nav>
  )
}

/** 이동 경로 — 루트에서 이 페이지까지만(정본 ④ — 루트 위의 조상은 그리지 않는다). */
export function Trail({ view }: { view: PublicPageView }): ReactNode {
  return view.target.chain.map((id, i) => {
    const last = i === view.target.chain.length - 1
    const label = titleText(view.pages.get(id))
    return (
      <span key={id} className="pub-trail-item">
        {i > 0 && <span className="pub-trail-sep" aria-hidden="true">/</span>}
        {last ? <span aria-current="page">{label}</span> : <a href={publicHref(view, id)}>{label}</a>}
      </span>
    )
  })
}
