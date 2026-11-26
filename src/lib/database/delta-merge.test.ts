/**
 * 바뀐 행만 화면의 목록에 합친다 (DB 실시간 동기화 RT-2조각 · F-05-16 · F-05-06)
 *
 *   ① 갈아 끼우기 · 빼기 — 값이 바뀐 행은 새 값(자리 그대로) · 뷰 밖이 된 남의 행 · 지운 행은 빠진다
 *   ② 자리 — 이웃 사이에 끼운다(맨 앞 · 맨 끝 · 가운데 · 옮김 · 바뀐 행끼리 이웃인 사슬) · 이웃이 어긋나면 합치지 않는다
 *   ③ 더 보기가 남은 목록 — 아직 읽지 않은 범위(`beyond`)는 빼고 끼우지 않는다 · 끝 뒤가 읽지 않은 범위면 끝에 끼운다
 *   ④ 다시 읽기와 같은 규칙 — 내가 고친 행은 뷰 밖이 돼도 남기고 "조건 밖" · 늦게 온 옛 값은 새 값을 덮지 않는다 · 조건 밖이던 행이 돌아온다
 *   ⑤ 상한 · 모양 — 상한을 넘으면 합치지 않는다 · 모르는 종류 · 커서 없음은 null
 *   ⑥ 다시 읽을 까닭 — reset · 스키마 · 이 뷰 · 자리 없음 / 손으로 둔 순서는 까닭이 아니다
 *   ⑦ 커서 장부 — 델타는 응답의 커서로 · 다시 읽기는 시작 전에 받은 커서로(없으면 옛 것) · 다시 읽기가 델타보다 세다
 *   ⑧ 편집 중인 행(RT-4) — 다른 행은 옮기고 붙든 행은 제자리 · 떠 있는 행을 건너 잇기 · 모르면 다시 읽기 · 놓기 · 다시 읽기의 고정 · 위로 건너간 행
 *   ⑨ 컬럼이 바뀐 다시 세우기(W8-b 고침) — 지금 화면의 컬럼과 견준다 · 읽는 사이 내가 바꿨으면 다시 읽기 · 편집 · 추가 · 더 보기 중이면 미룬다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { RowJson } from './http.ts'
import {
  afterDelta,
  afterFullRead,
  columnsVerdict,
  createSyncLedger,
  crossedAbove,
  deltaFallback,
  fullReadCursor,
  heldPlaceIn,
  mergeDelta,
  noteSignal,
  parseDelta,
  pinHeld,
  releaseEntry,
  strongerSync,
  type DeltaJson,
  type DeltaRowJson,
} from './delta-merge.ts'

const row = (id: string, title = id, version = '1'): RowJson => ({
  id,
  title,
  icon: null,
  properties: {},
  uniqueSeq: null,
  createdAt: '2026-11-24T00:00:00Z',
  createdBy: null,
  lastEditedAt: '2026-11-24T00:00:00Z',
  lastEditedBy: null,
  version,
})
const up = (
  id: string,
  before: string | null,
  after: string | null,
  extra: { title?: string; version?: string; beyond?: boolean } = {},
): DeltaRowJson => ({
  ...row(id, extra.title ?? id, extra.version ?? '2'),
  kind: 'row_upsert',
  inView: true,
  place: { before, after, beyond: extra.beyond ?? false },
})
const out = (id: string, version = '2'): DeltaRowJson => ({ ...row(id, id, version), kind: 'row_upsert', inView: false })
const del = (id: string): DeltaRowJson => ({ id, kind: 'row_delete', inView: false })
const ids = (rows: readonly RowJson[]) => rows.map((r) => r.id)
const none = new Set<string>()
const merge = (
  previous: RowJson[],
  rows: DeltaRowJson[],
  opts: { touched?: Set<string>; outside?: Set<string>; hasMore?: boolean; cap?: number; held?: { id: string; floating: boolean } } = {},
) =>
  mergeDelta({
    previous,
    outside: opts.outside ?? none,
    touched: opts.touched ?? none,
    rows,
    hasMore: opts.hasMore ?? false,
    ...(opts.cap === undefined ? {} : { cap: opts.cap }),
    ...(opts.held === undefined ? {} : { held: opts.held }),
  })
const list = (...names: string[]) => names.map((n) => row(n))

describe('① 갈아 끼우기 · 빼기', () => {
  test('★ 값이 바뀐 행은 새 값 — 이웃이 같으면 자리 그대로', () => {
    const merged = merge(list('a', 'b', 'c'), [up('b', 'a', 'c', { title: 'B!' })])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'b', 'c'])
    assert.equal(merged.rows[1]!.title, 'B!')
    assert.equal(merged.changed, true)
    assert.equal('kind' in merged.rows[1]! || 'place' in merged.rows[1]! || 'inView' in merged.rows[1]!, false, '델타의 표시는 떼어 낸다')
  })

  test('★ 뷰 밖이 된 남의 행 · 지운 행은 빠진다', () => {
    const merged = merge(list('a', 'b', 'c', 'd'), [out('b'), del('d')])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'c'])
    assert.deepEqual([...merged.outside], [])
  })

  test('화면에 없던 행이 뷰 밖이면 아무것도 바뀌지 않는다', () => {
    const merged = merge(list('a'), [out('z'), del('y')])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a'])
    assert.equal(merged.changed, false)
  })
})

describe('② 자리', () => {
  test('★ 새 행이 이웃 사이에 선다(정렬된 뷰의 가운데)', () => {
    const merged = merge(list('a', 'b', 'c'), [up('n', 'a', 'b')])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'n', 'b', 'c'])
  })

  test('맨 앞 · 맨 끝', () => {
    const head = merge(list('a', 'b'), [up('n', null, 'a')])
    assert.ok(head.ok)
    assert.deepEqual(ids(head.rows), ['n', 'a', 'b'])
    const tail = merge(list('a', 'b'), [up('n', 'b', null)])
    assert.ok(tail.ok)
    assert.deepEqual(ids(tail.rows), ['a', 'b', 'n'])
    const empty = merge([], [up('n', null, null)])
    assert.ok(empty.ok)
    assert.deepEqual(ids(empty.rows), ['n'])
  })

  test('★ 정렬 값이 바뀌어 옮긴 행 — 옛 자리에서 빠지고 새 이웃 사이에', () => {
    const merged = merge(list('a', 'b', 'c', 'd'), [up('a', 'c', 'd')])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['b', 'c', 'a', 'd'])
  })

  test('★ 바뀐 행끼리 이웃이면 사슬로 — 순서가 뒤섞여 와도', () => {
    // 서버의 차례: a x y b — x · y 가 새로 들어왔다(델타의 줄 순서는 기록의 것이라 차례와 다르다)
    const merged = merge(list('a', 'b'), [up('y', 'x', 'b'), up('x', 'a', 'y')])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'x', 'y', 'b'])
  })

  test('두 행이 서로 자리를 바꾼다', () => {
    const merged = merge(list('a', 'b', 'c', 'd'), [up('b', 'c', 'd'), up('c', 'a', 'b')])
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'c', 'b', 'd'])
  })

  test('★ 이웃이 화면에서 이웃이 아니면 합치지 않는다(화면이 서버의 지금과 어긋났다)', () => {
    // 서버: a n c — 화면에는 a 와 c 사이에 b 가 있다(b 의 변경은 아직 오지 않았다)
    const merged = merge(list('a', 'b', 'c'), [up('n', 'a', 'c')])
    assert.deepEqual(merged, { ok: false, reason: 'stale' })
  })

  test('앞 이웃이 화면에 없다 · 맨 끝이라는데 뒤에 행이 있다 · 맨 앞이라는데 앞에 행이 있다 → 합치지 않는다', () => {
    assert.equal(merge(list('a', 'b'), [up('n', 'zz', 'b')]).ok, false)
    assert.equal(merge(list('a', 'b'), [up('n', 'a', null)]).ok, false)
    assert.equal(merge(list('a', 'b'), [up('n', null, 'b')]).ok, false)
  })

  test('뒤 이웃이 화면에 없고 더 보기도 없다 → 합치지 않는다', () => {
    assert.equal(merge(list('a', 'b'), [up('n', 'b', 'zz')]).ok, false)
  })

  test('사슬이 맞지 않는다(순환 · 서로 다른 앞) → 합치지 않는다', () => {
    assert.equal(merge(list('a'), [up('x', 'y', 'y'), up('y', 'x', 'x')]).ok, false)
    assert.equal(merge(list('a', 'b'), [up('x', 'a', 'y'), up('y', 'b', null)]).ok, false)
  })

  test('자리 없는 행(뷰에 선다는데 place 가 없다) → 합치지 않는다', () => {
    const bare: DeltaRowJson = { ...row('n'), kind: 'row_upsert', inView: true }
    assert.equal(merge(list('a'), [bare]).ok, false)
  })
})

describe('③ 더 보기가 남은 목록', () => {
  test('★ 아직 읽지 않은 범위로 옮긴 행은 빠지고 · 그 범위에 새로 선 행은 끼우지 않는다', () => {
    const merged = merge(list('a', 'b', 'c'), [up('a', 'q', 'r', { beyond: true }), up('n', 'r', 's', { beyond: true })], { hasMore: true })
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['b', 'c'])
  })

  test('★ 끝 뒤가 읽지 않은 범위면 끝에 끼운다', () => {
    const merged = merge(list('a', 'b'), [up('n', 'b', 'q')], { hasMore: true })
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'b', 'n'])
  })

  test('뒤 이웃이 읽지 않은 범위라는데 앞 이웃이 끝이 아니다 → 합치지 않는다', () => {
    assert.equal(merge(list('a', 'b'), [up('n', 'a', 'q')], { hasMore: true }).ok, false)
  })

  test('내가 고친 행이 읽지 않은 범위로 → 다시 읽기에 맡긴다', () => {
    const merged = merge(list('a', 'b'), [up('a', 'q', 'r', { beyond: true })], { hasMore: true, touched: new Set(['a']) })
    assert.deepEqual(merged, { ok: false, reason: 'beyond_touched' })
  })
})

describe('④ 다시 읽기와 같은 규칙', () => {
  test('★ 내가 고친 행은 뷰 밖이 돼도 옛 자리에 남고 "조건 밖" — 남이 고친 행은 빠진다', () => {
    const merged = merge(list('a', 'b', 'c'), [out('b'), out('c')], { touched: new Set(['b']) })
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'b'])
    assert.deepEqual([...merged.outside], ['b'])
    assert.equal(merged.rows[1]!.version, '2', '남긴 행도 새 값이다')
  })

  test('조건 밖으로 남긴 행은 이웃을 셀 때 건너뛴다 · 다시 뷰에 들면 자리에 서고 표시가 빠진다', () => {
    const outside = new Set(['b'])
    const skipped = merge(list('a', 'b', 'c'), [up('n', 'a', 'c')], { outside, touched: outside })
    assert.ok(skipped.ok)
    assert.deepEqual(ids(skipped.rows), ['a', 'n', 'b', 'c'])
    assert.deepEqual([...skipped.outside], ['b'])
    const back = merge(list('a', 'b', 'c'), [up('b', 'c', null)], { outside, touched: outside })
    assert.ok(back.ok)
    assert.deepEqual(ids(back.rows), ['a', 'c', 'b'])
    assert.deepEqual([...back.outside], [])
  })

  test('★ 늦게 온 옛 값은 화면의 새 버전을 덮지 않는다 — 자리는 델타의 것(같은 버전이면 델타의 것)', () => {
    const newer = merge([row('a'), row('b', 'B 새것', '5'), row('c')], [up('b', 'c', null, { title: 'B 옛것', version: '4' })])
    assert.ok(newer.ok)
    assert.deepEqual(ids(newer.rows), ['a', 'c', 'b'])
    assert.equal(newer.rows[2]!.title, 'B 새것')
    const same = merge([row('a'), row('b', 'B', '4')], [up('b', 'a', null, { title: 'B 델타', version: '4' })])
    assert.ok(same.ok)
    assert.equal(same.rows[1]!.title, 'B 델타')
  })
})

describe('⑤ 상한 · 모양', () => {
  test('상한을 넘으면 합치지 않는다(다시 읽기가 상한까지 읽는다)', () => {
    assert.deepEqual(merge(list('a', 'b'), [up('n', 'b', null)], { cap: 2 }), { ok: false, reason: 'cap' })
    assert.equal(merge(list('a', 'b'), [up('n', 'b', null)], { cap: 3 }).ok, true)
  })

  test('★ 응답의 모양 — 모르는 종류 · 커서 없음 · 깃발이 아니다 · 자리가 틀렸다 → null', () => {
    const good = { cursor: 'c1.9', reset: false, behind: false, schemaChanged: false, viewChanged: false, orderChanged: false, placed: true, rows: [up('a', null, null)] }
    assert.equal(parseDelta(good)?.rows.length, 1)
    assert.equal(parseDelta({ ...good, cursor: undefined }), null)
    assert.equal(parseDelta({ ...good, reset: 'no' }), null)
    assert.equal(parseDelta({ ...good, rows: [{ id: 'x', kind: 'row_moved', inView: true }] }), null)
    assert.equal(parseDelta({ ...good, rows: [{ ...up('a', null, null), place: { before: 1 } }] }), null)
    assert.deepEqual(parseDelta({ ...good, rows: [{ id: 'x', kind: 'row_delete', inView: false, extra: 1 }] })?.rows, [del('x')])
  })
})

describe('⑥ 다시 읽을 까닭', () => {
  const base: DeltaJson = { cursor: 'c1.9', reset: false, behind: false, schemaChanged: false, viewChanged: false, orderChanged: false, placed: true, rows: [] }
  test('★ reset · 스키마 · 이 뷰 · 자리 없음', () => {
    assert.equal(deltaFallback({ ...base, reset: true }), 'reset')
    assert.equal(deltaFallback({ ...base, schemaChanged: true }), 'schema')
    assert.equal(deltaFallback({ ...base, viewChanged: true }), 'view')
    assert.equal(deltaFallback({ ...base, placed: false, rows: [up('a', null, null)] }), 'unplaced')
    assert.equal(deltaFallback({ ...base, rows: [{ ...row('a'), kind: 'row_upsert', inView: true }] }), 'unplaced')
  })

  test('손으로 둔 순서 · 빠지기만 하는 행은 까닭이 아니다(자리 없이도 뺄 수 있다)', () => {
    assert.equal(deltaFallback({ ...base, orderChanged: true, rows: [up('a', null, null)] }), null)
    assert.equal(deltaFallback({ ...base, placed: false, rows: [out('a'), del('b')] }), null)
  })
})

describe('⑦ 커서 장부', () => {
  test('★ 처음은 렌더 커서 · 델타는 응답의 커서로', () => {
    const ledger = createSyncLedger('c1.10')
    assert.equal(ledger.applied, 'c1.10')
    afterDelta(ledger, 'c1.20')
    assert.equal(ledger.applied, 'c1.20')
  })

  test('★ 다시 읽기는 시작 전에 받은 커서로 — reset 의 것이 신호의 것보다 먼저 · 없으면 옛 것을 둔다', () => {
    const ledger = createSyncLedger(null)
    assert.equal(fullReadCursor(ledger), null)
    afterFullRead(ledger, fullReadCursor(ledger))
    assert.equal(ledger.applied, null, '커서를 모르면 다음에도 다시 읽는다')
    noteSignal(ledger, 'c1.30')
    noteSignal(ledger, null)
    noteSignal(ledger, '')
    assert.equal(fullReadCursor(ledger), 'c1.30', '커서가 없는 신호는 덮지 않는다')
    assert.equal(fullReadCursor(ledger, 'c1.31'), 'c1.31')
    const before = fullReadCursor(ledger)
    noteSignal(ledger, 'c1.40') // 다시 읽는 동안 온 신호 — 그 읽기가 그것을 보았는지 모른다
    afterFullRead(ledger, before)
    assert.equal(ledger.applied, 'c1.30')
  })

  test('다시 읽기가 델타보다 세다', () => {
    assert.equal(strongerSync('none', 'delta'), 'delta')
    assert.equal(strongerSync('delta', 'full'), 'full')
    assert.equal(strongerSync('full', 'delta'), 'full')
    assert.equal(strongerSync('none', 'none'), 'none')
  })
})

describe('⑧ 편집 중인 행(RT-4)', () => {
  const hold = (id: string, floating = false) => ({ held: { id, floating } })

  test('★ 다른 행은 바로 옮기고 붙든 행(기록이 오지 않았다)은 그 사이에 그대로 — 떠 있지 않다', () => {
    // 화면 a h b c — c 의 정렬 값이 바뀌어 맨 앞으로(서버: c a h b)
    const merged = merge(list('a', 'h', 'b', 'c'), [up('c', null, 'a')], hold('h'))
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['c', 'a', 'h', 'b'])
    assert.equal(merged.heldEntry, undefined)
  })

  test('★ 붙든 행의 기록이 오면 값만 새것 · 자리는 화면의 것 — 받은 기록을 돌려준다(놓을 때 쓴다)', () => {
    // 서버: a b c h — h 가 맨 끝으로 옮겼지만 편집 중이라 제자리
    const merged = merge(list('a', 'h', 'b', 'c'), [up('h', 'c', null, { title: 'H!' })], hold('h'))
    assert.ok(merged.ok)
    assert.deepEqual(ids(merged.rows), ['a', 'h', 'b', 'c'])
    assert.equal(merged.rows[1]!.title, 'H!')
    assert.equal(merged.heldEntry?.kind, 'row_upsert')
    assert.deepEqual(merged.heldEntry?.kind === 'row_upsert' ? merged.heldEntry.place : null, { before: 'c', after: null, beyond: false })
  })

  test('★ 뷰 밖이 돼도(남의 것 · 휴지통) 붙든 행은 빠지지 않고 조건 밖도 달지 않는다', () => {
    const left = merge(list('a', 'h', 'b'), [out('h')], hold('h'))
    assert.ok(left.ok)
    assert.deepEqual(ids(left.rows), ['a', 'h', 'b'])
    assert.deepEqual([...left.outside], [])
    assert.equal(left.heldEntry?.inView, false)
    const trashed = merge(list('a', 'h', 'b'), [del('h')], hold('h'))
    assert.ok(trashed.ok)
    assert.deepEqual(ids(trashed.rows), ['a', 'h', 'b'])
  })

  test('★ 떠 있는 붙든 행은 이웃을 셀 때 건너뛴다 · 남의 이웃이 그 행이면 같은 델타의 그 자리를 건너 잇는다', () => {
    // 서버: a b c n h — n 의 뒤가 h, h 는 끝. 화면은 a h b c(h 붙듦)
    const spliced = merge(list('a', 'h', 'b', 'c'), [up('h', 'n', null), up('n', 'c', 'h')], hold('h'))
    assert.ok(spliced.ok)
    assert.deepEqual(ids(spliced.rows), ['a', 'h', 'b', 'c', 'n'])
    // 앞서 떠 있던 행 — 이번 델타에 없지만 이웃 셈에서 빠진다(서버: a n b · 화면 a h b)
    const skipped = merge(list('a', 'h', 'b'), [up('n', 'a', 'b')], hold('h', true))
    assert.ok(skipped.ok)
    assert.deepEqual(ids(skipped.rows), ['a', 'n', 'h', 'b'])
  })

  test('★ 떠 있는 행이 이번 델타에 없는데 남의 이웃이 그 행이면 → 다시 읽는다(서버의 그 자리를 모른다)', () => {
    assert.deepEqual(merge(list('a', 'h', 'b'), [up('n', 'h', 'b')], hold('h', true)), { ok: false, reason: 'stale' })
    // 떠 있지 않으면 화면의 자리가 서버의 자리다 — 그대로 이웃으로 센다
    const steady = merge(list('a', 'h', 'b'), [up('n', 'h', 'b')], hold('h'))
    assert.ok(steady.ok)
    assert.deepEqual(ids(steady.rows), ['a', 'h', 'n', 'b'])
  })

  test('★ 놓기 — 받아 둔 자리로 옮긴다 · 값은 화면의 것(같은 버전이어도 덮지 않는다)', () => {
    const pending = up('h', 'c', null, { title: '남의 값', version: '7' })
    const current = row('h', '내가 저장한 값', '7')
    const released = merge([row('a'), current, row('b'), row('c')], [releaseEntry(current, pending)])
    assert.ok(released.ok)
    assert.deepEqual(ids(released.rows), ['a', 'b', 'c', 'h'])
    assert.equal(released.rows[3]!.title, '내가 저장한 값')
  })

  test('★ 놓기 — 그사이 이웃이 어긋났으면 합치지 않는다(다시 읽는다)', () => {
    // 받을 때는 c 뒤 끝이었는데 지금 화면에는 c 뒤에 d 가 섰다
    const current = row('h')
    assert.deepEqual(merge([row('a'), current, row('c'), row('d')], [releaseEntry(current, up('h', 'c', null))]), { ok: false, reason: 'stale' })
  })

  test('놓기 — 뷰 밖이면 남의 것은 빠지고 · 내가 고친 행은 조건 밖으로 남는다', () => {
    const current = row('h')
    const gone = merge([row('a'), current], [releaseEntry(current, out('h'))])
    assert.ok(gone.ok)
    assert.deepEqual(ids(gone.rows), ['a'])
    const kept = merge([row('a'), current], [releaseEntry(current, del('h'))], { touched: new Set(['h']) })
    assert.ok(kept.ok)
    assert.deepEqual(ids(kept.rows), ['a', 'h'])
    assert.deepEqual([...kept.outside], ['h'])
  })

  test('★ 다시 읽기의 고정 — 읽은 목록에서 붙든 행을 옛 자리(바로 앞이던 행 뒤)에 · 읽은 자리를 받아 둔다', () => {
    const previous = list('a', 'h', 'b', 'c')
    const listed = [row('c'), row('a'), row('b'), row('h', 'H 새것', '3')]
    const pinned = pinHeld(previous, listed, 'h')
    assert.deepEqual(ids(pinned), ['c', 'a', 'h', 'b'])
    assert.equal(pinned[2]!.title, 'H 새것', '값은 읽은 것')
    assert.deepEqual(heldPlaceIn(listed, 'h'), { ...row('h', 'H 새것', '3'), kind: 'row_upsert', inView: true, place: { before: 'b', after: null, beyond: false } })
    // 맨 앞이던 행 · 읽은 목록에 없는 행(뷰 밖) — 화면의 값으로 남는다
    assert.deepEqual(ids(pinHeld(list('h', 'a'), [row('b'), row('a')], 'h')), ['h', 'b', 'a'])
    assert.deepEqual(ids(pinHeld(list('a', 'h'), [row('a')], 'h')), ['a', 'h'])
    assert.deepEqual(heldPlaceIn([row('a')], 'h'), { id: 'h', kind: 'row_delete', inView: false })
  })

  test('★ 붙든 행을 아래에서 위로 건너간 행만 — React 가 붙든 행의 줄 대신 새로 넣는다', () => {
    assert.deepEqual(crossedAbove(list('a', 'h', 'b', 'c'), list('c', 'a', 'h', 'b'), 'h'), ['c'])
    assert.deepEqual(crossedAbove(list('a', 'h', 'b'), list('h', 'a', 'b'), 'h'), [], '위에서 아래로 간 행은 아니다')
    assert.deepEqual(crossedAbove(list('a', 'h'), list('n', 'a', 'h'), 'h'), [], '새 행은 아니다')
    assert.deepEqual(crossedAbove(list('a', 'b'), list('b', 'a'), 'h'), [], '붙든 행이 없으면 없다')
  })
})

describe('⑨ 컬럼이 바뀐 다시 세우기 (W8-b 고침 · 정본 ⑫)', () => {
  // 모양은 부르는 쪽(`shapeOf`)의 문자열 — 여기서는 컬럼 이름을 이어 쓴다
  const two = '이름,수량'
  const three = '이름,수량,상태'

  test('★ 지금 화면의 컬럼과 같으면 그대로 맞춘다 — 맞추기를 청한 뒤 내가 더한 속성은 남의 변경이 아니다(W8-b)', () => {
    // 신호를 받을 때는 둘이었고 델타를 묻는 사이 셋째를 더했다 — 읽기를 시작할 때 이미 셋 · 서버도 셋
    assert.equal(columnsVerdict({ server: three, atStart: three, now: three, holding: false }), 'same')
    assert.equal(columnsVerdict({ server: three, atStart: two, now: three, holding: false }), 'same', '읽는 사이 더한 것이 서버에도 있다')
    assert.equal(columnsVerdict({ server: null, atStart: two, now: three, holding: false }), 'same', '응답이 컬럼을 싣지 않았다')
  })

  test('★ 다른 곳에서 바뀌었으면 새로 세운다 · 편집 · 추가 · 더 보기 중이면 미룬다', () => {
    assert.equal(columnsVerdict({ server: three, atStart: two, now: two, holding: false }), 'rebuild')
    assert.equal(columnsVerdict({ server: three, atStart: two, now: two, holding: true }), 'defer', '새로 서면 새 행의 편집 칸 · 진행 중인 추가가 사라진다')
  })

  test('읽는 사이 이 화면의 컬럼이 바뀌었고 서버의 것과 다르면 판정하지 않고 다시 읽는다', () => {
    // 서버가 내 속성을 넣기 전에 읽었는데 응답보다 내 속성이 먼저 화면에 붙었다 — 남의 변경이 아니다
    assert.equal(columnsVerdict({ server: two, atStart: two, now: three, holding: false }), 'reread')
    assert.equal(columnsVerdict({ server: two, atStart: two, now: three, holding: true }), 'reread')
  })
})
