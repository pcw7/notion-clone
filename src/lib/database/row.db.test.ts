/**
 * DB 행 · 셀 쓰기 — W8-a (F-03-16)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **사이드카가 같은 트랜잭션에서 채워진다.** 안 되면 "저장은 됐는데 필터·
 *      정렬에 안 걸리는" 상태가 된다
 *   ② **`properties_cache` 는 트리거가 유지한다**(R2). 앱이 쓰지 않는다
 *   ③ **제목은 EAV → block 한쪽 방향 투영이다.** `renamePage` 는 행을 거부한다
 *   ④ **읽기 전용 · 모르는 프로퍼티 · 자동 메타는 거부한다**(C1 · C2)
 *   ⑤ 권한은 셀이 `edit_content`, 행 추가가 `create_child` 다
 *   ⑥ 불변식 R1: 템플릿 행은 목록에 없다
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
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { renamePage, titleFromPlainText, PageError } from '../block/page.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema, newPropertyId } from './property.ts'
import {
  clearCell,
  createRow,
  listRows,
  trashRow,
  updateCells,
  type RowCell,
  type RowSummary,
} from './row.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { MvpPropertyType } from './property-types.ts'

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

type Table = {
  databaseId: string
  dataSourceId: string
  titleId: string
  prop: (name: string) => string
}

/** 표 하나 + 요청한 프로퍼티들. 이름 → id 맵을 준다. */
const newTable = async (
  extra: readonly { name: string; type: MvpPropertyType }[] = [],
): Promise<Table> => {
  const created = await createDatabase(fx.owner.ctx, { name: '표' })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('unreachable')
  const dataSourceId = created.value.dataSourceId

  for (const p of extra) {
    const r = await addProperty(fx.owner.ctx, dataSourceId, { name: p.name, type: p.type })
    assert.equal(r.ok, true, `프로퍼티 ${p.name} 추가 실패`)
  }

  const schema = await getSchema(fx.owner.ctx, dataSourceId)
  assert.equal(schema.ok, true)
  if (!schema.ok) throw new Error('unreachable')
  const byName = new Map(schema.value.properties.map((p) => [p.name, p.id]))
  const titleId = schema.value.properties.find((p) => p.type === 'title')!.id

  return {
    databaseId: created.value.id,
    dataSourceId,
    titleId,
    prop: (name) => {
      const id = byName.get(name)
      assert.ok(id !== undefined, `프로퍼티 ${name} 이 없다`)
      return id
    },
  }
}

const unwrapRow = (r: Awaited<ReturnType<typeof createRow>>): RowSummary => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const titleCell = (text: string): RowCell => ({
  propertyId: '',
  value: { type: 'title', title: text === '' ? [] : [textRun(text)] },
})

