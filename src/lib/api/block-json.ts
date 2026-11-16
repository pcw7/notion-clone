/**
 * 공개 API 의 블록 JSON — 우리 블록(`EditorBlock`) ↔ 노션 블록 (API-3 · F-09-01 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ · §3.4 의 블록 절(코드 `language` · `caption` · 목차 · 블록 수식 `expression` ·
 *       컬럼 `width_ratio` · 심플 테이블 · 콜아웃 `icon`) · 09-api-integrations.md F-09-01
 *
 * 읽기 — 본문(원문 — 제안 마크는 문서 밖이다)의 블록 하나를 노션의 `{type, [type]: payload}` 로. 노션의 모양으로 말할 수 없는 것은 `unsupported`:
 *   · 버튼 블록(노션 API 도 unsupported 다) · 모르는 타입을 감싸 둔 블록 · 출처가 없는 빈 이미지 · 비디오 · 파일
 *   · 하위 페이지 참조 → `child_page {title}` · 인라인 데이터베이스 → `child_database {title}`(볼 수 없으면 빈 제목 — 자리는 이미 보인다)
 *   · 올린 파일은 `{type:'file_upload', file_upload:{id}}` — 짧게 사는 파일 주소를 만드는 길이 아직 없다(API-2 files 속성과 같은 결정 · 정본 ⑥)
 *   · 노션에 자리가 없는 우리 값(이미지의 대체 텍스트 · 폭 · 정렬, 임베드의 높이, 코드의 줄바꿈)은 싣지 않는다 — 고치기는 그 값을 남긴다
 *
 * 받기 — 노션의 요청 모양을 우리 블록으로. **엄격하게** — 틀리면 그 자리를 영어로 말한다(`body.children[0].paragraph.rich_text …`).
 *   · 한 배열 100개 · 한 요청 1000개 · 중첩 2단 · 글 조각 2000자(노션의 상한 · 정본 ④)
 *   · 우리에게 없는 타입(`link_to_page` · `synced_block` · `pdf` · `audio` …)은 그 이름을 말하고 거부한다 · `child_page` 는 노션처럼 `POST /v1/pages` 로
 *   · 구조는 앱의 규칙 그대로(레지스트리 `parentTypes` · `childTypes` · `excludedChildTypes`) — 컬럼 목록은 컬럼 둘 이상 · 컬럼마다 블록 하나
 *     이상 · 컬럼 바로 안에 컬럼 목록 없음 · 표의 행은 표 안에만 · 셀 수는 `table_width`
 *   · **정규형으로 쓴다** — 기본값은 키가 없다(색 `default` · 언어 `plain text` · 콜아웃 💡 · 빈 캡션 · 머리 플래그 false). 같은 뜻의 두 모양을
 *     두면 읽기의 정화가 고쳐 쓰거나(`block/props.ts`) 왕복이 어긋난다
 */

