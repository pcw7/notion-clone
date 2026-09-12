/**
 * 프로퍼티 스키마 관리 — W8-a (F-03-01 · F-03-02)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **`title` 은 특별하다.** 삭제·추가 불가. API 문서가 명시한 세 규칙
 *   ② **삭제는 soft delete 이고 셀 값이 남는다.** 복원하면 값이 돌아온다
 *   ③ **스키마 변경마다 `schema_version` 이 오른다.** 낡은 스키마로 쓰는 것을
 *      막는 유일한 축이다
 *   ④ **권한은 `edit_structure`.** 값은 고치지만 컬럼은 못 고치는 사람이 있다
 *   ⑤ 불변식 DS1 · P1 의 "적어도 1개"는 `createDatabase` 가 지킨다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import {
  probeDatabase,
  makeFixture,
  createUser,
  joinAs,
  type Actor,
  type Fixture,
} from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase, getDatabase, DEFAULT_TITLE_PROPERTY_NAME } from './database.ts'
import {
  addProperty,
  deleteProperty,
  getSchema,
  moveProperty,
  newPropertyId,
  restoreProperty,
  updateProperty,
  PROPERTY_ID_LENGTH,
  type SchemaSnapshot,
} from './property.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

/** 표 하나를 만들고 data_source id 를 준다. */
const newTable = async (name = '표'): Promise<{ databaseId: string; dataSourceId: string }> => {
  const created = await createDatabase(fx.owner.ctx, { name })
  assert.equal(created.ok, true, '표 생성이 실패했다')
  if (!created.ok) throw new Error('unreachable')
  return { databaseId: created.value.id, dataSourceId: created.value.dataSourceId }
}

const unwrap = (r: Awaited<ReturnType<typeof addProperty>>): SchemaSnapshot => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const names = (s: SchemaSnapshot): string[] => s.properties.map((p) => p.name)

describe('createDatabase — 불변식의 "적어도 1개"를 지킨다', () => {
  test('★ 표를 만들면 title 프로퍼티가 하나 생긴다 (P1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable('할 일')

    const schema = unwrap(await getSchema(fx.owner.ctx, dataSourceId))
    assert.equal(schema.properties.length, 1)
    assert.equal(schema.properties[0].type, 'title')
    assert.equal(schema.properties[0].name, DEFAULT_TITLE_PROPERTY_NAME)
  })

  test('★ 소유 부착 행이 정확히 하나 생긴다 (DS1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, dataSourceId } = await newTable()

    const rows = await withReadTransaction((tx) =>
      tx.query<{ database_id: string }>(
        `SELECT database_id FROM database_data_source WHERE data_source_id = $1`,
        [dataSourceId],
      ),
    )
    assert.equal(rows.length, 1)
    // DS2: is_linked 는 파생이다 — 소유 행이면 database_id = owner_database_id.
    assert.equal(rows[0].database_id, databaseId)
  })

  test('schema_version 은 1에서 시작한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    assert.equal(unwrap(await getSchema(fx.owner.ctx, dataSourceId)).schemaVersion, '1')
  })

  test('제목이 비어도 만들어진다 — 페이지와 같은 규칙', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const created = await createDatabase(fx.owner.ctx, {})
    assert.equal(created.ok, true)
    if (created.ok) {
      const got = await getDatabase(fx.owner.ctx, created.value.id)
      assert.equal(got.ok, true)
      if (got.ok) assert.equal(got.value.name, '')
    }
  })

  test('getDatabase 는 소유한 data_source 를 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, dataSourceId } = await newTable('읽을 표')
    const got = await getDatabase(fx.owner.ctx, databaseId)
    assert.equal(got.ok, true)
    if (got.ok) {
      assert.equal(got.value.dataSourceId, dataSourceId)
      assert.equal(got.value.name, '읽을 표')
      assert.equal(got.value.isInline, false)
    }
  })
})

