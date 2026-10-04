/**
 * TOTP — RFC 6238 (잔여 묶음 8i-2a · F-14-05, DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ① · ③ · ⑤
 *
 * 인증 앱들이 받는 기본값 그대로다 — HMAC-SHA1 · 30초 · 6자리 · 비밀값 20바이트(base32 로 보인다). 의존성 없이 `node:crypto` 로 만든다.
 *
 *   · `matchTotp` — ±1 창(±30초)을 받되, **이미 쓴 창과 그 앞의 창은 받지 않는다**(재사용 막기 · 정본 ⑤). 맞으면 그 창 번호를 준다
 *   · 백업 코드 — `xxxxx-xxxxx`(base32 소문자 10자) · 저장은 SHA-256 으로만(무작위 50비트라 느린 해시가 필요 없다) · 입력은 대소문자 ·
 *     하이픈 · 공백을 가리지 않는다
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
export const TOTP_SECRET_BYTES = 20

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch)
    if (index === -1) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const newTotpSecret = (): Buffer => randomBytes(TOTP_SECRET_BYTES)

/** 이 시각(ms)의 창 번호. */
export const totpStepAt = (ms: number): number => Math.floor(ms / 1000 / TOTP_PERIOD_SECONDS)

/** 이 창의 코드 — RFC 4226 의 HOTP(카운터 = 창 번호). */
export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const offset = mac[mac.length - 1]! & 15
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/**
 * 받은 코드가 지금 ±1 창 중 하나와 맞으면 그 창 번호를, 아니면 null. `lastUsedStep` 과 그 앞의 창은 보지 않는다 — 한 번 쓴 코드를 다시
 * 낼 수 없다.
 */
export function matchTotp(secret: Buffer, code: unknown, nowMs: number, lastUsedStep: number | null): number | null {
  if (typeof code !== 'string') return null
  const digits = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  const now = totpStepAt(nowMs)
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(digits))) return step
  }
  return null
}

/** 인증 앱이 QR 로 읽는 주소 — `otpauth://totp/발급자:계정?secret=…`. */
export function otpauthUri(secret: Buffer, account: string, issuer = 'notion-clone'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ── 백업 코드 ───────────────────────────────────────────────────────

/** 백업 코드 n개 — `xxxxx-xxxxx`. */
export function newBackupCodes(count: number): string[] {
  return Array.from({ length: count }, () => {
    const text = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase()
    return `${text.slice(0, 5)}-${text.slice(5)}`
  })
}

/** 입력을 가리지 않는 꼴로 — 소문자 · 하이픈과 공백을 뺀다. 백업 코드의 모양이 아니면 null. */
export function normalizeBackupCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  const text = code.replace(/[\s-]/g, '').toLowerCase()
  return /^[a-z2-7]{10}$/.test(text) ? text : null
}

export const hashBackupCode = (normalized: string): string => createHash('sha256').update(normalized).digest('hex')
