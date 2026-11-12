/**
 * 데이터에서 나온 그룹의 버킷 — 순수 (그룹 버킷 B-1 · B-2 · B-2b · B-3 · S-1 · 공개 화면 PV-6)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ⑦ — 앱(`group.ts`)과 공개 화면이 같은 설정 읽기 · 키 식 · 차례를 쓴다.
 * 키 식이 실제 행에서 앱과 같은 키를 내는지는 `group.db.test.ts` 들과 `publish/public-database.db.test.ts` 가 본다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { ParamBag } from './filter.ts'
import { FOLDED_CHOSEONG, OTHER_INITIAL } from './text-group.ts'
import { bucketKeySql, isDataBucket, orderBuckets, readDataBucket, type DataBucket } from './group-bucket.ts'

const TODAY = '2026-11-12'
const base: DataBucket = { dateUnit: null, numberSize: null, textMode: null, today: TODAY, weekStart: 'monday', sort: 'ascending' }

describe('readDataBucket', () => {
  test('★ 그 타입의 키만 · 없으면 기본값(월 · 10 · 글 그대로 · 월요일 · 오름)', () => {
    assert.deepEqual(readDataBucket({}, 'date', TODAY), { ...base, dateUnit: 'month' })
    assert.deepEqual(readDataBucket({}, 'number', TODAY), { ...base, numberSize: 10 })
    assert.deepEqual(readDataBucket({}, 'rich_text', TODAY), { ...base, textMode: 'exact' })
    assert.deepEqual(readDataBucket({ date_unit: 'week', week_start: 'sunday', sort: 'descending' }, 'date', TODAY), {
      ...base, dateUnit: 'week', weekStart: 'sunday', sort: 'descending',
    })
    assert.deepEqual(readDataBucket({ number_size: 0.5 }, 'number', TODAY).numberSize, 0.5)
    assert.deepEqual(readDataBucket({ text_by: 'first' }, 'rich_text', TODAY).textMode, 'first')
  })

  test('타입을 바꾼 뒤의 저장값 · 틀린 값은 읽지 않는다', () => {
    const stale = readDataBucket({ date_unit: 'year', number_size: 5, text_by: 'first', sort: 'descending' }, 'select', TODAY)
    assert.deepEqual(stale, base, '선택이면 버킷이 없고 순서는 오름')
    assert.equal(readDataBucket({ date_unit: 'decade' }, 'date', TODAY).dateUnit, 'month')
    assert.equal(readDataBucket({ number_size: -3 }, 'number', TODAY).numberSize, 10)
    assert.equal(readDataBucket({ text_by: 'last' }, 'rich_text', TODAY).textMode, 'exact')
  })

  test('isDataBucket — 날짜 · 숫자 · 글만', () => {
    for (const type of ['date', 'number', 'rich_text']) assert.equal(isDataBucket(readDataBucket({}, type, TODAY)), true, type)
    for (const type of ['select', 'status', 'checkbox', 'multi_select']) assert.equal(isDataBucket(readDataBucket({}, type, TODAY)), false, type)
  })
})

describe('bucketKeySql', () => {
  test('데이터 버킷이 아니면 null · 값을 묶지 않는다', () => {
    const params = new ParamBag(2)
    assert.equal(bucketKeySql(base, params), null)
    assert.deepEqual(params.values, [])
  })

  test('★ 묶는 값 — 상대 날짜는 오늘 · 첫 글자는 초성 표와 "그 밖" · 숫자는 크기(글자) · 날짜 · 글 그대로는 없다', () => {
    const bound = (bucket: DataBucket) => {
      const params = new ParamBag(5)
      const sql = bucketKeySql(bucket, params, 'cell')
      return { sql: sql ?? '', values: params.values }
    }
    const relative = bound({ ...base, dateUnit: 'relative' })
    assert.deepEqual(relative.values, [TODAY])
    assert.ok(relative.sql.includes('$5::date') && relative.sql.includes("cell.value -> 'date'"), relative.sql)
    const first = bound({ ...base, textMode: 'first' })
    assert.deepEqual(first.values, [FOLDED_CHOSEONG, OTHER_INITIAL])
    assert.ok(first.sql.includes('cell.text_value') && first.sql.includes("from '\\S'"), first.sql)
    assert.deepEqual(bound({ ...base, numberSize: 0.5 }).values, ['0.5'])
    const month = bound({ ...base, dateUnit: 'month' })
    assert.deepEqual(month.values, [])
    assert.ok(month.sql.includes("date_trunc('month'"), month.sql)
    assert.ok(bound({ ...base, dateUnit: 'week', weekStart: 'sunday' }).sql.includes('extract(dow'), '일요일 시작의 주')
    assert.equal(bound({ ...base, textMode: 'exact' }).sql, "coalesce(cell.text_value, '')")
  })
})

describe('orderBuckets', () => {
  test('★ 숫자는 수 오름 · 값 없음은 뺀다 · 내림이면 뒤집는다', () => {
    const number = { ...base, numberSize: 10 }
    assert.deepEqual(orderBuckets(['20', '', '-10', '100'], number), ['-10', '20', '100'])
    assert.deepEqual(orderBuckets(['20', '', '-10', '100'], { ...number, sort: 'descending' }), ['100', '20', '-10'])
  })

  test('날짜는 첫 날 순 · 상대 날짜는 날짜 차례', () => {
    assert.deepEqual(orderBuckets(['2026-10-01', '2025-01-01', '2026-02-01'], { ...base, dateUnit: 'month' }), ['2025-01-01', '2026-02-01', '2026-10-01'])
    assert.deepEqual(orderBuckets(['later', 'today', 'earlier', 'yesterday'], { ...base, dateUnit: 'relative' }), ['earlier', 'yesterday', 'today', 'later'])
  })

  test('글 그대로는 한국어 순서 · 첫 글자는 ㄱ ~ ㅎ · A ~ Z · #', () => {
    assert.deepEqual(orderBuckets(['하늘', '가방', '나무'], { ...base, textMode: 'exact' }), ['가방', '나무', '하늘'])
    assert.deepEqual(orderBuckets(['#', 'B', 'ㅎ', 'ㄱ', 'A'], { ...base, textMode: 'first' }), ['ㄱ', 'ㅎ', 'A', 'B', '#'])
  })
})