describe('newPropertyId', () => {
  test('21자 base62 다 (정본 C-4)', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = newPropertyId()
      assert.equal(id.length, PROPERTY_ID_LENGTH)
      assert.match(id, /^[A-Za-z0-9]{21}$/)
    }
  })

  test('★ 같은 값이 두 번 나오지 않는다', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i += 1) seen.add(newPropertyId())
    assert.equal(seen.size, 2000)
  })

  test('★ 모듈로 편향이 없다 — 62자가 고르게 나온다', () => {
    // 248 이상 바이트를 버리지 않으면 앞쪽 문자(A~) 가 더 자주 나온다.
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i += 1) {
      for (const ch of newPropertyId()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    assert.equal(counts.size, 62, `${counts.size}종만 나왔다`)
    const values = [...counts.values()]
    const expected = (4000 * PROPERTY_ID_LENGTH) / 62
    // 고르다면 최대/최소가 기대치의 ±30% 안이다. 편향이 있으면 앞쪽이 2배 가까이 된다.
    assert.ok(
      Math.max(...values) < expected * 1.3 && Math.min(...values) > expected * 0.7,
      `분포가 고르지 않다: ${Math.min(...values)}~${Math.max(...values)} (기대 ${expected})`,
    )
  })
})

describe('addProperty', () => {
  test('맨 뒤에 붙는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    await addProperty(fx.owner.ctx, dataSourceId, { name: '상태', type: 'select' })
    const schema = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '마감', type: 'date' }))
    assert.deepEqual(names(schema), [DEFAULT_TITLE_PROPERTY_NAME, '상태', '마감'])
  })

  test('타입을 생략하면 rich_text 다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const schema = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '메모' }))
    assert.equal(schema.properties.find((p) => p.name === '메모')?.type, 'rich_text')
  })

  test('★ schema_version 이 오른다 — 낡은 스키마 쓰기를 막는 유일한 축', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const before = unwrap(await getSchema(fx.owner.ctx, dataSourceId)).schemaVersion
    const after = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '메모' })).schemaVersion
    assert.ok(BigInt(after) > BigInt(before), `${before} → ${after}`)
  })

  test('★ 동명 프로퍼티는 거부 — formula 의 prop("이름") 해석이 모호해진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    await addProperty(fx.owner.ctx, dataSourceId, { name: '상태' })
    const dup = await addProperty(fx.owner.ctx, dataSourceId, { name: '상태' })
    assert.equal(dup.ok, false)
    if (!dup.ok) assert.equal(dup.reason, 'duplicate_name')
  })

  test('대소문자가 다르면 다른 이름이다 (V-7)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    await addProperty(fx.owner.ctx, dataSourceId, { name: 'Status' })
    assert.equal((await addProperty(fx.owner.ctx, dataSourceId, { name: 'status' })).ok, true)
  })

  test('★ title 을 추가로 만들 수 없다 (P1 · API 문서 명시)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const r = await addProperty(fx.owner.ctx, dataSourceId, { name: '제목2', type: 'title' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'title_immutable')
  })

  test('MVP 밖 타입은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    // @ts-expect-error — 런타임 방어를 확인한다
    const r = await addProperty(fx.owner.ctx, dataSourceId, { name: '다중', type: 'multi_select' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'unsupported_type')
  })

  test('빈 이름 · 공백만 있는 이름은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    for (const name of ['', '   ']) {
      const r = await addProperty(fx.owner.ctx, dataSourceId, { name })
      assert.equal(r.ok, false, JSON.stringify(name))
      if (!r.ok) assert.equal(r.reason, 'invalid_name')
    }
  })

  test('이름의 개행을 접는다 — 컬럼 헤더는 한 줄이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const schema = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: ' 두\n줄  이름 ' }))
    assert.ok(names(schema).includes('두 줄 이름'))
  })

  test('없는 data_source 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const r = await addProperty(fx.owner.ctx, randomUUID(), { name: '메모' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_found')
  })
})

