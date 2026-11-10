import assert from 'node:assert/strict'
import { test } from 'node:test'

import { publicFilesValue } from './public-files.ts'

test('공개 파일 칸은 이름만 싣는다 — 파일 id 는 없다', () => {
  const id = '6c1e0d3a-1111-4222-8333-444455556666'
  const out = publicFilesValue({ type: 'files', files: [{ id, name: '계획.pdf' }, { id: 'x', name: 3 }, null] })
  assert.deepEqual(out, { type: 'files', files: [{ name: '계획.pdf' }] })
  assert.equal(JSON.stringify(out).includes(id), false)
})

test('모양이 아니면 빈 목록', () => {
  assert.deepEqual(publicFilesValue(null), { type: 'files', files: [] })
  assert.deepEqual(publicFilesValue({ files: 'nope' }), { type: 'files', files: [] })
})