import { DEFAULT_CALLOUT_EMOJI, calloutGlyph } from '../block/callout.ts'
import { codeLanguageOf, MAX_CODE_LANGUAGE_LENGTH, PLAIN_TEXT_LANGUAGE } from '../block/code.ts'
import { isBookmarkUrl, readBookmarkUrl } from '../block/bookmark-block.ts'
import { readEmbedUrl } from '../block/embed-block.ts'
import { equationExpressionOf, MAX_EQUATION_LENGTH } from '../block/equation.ts'
import { externalFileName } from '../block/file-block.ts'
import { isSafeImageUrl, readImageSource } from '../block/image.ts'
import { cellsOf, COLUMN_HEADER_KEY, ROW_HEADER_KEY, TABLE_CELLS_KEY, TABLE_ROW_TYPE, TABLE_TYPE } from '../block/table.ts'
import { COLUMN_RATIO_KEY, isColumnRatio, MIN_COLUMNS, specOf, type BlockFormat, type BlockType } from '../block/types.ts'
import { isSingleEmoji } from '../contracts/emoji.ts'
import { isColor, MAX_LINK_URL, sanitizeRichText, splitText, textRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { plainTextOfRuns } from '../editor/pm-adapter.ts'
import { userRef } from './property-values.ts'
import { parseApiRichText, toApiRichText, type ApiLinks } from './rich-text.ts'
import { parseApiId, shownValue } from './v1-protocol.ts'

/** 한 `children` 배열의 상한 — 노션의 100. */
export const API_MAX_CHILDREN = 100
/** 한 요청의 블록 수(중첩 포함) — 정본 ④ 의 1000. */
export const API_MAX_BLOCKS = 1000
/** 한 요청 안의 중첩 — 노션의 2단(맨 위 블록의 자식 · 손자까지). 더 깊은 것은 다음 요청으로. */
export const API_MAX_NESTING = 2

/** 받는 타입 — 우리 타입 이름이 노션의 이름과 같다. */
export const WRITABLE_BLOCK_TYPES = [
  'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout',
  'code', 'divider', 'equation', 'table_of_contents', 'breadcrumb', 'column_list', 'column', 'table', 'table_row',
  'image', 'video', 'file', 'bookmark', 'embed',
] as const satisfies readonly BlockType[]
type WritableType = (typeof WRITABLE_BLOCK_TYPES)[number]
const WRITABLE: ReadonlySet<string> = new Set(WRITABLE_BLOCK_TYPES)

/** 노션에는 있지만 만들 수 없는 타입 — 이름을 말하고 거부한다. 모르는 이름은 "블록 타입이 아니다". */
export const UNWRITABLE_BLOCK_TYPES = [
  'child_page', 'child_database', 'link_to_page', 'synced_block', 'template', 'link_preview', 'pdf', 'audio', 'button', 'meeting_notes',
  'transcription', 'tab', 'unsupported',
] as const
const UNWRITABLE: ReadonlySet<string> = new Set(UNWRITABLE_BLOCK_TYPES)

const MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'video', 'file'])
const TEXT_TYPES: ReadonlySet<string> = new Set(['paragraph', 'bulleted_list_item', 'numbered_list_item', 'toggle', 'quote'])
const HEADING_TYPES: ReadonlySet<string> = new Set(['heading_1', 'heading_2', 'heading_3'])

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── 읽기 ──────────────────────────────────────────────────────────────

/** 참조 블록(하위 페이지 · 인라인 데이터베이스)이 싣는 것 — DB 가 채운다. 볼 수 없으면 빈 제목. */
export type RefInfo = { readonly title: string; readonly hasChildren: boolean }

export type BlockReadContext = {
  readonly links: ApiLinks
  readonly refs: ReadonlyMap<string, RefInfo>
  /** 올린 파일의 원래 이름(파일 블록의 `name`). */
  readonly fileNames: ReadonlyMap<string, string>
  /** 컬럼의 폭 — 컬럼 목록마다 합으로 나눈 값(`columnWidthsOf`). 없으면 같은 폭(생략). */
  readonly columnWidths: ReadonlyMap<string, number>
}

export type ApiBlockContent = { readonly type: string; readonly payload: Readonly<Record<string, unknown>>; readonly hasChildren: boolean }

/** 노션의 타입 이름 — 만들 때 · 고칠 때 본문의 열쇠와 견준다. */
export function apiTypeOf(block: EditorBlock): string {
  if (block.type === 'page') return 'child_page'
  if (block.type === 'database') return 'child_database'
  if (MEDIA_TYPES.has(block.type)) return readImageSource(block.properties) === null ? 'unsupported' : block.type
  return WRITABLE.has(block.type) ? block.type : 'unsupported'
}

const colorOf = (block: EditorBlock): string => (isColor(block.format?.block_color) ? block.format.block_color : 'default')
const runsOf = (raw: unknown): RichTextRun[] => sanitizeRichText(raw) ?? []

/** 표의 열 수 — 행의 셀 수(모든 행이 같다 · 정본 §3.4 심플 테이블 ①). 행이 없으면 1. */
export function tableWidthOf(table: EditorBlock): number {
  return Math.max(1, ...(table.children ?? []).filter((r) => r.type === TABLE_ROW_TYPE).map((r) => cellsOf(r.properties).length))
}

/**
 * 문서의 컬럼 폭 — 컬럼 목록마다 합으로 나눈다(정본 §3.4 컬럼 ⑥ — 동시에 고치면 합이 1 이 아닐 수 있다). 하나라도 없거나 틀리면 그 목록은
 * 같은 폭이다(싣지 않는다). 합이 이미 1 이면 저장값 그대로 — 왕복이 떠 있는 소수 오차로 어긋나지 않게.
 */