describe('★ 낙관적 잠금 (F-03-02: 스키마는 셀보다 충돌 비용이 크다)', () => {
  test('★ 낡은 버전으로 쓰면 거부하고 현재 버전을 알려준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const stale = unwrap(await getSchema(fx.owner.ctx, dataSourceId)).schemaVersion

    // 누군가 먼저 고쳤다.
    await addProperty(fx.owner.ctx, dataSourceId, { name: '먼저' })

    const r = await addProperty(fx.owner.ctx, dataSourceId, {
      name: '나중',
      expectedVersion: stale,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.reason, 'schema_conflict')
      assert.ok(r.currentVersion !== undefined && BigInt(r.currentVersion) > BigInt(stale))
    }
  })

  test('맞는 버전으로 쓰면 통과한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const v = unwrap(await getSchema(fx.owner.ctx, dataSourceId)).schemaVersion
    assert.equal(
      (await addProperty(fx.owner.ctx, dataSourceId, { name: '메모', expectedVersion: v })).ok,
      true,
    )
  })
})

describe('updateProperty', () => {
  test('★ 이름을 바꿔도 id 는 그대로다 (P2) — 셀과 참조가 살아 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const added = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '옛 이름' }))
    const id = added.properties.find((p) => p.name === '옛 이름')!.id

    const renamed = unwrap(await updateProperty(fx.owner.ctx, dataSourceId, id, { name: '새 이름' }))
    const found = renamed.properties.find((p) => p.id === id)
    assert.equal(found?.name, '새 이름')
  })

  test('설명을 넣고 지울 수 있다 — "안 보냈다"와 "비워라"를 구분한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const added = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '메모' }))
    const id = added.properties.find((p) => p.name === '메모')!.id

    let s = unwrap(await updateProperty(fx.owner.ctx, dataSourceId, id, { description: '설명이다' }))
    assert.equal(s.properties.find((p) => p.id === id)?.description, '설명이다')

    // 이름만 보내면 설명이 유지된다.
    s = unwrap(await updateProperty(fx.owner.ctx, dataSourceId, id, { name: '메모2' }))
    assert.equal(s.properties.find((p) => p.id === id)?.description, '설명이다')

    // null 을 보내면 지워진다.
    s = unwrap(await updateProperty(fx.owner.ctx, dataSourceId, id, { description: null }))
    assert.equal(s.properties.find((p) => p.id === id)?.description, null)
  })

  test('다른 프로퍼티와 같은 이름으로는 바꿀 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    await addProperty(fx.owner.ctx, dataSourceId, { name: 'A' })
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: 'B' }))
    const bId = s.properties.find((p) => p.name === 'B')!.id

    const r = await updateProperty(fx.owner.ctx, dataSourceId, bId, { name: 'A' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'duplicate_name')
  })

  test('자기 이름으로 바꾸는 것은 허용한다 — 다른 필드만 고치는 경우다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '그대로' }))
    const id = s.properties.find((p) => p.name === '그대로')!.id
    assert.equal((await updateProperty(fx.owner.ctx, dataSourceId, id, { name: '그대로' })).ok, true)
  })

  test('title 의 이름은 바꿀 수 있다 — 삭제·타입 변경만 막힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await getSchema(fx.owner.ctx, dataSourceId))
    const titleId = s.properties[0].id
    const after = unwrap(await updateProperty(fx.owner.ctx, dataSourceId, titleId, { name: '과제명' }))
    assert.equal(after.properties[0].name, '과제명')
    assert.equal(after.properties[0].type, 'title')
  })
})

