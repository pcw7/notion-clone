/**
 * 숫자 구간으로 묶기 — 버킷 규칙 (그룹 버킷 트랙 B-2 · 정본 §3.6 [보강] `view.group_by` 의 [보강 B-2] · 04 F-04-11, DOM 없음)
 *
 * 04 F-04-11 *"number — 값 그대로 또는 `number_bucket{size}` 구간화"*. 여기는 구간이다(값 그대로는 크기 1 의 구간과 다르지 않고, 소수
 * 값이면 그룹이 값마다 생겨 쓸모가 없다).
 *
 * - **키는 구간의 아래 끝**(`floor(v / size) * size` — DB 의 `numeric` 으로 정확히 · 글자는 `trim_scale` 의 것 = JS 의 `String(Number(k))`
 *   과 같은 모양: `20` · `-10` · `0.5`). 구간은 `[아래 끝, 아래 끝 + size)`. 값 없음은 `''`.
 * - **옮기면 구간 차이만큼 더한다** — 23 을 [20, 30) 에서 [50, 60) 으로 옮기면 53(구간 안의 자리를 지킨다 · 날짜의 "단위만큼 민다"와 같다).
 *   소수 오차가 없게 십진 자리로 셈한다(0.1 + 0.2 = 0.3).
 * - 크기는 0 보다 크고 소수 여섯 자리까지(`MAX_SIZE_DECIMALS`) · 없으면 10.
 */

/** 크기를 고르지 않았을 때 — 노션의 숫자 그룹 기본 간격. */
export const DEFAULT_NUMBER_SIZE = 10
/** 크기의 소수 자리 상한 — 키 글자가 지수 표기로 넘어가지 않게(1e-7). */
export const MAX_SIZE_DECIMALS = 6
/** 크기 · 키의 절댓값 상한 — 넘으면 JS 가 지수 표기로 쓴다. */
const MAX_MAGNITUDE = 1e15

const DECIMAL = /^-?\d+(?:\.\d+)?$/

/** 십진 글자의 소수 자리 수 — 지수 표기면 null. */
function decimalsOf(n: number): number | null {
  const s = String(n)
  if (s.includes('e')) return null
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

export function isNumberSize(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= MAX_MAGNITUDE) return false
  const d = decimalsOf(v)
  return d !== null && d <= MAX_SIZE_DECIMALS
}

/** 그 크기의 구간 키인가 — 정규 글자(`String(Number(k))`)이고 크기의 배수다(`''` 는 아니다 — 값 없음은 부르는 쪽이 따로 본다). */
export function isNumberBucketKey(key: string, size: number): boolean {
  if (!DECIMAL.test(key) || !isNumberSize(size)) return false
  const n = Number(key)
  if (String(n) !== key || Math.abs(n) >= MAX_MAGNITUDE) return false
  const d = Math.max(decimalsOf(n) ?? 99, decimalsOf(size) ?? 99)
  if (d > MAX_SIZE_DECIMALS) return false
  const scale = 10 ** d
  return Math.round(n * scale) % Math.round(size * scale) === 0
}

/** 두 십진수를 오차 없이 더한다 — 소수 자리가 지수 표기를 넘으면 그냥 더한다. */
function addDecimal(a: number, b: number): number {
  const da = decimalsOf(a)
  const db = decimalsOf(b)
  if (da === null || db === null) return a + b
  const d = Math.min(Math.max(da, db), 15)
  const scale = 10 ** d
  return (Math.round(a * scale) + Math.round(b * scale)) / scale
}

/** 구간 `from` 의 값을 구간 `to` 로 — 구간 차이만큼 더한다. 둘 다 정규 키여야 한다(아니면 그대로). */
export function shiftNumber(value: number, from: string, to: string): number {
  if (!DECIMAL.test(from) || !DECIMAL.test(to)) return value
  return addDecimal(value, addDecimal(Number(to), -Number(from)))
}

/** 그룹 머리의 이름 — `20 ~ 30`(위 끝은 들지 않는다). 키가 숫자가 아니면 그대로. */
export function numberGroupLabel(key: string, size: number): string {
  if (!DECIMAL.test(key)) return key
  return `${key} ~ ${String(addDecimal(Number(key), size))}`
}
