/**
 * TS 의 capability 매트릭스와 DB 의 level_capability 테이블이 일치하는지 확인한다.
 *
 * 같은 사실이 두 곳에 있으면 반드시 어긋난다. DB 는 정본 저장소이고
 * TS 상수는 판정 경로의 빠른 길인데, 둘이 갈라지면 "SQL 로 필터한 결과"와
 * "코드로 판정한 결과"가 달라진다. 그건 권한 버그다.
 *
 * DB 가 없으면 건너뛴다. 단 CI 처럼 REQUIRE_DB=1 인 환경에서는 실패시킨다 —
 * 조용히 건너뛰기만 하면 이 테스트는 썩는다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

import {
  CAPABILITIES,
  capabilityList,
  capabilitiesOf,
  isDefinedLevel,
  LEVELS,
  TARGET_KINDS,
  type Capability,
  type Level,
  type TargetKind,
} from './levels.ts'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://notion:notion_dev_only@localhost:5432/notion'
const REQUIRE_DB = process.env.REQUIRE_DB === '1'

type Row = Record<string, boolean | string>

let client: pg.Client | null = null
let dbRows: Row[] | null = null
let skipReason = ''

before(async () => {
  const c = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 })
  try {
    await c.connect()
    const { rows } = await c.query<Row>('SELECT * FROM level_capability')
    client = c
    dbRows = rows
  } catch (e) {
    await c.end().catch(() => {})
    skipReason = `DB 접속/조회 실패: ${(e as Error).message.split('\n')[0]}`
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  await client?.end().catch(() => {})
})

const CAP_COLUMN: Record<Capability, string> = {
  view: 'cap_view',
  comment: 'cap_comment',
  edit_content: 'cap_edit_content',
  create_child: 'cap_create_child',
  edit_structure: 'cap_edit_structure',
  share: 'cap_share',
  manage_perm: 'cap_manage_perm',
}

describe('level_capability — DB 와 TS 매트릭스 일치', () => {
  test('행 집합이 정확히 같다', (t) => {
    if (!dbRows) return t.skip(skipReason)

    const dbKeys = new Set(dbRows.map((r) => `${r.target_kind}/${r.level}`))
    const tsKeys = new Set<string>()
    for (const tk of TARGET_KINDS) {
      for (const lv of LEVELS) {
        if (isDefinedLevel(tk, lv)) tsKeys.add(`${tk}/${lv}`)
      }
    }

    const onlyDb = [...dbKeys].filter((k) => !tsKeys.has(k)).sort()
    const onlyTs = [...tsKeys].filter((k) => !dbKeys.has(k)).sort()

    assert.deepEqual(onlyDb, [], `DB 에만 있는 조합: ${onlyDb.join(', ')}`)
    assert.deepEqual(onlyTs, [], `TS 에만 있는 조합: ${onlyTs.join(', ')}`)
  })

  test('각 행의 capability 값이 모두 같다', (t) => {
    if (!dbRows) return t.skip(skipReason)

    for (const row of dbRows) {
      const tk = row.target_kind as TargetKind
      const lv = row.level as Level
      const tsCaps = new Set(capabilityList(capabilitiesOf(tk, lv)))

      for (const cap of CAPABILITIES) {
        const dbValue = row[CAP_COLUMN[cap]] === true
        const tsValue = tsCaps.has(cap)
        assert.equal(
          tsValue,
          dbValue,
          `(${tk}, ${lv}).${cap} — DB=${dbValue} TS=${tsValue}`,
        )
      }
    }
  })

  test('DB 에서도 database/create 는 view 가 false 다', (t) => {
    if (!dbRows) return t.skip(skipReason)

    const row = dbRows.find((r) => r.target_kind === 'database' && r.level === 'create')
    assert.ok(row, 'database/create 행이 없다')
    assert.equal(row.cap_view, false, '규칙 A2 의 근거가 DB 에서 무너졌다')
    assert.equal(row.cap_create_child, true)
  })
})
