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
import type { ReactNode } from 'react'

import { codeCaptionRuns, codeLanguageOf } from '@/lib/block/code'
import { EQUATION_TYPE, equationExpressionOf } from '@/lib/block/equation'
import { cellsOf, COLUMN_HEADER_KEY, ROW_HEADER_KEY, TABLE_TYPE } from '@/lib/block/table'
import { TOC_TYPE, headingsOfBlocks, tocEntries } from '@/lib/block/toc'
import { BREADCRUMB_TYPE } from '@/lib/block/breadcrumb'
import { COLUMN_RATIO_KEY, PAGE_TYPE } from '@/lib/block/types'
import { isSafeLinkUrl } from '@/lib/contracts/link-url'
import { mentionTarget, toPlainText, type RichTextRun } from '@/lib/contracts/rich-text'
import type { EditorBlock } from '@/lib/editor/document'
import { renderEquation } from '@/lib/editor/equation-render'
import type { PublicPageView } from '@/lib/publish/public-read'

/** 제목 없는 페이지의 이름. */
export const UNTITLED = '제목 없음'

/** 공개 화면 안의 주소 — 같은 토큰 아래. 루트는 토큰만이다. */
export function publicHref(view: Pick<PublicPageView, 'token' | 'target'>, pageId: string): string {
  return pageId === view.target.rootId ? `/p/${view.token}` : `/p/${view.token}/${pageId}`
}

/** 페이지 제목의 글자 — 비었으면 "제목 없음". */
export function titleText(runs: readonly RichTextRun[] | undefined): string {
  const text = toPlainText(runs ?? []).trim()
  return text === '' ? UNTITLED : text
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

function RunView({ run, view }: { run: RichTextRun; view: PublicPageView }): ReactNode {
  if (run.type === 'equation') {
    const expression = run.equation?.expression ?? run.plain_text ?? ''
    const drawn = renderEquation(katex, expression, false)
    return decorate(run, drawn.ok ? <span className="pub-equation" dangerouslySetInnerHTML={{ __html: drawn.html }} /> : <code>{expression}</code>)
  }
  if (run.type === 'mention') {
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

export function RichText({ runs, view }: { runs: readonly RichTextRun[]; view: PublicPageView }): ReactNode {
  return runs.map((run, i) => <RunView key={i} run={run} view={view} />)
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
          <RichText runs={item.title} view={view} />
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
          <p><RichText runs={block.title} view={view} /></p>
          <Children block={block} view={view} />
        </div>
      )
    case 'heading_1':
    case 'heading_2':
    case 'heading_3': {
      const Tag = (`h${Number(block.type.slice(-1)) + 1}`) as 'h2' | 'h3' | 'h4'
      return (
        <div className="pub-block" data-color={color}>
          <Tag id={anchorOf(block.id)} className={`pub-${block.type}`}><RichText runs={block.title} view={view} /></Tag>
          <Children block={block} view={view} />
        </div>
      )
    }
    case 'to_do': {
      const checked = props.checked === true
      return (
        <div className="pub-block pub-todo" data-color={color} data-checked={checked}>
          <span className="pub-todo-box" role="img" aria-label={checked ? '완료' : '할 일'}>{checked ? '☑' : '☐'}</span>
          <span className="pub-todo-text"><RichText runs={block.title} view={view} /></span>
          <Children block={block} view={view} />
        </div>
      )
    }
    case 'toggle':
      return (
        <details className="pub-block pub-toggle" data-color={color}>
          <summary><RichText runs={block.title} view={view} /></summary>
          <Children block={block} view={view} />
        </details>
      )
    case 'quote':
      return (
        <blockquote className="pub-block pub-quote" data-color={color}>
          <RichText runs={block.title} view={view} />
          <Children block={block} view={view} />
        </blockquote>
      )
    case 'callout':
      return (
        <aside className="pub-block pub-callout" data-color={color}>
          <RichText runs={block.title} view={view} />
          <Children block={block} view={view} />
        </aside>
      )
    case 'divider':
      return <hr className="pub-divider" />
    case 'code': {
      const caption = codeCaptionRuns(props)
      const language = codeLanguageOf(props)
      return (
        <figure className="pub-block pub-code">
          <pre data-language={language ?? undefined}><code>{toPlainText(block.title)}</code></pre>
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
      // 버튼 블록 · 모르는 블록 · 이미지(6a-2b)는 그리지 않는다(정본 [보강] 공개 화면 ③)
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
