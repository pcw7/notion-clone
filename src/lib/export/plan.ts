/**
 * 익스포트 조립 — 스냅샷 → ZIP 항목 · 보고서 (F-09-14)
 *
 * 정본: 09-api-integrations.md F-09-14 (산출 구조 · 엣지 케이스) · 02-page-workspace.md F-02-22
 *
 * DB 를 모른다. 읽는 단계(3조각)가 **한 스냅샷**으로 읽어 `ExportSnapshot` 을 만들고, 이 파일은
 * 그것을 파일 목록으로 바꾼다. 바이트는 아직 없다 — 첨부는 id 만 들고 있다가 `archive.ts` 가
 * 흘려보내면서 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 배치 — 노션 Markdown & CSV 익스포트와 같은 모양 (F-09-14)
 * ──────────────────────────────────────────────────────────────────────
 *
 *     페이지.md
 *     페이지/                 ← 하위 페이지 · 첨부가 있을 때만 생긴다
 *       하위 페이지.md
 *       사진.png
 *     데이터베이스.csv
 *     데이터베이스/
 *       행.md                 ← 첫 줄 제목, 그 아래 속성 줄, 그다음 본문
 *     _export_report.json
 *
 * 이름은 `names.ts` 가 폴더마다 정한다. 본문의 하위 페이지 참조 · 이미지는 그 이름으로 **상대 링크**가
 * 된다 — ZIP 을 풀면 링크가 그대로 열린다(F-09-14: *"내부 링크는 상대 경로로 재작성"*).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 백업이다 — 빠진 것을 조용히 두지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - CSV 에는 **뷰 필터를 걸지 않는다.** 스냅샷이 준 행 · 프로퍼티 전부다(`csv.ts` 머리말)
 *   - 옮기지 못한 것은 전부 센다: Markdown 손실 · CSV 수식 막기 · 제목과 달라진 파일 이름 ·
 *     읽는 단계가 뺀 것 · 흘려보내며 못 읽은 첨부. `reportNotes` 가 사람이 읽을 문장으로 푼다
 *   - 외부 이미지는 **내려받지 않고** 주소로 둔다 — 서버가 사용자가 적은 주소를 가져오는 순간
 *     SSRF 진입점이다(HANDOFF §7 "OG 크롤러")
 */

import { readImageSource } from '../block/image.ts'
import { textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { extensionFor, isAllowedMime } from '../file/limits.ts'
import { cellPlainText, tableToCsv, type CsvColumn } from './csv.ts'
import { pageToMarkdown, type MarkdownLinks, type MarkdownLosses } from './markdown.ts'
import { encodeHrefSegment, resolveNames, safeFileName, type NameRequest } from './names.ts'
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES } from './zip.ts'

export const REPORT_PATH = '_export_report.json'
export const REPORT_FORMAT = 'notion-clone-export'

// ── 스냅샷 (입력) ─────────────────────────────────────────────────────

export type ExportScope = { readonly kind: 'page'; readonly rootId: string } | { readonly kind: 'workspace' }

export type ExportPageNode = {
  readonly kind: 'page'
  readonly id: string
  readonly title: readonly RichTextRun[]
  readonly doc: EditorDoc
  /** 이 페이지를 가장 가까운 페이지 조상으로 둔 페이지 · 데이터베이스. 내보낼 순서대로. */
  readonly childIds: readonly string[]
  /** 데이터베이스 행이면 `properties_cache`(프로퍼티 id → 셀). */
  readonly cells?: Readonly<Record<string, unknown>>
}

export type ExportDatabaseNode = {
  readonly kind: 'database'
  readonly id: string
  readonly name: string
  /** 살아 있는 프로퍼티 전부. 제목 열은 조립이 맨 앞으로 옮긴다. */
  readonly columns: readonly CsvColumn[]
  /** 살아 있는 행 전부(뷰 필터 없음). 순서대로. 각 행은 `kind: 'page'` 노드다. */
  readonly rowIds: readonly string[]
}

export type ExportNode = ExportPageNode | ExportDatabaseNode

export type ExportFile = {
  readonly id: string
  readonly mime: string
  readonly originalName: string | null
  readonly sizeBytes: number
}

