/**
 * 올린 파일의 서명 주소 — 노션처럼 1시간 사는 주소 (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪ · §3.10 `file`(서명 주소는 저장하지 않고 읽을 때 만든다)
 *
 *   주소   `{출처}/api/files/{file_id}?expires=<유닉스 초>&signature=<base64url 43자>` — 세션 없이 연다(`app/api/files/[fileId]/route.ts`)
 *   서명   HMAC-SHA256(키, `{file_id}:{expires}`) · 키는 `AUTH_SECRET` 에서 HKDF-SHA256(`info='notion-clone/api-file-url/v1'`)
 *   비교   상수 시간(`timingSafeEqual`) · 서명을 먼저 본 뒤 만료 — 틀린 서명과 지난 만료는 403, 없는 파일은 404(부르는 쪽)
 *   왕복   읽은 주소를 그대로 보내면 같은 파일 — 서명만 보고 만료는 보지 않는다(`ownFileIdOf`)
 *
 * 서명 · 검사는 키를 받는 순수 함수다(시험이 키를 준다). 키를 환경에서 읽는 것은 `fileUrlKey` 하나.
 */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/** 주소의 수명 — 노션의 1시간. */
export const FILE_URL_TTL_SECONDS = 60 * 60

/** 주소의 경로 머리 — 라우트 `app/api/files/[fileId]`. */
export const FILE_URL_PATH = '/api/files/'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EXPIRES = /^\d{1,12}$/
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/

let cachedKey: { readonly secret: string; readonly key: Buffer } | null = null

/** 서명의 키 — `AUTH_SECRET` 에서 유도한다(다른 용도의 키와 섞이지 않게 info 가 다르다). */
export function fileUrlKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET 이 없다 — 파일 주소에 서명할 수 없다')
  if (cachedKey?.secret !== secret) {
    cachedKey = { secret, key: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'notion-clone/api-file-url/v1', 32)) }
  }
  return cachedKey.key
}

function mac(key: Buffer, fileId: string, expires: number): Buffer {
  return createHmac('sha256', key).update(`${fileId}:${expires}`).digest()
}

export function signFile(key: Buffer, fileId: string, expires: number): string {
  return mac(key, fileId, expires).toString('base64url')
}

/** 노션의 `file` 객체의 속 — `{url, expiry_time}`. */
export type HostedFile = { readonly url: string; readonly expiry_time: string }

/** 파일 하나의 서명 주소 — 지금부터 1시간. */
export function signedFileUrl(origin: string, key: Buffer, fileId: string, now: Date): HostedFile {
  const expires = Math.floor(now.getTime() / 1000) + FILE_URL_TTL_SECONDS
  const id = fileId.toLowerCase()
  return {
    url: `${origin}${FILE_URL_PATH}${id}?expires=${expires}&signature=${signFile(key, id, expires)}`,
    expiry_time: new Date(expires * 1000).toISOString(),
  }
}

export type FileSignatureCheck = 'ok' | 'bad_signature' | 'expired'

/**
 * 서명을 본다 — 모양 · 서명(상수 시간) → 만료 차례. `now` 를 주지 않으면 만료는 보지 않는다(왕복).
 * 모양이 틀린 것도 `bad_signature` 다(어느 쪽인지 말하지 않는다).
 */
export function checkFileSignature(
  key: Buffer,
  fileId: string,
  expiresRaw: string | null,
  signature: string | null,
  now: Date | null,
): FileSignatureCheck {
  if (!UUID.test(fileId) || expiresRaw === null || !EXPIRES.test(expiresRaw) || signature === null || !SIGNATURE.test(signature)) {
    return 'bad_signature'
  }
  const expires = Number(expiresRaw)
  // 글자로 견준다 — 43자의 끝 글자는 남는 비트가 있어 바이트로 풀어 견주면 다른 글자가 같은 서명이 된다
  const given = Buffer.from(signature, 'utf8')
  const expected = Buffer.from(signFile(key, fileId, expires), 'utf8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad_signature'
  if (now !== null && expires * 1000 <= now.getTime()) return 'expired'
  return 'ok'
}

/** 주소에서 서명의 재료를 — 우리 주소의 모양(`/api/files/{uuid}` · 두 매개변수)이 아니면 null. 출처는 보지 않는다(서명이 증명한다). */
export function readFileUrl(raw: string): { readonly fileId: string; readonly expires: string; readonly signature: string } | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.pathname.startsWith(FILE_URL_PATH)) return null
  const fileId = url.pathname.slice(FILE_URL_PATH.length)
  const expires = url.searchParams.get('expires')
  const signature = url.searchParams.get('signature')
  if (!UUID.test(fileId) || expires === null || signature === null) return null
  return { fileId, expires, signature }
}

/** 왕복 — 우리가 서명한 주소면 그 파일 id(만료는 보지 않는다) · 아니면 null. */
export function fileIdOfSignedUrl(key: Buffer, raw: string): string | null {
  const parts = readFileUrl(raw)
  if (parts === null) return null
  return checkFileSignature(key, parts.fileId, parts.expires, parts.signature, null) === 'ok' ? parts.fileId : null
}

/** 환경의 키로 — 받기 쪽(블록 · 속성 · 아이콘 · 커버)이 주입받는 함수. */
export function ownFileIdOf(raw: string): string | null {
  return fileIdOfSignedUrl(fileUrlKey(), raw)
}
