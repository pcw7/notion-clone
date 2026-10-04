/**
 * 비밀번호 해시 — argon2id (잔여 묶음 8i-1a · F-14-03, DB 없음)
 *
 *   ① PHC 모양 · 매개변수가 값 안에 · 소금은 매번 새로
 *   ② 맞는 비밀번호만 통과 · 한 글자만 달라도 · 모양이 틀린 값 · 손으로 바꾼 값은 false
 *   ③ 옛 매개변수로 만든 해시도 그 매개변수로 검증하고, 다시 만들 때를 알려 준다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { argon2Sync, randomBytes } from 'node:crypto'

import { PASSWORD_HASH_PARAMS, decoyHash, hashPassword, needsRehash, verifyPassword } from './password-hash.ts'

test('① PHC 모양 · 매개변수가 값 안에 · 소금은 매번 새로', async () => {
  const a = await hashPassword('correct horse 1')
  const b = await hashPassword('correct horse 1')
  assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
  assert.notEqual(a, b, '같은 비밀번호인데 해시가 같다 — 소금이 없다')
  const [, , , , salt, tag] = a.split('$')
  assert.ok(!salt!.includes('=') && !tag!.includes('='), 'PHC 의 base64 는 = 없이')
})

test('★ ② 맞는 비밀번호만 통과한다', async () => {
  const stored = await hashPassword('correct horse 1')
  assert.equal(await verifyPassword('correct horse 1', stored), true)
  assert.equal(await verifyPassword('correct horse 2', stored), false)
  assert.equal(await verifyPassword('', stored), false)
  assert.equal(await verifyPassword('correct horse 1', 'correct horse 1'), false, '평문을 해시로 읽었다')
  // 태그의 첫 글자를 바꾼다
  const parts = stored.split('$')
  parts[5] = (parts[5]![0] === 'A' ? 'B' : 'A') + parts[5]!.slice(1)
  assert.equal(await verifyPassword('correct horse 1', parts.join('$')), false)
  // 터무니없는 매개변수(메모리 4GiB)는 계산하지 않는다
  assert.equal(await verifyPassword('correct horse 1', stored.replace('m=19456', 'm=4194304')), false)
})

test('③ 옛 매개변수로 만든 해시도 검증하고 · 다시 만들 때를 알려 준다', async () => {
  const salt = randomBytes(16)
  const tag = argon2Sync('argon2id', { message: Buffer.from('old password 1'), nonce: salt, parallelism: 1, tagLength: 32, memory: 8192, passes: 1 })
  const b64 = (x: Buffer) => x.toString('base64').replace(/=+$/, '')
  const old = `$argon2id$v=19$m=8192,t=1,p=1$${b64(salt)}$${b64(tag)}`
  assert.equal(await verifyPassword('old password 1', old), true)
  assert.equal(needsRehash(old), true)
  assert.equal(needsRehash(await hashPassword('new password 1')), false)
  assert.equal(PASSWORD_HASH_PARAMS.memory, 19456)
})

test('가짜 해시는 한 번 만들어 둔다 — 어떤 비밀번호와도 맞지 않는다', async () => {
  const d = await decoyHash()
  assert.equal(d, await decoyHash())
  assert.equal(await verifyPassword('anything 1', d), false)
})