export function columnWidthsOf(doc: EditorDoc): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const b of blocks) {
      const kids = b.children ?? []
      if (b.type === 'column_list') {
        const ratios = kids.map((c) => c.format?.[COLUMN_RATIO_KEY])
        if (ratios.length > 0 && ratios.every(isColumnRatio)) {
          const sum = (ratios as number[]).reduce((a, r) => a + r, 0)
          kids.forEach((c, i) => {
            const r = ratios[i] as number
            out.set(c.id, Math.abs(sum - 1) < 1e-9 ? r : Math.round((r / sum) * 10_000) / 10_000)
          })
        }
      }
      walk(kids)
    }
  }
  walk(doc.blocks)
  return out
}

function captionToApi(block: EditorBlock, links: ApiLinks): unknown[] {
  return toApiRichText(runsOf(block.properties?.caption), links)
}

/** 블록 하나의 노션 내용(`type` · 그 타입의 페이로드 · `has_children`). */
export function blockContentToApi(block: EditorBlock, read: BlockReadContext): ApiBlockContent {
  const { links } = read
  const props = block.properties ?? {}
  const kids = block.children ?? []
  const make = (type: string, payload: Record<string, unknown>, hasChildren = kids.length > 0): ApiBlockContent => ({ type, payload, hasChildren })
  const text = () => toApiRichText(block.title, links)

  if (TEXT_TYPES.has(block.type)) return make(block.type, { rich_text: text(), color: colorOf(block) })
  if (HEADING_TYPES.has(block.type)) return make(block.type, { rich_text: text(), is_toggleable: false, color: colorOf(block) })
  switch (block.type) {
    case 'to_do':
      return make('to_do', { rich_text: text(), checked: props.checked === true, color: colorOf(block) })
    case 'callout':
      return make('callout', { rich_text: text(), icon: { type: 'emoji', emoji: calloutGlyph(props) }, color: colorOf(block) })
    case 'code':
      return make('code', { caption: captionToApi(block, links), rich_text: text(), language: codeLanguageOf(props) ?? PLAIN_TEXT_LANGUAGE })
    case 'divider':
    case 'breadcrumb':
    case 'column_list':
      return make(block.type, {})
    case 'equation':
      return make('equation', { expression: equationExpressionOf(props) })
    case 'table_of_contents':
      return make('table_of_contents', { color: colorOf(block) })
    case 'column': {
      const width = read.columnWidths.get(block.id)
      return make('column', width === undefined ? {} : { width_ratio: width })
    }
    case TABLE_TYPE:
      return make(TABLE_TYPE, {
        table_width: tableWidthOf(block),
        has_column_header: props[COLUMN_HEADER_KEY] === true,
        has_row_header: props[ROW_HEADER_KEY] === true,
      })
    case TABLE_ROW_TYPE:
      return make(TABLE_ROW_TYPE, { cells: cellsOf(props).map((cell) => toApiRichText(runsOf(cell), links)) }, false)
    case 'image':
    case 'video':
    case 'file': {
      const source = readImageSource(props)
      if (source === null) return make('unsupported', {}, false)
      const payload: Record<string, unknown> = { caption: captionToApi(block, links) }
      if (source.kind === 'external') {
        payload.type = 'external'
        payload.external = { url: source.url }
      } else {
        payload.type = 'file_upload'
        payload.file_upload = { id: source.fileId }
      }
      if (block.type === 'file') {
        payload.name = source.kind === 'external' ? externalFileName(source.url) : (read.fileNames.get(source.fileId) ?? '')
      }
      return make(block.type, payload, false)
    }
    case 'bookmark':
      return make('bookmark', { caption: captionToApi(block, links), url: readBookmarkUrl(props) ?? '' }, false)
    case 'embed':
      return make('embed', { caption: captionToApi(block, links), url: readEmbedUrl(props) ?? '' }, false)
    case 'page':
    case 'database': {
      const ref = read.refs.get(block.id)
      return make(block.type === 'page' ? 'child_page' : 'child_database', { title: ref?.title ?? '' }, ref?.hasChildren ?? false)
    }
    default:
      // 버튼 · 감싸 둔 모르는 타입 — 노션의 모양이 없다
      return make('unsupported', {}, false)
  }
}

