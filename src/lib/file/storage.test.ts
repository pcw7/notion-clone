/**
 * 로컬 스토리지 드라이버 — F-12-09
 *
 * 이 파일이 지키는 것은 하나다: **드라이버가 자기 폴더 밖으로 나가지 않는다.**
 * 키는 우리가 만들지만 읽을 때는 DB 에서 읽은 값이 들어온다. 그 사이에 무엇이
 * 끼어들었든 `..` 하나로 저장 폴더 밖을 읽고 쓰게 되면 안 된다.
 */

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { localFileStorage, safeKey } from './storage.ts'

const root = mkdtempSync(join(tmpdir(), 'nc-storage-'))
const outside = mkdtempSync(join(tmpdir(), 'nc-outside-'))
const storage = localFileStorage(root)

after(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('로컬 드라이버 — 왕복', () => {
  test('쓴 것을 그대로 읽는다', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250])
    await storage.put('ws/file.png', bytes)
    assert.deepEqual(await storage.read('ws/file.png'), bytes)
  })

  test('없는 키는 null 이다 — 던지지 않는다', async () => {
    assert.equal(await storage.read('ws/없는것.png'), null)
  })

  test('지우면 없어진다. 두 번 지워도 조용하다', async () => {
    await storage.put('ws/지울것.png', new Uint8Array([1]))
    await storage.remove('ws/지울것.png')
    assert.equal(await storage.read('ws/지울것.png'), null)
    await storage.remove('ws/지울것.png')
  })

  test('중첩 폴더를 알아서 만든다', async () => {
    await storage.put('a/b/c/d.png', new Uint8Array([9]))
    assert.ok(existsSync(join(root, 'a', 'b', 'c', 'd.png')))
  })
})

describe('★ 폴더 밖으로 나가지 않는다', () => {
  const secret = join(outside, 'secret.txt')
  writeFileSync(secret, '비밀')

  test('safeKey — 빠져나가는 모양을 거른다', () => {
    assert.equal(safeKey('ws/a.png'), 'ws/a.png')
    assert.equal(safeKey(''), null)
    assert.equal(safeKey('../secret.txt'), null)
    assert.equal(safeKey('ws/../../secret.txt'), null)
    assert.equal(safeKey('/etc/passwd'), null)
    // 윈도우 경로 구분자도 막는다 — 리눅스에서는 파일명의 일부로 통과해 버린다.
    assert.equal(safeKey('ws\\..\\secret.txt'), null)
  })

  test('읽기 — 밖을 가리키면 null', async () => {
    assert.equal(await storage.read('../../secret.txt'), null)
  })

  test('쓰기 — 밖을 가리키면 던진다. 조용히 쓰지 않는다', async () => {
    await assert.rejects(() => storage.put('../탈출.png', new Uint8Array([1])))
    assert.ok(!existsSync(join(outside, '탈출.png')))
  })

  test('지우기 — 밖을 가리키면 아무 일도 하지 않는다', async () => {
    await storage.remove('../secret.txt')
    assert.ok(existsSync(secret), '바깥 파일이 지워졌다')
  })
})