/** 사이드카를 DB 에서 직접 읽는다 — 앱이 쓴다고 주장하는 것을 확인한다. */
const sidecarsOf = async (rowId: string, propertyId: string) =>
  withReadTransaction((tx) =>
    tx.queryMaybe<{
      num_value: string | null
      text_value: string | null
      date_start: Date | null
      date_end: Date | null
      bool_value: boolean | null
      value: unknown
    }>(
      `SELECT num_value, text_value, date_start, date_end, bool_value, value
         FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
      [rowId, propertyId],
    ),
  )

const cacheOf = async (rowId: string) =>
  withReadTransaction((tx) =>
    tx.queryOne<{ properties_cache: Record<string, unknown>; cache_version: string; tsv: string | null }>(
      `SELECT properties_cache, cache_version, search_tsv::text AS tsv FROM page WHERE id = $1`,
      [rowId],
    ),
  )

describe('createRow', () => {
  test('★ 빈 행을 만들 수 있다 — 행은 block 의 행이다 (C-3)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const block = await withReadTransaction((tx) =>
      tx.queryOne<{ type: string; parent_type: string; parent_id: string }>(
        `SELECT type, parent_type, parent_id FROM block WHERE id = $1`,
        [row.id],
      ),
    )
    assert.equal(block.type, 'page')
    assert.equal(block.parent_type, 'data_source')
    assert.equal(block.parent_id, table.dataSourceId)
  })

  test('셀과 함께 만들 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [
          { ...titleCell('첫 행'), propertyId: table.titleId },
          { propertyId: table.prop('수량'), value: { type: 'number', number: 7 } },
        ],
      }),
    )
    assert.equal(row.title, '첫 행')
    assert.equal(row.properties[table.prop('수량')] !== undefined, true)
  })

  test('행은 맨 뒤에 붙는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const ids: string[] = []
    for (const n of ['A', 'B', 'C']) {
      ids.push(
        unwrapRow(
          await createRow(fx.owner.ctx, table.dataSourceId, {
            cells: [{ ...titleCell(n), propertyId: table.titleId }],
          }),
        ).id,
      )
    }
    const listed = await listRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.deepEqual(listed.value.rows.map((r) => r.id), ids)
  })

  test('낡은 스키마 버전으로는 만들 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const stale = '1'
    await addProperty(fx.owner.ctx, table.dataSourceId, { name: '새 컬럼' })

    const r = await createRow(fx.owner.ctx, table.dataSourceId, { expectedSchemaVersion: stale })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'schema_conflict')
  })
})

describe('★ 사이드카 — 같은 트랜잭션에서 채워진다', () => {
  test('★ number → num_value', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 42 } }],
      }),
    )
    const s = await sidecarsOf(row.id, table.prop('수량'))
    assert.equal(Number(s?.num_value), 42)
    assert.equal(s?.text_value, null)
  })

  test('★ checkbox → bool_value (false 도 채운다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '완료', type: 'checkbox' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('완료'), value: { type: 'checkbox', checkbox: false } }],
      }),
    )
    // null 이면 `equals false` 필터가 부분 인덱스를 벗어난다.
    assert.equal((await sidecarsOf(row.id, table.prop('완료')))?.bool_value, false)
  })

  test('★ date → date_start · date_end', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '기간', type: 'date' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [
          {
            propertyId: table.prop('기간'),
            value: { type: 'date', date: { start: '2026-03-01', end: '2026-03-10' } },
          },
        ],
      }),
    )
    const s = await sidecarsOf(row.id, table.prop('기간'))
    assert.equal(s?.date_start?.toISOString().slice(0, 10), '2026-03-01')
    assert.equal(s?.date_end?.toISOString().slice(0, 10), '2026-03-10')
  })

  test('★ select → 옵션 id (이름이 아니다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '상태', type: 'select' }])
    const optionId = randomUUID()
    await withTransaction((tx) =>
      tx.query(
        `INSERT INTO select_option (id, property_id, name, color, order_idx)
         VALUES ($1, $2, '진행중', 'blue', 'a0')`,
        [optionId, table.prop('상태')],
      ),
    )
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('상태'), value: { type: 'select', select: { id: optionId } } }],
      }),
    )
    assert.equal((await sidecarsOf(row.id, table.prop('상태')))?.text_value, optionId)
  })

  test('★ 봉투가 value 에 그대로 남는다 — 판별 유니온', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 3 } }],
      }),
    )
    assert.deepEqual((await sidecarsOf(row.id, table.prop('수량')))?.value, {
      type: 'number',
      number: 3,
    })
  })
})

describe('★ properties_cache — 트리거가 유지한다 (R2)', () => {
  test('★ 셀을 쓰면 캐시가 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const before = await cacheOf(row.id)
    assert.deepEqual(before.properties_cache, {})

    await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 9 } }],
    })

    const after = await cacheOf(row.id)
    assert.deepEqual(after.properties_cache[table.prop('수량')], { type: 'number', number: 9 })
    assert.ok(BigInt(after.cache_version) > BigInt(before.cache_version))
  })

  test('★ search_tsv 는 사람이 쓴 텍스트만 담는다 — select 의 옵션 id 는 뺀다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '메모', type: 'rich_text' },
      { name: '상태', type: 'select' },
    ])
    const optionId = randomUUID()
    await withTransaction((tx) =>
      tx.query(
        `INSERT INTO select_option (id, property_id, name, color, order_idx)
         VALUES ($1, $2, '진행중', 'blue', 'a0')`,
        [optionId, table.prop('상태')],
      ),
    )
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [
          { propertyId: table.prop('메모'), value: { type: 'rich_text', rich_text: [textRun('검색될내용')] } },
          { propertyId: table.prop('상태'), value: { type: 'select', select: { id: optionId } } },
        ],
      }),
    )
    const tsv = (await cacheOf(row.id)).tsv ?? ''
    assert.match(tsv, /검색될내용/)
    // 옵션 id 가 들어가면 사람이 찾을 수 없는 토큰이 색인된다.
    assert.ok(!tsv.includes(optionId.slice(0, 8)), `옵션 id 가 벡터에 들어갔다: ${tsv}`)
  })

  test('★ 셀을 지우면 캐시에서도 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 5 } }],
      }),
    )
    assert.ok((await cacheOf(row.id)).properties_cache[table.prop('수량')] !== undefined)

    // 행을 직접 지운다(프로퍼티 물리 삭제의 CASCADE 와 같은 경로).
    await withTransaction((tx) =>
      tx.query(`DELETE FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [
        row.id,
        table.prop('수량'),
      ]),
    )
    assert.deepEqual((await cacheOf(row.id)).properties_cache, {})
  })
})