describe('moveProperty', () => {
  test('앞으로 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    for (const n of ['A', 'B', 'C']) await addProperty(fx.owner.ctx, dataSourceId, { name: n })
    let s = unwrap(await getSchema(fx.owner.ctx, dataSourceId))
    const byName = new Map(s.properties.map((p) => [p.name, p.id]))

    s = unwrap(await moveProperty(fx.owner.ctx, dataSourceId, byName.get('C')!, byName.get('A')!))
    assert.deepEqual(names(s), [DEFAULT_TITLE_PROPERTY_NAME, 'C', 'A', 'B'])
  })

  test('맨 뒤로 옮긴다 (beforeId = null)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    for (const n of ['A', 'B']) await addProperty(fx.owner.ctx, dataSourceId, { name: n })
    let s = unwrap(await getSchema(fx.owner.ctx, dataSourceId))
    const aId = s.properties.find((p) => p.name === 'A')!.id

    s = unwrap(await moveProperty(fx.owner.ctx, dataSourceId, aId, null))
    assert.deepEqual(names(s), [DEFAULT_TITLE_PROPERTY_NAME, 'B', 'A'])
  })

  test('★ 자기 앞으로 옮기면 제자리다 — 자신을 경계로 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    for (const n of ['A', 'B']) await addProperty(fx.owner.ctx, dataSourceId, { name: n })
    let s = unwrap(await getSchema(fx.owner.ctx, dataSourceId))
    const bId = s.properties.find((p) => p.name === 'B')!.id

    s = unwrap(await moveProperty(fx.owner.ctx, dataSourceId, bId, bId))
    assert.deepEqual(names(s), [DEFAULT_TITLE_PROPERTY_NAME, 'A', 'B'])
  })

  test('★ 옮기는 행 하나만 쓴다 — fractional index 의 이유', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    for (const n of ['A', 'B', 'C', 'D']) await addProperty(fx.owner.ctx, dataSourceId, { name: n })
    const before = unwrap(await getSchema(fx.owner.ctx, dataSourceId))
    const keys = new Map(before.properties.map((p) => [p.id, p.orderKey]))
    const dId = before.properties.find((p) => p.name === 'D')!.id

    const after = unwrap(await moveProperty(fx.owner.ctx, dataSourceId, dId, before.properties[1].id))
    const changed = after.properties.filter((p) => keys.get(p.id) !== p.orderKey)
    assert.equal(changed.length, 1, `${changed.length}개의 키가 바뀌었다`)
    assert.equal(changed[0].id, dId)
  })

  test('없는 프로퍼티는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const r = await moveProperty(fx.owner.ctx, dataSourceId, newPropertyId(), null)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'not_found')
  })
})

