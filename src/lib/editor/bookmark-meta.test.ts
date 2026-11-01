// 북마크 카드의 메타 캐시(F-4b · 정본 §3.4 [보강 F-4] ⑤) — 주소(해시를 뗀 것)로 기억 · 못 읽은 것은 기억하지 않는다 · 동시 요청은 하나.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { bookmarkMetaOfResponse, bookmarkMetaSource, type BookmarkMeta } from './bookmark-meta.ts'

const meta = (title: string): BookmarkMeta => ({ status: 'ok', title, description: null, imageUrl: null, siteName: null })

describe('bookmarkMetaSource', () => {
  test('★ 해시를 뗀 같은 주소는 한 번만 묻는다 · 동시 요청은 하나 · 주소가 아니면 묻지 않는다', async () => {
    let calls = 0
    const asked: string[] = []
    const source = bookmarkMetaSource(async (url) => {
      calls += 1
      asked.push(url)
      await new Promise((r) => setTimeout(r, 5))
      return meta('제목')
    })
    const [a, b] = await Promise.all([source.get('https://a.test/x#one'), source.get('https://a.test/x#two')])
    assert.deepEqual(a, meta('제목'))
    assert.deepEqual(b, a)
    assert.equal(calls, 1)
    assert.deepEqual(asked, ['https://a.test/x'])
    assert.deepEqual(source.peek('https://a.test/x'), meta('제목'))
    assert.equal(await source.get('javascript:alert(1)'), null)
    assert.equal(calls, 1)
  })

  test('못 읽은 것(null · 예외)은 기억하지 않는다', async () => {
    let calls = 0
    const source = bookmarkMetaSource(async () => {
      calls += 1
      if (calls === 1) return null
      if (calls === 2) throw new Error('끊김')
      return meta('셋째')
    })
    assert.equal(await source.get('https://b.test/'), null)
    assert.equal(await source.get('https://b.test/'), null)
    assert.deepEqual(await source.get('https://b.test/'), meta('셋째'))
  })
})

describe('bookmarkMetaOfResponse', () => {
  test('라우트의 답을 읽는다 · 빈 글은 null · ★ 그림은 http(s) 만 · 틀린 모양은 null', () => {
    assert.deepEqual(
      bookmarkMetaOfResponse({ ok: true, preview: { status: 'ok', title: '제목', description: '', imageUrl: 'https://a.test/c.png', siteName: '사이트' } }),
      { status: 'ok', title: '제목', description: null, imageUrl: 'https://a.test/c.png', siteName: '사이트' },
    )
    assert.equal(bookmarkMetaOfResponse({ preview: { status: 'ok', imageUrl: 'javascript:alert(1)' } })?.imageUrl, null)
    assert.equal(bookmarkMetaOfResponse({ preview: { status: 'weird' } }), null)
    assert.equal(bookmarkMetaOfResponse(null), null)
  })
})