/** 노션의 블록 객체 — 부모 · 시각 · 사람은 DB 가 준다. `archived` 는 싣지 않는다(정본 투영 규칙 — `in_trash` 만). */
export function apiBlockObject(
  id: string,
  content: ApiBlockContent,
  base: {
    readonly parent: Readonly<Record<string, unknown>>
    readonly createdTime: Date
    readonly lastEditedTime: Date
    readonly createdBy: string | null
    readonly lastEditedBy: string | null
    readonly inTrash: boolean
  },
): Record<string, unknown> {
  return {
    object: 'block',
    id,
    parent: base.parent,
    created_time: base.createdTime.toISOString(),
    last_edited_time: base.lastEditedTime.toISOString(),
    created_by: base.createdBy === null ? null : userRef(base.createdBy),
    last_edited_by: base.lastEditedBy === null ? null : userRef(base.lastEditedBy),
    has_children: content.hasChildren,
    in_trash: base.inTrash,
    type: content.type,
    [content.type]: content.payload,
  }
}

// ── 받기 ──────────────────────────────────────────────────────────────

/** 받은 블록이 가리키는 올린 파일 — 이 워크스페이스의 것인지 DB 가 본다. */
export type UploadRef = { readonly id: string; readonly blockType: 'image' | 'video' | 'file'; readonly path: string }

/** 받는 쪽에서 던지는 거부 — 경계에서 `{ ok: false, message }` 로 바뀐다. 밖으로 나가지 않는다. */
class Invalid extends Error {}
function fail(message: string): never {
  throw new Invalid(message)
}

type ParseState = { count: number; readonly newId: () => string; readonly uploads: UploadRef[] }

/** 받은 블록의 글 · 속성 · 모습. 표는 열 수도(자식 행의 셀 수를 본다). */
type Content = { title: RichTextRun[]; properties: Record<string, unknown>; format: BlockFormat; tableWidth?: number; textChanged: boolean; cellsChanged: boolean }

/** 타입마다 받는 키 — 그 밖은 `should be not present`(노션의 말투). `children` 은 자식을 가질 수 있는 타입만. */
const PAYLOAD_KEYS: Readonly<Record<WritableType, readonly string[]>> = {
  paragraph: ['rich_text', 'color'],
  heading_1: ['rich_text', 'color', 'is_toggleable'],
  heading_2: ['rich_text', 'color', 'is_toggleable'],
  heading_3: ['rich_text', 'color', 'is_toggleable'],
  bulleted_list_item: ['rich_text', 'color'],
  numbered_list_item: ['rich_text', 'color'],
  to_do: ['rich_text', 'checked', 'color'],
  toggle: ['rich_text', 'color'],
  quote: ['rich_text', 'color'],
  callout: ['rich_text', 'icon', 'color'],
  code: ['rich_text', 'language', 'caption'],
  divider: [],
  equation: ['expression'],
  table_of_contents: ['color'],
  breadcrumb: [],
  column_list: [],
  column: ['width_ratio'],
  table: ['table_width', 'has_column_header', 'has_row_header'],
  table_row: ['cells'],
  // `file`(노션이 호스팅한 주소)은 받아서 왜 안 되는지 말한다
  image: ['type', 'external', 'file_upload', 'file', 'caption'],
  video: ['type', 'external', 'file_upload', 'file', 'caption'],
  file: ['type', 'external', 'file_upload', 'file', 'caption', 'name'],
  bookmark: ['url', 'caption'],
  embed: ['url', 'caption'],
}

function richText(raw: unknown, path: string): RichTextRun[] {
  const parsed = parseApiRichText(raw, path)
  return parsed.ok ? parsed.runs : fail(parsed.message)
}

/** 평문 본문(코드)의 런 — 서식 · 멘션을 버린 글자(편집기의 `inlineForType` 과 같은 결과 · 2000자 조각). */
function plainRuns(runs: readonly RichTextRun[]): RichTextRun[] {
  return splitText(plainTextOfRuns(runs)).map((part) => textRun(part))
}

/**
 * 한 타입의 페이로드 → 글 · 속성 · 모습. `base` 가 없으면 만들기(필수 키를 본다), 있으면 고치기(준 키만 바꾼다 — 노션의 PATCH).
 * 표의 열 수는 고치기에서 `tableWidth`(지금의 열 수)로 받는다.
 */
