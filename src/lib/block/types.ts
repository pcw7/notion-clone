/**
 * 블록 타입 레지스트리 — F-01-02
 *
 * 정본: docs/research/01-block-editor.md F-01-02
 * 마스터 문서 §5.1: "MVP는 **12종**. 나머지는 `unsupported` 폴백으로 저장만 하고
 * 렌더는 회색 박스. 타입 추가는 레지스트리에 항목만 등록하면 되도록."
 *
 * **`unsupported` 가 이 파일의 핵심이다.**
 * F-01-02 엣지 케이스: "신규 타입을 unsupported 로 보존만 하고 렌더는 회색 박스.
 * **구버전이 저장할 때 원본 페이로드를 통째로 되돌려 써야** 라운드트립 손실이 없다."
 *
 * 모르는 타입을 만나면 버리는 게 아니라 **그대로 보존**해야 한다. 버리면
 * 구버전 클라이언트로 페이지를 한 번 열었다 닫는 것만으로 데이터가 사라진다.
 */

import { isColor, type Color } from '../contracts/rich-text.ts'

/**
 * 최대 트리 깊이.
 *
 * 정본 §"실측 필요" 1번: "100, 초과 시 명시적 에러". 노션의 실제 상한은
 * 측정되지 않았으므로 우리가 정한다. 상한이 없으면 `ancestor_path` 배열이
 * 무한히 길어지고 breadcrumb 렌더가 먼저 무너진다.
 *
 * 페이지 트리(`page.ts`)와 본문 문서(`editor/document.ts`)가 같은 값을 써야
 * 하므로 레지스트리에 둔다. `page.ts` 에 두면 순수 모듈인 `document.ts` 가
 * DB 커넥션 풀까지 끌고 오게 된다.
 */
export const MAX_TREE_DEPTH = 100

/** MVP 12종. 순서는 `/` 메뉴 노출 순서와 무관하다. */
export const MVP_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'divider',
  'image',
] as const
export type MvpBlockType = (typeof MVP_BLOCK_TYPES)[number]

/** 페이지도 블록이다(C-3). 레지스트리에는 있지만 `/` 메뉴에는 없다. */
export const PAGE_TYPE = 'page' as const

/** 모르는 타입의 보존용 폴백. */
export const UNSUPPORTED_TYPE = 'unsupported' as const

export type BlockType = MvpBlockType | typeof PAGE_TYPE | typeof UNSUPPORTED_TYPE

const MVP_SET: ReadonlySet<string> = new Set(MVP_BLOCK_TYPES)

export type BlockTypeSpec = {
  /** rich text 를 담는가. divider·image 는 아니다. */
  readonly hasRichText: boolean
  /** 자식 블록을 가질 수 있는가. */
  readonly canHaveChildren: boolean
  /**
   * `format.block_color` 를 지원하는가.
   *
   * F-01-02 GAP 2회차: `code`/`divider`/미디어/`table` 에는 color 필드가 **없다**.
   * 헬프센터는 "파일·북마크에도 Color가 있다"고 서술하는 **UI/API 불일치**가
   * 확인됐으므로, 우리는 API 쪽(= 없음)을 따른다.
   */
  readonly supportsColor: boolean
  /** 마크다운 입력 규칙 접두사. 없으면 `/` 메뉴로만 만든다. */
  readonly markdownPrefix?: readonly string[]
}

export const BLOCK_TYPES: Readonly<Record<BlockType, BlockTypeSpec>> = Object.freeze({
  page: { hasRichText: true, canHaveChildren: true, supportsColor: true },

  paragraph: { hasRichText: true, canHaveChildren: true, supportsColor: true },
  heading_1: { hasRichText: true, canHaveChildren: false, supportsColor: true, markdownPrefix: ['# '] },
  heading_2: { hasRichText: true, canHaveChildren: false, supportsColor: true, markdownPrefix: ['## '] },
  heading_3: { hasRichText: true, canHaveChildren: false, supportsColor: true, markdownPrefix: ['### '] },
  bulleted_list_item: {
    hasRichText: true, canHaveChildren: true, supportsColor: true,
    markdownPrefix: ['- ', '* ', '+ '],
  },
  numbered_list_item: {
    hasRichText: true, canHaveChildren: true, supportsColor: true,
    markdownPrefix: ['1. ', '1) '],
  },
  to_do: {
    hasRichText: true, canHaveChildren: true, supportsColor: true,
    markdownPrefix: ['[] ', '[ ] ', '[x] '],
  },
  toggle: { hasRichText: true, canHaveChildren: true, supportsColor: true, markdownPrefix: ['> '] },
  quote: { hasRichText: true, canHaveChildren: true, supportsColor: true, markdownPrefix: ['" '] },
  callout: { hasRichText: true, canHaveChildren: true, supportsColor: true },
  // divider 와 image 는 텍스트를 담지 않고 색도 없다.
  divider: { hasRichText: false, canHaveChildren: false, supportsColor: false, markdownPrefix: ['---'] },
  image: { hasRichText: false, canHaveChildren: false, supportsColor: false },

  // 폴백. 렌더는 회색 박스, 저장은 원본 그대로.
  unsupported: { hasRichText: false, canHaveChildren: false, supportsColor: false },
})