describe('★ 제목은 EAV → block 한쪽 방향 투영이다', () => {
  test('★ title 셀을 쓰면 block.properties.title 이 따라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    await updateCells(fx.owner.ctx, row.id, {
      cells: [{ ...titleCell('투영된 제목'), propertyId: table.titleId }],
    })

    const block = await withReadTransaction((tx) =>
      tx.queryOne<{ properties: { title?: unknown } }>(
        `SELECT properties FROM block WHERE id = $1`,
        [row.id],
      ),
    )
    const runs = block.properties.title as { plain_text: string }[]
    assert.equal(runs[0]?.plain_text, '투영된 제목')
  })

  test('★ renamePage 는 DB 행을 거부한다 — 투영이 어긋나지 않게', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ ...titleCell('원래 제목'), propertyId: table.titleId }],
      }),
    )

    await assert.rejects(
      () => renamePage(fx.owner.ctx, row.id as never, titleFromPlainText('우회한 제목')),
      (e: unknown) => e instanceof PageError && e.code === 'not_found',
    )

    // 제목은 그대로다.
    const listed = await listRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.equal(listed.value.rows[0].title, '원래 제목')
  })

  test('일반 페이지의 renamePage 는 계속 동작한다 — 가드가 과하지 않다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { createPage } = await import('../block/page.ts')
    const page = await createPage(fx.owner.ctx, { title: titleFromPlainText('보통 페이지') })
    const renamed = await renamePage(fx.owner.ctx, page.id, titleFromPlainText('바뀐 제목'))
    assert.equal(renamed.plainTitle, '바뀐 제목')
  })
})

describe('updateCells', () => {
  test('여러 셀을 한 번에 쓴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '수량', type: 'number' },
      { name: '완료', type: 'checkbox' },
    ])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const after = unwrapRow(
      await updateCells(fx.owner.ctx, row.id, {
        cells: [
          { propertyId: table.prop('수량'), value: { type: 'number', number: 1 } },
          { propertyId: table.prop('완료'), value: { type: 'checkbox', checkbox: true } },
        ],
      }),
    )
    assert.equal(Object.keys(after.properties).length, 2)
  })

  test('★ block.version 이 오른다 — 검색 색인의 external version (X-6)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const after = unwrapRow(
      await updateCells(fx.owner.ctx, row.id, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 1 } }],
      }),
    )
    assert.ok(BigInt(after.version) > BigInt(row.version), `${row.version} → ${after.version}`)
  })

  test('★ 낙관적 잠금 — 낡은 버전으로 쓰면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    const stale = row.version

    await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 1 } }],
    })

    const r = await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 2 } }],
      expectedVersion: stale,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'version_conflict')
  })

  test('버전을 생략하면 LWW 다 (F-03-16 의 기본값)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    for (const n of [1, 2, 3]) {
      const r = await updateCells(fx.owner.ctx, row.id, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: n } }],
      })
      assert.equal(r.ok, true)
    }
    assert.equal(Number((await sidecarsOf(row.id, table.prop('수량')))?.num_value), 3)
  })

  test('★ 하나가 틀리면 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([
      { name: '수량', type: 'number' },
      { name: '완료', type: 'checkbox' },
    ])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const r = await updateCells(fx.owner.ctx, row.id, {
      cells: [
        { propertyId: table.prop('수량'), value: { type: 'number', number: 1 } },
        // @ts-expect-error — 일부러 틀린 모양
        { propertyId: table.prop('완료'), value: { type: 'checkbox', checkbox: null } },
      ],
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.reason, 'invalid_value')
      assert.ok((r.issues?.length ?? 0) > 0)
    }
    // 앞의 셀도 들어가지 않았다.
    assert.deepEqual((await cacheOf(row.id)).properties_cache, {})
  })

  test('모르는 프로퍼티는 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    const r = await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: 'Zz'.repeat(10) + 'x', value: { type: 'number', number: 1 } }],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'unknown_property')
  })

  test('★ 지운 프로퍼티에는 쓸 수 없다 — 살아있는 스키마만 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    const { deleteProperty } = await import('./property.ts')
    await deleteProperty(fx.owner.ctx, table.dataSourceId, table.prop('수량'))

    const r = await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 1 } }],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'unknown_property')
  })

  test('★ 읽기 전용 프로퍼티는 거부 — 화면만 막으면 API 로 우회된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '외부값', type: 'rich_text' }])
    await withTransaction((tx) =>
      tx.query(`UPDATE property SET writable = 'readonly' WHERE id = $1`, [table.prop('외부값')]),
    )
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const r = await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: table.prop('외부값'), value: { type: 'rich_text', rich_text: [] } }],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'readonly_property')
  })

  test('★ 자동 메타 프로퍼티에는 쓸 수 없다 (불변식 C1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    // 스키마 ENUM 은 24종이므로 MVP 밖 타입을 직접 넣을 수 있다.
    // 같은 DB 를 여러 실행이 공유하므로 id 를 고정하면 두 번째 실행에서 PK 충돌이다.
    const autoId = newPropertyId()
    await withTransaction((tx) =>
      tx.query(
        `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
         VALUES ($1, $2, '만든 날짜', 'created_time', 'z0', now(), now())`,
        [autoId, table.dataSourceId],
      ),
    )
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))

    const r = await updateCells(fx.owner.ctx, row.id, {
      cells: [{ propertyId: autoId, value: { type: 'number', number: 1 } }],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'unknown_property')
  })
})

