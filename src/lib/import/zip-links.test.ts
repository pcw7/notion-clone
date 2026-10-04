/**
 * ZIP 안의 상대 주소 — 잔여 묶음 8m-2b (순수)
 *
 *   ① 그 md 의 폴더에서 출발한다 · 퍼센트 인코딩을 푼다(우리 · 노션의 내보내기가 그렇게 쓴다)
 *   ② `.` · `..` 를 접는다 · 맨 위 밖은 null · 역슬래시도 구분자
 *   ③ ZIP 안이 아닌 것 — 스킴 · 절대 경로 · 앵커만 · 빈 주소는 null · `?` · `#` 꼬리는 뗀다 · 깨진 인코딩은 그대로
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveZipHref } from './zip-links.ts'

test('★ ① 그 md 의 폴더에서 출발 · 퍼센트 인코딩을 푼다', () => {
  assert.equal(resolveZipHref('회의록.md', '%ED%9A%8C%EC%9D%98%EB%A1%9D/%EC%B2%AB%EC%A7%B8.md'), '회의록/첫째.md')
  assert.equal(resolveZipHref('회의록.md', '회의록/그림%201.png'), '회의록/그림 1.png')
  assert.equal(resolveZipHref('위/회의록.md', '회의록/첫째.md'), '위/회의록/첫째.md')
  // 우리 내보내기의 `encodeHrefSegment` — `%` · `#` · `?` 가 든 이름
  assert.equal(resolveZipHref('a.md', 'a/50%25%20%23%3F.md'), 'a/50% #?.md')
})

test('② `.` · `..` 를 접는다 · 맨 위 밖은 null · 역슬래시', () => {
  assert.equal(resolveZipHref('위/아래/글.md', '../옆.md'), '위/옆.md')
  assert.equal(resolveZipHref('위/글.md', './그림.png'), '위/그림.png')
  assert.equal(resolveZipHref('위/글.md', '..\\옆.md'), '옆.md')
  assert.equal(resolveZipHref('글.md', '../밖.md'), null)
  assert.equal(resolveZipHref('위/글.md', '..'), null)
})

test('③ ZIP 안이 아닌 것은 null · 꼬리는 뗀다 · 깨진 인코딩은 그대로', () => {
  for (const href of ['https://example.com/a.md', 'mailto:a@b.c', 'C:\\글.md', '/절대.md', '\\\\서버\\글.md', '#제목', '', '   ']) {
    assert.equal(resolveZipHref('위/글.md', href), null, href)
  }
  assert.equal(resolveZipHref('글.md', '하위.md#제목'), '하위.md')
  assert.equal(resolveZipHref('글.md', '하위.md?x=1'), '하위.md')
  assert.equal(resolveZipHref('글.md', '100%.md'), '100%.md')
})
