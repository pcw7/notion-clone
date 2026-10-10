/**
 * 활동 기록 — 히스토리 · 활동 4d-2 (F-11-04, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 만들기 — 페이지 · 하위 페이지 · 행이 `page.created`(행위자는 만든 사람) · 템플릿은 남기지 않는다
 *   ② 옮기기 — `page.moved` · payload 는 옛 부모 · 새 부모의 id
 *   ③ 버리기 — 묶음의 루트에만 `page.trashed`(함께 들어간 자손에는 없다) · 행 휴지통도
 *   ④ 본문 편집 — 참여자의 update 가 `block.updated` · 같은 사람 · 같은 페이지 5분 안이면 접는다 · 다른 사람은 따로 · 창이 지나면 다시 ·
 *      명령이 본문을 고친 것(하위 페이지 만들기 · 출처가 editor 가 아닌 update)은 남기지 않는다 · 제목 바꾸기도 같은 종류 · 같은 접기
 *   ⑤ 셀 쓰기 — `property.updated` · 같은 접기
 *
 * 반사실(HANDOFF §3.3): 접지 않으면 ④ ⑤, 명령의 본문 변경까지 남기면 ④, 자손에도 남기면 ③ 이 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Transaction } from '@tiptap/pm/state'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { loadDocState, type DocOrigin } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import type { EditorBlock } from '../editor/document.ts'
import { changesSince, edit, peer } from '../testing/collab-peers.ts'
import { appendDocUpdate } from '../block/body-write.ts'
import { createPage, renamePage, titleFromPlainText } from '../block/page.ts'
import { movePage } from '../block/move-page.ts'
import { trashPage } from '../block/trash.ts'
import { asBlockId, type BlockId } from '../ids.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, trashRow, updateCells } from '../database/row.ts'
import { createTemplate } from '../database/template.ts'

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
  mate = await joinAs(fx.workspaceId, await createUser('함께 고치는 사람'), 'member')
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

type Ev = { type: string; actor_id: string | null; payload: Record<string, string> }
const eventsOf = (pageId: string) =>
  query<Ev>(`SELECT type, actor_id, payload FROM activity_event WHERE page_id = $1 ORDER BY created_at, id`, [pageId])
const typesOf = async (pageId: string) => (await eventsOf(pageId)).map((e) => e.type)
const page = async (title: string, parent: BlockId | null = null, who: Actor = fx.owner) =>
  (await createPage(who.ctx, { parentPageId: parent, title: titleFromPlainText(title) })).id

/** 참여자 `who` 가 본문을 그 글로 바꾼 update 를 협업 서버의 길로 쌓는다. */
async function typeInto(who: Actor, pageId: string, text: string, clientId: number, origin: DocOrigin = 'editor'): Promise<void> {
  const state = await loadDocState(who.ctx, pageId)
  if (!state.ok) throw new Error('본문을 읽지 못했다')
  const base = state.value.ydoc
  const client = peer(base, clientId)
  const blocks: EditorBlock[] = [{ id: randomUUID(), type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] }]
  const next = docToPm({ blocks })
  edit(client, (tr: Transaction) => {
    tr.replaceWith(0, tr.doc.content.size, next.content)
  })
  const appended = await appendDocUpdate(who.ctx, pageId, changesSince(client, base), { origin })
  assert.ok(appended.ok && appended.appended, JSON.stringify(appended))
}
/** 접는 창이 지난 것처럼 — 그 페이지의 이벤트를 6분 앞으로. */
const age = (pageId: string) =>
  query(`UPDATE activity_event SET created_at = created_at - interval '6 minutes' WHERE page_id = $1`, [pageId])

describe('① 만들기', () => {
  test('★ 페이지 · 하위 페이지 · 행이 page.created(만든 사람) — 템플릿은 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await page('맨 위')
    const sub = await page('아래', asBlockId(top), mate)
    assert.deepEqual(await eventsOf(top), [{ type: 'page.created', actor_id: fx.owner.userId, payload: {} }])
    assert.deepEqual((await eventsOf(sub)).map((e) => [e.type, e.actor_id]), [['page.created', mate.userId]])
    assert.deepEqual(await typesOf(top), ['page.created'], '하위 페이지를 만든 것은 부모의 활동이 아니다(명령의 본문 변경)')

    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '활동 표' }))
    const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
    assert.deepEqual(await typesOf(row), ['page.created'])
    const template = await createTemplate(fx.owner.ctx, db.dataSourceId, { title: '틀' })
    assert.equal(template.ok, true)
    if (template.ok) assert.deepEqual(await typesOf(template.value.id), [], '템플릿은 행이 아니다')
  })
})

