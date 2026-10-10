/**
 * 웹훅 본문 (4e-2 · F-11-19 · 순수)
 *
 *   ① `text` — 링크된 제목 · 누가 · 종류별 수 · 아래 페이지 수
 *   ② Slack mrkdwn 의 글자(`& < >`)를 바꾼다 — 제목 · 이름이 링크를 깨거나 멘션을 만들지 못하게
 *   ③ 이름 — 시스템 · 삭제된 사용자 · 넷 이상이면 "외 N명"
 *   ④ 이벤트는 앞의 100개만 싣고 전체 수를 따로
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildWebhookPayload, escapeSlack, MAX_PAYLOAD_EVENTS, type PayloadEvent } from './webhook-payload.ts'

const AT = new Date('2026-10-10T09:00:00Z')
const person = (id: string, name: string, deleted = false) => ({ id, name, deleted })
const ev = (id: string, type: PayloadEvent['type'], actor: PayloadEvent['actor'], pageId = 'p'): PayloadEvent => ({ id, type, pageId, actor, at: AT })
const build = (events: readonly PayloadEvent[], title = '회의록') =>
  buildWebhookPayload({ deliveryId: 'd1', workspaceId: 'w1', page: { id: 'p', title }, events, appUrl: 'https://app.example/' })

test('★ text — 링크된 제목 · 누가 · 종류별 수', () => {
  const hong = person('u1', '홍길동')
  const kim = person('u2', '김철수')
  const payload = build([ev('e1', 'block.updated', hong), ev('e2', 'block.updated', kim), ev('e3', 'comment.created', hong), ev('e4', 'block.updated', hong)])
  assert.equal(payload.text, '<https://app.example/w/w1/p|‘회의록’> — 홍길동 · 김철수: 편집 3 · 코멘트 1')
  assert.deepEqual(payload.notion_clone.page, { id: 'p', url: 'https://app.example/w/w1/p' })
  assert.equal(payload.notion_clone.delivery_id, 'd1')
  assert.deepEqual(payload.notion_clone.events[0], { id: 'e1', type: 'block.updated', page_id: 'p', actor_id: 'u1', at: AT.toISOString() })
})

test('아래 페이지가 섞이면 그 수를 말한다', () => {
  const me = person('u1', '나')
  const payload = build([ev('e1', 'page.created', me, 'c1'), ev('e2', 'block.updated', me, 'c2'), ev('e3', 'block.updated', me, 'c1'), ev('e4', 'page.moved', me)])
  assert.equal(payload.text, '<https://app.example/w/w1/p|‘회의록’> — 나: 새 페이지 1 · 옮김 1 · 편집 2 (아래 페이지 2곳 포함)')
})

test('★ Slack 의 글자를 바꾼다 — 제목 · 이름', () => {
  assert.equal(escapeSlack('a & <b> c'), 'a &amp; &lt;b&gt; c')
  const payload = build([ev('e1', 'block.updated', person('u1', '<!channel>'))], '제목 | <https://evil|눌러>')
  assert.equal(payload.text, '<https://app.example/w/w1/p|‘제목 | &lt;https://evil|눌러&gt;’> — &lt;!channel&gt;: 편집 1')
})

test('★ 이름 — 시스템 · 삭제된 사용자 · 이름 없음 · 넷 이상이면 외 N명', () => {
  const few = build([ev('e1', 'block.updated', null), ev('e2', 'block.updated', person('u1', '떠난 이', true)), ev('e3', 'block.updated', person('u2', ''))])
  assert.equal(few.text, '<https://app.example/w/w1/p|‘회의록’> — 시스템 · 삭제된 사용자 · 이름 없음: 편집 3')
  const many = build(['가', '나', '다', '라', '마'].map((n, i) => ev(`e${i}`, 'block.updated', person(`u${i}`, n))))
  assert.equal(many.text, '<https://app.example/w/w1/p|‘회의록’> — 가 · 나 · 다 외 2명: 편집 5')
  assert.ok(build([], '').text.includes('‘제목 없음’'))
})

test('★ 이벤트는 앞의 100개만 · 전체 수는 따로', () => {
  const events = Array.from({ length: 150 }, (_, i) => ev(`e${i}`, 'block.updated', person('u1', '나')))
  const payload = build(events)
  assert.equal(payload.notion_clone.events.length, MAX_PAYLOAD_EVENTS)
  assert.equal(payload.notion_clone.events.at(-1)?.id, 'e99')
  assert.equal(payload.notion_clone.event_count, 150)
  assert.ok(payload.text.endsWith('편집 150'))
})
