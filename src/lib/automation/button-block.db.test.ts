/**
 * 버튼 블록 — 본문 · 문 · 일하는 행 없음 · 누르기 (자동화 5e-1 · F-08-06, DB 필요)
 *
 * 이 파일이 지키는 것(정본 §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑰).
 *
 *   ① 본문 — type='button' 행 · 라벨만(정화 — 빈 라벨은 지운다 · 100자에서 자른다) · Y.Doc 과 같다 · 참여자가 넣은 블록도 곧바로 쓸 수 있다(밀린 투영)
 *   ② 문 — 읽기는 보기 · 고치기와 누르기는 edit_content(보기만이면 403 · 못 보면 404 · 잠기면 locked) · 블록은 그 페이지의 본문에 · 버튼이어야
 *   ③ 일하는 행이 없다 — 값 바꾸기 · 행의 속성 · 웹훅의 보낼 속성은 거절 · 다른 표에 행 추가(고정 값 · 지금)는 된다
 *   ④ 누르기 — 처음 저장하거나 누를 때 automation 하나(블록마다) · 그 페이지를 일하는 자리로 · origin user · depth 0
 *   ⑤ 블록이 본문에서 지워지면 automation 도 사라진다
 *   ⑥ 블록 넣기(5e-2 · ⑱) — 새 id 로 복제해 버튼 아래 · 페이지 끝 · 누를 때마다 · 행과 Y.Doc 이 같다 · 실행이 되돌려지면 남지 않는다 ·
 *      버튼 속성 · DB automation 은 받지 않는다
 *
 * 반사실(HANDOFF §3.3): 라벨을 정화하지 않으면 ①, 블록이 그 페이지의 것인지 보지 않으면 ②, 고치기를 보기로 낮추면 ②, 빈 표 대신 아무 표나
 * 주면 ③, 블록마다 하나를 지키지 않으면 ④ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { appendDocUpdate } from '../block/body-write.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { pressButtonBlock, readButtonBlock, setButtonBlockActions } from './button-block.ts'
import { setButtonActions } from './button-property.ts'
import { createDbAutomation } from './db-automation.ts'
import { loadPageBody } from '../block/save-page-body.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let viewer: Actor
let outsider: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  viewer = await joinAs(fx.workspaceId, await createUser('보기만 하는 사람'), 'member')
  outsider = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${JSON.stringify(r)}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const block = (type: string, properties: Record<string, unknown> = {}, text = ''): EditorBlock => ({
  id: randomUUID(),
  type: type as EditorBlock['type'],
  title: text === '' ? [] : [textRun(text)],
  properties,
  format: {},
  children: [],
})

/** 버튼 블록 하나가 든 페이지 — 소유자는 전체 · 보는 사람은 보기 · 못 보는 사람은 없다. */
async function pageWithButton(label = '알림') {
  const pageId = (await createPage(fx.owner.ctx, { title: titleFromPlainText('버튼 페이지') })).id
  const button = block('button', { label })
  // 버튼 뒤에도 문단 — "버튼 아래"와 "페이지 끝"이 갈린다
  assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block('paragraph', {}, '앞'), button, block('paragraph', {}, '뒤')] })).ok)
  assert.equal((await stopInheriting(fx.owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, pageId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  await revokeAccess(fx.owner.ctx, pageId, { type: 'workspace_everyone' })
  assert.equal((await grantAccess(fx.owner.ctx, pageId, { type: 'user', id: viewer.userId }, 'view')).ok, true)
  return { pageId, blockId: button.id }
}

/** 행이 설 표 — 수량(숫자) · 마감(날짜). */
async function target() {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name: '행이 설 표' }))
  const idOf = (props: readonly { id: string; name: string }[], n: string) => props.find((p) => p.name === n)!.id
  const qty = idOf(unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '수량', type: 'number' })).properties, '수량')
  const due = idOf(unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '마감', type: 'date' })).properties, '마감')
  return { ds: db.dataSourceId, qty, due }
}

const rowOf = async (id: string) =>
  (await query<{ type: string; properties: Record<string, unknown> }>(`SELECT type, properties FROM block WHERE id = $1`, [id]))[0]
const automationsOf = (blockId: string) =>
  query<{ id: string; created_by: string }>(`SELECT id, created_by FROM automation WHERE host_page_id = $1 AND kind = 'button_block'`, [blockId])