export type ExportSnapshot = {
  readonly scope: ExportScope
  readonly exportedAt: Date
  /** 최상위에 놓을 노드. 페이지 범위면 그 페이지 하나다. */
  readonly rootIds: readonly string[]
  readonly nodes: ReadonlyMap<string, ExportNode>
  /** 본문이 가리키는 우리 파일 중 읽을 수 있는 것. 여기 없는 id 의 이미지는 문서에서 뺀다. */
  readonly files: ReadonlyMap<string, ExportFile>
  /** 읽는 단계가 범위에서 뺀 것. 사유 → 개수. 보고서에 그대로 싣는다. */
  readonly excluded?: Readonly<Record<string, number>>
}

// ── 계획 (출력) ───────────────────────────────────────────────────────

export type ExportEntry =
  | { readonly kind: 'text'; readonly path: string; readonly text: string }
  | { readonly kind: 'file'; readonly path: string; readonly fileId: string; readonly sizeBytes: number }

/** `_export_report.json`. 파일 형식이라 키는 snake_case 다(공개 API 계약과 같은 표기). */
export type ExportReport = {
  readonly format: typeof REPORT_FORMAT
  readonly version: 1
  readonly exported_at: string
  readonly scope: { readonly kind: 'page'; readonly root_id: string } | { readonly kind: 'workspace' }
  readonly counts: {
    readonly pages: number
    readonly databases: number
    readonly rows: number
    readonly attachments: number
  }
  /** 파일 이름이 제목과 다른 페이지 · 데이터베이스(소독 · 겹침). 제목이 빈 것은 세지 않는다. */
  readonly renamed_files: number
  readonly markdown_losses: {
    readonly color: number
    readonly flattened: number
    readonly unsafe_link: number
    readonly unsupported: number
    readonly omitted_pages: number
    readonly omitted_images: number
  }
  readonly csv_guarded_formulas: number
  /** 흘려보내며 저장소에서 읽지 못한 첨부. 계획 단계에서는 0 이고 `archive.ts` 가 채운다. */
  readonly missing_attachments: number
  readonly excluded: Readonly<Record<string, number>>
}

export type ExportPlan = {
  /** ZIP 에 넣을 순서. 보고서는 여기 없다 — 흘려보낸 뒤에 마지막으로 넣는다. */
  readonly entries: readonly ExportEntry[]
  readonly report: ExportReport
}

// ── 조립 ──────────────────────────────────────────────────────────────

/** 원래 이름이 없는 첨부의 이름. */
const ATTACHMENT_FALLBACK = 'image'

/**
 * 행 속성 줄 블록의 id. 저장되지 않는 합성 블록이다. 고정값이라 같은 입력이면 같은 글자가 나온다
 * (Markdown 직렬화기는 모르는 블록의 주석에만 id 를 쓴다).
 */
const PROPERTY_BLOCK_ID = '00000000-0000-4000-8000-000000000000'

type Counters = { -readonly [K in keyof MarkdownLosses]: number }

