/**
 * 본문 블록의 속성 정화 — 잔여 묶음 8a-2 (정본 §3.4 [보강] 코드 블록 ⑧ · DOM · DB 없음)
 *
 * 협업 참여자는 검증을 거치지 않고 Y.Doc 에 무엇이든 쓸 수 있다(본문 저장 API 만 `validateDoc` 을 지난다). 모양이 틀린 캡션 하나
 * — 원소가 객체가 아니거나(`[null]`) `plain_text` 가 문자열이 아닌 런 — 가 투영의 색인(`toPlainText`)과 복제에서 던져 **그 페이지의
 * 투영을 영구히** 멈췄다(로그는 지우지 않는다 — S1 · 8a-2 조사의 프로브). bigint 하나도 같다 — 행(jsonb)에 쓰는 직렬화가 던진다.
 * 그래서 본문을 읽을 때(정규화) 속성을 여기서 정화하고, 고친 것은 수선이 Y.Doc 에 써 모두에게 퍼진다(`normalize.ts` 의
 * `invalid_props_dropped` · `repair.ts`).
 *
 *   · JSON 안전(모든 타입): JSON 으로 나타낼 수 없는 값은 뺀다(`jsonSafe`). 하위 페이지 참조 · `unsupported` 도 — 행이 jsonb 라서
 *     어차피 보존할 수 없는 값이다
 *   · 캡션(레지스트리 `hasCaption` — 이미지 · 코드): 배열이 아니면 키를 지운다 · 계약을 어긴 런은 글자만 살리고 `plain_text` 는 다시
 *     계산한다(`sanitizeRichText`) · 빈 배열은 그대로 둔다(노션 API 가 `caption: []` 을 돌려준다 — 뜻이 같은 값을 고쳐 쓰지 않는다)
 *   · 언어(레지스트리 `plainText` — 코드): 문자열이 아니거나 비었거나 64자를 넘으면 지운다
 *   · format: `normalizeFormat`(타입이 받지 않는 색 · 코드가 아닌 타입의 `code_wrap` · `true` 가 아닌 `code_wrap`)
 *   · 하위 페이지 참조 · `unsupported` 는 JSON 안전만 — 앞은 다른 페이지의 것이고, 뒤는 모르는 타입의 원본 보존이다. 하나 예외:
 *     하위 페이지 참조의 `format` 에서 **페이지 아이콘**(`page_icon` · 8c-1)은 뺀다 — 아이콘은 그 페이지 행의 것이고 본문은 싣지
 *     않는다(볼 수 없는 하위 페이지의 아이콘이 부모 본문을 타고 퍼진다 — 정본 §3.4 [보강] 페이지 아이콘 ③). 다른 타입은 `normalizeFormat`
 *     이 뺀다
 *
 * **던지지 않는다**(정규화는 전체 함수다) — 그래서 값을 `JSON.stringify` 로 비교하지 않는다(bigint 에서 던진다). 규칙이 실제로 바꾼
 * 것만 센다. 바뀐 것이 없으면 **같은 객체**를 돌려준다 — 정규화는 읽을 때마다 돈다.
 */

import { isPlainRecord, jsonSafe } from '../contracts/json-safe.ts'
import { sanitizeRichText } from '../contracts/rich-text.ts'
import { MAX_CODE_LANGUAGE_LENGTH } from './code.ts'
import { normalizeFormat, PAGE_TYPE, specOf, UNSUPPORTED_TYPE, type BlockFormat, type BlockType } from './types.ts'
import { PAGE_ICON_KEY } from './page-icon.ts'

export type SanitizedAttrs = {
  readonly props: Record<string, unknown>
  readonly format: BlockFormat
  /** 무엇이든 고쳤는가. */
  readonly changed: boolean
}

/** JSON 안전하게 거른 객체 — 객체가 아니게 되면 빈 객체. */
function safeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const safe = jsonSafe(value)
  return isPlainRecord(safe) ? safe : {}
}

/** 키 집합과 값(같은 참조)이 같은가 — `normalizeFormat` 은 키를 지우기만 한다. */
function shallowSame(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
}

export function sanitizeBlockAttrs(type: BlockType, props: Record<string, unknown>, format: BlockFormat): SanitizedAttrs {
  let nextProps = safeRecord(props)
  const safeFormat = safeRecord(format) as BlockFormat
  if (type === PAGE_TYPE && Object.hasOwn(safeFormat, PAGE_ICON_KEY)) {
    const rest: BlockFormat = { ...safeFormat }
    delete rest[PAGE_ICON_KEY]
    return { props: nextProps, format: rest, changed: true }
  }
  if (type === PAGE_TYPE || type === UNSUPPORTED_TYPE) {
    return { props: nextProps, format: safeFormat, changed: nextProps !== props || safeFormat !== format }
  }
  const spec = specOf(type)

  const edit = (): Record<string, unknown> => {
    if (nextProps === props) nextProps = { ...props }
    return nextProps
  }

  if (spec.hasCaption && 'caption' in nextProps) {
    const caption = sanitizeRichText(nextProps.caption)
    if (caption === null) delete edit().caption
    else if (caption !== nextProps.caption) edit().caption = caption
  }

  if (spec.plainText && 'language' in nextProps) {
    const language = nextProps.language
    if (typeof language !== 'string' || language.trim() === '' || language.length > MAX_CODE_LANGUAGE_LENGTH) {
      delete edit().language
    }
  }

  const normalized = normalizeFormat(type, safeFormat)
  const nextFormat = shallowSame(normalized, safeFormat) ? safeFormat : normalized
  return { props: nextProps, format: nextFormat, changed: nextProps !== props || nextFormat !== format }
}
