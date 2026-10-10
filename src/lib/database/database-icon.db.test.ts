/**
 * 데이터베이스 자신의 아이콘 — 잔여 묶음 8c-3b (F-02-05 · DB)
 *
 * 자리는 정본의 `database.icon` 이다(0038 — 블록의 `format.page_icon` 은 페이지 행만 갖는다 · 0037). 모양 · 받기 규칙은 페이지
 * 아이콘과 같고, 고치는 사람은 이름과 같다(`edit_structure` · 데이터베이스 잠금).
 *
 *   ① ★ 바꾸기 · 지우기 — 같은 아이콘이면 쓰지 않는다 · 지우면 SQL NULL · 받기는 페이지와 같은 규칙(앞뒤 공백 · type 생략 · 두 글자 거부)
 *   ② ★ 누가 — 구조를 고칠 수 있는 사람만(볼 수만 있으면 · **내용 편집이면** forbidden · 못 보면 not_found) · 잠기면 locked ·
 *      페이지 id 는 not_found. "내용 편집"(`edit_content` 레벨)은 6f-1 부터 줄 수 있다 — `edit_structure` 를 가려내는 것은 그 레벨이다
 *   ③ ★ 읽는 길 — 화면(`getDatabase`) · 사이드바 트리 · 관계형의 대상 목록 · teamspace 화면 · 멘션의 이름 맵(볼 수 있을 때만)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setDatabaseLock } from '../permissions/lock.ts'
import { createPage, setPageIcon } from '../block/page.ts'
import { listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { loadMentionLabels } from '../block/mention-candidates.ts'
import type { PageIcon } from '../block/page-icon.ts'
import { createTeamspace } from '../workspace/teamspace.ts'
import { createDatabase, getDatabase, listDatabases, listTeamspaceDatabases, renameDatabase, setDatabaseIcon } from './database.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let mate: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  mate = await joinAs(fx.workspaceId, await createUser('표 아이콘 동료'), 'member')
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
const emoji = (e: string): PageIcon => ({ type: 'emoji', emoji: e })

/** 저장된 그대로 — SQL NULL 과 JSON null 을 가른다(`icon IS NULL`). */
async function stored(databaseId: string): Promise<{ icon: unknown; isNull: boolean; version: string }> {
  const [row] = await query<{ icon: unknown; is_null: boolean; version: string }>(
    `SELECT d.icon, d.icon IS NULL AS is_null, b.version FROM database d JOIN block b ON b.id = d.id WHERE d.id = $1`,
    [databaseId],
  )
  return { icon: row.icon, isNull: row.is_null, version: String(row.version) }
}

function findNode(nodes: readonly PageTreeNode[], id: string): PageTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return undefined
}

describe('① 바꾸기 · 지우기', () => {
  test('★ 같은 아이콘이면 쓰지 않는다 · 지우면 SQL NULL · 받기는 페이지 아이콘과 같은 규칙', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '서가' }))
    assert.equal(db.icon, null, '만들 때는 아이콘이 없다')
    const fresh = await stored(db.id)
    assert.equal(fresh.isNull, true)

    assert.deepEqual(unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, emoji('📚'))), emoji('📚'))
    const once = await stored(db.id)
    assert.deepEqual(once.icon, emoji('📚'))
    assert.equal(BigInt(once.version), BigInt(fresh.version) + 1n, '바꾸면 블록의 version 을 올린다')
    assert.deepEqual(unwrap(await getDatabase(fx.owner.ctx, db.id)).icon, emoji('📚'))

    // 같은 아이콘 — 쓰지 않는다(version 그대로). type 을 생략하고 앞뒤에 공백이 있어도 같은 아이콘이다.
    assert.deepEqual(unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, { emoji: ' 📚 ' })), emoji('📚'))
    assert.equal((await stored(db.id)).version, once.version)

    // 받지 않는 것 — 아무것도 쓰지 않는다.
    for (const bad of ['📚', { type: 'emoji', emoji: '📚📖' }, { type: 'external', url: 'javascript:alert(1)' }, { type: 'emoji', emoji: 'ab' }]) {
      assert.deepEqual(await setDatabaseIcon(fx.owner.ctx, db.id, bad), { ok: false, reason: 'invalid_icon' }, JSON.stringify(bad))
    }
    assert.deepEqual((await stored(db.id)).icon, emoji('📚'))

    // 다른 키는 싣지 않는다.
    unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, { type: 'emoji', emoji: '🗂️', extra: 1 }))
    assert.deepEqual((await stored(db.id)).icon, emoji('🗂️'))

    // 이름을 고친 응답도 아이콘을 싣는다(라우트가 그대로 돌려준다).
    assert.deepEqual(unwrap(await renameDatabase(fx.owner.ctx, db.id, '새 서가')).icon, emoji('🗂️'))

    assert.equal(unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, null)), null)
    const cleared = await stored(db.id)
    assert.equal(cleared.isNull, true, '지우면 SQL NULL 이다(JSON null 이 아니다)')
    assert.equal(unwrap(await getDatabase(fx.owner.ctx, db.id)).icon, null)
  })
})

