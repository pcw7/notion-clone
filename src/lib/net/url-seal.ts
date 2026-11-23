/**
 * 웹훅 URL 의 봉인 — AES-256-GCM (히스토리 · 활동 4e-1 · F-11-19, DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ③
 *
 * Slack 의 incoming webhook URL 은 그 자체가 비밀이다 — 아는 사람은 누구나 그 채널에 쓸 수 있다. 2단계 인증의 비밀값(`auth/mfa-seal.ts`)과
 * 같은 방식으로 봉인한다 — `AUTH_SECRET` 에서 HKDF-SHA256(`info='notion-clone/webhook-url/v1'`)으로 유도한 키. 다른 용도의 키와 섞이지
 * 않게 info 가 다르다. DB 만 새면 URL 을 읽을 수 없다.
 *
 * 저장 모양: `판(1바이트 = 1) ‖ IV(12) ‖ 인증 태그(16) ‖ 암호문`. 손댄 값 · 다른 키로 봉인한 값은 null.
 *
 * 공개 API 웹훅의 확인 토큰(API-8)도 같은 모양으로 봉인한다 — 키의 info 만 다르다(`notion-clone/api-webhook-secret/v1`).
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16

/** 웹훅 URL 의 키 · 공개 API 웹훅의 확인 토큰(서명의 비밀 — API-8)의 키 — info 가 달라 서로 풀지 못한다. */
const URL_INFO = 'notion-clone/webhook-url/v1'
const SECRET_INFO = 'notion-clone/api-webhook-secret/v1'

function key(info: string): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET 이 없다 — 웹훅 URL 을 봉인할 수 없다')
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))
}

function seal(value: string, info: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(info), iv)
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body])
}

function unseal(sealed: Buffer, info: string): string | null {
  if (sealed.length <= 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) return null
  const iv = sealed.subarray(1, 1 + IV_BYTES)
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const body = sealed.subarray(1 + IV_BYTES + TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(info), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const sealWebhookUrl = (url: string): Buffer => seal(url, URL_INFO)
export const unsealWebhookUrl = (sealed: Buffer): string | null => unseal(sealed, URL_INFO)

/** 공개 API 웹훅의 확인 토큰(API-8 · 정본 [보강 API-1] ⑫) — 서명의 비밀이라 평문 칸에 두지 않는다. */
export const sealWebhookSecret = (secret: string): Buffer => seal(secret, SECRET_INFO)
export const unsealWebhookSecret = (sealed: Buffer): string | null => unseal(sealed, SECRET_INFO)

/** 화면에 보일 힌트 — 호스트와 경로의 끝 4자만(정본 DDL `url_hint`). 원문을 짐작할 수 없게. */
export function webhookUrlHint(url: URL): string {
  const rest = `${url.pathname}${url.search}`.replace(/\/+$/, '')
  return rest.length <= 1 ? url.host : `${url.host}/…${rest.slice(-4)}`
}
