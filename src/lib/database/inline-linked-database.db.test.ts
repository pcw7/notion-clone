/**
 * 본문 안의 연결된 데이터베이스 — 붙인 소스만 가진 인라인 그릇 (27번 트랙 L-1 · F-04-13 · F-04-14 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 L-1]
 *
 *   ① ★ 모양 — 부모 페이지 밑의 데이터베이스 블록 · 본문에 참조 · 소유한 소스 없이 붙인 소스 하나와 그 소스를 보는 뷰 하나 · 처음 이름은 원본의 이름
 *   ② ★ 원본을 볼 수 없으면 · 휴지통의 소스 · 없는 소스 · 형식이 틀린 id 는 없는 것과 같다(아무것도 쓰지 않는다)
 *   ③ 그릇의 뷰로 원본의 행을 본다 · 그릇에서 만든 행은 원본의 행이다
 *   ④ ★ 내보내기 — 그릇은 노드가 아니다(붙인 소스는 원본에서 한 번 나간다) · 본문의 참조는 뺀 참조로 센다
 *   ⑤ ★ 공개 화면 — 소유한 소스가 없는 그릇은 공개 본문에 그리지 않는다(이름도 싣지 않는다)
 *   ⑥ 휴지통 · 되살리기 — 그릇만 간다 · 원본은 그대로
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody } from '../block/save-page-body.ts'
import { restorePage, trashPage } from '../block/trash.ts'
import { createDatabase, createInlineDatabase, getDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { createRow } from './row.ts'
import { queryRows } from './query.ts'
import { getView } from './view.ts'
import { trashDataSource } from './data-source.ts'
import { planExport } from '../export/plan.ts'
import { readExportSnapshot } from '../export/snapshot.ts'
import { publishPage } from '../publish/public-link.ts'
import { readPublicPage } from '../publish/public-read.ts'

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

async function original(name: string, actor: Actor = fx.owner) {
  const created = unwrap(await createDatabase(actor.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(actor.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const row = async (title: string, by: Actor = actor) =>
    unwrap(await createRow(by.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
  return { id: created.id, ds, titleId, row }
}

const hostPage = async (title: string, actor: Actor = fx.owner): Promise<string> =>
  (await createPage(actor.ctx, { title: titleFromPlainText(title) })).id as string

const attachedOf = (databaseId: string) =>
  query<{ data_source_id: string; owned: boolean }>(
    `SELECT dds.data_source_id, ds.owner_database_id = dds.database_id AS owned
       FROM database_data_source dds JOIN data_source ds ON ds.id = dds.data_source_id
      WHERE dds.database_id = $1`,
    [databaseId],
  )

describe('① 모양', () => {
  test('★ 부모 밑의 데이터베이스 블록 · 본문에 참조 · 붙인 소스 하나와 그 뷰 · 처음 이름은 원본의 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const source = await original(unique('원본 할 일'))
    const host = await hostPage('호스트')
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: host, linkedDataSourceId: source.ds }))

    const block = (await query<{ type: string; parent_id: string; is_inline: boolean }>(
      `SELECT b.type, b.parent_id, d.is_inline FROM block b JOIN database d ON d.id = b.id WHERE b.id = $1`, [made.id]))[0]
    assert.deepEqual(block, { type: 'database', parent_id: host, is_inline: true })
    assert.deepEqual((await attachedOf(made.id)), [{ data_source_id: source.ds, owned: false }], '소유한 소스가 없다 · 붙인 소스 하나')
    assert.equal(made.dataSourceId, source.ds)
    assert.deepEqual(made.dataSources.map((s) => [s.id, s.owned, s.ownerDatabaseId]), [[source.ds, false, source.id]])

    const view = unwrap(await getView(fx.owner.ctx, made.defaultViewId))
    assert.equal(view.dataSourceId, source.ds, '그 소스를 보는 뷰')
    assert.ok(view.columns.some((c) => c.propertyId === source.titleId), '원본의 컬럼')

    const detail = unwrap(await getDatabase(fx.owner.ctx, made.id))
    assert.equal(detail.name.startsWith('원본 할 일'), true, '처음 이름은 원본 데이터베이스의 이름')

    const body = await loadPageBody(fx.owner.ctx, host as never)
    assert.ok(body?.doc.blocks.some((b) => b.type === 'database' && b.id === made.id), '본문에 참조')
  })

  test('이름을 주면 그 이름', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const source = await original(unique('원본'))
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: await hostPage('호스트'), linkedDataSourceId: source.ds, name: '내 보기' }))
    assert.equal(unwrap(await getDatabase(fx.owner.ctx, made.id)).name, '내 보기')
  })
})

describe('② 없는 것과 같다', () => {
  test('★ 원본을 볼 수 없으면 · 휴지통의 소스 · 없는 소스 · 형식이 틀린 id — 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const secret = await original(unique('비밀 원본'))
    assert.equal((await stopInheriting(fx.owner.ctx, secret.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, secret.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, secret.id, { type: 'workspace_everyone', id: null })).ok, true)
    const host = await hostPage('남의 호스트', other)
    const countUnder = async () => Number((await query<{ n: string }>(`SELECT count(*) AS n FROM block WHERE parent_id = $1 AND type = 'database'`, [host]))[0]!.n)

    const hidden = await createInlineDatabase(other.ctx, { parentPageId: host, linkedDataSourceId: secret.ds })
    assert.deepEqual(hidden, { ok: false, reason: 'not_found' }, '원본을 볼 수 없다')

    const gone = await original(unique('버린 원본'))
    unwrap(await createRow(fx.owner.ctx, gone.ds))
    const second = await (await import('./data-source.ts')).addDataSource(fx.owner.ctx, gone.id, { name: '둘째' })
    assert.equal(second.ok, true)
    assert.equal((await trashDataSource(fx.owner.ctx, gone.ds)).ok, true)
    assert.deepEqual(await createInlineDatabase(other.ctx, { parentPageId: host, linkedDataSourceId: gone.ds }), { ok: false, reason: 'not_found' }, '휴지통의 소스')

    assert.deepEqual(await createInlineDatabase(other.ctx, { parentPageId: host, linkedDataSourceId: crypto.randomUUID() }), { ok: false, reason: 'not_found' }, '없는 소스')
    assert.deepEqual(await createInlineDatabase(other.ctx, { parentPageId: host, linkedDataSourceId: 'nope' }), { ok: false, reason: 'not_found' }, '형식이 틀린 id')
    assert.equal(await countUnder(), 0, '아무것도 쓰지 않았다')
  })
})

describe('③ 원본의 행', () => {
  test('그릇의 뷰로 원본의 행을 본다 · 그릇에서 만든 행은 원본의 행이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const source = await original(unique('원본'))
    const first = await source.row('가')
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: await hostPage('호스트'), linkedDataSourceId: source.ds }))
    const view = unwrap(await getView(fx.owner.ctx, made.defaultViewId))
    const rows = unwrap(await queryRows(fx.owner.ctx, view.dataSourceId, { manualOrderViewId: view.id }))
    assert.deepEqual(rows.rows.map((r) => r.id), [first])

    const added = unwrap(await createRow(fx.owner.ctx, view.dataSourceId))
    const owner = (await query<{ data_source_id: string }>(`SELECT data_source_id FROM page WHERE id = $1`, [added.id]))[0]
    assert.equal(owner?.data_source_id, source.ds, '원본의 행')
  })
})

describe('④ 내보내기', () => {
  test('★ 그릇은 노드가 아니다 · 본문의 참조는 뺀 참조로 센다 · 원본의 표는 원본에서', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const source = await original(unique('원본 표'))
    await source.row('가')
    const host = await hostPage('내보낼 호스트')
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: host, linkedDataSourceId: source.ds }))

    const snapshot = await readExportSnapshot(fx.owner.ctx, { kind: 'page', rootId: host })
    assert.ok(snapshot.ok)
    if (!snapshot.ok) return
    assert.equal(snapshot.value.nodes.has(made.id), false, '그릇은 노드가 아니다')
    const plan = planExport(snapshot.value, { untitled: '제목 없음' })
    assert.deepEqual(plan.entries.map((e) => e.path), ['내보낼 호스트.md'], '그릇의 CSV 가 없다')
    assert.equal(plan.report.markdown_losses.omitted_pages, 1, '본문의 참조는 뺀 참조로 센다')
  })
})

describe('⑤ 공개 화면', () => {
  test('★ 소유한 소스가 없는 그릇은 공개 본문에 그리지 않는다 — 이름도 싣지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const source = await original(unique('원본'))
    await source.row('가')
    const host = await hostPage('게시 호스트')
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: host, linkedDataSourceId: source.ds, name: '연결 보기' }))
    const published = await publishPage(fx.owner.ctx, host)
    assert.ok(published.ok, JSON.stringify(published))
    const read = await readPublicPage(published.value.token!)
    assert.ok(read.ok, JSON.stringify(read))
    if (!read.ok) return
    assert.ok(read.value.doc.blocks.every((b) => b.id !== made.id), '본문에 없다')
    assert.equal(read.value.databases.has(made.id), false)
    assert.equal(read.value.pages.has(made.id), false, '이름도 싣지 않는다')
  })
})

describe('⑥ 휴지통', () => {
  test('그릇만 간다 · 원본은 그대로 · 되살리면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const source = await original(unique('원본'))
    const row = await source.row('가')
    const made = unwrap(await createInlineDatabase(fx.owner.ctx, { parentPageId: await hostPage('호스트'), linkedDataSourceId: source.ds }))
    await trashPage(fx.owner.ctx, made.id as never)
    const lifecycle = async (id: string) => (await query<{ lifecycle: string }>(`SELECT lifecycle FROM block WHERE id = $1`, [id]))[0]?.lifecycle
    assert.equal(await lifecycle(made.id), 'trashed')
    assert.equal(await lifecycle(source.id), 'live', '원본은 그대로')
    assert.equal(await lifecycle(row), 'live', '원본의 행도')
    await restorePage(fx.owner.ctx, made.id as never)
    assert.equal(await lifecycle(made.id), 'live')
    assert.deepEqual((await attachedOf(made.id)), [{ data_source_id: source.ds, owned: false }], '부착은 그대로')
  })
})
