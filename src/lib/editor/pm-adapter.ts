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

import {
  DEFAULT_ANNOTATIONS,
  isColor,
  type Annotations,
  type MentionType,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import {
  isKnownBlockType,
  specOf,
  PAGE_TYPE,
  UNSUPPORTED_TYPE,
  type BlockFormat,
  type BlockType,
} from '../block/types.ts'
import { canonicalizeRuns } from './rich-text-ops.ts'
import {
  blockSchema,
  BOOLEAN_MARK_NAMES,
  EQUATION_NODE,
  MENTION_NODE,
  PAGE_REF_NODE,
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

    if (run.type === 'text') {
      const content = run.text?.content ?? ''
      if (content === '') continue
      out.push(blockSchema.text(content, marks))
      continue
    }

    if (run.type === 'equation') {
      out.push(
        blockSchema.nodes[EQUATION_NODE].create(
          { expression: run.equation?.expression ?? '' },
          null,
          marks,
        ),
      )
      continue
    }

    out.push(
      blockSchema.nodes[MENTION_NODE].create(
        { mention: run.mention ?? {}, plainText: run.plain_text ?? '' },
        null,
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

    if (node.type.name === EQUATION_NODE) {
      const expression = String(node.attrs.expression ?? '')
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
      const mention = (node.attrs.mention ?? {}) as { type?: MentionType }
      runs.push({
        type: 'mention',
        annotations,
        plain_text: String(node.attrs.plainText ?? ''),
        href: null,
        mention: { type: mention.type ?? 'page', ...mention },
      })
    }
  })

  return canonicalizeRuns(runs)
}

// ── EditorDoc → ProseMirror doc ───────────────────────────────────────

function contentNodeFor(block: EditorBlock): PmNode {
  const props = { ...(block.properties ?? {}) }
  const format = { ...(block.format ?? {}) }

  if (block.type === PAGE_TYPE) {
    // 제목은 참조 표시용이다. 저장 시 프로젝터가 무시한다.
    return blockSchema.nodes[PAGE_REF_NODE].create({
      props,
      format,
      title: block.title.map((r) => r.plain_text ?? '').join(''),
    })
  }

  const type: BlockType = isKnownBlockType(block.type) ? block.type : UNSUPPORTED_TYPE
  if (type === UNSUPPORTED_TYPE) {
    return blockSchema.nodes[UNSUPPORTED_TYPE].create({ props, format })
  }

  const nodeType = blockSchema.nodes[type]
  if (specOf(type).hasRichText) {
    return nodeType.create({ props, format }, runsToInline(block.title))
  }
  return nodeType.create({ props, format })
}

function containerFor(block: EditorBlock): PmNode {
  const content = contentNodeFor(block)
  const children = block.children ?? []

  // 자식 페이지의 본문은 이 문서의 것이 아니다(document.ts 가 검증한다).
  const group =
    block.type !== PAGE_TYPE && children.length > 0
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

function blockFromContainer(container: PmNode): EditorBlock {
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

  const type = (
    content.type.name === UNSUPPORTED_TYPE ? UNSUPPORTED_TYPE : content.type.name
  ) as BlockType

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
  const group = doc.childCount > 0 ? doc.child(0) : null
  if (!group) return { blocks: [] }

  const blocks: EditorBlock[] = []
  group.forEach((container) => blocks.push(blockFromContainer(container)))

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
