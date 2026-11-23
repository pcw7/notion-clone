/**
 * 공개 API 웹훅의 이벤트 카탈로그 (API-8 · F-09-09 · 단위)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · 마이그레이션 0151 의 두 CHECK 와 같은 목록인지 파일을 읽어 견준다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  isWebhookEventType,
  parseEventTypes,
  TEST_EVENT_TYPE,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENTS,
  WEBHOOK_FAMILIES,
  webhookEventLabel,
} from './webhook-events.ts'

test('★ 카탈로그 — 노션 이름 21개 · 겹침 없음 · 모두 API-9 가 내보낸다 · deprecated · file_upload · view 는 없다 · test 는 고를 수 없다', () => {
  assert.equal(WEBHOOK_EVENTS.length, 21)
  assert.equal(new Set(WEBHOOK_EVENT_TYPES).size, 21)
  assert.ok(WEBHOOK_EVENTS.every((e) => e.emitter === 'API-9' && e.type.startsWith(`${e.family}.`)))
  assert.deepEqual(
    WEBHOOK_FAMILIES.map((f) => WEBHOOK_EVENTS.filter((e) => e.family === f).length),
    [8, 4, 6, 3],
  )
  for (const gone of ['database.content_updated', 'database.schema_updated', 'file_upload.created', 'view.created', TEST_EVENT_TYPE]) {
    assert.equal(isWebhookEventType(gone), false, gone)
  }
})

test('★ 고른 이벤트 — 겹침은 하나 · 카탈로그 차례 · 비었거나 모르는 것 · test 는 null', () => {
  assert.deepEqual(parseEventTypes(['comment.created', 'page.created', 'page.created']), ['page.created', 'comment.created'])
  assert.equal(parseEventTypes([]), null)
  assert.equal(parseEventTypes('page.created'), null)
  assert.equal(parseEventTypes(['page.created', 'page.exploded']), null)
  assert.equal(parseEventTypes([TEST_EVENT_TYPE]), null)
  assert.equal(parseEventTypes([1]), null)
})

test('화면의 말 — `계열 · 말` · test 는 "테스트" · 모르는 것은 그대로', () => {
  assert.equal(webhookEventLabel('page.created'), '페이지 · 만들어짐')
  assert.equal(webhookEventLabel('data_source.schema_updated'), '데이터 소스 · 구조가 바뀜')
  assert.equal(webhookEventLabel(TEST_EVENT_TYPE), '테스트')
  assert.equal(webhookEventLabel('x.y'), 'x.y')
})

test('★ 마이그레이션 0151 의 CHECK 둘과 같은 목록이다(구독의 고르기 · 아웃박스의 종류)', () => {
  const sql = readFileSync(new URL('../../../db/migrations/0151_api_webhook.sql', import.meta.url), 'utf8')
  const listIn = (constraint: string, end: string) => {
    const start = sql.indexOf(`CONSTRAINT ${constraint} CHECK`)
    assert.ok(start >= 0, constraint)
    const body = sql.slice(start, sql.indexOf(end, start))
    return [...body.matchAll(/'([a-z_]+\.[a-z_]+|test)'/g)].map((m) => m[1]!)
  }
  assert.deepEqual(listIn('ck_api_webhook_event_types', ']::text[]'), [...WEBHOOK_EVENT_TYPES])
  assert.deepEqual(listIn('ck_api_webhook_event_type', ')),'), [TEST_EVENT_TYPE, ...WEBHOOK_EVENT_TYPES])
})
