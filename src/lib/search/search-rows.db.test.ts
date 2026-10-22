/**
 * 데이터베이스 행의 제목 색인 — 플랫폼 잔여 10p-1 (F-07-01)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 데이터베이스 행의 제목 색인
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 행을 이름으로 찾는다 — 만들 때(한국어 · 라틴 두 축) · 결과의 경로에 데이터베이스가 선다
 *   ② ★ 이름을 바꾸면 새 이름으로 찾고 옛 이름으로는 찾지 않는다(셀 고치기가 색인을 같은 트랜잭션에서 쓴다)
 *   ③ ★ 템플릿 행은 나오지 않는다 — 전역 검색 · 필터만의 검색 · `@` 후보(R1)
 *   ④ ★ 권한 — 볼 수 없는 데이터베이스의 행 · 상속을 끊어 빠진 행은 다른 사람의 검색에 없다
 *   ⑤ `@` 후보에 행이 선다(행도 페이지다)
 *   ⑥ ★ 마이그레이션 0107 의 백필 — 비어 있는 색인 제목을 채운다 · 배열이 아닌 제목은 건너뛴다(질의가 던지지 않는다)
 */

import { readFileSync } from 'node:fs'
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { type Actor, type Fixture, createUser, joinAs, makeFixture, probeDatabase } from '../testing/db-fixtures.ts'
import { createDatabase } from '../database/database.ts'
import { getSchema } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { searchMentionCandidates } from '../block/mention-candidates.ts'
import { textRun } from '../contracts/rich-text.ts'
import { searchPages } from './search.ts'

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

type Table = { databaseId: string; dataSourceId: string; titleId: string }

const newTable = async (name: string): Promise<Table> => {
  const created = await createDatabase(fx.owner.ctx, { name })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('unreachable')
  const schema = await getSchema(fx.owner.ctx, created.value.dataSourceId)
  assert.equal(schema.ok, true)
  if (!schema.ok) throw new Error('unreachable')
  return {
    databaseId: created.value.id,
    dataSourceId: created.value.dataSourceId,
    titleId: schema.value.properties.find((p) => p.type === 'title')!.id,
  }
}

const titleCell = (propertyId: string, text: string) => ({ propertyId, value: { type: 'title' as const, title: [textRun(text)] } })

const newRow = async (table: Table, title: string): Promise<string> => {
  const made = await createRow(fx.owner.ctx, table.dataSourceId, { cells: [titleCell(table.titleId, title)] })
  assert.equal(made.ok, true, `행 만들기 실패: ${made.ok === false ? made.reason : ''}`)
  if (!made.ok) throw new Error('unreachable')
  return made.value.id
}

/** 결과의 (id · 경로) — 검색이 거부되면 실패. */
const hitsOf = async (actor: Actor, query: string, filters?: Parameters<typeof searchPages>[1]['filters']) => {
  const out = await searchPages(actor.ctx, { query, ...(filters === undefined ? {} : { filters }) })
  assert.equal(out.ok, true, `검색이 거부됐다: ${out.ok === false ? out.reason : ''}`)
  return out.ok ? out.results.results : []
}
const idsOf = async (actor: Actor, query: string) => (await hitsOf(actor, query)).map((h) => h.pageId)
/**
 * 맞는 결과만 — 오타 대체(10p-3)의 결과는 빈 목록으로 본다. "옛 이름 · 비운 색인으로는 맞는 것이 없다" 를 물을 때 쓴다(대체는 비슷한 제목을
 * 보여 줄 수 있다 — 그 결과는 이름이 걸린 것이 아니다).
 */
const exactIdsOf = async (actor: Actor, q: string) => {
  const out = await searchPages(actor.ctx, { query: q })
  assert.equal(out.ok, true, `검색이 거부됐다: ${out.ok === false ? out.reason : ''}`)
  return out.ok && !out.fuzzy ? out.results.results.map((h) => h.pageId) : []
}

/** 데이터베이스를 소유자만 보게 한다 — 순서가 중요하다(search.db.test.ts 의 `makePrivate` 와 같다). 셋 다 단언한다. */
const makePrivate = async (nodeId: string): Promise<void> => {
  const cut = await stopInheriting(fx.owner.ctx, nodeId)
  assert.equal(cut.ok, true, `stopInheriting 실패: ${cut.ok === false ? cut.reason : ''}`)
  const granted = await grantAccess(fx.owner.ctx, nodeId, { type: 'user', id: fx.owner.userId }, 'full_access')
  assert.equal(granted.ok, true, `grantAccess 실패: ${granted.ok === false ? granted.reason : ''}`)
  const revoked = await revokeAccess(fx.owner.ctx, nodeId, { type: 'workspace_everyone', id: null })
  assert.equal(revoked.ok, true, `revokeAccess 실패: ${revoked.ok === false ? revoked.reason : ''}`)
}

