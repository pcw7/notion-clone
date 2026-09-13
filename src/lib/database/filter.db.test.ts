/**
 * 연산자 카탈로그 DB ↔ TS 일치 — W8-b (F-03-17)
 *
 * 마이그레이션 0015 의 `filter_operator` 표는 **UI 가 읽는 카탈로그**이고 SQL 을
 * 담지 않는다. SQL 조각은 `filter.ts` 의 화이트리스트 맵이다. 둘이 어긋나면:
 *
 *   · 카탈로그에만 있는 연산자 → 화면의 드롭다운에 떴는데 고르면 **조용히 무시된다**
 *     (컴파일러가 모르는 연산자를 건너뛴다)
 *   · 맵에만 있는 연산자 → 동작은 하는데 **아무도 고를 수 없다**
 *
 * 두 실패 모두 런타임 오류가 아니라 "왜 안 되지"로 나타난다. 그래서 이 파일이 있다.
 *
 * **선례**: `level_capability`(DB) ↔ `levels.ts`(TS) 매트릭스를 `levels.db.test.ts`
 * 가 맞추는 것과 같은 패턴이다. 한쪽만 고치면 CI 가 막는다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { MVP_PROPERTY_TYPES, type MvpPropertyType } from './property-types.ts'
import { operatorArity, operatorsFor } from './filter.ts'
import { readOperatorCatalog, type OperatorCatalogEntry } from './operator-catalog.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let catalog: OperatorCatalogEntry[] = []
/** 거르기 전의 표에 있는 타입들. */
let rawTypes: string[] = []

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  // 화면이 읽는 **그 함수**로 읽는다. 테스트가 SQL 을 따로 쓰면 "테스트는 맞는데
  // 필터 패널이 읽는 경로는 틀린" 구간이 생긴다(operator-catalog.ts 머리말).
  catalog = await readOperatorCatalog()
  // 단 "MVP 밖 타입이 표에 없다"는 그 함수가 거르기 **전**의 표를 봐야 한다 —
  // 거른 결과로 확인하면 항상 통과하는 검사가 된다.
  rawTypes = (
    await withReadTransaction((tx) =>
      tx.query<{ t: string }>(`SELECT DISTINCT property_type::text AS t FROM filter_operator`),
    )
  ).map((r) => r.t)
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const catalogFor = (type: string): OperatorCatalogEntry[] =>
  catalog.filter((r) => r.propertyType === type)

describe('★ 카탈로그와 컴파일러가 같은 연산자를 안다', () => {
  for (const type of MVP_PROPERTY_TYPES) {
    test(`${type} — 연산자 집합이 같다`, async (t) => {
      if (skipReason) return t.skip(skipReason)
      const fromDb = catalogFor(type).map((r) => r.operator).sort()
      const fromTs = operatorsFor(type).sort()
      assert.deepEqual(
        fromDb,
        fromTs,
        `DB 에만: ${fromDb.filter((o) => !fromTs.includes(o)).join(', ') || '없음'} / ` +
          `TS 에만: ${fromTs.filter((o) => !fromDb.includes(o)).join(', ') || '없음'}`,
      )
    })

    test(`${type} — arity 가 같다`, async (t) => {
      if (skipReason) return t.skip(skipReason)
      for (const row of catalogFor(type)) {
        assert.equal(
          row.arity,
          operatorArity(type as MvpPropertyType, row.operator),
          `${type}.${row.operator} 의 arity 가 다르다`,
        )
      }
    })
  }
})

describe('카탈로그 자체의 건강', () => {
  test('MVP 6종이 모두 카탈로그에 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const type of MVP_PROPERTY_TYPES) {
      assert.ok(catalogFor(type).length > 0, `${type} 의 연산자가 카탈로그에 없다`)
    }
  })

  test('★ MVP 밖 타입은 카탈로그에 없다 — 필터 UI 가 쓸 수 없는 것을 보여주면 안 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mvp = new Set<string>(MVP_PROPERTY_TYPES)
    const extra = rawTypes.filter((t2) => !mvp.has(t2))
    assert.deepEqual(extra, [], `MVP 밖 타입이 카탈로그에 있다: ${extra.join(', ')}`)
  })

  test('라벨이 비어 있지 않고 중복되지 않는다 (타입 안에서)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const type of MVP_PROPERTY_TYPES) {
      const labels = catalogFor(type).map((r) => r.label)
      assert.ok(
        labels.every((l) => l.length > 0),
        `${type} 에 빈 라벨이 있다`,
      )
      assert.equal(new Set(labels).size, labels.length, `${type} 에 중복 라벨이 있다: ${labels}`)
    }
  })

  test('★ checkbox 에 is_empty 가 없다 — DB 쪽도 그렇다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ops = catalogFor('checkbox').map((r) => r.operator)
    assert.ok(!ops.includes('is_empty'), 'checkbox 에 is_empty 가 있다 (null 상태가 없는 타입이다)')
    assert.equal(ops.length, 2)
  })

  test('★ select 은 4개다 — 텍스트 연산자를 물려받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ops = catalogFor('select').map((r) => r.operator).sort()
    assert.deepEqual(ops, ['does_not_equal', 'equals', 'is_empty', 'is_not_empty'])
  })

  test('상대 날짜 연산자는 아직 없다 (평가 시점 의존 — 불변식 VW1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ops = catalogFor('date').map((r) => r.operator)
    for (const relative of ['past_week', 'this_week', 'today', 'next_month']) {
      assert.ok(!ops.includes(relative), `${relative} 가 카탈로그에 있다`)
    }
  })
})