export function planExport(snapshot: ExportSnapshot, options: { readonly untitled: string }): ExportPlan {
  const { untitled } = options
  const entries: ExportEntry[] = []
  const visited = new Set<string>()
  const losses: Counters = { color: 0, flattened: 0, unsafeLink: 0, unsupported: 0, omittedPages: 0, omittedImages: 0 }
  const counts = { pages: 0, databases: 0, rows: 0, attachments: 0 }
  let renamedFiles = 0
  let guardedFormulas = 0

  const nodeOf = (id: string): ExportNode => {
    const found = snapshot.nodes.get(id)
    // 읽는 단계가 가리킨 노드를 넣지 않은 것이다. 조용히 건너뛰면 구멍 난 백업이 된다.
    if (found === undefined) throw new Error(`스냅샷에 없는 노드를 가리킨다: ${id}`)
    return found
  }
  const enter = (id: string): void => {
    if (visited.has(id)) throw new Error(`같은 노드가 두 번 나온다(순환 또는 중복): ${id}`)
    visited.add(id)
  }
  const plainTitle = (node: ExportNode): string =>
    (node.kind === 'page' ? toPlainText(node.title) : node.name).trim()

  /** 한 폴더에 놓일 노드 · 첨부의 이름. 키는 `node:<id>` · `file:<id>`. */
  const nameFolder = (
    nodes: readonly ExportNode[],
    files: readonly ExportFile[],
    reserved: readonly string[] = [],
  ): ReadonlyMap<string, string> => {
    const requests: NameRequest[] = [
      ...nodes.map((node) => ({
        key: `node:${node.id}`,
        id: node.id,
        base: safeFileName(plainTitle(node), untitled),
        extensions: node.kind === 'page' ? ['.md', ''] : ['.csv', ''],
      })),
      ...files.map((file) => ({
        key: `file:${file.id}`,
        id: file.id,
        base: safeFileName(stemOf(file.originalName), ATTACHMENT_FALLBACK),
        extensions: [`.${extensionOf(file)}`],
      })),
    ]
    const names = resolveNames(requests, reserved)
    for (const node of nodes) {
      const title = plainTitle(node).normalize('NFC')
      if (title !== '' && names.get(`node:${node.id}`) !== title) renamedFiles += 1
    }
    return names
  }

  const nameIn = (names: ReadonlyMap<string, string>, key: string): string => {
    const name = names.get(key)
    if (name === undefined) throw new Error(`이름을 짓지 않은 항목: ${key}`)
    return name
  }
  const fileName = (names: ReadonlyMap<string, string>, file: ExportFile): string =>
    `${nameIn(names, `file:${file.id}`)}.${extensionOf(file)}`

  const emitNode = (node: ExportNode, folder: string, base: string): void => {
    if (node.kind === 'page') emitPage(node, folder, base, null)
    else emitDatabase(node, folder, base)
  }

  const emitPage = (
    page: ExportPageNode,
    folder: string,
    base: string,
    rowColumns: readonly CsvColumn[] | null,
  ): void => {
    enter(page.id)
    if (rowColumns === null) counts.pages += 1
    else counts.rows += 1

    const path = joinPath(folder, base)
    const children = page.childIds.map(nodeOf)
    const files = attachmentsOf(page.doc, snapshot.files)
    const names = nameFolder(children, files)
    // 이 페이지의 `.md` 는 폴더 옆에 있으므로 폴더 안의 것은 `폴더이름/항목` 이다.
    const inFolder = (name: string): string => `${encodeHrefSegment(base)}/${encodeHrefSegment(name)}`
    const childIds = new Set(page.childIds)

    const links: MarkdownLinks = {
      page: (id) => {
        // 스냅샷의 자식이 아닌 참조 — 권한 · 범위 때문에 읽는 단계가 뺀 페이지다.
        if (!childIds.has(id)) return null
        const child = nodeOf(id)
        if (child.kind !== 'page') return null
        return { href: inFolder(`${nameIn(names, `node:${id}`)}.md`), title: plainTitle(child) || untitled }
      },
      image: (source) => {
        if (source.kind === 'external') return source.url
        const file = snapshot.files.get(source.fileId)
        return file === undefined ? null : inFolder(fileName(names, file))
      },
    }

    const doc = rowColumns === null ? page.doc : withPropertyLines(page.doc, rowColumns, page.cells ?? {})
    const result = pageToMarkdown({ title: page.title, doc }, links, { untitled })
    for (const key of Object.keys(losses) as (keyof Counters)[]) losses[key] += result.losses[key]
    entries.push({ kind: 'text', path: `${path}.md`, text: result.markdown })

    for (const file of files) {
      entries.push({ kind: 'file', path: `${path}/${fileName(names, file)}`, fileId: file.id, sizeBytes: file.sizeBytes })
      counts.attachments += 1
    }
    for (const child of children) emitNode(child, path, nameIn(names, `node:${child.id}`))
  }

  const emitDatabase = (database: ExportDatabaseNode, folder: string, base: string): void => {
    enter(database.id)
    counts.databases += 1

    const path = joinPath(folder, base)
    const columns = titleFirst(database.columns)
    const rows = database.rowIds.map((id) => {
      const row = nodeOf(id)
      if (row.kind !== 'page') throw new Error(`데이터베이스의 행이 페이지가 아니다: ${id}`)
      return row
    })

    const table = tableToCsv(columns, rows.map((row) => ({ cells: row.cells ?? {} })))
    guardedFormulas += table.guardedFormulas
    entries.push({ kind: 'text', path: `${path}.csv`, text: table.csv })

    const names = nameFolder(rows, [])
    for (const row of rows) emitPage(row, path, nameIn(names, `node:${row.id}`), columns)
  }

  const roots = snapshot.rootIds.map(nodeOf)
  const rootNames = nameFolder(roots, [], [REPORT_PATH])
  for (const root of roots) emitNode(root, '', nameIn(rootNames, `node:${root.id}`))

  return {
    entries,
    report: {
      format: REPORT_FORMAT,
      version: 1,
      exported_at: snapshot.exportedAt.toISOString(),
      scope:
        snapshot.scope.kind === 'page'
          ? { kind: 'page', root_id: snapshot.scope.rootId }
          : { kind: 'workspace' },
      counts: { ...counts },
      renamed_files: renamedFiles,
      markdown_losses: {
        color: losses.color,
        flattened: losses.flattened,
        unsafe_link: losses.unsafeLink,
        unsupported: losses.unsupported,
        omitted_pages: losses.omittedPages,
        omitted_images: losses.omittedImages,
      },
      csv_guarded_formulas: guardedFormulas,
      missing_attachments: 0,
      excluded: { ...(snapshot.excluded ?? {}) },
    },
  }
}

