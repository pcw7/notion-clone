/**
 * 검증 칸 — 값의 모양 · 읽을 때 만료 판정 · 칸의 글 (VF-1 · F-03-23 · 정본 §3.5 [보강 VF-1] ① ⑥)
 *
 * DB 를 모르는 모듈이다(클라이언트가 값으로 쓴다). 칸 가드(0133)와 같은 모양이다 — 셀이 아니라 `CellValue` 에 넣지 않는다:
 * 쓰는 길은 전용 명령(`verification.ts`) 하나다(⑨).
 */

export type VerificationValue = {
  readonly type: 'verification'
  readonly state: 'verified'
  readonly verified_by: string
  readonly verified_at: string
  /** 없으면(null) 무기한. */
  readonly expires_at: string | null
}

/** 읽는 쪽이 받는 칸 — 저장된 값 + 읽을 때 정한 만료(`expires_at <= 지금`). 만료는 어디에도 적지 않는다(①). */
export type VerificationCell = VerificationValue & { readonly expired: boolean }

const DAY_MS = 24 * 60 * 60 * 1000

/** 저장된 값을 읽는다. 모양이 아니면 null(빈 칸으로 그린다). */
export function readVerification(raw: unknown): VerificationValue | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  if (v.type !== 'verification' || v.state !== 'verified') return null
  if (typeof v.verified_by !== 'string' || typeof v.verified_at !== 'string') return null
  if (v.expires_at !== null && typeof v.expires_at !== 'string') return null
  return { type: 'verification', state: 'verified', verified_by: v.verified_by, verified_at: v.verified_at, expires_at: v.expires_at }
}

export function isVerificationExpired(value: Pick<VerificationValue, 'expires_at'>, now: Date): boolean {
  return value.expires_at !== null && new Date(value.expires_at).getTime() <= now.getTime()
}

/** 서버가 행을 내보낼 때 붙인다 — 저장된 값에 `expired` 를 더한다. 모양이 아니면 null. */
export function toVerificationCell(raw: unknown, now: Date): VerificationCell | null {
  const value = readVerification(raw)
  return value === null ? null : { ...value, expired: isVerificationExpired(value, now) }
}

/** 칸의 글 — 검증됨 "N일 남음" · "무기한" · 만료. 칸이 비었으면 빈 글. */
export function verificationLabel(cell: VerificationCell | null, now: Date): string {
  if (cell === null) return ''
  if (cell.expired) return '만료'
  if (cell.expires_at === null) return '✓ 검증됨 · 무기한'
  const days = Math.max(1, Math.ceil((new Date(cell.expires_at).getTime() - now.getTime()) / DAY_MS))
  return `✓ 검증됨 · ${days}일 남음`
}

/** 머리말(title) — 누가 · 언제 · 언제까지. 이름은 부르는 쪽이 찾아 준다. */
export function verificationTitle(cell: VerificationCell | null, who: string): string {
  if (cell === null) return ''
  const day = (iso: string) => iso.slice(0, 10)
  const until = cell.expires_at === null ? '무기한' : `${day(cell.expires_at)} 까지`
  return `${who} · ${day(cell.verified_at)} 검증 · ${cell.expired ? `만료됨(${day(cell.expires_at ?? cell.verified_at)})` : until}`
}

/**
 * 행의 칸 묶음(`properties_cache`)에서 검증 칸에 `expired` 를 더한다 — 읽을 때 정한다(①). 검증 칸이 없으면 같은 객체를 돌려준다.
 * 행을 내보내는 두 문(`row.ts` `toRowSummary` · `query.ts` `toQueriedRow`)이 부른다.
 */
export function withVerificationExpiry(
  properties: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Readonly<Record<string, unknown>> {
  let out: Record<string, unknown> | null = null
  for (const [id, raw] of Object.entries(properties)) {
    if (typeof raw !== 'object' || raw === null || (raw as { type?: unknown }).type !== 'verification') continue
    out ??= { ...properties }
    out[id] = toVerificationCell(raw, now)
  }
  return out ?? properties
}