function contentOf(type: WritableType, payload: Obj, p: string, state: ParseState, base: EditorBlock | null, tableWidth?: number): Content {
  const create = base === null
  const has = (key: string): boolean => payload[key] !== undefined
  const properties: Record<string, unknown> = { ...(base?.properties ?? {}) }
  const format: BlockFormat = { ...(base?.format ?? {}) }
  let title: RichTextRun[] = [...(base?.title ?? [])]
  let textChanged = false
  let cellsChanged = false
  let width = tableWidth

  const takeText = (plain = false): void => {
    if (!has('rich_text')) {
      if (create) fail(`${p}.rich_text should be defined, instead was undefined.`)
      return
    }
    const runs = richText(payload.rich_text, `${p}.rich_text`)
    title = plain ? plainRuns(runs) : runs
    textChanged = true
  }
  const takeColor = (): void => {
    if (!has('color')) return
    if (!isColor(payload.color)) fail(`${p}.color should be a valid color, instead was ${shownValue(payload.color)}.`)
    if (payload.color === 'default') delete format.block_color
    else format.block_color = payload.color as BlockFormat['block_color']
  }
  const takeCaption = (): void => {
    if (!has('caption')) return
    const runs = richText(payload.caption, `${p}.caption`)
    if (runs.length === 0) delete properties.caption
    else properties.caption = runs
  }
  const takeBoolean = (key: string, into: string, keepFalse: boolean): void => {
    if (!has(key)) {
      if (create && keepFalse) properties[into] = false
      return
    }
    if (typeof payload[key] !== 'boolean') fail(`${p}.${key} should be a boolean, instead was ${shownValue(payload[key])}.`)
    if (payload[key] === true || keepFalse) properties[into] = payload[key]
    else delete properties[into]
  }

  if (TEXT_TYPES.has(type)) {
    takeText()
    takeColor()
  } else if (HEADING_TYPES.has(type)) {
    if (has('is_toggleable') && payload.is_toggleable !== false) {
      fail(`${p}.is_toggleable should be false — toggle headings are not supported. Use a toggle block instead.`)
    }
    takeText()
    takeColor()
  } else {
    switch (type) {
      case 'to_do':
        takeText()
        // 할 일은 늘 `checked` 를 싣는다(편집기가 만드는 모양 · 없으면 false)
        takeBoolean('checked', 'checked', true)
        takeColor()
        break
      case 'callout': {
        takeText()
        takeColor()
        if (!has('icon')) break
        const icon = payload.icon
        if (icon === null) {
          delete properties.icon
          break
        }
        if (!isObject(icon)) fail(`${p}.icon should be an object or \`null\`, instead was ${shownValue(icon)}.`)
        const kind = (icon as Obj).type ?? ('emoji' in (icon as Obj) ? 'emoji' : undefined)
        if (kind !== 'emoji') fail(`${p}.icon.type ${shownValue(kind)} is not supported for callouts. Use an emoji icon.`)
        const emoji = (icon as Obj).emoji
        if (typeof emoji !== 'string' || !isSingleEmoji(emoji)) fail(`${p}.icon.emoji should be a single emoji, instead was ${shownValue(emoji)}.`)
        // 💡 는 저장하지 않는 기본값이다(정본 §3.4 콜아웃 아이콘 ②)
        if (emoji === DEFAULT_CALLOUT_EMOJI) delete properties.icon
        else properties.icon = { type: 'emoji', emoji }
        break
      }
      case 'code': {
        takeText(true)
        takeCaption()
        if (!has('language')) break
        const language = payload.language
        if (typeof language !== 'string' || language.trim() === '') fail(`${p}.language should be a non-empty string, instead was ${shownValue(language)}.`)
        const value = (language as string).trim()
        if (value.length > MAX_CODE_LANGUAGE_LENGTH) fail(`${p}.language.length should be ≤ ${MAX_CODE_LANGUAGE_LENGTH}, instead was ${value.length}.`)
        if (value.toLowerCase() === PLAIN_TEXT_LANGUAGE) delete properties.language
        else properties.language = value
        break
      }
      case 'equation': {
        if (!has('expression')) {
          if (create) fail(`${p}.expression should be defined, instead was undefined.`)
          break
        }
        const expression = payload.expression
        if (typeof expression !== 'string') fail(`${p}.expression should be a string, instead was ${shownValue(expression)}.`)
        if ((expression as string).length > MAX_EQUATION_LENGTH) {
          fail(`${p}.expression.length should be ≤ ${MAX_EQUATION_LENGTH}, instead was ${(expression as string).length}.`)
        }
        if ((expression as string).trim() === '') delete properties.expression
        else properties.expression = expression
        break
      }
      case 'table_of_contents':
        takeColor()
        break
      case 'column':
        if (!has('width_ratio')) break
        if (!isColumnRatio(payload.width_ratio)) fail(`${p}.width_ratio should be a number greater than 0 and at most 1, instead was ${shownValue(payload.width_ratio)}.`)
        format[COLUMN_RATIO_KEY] = payload.width_ratio
        break
      case TABLE_TYPE: {
        if (has('table_width')) {
          const w = payload.table_width
          if (typeof w !== 'number' || !Number.isInteger(w) || w < 1 || w > API_MAX_CHILDREN) {
            fail(`${p}.table_width should be an integer between 1 and ${API_MAX_CHILDREN}, instead was ${shownValue(w)}.`)
          }
          if (!create && w !== tableWidth) fail(`${p}.table_width cannot be changed (the table has ${tableWidth} columns).`)
          width = w as number
        } else if (create) {
          fail(`${p}.table_width should be defined, instead was undefined.`)
        }
        takeBoolean('has_column_header', COLUMN_HEADER_KEY, false)
        takeBoolean('has_row_header', ROW_HEADER_KEY, false)
        break
      }
      case TABLE_ROW_TYPE: {
        if (!has('cells')) {
          if (create) fail(`${p}.cells should be defined, instead was undefined.`)
          break
        }
        if (!Array.isArray(payload.cells)) fail(`${p}.cells should be an array, instead was ${shownValue(payload.cells)}.`)
        const cells = (payload.cells as unknown[]).map((cell, i) => richText(cell, `${p}.cells[${i}]`))
        if (cells.length === 0) fail(`${p}.cells should have at least 1 cell, instead had 0.`)
        if (tableWidth !== undefined && cells.length !== tableWidth) {
          fail(`${p}.cells should have ${tableWidth} cells (the table_width), instead had ${cells.length}.`)
        }
        properties[TABLE_CELLS_KEY] = cells
        cellsChanged = true
        break
      }
      case 'image':
      case 'video':
      case 'file': {
        const kind = payload.type ?? (has('external') ? 'external' : has('file_upload') ? 'file_upload' : has('file') ? 'file' : undefined)
        // 출처는 하나 — 고른 종류 밖의 출처 키는 받지 않는다
        for (const other of ['external', 'file_upload', 'file']) {
          if (kind !== undefined && other !== kind && has(other)) fail(`${p}.${other} should be not present, instead was ${shownValue(payload[other])}.`)
        }
        if (kind === undefined) {
          if (create) fail(`${p}.external should be defined, instead was undefined.`)
        } else if (kind === 'external') {
          const url = isObject(payload.external) ? payload.external.url : undefined
          if (typeof url !== 'string' || !isSafeImageUrl(url)) fail(`${p}.external.url should be an http or https URL, instead was ${shownValue(url)}.`)
          if ((url as string).length > MAX_LINK_URL) fail(`${p}.external.url.length should be ≤ ${MAX_LINK_URL}, instead was ${(url as string).length}.`)
          properties.source = { type: 'external', url }
        } else if (kind === 'file_upload') {
          const raw = isObject(payload.file_upload) ? payload.file_upload.id : undefined
          const id = parseApiId(raw)
          if (id === null) fail(`${p}.file_upload.id should be a valid uuid, instead was ${shownValue(raw)}.`)
          properties.source = { type: 'file', file_id: id }
          state.uploads.push({ id: id as string, blockType: type, path: `${p}.file_upload.id` })
        } else if (kind === 'file') {
          fail(`${p}.type "file" cannot be written — use "external" or "file_upload".`)
        } else {
          fail(`${p}.type should be "external" or "file_upload", instead was ${shownValue(kind)}.`)
        }
        takeCaption()
        // `name`(파일)은 받기만 한다 — 바깥 주소의 이름은 주소에서, 올린 파일의 이름은 파일에서 온다
        if (has('name') && typeof payload.name !== 'string') fail(`${p}.name should be a string, instead was ${shownValue(payload.name)}.`)
        break
      }
      case 'bookmark':
      case 'embed': {
        if (!has('url')) {
          if (create) fail(`${p}.url should be defined, instead was undefined.`)
        } else {
          const url = payload.url
          if (typeof url !== 'string') fail(`${p}.url should be a string, instead was ${shownValue(url)}.`)
          if (url === '') delete properties.url
          else if (!isBookmarkUrl(url)) fail(`${p}.url should be an http or https URL, instead was ${shownValue(url)}.`)
          else properties.url = url
        }
        takeCaption()
        break
      }
      // divider · breadcrumb · column_list — 실을 것이 없다
    }
  }
  return { title, properties, format, tableWidth: width, textChanged, cellsChanged }
}