describe('★ 삭제는 soft delete 다 — 셀 값이 남는다', () => {
  /** 셀 하나를 직접 넣는다. 셀 쓰기 API 는 다음 PR 이다. */
  const putCell = async (dataSourceId: string, propertyId: string, text: string) => {
    const rowId = randomUUID()
    await withReadTransaction(async () => undefined) // 풀 워밍업(의미 없음 방지)
    const { withTransaction } = await import('../db/tx.ts')
    await withTransaction(async (tx) => {
      const ds = await tx.queryOne<{ owner: string }>(
        `SELECT owner_database_id AS owner FROM data_source WHERE id = $1`,
        [dataSourceId],
      )
      await tx.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
         VALUES ($1, $2, 'page', 'data_source', $3, $4, '{}', $5, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [rowId, fx.workspaceId, dataSourceId, `r${Date.now() % 100000}`, ds.owner],
      )
      await tx.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [rowId, dataSourceId])
      await tx.query(
        `INSERT INTO page_property_value (page_id, property_id, value, text_value, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, now())`,
        [rowId, propertyId, JSON.stringify({ type: 'rich_text', rich_text: [] }), text],
      )
    })
    return rowId
  }

  const cellText = async (rowId: string, propertyId: string): Promise<string | null> =>
    withReadTransaction(async (tx) => {
      const row = await tx.queryMaybe<{ text_value: string | null }>(
        `SELECT text_value FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
        [rowId, propertyId],
      )
      return row?.text_value ?? null
    })

  test('★ 지우면 스키마에서 사라지지만 셀 값은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '지울 컬럼' }))
    const id = s.properties.find((p) => p.name === '지울 컬럼')!.id
    const rowId = await putCell(dataSourceId, id, '남아야 하는 값')

    const after = unwrap(await deleteProperty(fx.owner.ctx, dataSourceId, id))
    assert.ok(!names(after).includes('지울 컬럼'))
    // 값은 그대로다 — 그래야 복원이 의미를 갖는다.
    assert.equal(await cellText(rowId, id), '남아야 하는 값')
  })

  test('★ 복원하면 컬럼과 값이 함께 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '되살릴 컬럼' }))
    const id = s.properties.find((p) => p.name === '되살릴 컬럼')!.id
    const rowId = await putCell(dataSourceId, id, '되살아날 값')

    await deleteProperty(fx.owner.ctx, dataSourceId, id)
    const restored = unwrap(await restoreProperty(fx.owner.ctx, dataSourceId, id))
    assert.ok(names(restored).includes('되살릴 컬럼'))
    assert.equal(await cellText(rowId, id), '되살아날 값')
  })

  test('★ 지운 이름을 다시 쓸 수 있다 (마이그레이션 0013 의 [정정])', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '상태' }))
    const id = s.properties.find((p) => p.name === '상태')!.id

    await deleteProperty(fx.owner.ctx, dataSourceId, id)
    const again = await addProperty(fx.owner.ctx, dataSourceId, { name: '상태', type: 'select' })
    assert.equal(again.ok, true, '지운 이름을 다시 쓸 수 없다')
  })

  test('★ 같은 이름이 이미 있으면 복원을 거부한다 — 이름을 멋대로 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '상태' }))
    const id = s.properties.find((p) => p.name === '상태')!.id

    await deleteProperty(fx.owner.ctx, dataSourceId, id)
    await addProperty(fx.owner.ctx, dataSourceId, { name: '상태', type: 'select' })

    const r = await restoreProperty(fx.owner.ctx, dataSourceId, id)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'duplicate_name')
  })

  test('★ title 은 지울 수 없다 (API 문서 명시)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const titleId = unwrap(await getSchema(fx.owner.ctx, dataSourceId)).properties[0].id

    const r = await deleteProperty(fx.owner.ctx, dataSourceId, titleId)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'title_immutable')
  })

  test('복원은 맨 뒤로 간다 — 원래 자리가 점유됐을 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { dataSourceId } = await newTable()
    const s = unwrap(await addProperty(fx.owner.ctx, dataSourceId, { name: '먼저' }))
    const id = s.properties.find((p) => p.name === '먼저')!.id

    await deleteProperty(fx.owner.ctx, dataSourceId, id)
    await addProperty(fx.owner.ctx, dataSourceId, { name: '나중' })
    const restored = unwrap(await restoreProperty(fx.owner.ctx, dataSourceId, id))
    assert.deepEqual(names(restored), [DEFAULT_TITLE_PROPERTY_NAME, '나중', '먼저'])
  })
})

describe('★ 권한 — 스키마 변경은 edit_structure 다', () => {
  test('★ 볼 수 없는 사람에게는 not_found 다 — 존재를 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, dataSourceId } = await newTable('비밀 표')

    // 소유자만 보게 만든다.
    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )

    for (const r of [
      await getSchema(other.ctx, dataSourceId),
      await addProperty(other.ctx, dataSourceId, { name: '몰래' }),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'not_found')
    }
  })

  test('★ 볼 수만 있는 사람은 스키마를 고칠 수 없다 (forbidden)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, dataSourceId } = await newTable('읽기 전용 표')

    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )
    assert.equal(
      (await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: other.userId }, 'view')).ok,
      true,
    )

    // 볼 수는 있다.
    assert.equal((await getSchema(other.ctx, dataSourceId)).ok, true)

    // 고칠 수는 없다 — 네 경로 모두.
    const titleId = unwrap(await getSchema(fx.owner.ctx, dataSourceId)).properties[0].id
    for (const r of [
      await addProperty(other.ctx, dataSourceId, { name: '몰래' }),
      await updateProperty(other.ctx, dataSourceId, titleId, { name: '몰래' }),
      await moveProperty(other.ctx, dataSourceId, titleId, null),
      await deleteProperty(other.ctx, dataSourceId, titleId),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'forbidden')
    }
  })
})
