/**
 * EditorDoc ↔ ProseMirror 문서 — F-09-03 이 요구한 플래튼/병합 어댑터
 *
 * 정본: 09-api-integrations.md F-09-03
 *   "rich text 는 중첩되지 않는 **플랫 런 배열**이다. 클론이 ProseMirror/Slate
 *    같은 **중첩 mark 모델**을 쓰면 **직렬화 시 플래튼, 역직렬화 시 병합**
 *    어댑터가 **반드시 필요**하다."
 *
 * `contracts/rich-text.ts` 가 이 문장을 인용하며 "우리는 ProseMirror 를 쓰기로
 * 했으므로 이 어댑터가 필수다"라고 적어두었다. 이 파일이 그것이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 두 모델의 차이
 * ──────────────────────────────────────────────────────────────────────
 *
 *   RichText[]  : [{text:'가나', bold:true}, {text:'다', bold:false}]  ← 플랫
 *   ProseMirror : text('가나', [bold]), text('다', [])                 ← 마크 집합
 *
 * 겉보기에 비슷하지만 두 지점에서 어긋난다.
 *
 *   ① ProseMirror 는 **인접한 같은 마크의 텍스트를 합쳐 준다**. 우리 쪽에서
 *      런 경계를 유지하려 해도 유지되지 않는다 → 애초에 정규형으로 저장한다
 *      (`canonicalizeRuns`).
 *   ② `annotations` 는 **항상 6개 필드가 전부 있는 객체**이고 마크는 **있거나
 *      없거나**다. 없는 것을 false 로 채우는 자리가 여기다. 빠뜨리면
 *      `validateRichText` 가 거부한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 오프셋이 두 모델에서 같다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `rich-text-ops.ts` 가 오프셋 단위를 "원자는 길이 1"로 정한 이유가 여기서
 * 회수된다. ProseMirror 의 inline atom 도 `nodeSize === 1` 이므로
 * **텍스트블록 안의 오프셋이 두 모델에서 같은 수**다. 변환이 없으므로
 * 변환 버그도 없다 — 캐럿이 멘션 한가운데로 계산되는 일이 생길 수 없다.
 */

import { Fragment, Node as PmNode, Mark } from '@tiptap/pm/model'