/** 이 부모 밑에 설 수 있는가 — 레지스트리의 규칙(정본 §3.4 컬럼 ③ · 심플 테이블 ①). 페이지는 `page` 타입이다(아무것이나 받는다). */
function placementIssue(type: BlockType, parent: BlockType, at: string): string | null {
  const parents = specOf(type).parentTypes
  if (parents !== undefined && !parents.includes(parent)) return `${at}.type "${type}" can only be a child of a ${parents.join(' or ')}.`
  const allowed = specOf(parent).childTypes
  if (allowed !== undefined && !allowed.includes(type)) {
    return `${at}.type should be ${allowed.map((t) => `"${t}"`).join(' or ')} inside a ${parent}, instead was "${type}".`
  }
  if (specOf(parent).excludedChildTypes?.includes(type)) return `${at}.type "${type}" cannot be placed directly inside a ${parent}.`
  return null
}

function unwritableMessage(at: string, kind: string): string {
  if (kind === 'child_page') return `${at}.type "child_page" cannot be created by appending blocks. Create the page with POST /v1/pages instead.`
  if (kind === 'child_database') return `${at}.type "child_database" cannot be created by appending blocks. Create the database in the app instead.`
  if (UNWRITABLE.has(kind)) return `${at}.type "${kind}" is not supported.`
  return `${at}.type should be a block type, instead was ${shownValue(kind)}.`
}

