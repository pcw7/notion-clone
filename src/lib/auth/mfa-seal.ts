/**
 * TOTP 비밀값의 봉인 — AES-256-GCM (잔여 묶음 8i-2a · F-14-05, DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.2 `mfa_method.totp_secret -- KMS 봉인` · [보강] 2단계 인증 ②
 *
 * KMS 대신 애플리케이션 키로 봉인한다 — `AUTH_SECRET` 에서 HKDF-SHA256(`info='notion-clone/mfa-totp/v1'`)으로 유도한 256비트 키. DB 만
 * 새면 비밀값을 읽을 수 없다(14 *"DB 유출 시 즉시 전 계정 무력화되기 때문"*). 운영에서는 KMS 가 `AUTH_SECRET` 을 감싼다.
 *
 * 저장 모양: `판(1바이트 = 1) ‖ IV(12) ‖ 인증 태그(16) ‖ 암호문`. 키를 바꾸는 날은 판 번호로 가른다. 손댄 값 · 다른 키로 봉인한 값은 null.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET 이 없다 — 2단계 인증의 비밀값을 봉인할 수 없다')
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'notion-clone/mfa-totp/v1', 32))
}

export function sealTotpSecret(plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body])
}

export function unsealTotpSecret(sealed: Buffer): Buffer | null {
  if (sealed.length <= 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) return null
  const iv = sealed.subarray(1, 1 + IV_BYTES)
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const body = sealed.subarray(1 + IV_BYTES + TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    return null
  }
}