describe('① 본문', () => {
  test("★ type='button' 행 — 라벨만 · 빈 라벨은 지우고 넘는 라벨은 자른다 · Y.Doc 과 같다", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = (await createPage(fx.owner.ctx, { title: titleFromPlainText('라벨') })).id
    const named = block('button', { label: '  보내기  ', junk: 1 })
    const empty = block('button', { label: '   ' })
    const long = block('button', { label: '가'.repeat(150) })
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [named, empty, long] })).ok)
    assert.equal((await rowOf(named.id))?.type, 'button')
    assert.equal((await rowOf(named.id))?.properties.label, '  보내기  ', '앞뒤 빈칸은 본문의 것이다 — 그릴 때 다듬는다')
    assert.equal('label' in ((await rowOf(empty.id))?.properties ?? {}), false, '빈 라벨은 지운다(그릴 때 "버튼")')
    assert.equal(((await rowOf(long.id))?.properties.label as string).length, 100)
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })

  test('★ 참여자가 방금 넣은 버튼도 곧바로 쓸 수 있다 — 행이 아직 없으면 밀린 투영을 먼저', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = (await createPage(fx.owner.ctx, { title: titleFromPlainText('협업') })).id
    const anchor = block('paragraph', {}, '앞')
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [anchor] })).ok)
    const state = await loadDocState(fx.owner.ctx, pageId)
    assert.ok(state.ok)
    const client = peer(state.value.ydoc, 5151)
    const id = randomUUID()
    edit(client, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, anchor.id)
      const schema = doc.type.schema
      tr.insert(pos + node.nodeSize, schema.nodes.blockContainer.create({ blockId: id }, [schema.nodes.button.create({ props: { label: '새 버튼' }, format: {} })]))
    })
    const appended = await appendDocUpdate(fx.owner.ctx, pageId, changesSince(client, state.value.ydoc), { origin: 'editor', projection: 'deferred' })
    assert.ok(appended.ok, JSON.stringify(appended))
    assert.equal(await rowOf(id), undefined, '투영이 밀렸다')
    const read = unwrap(await readButtonBlock(fx.owner.ctx, pageId, id))
    assert.deepEqual(read, { automationId: null, enabled: true, disabledReason: null, actions: [] })
    assert.equal((await rowOf(id))?.properties.label, '새 버튼')
  })
})

describe('② 문', () => {
  test('★ 읽기는 보기 · 고치기와 누르기는 편집 — 블록은 그 페이지의 본문에 · 버튼이어야 · 잠기면 locked', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { pageId, blockId } = await pageWithButton()
    const other = await pageWithButton()
    assert.ok((await readButtonBlock(viewer.ctx, pageId, blockId)).ok, '보는 사람은 읽는다')
    assert.deepEqual(await setButtonBlockActions(viewer.ctx, pageId, blockId, []), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await pressButtonBlock(viewer.ctx, pageId, blockId, randomUUID()), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await readButtonBlock(outsider.ctx, pageId, blockId), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readButtonBlock(fx.owner.ctx, pageId, other.blockId), { ok: false, reason: 'not_found' }, '다른 페이지의 버튼')
    const paragraph = (await query<{ id: string }>(`SELECT id FROM block WHERE parent_id = $1 AND type = 'paragraph' ORDER BY order_key LIMIT 1`, [pageId]))[0].id
    assert.deepEqual(await readButtonBlock(fx.owner.ctx, pageId, paragraph), { ok: false, reason: 'not_found' }, '버튼이 아닌 블록')
    unwrap(await setPageLock(fx.owner.ctx, pageId, true))
    assert.deepEqual(await setButtonBlockActions(fx.owner.ctx, pageId, blockId, []), { ok: false, reason: 'locked' })
    assert.deepEqual(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()), { ok: false, reason: 'locked' })
  })
})

describe('③ 일하는 행이 없다', () => {
  test('★ 값 바꾸기 · 행의 속성 · 보낼 속성은 거절 — 다른 표에 행 추가(고정 값 · 지금)는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { pageId, blockId } = await pageWithButton()
    const tb = await target()
    const bad = (problem: string) => ({ ok: false, reason: 'invalid_action', problem, index: 0 })
    assert.deepEqual(
      await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: tb.qty, value: { type: 'number', number: 1 } }] } }]),
      bad('unknown_property'),
    )
    assert.deepEqual(
      await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [
        { type: 'add_page_to', config: { v: 1, dataSourceId: tb.ds, cells: [{ propertyId: tb.qty, from: { kind: 'row_property', propertyId: tb.qty } }] } },
      ]),
      bad('invalid_dynamic'),
    )
    assert.ok(
      (await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [
        { type: 'add_page_to', config: { v: 1, dataSourceId: tb.ds, cells: [{ propertyId: tb.qty, value: { type: 'number', number: 3 } }, { propertyId: tb.due, from: { kind: 'now' } }] } },
      ])).ok,
    )
  })
})

describe('④ 누르기', () => {
  test('★ 누르면 실행 — 그 페이지를 일하는 자리로 · origin user · depth 0 · automation 은 블록마다 하나', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { pageId, blockId } = await pageWithButton()
    const tb = await target()
    // 저장한 적 없이 누르면 — 할 일이 없는 실행 · automation 이 하나 생긴다
    const empty = unwrap(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()))
    assert.deepEqual([empty.status, empty.steps], ['success', []])
    assert.equal((await automationsOf(blockId)).length, 1)
    unwrap(await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [
      { type: 'add_page_to', config: { v: 1, dataSourceId: tb.ds, cells: [{ propertyId: tb.qty, value: { type: 'number', number: 3 } }] } },
    ]))
    const run = unwrap(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()))
    assert.equal(run.status, 'success')
    const made = run.steps[0].pageId!
    assert.equal(
      ((await query<{ value: { number: number } }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [made, tb.qty]))[0]?.value)?.number,
      3,
    )
    const [record] = await query<{ trigger_page_id: string; origin: string; depth: number }>(`SELECT trigger_page_id, origin, depth FROM automation_run WHERE id = $1`, [run.runId])
    assert.deepEqual(record, { trigger_page_id: pageId, origin: 'user', depth: 0 })
    assert.equal((await automationsOf(blockId)).length, 1, '블록마다 하나')
  })
})

