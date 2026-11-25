/**
 * 개인 뷰 상태의 전달 · 지운 속성의 조건 정리 — 순수한 부분 (DB 실시간 동기화 RT-3조각 · F-05-16 · DB 없음)
 *
 *   ① 조건 빼기 — 그 속성의 규칙만(묶음의 다른 규칙은 그대로) · 중첩 AND/OR · 비게 된 묶음은 접힌다 · 정렬은 그 키만 · 뺀 수
 *   ② 층의 규칙 — 공유 층은 다 빠지면 필터 없음(null) · 개인 층은 빈 묶음 · 덮어쓰지 않은 칸(null)은 그대로 · 뺄 것이 없으면 같은 것
 *   ③ 신호 — `p:` 를 읽는다(틀린 모양은 버린다) · 허브는 그 표의 **그 사람**에게만 · 남 · 다른 표에는 가지 않는다
 *   ④ 화면 — 델타의 `personalChanged` 는 다시 읽기(도구줄까지)의 까닭 · 옛 서버(없음)는 거짓 · 문구 · 탭 id 의 모양
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { pruneLayer, type ConditionDrop } from './view-prune.ts'
import type { FilterNode, SortKey } from './filter.ts'
import { parseCollabSignal, ROWS_CHANNEL } from '../collab/change-feed.ts'
import { dispatchRowSignal, type RowFeedListener } from './row-feed.ts'
import { deltaFallback, parseDelta } from './delta-merge.ts'
import { viewNoticeText } from './view-notice-text.ts'
import { readViewOrigin } from './view-origin.ts'

const leaf = (property_id: string, value: unknown = 1): FilterNode => ({ property_id, operator: 'equals', value })
const dropOf = (id: string): ConditionDrop => ({ leaf: (l) => l.property_id === id, sort: (s) => s.property_id === id })

describe('① 조건 빼기', () => {
  test('★ 그 속성의 규칙만 — 묶음의 다른 규칙은 그대로 · 중첩 AND/OR', () => {
    const filter: FilterNode = {
      op: 'and',
      children: [leaf('x'), { op: 'or', children: [leaf('gone'), leaf('y'), { op: 'and', children: [leaf('gone', 2), leaf('z')] }] }],
    }
    const out = pruneLayer(filter, [], dropOf('gone'), 'shared')
    assert.deepEqual(out.filter, { op: 'and', children: [leaf('x'), { op: 'or', children: [leaf('y'), { op: 'and', children: [leaf('z')] }] }] })
    assert.equal(out.filters, 2)
  })

  test('★ 비게 된 묶음은 접힌다 — 안쪽 묶음이 다 빠지면 그 묶음째', () => {
    const filter: FilterNode = { op: 'and', children: [leaf('x'), { op: 'or', children: [leaf('gone'), leaf('gone', 2)] }] }
    const out = pruneLayer(filter, [], dropOf('gone'), 'shared')
    assert.deepEqual(out.filter, { op: 'and', children: [leaf('x')] })
    assert.equal(out.filters, 2)
  })

  test('★ 정렬은 그 키만 · 차례는 그대로', () => {
    const sorts: SortKey[] = [
      { property_id: 'a', direction: 'asc' },
      { property_id: 'gone', direction: 'desc' },
      { property_id: 'b', direction: 'desc' },
    ]
    const out = pruneLayer(null, sorts, dropOf('gone'), 'shared')
    assert.deepEqual(out.sorts, [sorts[0], sorts[2]])
    assert.deepEqual([out.filters, out.sortKeys, out.filter], [0, 1, null])
  })

  test('타입 바꾸기처럼 일부 연산자만 — 고른 규칙만 빠진다', () => {
    const filter: FilterNode = {
      op: 'and',
      children: [
        { property_id: 's', operator: 'group_is', value: 'done' },
        { property_id: 's', operator: 'equals', value: 'opt' },
      ],
    }
    const out = pruneLayer(filter, [], { leaf: (l) => l.property_id === 's' && l.operator === 'group_is', sort: () => false }, 'shared')
    assert.deepEqual(out.filter, { op: 'and', children: [{ property_id: 's', operator: 'equals', value: 'opt' }] })
  })
})

describe('② 층의 규칙', () => {
  test('★ 공유 층 — 다 빠지면 필터 없음(null) · 정렬 []', () => {
    const out = pruneLayer({ op: 'and', children: [leaf('gone')] }, [{ property_id: 'gone', direction: 'asc' }], dropOf('gone'), 'shared')
    assert.deepEqual([out.filter, out.sorts, out.filters, out.sortKeys], [null, [], 1, 1])
  })

  test('★ 개인 층 — 다 빠져도 빈 묶음(NULL 이면 공유 것으로 돌아간다) · 정렬 []', () => {
    const out = pruneLayer(leaf('gone'), [{ property_id: 'gone', direction: 'asc' }], dropOf('gone'), 'personal')
    assert.deepEqual(out.filter, { op: 'and', children: [] })
    assert.deepEqual(out.sorts, [])
  })

  test('개인 층 — 덮어쓰지 않은 칸(null)은 그대로 null', () => {
    const out = pruneLayer(null, null, dropOf('gone'), 'personal')
    assert.deepEqual([out.filter, out.sorts, out.filters, out.sortKeys], [null, null, 0, 0])
    const sortsOnly = pruneLayer(null, [{ property_id: 'gone', direction: 'asc' }], dropOf('gone'), 'personal')
    assert.deepEqual([sortsOnly.filter, sortsOnly.sorts], [null, []])
  })

  test('뺄 것이 없으면 받은 것을 그대로(같은 객체) — 쓰지 않는다', () => {
    const filter: FilterNode = { op: 'or', children: [leaf('x'), leaf('y')] }
    const sorts: SortKey[] = [{ property_id: 'x', direction: 'asc' }]
    const out = pruneLayer(filter, sorts, dropOf('gone'), 'personal')
    assert.equal(out.filter, filter)
    assert.equal(out.sorts, sorts)
    assert.deepEqual([out.filters, out.sortKeys], [0, 0])
  })

  test('개인 층의 "필터 없음"(빈 묶음)은 그대로다', () => {
    const empty: FilterNode = { op: 'and', children: [] }
    assert.equal(pruneLayer(empty, null, dropOf('gone'), 'personal').filter, empty)
  })
})

describe('③ 신호', () => {
  const ds = '11111111-1111-4111-8111-111111111111'
  const view = '22222222-2222-4222-8222-222222222222'
  const me = '33333333-3333-4333-8333-333333333333'
  const other = '44444444-4444-4444-8444-444444444444'

  test('★ `p:` 를 읽는다 — 보낸 탭이 없으면 null · 틀린 모양은 버린다 · 표의 신호는 그대로', () => {
    assert.deepEqual(parseCollabSignal(ROWS_CHANNEL, `p:${ds}:${view}:${me}:tab-12345678`), {
      kind: 'personal', dataSourceId: ds, viewId: view, userId: me, origin: 'tab-12345678',
    })
    assert.deepEqual(parseCollabSignal(ROWS_CHANNEL, `p:${ds}:${view}:${me}:`), { kind: 'personal', dataSourceId: ds, viewId: view, userId: me, origin: null })
    for (const bad of [`p:${ds}:${view}`, `p:${ds}:nope:${me}:`, `p:x:${view}:${me}:`, 'p:']) assert.equal(parseCollabSignal(ROWS_CHANNEL, bad), null, bad)
    assert.deepEqual(parseCollabSignal(ROWS_CHANNEL, ds), { kind: 'rows', dataSourceId: ds })
  })

  test('★ 허브 — 그 표의 그 사람에게만 · 남 · 다른 표 · 옛 구독(onPersonal 없음)은 받지 않는다', () => {
    const seen: string[] = []
    const make = (name: string, dataSourceId: string, userId: string, personal = true): RowFeedListener => ({
      dataSourceId,
      workspaceId: 'w',
      userId,
      onChanged: () => seen.push(`${name}:changed`),
      onAccess: () => undefined,
      onSession: () => undefined,
      ...(personal ? { onPersonal: (v: string, o: string | null) => seen.push(`${name}:personal:${v}:${o}`) } : {}),
    })
    const all = [make('mine', ds, me), make('mine2', ds, me), make('theirs', ds, other), make('elsewhere', view, me), make('old', ds, me, false)]
    dispatchRowSignal({ kind: 'personal', dataSourceId: ds, viewId: view, userId: me, origin: 't' }, all)
    assert.deepEqual(seen, [`mine:personal:${view}:t`, `mine2:personal:${view}:t`])
  })
})

describe('④ 화면', () => {
  const base = { cursor: 'c1.5', reset: false, behind: false, schemaChanged: false, viewChanged: false, orderChanged: false, rows: [] }

  test('★ 델타의 personalChanged — 다시 읽기의 까닭(reset 보다 먼저 · 도구줄까지) · 옛 서버(없음)는 거짓 · 불리언이 아니면 모르는 응답', () => {
    const delta = parseDelta({ ...base, personalChanged: true })
    assert.equal(delta?.personalChanged, true)
    assert.equal(deltaFallback(delta!), 'personal')
    assert.equal(deltaFallback(parseDelta({ ...base, reset: true, personalChanged: true })!), 'personal')
    const old = parseDelta(base)
    assert.equal(old?.personalChanged, false)
    assert.equal(deltaFallback(old!), null)
    assert.equal(parseDelta({ ...base, personalChanged: 'yes' }), null)
  })

  test('★ 문구 — 무엇을 · 어느 층 · 왜 · 남은 조건은 그대로', () => {
    const n = { propertyName: '상태', reason: 'property_deleted' as const, filters: 1, sorts: 0, personal: true }
    assert.equal(viewNoticeText(n), "나만 보는 필터에서 삭제된 속성 '상태'의 조건을 뺐습니다. 나머지 조건은 그대로입니다.")
    assert.equal(viewNoticeText({ ...n, sorts: 1, personal: false }), "이 뷰의 필터 · 정렬에서 삭제된 속성 '상태'의 조건을 뺐습니다. 나머지 조건은 그대로입니다.")
    assert.equal(viewNoticeText({ ...n, filters: 0, sorts: 2 }), "나만 보는 정렬에서 삭제된 속성 '상태'의 조건을 뺐습니다. 나머지 조건은 그대로입니다.")
    assert.match(viewNoticeText({ ...n, reason: 'type_changed' }), /유형이 바뀐 속성 '상태'/)
  })

  test('탭 id — 신호의 구분자(:)가 들 수 없는 모양만', () => {
    assert.equal(readViewOrigin('0c8e2a4f-1b2c-4d5e-8f90-123456789abc'), '0c8e2a4f-1b2c-4d5e-8f90-123456789abc')
    for (const bad of [null, '', 'short', 'a:b:c:d:e:f:g', 'x'.repeat(65), 42]) assert.equal(readViewOrigin(bad), null, String(bad))
  })
})
