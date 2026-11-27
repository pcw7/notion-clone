/**
 * 동기화 블록의 저장 모양 — SB-1 (정본 §3.4 [보강 SB-0] ④ ⑤ ⑥ · F-01-11 · DOM · DB 없음)
 *
 * 블록 하나(`type='synced_block'`)가 원본 또는 사본이다.
 *
 *   원본  properties 가 빈 객체 · 자식은 동기화 내용(보통의 블록 · 하나 이상 — 정규화 ⑥ⓐ)
 *   사본  properties = { synced_from: '<원본 X 의 uuid — 소문자>' } 하나 · 자식 없음(내용은 원본 페이지의 Y.Doc 에 있다 — SB-2)
 *
 * 키가 없는 것이 원본이다(API 의 `synced_from: null` 은 키가 없는 것 — 거짓을 남기지 않는다). `synced_from` 은 동기화 블록에만 · uuid ·
 * 자기 id 가 아니다(SY2 — CHECK `ck_synced_from_shape` 가 소문자 uuid 만 받는다 · `isUuid` 는 대문자도 받으므로 여기서 소문자로 고친다).
 *
 * 이 파일은 처음 받는 번들에 든다(정규화 · 검증 · 편집기).
 */

import { isPlainRecord } from '../contracts/json-safe.ts'
import { isUuid } from '../ids.ts'

export const SYNCED_BLOCK_TYPE = 'synced_block' as const
/** 사본이 가리키는 원본 — 원본 · 다른 타입에는 없다(SY2). */
export const SYNCED_FROM_KEY = 'synced_from'

/** 읽는 길(공개 · AI — SB-5 · 정본 ⑲ [SB-5 고침])이 한 번에 펼치는 원본 페이지 수 — 넘는 것은 펴지 않는다. */
export const SYNCED_EXPAND_PAGES = 20

/** CHECK `ck_synced_from_shape` 의 모양 — 소문자 uuid. */
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 사본인가 — 키가 있으면 사본(모양이 틀린 사본도 — 정규화 ⑥ⓔ 가 뺀다). */
export function isSyncedCopyProps(props: unknown): boolean {
  return isPlainRecord(props) && Object.hasOwn(props, SYNCED_FROM_KEY)
}

/** 사본이 가리키는 원본 id — 소문자 uuid 이고 자기 id 가 아닐 때만. 아니면 null(⑥ⓔ). */
export function syncedFromOf(props: unknown, ownId: string): string | null {
  if (!isPlainRecord(props)) return null
  const from = props[SYNCED_FROM_KEY]
  return typeof from === 'string' && LOWER_UUID.test(from) && from !== ownId.toLowerCase() ? from : null
}

/**
 * 읽을 때의 정화(`block/props.ts`) — 동기화 블록은 `synced_from` 하나만 남긴다(다른 키는 지운다 — 원본은 빈 객체). `null` 은 키가 없는
 * 것이다(원본) · 대문자 uuid 는 소문자로. 모양이 틀린 값(uuid 가 아닌 글 · 수 …)은 **남긴다** — 지우면 사본이 자식 없는 원본(빈 문단)으로
 * 바뀐다 · 정규화 ⑥ⓔ 가 그 사본을 뺀다. 바뀐 것이 없으면 **같은 객체**.
 */
export function sanitizeSyncedBlockProps(props: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(props)
  const from = props[SYNCED_FROM_KEY]
  const lowered = typeof from === 'string' && isUuid(from) ? from.toLowerCase() : from
  const keep = Object.hasOwn(props, SYNCED_FROM_KEY) && from !== null && from !== undefined
  const same = keep ? keys.length === 1 && lowered === from : keys.length === 0
  if (same) return props
  return keep ? { [SYNCED_FROM_KEY]: lowered } : {}
}

/**
 * 본문 저장의 검증(`validateDoc`) — 정규화 ⑥ 이 고치는 모양을 거부한다: 다른 키 · 모양이 틀린 `synced_from`(ⓔ) · 자식 없는 원본(ⓐ) ·
 * 자식 있는 사본(ⓑ). 중첩(ⓒⓓ)은 레지스트리의 `excludedDescendantTypes` 로 `validateDoc` 이 본다.
 */
export function validateSyncedBlock(
  block: { readonly id: string; readonly properties?: unknown; readonly children?: readonly unknown[] },
  path: string,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = []
  const props = block.properties ?? {}
  if (!isPlainRecord(props)) return issues
  const extra = Object.keys(props).filter((key) => key !== SYNCED_FROM_KEY)
  if (extra.length > 0) issues.push({ path: `${path}.properties`, message: `동기화 블록의 속성은 ${SYNCED_FROM_KEY} 하나뿐입니다: ${extra.join(', ')}` })
  const kids = block.children?.length ?? 0
  if (!isSyncedCopyProps(props)) {
    if (kids === 0) issues.push({ path: `${path}.children`, message: '동기화 블록(원본)에는 블록이 하나 이상 있어야 합니다' })
    return issues
  }
  if (syncedFromOf(props, block.id) === null) {
    issues.push({ path: `${path}.properties.${SYNCED_FROM_KEY}`, message: '원본 블록의 uuid(소문자 · 자기 id 가 아님)여야 합니다' })
  }
  if (kids > 0) issues.push({ path: `${path}.children`, message: '동기화 블록의 사본은 자식을 가질 수 없습니다 — 내용은 원본에 있습니다' })
  return issues
}
