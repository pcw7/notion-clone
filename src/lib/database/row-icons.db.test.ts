/**
 * 데이터베이스 행의 아이콘 — 잔여 묶음 8c-3a (F-02-05 · DB)
 *
 * 행은 `type='page'` 블록이라 아이콘의 자리가 페이지와 같다(`format.page_icon` · `setPageIcon` 이 행을 받는다 — 8c-1). 이 파일은 표의
 * 화면이 읽는 길들이 그것을 싣는지를 본다.
 *
 *   ① ★ 행을 읽는 네 길(표 · 보드 · 행 하나 · 목록)이 아이콘을 싣는다 — **셀을 고친 응답도**(화면이 그 행으로 갈아 끼운다)
 *   ② ★ 관계형 — 이름 맵의 아이콘은 **볼 수 있는 행만** · 연결 목록 · 후보가 아이콘을 싣는다
 *   ③ 템플릿 — 목록이 아이콘을 싣고, 템플릿으로 만든 행이 그 아이콘을 물려받는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createUser, joinAs, probeDatabase, makeFixture, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setPageIcon } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { PageIcon } from '../block/page-icon.ts'
import { withReadTransaction } from '../db/tx.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { createRow, listRows, readRow, updateCells } from './row.ts'
import { queryRows } from './query.ts'
import { queryGroups } from './group.ts'
import { createView } from './view.ts'
import { addRelationProperty, linkRows, loadRelationLabels, readRelation, searchCandidates } from './relation.ts'
import { createRowFromTemplate, createTemplate, listTemplates } from './template.ts'
import type { BlockId } from '../ids.ts'

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
  other = await joinAs(fx.workspaceId, await createUser('행 아이콘 동료'), 'member')
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

async function newTable(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const schema = unwrap(await getSchema(fx.owner.ctx, created.dataSourceId))
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const row = async (title: string, icon?: string): Promise<string> => {
    const id = unwrap(
      await createRow(fx.owner.ctx, created.dataSourceId, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] }),
    ).id
    if (icon !== undefined) await setPageIcon(fx.owner.ctx, id as BlockId, emoji(icon))
    return id
  }
  return { databaseId: created.id, dataSourceId: created.dataSourceId, titleId, row }
}

describe('① 행을 읽는 길', () => {
  test('★ 표 · 보드 · 행 하나 · 목록이 아이콘을 싣는다 — 셀을 고친 응답도 · 아이콘 없는 행은 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('아이콘 표')
    const fox = await table.row('여우 행', '🦊')
    const plain = await table.row('아이콘 없는 행')

    const queried = unwrap(await queryRows(fx.owner.ctx, table.dataSourceId, { filter: null, sorts: [] }))
    assert.deepEqual(queried.rows.map((r) => [r.id, r.icon]), [[fox, emoji('🦊')], [plain, null]])

    const listed = unwrap(await listRows(fx.owner.ctx, table.dataSourceId))
    assert.deepEqual(listed.rows.map((r) => [r.id, r.icon]), [[fox, emoji('🦊')], [plain, null]])
    assert.deepEqual((await withReadTransaction((tx) => readRow(tx, fox)))?.icon, emoji('🦊'))

    unwrap(await addProperty(fx.owner.ctx, table.dataSourceId, { name: '끝', type: 'checkbox' }))
    const done = unwrap(await getSchema(fx.owner.ctx, table.dataSourceId)).properties.find((p) => p.name === '끝')!
    const board = unwrap(await createView(fx.owner.ctx, table.databaseId, { type: 'board', groupBy: { property_id: done.id } }))
    const groups = unwrap(await queryGroups(fx.owner.ctx, board.id))
    const boardRows = groups.groups.flatMap((g) => g.rows)
    assert.deepEqual(boardRows.find((r) => r.id === fox)?.icon, emoji('🦊'))
    assert.equal(boardRows.find((r) => r.id === plain)?.icon, null)

    // 셀을 고친 응답 — 화면이 이 행으로 갈아 끼운다. 아이콘이 빠지면 고친 순간 표에서 사라진다.
    const updated = unwrap(
      await updateCells(fx.owner.ctx, fox, { cells: [{ propertyId: table.titleId, value: { type: 'title', title: [textRun('고친 여우')] } }] }),
    )
    assert.deepEqual(updated.icon, emoji('🦊'))
  })
})

describe('② 관계형', () => {
  test('★ 이름 맵의 아이콘은 볼 수 있는 행만 · 연결 목록 · 후보가 아이콘을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tasks = await newTable('작업')
    const projects = await newTable('프로젝트')
    const secrets = await newTable('비밀 표')
    const rel = unwrap(await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '프로젝트', targetDataSourceId: projects.dataSourceId }))
    const secretRel = unwrap(await addRelationProperty(fx.owner.ctx, tasks.dataSourceId, { name: '비밀', targetDataSourceId: secrets.dataSourceId }))
    const task = await tasks.row('작업 하나')
    const rocket = await projects.row('로켓 프로젝트', '🚀')
    const plainProject = await projects.row('아이콘 없는 프로젝트')
    const candidate = await projects.row('고를 후보', '🌵')
    const secret = await secrets.row('비밀 행', '🔒')
    unwrap(await linkRows(fx.owner.ctx, task, rel.propertyId, { add: [rocket, plainProject] }))
    unwrap(await linkRows(fx.owner.ctx, task, secretRel.propertyId, { add: [secret] }))
    // 비밀 표는 소유자만 — 동료에게는 그 행의 제목도 아이콘도 없다.
    assert.equal((await stopInheriting(fx.owner.ctx, secrets.databaseId)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, secrets.databaseId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, secrets.databaseId, { type: 'workspace_everyone', id: null })).ok, true)

    const seen = await loadRelationLabels(other.ctx, [rocket, plainProject, secret])
    assert.deepEqual(seen.labels, { [rocket]: '로켓 프로젝트', [plainProject]: '아이콘 없는 프로젝트', [secret]: null })
    assert.deepEqual(seen.icons, { [rocket]: emoji('🚀') })
    assert.ok(!JSON.stringify(seen).includes('🔒'), '볼 수 없는 행의 아이콘이 맵에 있다')
    assert.deepEqual((await loadRelationLabels(fx.owner.ctx, [secret])).icons, { [secret]: emoji('🔒') })

    const linked = unwrap(await readRelation(fx.owner.ctx, task, rel.propertyId))
    assert.deepEqual(linked.items.map((i) => [i.id, i.icon]), [[rocket, emoji('🚀')], [plainProject, null]])
    const found = unwrap(await searchCandidates(fx.owner.ctx, task, rel.propertyId, '고를'))
    assert.deepEqual(found.items.map((i) => [i.id, i.icon]), [[candidate, emoji('🌵')]])
  })
})

describe('③ 템플릿', () => {
  test('목록이 아이콘을 싣고, 템플릿으로 만든 행이 그 아이콘을 물려받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await newTable('템플릿 표')
    const template = unwrap(await createTemplate(fx.owner.ctx, table.dataSourceId, { title: '회의록 템플릿' }))
    await setPageIcon(fx.owner.ctx, template.id as BlockId, emoji('📝'))

    const templates = unwrap(await listTemplates(fx.owner.ctx, table.dataSourceId))
    assert.deepEqual(templates.map((x) => [x.id, x.icon]), [[template.id, emoji('📝')]])

    const made = unwrap(await createRowFromTemplate(fx.owner.ctx, table.dataSourceId, template.id))
    assert.deepEqual((await withReadTransaction((tx) => readRow(tx, made.row.id)))?.icon, emoji('📝'))
  })
})