/**
 * heading 은 자식을 가질 수 없다.
 *
 * F-01-02 GAP 2회차가 발견한 모순: enhanced markdown 문서는 "헤딩은 자식 블록을
 * 가질 수 없다"고 하는데 `is_toggleable` 헤딩은 자식을 갖는다 `[확인필요]`.
 * MVP 는 toggle heading 을 만들지 않으므로 "자식 없음"으로 둔다.
 * toggle heading 을 추가할 때 이 값을 함께 재검토한다.
 */

export function isMvpBlockType(t: unknown): t is MvpBlockType {
  return typeof t === 'string' && MVP_SET.has(t)
}

export function isKnownBlockType(t: unknown): t is BlockType {
  return typeof t === 'string' && t in BLOCK_TYPES
}

export function specOf(t: BlockType): BlockTypeSpec {
  return BLOCK_TYPES[t]
}

// ── unsupported 폴백 ──────────────────────────────────────────────────

/**
 * `unsupported` 블록의 properties.
 *
 * 원본 타입과 페이로드를 **통째로** 보관한다. 이게 없으면 구버전 클라이언트가
 * 페이지를 열었다 저장하는 것만으로 신규 타입 블록이 소멸한다.
 */
export type UnsupportedPayload = {
  /** 우리가 모르는 원래 타입 이름. */
  readonly original_type: string
  /** 원래 properties 전체. 손대지 않는다. */
  readonly original_properties: unknown
  /** 원래 format 전체. 손대지 않는다. */
  readonly original_format: unknown
}

/**
 * 모르는 타입을 보존 가능한 형태로 감싼다.
 *
 * @returns 알려진 타입이면 `null`(감쌀 필요 없음).
 */
export function wrapUnsupported(
  type: string,
  properties: unknown,
  format: unknown,
): { type: typeof UNSUPPORTED_TYPE; properties: UnsupportedPayload } | null {
  if (isKnownBlockType(type)) return null
  return {
    type: UNSUPPORTED_TYPE,
    properties: {
      original_type: type,
      original_properties: properties ?? {},
      original_format: format ?? {},
    },
  }
}

/**
 * 저장 시 원본으로 되돌린다. **라운드트립 무손실의 핵심.**
 *
 * @returns unsupported 가 아니면 `null`.
 */
export function unwrapUnsupported(
  type: string,
  properties: unknown,
): { type: string; properties: unknown; format: unknown } | null {
  if (type !== UNSUPPORTED_TYPE) return null
  const p = properties as Partial<UnsupportedPayload> | null | undefined
  if (typeof p?.original_type !== 'string') return null
  return {
    type: p.original_type,
    properties: p.original_properties ?? {},
    format: p.original_format ?? {},
  }
}

// ── format ────────────────────────────────────────────────────────────

export type BlockFormat = {
  /** 19색 중 하나. 이 타입이 색을 지원하지 않으면 무시된다. */
  block_color?: Color
  [k: string]: unknown
}

/**
 * format 을 타입에 맞게 정리한다.
 *
 * 색을 지원하지 않는 타입(divider·image)에 block_color 가 들어오면 **버린다** —
 * 저장해두면 나중에 그 타입이 색을 지원하게 됐을 때 사용자가 지정한 적 없는
 * 색이 갑자기 나타난다.
 */
export function normalizeFormat(type: BlockType, format: unknown): BlockFormat {
  const src = (typeof format === 'object' && format !== null ? format : {}) as BlockFormat
  const out: BlockFormat = { ...src }

  if (!specOf(type).supportsColor || !isColor(out.block_color)) {
    delete out.block_color
  }
  return out
}