describe('② 누가', () => {
  test('★ 구조를 고칠 수 있는 사람만 — 볼 수만 있으면 forbidden · 못 보면 not_found · 잠기면 locked · 페이지 id 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '개인 서가', privateTop: true }))
    const viewer = await joinAs(fx.workspaceId, await createUser('보기만 하는 사람'), 'member')
    const stranger = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
    const content = await joinAs(fx.workspaceId, await createUser('내용만 고치는 사람'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: viewer.userId }, 'view')).ok)
    assert.ok((await grantAccess(fx.owner.ctx, db.id, { type: 'user', id: content.userId }, 'edit_content')).ok)

    assert.deepEqual(await setDatabaseIcon(viewer.ctx, db.id, emoji('📚')), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setDatabaseIcon(content.ctx, db.id, emoji('📚')), { ok: false, reason: 'forbidden' }, '내용 편집은 구조가 아니다(6f-1)')
    assert.deepEqual(await setDatabaseIcon(stranger.ctx, db.id, emoji('📚')), { ok: false, reason: 'not_found' })
    assert.equal((await stored(db.id)).isNull, true)

    unwrap(await setDatabaseLock(fx.owner.ctx, db.id, true))
    assert.deepEqual(await setDatabaseIcon(fx.owner.ctx, db.id, emoji('📚')), { ok: false, reason: 'locked' })
    assert.equal((await stored(db.id)).isNull, true)
    unwrap(await setDatabaseLock(fx.owner.ctx, db.id, false))
    unwrap(await setDatabaseIcon(fx.owner.ctx, db.id, emoji('📚')))

    // 페이지는 이 명령의 대상이 아니다 — 페이지 아이콘은 `setPageIcon` 이다.
    const page = await createPage(fx.owner.ctx, { title: [] })
    assert.deepEqual(await setDatabaseIcon(fx.owner.ctx, page.id, emoji('📚')), { ok: false, reason: 'not_found' })
  })
})

describe('③ 읽는 길', () => {
  test('★ 사이드바 트리 · 관계형의 대상 목록 · teamspace 화면 · 멘션의 이름 맵(볼 수 있을 때만)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const shelf = unwrap(await createDatabase(fx.owner.ctx, { name: '아이콘 있는 표' }))
    const plain = unwrap(await createDatabase(fx.owner.ctx, { name: '아이콘 없는 표' }))
    const mine = unwrap(await createDatabase(fx.owner.ctx, { name: '나만 보는 표', privateTop: true }))
    unwrap(await setDatabaseIcon(fx.owner.ctx, shelf.id, emoji('📚')))
    unwrap(await setDatabaseIcon(fx.owner.ctx, mine.id, emoji('🔒')))
    const page = await createPage(fx.owner.ctx, { title: [] })
    await setPageIcon(fx.owner.ctx, page.id, emoji('🌿'))

    const tree = await listPageTree(fx.owner.ctx)
    assert.deepEqual(findNode(tree, shelf.id)?.icon, emoji('📚'))
    assert.equal(findNode(tree, plain.id)?.icon, null)
    assert.equal(findNode(tree, shelf.id)?.kind, 'database')
    assert.deepEqual(findNode(tree, page.id)?.icon, emoji('🌿'), '페이지는 그대로 format 에서 읽는다')

    const listed = await listDatabases(fx.owner.ctx)
    assert.deepEqual(listed.find((d) => d.id === shelf.id)?.icon, emoji('📚'))
    assert.equal(listed.find((d) => d.id === plain.id)?.icon, null)

    const teamspace = unwrap(await createTeamspace(fx.owner.ctx, { name: '표 아이콘 팀' }))
    const teamDb = unwrap(await createDatabase(fx.owner.ctx, { name: '팀 표', teamspaceId: teamspace.id }))
    unwrap(await setDatabaseIcon(fx.owner.ctx, teamDb.id, emoji('🧭')))
    assert.deepEqual(await listTeamspaceDatabases(fx.owner.ctx, teamspace.id), [{ id: teamDb.id, name: '팀 표', icon: emoji('🧭') }])

    // 멘션의 이름 맵 — 데이터베이스를 가리키는 멘션도 그 아이콘을 받는다. 볼 수 없는 표는 이름도 아이콘도 없다.
    const seen = await loadMentionLabels(fx.owner.ctx, { userIds: [], pageIds: [shelf.id, plain.id, mine.id, page.id] })
    assert.deepEqual(seen.pageIcons, { [shelf.id]: emoji('📚'), [mine.id]: emoji('🔒'), [page.id]: emoji('🌿') })
    const other = await loadMentionLabels(mate.ctx, { userIds: [], pageIds: [shelf.id, mine.id] })
    assert.deepEqual(other.pages, { [shelf.id]: '아이콘 있는 표', [mine.id]: null })
    assert.deepEqual(other.pageIcons, { [shelf.id]: emoji('📚') })
    assert.ok(!JSON.stringify(other).includes('🔒'), '볼 수 없는 표의 아이콘이 맵에 있다')
  })
})
