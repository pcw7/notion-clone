/**
 * ProseMirror 스키마 — F-01-01 / F-01-03 / F-01-07
 *
 * 정본: 01-block-editor.md F-01-10 (블록 경계를 넘는 부분 선택)
 *       마스터 문서 §7-4 완화 전략 ⑤
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 컨테이너 스키마인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * §7-4: *"**블록별 `contenteditable` 을 쓰지 않는다** — 단일 contenteditable 이
 * a11y · 블록 간 부분 선택 · 복붙을 동시에 해결한다."*
 * F-01-10 이 그 이유를 1차 출처로 확인해 준다(2022-01-19 릴리스): *"블록 경계를
 * 넘는 부분 텍스트 선택"* 이 노션의 명시적 설계 목표이고, 이것은 블록마다
 * `contenteditable` 을 두는 구현과 **정면으로 충돌**한다.
 *
 * 그래서 문서 전체가 하나의 ProseMirror 문서다. 중첩(F-01-07)을 표현하려면
 * 노드 하나가 "내용 + 자식들"을 담아야 하는데, ProseMirror 의 textblock 은
 * 인라인만 담을 수 있다. 그래서 두 겹으로 나눈다:
 *
 *   doc            : blockGroup
 *   blockGroup     : blockContainer+
 *   blockContainer : blockContent blockGroup?     ← 이것이 "블록" 하나다
 *   blockContent   : paragraph | heading_1 | ... | divider | page_ref
 *
 * `blockContainer` 가 `block.id` 를 들고, 안쪽 `blockContent` 의 노드 타입이
 * `block.type` 이다. 자식은 뒤따르는 `blockGroup` 이 된다. 이 모양이 우리
 * `block` 테이블의 트리와 1:1 이라 어댑터에 판단이 들어가지 않는다.
 *
 * Tab / Shift+Tab 은 `blockContainer` 를 이웃의 `blockGroup` 으로 옮기는 것이고,
 * Enter 는 `blockContainer` 를 쪼개는 것이다 — ProseMirror 의 기존 커맨드가
 * 다룰 수 있는 모양이다(F-01-19 "직접 구현하지 않는다").
 *
 * ──────────────────────────────────────────────────────────────────────
 * 노드 목록을 손으로 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `blockContent` 의 노드는 **레지스트리(`block/types.ts`)에서 생성**한다.
 * §5.1 의 요구: *"타입 추가는 레지스트리에 항목만 등록하면 되도록."*
 * 여기에 타입 이름을 다시 적으면 레지스트리와 어긋날 수 있고, 어긋나면
 * 그 타입의 블록이 에디터에서 조용히 사라진다.
 */

import { Schema, type MarkSpec, type NodeSpec } from '@tiptap/pm/model'

import {
  BLOCK_TYPES,
  MVP_BLOCK_TYPES,
  UNSUPPORTED_TYPE,
  type MvpBlockType,
} from '../block/types.ts'
import { COLORS } from '../contracts/rich-text.ts'

/** 자식 페이지 참조 노드의 이름. 우리 모델의 `type='page'` 다. */
export const PAGE_REF_NODE = 'page_ref'

/** 인라인 원자 — rich text 의 `mention` / `equation` 런에 대응한다. */
export const MENTION_NODE = 'mention'
export const EQUATION_NODE = 'equation'

/**
 * 블록의 properties·format 을 담는 attr.
 *
 * 타입마다 attr 을 따로 선언하지 않는다. `to_do.checked`, `image.url`,
 * `unsupported.original_*` 는 전부 `props` 안에 그대로 들어간다 —
 * **모르는 키를 보존하는 것이 목적**이기 때문이다(F-01-02). 타입마다 attr 을
 * 열거하면 열거하지 않은 키가 라운드트립에서 사라진다.
 */
type BlockAttrs = { props: Record<string, unknown>; format: Record<string, unknown> }

const blockAttrSpec = {
  props: { default: {} as Record<string, unknown> },
  format: { default: {} as Record<string, unknown> },
}

