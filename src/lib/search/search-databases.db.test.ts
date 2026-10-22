/**
 * 데이터베이스 자신의 이름 색인 — 플랫폼 잔여 10p-2 (F-07-01)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 데이터베이스 자신의 이름 색인
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 데이터베이스를 이름으로 찾는다 — 한국어 · 라틴 두 축 · 결과의 종류는 데이터베이스 · 경로는 비어 있다
 *   ② ★ 이름을 바꾸면 새 이름으로 찾고 옛 이름으로는 찾지 않는다(`renameDatabase` 가 같은 트랜잭션에서 색인을 쓴다)
 *   ③ 결과의 아이콘은 `database.icon` 이다
 *   ④ ★ 권한 — 상속을 끊은 데이터베이스 · 남의 개인 최상위 데이터베이스는 다른 사람의 검색에 없다
 *   ⑤ ★ `@` 후보에는 데이터베이스가 없다(칩이 열지 못한다 — ⑤) · 그 행은 그대로 있다
 *   ⑥ 필터만의 검색(내가 만든)에도 선다
 *   ⑦ ★ 마이그레이션 0108 의 백필 — 색인 행이 없는 데이터베이스에 행을 만들고 이름을 채운다 · 배열이 아닌 제목은 NULL ·
 *      이미 있는 행은 건드리지 않는다
 */

import { readFileSync } from 'node:fs'
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { type Actor, type Fixture, createUser, joinAs, makeFixture, probeDatabase } from '../testing/db-fixtures.ts'
import { createDatabase, renameDatabase, setDatabaseIcon } from '../database/database.ts'
import { getSchema } from '../database/property.ts'
import { createRow } from '../database/row.ts'
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

const newDatabase = async (name: string, input: { privateTop?: boolean } = {}): Promise<{ id: string; dataSourceId: string }> => {
  const created = await createDatabase(fx.owner.ctx, { name, ...input })
  assert.equal(created.ok, true, `데이터베이스 만들기 실패: ${created.ok === false ? created.reason : ''}`)
  if (!created.ok) throw new Error('unreachable')
  return { id: created.value.id, dataSourceId: created.value.dataSourceId }
}

/** 결과 — 검색이 거부되면 실패. */
const hitsOf = async (actor: Actor, q: string, filters?: Parameters<typeof searchPages>[1]['filters']) => {
  const out = await searchPages(actor.ctx, { query: q, ...(filters === undefined ? {} : { filters }) })
  assert.equal(out.ok, true, `검색이 거부됐다: ${out.ok === false ? out.reason : ''}`)
  return out.ok ? out.results.results : []
}
const idsOf = async (actor: Actor, q: string) => (await hitsOf(actor, q)).map((h) => h.pageId)

/** 노드를 소유자만 보게 한다(search-rows.db.test.ts 의 `makePrivate` 와 같다 — 순서가 중요하다). */
const makePrivate = async (nodeId: string): Promise<void> => {
  const cut = await stopInheriting(fx.owner.ctx, nodeId)
  assert.equal(cut.ok, true, `stopInheriting 실패: ${cut.ok === false ? cut.reason : ''}`)
  const granted = await grantAccess(fx.owner.ctx, nodeId, { type: 'user', id: fx.owner.userId }, 'full_access')
  assert.equal(granted.ok, true, `grantAccess 실패: ${granted.ok === false ? granted.reason : ''}`)
  const revoked = await revokeAccess(fx.owner.ctx, nodeId, { type: 'workspace_everyone', id: null })
  assert.equal(revoked.ok, true, `revokeAccess 실패: ${revoked.ok === false ? revoked.reason : ''}`)
}

