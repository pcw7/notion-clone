// 북마크 블록의 순수 함수(F-3 · 정본 §3.4 [보강 F-3]).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { textRun } from '../contracts/rich-text.ts'
import {
  MAX_BOOKMARK_URL_LENGTH,
  bookmarkHost,
  bookmarkTitle,
  isBookmarkUrl,
  readBookmarkUrl,
  validateBookmarkProperties,
  withBookmarkUrl,
} from './bookmark-block.ts'

describe('북마크 — 주소 (F-3)', () => {
  test('★ http · https 만 · 상한 안 · URL 로 읽혀야', () => {
    assert.equal(isBookmarkUrl('https://a.test/x'), true)
    assert.equal(isBookmarkUrl('http://a.test'), true)
    assert.equal(isBookmarkUrl('javascript:alert(1)'), false)
    assert.equal(isBookmarkUrl('ftp://a.test'), false)
    assert.equal(isBookmarkUrl('not a url'), false)
    assert.equal(isBookmarkUrl(`https://a.test/${'x'.repeat(MAX_BOOKMARK_URL_LENGTH)}`), false)
    assert.equal(isBookmarkUrl(42), false)
  })

  test('읽기 · 쓰기 — 틀린 주소는 null · null 을 쓰면 지우고 캡션 · 모르는 키는 남는다', () => {
    assert.equal(readBookmarkUrl({ url: 'https://a.test' }), 'https://a.test')
    assert.equal(readBookmarkUrl({ url: 'javascript:x' }), null)
    assert.equal(readBookmarkUrl(null), null)
    const caption = [textRun('c')]
    assert.deepEqual(withBookmarkUrl({ url: 'https://a.test', caption, extra: 1 }, null), { caption, extra: 1 })
    assert.deepEqual(withBookmarkUrl({ caption }, 'https://b.test'), { caption, url: 'https://b.test' })
  })

  test('카드 — 호스트는 www. 를 뗀다 · 제목은 메타가 없으면 주소', () => {
    assert.equal(bookmarkHost('https://www.example.com/a'), 'example.com')
    assert.equal(bookmarkHost('nope'), '')
    assert.equal(bookmarkTitle('https://a.test'), 'https://a.test')
    assert.equal(bookmarkTitle('https://a.test', '  제목 '), '제목')
    assert.equal(bookmarkTitle('https://a.test', '   '), 'https://a.test')
  })

  test('★ Y.Doc 계약 — 틀린 주소 · 틀린 캡션은 거부 · 주소가 없어도(빈 블록) 된다', () => {
    assert.equal(validateBookmarkProperties({ url: 'https://a.test', caption: [textRun('c')] }, 'p').length, 0)
    assert.equal(validateBookmarkProperties({}, 'p').length, 0)
    assert.equal(validateBookmarkProperties({ url: 'javascript:alert(1)' }, 'p').length, 1)
    assert.ok(validateBookmarkProperties({ caption: 'x' }, 'p').length >= 1)
  })
})