describe('② 옮기기', () => {
  test('★ page.moved — 옛 부모 · 새 부모의 id', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const from = await page('옛 부모')
    const to = await page('새 부모')
    const moving = await page('옮길 것', asBlockId(from))
    await movePage(fx.owner.ctx, asBlockId(moving), asBlockId(to))
    const moved = (await eventsOf(moving)).filter((e) => e.type === 'page.moved')
    assert.deepEqual(moved, [{ type: 'page.moved', actor_id: fx.owner.userId, payload: { from, to } }])
  })
})

describe('③ 버리기', () => {
  test('★ 묶음의 루트에만 page.trashed — 함께 들어간 자손에는 없다 · 행 휴지통도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await page('버릴 묶음')
    const child = await page('자손', asBlockId(root))
    await trashPage(fx.owner.ctx, asBlockId(root))
    assert.deepEqual(await typesOf(root), ['page.created', 'page.trashed'])
    assert.deepEqual(await typesOf(child), ['page.created'], '자손에는 남기지 않는다')

    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '버릴 행의 표' }))
    const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
    unwrap(await trashRow(fx.owner.ctx, row))
    assert.deepEqual(await typesOf(row), ['page.created', 'page.trashed'])
  })
})

describe('④ 본문 편집', () => {
  test('★ 참여자의 update 가 block.updated — 5분 안이면 접는다 · 다른 사람은 따로 · 창이 지나면 다시', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('함께 쓰는 글')
    await typeInto(fx.owner, target, '하나', 101)
    await typeInto(fx.owner, target, '둘', 102)
    await typeInto(fx.owner, target, '셋', 103)
    const edits = async () => (await eventsOf(target)).filter((e) => e.type === 'block.updated').map((e) => e.actor_id)
    assert.deepEqual(await edits(), [fx.owner.userId], '같은 사람의 잇단 편집은 하나로 접힌다')

    await typeInto(mate, target, '넷', 104)
    assert.deepEqual(await edits(), [fx.owner.userId, mate.userId], '다른 사람은 따로')

    await age(target)
    await typeInto(fx.owner, target, '다섯', 105)
    assert.deepEqual(await edits(), [fx.owner.userId, mate.userId, fx.owner.userId], '창이 지나면 다시 남긴다')
  })

  test('★ 제목 바꾸기도 block.updated — 본문 편집과 함께 접힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('옛 제목')
    await renamePage(fx.owner.ctx, asBlockId(target), titleFromPlainText('새 제목'))
    assert.deepEqual(await typesOf(target), ['page.created', 'block.updated'])
    await typeInto(fx.owner, target, '본문', 301)
    await renamePage(fx.owner.ctx, asBlockId(target), titleFromPlainText('또 새 제목'))
    assert.deepEqual(await typesOf(target), ['page.created', 'block.updated'], '5분 안의 편집 · 제목은 하나로 접힌다')
  })

  test('★ 사람이 친 편집이 아니면 남기지 않는다 — 명령 · 자동화의 update', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const target = await page('명령이 고친 글')
    await typeInto(fx.owner, target, '명령', 201, 'api')
    await typeInto(fx.owner, target, '자동화', 202, 'automation')
    assert.deepEqual(await typesOf(target), ['page.created'])
  })
})

describe('⑤ 셀 쓰기', () => {
  test('★ property.updated — 같은 사람 · 같은 행 5분 안이면 접는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '셀 활동' }))
    const qty = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '수량', type: 'number' })).properties.find((p) => p.name === '수량')!.id
    const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
    for (const n of [1, 2, 3]) unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: qty, value: { type: 'number', number: n } }] }))
    assert.deepEqual(await typesOf(row), ['page.created', 'property.updated'])
    await age(row)
    unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: qty, value: { type: 'number', number: 4 } }] }))
    assert.deepEqual(await typesOf(row), ['page.created', 'property.updated', 'property.updated'])
  })
})
