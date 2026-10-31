// 파일 메타 캐시(F-1b · 정본 §3.4 [보강 F-1] ⑧) — 한 번 읽은 답은 기억 · 못 읽은 것은 기억하지 않는다 · 동시 요청은 하나.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { fileMetaOfResponse, fileMetaSource } from './file-meta.ts'

describe('fileMetaSource', () => {
  test('★ 같은 id 는 한 번만 묻고 기억한다 · 동시 요청은 한 요청을 나눈다', async () => {
    let calls = 0
    const source = fileMetaSource(async (id) => {
      calls += 1
      await new Promise((r) => setTimeout(r, 5))
      return { name: `f-${id}`, size: 3, mime: 'text/plain' }
    })
    assert.equal(source.peek('a'), null)
    const [x, y] = await Promise.all([source.get('a'), source.get('a')])
    assert.deepEqual(x, { name: 'f-a', size: 3, mime: 'text/plain' })
    assert.deepEqual(y, x)
    assert.equal(calls, 1)
    await source.get('a')
    assert.equal(calls, 1)
    assert.deepEqual(source.peek('a'), x)
  })

  test('못 읽은 것(null · 예외)은 기억하지 않는다 — 다음에 다시 묻는다', async () => {
    let calls = 0
    const source = fileMetaSource(async () => {
      calls += 1
      if (calls === 1) return null
      if (calls === 2) throw new Error('끊김')
      return { name: null, size: 1, mime: 'application/octet-stream' }
    })
    assert.equal(await source.get('b'), null)
    assert.equal(await source.get('b'), null)
    assert.deepEqual(await source.get('b'), { name: null, size: 1, mime: 'application/octet-stream' })
    assert.equal(calls, 3)
  })
})

describe('fileMetaOfResponse', () => {
  test('올리기의 답과 같은 모양을 읽는다 · 빈 이름은 null · 틀린 모양은 null', () => {
    assert.deepEqual(fileMetaOfResponse({ ok: true, file: { id: 'x', mime: 'application/pdf', size: 12, name: '보고서.pdf' } }), { name: '보고서.pdf', size: 12, mime: 'application/pdf' })
    assert.deepEqual(fileMetaOfResponse({ file: { size: 1, name: '' } }), { name: null, size: 1, mime: 'application/octet-stream' })
    assert.equal(fileMetaOfResponse({ file: { name: 'a' } }), null)
    assert.equal(fileMetaOfResponse(null), null)
  })
})
