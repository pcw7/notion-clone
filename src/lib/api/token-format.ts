/**
 * 공개 API 개인 토큰의 모양 — 값 만들기 · 알아보기 · 이름 · 만료 (API-1 · F-09-02 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① — 값은 `ntn_` 로 시작 · 만들 때 한 번만 보인다 · 저장은 해시만
 *       09-api-integrations.md F-09-02 PAT 만료 *"7 / 30 / 90 / 180일 / 1년(기본 1년)"*
 *
 * 값은 CSPRNG 의 base62 46자(약 274비트) — 세션 토큰처럼 사전 공격 대상이 아니라 해시는 sha256 이다(`hashSessionToken`). 화면 ·
 * 명령 · `/v1` 이 같은 판정을 쓰도록 DB 를 부르지 않는 것만 둔다.
 */

import { randomBytes } from 'node:crypto'

export const API_TOKEN_PREFIX = 'ntn_'
/** 접두 뒤의 글자 수. */
export const API_TOKEN_BODY_LENGTH = 46
/** 살아 있는 토큰 — 사람마다 워크스페이스마다(정본 ①). */
export const API_TOKEN_MAX_LIVE = 20
export const API_TOKEN_NAME_MAX = 100
/** 고를 수 있는 만료(일) — 노션 PAT 와 같다. null 은 만료 없음. */
export const API_TOKEN_EXPIRY_DAYS = [7, 30, 90, 180, 365] as const
export type ApiTokenExpiryDays = (typeof API_TOKEN_EXPIRY_DAYS)[number]
export const API_TOKEN_DEFAULT_EXPIRY_DAYS: ApiTokenExpiryDays = 365

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/** 62 의 배수 중 256 아래 가장 큰 것 — 그 위의 바이트는 버린다(나머지 치우침 없이). */
const UNBIASED_LIMIT = 248

/** base62 글자 `length` 개 — 바이트를 버려 가며 고르게. */
export function randomBase62(length: number): string {
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= UNBIASED_LIMIT) continue
      out += BASE62[byte % 62]
      if (out.length === length) break
    }
  }
  return out
}

/** 새 토큰 값 — 이 한 번만 평문으로 돌려준다. */
export function newApiToken(): string {
  return API_TOKEN_PREFIX + randomBase62(API_TOKEN_BODY_LENGTH)
}

const SHAPE = new RegExp(`^${API_TOKEN_PREFIX}[0-9A-Za-z]{${API_TOKEN_BODY_LENGTH}}$`)

/** 우리 토큰의 모양인가 — 아니면 DB 를 묻지 않고 401 이다. */
export function isApiTokenShape(value: string): boolean {
  return SHAPE.test(value)
}

/** 목록에서 알아보는 끝 4자. */
export function apiTokenLast4(token: string): string {
  return token.slice(-4)
}

/** 토큰 이름 — 개행 · 연속 공백을 접고 양끝을 자른다. 비었거나 100자를 넘으면 null. */
export function normalizeTokenName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  return name.length === 0 || [...name].length > API_TOKEN_NAME_MAX ? null : name
}

/**
 * 만료 — 빠지면 기본 1년 · `null` 이면 만료 없음 · 고를 수 있는 일수면 그것. 그 밖은 `invalid`.
 */
export function parseExpiryDays(raw: unknown): ApiTokenExpiryDays | null | 'invalid' {
  if (raw === undefined) return API_TOKEN_DEFAULT_EXPIRY_DAYS
  if (raw === null) return null
  return (API_TOKEN_EXPIRY_DAYS as readonly unknown[]).includes(raw) ? (raw as ApiTokenExpiryDays) : 'invalid'
}
