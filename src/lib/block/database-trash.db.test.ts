/**
 * 풀페이지 데이터베이스의 휴지통 (28번 트랙 T-1 · F-02-11 · F-11-05 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 T-1]
 *
 *   ① ★ 최상위 데이터베이스를 버린다 — 블록 · 행이 같은 삭제 루트로 · 사이드바 · 데이터베이스 화면에서 사라지고 휴지통 목록에(아이콘은 데이터베이스의 것)
 *   ② ★ 되살린다 — 원래 자리 그대로 · 행도 · 따로 먼저 버린 행은 휴지통에 남는다(B3)
 *   ③ 영구 삭제 — purged · 목록에서 사라진다
 *   ④ ★ 권한 — 볼 수만 있으면 forbidden · 볼 수 없으면 not_found(있는지 알리지 않는다)
 *   ⑤ ★ 부모가 사라져 최상위로 되살아난 인라인 데이터베이스(B4)도 다시 버린다 — 전에는 막혔다
 *   ⑥ 개인 최상위 데이터베이스도
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { listPageTree } from './page-tree.ts'
import { listTrash, purgePage, restorePage, trashPage, TrashError } from './trash.ts'
import { createDatabase, createInlineDatabase, getDatabase, setDatabaseIcon } from '../database/database.ts'
import { getSchema } from '../database/property.ts'
import { createRow, trashRow } from '../database/row.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

async function table(name: string, options: { privateTop?: boolean } = {}) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name, ...options }))
  const titleId = unwrap(await getSchema(fx.owner.ctx, created.dataSourceId)).properties.find((p) => p.type === 'title')!.id
  const row = async (title: string) =>
    unwrap(await createRow(fx.owner.ctx, created.dataSourceId, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
  return { id: created.id, ds: created.dataSourceId, row }
}

const stateOf = async (id: string) =>
  (await query<{ lifecycle: string; trash_root_id: string | null; parent_type: string }>(
    `SELECT lifecycle, trash_root_id, parent_type FROM block WHERE id = $1`, [id]))[0]

const inTree = async (actor: Actor, id: string): Promise<boolean> => {
  const walk = (nodes: readonly { id: string; children: readonly unknown[] }[]): boolean =>
    nodes.some((n) => n.id === id || walk(n.children as never))
  return walk((await listPageTree(actor.ctx)) as never)
}

describe('① 버리기', () => {
  test('★ 블록 · 행이 같은 삭제 루트로 · 사이드바 · 데이터베이스 화면에서 사라지고 휴지통 목록에', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await table(unique('버릴 표'))
    assert.equal((await setDatabaseIcon(fx.owner.ctx, db.id, { type: 'emoji', emoji: '📦' })).ok, true)
    const row = await db.row('가')
    assert.equal(await inTree(fx.owner, db.id), true, '전제 — 사이드바에 있다')

    const result = await trashPage(fx.owner.ctx, db.id as never)
    assert.equal(result.trashedDescendants >= 1, true, '행이 함께 간다')
    assert.deepEqual(await stateOf(db.id), { lifecycle: 'trashed', trash_root_id: db.id, parent_type: 'workspace' })
    assert.equal((await stateOf(row))?.trash_root_id, db.id, '행도 같은 삭제 루트')
    assert.equal(await inTree(fx.owner, db.id), false, '사이드바에서 사라진다')
    assert.deepEqual(await getDatabase(fx.owner.ctx, db.id), { ok: false, reason: 'not_found' }, '데이터베이스 화면에서 사라진다')

    const entry = (await listTrash(fx.owner.ctx)).find((e) => e.id === db.id)
    assert.ok(entry !== undefined, '휴지통 목록에')
    assert.equal(entry.kind, 'page')
    assert.deepEqual(entry.icon, { type: 'emoji', emoji: '📦' }, '아이콘은 데이터베이스의 것')
  })
})

describe('② 되살리기', () => {
  test('★ 원래 자리 그대로 · 행도 · 따로 먼저 버린 행은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await table(unique('되살릴 표'))
    const kept = await db.row('함께')
    const alone = await db.row('먼저')
    assert.equal((await trashRow(fx.owner.ctx, alone)).ok, true)
    await trashPage(fx.owner.ctx, db.id as never)

    const restored = await restorePage(fx.owner.ctx, db.id as never)
    assert.equal(restored.reparented, false, '최상위는 B4 가 걸리지 않는다')
    assert.deepEqual(await stateOf(db.id), { lifecycle: 'live', trash_root_id: null, parent_type: 'workspace' })
    assert.equal((await stateOf(kept))?.lifecycle, 'live')
    assert.equal((await stateOf(alone))?.lifecycle, 'trashed', '따로 먼저 버린 행은 휴지통에 남는다(B3)')
    assert.equal(await inTree(fx.owner, db.id), true)
    assert.equal((await getDatabase(fx.owner.ctx, db.id)).ok, true)
  })
})

describe('③ 영구 삭제', () => {
  test('purged · 목록에서 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await table(unique('지울 표'))
    await db.row('가')
    await trashPage(fx.owner.ctx, db.id as never)
    await purgePage(fx.owner.ctx, db.id as never)
    assert.equal((await stateOf(db.id))?.lifecycle, 'purged')
    assert.equal((await listTrash(fx.owner.ctx)).some((e) => e.id === db.id), false)
  })
})

describe('④ 권한', () => {
  test('★ 볼 수만 있으면 forbidden · 볼 수 없으면 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await table(unique('권한 표'))
    assert.equal((await stopInheriting(fx.owner.ctx, db.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, db.id, { type: 'workspace_everyone', id: null })).ok, true)
    const codeOf = async (run: () => Promise<unknown>) => {
      try {
        await run()
        return 'ok'
      } catch (e) {
        return e instanceof TrashError ? e.code : String(e)
      }
    }
    assert.equal(await codeOf(() => trashPage(other.ctx, db.id as never)), 'not_found', '볼 수 없다')
    assert.equal((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: other.userId }, 'view')).ok, true)
    assert.equal(await codeOf(() => trashPage(other.ctx, db.id as never)), 'forbidden', '볼 수만 있다')
    assert.equal((await stateOf(db.id))?.lifecycle, 'live')
  })
})

describe('⑤ B4 로 최상위가 된 인라인 데이터베이스', () => {
  test('★ 부모가 사라져 최상위로 되살아난 데이터베이스도 다시 버린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const host = (await createPage(fx.owner.ctx, { title: titleFromPlainText(unique('사라질 호스트')) })).id
    const db = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: host, name: '본문의 표' }))
    await trashPage(fx.owner.ctx, db.id as never)
    await trashPage(fx.owner.ctx, host)
    await purgePage(fx.owner.ctx, host)
    const back = await restorePage(fx.owner.ctx, db.id as never)
    assert.equal(back.reparented, true, '전제 — 부모가 없어 최상위로')
    assert.equal((await stateOf(db.id))?.parent_type, 'workspace')

    await trashPage(fx.owner.ctx, db.id as never)
    assert.equal((await stateOf(db.id))?.lifecycle, 'trashed', '다시 버린다')
  })
})

describe('⑥ 개인 최상위', () => {
  test('개인 최상위 데이터베이스도 버리고 되살린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = await table(unique('개인 표'), { privateTop: true })
    await trashPage(fx.owner.ctx, db.id as never)
    assert.equal((await stateOf(db.id))?.lifecycle, 'trashed')
    await restorePage(fx.owner.ctx, db.id as never)
    assert.equal((await stateOf(db.id))?.lifecycle, 'live')
    assert.equal(await inTree(fx.owner, db.id), true)
  })
})
