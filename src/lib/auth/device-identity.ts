/**
 * 기기 표시 · "내가 아니에요" 링크의 서명 — 순수 함수 (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3]
 *
 *   기기 열쇠   브라우저 쿠키 `nc_device` 의 값 — 256비트 난수(base64url 43자). 로그인 라우트가 없으면 만든다.
 *   기기 표시   `user_session.device_id` — **SHA-256(user_id ‖ ':' ‖ 열쇠)의 앞 16바이트를 판 8 UUID 로**. 원문은 DB 에 남지 않는다 ·
 *              사람마다 값이 달라 한 브라우저의 두 계정이 DB 에서 이어지지 않는다 · DB 가 새어도 남의 "아는 기기"를 흉내 내지 못한다.
 *              판 8 만 받는 CHECK 이 날 UUID 를 넣는 실수를 막는다(0158).
 *   링크       `/account/not-me?t=<세션 id>.<만료 초>.<서명>` · HMAC-SHA256(키, `device-report:<세션 id>:<만료>`) · 키는 `AUTH_SECRET` 에서
 *              HKDF-SHA256(`info='notion-clone/device-report/v1'` — 다른 용도의 키와 섞이지 않게) · 7일.
 *
 * 서명 · 검사는 키를 받는 순수 함수다(시험이 키를 준다). 키를 환경에서 읽는 것은 `deviceReportKey` 하나 — `api/file-url.ts` 와 같은 꼴.
 */

import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

import { DEVICE_REPORT_TTL_DAYS } from './constants.ts'

const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EXPIRES = /^\d{1,12}$/
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/

/** 이 브라우저의 새 기기 열쇠 — 쿠키에 넣는 원문. */
export function newDeviceKey(): string {
  return randomBytes(32).toString('base64url')
}

/** 쿠키 값이 기기 열쇠의 모양인가 — 아니면 새로 만든다(남이 고른 짧은 값으로 기기 표시를 맞추지 못하게). */
export function isDeviceKey(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_KEY.test(value)
}

/** 기기 표시 — 그 사람 · 그 열쇠의 판 8 UUID. 같은 입력이면 같은 값이다. */
export function deviceIdFor(userId: string, deviceKey: string): string {
  const bytes = createHash('sha256').update(`${userId.toLowerCase()}:${deviceKey}`, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80 // 판 8(RFC 9562 — 쓰는 쪽이 정한 값)
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // 변형 10
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let cachedKey: { readonly secret: string; readonly key: Buffer } | null = null

/** 링크 서명의 키 — `AUTH_SECRET` 에서 유도한다. 없으면 던진다(알림을 보내는 쪽이 잡아 로그에 남긴다). */
export function deviceReportKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET 이 없다 — "내가 아니에요" 링크에 서명할 수 없다')
  if (cachedKey?.secret !== secret) {
    cachedKey = { secret, key: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'notion-clone/device-report/v1', 32)) }
  }
  return cachedKey.key
}

const mac = (key: Buffer, sessionId: string, expires: number): string =>
  createHmac('sha256', key).update(`device-report:${sessionId}:${expires}`).digest('base64url')

/** 그 세션을 "내가 아니에요"로 알리는 토큰 — 지금부터 7일. */
export function signDeviceReport(key: Buffer, sessionId: string, now: Date): string {
  const id = sessionId.toLowerCase()
  const expires = Math.floor(now.getTime() / 1000) + DEVICE_REPORT_TTL_DAYS * 24 * 60 * 60
  return `${id}.${expires}.${mac(key, id, expires)}`
}

export type DeviceReportCheck =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' }

/** 토큰을 본다 — 모양 · 서명(상수 시간) → 만료 차례. 모양이 틀린 것도 `invalid` 다(어느 쪽인지 말하지 않는다). */
export function checkDeviceReport(key: Buffer, token: unknown, now: Date): DeviceReportCheck {
  if (typeof token !== 'string' || token.length > 200) return { ok: false, reason: 'invalid' }
  const [sessionId, expiresRaw, signature, ...rest] = token.split('.')
  if (rest.length > 0 || sessionId === undefined || !UUID.test(sessionId) || expiresRaw === undefined || !EXPIRES.test(expiresRaw)) {
    return { ok: false, reason: 'invalid' }
  }
  if (signature === undefined || !SIGNATURE.test(signature)) return { ok: false, reason: 'invalid' }
  const expires = Number(expiresRaw)
  // 글자로 견준다 — 43자의 끝 글자에는 남는 비트가 있어 바이트로 풀면 다른 글자가 같은 서명이 된다(`file-url.ts` 와 같다)
  const given = Buffer.from(signature, 'utf8')
  const expected = Buffer.from(mac(key, sessionId, expires), 'utf8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' }
  if (expires * 1000 <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, sessionId }
}

/** "내가 아니에요" 화면의 주소. */
export function deviceReportUrl(appUrl: string, token: string): string {
  return new URL(`/account/not-me?t=${encodeURIComponent(token)}`, appUrl).toString()
}