function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`
}

/** 노션 CSV 처럼 제목 열이 맨 앞이다. 나머지는 받은 순서 그대로. */
function titleFirst(columns: readonly CsvColumn[]): CsvColumn[] {
  return [...columns.filter((c) => c.type === 'title'), ...columns.filter((c) => c.type !== 'title')]
}

/** 원래 파일 이름에서 경로와 확장자를 뗀다. 확장자는 MIME 에서 다시 붙인다(`limits.ts` 와 같은 이유). */
function stemOf(originalName: string | null): string {
  if (originalName === null) return ''
  const base = originalName.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function extensionOf(file: ExportFile): string {
  return isAllowedMime(file.mime) ? extensionFor(file.mime) : 'bin'
}

/** 본문이 가리키는 우리 파일. 문서 순서대로, 같은 파일은 한 번만. */
function attachmentsOf(doc: EditorDoc, files: ReadonlyMap<string, ExportFile>): ExportFile[] {
  const out: ExportFile[] = []
  const seen = new Set<string>()
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'image') {
        const source = readImageSource(block.properties)
        const file = source?.kind === 'file' ? files.get(source.fileId) : undefined
        if (file !== undefined && !seen.has(file.id)) {
          seen.add(file.id)
          out.push(file)
        }
      }
      walk(block.children ?? [])
    }
  }
  walk(doc.blocks)
  return out
}

/**
 * 행 본문 앞에 속성 줄을 붙인다 — `**상태**: 진행 중`. 노션의 행 Markdown 과 같은 모양이다.
 *
 * 글자는 CSV 와 **같은 함수**(`cellPlainText`)로 만든다. 문단 블록으로 넣어 Markdown 직렬화기가
 * 이스케이프하게 한다 — 값에 `*` 가 있어도 서식이 되지 않는다.
 */
function withPropertyLines(
  doc: EditorDoc,
  columns: readonly CsvColumn[],
  cells: Readonly<Record<string, unknown>>,
): EditorDoc {
  const runs: RichTextRun[] = []
  for (const column of columns) {
    if (column.type === 'title') continue
    const value = cellPlainText(column, cells[column.propertyId])
    if (value === '') continue
    if (runs.length > 0) runs.push(textRun('\n'))
    runs.push(textRun(column.name, { bold: true }), textRun(`: ${value}`))
  }
  if (runs.length === 0) return doc
  return { blocks: [{ id: PROPERTY_BLOCK_ID, type: 'paragraph', title: runs }, ...doc.blocks] }
}

// ── 크기 ──────────────────────────────────────────────────────────────

export type ExportEstimate = {
  /** 보고서를 포함한 항목 수. */
  readonly entries: number
  /** ZIP 크기의 **상한**. 저장은 크기가 그대로이고 deflate 는 줄어들 때만 쓰므로 원래 크기 + 헤더를 넘지 않는다. */
  readonly bytes: number
  readonly fits: boolean
}

/** 보고서 몫. 알림 문장과 제외 사유가 들어가도 수 KB 다. */
const REPORT_RESERVE_BYTES = 64 * 1024

/**
 * ZIP 한 개에 담기는가를 **흘려보내기 전에** 판단한다.
 *
 * 흘려보내다 `zip.ts` 가 한계에서 던지면 받는 쪽에는 망가진 조각만 남는다. 넘칠 익스포트는 시작하기
 * 전에 거부하고 범위를 줄이라고 말하는 것이 맞다 — 이 함수는 그 판단을 위한 것이다.
 */
export function estimateExport(plan: ExportPlan, maxBytes: number = MAX_ZIP_BYTES): ExportEstimate {
  const encoder = new TextEncoder()
  // 로컬 헤더(30) + 중앙 디렉터리(46), 이름은 둘 다에 들어간다.
  const headers = (path: string): number => 30 + 46 + 2 * encoder.encode(path).length
  let bytes = 22 + headers(REPORT_PATH) + REPORT_RESERVE_BYTES
  for (const entry of plan.entries) {
    bytes += headers(entry.path) + (entry.kind === 'text' ? encoder.encode(entry.text).length : entry.sizeBytes)
  }
  const entries = plan.entries.length + 1
  return { entries, bytes, fits: entries <= MAX_ZIP_ENTRIES && bytes <= Math.min(maxBytes, MAX_ZIP_BYTES) }
}

// ── 보고서 ────────────────────────────────────────────────────────────

/** 0 이 아닌 항목을 사람이 읽을 문장으로. 무손실이면 빈 배열이다. */
export function reportNotes(report: ExportReport): string[] {
  const notes: string[] = []
  const m = report.markdown_losses
  if (m.color > 0) notes.push(`글자색 · 배경색 · 블록 색 ${m.color}곳은 표준 마크다운에 색이 없어 옮기지 못했다.`)
  if (m.flattened > 0) notes.push(`문단 · 제목 밑에 있던 블록 ${m.flattened}개는 마크다운으로 들여 쓸 수 없어 같은 층으로 폈다.`)
  if (m.unsafe_link > 0) notes.push(`http · https · mailto · tel 이 아닌 링크 ${m.unsafe_link}개는 걸지 않고 글자만 남겼다.`)
  if (m.unsupported > 0) notes.push(`이 앱이 모르는 블록 ${m.unsupported}개는 HTML 주석으로 흔적만 남겼다.`)
  if (m.omitted_pages > 0) notes.push(`볼 수 없거나 범위 밖인 하위 페이지 참조 ${m.omitted_pages}개를 문서에서 뺐다.`)
  if (m.omitted_images > 0) notes.push(`파일 정보를 찾지 못한 이미지 ${m.omitted_images}개를 문서에서 뺐다.`)
  if (report.missing_attachments > 0) {
    notes.push(`저장소에서 읽지 못한 첨부 파일 ${report.missing_attachments}개는 ZIP 에 없다 — 문서 안의 그 링크는 열리지 않는다.`)
  }
  if (report.csv_guarded_formulas > 0) {
    notes.push(`CSV 칸 ${report.csv_guarded_formulas}개는 Excel 이 수식으로 실행하지 않도록 앞에 ' 를 붙였다.`)
  }
  if (report.renamed_files > 0) {
    notes.push(
      `파일 이름 ${report.renamed_files}개는 제목과 다르다 — 운영체제가 받지 않는 글자 · 이모지를 빼거나 겹치는 이름에 id 를 붙였다. 원래 제목은 각 파일의 첫 줄에 있다.`,
    )
  }
  for (const [reason, count] of Object.entries(report.excluded)) {
    if (count > 0) notes.push(`읽는 단계에서 뺀 것 — ${reason}: ${count}개.`)
  }
  return notes
}

export function serializeReport(report: ExportReport): string {
  return `${JSON.stringify({ ...report, notes: reportNotes(report) }, null, 2)}\n`
}
