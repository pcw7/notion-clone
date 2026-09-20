/**
 * 뷰의 컬럼 — 모양과 술어 (relation 5b-1 · rollup 5c-2조각, DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **`isCellColumn` 은 셀 타입 목록으로 묻는다** — "relation 이 아니다"가 아니다. 셀이 없는 타입은 앞으로도 는다
 *      (relation · rollup · formula …). 부정으로 물으면 새 타입이 셀인 척 통과해 `readCell` · 필터 축이 조용히
 *      틀린 값을 만든다
 *   ② config → 컬럼은 서버와 화면이 **같은 함수**로 읽는다(`relationOf` · `rollupOf`). 모양이 아니면 null — 그 컬럼은
 *      그리지 않는다(모르는 타입과 같은 취급)
 *
 * 반사실(HANDOFF §3.3-170): `isCellColumn` 을 `type !== 'relation'` 으로 되돌리면 ① 이 rollup 에서 실패한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isCellColumn, relationOf, rollupOf, type ViewColumn } from './view-columns.ts'
import {
  APP_PROPERTY_TYPES,
  DERIVED_PROPERTY_TYPES,
  EDGE_PROPERTY_TYPES,
  MVP_PROPERTY_TYPES,
} from './property-types.ts'

/** 타입만 다른 컬럼. 술어는 `type` 만 본다. */
const columnOf = (type: string): ViewColumn =>
  ({ propertyId: 'p', name: 'n', visible: true, orderKey: 'a0', width: null, wrap: false, options: [], type }) as ViewColumn

describe('① isCellColumn', () => {
  test('★ 셀 타입 7종은 참이다', () => {
    for (const type of MVP_PROPERTY_TYPES) {
      assert.equal(isCellColumn(columnOf(type)), true, type)
    }
  })

  test('★ 셀이 없는 타입은 전부 거짓이다 — 엣지(relation) · 파생(rollup)', () => {
    const notCells = [...EDGE_PROPERTY_TYPES, ...DERIVED_PROPERTY_TYPES]
    assert.ok(notCells.length >= 2, '셀이 아닌 타입이 둘은 되어야 이 검사가 무언가를 본다')
    for (const type of notCells) {
      assert.equal(isCellColumn(columnOf(type)), false, type)
    }
  })

  test('앱이 만드는 타입은 셀 타입 + 셀 아닌 타입으로 **남김없이** 갈린다', () => {
    const split = [...MVP_PROPERTY_TYPES, ...EDGE_PROPERTY_TYPES, ...DERIVED_PROPERTY_TYPES]
    assert.deepEqual([...APP_PROPERTY_TYPES].sort(), split.sort())
  })

  test('모르는 타입(스키마 ENUM 의 24종 중 아직 안 만드는 것)도 셀이 아니다', () => {
    assert.equal(isCellColumn(columnOf('formula')), false)
    assert.equal(isCellColumn(columnOf('people')), false)
  })
})

describe('② config 읽기', () => {
  const ds = '11111111-2222-3333-4444-555555555555'

  test('relationOf — 대상 표 · 제한 · 짝', () => {
    assert.deepEqual(relationOf({ target_data_source_id: ds }), {
      targetDataSourceId: ds,
      limit: 'none',
      synced: false,
    })
    assert.deepEqual(relationOf({ target_data_source_id: ds, limit: 'one', synced_property_id: 'x' }), {
      targetDataSourceId: ds,
      limit: 'one',
      synced: true,
    })
    assert.equal(relationOf({}), null)
    assert.equal(relationOf({ target_data_source_id: '아무거나' }), null)
    assert.equal(relationOf(null), null)
  })

  test('★ rollupOf — 관계 · 대상 · 함수. 모양이 아니면 null', () => {
    assert.deepEqual(rollupOf({ relation_property_id: 'r', target_property_id: 't', function: 'sum' }), {
      relationPropertyId: 'r',
      targetPropertyId: 't',
      function: 'sum',
    })
    assert.equal(rollupOf({ relation_property_id: 'r' }), null)
    assert.equal(rollupOf({ target_property_id: 't' }), null)
    assert.equal(rollupOf(null), null)
  })

  test('모르는 함수는 기본 함수로 읽힌다 — 카탈로그를 줄이는 날에도 컬럼이 선다', () => {
    assert.equal(rollupOf({ relation_property_id: 'r', target_property_id: 't', function: '없는함수' })?.function, 'show_original')
  })
})
