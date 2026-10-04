/**
 * 비밀번호 해시 — argon2id (잔여 묶음 8i-1a · F-14-03, DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.2 `credential.password_hash -- argon2id` · [보강] 비밀번호 ①
 *
 * Node 24.7 의 내장 `crypto.argon2` 로 만든다(의존성 없음 · #169). 저장은 PHC 문자열이다:
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<소금 base64>$<태그 base64>
 *
 * 매개변수가 값 안에 있어 나중에 올려도 옛 해시를 그 매개변수로 검증한다(`needsRehash` 가 올릴 때를 알려 준다). OWASP 의 argon2id 권고
 * (m=19MiB · t=2 · p=1)를 쓰고 소금 16바이트 · 태그 32바이트다. 비교는 상수 시간(`timingSafeEqual`). base64 는 PHC 대로 `=` 없이.
 */

import { argon2 as argon2Callback, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const argon2 = promisify(argon2Callback)

export const PASSWORD_HASH_PARAMS = { memory: 19456, passes: 2, parallelism: 1 } as const
const SALT_BYTES = 16
const TAG_BYTES = 32

type Params = { readonly memory: number; readonly passes: number; readonly parallelism: number }

const b64 = (buffer: Buffer): string => buffer.toString('base64').replace(/=+$/, '')

async function derive(password: string, salt: Buffer, params: Params, tagLength: number): Promise<Buffer> {
  return argon2('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism: params.parallelism,
    tagLength,
    memory: params.memory,
    passes: params.passes,
  })
}

/** 새 해시 — 소금은 매번 새로. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const params = PASSWORD_HASH_PARAMS
  const tag = await derive(password, salt, params, TAG_BYTES)
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`
}

type Parsed = { readonly params: Params; readonly salt: Buffer; readonly tag: Buffer }

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

function parse(stored: string): Parsed | null {
  const m = PHC.exec(stored)
  if (m === null) return null
  const params = { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) }
  const salt = Buffer.from(m[4]!, 'base64')
  const tag = Buffer.from(m[5]!, 'base64')
  // 터무니없는 매개변수로 만든 값(손으로 넣은 값)은 검증하지 않는다 — 계산 비용을 정하는 것이 저장된 값이기 때문이다.
  if (params.memory < 8 || params.memory > 1 << 20 || params.passes < 1 || params.passes > 10 || params.parallelism !== 1) return null
  if (salt.length < 8 || tag.length < 16) return null
  return { params, salt, tag }
}

/** 이 비밀번호가 저장된 해시와 맞는가 — 모양이 틀린 값은 false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (parsed === null) return false
  const tag = await derive(password, parsed.salt, parsed.params, parsed.tag.length)
  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag)
}

/** 지금의 매개변수보다 약하게 만든 해시인가 — 로그인에 성공했을 때 새로 만들어 바꿀 때를 안다. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored)
  if (parsed === null) return true
  const p = parsed.params
  return p.memory < PASSWORD_HASH_PARAMS.memory || p.passes < PASSWORD_HASH_PARAMS.passes
}

/**
 * 비밀번호가 없는 계정 · 없는 이메일에도 같은 시간을 쓰게 하는 가짜 해시 — 로그인이 "그 이메일에 비밀번호가 있는가"를 시간으로 흘리지
 * 않게(정본 ⑤). 모듈이 처음 쓰일 때 한 번 만든다.
 */
let decoy: Promise<string> | null = null
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString('base64'))
  return decoy
}