function parseBlock(raw: unknown, at: string, parent: BlockType, tableWidth: number | undefined, nesting: number, state: ParseState): EditorBlock {
  if (!isObject(raw)) fail(`${at} should be an object, instead was ${shownValue(raw)}.`)
  const item = raw as Obj
  if (item.object !== undefined && item.object !== 'block') fail(`${at}.object should be "block", instead was ${shownValue(item.object)}.`)
  const kind = item.type ?? Object.keys(item).find((k) => k !== 'object' && k !== 'type')
  if (typeof kind !== 'string') fail(`${at}.type should be defined, instead was ${shownValue(item.type)}.`)
  const name = kind as string
  const extra = Object.keys(item).find((k) => k !== 'object' && k !== 'type' && k !== name)
  if (extra !== undefined) fail(`${at}.${extra} should be not present, instead was ${shownValue(item[extra])}.`)
  if (!WRITABLE.has(name)) fail(unwritableMessage(at, name))
  const type = name as WritableType
  const payload = item[name]
  if (!isObject(payload)) fail(`${at}.${name} should be an object, instead was ${shownValue(payload)}.`)
  const placed = placementIssue(type, parent, at)
  if (placed !== null) fail(placed)

  const p = `${at}.${name}`
  const body = payload as Obj
  const allowed = specOf(type).canHaveChildren ? [...PAYLOAD_KEYS[type], 'children'] : PAYLOAD_KEYS[type]
  const extraKey = Object.keys(body).find((k) => !allowed.includes(k))
  if (extraKey !== undefined) fail(`${p}.${extraKey} should be not present, instead was ${shownValue(body[extraKey])}.`)

  const content = contentOf(type, body, p, state, null, type === TABLE_ROW_TYPE ? tableWidth : undefined)
  let children: EditorBlock[] = []
  if (body.children !== undefined) {
    if (nesting + 1 > API_MAX_NESTING) {
      fail(`${p}.children should be not present — a request can nest children at most ${API_MAX_NESTING} levels deep. Append deeper blocks with another request.`)
    }
    children = parseList(body.children, `${p}.children`, type, type === TABLE_TYPE ? content.tableWidth : undefined, nesting + 1, state)
  }
  if (type === 'column_list' && children.length < MIN_COLUMNS) fail(`${p}.children should have at least ${MIN_COLUMNS} columns, instead had ${children.length}.`)
  if (type === 'column' && children.length === 0) fail(`${p}.children should have at least 1 block, instead had 0.`)
  if (type === TABLE_TYPE && children.length === 0) fail(`${p}.children should have at least 1 table_row, instead had 0.`)

  return { id: state.newId(), type, title: specOf(type).hasRichText ? content.title : [], properties: content.properties, format: content.format, children }
}

