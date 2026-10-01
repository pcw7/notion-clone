/**
 * JSON 으로 나타낼 수 있는 값만 남긴다 — 협업 참여자가 Y attr 에 쓴 값 (잔여 묶음 8a-2 · 정본 §3.4 [보강] 코드 블록 ⑧)
 *
 * 협업 참여자는 검증을 거치지 않고 Y attr 에 lib0 이 인코딩하는 무엇이든 쓸 수 있다 — bigint · Uint8Array · 배열 속 undefined ·
 * 공유 타입(Y.Map …) · 하위 문서. 투영은 행(jsonb)에 쓰려고 이것을 JSON 으로 옮기는데 **bigint 에서 던진다**(`JSON.stringify`) —
 * 로그는 지우지 않으므로 그 페이지의 투영이 영구히 멈춘다. 그래서 정규화(`collab/normalize.ts`)가 본문을 읽을 때 attr 을 이것으로
 * 거른다. 행이 jsonb 이므로 어차피 보존할 수 없는 값이다 — `unsupported` 의 원본 보존과도 부딪히지 않는다.
 *
 *   · 남는다: null · 문자열 · 불리언 · 유한한 수 · 배열 · 평범한 객체(프로토타입이 Object.prototype 이나 null)
 *   · 바뀐다: 문자열 · 키의 U+0000 은 U+FFFD 로 — JSON 은 나타내지만 **jsonb 가 거부한다**(22P05 · 8a-2 리뷰가 실측했다 — 캡션에
 *     NUL 하나면 투영이 영구히 멈췄다). 본문 글자의 NUL 은 정규화가 따로 바꾼다(`collab/normalize.ts` · `withoutNul`)
 *   · 빠진다: 그 밖의 모든 것 — 객체 안이면 그 키, 배열 안이면 그 원소가 빠진다. NaN · Infinity 도(JSON 이 null 로 바꿔 행과
 *     Y.Doc 이 다른 값이 된다). `__proto__` 키로 프로토타입이 바뀐 객체도(lib0 의 디코더는 `obj[key] = value` 로 조립한다)
 *   · {@link MAX_JSON_DEPTH} 보다 깊은 값도 빠진다 — 본문 attr 은 그만큼 깊지 않다. 되부름이 스택을 넘기지 않게
 *
 * **던지지 않는다**(정규화는 전체 함수다). 바뀐 것이 없으면 **같은 객체**를 돌려준다 — 정규화는 읽을 때마다 돈다.
 */

export const MAX_JSON_DEPTH = 32

const DROP: unique symbol = Symbol('drop')

/** U+0000 을 U+FFFD 로 — jsonb 가 받는 글자로(머리말). 없으면 같은 문자열이다. */
export function withoutNul(text: string): string {
  return text.includes('\u0000') ? text.replaceAll('\u0000', '\uFFFD') : text
}

/** JSON 으로 나타낼 수 있게 거른 값 — 값 자체를 나타낼 수 없으면 undefined. */
export function jsonSafe(value: unknown): unknown {
  const out = clean(value, 0)
  return out === DROP ? undefined : out
}

function isPlainPrototype(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function clean(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return withoutNul(value)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : DROP
  if (typeof value !== 'object' || depth >= MAX_JSON_DEPTH) return DROP

  if (Array.isArray(value)) {
    let out: unknown[] | null = null
    for (let i = 0; i < value.length; i += 1) {
      const item: unknown = value[i]
      const safe = clean(item, depth + 1)
      if (out === null && safe === item) continue
      out ??= value.slice(0, i)
      if (safe !== DROP) out.push(safe)
    }
    return out ?? value
  }

  if (!isPlainPrototype(value)) return DROP
  const record = value as Record<string, unknown>
  let out: Record<string, unknown> | null = null
  for (const key of Object.keys(record)) {
    const item = record[key]
    const safe = clean(item, depth + 1)
    const safeKey = withoutNul(key)
    if (safe === item && safeKey === key) continue
    out ??= { ...record }
    delete out[key]
    if (safe !== DROP) out[safeKey] = safe
  }
  return out ?? value
}

/** 평범한 객체인가 — 배열 · 공유 타입 · Uint8Array 가 아니다. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isPlainPrototype(value)
}

/**
 * 깊은 같음 — null 과 "없음"을 가르고 배열과 객체를 가른다. **던지지 않는다**(`JSON.stringify` 비교는 bigint 에서 던진다). 평범한
 * 객체 · 배열만 안으로 들어가고, 그 밖의 값은 같은 값(`Object.is`)일 때만 같다.
 *
 * 쓰는 곳: 수선의 attr 맞추기(`collab/repair.ts`) · 코드 블록 명령의 "바뀐 것이 없으면 쓰지 않는다"(`editor/code-block.ts`).
 */
export function sameJsonValue(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (depth >= MAX_JSON_DEPTH || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJsonValue(item, b[i], depth + 1))
  }
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key], depth + 1))
}

/**
 * 평범한 객체 · 배열이 `max` 단계보다 깊은가 — 읽기(`jsonSafe`)가 그 가지를 잘라 낸다. 저장 API 는 이런 값을 거부한다
 * (`editor/document.ts` `validateDoc` — 받으면 성공이라 답하고 말없이 잃는다 · 8a-2 리뷰).
 */
export function exceedsJsonDepth(value: unknown, max: number = MAX_JSON_DEPTH): boolean {
  const deeper = (v: unknown, depth: number): boolean => {
    if (typeof v !== 'object' || v === null) return false
    if (depth >= max) return true
    return (Array.isArray(v) ? v : Object.values(v)).some((item) => deeper(item, depth + 1))
  }
  return deeper(value, 0)
}
