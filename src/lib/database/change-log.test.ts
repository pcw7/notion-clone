/**
 * 표의 변경 기록 — 커서의 모양 · 델타를 줄 수 있는가 (RT-1조각 · DB 없음)
 *
 *   ① 커서는 판(`c1`)과 xid(10진) — 되돌아 풀린다 · 모양이 틀리면 null(xid8 범위 밖 · 다른 판 · 숫자만 · 빈 글)
 *   ② reset 의 판정 — 커서 없음 · 지평보다 앞선 커서 · 지운 자리 이하 · 줄 · 행 상한 초과. 경계는 같음에서 갈린다
 *   ③ 바뀐 행 — 행의 종류만 · 처음 나온 차례 · 겹치지 않게
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { changedRowIds, decideDelta, decodeChangeCursor, encodeChangeCursor, DELTA_ROW_CAP, DELTA_SCAN_CAP, type ChangeEntry } from './change-log.ts'

describe('① 커서', () => {
  test('★ 되돌아 풀린다 — 작은 값 · 큰 값 · xid8 의 끝', () => {
    for (const v of [BigInt(3), BigInt(11379350), BigInt('9223372036854775807'), BigInt('18446744073709551615')]) {
      const c = encodeChangeCursor(v)
      assert.match(c, /^c1\.\d+$/)
      assert.equal(decodeChangeCursor(c), v)
    }
  })

  test('★ 모양이 틀리면 null — 받는 쪽은 처음부터 읽는다', () => {
    for (const raw of [null, undefined, 42, '', '11379350', 'c1.', 'c1.-5', 'c1.12a', 'c2.100', ' c1.100', 'c1.100 ', 'c1.18446744073709551616', `c1.${'9'.repeat(21)}`]) {
      assert.equal(decodeChangeCursor(raw), null, String(raw))
    }
  })
})

describe('② reset 의 판정', () => {
  const w = (over: Partial<{ horizon: bigint; floor: bigint | null; entryCount: number; rowCount: number }> = {}) => ({
    horizon: BigInt(1000),
    floor: null,
    entryCount: 3,
    rowCount: 2,
    ...over,
  })

  test('델타를 준다 — 커서가 지평 이하 · 지운 자리 위 · 상한 안', () => {
    assert.deepEqual(decideDelta(BigInt(900), w()), { reset: false })
    assert.deepEqual(decideDelta(BigInt(1000), w(), { rows: 2, scan: 3 }), { reset: false }, '지평과 같은 커서 · 상한과 같은 수')
    assert.deepEqual(decideDelta(BigInt(901), w({ floor: BigInt(900) })), { reset: false }, '지운 자리 바로 위')
  })

  test('★ 커서가 없으면 · 지평보다 앞서면(이 DB 의 것이 아니다)', () => {
    assert.deepEqual(decideDelta(null, w()), { reset: true, reason: 'no_cursor' })
    assert.deepEqual(decideDelta(BigInt(1001), w()), { reset: true, reason: 'invalid' })
  })

  test('★ 지운 기록을 넘겨야 하면(24시간 창 밖) — 지운 자리와 같아도', () => {
    assert.deepEqual(decideDelta(BigInt(900), w({ floor: BigInt(900) })), { reset: true, reason: 'expired' })
    assert.deepEqual(decideDelta(BigInt(10), w({ floor: BigInt(900) })), { reset: true, reason: 'expired' })
  })

  test('★ 상한을 넘으면 — 바뀐 행 · 훑은 줄', () => {
    assert.deepEqual(decideDelta(BigInt(900), w({ rowCount: DELTA_ROW_CAP + 1 })), { reset: true, reason: 'too_many' })
    assert.deepEqual(decideDelta(BigInt(900), w({ rowCount: DELTA_ROW_CAP, entryCount: DELTA_ROW_CAP })), { reset: false }, '상한과 같으면 준다')
    assert.deepEqual(decideDelta(BigInt(900), w({ entryCount: DELTA_SCAN_CAP + 1, rowCount: 1 })), { reset: true, reason: 'too_many' })
  })

  test('판정의 차례 — 앞선 커서가 지운 자리보다 먼저다', () => {
    assert.deepEqual(decideDelta(BigInt(2000), w({ floor: BigInt(3000) })), { reset: true, reason: 'invalid' })
  })
})

describe('③ 바뀐 행', () => {
  test('★ 행의 종류만 · 처음 나온 차례 · 겹치지 않게', () => {
    const entries: ChangeEntry[] = [
      { kind: 'schema', rowId: null, viewId: null },
      { kind: 'row_upsert', rowId: 'b', viewId: null },
      { kind: 'view', rowId: null, viewId: 'v' },
      { kind: 'position', rowId: 'a', viewId: 'v' },
      { kind: 'row_delete', rowId: 'b', viewId: null },
      { kind: 'reminder', rowId: 'c', viewId: null },
      { kind: 'layout', rowId: null, viewId: null },
    ]
    assert.deepEqual(changedRowIds(entries), ['b', 'a', 'c'])
    assert.deepEqual(changedRowIds([]), [])
  })
})
