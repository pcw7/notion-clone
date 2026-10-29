/**
 * 인라인 데이터베이스의 미리보기 — 본문 안의 표 (26번 트랙 I-3 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ⑥
 *
 *   ① 머리 — 보이는 열 중 칸 값이 있는 것만 · 뷰의 차례 그대로 · 상한까지(숨긴 열 · 사람 · relation 은 뺀다)
 *   ② 칸 — 제목(비었으면 "제목 없음") · 선택은 옵션 이름 · 숫자 · 체크
 *   ③ ★ 처음 몇 행만 · 더 있으면 `more` — 응답이 더 있다고 하거나 받은 행이 상한을 넘으면
 *   ④ 행을 여는 칸은 제목 열 — 맨 앞이 아니어도
 *   ⑤ ★ 출처의 캐시 — 방금 읽은 것은 다시 읽지 않는다 · 시간이 지나면 다시 · 실패는 기억하지 않는다 · 다시 읽는 동안 앞의 것을 보여 준다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { INLINE_PREVIEW_COLUMNS, INLINE_PREVIEW_ROWS, inlinePreviewOf, inlinePreviewSource, type InlinePreview } from './inline-preview.ts'
import type { RowJson } from './http.ts'
import type { ViewColumn } from './view-columns.ts'

function column(propertyId: string, type: string, extra: Partial<Record<string, unknown>> = {}): ViewColumn {
  return {
    propertyId,
    name: `열 ${propertyId}`,
    visible: true,
    orderKey: propertyId,
    width: null,
    wrap: false,
    options: [],
    type,
    ...extra,
  } as unknown as ViewColumn
}

function row(id: string, title: string, properties: Record<string, unknown> = {}): RowJson {
  return { id, title, icon: null, properties, uniqueSeq: null, lastEditedAt: '2026-10-29T00:00:00Z', version: '1' }
}

test('① 머리 — 보이는 칸 열만 · 차례 그대로 · 상한까지', () => {
  const columns = [
    column('t', 'title'),
    column('h', 'rich_text', { visible: false }),
    column('p', 'people'),
    column('r', 'relation'),
    column('n', 'number'),
    column('s', 'select'),
    column('c', 'checkbox'),
    column('d', 'date'),
    column('x', 'rich_text'),
  ]
  const preview = inlinePreviewOf(columns, [], false)
  assert.deepEqual(preview.headers, ['열 t', '열 n', '열 s', '열 c', '열 d'])
  assert.equal(preview.headers.length, INLINE_PREVIEW_COLUMNS)
})

test('② 칸 — 제목 · 선택 이름 · 숫자 · 체크', () => {
  const columns = [
    column('t', 'title'),
    column('s', 'select', { options: [{ id: 'o1', name: '진행 중', color: 'blue' }] }),
    column('n', 'number'),
    column('c', 'checkbox'),
  ]
  const preview = inlinePreviewOf(
    columns,
    [
      row('r1', '첫 행', {
        s: { type: 'select', select: { id: 'o1' } },
        n: { type: 'number', number: 3 },
        c: { type: 'checkbox', checkbox: true },
      }),
      row('r2', ''),
    ],
    false,
  )
  assert.equal(preview.rows.length, 2)
  assert.equal(preview.rows[0]!.id, 'r1')
  assert.equal(preview.rows[0]!.cells[0], '첫 행')
  assert.equal(preview.rows[0]!.cells[1], '진행 중')
  assert.equal(preview.rows[0]!.cells[2], '3')
  assert.notEqual(preview.rows[0]!.cells[3], preview.rows[1]!.cells[3], '체크된 칸과 빈 칸은 글자가 다르다')
  assert.equal(preview.rows[1]!.cells[0], '제목 없음')
  assert.equal(preview.rows[1]!.cells[1], '')
  assert.equal(preview.more, false)
})

test('③ ★ 처음 몇 행만 · 더 있으면 more', () => {
  const columns = [column('t', 'title')]
  const many = Array.from({ length: INLINE_PREVIEW_ROWS + 3 }, (_, i) => row(`r${i}`, `행 ${i}`))
  const over = inlinePreviewOf(columns, many, false)
  assert.equal(over.rows.length, INLINE_PREVIEW_ROWS)
  assert.equal(over.more, true, '받은 행이 상한을 넘으면')
  const exact = inlinePreviewOf(columns, many.slice(0, INLINE_PREVIEW_ROWS), true)
  assert.equal(exact.more, true, '응답이 더 있다고 하면')
  assert.equal(inlinePreviewOf(columns, many.slice(0, 2), false).more, false)
})

test('④ 행을 여는 칸은 제목 열 — 맨 앞이 아니어도', () => {
  assert.equal(inlinePreviewOf([column('n', 'number'), column('t', 'title')], [], false).openAt, 1)
  assert.equal(inlinePreviewOf([column('t', 'title'), column('n', 'number')], [], false).openAt, 0)
  assert.equal(inlinePreviewOf([column('n', 'number')], [], false).openAt, 0, '제목 열이 없으면 첫 칸')
})

test('⑤ ★ 출처의 캐시 — 다시 읽지 않는다 · 시간이 지나면 · 실패는 기억하지 않는다', async () => {
  const sample: InlinePreview = { headers: ['이름'], rows: [], openAt: 0, more: false }
  let clock = 0
  let calls = 0
  let fail = false
  const source = inlinePreviewSource(
    async () => {
      calls++
      return fail ? null : { ...sample, headers: [`이름 ${calls}`] }
    },
    () => clock,
    1000,
  )
  assert.equal(source.peek('db'), undefined, '읽은 적 없으면 undefined')

  const first = await source.load('db')
  assert.deepEqual(first?.headers, ['이름 1'])
  assert.deepEqual(source.peek('db')?.headers, ['이름 1'])

  clock = 500
  await source.load('db')
  assert.equal(calls, 1, '방금 읽은 것은 다시 읽지 않는다(노드 뷰가 다시 만들어져도)')

  clock = 1500
  const pending = source.load('db')
  assert.deepEqual(source.peek('db')?.headers, ['이름 1'], '다시 읽는 동안 앞의 것을 보여 준다')
  assert.deepEqual((await pending)?.headers, ['이름 2'])

  clock = 4000
  fail = true
  assert.equal(await source.load('db'), null)
  assert.equal(source.peek('db'), null)
  fail = false
  clock = 4001
  assert.deepEqual((await source.load('db'))?.headers, ['이름 4'], '실패는 기억하지 않는다 — 곧바로 다시 읽는다')
})

test('⑤ 읽기 함수가 던져도 null — 노드 뷰가 "불러오지 못했습니다" 를 그린다', async () => {
  const source = inlinePreviewSource(async () => {
    throw new Error('네트워크')
  })
  assert.equal(await source.load('db'), null)
})