describe('데이터베이스 자신의 이름 색인 (10p-2)', () => {
  test('★ ① 데이터베이스를 이름으로 찾는다 — 한국어 · 라틴 두 축 · 종류는 데이터베이스 · 경로는 비어 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const korean = await newDatabase(`분기예산표 ${stamp}`)
    const latin = await newDatabase(`Budget${stamp} board`)

    const hits = await hitsOf(fx.owner, `분기예산표 ${stamp}`)
    assert.deepEqual(hits.map((h) => [h.pageId, h.kind]), [[korean.id, 'database']], '한국어 축(pg_bigm)')
    assert.equal(hits[0]!.title, `분기예산표 ${stamp}`)
    assert.equal(hits[0]!.titleHit, true)
    assert.deepEqual(hits[0]!.breadcrumb, [], '데이터베이스는 최상위에만 선다')
    assert.equal(hits[0]!.snippet, '', '본문이 없다')
    assert.deepEqual(await idsOf(fx.owner, `Budget${stamp}`), [latin.id], '라틴 축(tsvector)')
    assert.deepEqual(await idsOf(other, `분기예산표 ${stamp}`), [korean.id], '볼 수 있는 다른 멤버도')
  })

  test('★ ② 이름을 바꾸면 새 이름으로 찾고 옛 이름으로는 찾지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const db = await newDatabase(`옛표이름 ${stamp}`)
    const renamed = await renameDatabase(fx.owner.ctx, db.id, `새표이름 ${stamp}`)
    assert.equal(renamed.ok, true, `이름 바꾸기 실패: ${renamed.ok === false ? renamed.reason : ''}`)

    assert.deepEqual(await idsOf(fx.owner, `새표이름 ${stamp}`), [db.id])
    assert.deepEqual(await idsOf(fx.owner, `옛표이름 ${stamp}`), [], '옛 이름은 색인에 남지 않는다')
  })

  test('③ 결과의 아이콘은 database.icon 이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const db = await newDatabase(`아이콘표 ${stamp}`)
    const set = await setDatabaseIcon(fx.owner.ctx, db.id, { type: 'emoji', emoji: '📊' })
    assert.equal(set.ok, true, `아이콘 바꾸기 실패: ${set.ok === false ? set.reason : ''}`)

    const hits = await hitsOf(fx.owner, `아이콘표 ${stamp}`)
    assert.deepEqual(hits.map((h) => h.icon), [{ type: 'emoji', emoji: '📊' }])
  })

  test('★ ④ 권한 — 상속을 끊은 데이터베이스 · 남의 개인 최상위 데이터베이스는 다른 사람의 검색에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const secret = await newDatabase(`비밀예산표 ${stamp}`)
    await makePrivate(secret.id)
    assert.deepEqual(await idsOf(fx.owner, `비밀예산표 ${stamp}`), [secret.id], '소유자는 찾는다')
    assert.deepEqual(await idsOf(other, `비밀예산표 ${stamp}`), [], '볼 수 없는 데이터베이스는 결과에 없다')

    const mine = await newDatabase(`개인독서표 ${stamp}`, { privateTop: true })
    assert.deepEqual(await idsOf(fx.owner, `개인독서표 ${stamp}`), [mine.id], '주인은 찾는다')
    assert.deepEqual(await idsOf(other, `개인독서표 ${stamp}`), [], '남의 개인 최상위 데이터베이스는 없다')
  })

  test('★ ⑤ @ 후보에는 데이터베이스가 없다 — 그 행은 그대로 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const db = await newDatabase(`출장표 ${stamp}`)
    const schema = await getSchema(fx.owner.ctx, db.dataSourceId)
    assert.equal(schema.ok, true)
    if (!schema.ok) throw new Error('unreachable')
    const titleId = schema.value.properties.find((p) => p.type === 'title')!.id
    const row = await createRow(fx.owner.ctx, db.dataSourceId, {
      cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(`출장표 ${stamp} 행`)] } }],
    })
    assert.equal(row.ok, true, `행 만들기 실패: ${row.ok === false ? row.reason : ''}`)
    if (!row.ok) throw new Error('unreachable')

    assert.deepEqual((await idsOf(fx.owner, `출장표 ${stamp}`)).sort(), [db.id, row.value.id].sort(), '전역 검색에는 둘 다')
    const candidates = await searchMentionCandidates(fx.owner.ctx, `출장표 ${stamp}`)
    assert.deepEqual(candidates.filter((c) => c.kind === 'page').map((c) => c.id), [row.value.id], '@ 후보에는 행만')
  })

  test('⑥ 필터만의 검색(내가 만든)에도 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const db = await newDatabase(`필터표 ${stamp}`)
    const mine = await hitsOf(fx.owner, '', { createdBy: 'me', edited: 'day' })
    assert.ok(mine.some((h) => h.pageId === db.id && h.kind === 'database'), '내가 오늘 만든 데이터베이스')
    const theirs = await hitsOf(other, '', { createdBy: 'me', edited: 'day' })
    assert.ok(!theirs.some((h) => h.pageId === db.id), '다른 사람이 만든 것에는 없다')
  })

  test('★ ⑦ 마이그레이션 0108 의 백필 — 색인 행이 없는 데이터베이스에 만들고 이름을 채운다 · 배열이 아닌 제목은 NULL · 있는 행은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stamp = Date.now().toString(36)
    const missing = await newDatabase(`백필표 ${stamp}`)
    const odd = await newDatabase(`모양이다른표 ${stamp}`)
    const kept = await newDatabase(`그대로표 ${stamp}`)
    // 0108 전의 모양 — 데이터베이스에는 색인 행이 없다. 하나는 블록의 제목이 배열이 아니다(옛 모양 — 질의 전체가 던지면 안 된다).
    // 하나는 색인 행이 이미 있고 제목이 다르다(덮지 않는다)
    await query(`DELETE FROM search_document WHERE doc_id = ANY($1::uuid[])`, [[missing.id, odd.id]])
    await query(`UPDATE block SET properties = jsonb_set(properties, '{title}', '"평문 제목"'::jsonb) WHERE id = $1`, [odd.id])
    await query(`UPDATE search_document SET title_text = $2 WHERE doc_id = $1`, [kept.id, `앱이쓴이름 ${stamp}`])
    assert.deepEqual(await idsOf(fx.owner, `백필표 ${stamp}`), [], '지운 뒤에는 찾지 못한다(전제)')

    // 0108 전체는 다시 돌 수 없다(옛 CHECK 을 뗀다) — 백필 문장만 꺼내 돌린다
    const sql = readFileSync(new URL('../../../db/migrations/0108_search_database_names.sql', import.meta.url), 'utf8')
    const end = 'ON CONFLICT (doc_id) DO NOTHING;'
    const backfill = sql.slice(sql.indexOf('INSERT INTO search_document'), sql.indexOf(end) + end.length)
    assert.ok(backfill.startsWith('INSERT INTO search_document') && backfill.endsWith(end), '백필 문장을 찾았다')
    await query(backfill)

    assert.deepEqual(await idsOf(fx.owner, `백필표 ${stamp}`), [missing.id], '만든 뒤에는 찾는다')
    const rows = await query<{ doc_id: string; title_text: string | null; perm_scope_id: string }>(
      `SELECT doc_id, title_text, perm_scope_id FROM search_document WHERE doc_id = ANY($1::uuid[])`,
      [[odd.id, kept.id]],
    )
    const byId = new Map(rows.map((r) => [r.doc_id, r]))
    assert.equal(byId.get(odd.id)?.title_text, null, '배열이 아닌 제목은 NULL — 행은 만든다')
    assert.equal(byId.get(odd.id)?.perm_scope_id, odd.id, '메타는 블록에서')
    assert.equal(byId.get(kept.id)?.title_text, `앱이쓴이름 ${stamp}`, '이미 있는 행은 덮지 않는다')
  })
})