describe('clearCell', () => {
  test('★ 셀을 비운다 — 행을 지우지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 7 } }],
      }),
    )

    const r = await clearCell(fx.owner.ctx, row.id, table.prop('수량'))
    assert.equal(r.ok, true)
    const s = await sidecarsOf(row.id, table.prop('수량'))
    // 행은 남고 값만 비었다.
    assert.ok(s !== null)
    assert.equal(s?.num_value, null)
    assert.deepEqual(s?.value, { type: 'number', number: null })
  })

  test('★ checkbox 를 비우면 false 가 된다 — 행을 지우면 equals false 에서 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '완료', type: 'checkbox' }])
    const row = unwrapRow(
      await createRow(fx.owner.ctx, table.dataSourceId, {
        cells: [{ propertyId: table.prop('완료'), value: { type: 'checkbox', checkbox: true } }],
      }),
    )
    await clearCell(fx.owner.ctx, row.id, table.prop('완료'))
    assert.equal((await sidecarsOf(row.id, table.prop('완료')))?.bool_value, false)
  })
})

describe('listRows', () => {
  test('★ 템플릿 행은 목록에 없다 (불변식 R1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const normal = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    const template = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    await withTransaction((tx) =>
      tx.query(`UPDATE page SET is_template = true WHERE id = $1`, [template.id]),
    )

    const listed = await listRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.deepEqual(listed.value.rows.map((r) => r.id), [normal.id])
  })

  test('휴지통 행은 목록에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    assert.equal((await trashRow(fx.owner.ctx, row.id)).ok, true)

    const listed = await listRows(fx.owner.ctx, table.dataSourceId)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.equal(listed.value.rows.length, 0)
  })

  test('★ 커서로 끝까지 읽으면 중복·누락이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const made = new Set<string>()
    for (let i = 0; i < 7; i += 1) made.add(unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId)).id)

    const seen: string[] = []
    let after: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const r = await listRows(fx.owner.ctx, table.dataSourceId, { limit: 3, after })
      assert.equal(r.ok, true)
      if (!r.ok) break
      seen.push(...r.value.rows.map((x) => x.id))
      after = r.value.nextCursor
      if (after === null) break
    }
    assert.equal(seen.length, 7)
    assert.deepEqual(new Set(seen), made)
  })
})

describe('★ 권한', () => {
  const makePrivate = async (databaseId: string): Promise<void> => {
    assert.equal((await stopInheriting(fx.owner.ctx, databaseId)).ok, true)
    assert.equal(
      (await grantAccess(fx.owner.ctx, databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok,
      true,
    )
    assert.equal(
      (await revokeAccess(fx.owner.ctx, databaseId, { type: 'workspace_everyone', id: null })).ok,
      true,
    )
  }

  test('★ 볼 수 없으면 행도 셀도 보이지 않고 존재도 알 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable()
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    await makePrivate(table.databaseId)

    for (const r of [
      await listRows(other.ctx, table.dataSourceId),
      await createRow(other.ctx, table.dataSourceId),
      await updateCells(other.ctx, row.id, { cells: [] }),
      await trashRow(other.ctx, row.id),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'not_found')
    }
  })

  test('★ 볼 수만 있으면 셀을 쓸 수 없다 (edit_content)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    await makePrivate(table.databaseId)
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: other.userId }, 'view')).ok,
      true,
    )

    // 읽기는 된다.
    assert.equal((await listRows(other.ctx, table.dataSourceId)).ok, true)

    for (const r of [
      await createRow(other.ctx, table.dataSourceId),
      await updateCells(other.ctx, row.id, {
        cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 1 } }],
      }),
      await trashRow(other.ctx, row.id),
    ]) {
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.reason, 'forbidden')
    }
  })

  test('edit 레벨이면 셀을 쓸 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable([{ name: '수량', type: 'number' }])
    const row = unwrapRow(await createRow(fx.owner.ctx, table.dataSourceId))
    await makePrivate(table.databaseId)
    assert.equal(
      (await grantAccess(fx.owner.ctx, table.databaseId, { type: 'user', id: other.userId }, 'edit')).ok,
      true,
    )

    const r = await updateCells(other.ctx, row.id, {
      cells: [{ propertyId: table.prop('수량'), value: { type: 'number', number: 1 } }],
    })
    assert.equal(r.ok, true)
  })
})
