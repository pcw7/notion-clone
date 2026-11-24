/**
 * 공개 API 웹훅 이벤트의 묶기 · 모양 (API-9 · F-09-09 · 단위)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑬ · 마이그레이션 0152 의 CHECK 와 같은 목록 · 같은 상한인지 파일을 읽어 견준다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as Y from 'yjs'

import { collectChangedBlocks } from '../collab/changed-blocks.ts'
import {
  AGGREGATE_AUTHORS_MAX,
  AGGREGATE_LIST_MAX,
  AGGREGATE_MAX_MS,
  AGGREGATE_QUIET_MS,
  AGGREGATED_EVENT_TYPES,
  aggregateDueAt,
  isAggregatedType,
  mergeAggregatedData,
  mergeAuthors,
  mergeIdList,
  mergeSchemaChanges,
  webhookParentOf,
} from './webhook-aggregate.ts'
import { isWebhookEventType } from './webhook-events.ts'

const at = (s: number) => new Date(Date.UTC(2030, 0, 1, 0, 0, s))

test('★ 묶는 종류는 넷 — 카탈로그의 것 · 댓글 · 만들기 · 옮기기 · 휴지통 · 잠금은 묶지 않는다 · 마이그레이션 0152 와 같은 목록 · 같은 상한', () => {
  assert.deepEqual([...AGGREGATED_EVENT_TYPES], ['page.content_updated', 'page.properties_updated', 'data_source.content_updated', 'data_source.schema_updated'])
  assert.ok(AGGREGATED_EVENT_TYPES.every(isWebhookEventType))
  for (const plain of ['page.created', 'page.moved', 'page.deleted', 'page.locked', 'database.created', 'data_source.created', 'comment.created', 'comment.updated']) {
    assert.equal(isAggregatedType(plain), false, plain)
  }
  const sql = readFileSync(new URL('../../../db/migrations/0152_api_webhook_aggregate.sql', import.meta.url), 'utf8')
  const listed = /type IN \(([^)]*)\)/.exec(sql)?.[1]?.match(/'([a-z_.]+)'/g)?.map((s) => s.slice(1, -1))
  assert.deepEqual(listed, [...AGGREGATED_EVENT_TYPES], 'ck_api_webhook_event_window 의 목록')
  const cap = /window_started_at \+ interval '(\d+) minutes'/.exec(sql)?.[1]
  assert.equal(Number(cap) * 60_000, AGGREGATE_MAX_MS, 'ck_api_webhook_event_window_cap 의 상한')
})

test('★ 시각 — 마지막 변경 + 15초 · 잇달아 고쳐도 창을 연 뒤 2분이면 나간다 · 거꾸로 온 시각은 창보다 앞서지 않는다', () => {
  assert.equal(AGGREGATE_QUIET_MS, 15_000)
  assert.equal(aggregateDueAt(at(0), at(0)).getTime(), at(15).getTime())
  assert.equal(aggregateDueAt(at(0), at(10)).getTime(), at(25).getTime(), '조용한 창이 밀린다')
  assert.equal(aggregateDueAt(at(0), at(110)).getTime(), at(120).getTime(), '★ 상한 — 2분')
  assert.equal(aggregateDueAt(at(0), at(500)).getTime(), at(120).getTime(), '상한을 넘은 변경도 2분에')
  assert.equal(aggregateDueAt(at(10), at(5)).getTime(), at(25).getTime(), '창보다 앞선 시각은 창으로 본다')
})

test('★ 목록 합치기 — 처음 나온 차례 · 겹침은 하나로 · 상한까지 · 모양이 아닌 것은 버린다', () => {
  const b = (id: string) => ({ id, type: 'block' as const })
  assert.deepEqual(mergeIdList([b('1'), b('2')], [b('2'), b('3'), b('1')]), [b('1'), b('2'), b('3')])
  assert.deepEqual(mergeIdList(['title', 'abc'], ['abc', 'xyz']), ['title', 'abc', 'xyz'])
  assert.deepEqual(mergeIdList([42, null, { nope: 1 }], ['a']), ['a'], '모양이 아닌 것')
  const many = Array.from({ length: 150 }, (_, i) => b(String(i)))
  const merged = mergeIdList([], many)
  assert.equal(merged.length, AGGREGATE_LIST_MAX)
  assert.deepEqual(merged.at(-1), b(String(AGGREGATE_LIST_MAX - 1)), '★ 앞의 것을 지킨다')
  assert.equal(mergeIdList(merged, [b('new')]).length, AGGREGATE_LIST_MAX, '가득 차면 더하지 않는다')
})

test('★ 구조 변경 합치기 — 속성마다 한 줄 · 이름은 나중 것 · 만들고 고치면 created · 지우면 deleted · 지우고 되살리면 updated', () => {
  const c = (id: string, name: string, action: 'created' | 'updated' | 'deleted') => ({ id, name, action })
  assert.deepEqual(mergeSchemaChanges([c('p', '가', 'created')], [c('p', '나', 'updated')]), [c('p', '나', 'created')])
  assert.deepEqual(mergeSchemaChanges([c('p', '가', 'created')], [c('p', '가', 'deleted')]), [c('p', '가', 'deleted')])
  assert.deepEqual(mergeSchemaChanges([c('p', '가', 'deleted')], [c('p', '가', 'created')]), [c('p', '가', 'updated')])
  assert.deepEqual(mergeSchemaChanges([c('p', '가', 'updated')], [c('q', '다', 'created'), c('p', '라', 'updated')]), [c('p', '라', 'updated'), c('q', '다', 'created')])
  assert.deepEqual(mergeSchemaChanges([{ id: 'x' }, c('p', '가', 'bogus' as 'updated')], []), [], '모양이 아닌 것')
})

test('★ data 합치기 — 목록 밖은 나중 것(부모) · 목록은 합친다 · 저자는 합집합(상한)', () => {
  const merged = mergeAggregatedData(
    'page.content_updated',
    { parent: { id: 'old', type: 'page' }, updated_blocks: [{ id: '1', type: 'block' }] },
    { parent: { id: 'new', type: 'space' }, updated_blocks: [{ id: '2', type: 'block' }, { id: '1', type: 'block' }] },
  )
  assert.deepEqual(merged, { parent: { id: 'new', type: 'space' }, updated_blocks: [{ id: '1', type: 'block' }, { id: '2', type: 'block' }] })
  const props = mergeAggregatedData('page.properties_updated', { updated_properties: 'broken' }, { updated_properties: ['title'] })
  assert.deepEqual(props.updated_properties, ['title'], '목록이 아닌 값은 빈 목록')
  const schema = mergeAggregatedData(
    'data_source.schema_updated',
    { updated_properties: [{ id: 'p', name: '가', action: 'created' }] },
    { updated_properties: [{ id: 'p', name: '나', action: 'updated' }] },
  )
  assert.deepEqual(schema.updated_properties, [{ id: 'p', name: '나', action: 'created' }])
  const p = (id: string) => ({ id, type: 'person' as const })
  assert.deepEqual(mergeAuthors([p('a')], [p('b'), p('a')]), [p('a'), p('b')])
  assert.deepEqual(mergeAuthors('broken', [p('a')]), [p('a')])
  assert.equal(mergeAuthors(Array.from({ length: 30 }, (_, i) => p(String(i))), [p('late')]).length, AGGREGATE_AUTHORS_MAX)
})

test('★ 부모 — 페이지 · 데이터베이스 · 본문 블록 · 데이터 소스(행) · 최상위는 space(워크스페이스 id)', () => {
  const ws = 'w-1'
  assert.deepEqual(webhookParentOf({ parentType: 'block', parentId: 'p', parentBlockType: 'page', workspaceId: ws }), { id: 'p', type: 'page' })
  assert.deepEqual(webhookParentOf({ parentType: 'block', parentId: 'd', parentBlockType: 'database', workspaceId: ws }), { id: 'd', type: 'database' })
  assert.deepEqual(webhookParentOf({ parentType: 'block', parentId: 't', parentBlockType: 'toggle', workspaceId: ws }), { id: 't', type: 'block' })
  assert.deepEqual(webhookParentOf({ parentType: 'data_source', parentId: 's', parentBlockType: null, workspaceId: ws }), { id: 's', type: 'data_source' })
  assert.deepEqual(webhookParentOf({ parentType: 'workspace', parentId: ws, parentBlockType: null, workspaceId: ws }), { id: ws, type: 'space' })
  assert.deepEqual(webhookParentOf({ parentType: 'teamspace', parentId: 'team', parentBlockType: null, workspaceId: ws }), { id: ws, type: 'space' })
})

test('★ 바뀐 블록 — 글자를 친 블록 · 새로 넣은 블록 · 지운 블록 · 블록 밖(최상위 묶음)은 없다 · 상한', () => {
  const doc = new Y.Doc()
  const root = doc.getXmlFragment('prosemirror')
  const container = (blockId: string, text: string) => {
    const el = new Y.XmlElement('blockContainer')
    el.setAttribute('blockId', blockId)
    const para = new Y.XmlElement('paragraph')
    para.insert(0, [new Y.XmlText(text)])
    el.insert(0, [para])
    return el
  }
  const group = new Y.XmlElement('blockGroup')
  root.insert(0, [group])
  group.insert(0, [container('a', '하나'), container('b', '둘'), container('c', '셋')])

  const seen = (fn: () => void, max?: number) => {
    const into = new Set<string>()
    const watch = (t: Y.Transaction) => collectChangedBlocks(t, into, max)
    doc.on('afterTransaction', watch)
    fn()
    doc.off('afterTransaction', watch)
    return [...into].sort()
  }
  const textOf = (i: number) => ((group.get(i) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText
  assert.deepEqual(seen(() => textOf(1).insert(1, '글')), ['b'], '★ 글자를 친 블록')
  assert.deepEqual(seen(() => group.insert(3, [container('d', '넷')])), ['d'], '★ 새로 넣은 블록(부모 묶음에는 id 가 없다)')
  assert.deepEqual(seen(() => group.delete(0, 1)), ['a'], '★ 지운 블록 — 지운 요소의 id 도 읽는다')
  assert.deepEqual(seen(() => (group.get(0) as Y.XmlElement).setAttribute('blockId', 'b')), ['b'], '속성만 바뀐 블록')
  assert.deepEqual(seen(() => doc.transact(() => { textOf(0).insert(0, 'x'); textOf(1).insert(0, 'y') }), 1).length, 1, '상한')
})