describe('⑤ 지우기', () => {
  test('★ 블록이 본문에서 지워지면 automation 도 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { pageId, blockId } = await pageWithButton()
    unwrap(await setButtonBlockActions(fx.owner.ctx, pageId, blockId, []))
    assert.equal((await automationsOf(blockId)).length, 1)
    assert.ok((await savePageBody(fx.owner.ctx, pageId, { blocks: [block('paragraph', {}, '버튼을 지웠다')] })).ok)
    assert.equal(await rowOf(blockId), undefined)
    assert.equal((await automationsOf(blockId)).length, 0)
  })
})

describe('⑥ 블록 넣기', () => {
  const template = () => [
    { ...block('to_do', {}, '할 일'), children: [block('paragraph', {}, '자식')] },
    block('paragraph', {}, '메모'),
  ]
  const shape = async (pageId: string) =>
    (await loadPageBody(fx.owner.ctx, pageId))!.doc.blocks.map((b) => [b.type, b.title.map((r) => r.plain_text).join(''), b.children?.length ?? 0])

  test('★ 버튼 아래 · 페이지 끝 — 새 id 로 · 누를 때마다 · 행과 Y.Doc 이 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { pageId, blockId } = await pageWithButton()
    const blocks = template()
    unwrap(await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [{ type: 'insert_blocks', config: { v: 1, position: 'below', blocks } }]))
    assert.equal((unwrap(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()))).status, 'success')
    assert.deepEqual(
      await shape(pageId),
      [['paragraph', '앞', 0], ['button', '', 0], ['to_do', '할 일', 1], ['paragraph', '메모', 0], ['paragraph', '뒤', 0]],
      '버튼 바로 아래(뒤 문단보다 앞)',
    )
    unwrap(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()))
    const twice = (await loadPageBody(fx.owner.ctx, pageId))!.doc.blocks
    assert.equal(twice.filter((b) => b.type === 'to_do').length, 2, '누를 때마다')
    const ids = twice.flatMap((b) => [b.id, ...(b.children ?? []).map((c) => c.id)])
    assert.equal(new Set(ids).size, ids.length, 'id 가 겹치지 않는다')
    assert.equal(ids.includes(blocks[0].id), false, '템플릿의 id 를 쓰지 않는다')
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)

    unwrap(await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [{ type: 'insert_blocks', config: { v: 1, position: 'bottom', blocks: [block('quote', {}, '끝')] } }]))
    unwrap(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()))
    assert.deepEqual((await shape(pageId)).at(-1), ['quote', '끝', 0], '페이지 끝')
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
  })

  test('★ 실행이 되돌려지면 넣은 블록도 남지 않는다 · 버튼 속성 · DB automation 은 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { pageId, blockId } = await pageWithButton()
    const tb = await target()
    unwrap(await setButtonBlockActions(fx.owner.ctx, pageId, blockId, [
      { type: 'insert_blocks', config: { v: 1, position: 'below', blocks: [block('paragraph', {}, '되돌릴 것')] } },
      { type: 'add_page_to', config: { v: 1, dataSourceId: tb.ds, cells: [{ propertyId: tb.qty, value: { type: 'number', number: 1 } }] } },
    ]))
    await query(`UPDATE property SET deleted_at = now() WHERE id = $1`, [tb.qty])
    const before = await shape(pageId)
    const run = unwrap(await pressButtonBlock(fx.owner.ctx, pageId, blockId, randomUUID()))
    assert.equal(run.status, 'failed')
    assert.deepEqual(await shape(pageId), before, '넣은 블록이 남지 않았다')
    await assertBodyMatchesYDoc(fx.owner.ctx, pageId)

    const insert = [{ type: 'insert_blocks', config: { v: 1, position: 'below', blocks: [block('paragraph', {}, 'x')] } }]
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '버튼 속성 표' }))
    const buttonProp = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '버튼', type: 'button' })).properties.find((p) => p.name === '버튼')!.id
    assert.deepEqual(await setButtonActions(fx.owner.ctx, db.dataSourceId, buttonProp, insert), { ok: false, reason: 'invalid_action', problem: 'unsupported_here', index: 0 })
    assert.deepEqual(
      await createDbAutomation(fx.owner.ctx, db.dataSourceId, { name: '넣기', triggers: [{ type: 'page_added' }], actions: insert }),
      { ok: false, reason: 'invalid_action', problem: 'unsupported_here', index: 0 },
    )
  })
})