/** 레지스트리 한 항목을 노드 스펙으로. */
function blockContentSpec(type: MvpBlockType): NodeSpec {
  const spec = BLOCK_TYPES[type]
  return {
    group: 'blockContent',
    attrs: blockAttrSpec,
    // 텍스트를 담지 않는 타입(divider·image)은 원자다. 캐럿이 안으로 들어가면
    // 사용자는 "내용이 있는 줄"이라고 착각하고 타이핑하지만 저장될 곳이 없다.
    ...(spec.hasRichText
      ? { content: 'inline*' }
      : { atom: true, selectable: true, draggable: true }),
    // 파싱 규칙은 렌더 계층(React NodeView)이 담당한다. 여기서는 최소한만 둔다 —
    // 스키마는 서버·테스트에서도 DOM 없이 쓰이므로 DOM 지식을 넣지 않는다.
    toDOM: () => ['div', { 'data-block-type': type }, ...(spec.hasRichText ? [0] : [])],
  } as NodeSpec
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'blockGroup' },

  blockGroup: { content: 'blockContainer+' },

  blockContainer: {
    content: 'blockContent blockGroup?',
    attrs: {
      // `block.id`. 정본 §3.4 가 "클라이언트 생성"이라고 정한 그 uuid 다.
      //
      // default 는 **빈 문자열 센티널**이다. uuid 를 넣을 수도, default 를
      // 없앨 수도 없다:
      //   - ProseMirror 는 `blockContainer+` 처럼 **필수 위치**에 오는 노드가
      //     인자 없이 생성 가능(generatable)해야 한다고 요구한다. default 가
      //     없으면 스키마 생성 자체가 실패하고, `splitBlock` 도 새 컨테이너를
      //     만들 수 없다.
      //   - `default` 는 고정값이라 uuid 팩토리를 넣을 수 없다(넣으면 모든
      //     블록이 **같은 id** 를 갖는다 — 프로젝터가 한 행에 전부 덮어쓴다).
      //
      // 그래서 센티널을 두고 **id 를 나중에 찍는다.** 찍는 자리는 두 곳이다:
      //   ① 에디터의 id 스탬프 플러그인(노드가 생기는 즉시)
      //   ② `pmToDoc()` (저장 직전, 방어)
      // 빈 id 가 서버까지 새 나가도 `validateDoc` 이 uuid 가 아니라고 거부하므로
      // 조용히 망가지지는 않는다.
      blockId: { default: '' },
    },
    defining: true,
    toDOM: (node) => ['div', { 'data-block-id': String(node.attrs.blockId) }, 0],
  },

  text: { group: 'inline', inline: true },

  [MENTION_NODE]: {
    group: 'inline',
    inline: true,
    atom: true,
    // F-01-19: mention 은 원자다. `rich-text-ops.ts` 가 오프셋 단위를 1로
    // 정한 것과 짝을 이룬다 — ProseMirror 의 inline atom 도 nodeSize 1 이다.
    attrs: { mention: { default: {} }, plainText: { default: '' } },
    toDOM: (node) => ['span', { 'data-mention': '' }, String(node.attrs.plainText)],
  },

  [EQUATION_NODE]: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { expression: { default: '' } },
    toDOM: (node) => ['span', { 'data-equation': '' }, String(node.attrs.expression)],
  },

}

// ⚠ 순서가 의미를 갖는다.
//
// ProseMirror 는 `blockContent` 처럼 **그룹**이 필수 위치에 올 때 그 그룹의
// **첫 번째 생성 가능한 타입**으로 자리를 채운다. `paragraph` 가 먼저 와야
// 새 블록의 기본형이 문단이 된다 — `page_ref` 나 `unsupported` 를 먼저 등록하면
// Enter 를 누를 때마다 자식 페이지 참조 노드가 생긴다.
//
// 그래서 레지스트리(`MVP_BLOCK_TYPES`, 첫 항목이 `paragraph`)를 먼저 넣고
// 특수 노드를 뒤에 붙인다.
for (const type of MVP_BLOCK_TYPES) {
  nodes[type] = blockContentSpec(type)
}

// 자식 페이지 참조. 본문에 보이지만 내용은 그 페이지의 것이다.
nodes[PAGE_REF_NODE] = {
  group: 'blockContent',
  atom: true,
  selectable: true,
  attrs: { props: blockAttrSpec.props, format: blockAttrSpec.format, title: { default: '' } },
  toDOM: (node) => ['div', { 'data-page-ref': '' }, String(node.attrs.title)],
}

// 모르는 타입의 보존 노드. 렌더는 회색 박스(F-01-02).
nodes[UNSUPPORTED_TYPE] = {
  group: 'blockContent',
  atom: true,
  selectable: true,
  attrs: blockAttrSpec,
  toDOM: () => ['div', { 'data-unsupported': '' }],
}

// ── 마크 ──────────────────────────────────────────────────────────────
//
// F-01-03 의 annotation 5개 + 링크 + 색.
//
// `color` 를 마크 **하나**로 둔 것이 계약이다. RichText 의 `annotations.color` 는
// 필드 하나이고 텍스트색·배경색을 동시에 가질 수 없다 — 두 마크로 쪼개면
// 표현할 수 없는 상태(둘 다 지정)가 만들어지고 노션 API 호환이 깨진다.

const BOOLEAN_MARKS = ['bold', 'italic', 'strikethrough', 'underline', 'code'] as const
export type BooleanMark = (typeof BOOLEAN_MARKS)[number]

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {} },
    inclusive: false, // 링크 끝에서 타이핑하면 링크가 아니어야 한다
    toDOM: (mark) => ['a', { href: String(mark.attrs.href) }, 0],
  },
  color: {
    attrs: { color: {} },
    toDOM: (mark) => ['span', { 'data-color': String(mark.attrs.color) }, 0],
  },
}

for (const name of BOOLEAN_MARKS) {
  marks[name] = { toDOM: () => ['span', { [`data-${name}`]: '' }, 0] }
}

export const blockSchema = new Schema({ nodes, marks })

export const BOOLEAN_MARK_NAMES: readonly BooleanMark[] = BOOLEAN_MARKS

/** `color` 마크에 들어갈 수 있는 값 — 계약의 19색. */
export const COLOR_VALUES = COLORS

export type { BlockAttrs }