import { sanitizeBlockAttrs } from '../block/props.ts'
import { cellsOf, rowPropsWithoutCells, TABLE_CELLS_KEY, TABLE_ROW_TYPE, TABLE_TYPE } from '../block/table.ts'
import { isPlainRecord, jsonSafe, withoutNul } from '../contracts/json-safe.ts'
import {
  DEFAULT_ANNOTATIONS,
  isColor,
  type Annotations,
  type MentionType,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import {
  isKnownBlockType,
  normalizeFormat,
  specOf,
  PAGE_TYPE,
  UNSUPPORTED_TYPE,
  type BlockFormat,
  type BlockType,
} from '../block/types.ts'
import { createInlineAtom } from './atom-marks.ts'
import { canonicalizeRuns } from './rich-text-ops.ts'
import {
  blockSchema,
  blockTypeOfNode,
  BOOLEAN_MARK_NAMES,
  EQUATION_NODE,
  MENTION_NODE,
  nodeNameOf,
  PAGE_REF_NODE,
  TABLE_CELL_NODE,
  TABLE_NODE,
  TABLE_ROW_NODE,
} from './schema.ts'
import type { EditorBlock, EditorDoc } from './document.ts'

/** 브라우저와 Node 양쪽에서 동작하는 uuid. 빈 문서를 채울 때 쓴다. */
export function newBlockId(): string {
  return globalThis.crypto.randomUUID()
}

// ── RichText[] → ProseMirror inline ───────────────────────────────────

function marksFor(annotations: Annotations, linkUrl: string | null): Mark[] {
  const marks: Mark[] = []
  for (const name of BOOLEAN_MARK_NAMES) {
    if (annotations[name]) marks.push(blockSchema.marks[name].create())
  }
  // 'default' 는 "색 없음"이다. 마크로 만들면 문서가 마크로 가득 차고,
  // 왕복 후 런 경계가 달라진다.
  if (annotations.color !== 'default') {
    marks.push(blockSchema.marks.color.create({ color: annotations.color }))
  }
  if (linkUrl !== null) marks.push(blockSchema.marks.link.create({ href: linkUrl }))
  return marks
}

/** 런 배열을 인라인 노드 배열로. 빈 텍스트 런은 만들지 않는다(PM 이 거부한다). */
export function runsToInline(runs: readonly RichTextRun[]): PmNode[] {
  const out: PmNode[] = []

  for (const run of runs) {
    const annotations = { ...DEFAULT_ANNOTATIONS, ...run.annotations }
    const link = run.text?.link?.url ?? null
    const marks = marksFor(annotations, link)

    // 글자는 읽기(정규화)와 같은 모양으로 쓴다 — U+0000 은 jsonb 가 받지 않아 읽을 때마다 고쳐 쓰게 된다(8a-2 · `nul_replaced`).
    if (run.type === 'text') {
      const content = withoutNul(run.text?.content ?? '')
      if (content === '') continue
      out.push(blockSchema.text(content, marks))
      continue
    }

    // 원자의 서식은 attr 에도 비춘다 — 협업 바인딩이 Y.Doc 에 싣는 것은 attr 뿐이다(`atom-marks.ts`).
    if (run.type === 'equation') {
      out.push(createInlineAtom(blockSchema.nodes[EQUATION_NODE], { expression: withoutNul(run.equation?.expression ?? '') }, marks))
      continue
    }

    const mention = jsonSafe(run.mention ?? {})
    out.push(
      createInlineAtom(
        blockSchema.nodes[MENTION_NODE],
        { mention: isPlainRecord(mention) ? mention : {}, plainText: withoutNul(run.plain_text ?? '') },
        marks,
      ),
    )
  }

  return out
}

// ── ProseMirror inline → RichText[] ───────────────────────────────────

function annotationsFrom(marks: readonly Mark[]): { annotations: Annotations; link: string | null } {
  const annotations: Annotations = { ...DEFAULT_ANNOTATIONS }
  let link: string | null = null

  for (const mark of marks) {
    if ((BOOLEAN_MARK_NAMES as readonly string[]).includes(mark.type.name)) {
      annotations[mark.type.name as (typeof BOOLEAN_MARK_NAMES)[number]] = true
    } else if (mark.type.name === 'color') {
      // 계약에 없는 색이 들어오면 무시한다. 저장하면 validateRichText 가
      // 거부해서 페이지 전체가 저장 불가가 된다 — 서식 하나 때문에.
      if (isColor(mark.attrs.color)) annotations.color = mark.attrs.color
    } else if (mark.type.name === 'link') {
      link = typeof mark.attrs.href === 'string' ? mark.attrs.href : null
    }
  }

  return { annotations, link }
}

/**
 * 인라인 조각을 플랫 런 배열로.
 *
 * 마지막에 `canonicalizeRuns` 를 돌려 계약 정규형으로 만든다 — 인접 동일
 * 서식 병합 + 2000자 초과 런 분할. 이걸 빼면 저장 시 `validateRichText` 가
 * 거부하는 값이 나올 수 있다.
 */
export function inlineToRuns(fragment: Fragment): RichTextRun[] {
  const runs: RichTextRun[] = []

  fragment.forEach((node) => {
    const { annotations, link } = annotationsFrom(node.marks)

    if (node.isText) {
      const content = node.text ?? ''
      runs.push({
        type: 'text',
        annotations,
        plain_text: content,
        href: link,
        text: { content, link: link === null ? null : { url: link } },
      })
      return
    }

    // 원자의 attr 은 협업 참여자가 무엇이든 쓸 수 있다 — 문자열일 때만 읽는다(`String()` 은 던질 수 있다 · 8a-2). 서버의 읽기는 정규화가
    // 이미 고쳤다(`invalid_inline_fixed`) — 이것은 편집기 쪽 읽기(복사 · 내보내기)의 방어다.
    if (node.type.name === EQUATION_NODE) {
      const expression = typeof node.attrs.expression === 'string' ? node.attrs.expression : ''
      runs.push({
        type: 'equation',
        annotations,
        plain_text: expression,
        href: null,
        equation: { expression },
      })
      return
    }

    if (node.type.name === MENTION_NODE) {
      const safe = jsonSafe(node.attrs.mention)
      const mention = (isPlainRecord(safe) ? safe : {}) as { type?: MentionType }
      runs.push({
        type: 'mention',
        annotations,
        plain_text: typeof node.attrs.plainText === 'string' ? node.attrs.plainText : '',
        href: null,
        mention: { type: mention.type ?? 'page', ...mention },
      })
    }
  })

  return canonicalizeRuns(runs)
}

// ── EditorDoc → ProseMirror doc ───────────────────────────────────────

function contentNodeFor(block: EditorBlock): PmNode {
  // 타입이 받지 않는 색은 뺀다 — 투영(`projectDocument`)이 행에서 빼는 것과 같은 규칙(`normalizeFormat`). Y.Doc 에만 남으면 행과
  // Y.Doc 이 다른 본문이 된다(8a-1 이 코드 블록으로 찾았다 · 구분선 · 이미지도 같았다). 속성도 읽기의 정화(`sanitizeBlockAttrs`)를
  // 거친 모양으로 쓴다 — 받은 캡션의 `plain_text` 가 없거나 낡으면 읽기가 다시 계산해 **저장할 때마다 수선이 고쳐 썼다**(8a-2 리뷰 ·
  // 정본 ⑧ — 로그가 저장마다 한 줄씩 자랐다).
  const known: BlockType = isKnownBlockType(block.type) ? block.type : UNSUPPORTED_TYPE
  const { props, format } = sanitizeBlockAttrs(
    block.type === PAGE_TYPE ? PAGE_TYPE : known,
    { ...(block.properties ?? {}) },
    normalizeFormat(known, block.format),
  )

  if (block.type === PAGE_TYPE) {
    // 참조 노드는 제목을 싣지 않는다(`schema.ts` · HANDOFF §3.2-22). 받은 문서에 제목이 있어도(옛 클라이언트 · 저장 큐) 버린다 —
    // 여기서 옮기면 본문 저장이 그 제목을 Y.Doc 에 써 넣는다.
    return blockSchema.nodes[PAGE_REF_NODE].create({ props, format })
  }

  const type: BlockType = isKnownBlockType(block.type) ? block.type : UNSUPPORTED_TYPE
  if (type === UNSUPPORTED_TYPE) {
    return blockSchema.nodes[UNSUPPORTED_TYPE].create({ props, format })
  }

  if (specOf(type).childrenInContent) return tableNodeFor(block, props, format)

  const nodeType = blockSchema.nodes[nodeNameOf(type)]
  if (specOf(type).hasRichText) {
    return nodeType.create({ props, format }, inlineForType(type, block.title))
  }
  return nodeType.create({ props, format })
}

/**
 * 표의 내용 노드(Phase 2 1d) — 자식 행 블록들을 행 노드로(`rowId` = 행의 id · 셀 = `properties.cells` · 셀 밖의 행 속성은 `props`).
 * 셀 수가 다른 행은 가장 긴 행에 맞춰 빈 셀로 채우고, 행이 없으면 빈 셀 하나의 행 하나다(id 는 센티널 — 찍기 · 정규화가 준다). 저장
 * API 가 이미 막는 모양이지만 노드는 스키마에 맞아야 한다 — 정규화 ⑤ 와 같은 결과다. 행이 아닌 자식은 싣지 않는다(검증이 거부한다).
 */
function tableNodeFor(block: EditorBlock, props: Record<string, unknown>, format: BlockFormat): PmNode {
  const { [TABLE_NODE]: TABLE, [TABLE_ROW_NODE]: ROW, [TABLE_CELL_NODE]: CELL } = blockSchema.nodes
  const rows = (block.children ?? []).filter((child) => child.type === TABLE_ROW_TYPE)
  const grid = rows.map((row) => cellsOf(row.properties))
  const width = Math.max(1, ...grid.map((cells) => cells.length))
  const rowNode = (rowId: string, rowProps: Record<string, unknown>, cells: readonly (readonly RichTextRun[])[]): PmNode =>
    ROW!.create({ rowId, props: rowProps }, Array.from({ length: width }, (_, i) => CELL!.create(null, runsToInline(cells[i] ?? []))))
  const safeProps = (row: EditorBlock): Record<string, unknown> => {
    const safe = jsonSafe(rowPropsWithoutCells(row.properties))
    return isPlainRecord(safe) ? safe : {}
  }
  const nodes = rows.length > 0 ? rows.map((row, i) => rowNode(row.id, safeProps(row), grid[i]!)) : [rowNode('', {}, [])]
  return TABLE!.create({ props, format }, nodes)
}

/**
 * 이 타입의 내용 노드에 넣을 인라인 — 보통은 런 그대로(`runsToInline`), **평문 본문(코드 블록 · 8a-1)은 서식 · 멘션 · 수식을
 * 버린 글자 하나**다(스키마가 `text*` · 마크 없음이다 — 서식이 든 인라인을 넣으면 ProseMirror 가 던진다). 내용 노드를 만들거나
 * 글자를 갈아 끼우는 곳은 이것을 거친다(`contentNodeFor` · `commands.ts`).
 */
export function inlineForType(type: BlockType, runs: readonly RichTextRun[] | undefined): PmNode[] {
  if (!specOf(type).plainText) return runsToInline(runs ?? [])
  const text = withoutNul(plainTextOfRuns(runs))
  return text === '' ? [] : [blockSchema.text(text)]
}

/** 런을 보이는 글자로 — 글자 · 수식의 식. 멘션은 보이는 글자를 저장하지 않으므로(정본 §3.9) 빈 글자다. */
export function plainTextOfRuns(runs: readonly RichTextRun[] | undefined): string {
  return (runs ?? []).map((r) => (r.type === 'text' ? (r.text?.content ?? '') : r.type === 'equation' ? (r.equation?.expression ?? '') : '')).join('')
}

export function containerFor(block: EditorBlock): PmNode {
  const content = contentNodeFor(block)
  const children = block.children ?? []

  // 자식 페이지의 본문은 이 문서의 것이 아니다(document.ts 가 검증한다). 표의 행은 내용 노드 안에 이미 실었다(Phase 2 1d).
  const inContent = isKnownBlockType(block.type) && specOf(block.type).childrenInContent === true
  const group =
    block.type !== PAGE_TYPE && !inContent && children.length > 0
      ? [blockSchema.nodes.blockGroup.create(null, children.map(containerFor))]
      : []

  return blockSchema.nodes.blockContainer.create({ blockId: block.id }, [content, ...group])
}

/** 빈 문단 하나. 빈 페이지를 열 때 화면에 캐럿을 둘 자리가 필요하다. */
export function emptyParagraphContainer(blockId: string = newBlockId()): PmNode {
  return blockSchema.nodes.blockContainer.create({ blockId }, [
    blockSchema.nodes.paragraph.create({ props: {}, format: {} }),
  ])
}

/**
 * 문서를 ProseMirror 문서로.
 *
 * 빈 문서는 **빈 문단 하나로 합성한다.** 스키마가 `blockContainer+` 를
 * 요구하기도 하지만, 그보다 사용자가 빈 페이지에서 타이핑할 자리가 필요하다.
 * 서버에는 빈 배열로 저장돼 있고(`save-page-body.ts`) 화면에서만 합성한다 —
 * "한 번도 열지 않은 페이지"와 "열어서 비운 페이지"를 구분하기 위해서다.
 */
export function docToPm(doc: EditorDoc): PmNode {
  const containers =
    doc.blocks.length > 0 ? doc.blocks.map(containerFor) : [emptyParagraphContainer()]

  return blockSchema.nodes.doc.create(null, blockSchema.nodes.blockGroup.create(null, containers))
}

// ── ProseMirror doc → EditorDoc ───────────────────────────────────────

export function blockFromContainer(container: PmNode): EditorBlock {
  const content = container.child(0)
  const group = container.childCount > 1 ? container.child(1) : null

  // `blockId` 의 스키마 default 는 빈 문자열 센티널이다(schema.ts 주석 참조).
  // ProseMirror 가 새로 만든 컨테이너(예: `splitBlock`)는 id 가 비어 있으므로
  // 여기서 찍는다. 에디터의 스탬프 플러그인이 먼저 찍어 두는 것이 정상 경로이고
  // 이건 마지막 방어선이다 — 빈 id 가 서버로 가면 `validateDoc` 이 거부한다.
  const blockId = String(container.attrs.blockId || '') || newBlockId()

  const children: EditorBlock[] = []
  if (group) {
    group.forEach((child) => children.push(blockFromContainer(child)))
  }

  const props = { ...((content.attrs.props ?? {}) as Record<string, unknown>) }
  const format = { ...((content.attrs.format ?? {}) as BlockFormat) }

  if (content.type.name === PAGE_REF_NODE) {
    // 참조 노드는 순서만 의미가 있다. 제목은 프로젝터가 무시한다.
    return { id: blockId, type: PAGE_TYPE, title: [], properties: props, format }
  }

  // 표(Phase 2 1d) — 행 노드가 자식 행 블록이 된다(id = `rowId` · 셀 = 셀 노드의 런). 비었으면 찍는다(`blockId` 와 같은 방어선).
  if (content.type.name === TABLE_NODE) {
    const rows: EditorBlock[] = []
    content.forEach((row) => {
      if (row.type.name !== TABLE_ROW_NODE) return
      const cells: RichTextRun[][] = []
      row.forEach((cell) => {
        if (cell.type.name === TABLE_CELL_NODE) cells.push(inlineToRuns(cell.content))
      })
      const rowProps = isPlainRecord(row.attrs.props) ? { ...row.attrs.props } : {}
      rows.push({
        id: String(row.attrs.rowId || '') || newBlockId(),
        type: TABLE_ROW_TYPE,
        title: [],
        properties: { ...rowProps, [TABLE_CELLS_KEY]: cells },
        format: {},
        children: [],
      })
    })
    return { id: blockId, type: TABLE_TYPE, title: [], properties: props, format, children: rows }
  }

  // 노드 이름 → 타입(`code_block` → `code` · 8a-1). 이름을 그대로 쓰면 `specOf` 가 undefined 가 되어 저장이 깨진다.
  const type: BlockType = blockTypeOfNode(content.type.name)

  return {
    id: blockId,
    type,
    title: specOf(type).hasRichText ? inlineToRuns(content.content) : [],
    properties: props,
    format,
    children,
  }
}

/**
 * ProseMirror 문서를 저장 가능한 문서로.
 *
 * **빈 문단 하나뿐이면 빈 문서로 되돌린다.** `docToPm` 이 합성한 것을 그대로
 * 저장하면, 페이지를 열어보기만 해도 블록이 하나 생긴다.
 */
export function pmToDoc(doc: PmNode): EditorDoc {
  // 루트 그룹이 둘 이상이면 차례로 잇는다. 편집으로는 생기지 않고 합친 Y.Doc 을 비출 때만 생기지만
  // (`schema.ts` 의 `doc`), 첫 그룹만 읽으면 저장이 나머지 블록을 조용히 잃는다.
  const blocks: EditorBlock[] = []
  doc.forEach((group) => group.forEach((container) => blocks.push(blockFromContainer(container))))

  if (blocks.length === 1) {
    const only = blocks[0]
    const empty =
      only.type === 'paragraph' &&
      only.title.length === 0 &&
      (only.children?.length ?? 0) === 0 &&
      Object.keys(only.properties ?? {}).length === 0
    if (empty) return { blocks: [] }
  }

  return { blocks }
}