function parseList(raw: unknown, at: string, parent: BlockType, tableWidth: number | undefined, nesting: number, state: ParseState): EditorBlock[] {
  if (!Array.isArray(raw)) fail(`${at} should be an array, instead was ${shownValue(raw)}.`)
  const list = raw as unknown[]
  if (list.length > API_MAX_CHILDREN) fail(`${at}.length should be ≤ ${API_MAX_CHILDREN}, instead was ${list.length}.`)
  const out: EditorBlock[] = []
  for (const [i, item] of list.entries()) {
    state.count += 1
    if (state.count > API_MAX_BLOCKS) fail(`body has more than ${API_MAX_BLOCKS} blocks. Send at most ${API_MAX_BLOCKS} blocks per request.`)
    out.push(parseBlock(item, `${at}[${i}]`, parent, tableWidth, nesting, state))
  }
  return out
}

export type ParsedChildren =
  | { readonly ok: true; readonly blocks: EditorBlock[]; readonly uploads: readonly UploadRef[] }
  | { readonly ok: false; readonly message: string }

/**
 * 노션의 `children` 배열 → 우리 블록들(새 id). `parent` 는 붙일 자리의 타입 — 페이지면 `page`, 표면 `table`(+ 지금의 열 수).
 * 오류 글은 `path` 를 앞에 둔다(`body.children`). 부르는 쪽이 `body failed validation: ` 을 붙인다.
 */
export function parseApiChildren(
  raw: unknown,
  path: string,
  parent: BlockType,
  newId: () => string,
  options: { readonly tableWidth?: number } = {},
): ParsedChildren {
  const state: ParseState = { count: 0, newId, uploads: [] }
  try {
    return { ok: true, blocks: parseList(raw, path, parent, options.tableWidth, 0, state), uploads: state.uploads }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, message: e.message }
    throw e
  }
}

export type ParsedUpdate =
  | {
      readonly ok: true
      /** 고친 블록 — 자식은 그대로다. */
      readonly next: EditorBlock
      /** 글(`rich_text`)을 바꿨는가 — 아니면 글 노드를 건드리지 않는다(그 안의 제안 마크를 지킨다). */
      readonly textChanged: boolean
      /** 표 행의 셀을 바꿨는가. */
      readonly cellsChanged: boolean
      readonly uploads: readonly UploadRef[]
    }
  | { readonly ok: false; readonly message: string }

/**
 * `PATCH /v1/blocks/{id}` 의 `{ [type]: payload }` 를 지금 블록에 — 준 키만 바꾼다(노션). 열쇠는 그 블록의 노션 타입이어야 한다(타입은
 * 바꿀 수 없다). `children` 은 받지 않는다(붙이기는 `PATCH …/children`). 표 행은 표의 열 수(`tableWidth`)를 받아 셀 수를 본다.
 */
export function parseApiBlockUpdate(block: EditorBlock, payload: unknown, path: string, options: { readonly tableWidth?: number } = {}): ParsedUpdate {
  const type = block.type
  const state: ParseState = { count: 0, newId: () => block.id, uploads: [] }
  try {
    if (!WRITABLE.has(type)) fail(`${path} cannot be updated — blocks of type "${apiTypeOf(block)}" are not editable through the API.`)
    if (!isObject(payload)) fail(`${path} should be an object, instead was ${shownValue(payload)}.`)
    const body = payload as Obj
    const writable = type as WritableType
    const extraKey = Object.keys(body).find((k) => !PAYLOAD_KEYS[writable].includes(k))
    if (extraKey !== undefined) fail(`${path}.${extraKey} should be not present, instead was ${shownValue(body[extraKey])}.`)
    const width = type === TABLE_TYPE ? tableWidthOf(block) : options.tableWidth
    const content = contentOf(writable, body, path, state, block, width)
    return {
      ok: true,
      next: { ...block, title: specOf(type).hasRichText ? content.title : [], properties: content.properties, format: content.format },
      textChanged: content.textChanged,
      cellsChanged: content.cellsChanged,
      uploads: state.uploads,
    }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, message: e.message }
    throw e
  }
}
