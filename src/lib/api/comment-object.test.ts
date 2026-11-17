/**
 * 공개 API 의 코멘트 — 객체의 모양 · 요청 다듬기 · 커서 (API-5 · F-09-07 · F-09-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑩
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { equationRun, pageMentionRun, textRun, userMentionRun } from '../contracts/rich-text.ts'
import {
  commentListEnvelope,
  commentToApi,
  decodeCommentCursor,
  encodeCommentCursor,
  parseCommentCreate,
  parseCommentUpdate,
} from './comment-object.ts'
import type { ApiLinks } from './rich-text.ts'

const LINKS: ApiLinks = { origin: 'https://app.test', pageUrl: (id) => `https://app.test/w/ws/${id}` }
const PAGE = '1f2e3d4c-5b6a-4789-8abc-def012345678'
const BLOCK = '2f2e3d4c-5b6a-4789-8abc-def012345678'
const USER = '3f2e3d4c-5b6a-4789-8abc-def012345678'
const DISC = '4f2e3d4c-5b6a-4789-8abc-def012345678'

test('★ 코멘트 객체 — 노션의 키 · 페이지 · 블록 부모 · 고친 적 없으면 만든 때 · 첨부는 빈 배열 · display_name 은 user', () => {
  const created = new Date('2026-11-17T01:02:03.000Z')
  const c = commentToApi(
    {
      id: 'c1', discussionId: DISC, parent: { kind: 'page', id: PAGE }, authorId: USER, authorName: '가나',
      richText: [textRun('안녕 ', { bold: true }), userMentionRun(USER), textRun(' '), pageMentionRun(PAGE), equationRun('x^2')],
      createdAt: created, editedAt: null,
    },
    LINKS,
  )
  assert.deepEqual(Object.keys(c), [
    'object', 'id', 'parent', 'discussion_id', 'created_time', 'last_edited_time', 'created_by', 'rich_text', 'attachments', 'display_name',
  ])
  assert.equal(c.object, 'comment')
  assert.deepEqual(c.parent, { type: 'page_id', page_id: PAGE })
  assert.equal(c.discussion_id, DISC)
  assert.equal(c.created_time, created.toISOString())
  assert.equal(c.last_edited_time, created.toISOString())
  assert.deepEqual(c.created_by, { object: 'user', id: USER })
  assert.deepEqual(c.attachments, [])
  assert.deepEqual(c.display_name, { type: 'user', resolved_name: '가나' })
  // rich text — 서식 · 사람 멘션(노션의 user 객체) · 페이지 멘션(href 는 앱의 주소) · 수식
  assert.equal(c.rich_text[0].annotations.bold, true)
  assert.deepEqual(c.rich_text[1].mention, { type: 'user', user: { object: 'user', id: USER } })
  assert.equal(c.rich_text[3].href, LINKS.pageUrl(PAGE))
  assert.deepEqual(c.rich_text[4].equation, { expression: 'x^2' })

  const edited = new Date('2026-11-18T00:00:00.000Z')
  const b = commentToApi({ id: 'c2', discussionId: DISC, parent: { kind: 'block', id: BLOCK }, authorId: USER, authorName: null, richText: [], createdAt: created, editedAt: edited }, LINKS)
  assert.deepEqual(b.parent, { type: 'block_id', block_id: BLOCK })
  assert.equal(b.last_edited_time, edited.toISOString())
  assert.equal(b.display_name.resolved_name, '')
})

test('봉투 — 노션의 comment 목록', () => {
  assert.deepEqual(commentListEnvelope([], null), { object: 'list', results: [], next_cursor: null, has_more: false, type: 'comment', comment: {} })
})

const created = (body: unknown) => {
  const r = parseCommentCreate(body)
  assert.ok(r.ok, r.ok ? '' : r.message)
  return r.value
}
const createFails = (body: unknown, pattern: RegExp) => {
  const r = parseCommentCreate(body)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.message, pattern)
}
const rt = [{ text: { content: '좋아요' } }]

test('★ 만들기 — page_id · block_id · discussion_id 중 정확히 하나 · 대시 없는 id 도', () => {
  assert.deepEqual(created({ parent: { page_id: PAGE }, rich_text: rt }).target, { kind: 'page', id: PAGE })
  assert.deepEqual(created({ parent: { type: 'block_id', block_id: BLOCK.replace(/-/g, '') }, rich_text: rt }).target, { kind: 'block', id: BLOCK })
  assert.deepEqual(created({ discussion_id: DISC, rich_text: rt }).target, { kind: 'discussion', id: DISC })
  createFails({ rich_text: rt }, /exactly one of body\.parent or body\.discussion_id/)
  createFails({ parent: { page_id: PAGE }, discussion_id: DISC, rich_text: rt }, /exactly one of body\.parent or body\.discussion_id/)
  createFails({ parent: { page_id: PAGE, block_id: BLOCK }, rich_text: rt }, /exactly one of body\.parent\.page_id or body\.parent\.block_id/)
  createFails({ parent: { type: 'block_id', page_id: PAGE }, rich_text: rt }, /body\.parent\.type should be "page_id"/)
  createFails({ parent: { page_id: 'x' }, rich_text: rt }, /body\.parent\.page_id should be a valid uuid/)
  createFails({ discussion_id: 'x', rich_text: rt }, /body\.discussion_id should be a valid uuid/)
  createFails({ parent: { database_id: PAGE }, rich_text: rt }, /body\.parent\.database_id should be not present/)
})

test('★ 만들기의 rich text — 서식 · 링크 · 사람 · 페이지 멘션 · 수식은 받고 날짜 멘션 · 빈 배열 · 없음은 400', () => {
  const value = created({
    parent: { page_id: PAGE },
    rich_text: [
      { text: { content: '보세요 ', link: { url: 'https://example.com' } }, annotations: { italic: true } },
      { mention: { user: { id: USER } } },
      { type: 'mention', mention: { type: 'page', page: { id: PAGE } } },
      { equation: { expression: 'e=mc^2' } },
    ],
  })
  assert.equal(value.runs[0].text?.link?.url, 'https://example.com')
  assert.equal(value.runs[0].annotations.italic, true)
  assert.deepEqual(value.runs[1].mention, { type: 'user', user: { id: USER } })
  assert.deepEqual(value.runs[2].mention, { type: 'page', page: { id: PAGE } })
  assert.equal(value.runs[3].type, 'equation')
  createFails({ parent: { page_id: PAGE }, rich_text: [{ mention: { type: 'date', date: { start: '2026-11-17' } } }] }, /mention\.type `"date"` is not supported/)
  createFails({ parent: { page_id: PAGE }, rich_text: [] }, /body\.rich_text should not be empty/)
  createFails({ parent: { page_id: PAGE } }, /body\.rich_text should be defined/)
  createFails({ parent: { page_id: PAGE }, rich_text: 'hi' }, /body failed validation: body\.rich_text should be an array/)
})

test('★ display_name 은 user 만 · 첨부는 비어 있을 때만 · markdown 은 다음 판의 것', () => {
  assert.ok(parseCommentCreate({ parent: { page_id: PAGE }, rich_text: rt, display_name: { type: 'user' } }).ok)
  assert.ok(parseCommentCreate({ parent: { page_id: PAGE }, rich_text: rt, attachments: [] }).ok)
  createFails({ parent: { page_id: PAGE }, rich_text: rt, display_name: { type: 'integration' } }, /"integration" is not supported — a personal token comments as its owner/)
  createFails({ parent: { page_id: PAGE }, rich_text: rt, display_name: { type: 'custom', custom: { name: '봇' } } }, /"custom" is not supported/)
  createFails({ parent: { page_id: PAGE }, rich_text: rt, display_name: { type: 'bot' } }, /display_name\.type should be "user"/)
  createFails({ parent: { page_id: PAGE }, rich_text: rt, attachments: [{ file_upload_id: PAGE }] }, /attachments are not supported/)
  createFails({ parent: { page_id: PAGE }, markdown: '**hi**' }, /body\.markdown is not supported in Notion-Version 2025-09-03/)
  createFails('x', /body should be an object/)
})

test('고치기 — rich_text 하나', () => {
  const r = parseCommentUpdate({ rich_text: rt })
  assert.ok(r.ok && r.value[0].plain_text === '좋아요')
  assert.equal(parseCommentUpdate({}).ok, false)
  const extra = parseCommentUpdate({ rich_text: rt, discussion_id: DISC })
  assert.ok(!extra.ok && /body\.discussion_id should be not present/.test(extra.message))
})

test('★ 목록 커서 — 그 block_id 에 묶인다', () => {
  const c = encodeCommentCursor(PAGE, 5)
  assert.equal(decodeCommentCursor(PAGE, c), 5)
  assert.equal(decodeCommentCursor(BLOCK, c), null)
  assert.equal(decodeCommentCursor(PAGE, null), 0)
})