describe('데이터베이스 행의 제목 색인 (10p-1)', () => {
  test('★ ① 행을 이름으로 찾는다 — 한국어 · 라틴 두 축 · 경로에 데이터베이스가 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const table = await newTable(`과제 표 ${stamp}`)
    const korean = await newRow(table, `분기보고서 ${stamp}`)
    const latin = await newRow(table, `Roadmap${stamp} draft`)

    const hits = await hitsOf(fx.owner, `분기보고서 ${stamp}`)
    assert.deepEqual(hits.map((h) => h.pageId), [korean], '한국어 축(pg_bigm)')
    assert.equal(hits[0]!.title, `분기보고서 ${stamp}`)
    assert.equal(hits[0]!.titleHit, true)
    assert.deepEqual(hits[0]!.breadcrumb.map((b) => b.id), [table.databaseId], '경로는 데이터베이스')
    assert.deepEqual(await idsOf(fx.owner, `Roadmap${stamp}`), [latin], '라틴 축(tsvector)')
    assert.deepEqual(await idsOf(other, `분기보고서 ${stamp}`), [korean], '데이터베이스를 볼 수 있는 다른 멤버도')
  })

  test('★ ② 이름을 바꾸면 새 이름으로 찾고 옛 이름으로는 찾지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const table = await newTable(`이름 표 ${stamp}`)
    const row = await newRow(table, `옛이름행 ${stamp}`)
    const renamed = await updateCells(fx.owner.ctx, row, { cells: [titleCell(table.titleId, `새이름행 ${stamp}`)] })
    assert.equal(renamed.ok, true, `셀 고치기 실패: ${renamed.ok === false ? renamed.reason : ''}`)

    assert.deepEqual(await idsOf(fx.owner, `새이름행 ${stamp}`), [row])
    assert.deepEqual(await exactIdsOf(fx.owner, `옛이름행 ${stamp}`), [], '옛 이름은 색인에 남지 않는다(맞는 결과가 없다)')
  })

  test('★ ③ 템플릿 행은 나오지 않는다 — 전역 검색 · 필터만의 검색 · @ 후보(R1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const table = await newTable(`템플릿 표 ${stamp}`)
    const row = await newRow(table, `주간회의 ${stamp}`)
    const template = await createTemplate(fx.owner.ctx, table.dataSourceId, { title: `주간회의 틀 ${stamp}` })
    assert.equal(template.ok, true, `템플릿 만들기 실패: ${template.ok === false ? template.reason : ''}`)
    if (!template.ok) throw new Error('unreachable')

    assert.deepEqual(await idsOf(fx.owner, `주간회의 ${stamp}`), [row], '이름이 겹쳐도 템플릿은 빠진다')
    assert.ok(!(await idsOf(fx.owner, `주간회의 틀 ${stamp}`)).includes(template.value.id), '템플릿은 오타 대체에도 없다')
    // 필터만의 검색(10a-1 ③) — 내가 만든 모든 것에도 템플릿은 없다
    const mine = (await hitsOf(fx.owner, '', { createdBy: 'me' })).map((h) => h.pageId)
    assert.ok(mine.includes(row), '내가 만든 행은 있다')
    assert.ok(!mine.includes(template.value.id), '템플릿은 없다')
    const mention = await searchMentionCandidates(fx.owner.ctx, `주간회의 틀 ${stamp}`)
    assert.deepEqual(mention.filter((c) => c.kind === 'page').map((c) => c.id), [], '@ 후보에도 없다')
  })

  test('★ ④ 권한 — 볼 수 없는 데이터베이스의 행 · 상속을 끊어 빠진 행은 다른 사람의 검색에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const secret = await newTable(`비밀 표 ${stamp}`)
    const hidden = await newRow(secret, `연봉협상 ${stamp}`)
    await makePrivate(secret.databaseId)
    assert.deepEqual(await idsOf(fx.owner, `연봉협상 ${stamp}`), [hidden], '소유자는 찾는다')
    assert.ok(!(await idsOf(other, `연봉협상 ${stamp}`)).includes(hidden), '볼 수 없는 데이터베이스의 행은 없다(오타 대체에도)')

    const open = await newTable(`열린 표 ${stamp}`)
    const visible = await newRow(open, `인사평가 공개 ${stamp}`)
    const cut = await newRow(open, `인사평가 비공개 ${stamp}`)
    await makePrivate(cut)
    assert.deepEqual((await idsOf(fx.owner, `인사평가 ${stamp}`)).sort(), [visible, cut].sort())
    assert.deepEqual(await idsOf(other, `인사평가 ${stamp}`), [visible], '끊어 빠진 행은 데이터베이스를 볼 수 있어도 없다')
  })

  test('★ ⑥ 마이그레이션 0107 의 백필 — 비어 있는 색인 제목을 블록의 제목으로 채운다 · 배열이 아닌 제목은 건너뛴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const table = await newTable(`백필 표 ${stamp}`)
    const row = await newRow(table, `백필행 ${stamp}`)
    const odd = await newRow(table, `모양이 다른 ${stamp}`)
    // 0107 전의 모양 — 색인의 제목이 비어 있다. 하나는 블록의 제목이 배열이 아니다(옛 모양) — 질의 전체가 던지면 안 된다
    await query(`UPDATE search_document SET title_text = NULL WHERE doc_id = ANY($1::uuid[])`, [[row, odd]])
    await query(`UPDATE block SET properties = jsonb_set(properties, '{title}', '"평문 제목"'::jsonb) WHERE id = $1`, [odd])
    assert.deepEqual(await exactIdsOf(fx.owner, `백필행 ${stamp}`), [], '비운 뒤에는 찾지 못한다(전제 — 맞는 결과가 없다)')

    const sql = readFileSync(new URL('../../../db/migrations/0107_search_row_titles.sql', import.meta.url), 'utf8')
    await query(sql)
    assert.deepEqual(await idsOf(fx.owner, `백필행 ${stamp}`), [row], '채운 뒤에는 찾는다')
    const left = await query<{ title_text: string | null }>(`SELECT title_text FROM search_document WHERE doc_id = $1`, [odd])
    assert.equal(left[0]?.title_text, null, '배열이 아닌 제목은 건너뛴다')
  })

  test('⑤ @ 후보에 행이 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const table = await newTable(`멘션 표 ${stamp}`)
    const row = await newRow(table, `출장계획 ${stamp}`)
    const candidates = await searchMentionCandidates(fx.owner.ctx, `출장계획 ${stamp}`)
    assert.deepEqual(candidates.filter((c) => c.kind === 'page').map((c) => [c.id, c.label]), [[row, `출장계획 ${stamp}`]])
  })
})
