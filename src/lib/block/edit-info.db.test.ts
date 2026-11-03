// 블록마다의 마지막 편집(37번 트랙 ED-2 · F-11-15 · 정본 §3.4 [보강 ED-2]) — 블록마다 다르다 · 그 페이지의 본문만 · 볼 수 없으면 없는 페이지.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { readBlockEditInfo } from './edit-info.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'

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
  mate = await joinAs(fx.workspaceId, await createUser('고친 동료'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] }) as EditorBlock

const save = async (actor: Actor, pageId: string, blocks: EditorBlock[]): Promise<void> => {
  const saved = await savePageBody(actor.ctx, pageId as never, { blocks } as never)
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

describe('블록마다의 마지막 편집', () => {
  test('★ 블록마다 마지막으로 고친 사람 — 바뀌지 않은 블록은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = (await createPage(fx.owner.ctx, { title: titleFromPlainText('블록 이력') })).id
    const mine = randomUUID()
    const theirs = randomUUID()
    await save(fx.owner, pageId, [para(mine, '내 줄'), para(theirs, '고칠 줄')])
    await save(mate, pageId, [para(mine, '내 줄'), para(theirs, '고친 줄')])

    const a = await readBlockEditInfo(fx.owner.ctx, pageId, mine)
    const b = await readBlockEditInfo(fx.owner.ctx, pageId, theirs)
    assert.ok(a.ok && a.edited !== null && b.ok && b.edited !== null, JSON.stringify({ a, b }))
    const ownerName = (await import('../db/pool.ts')).query
    const [owner] = await ownerName<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [fx.owner.userId])
    assert.equal(a.edited.label, owner.name)
    assert.equal(b.edited.label, '고친 동료')
  })

  test('★ 그 페이지의 본문이 아니면 답이 없다 — 다른 페이지 · 하위 페이지의 본문 · 없는 블록 · uuid 가 아닌 값', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = (await createPage(fx.owner.ctx, { title: titleFromPlainText('부모') })).id
    const child = (await createPage(fx.owner.ctx, { title: titleFromPlainText('자식'), parentPageId: parent as never })).id
    const other = (await createPage(fx.owner.ctx, { title: titleFromPlainText('남') })).id
    const inChild = randomUUID()
    const inOther = randomUUID()
    await save(fx.owner, child, [para(inChild, '자식의 줄')])
    await save(fx.owner, other, [para(inOther, '남의 줄')])

    for (const [label, blockId] of [['하위 페이지의 본문', inChild], ['다른 페이지', inOther], ['없는 블록', randomUUID()], ['uuid 아님', 'x']] as const) {
      const read = await readBlockEditInfo(fx.owner.ctx, parent, blockId)
      assert.deepEqual(read, { ok: true, edited: null }, label)
    }
    // 하위 페이지에게 물으면 있다.
    const own = await readBlockEditInfo(fx.owner.ctx, child, inChild)
    assert.ok(own.ok && own.edited !== null, JSON.stringify(own))
  })

  test('볼 수 없는 페이지 · 페이지가 아닌 id 는 없는 페이지와 같은 답', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mineOnly = (await createPage(fx.owner.ctx, { title: titleFromPlainText('나만'), privateTop: true })).id
    const line = randomUUID()
    await save(fx.owner, mineOnly, [para(line, '나만 보는 줄')])
    assert.deepEqual(await readBlockEditInfo(mate.ctx, mineOnly, line), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readBlockEditInfo(fx.owner.ctx, line, line), { ok: false, reason: 'not_found' })
    assert.deepEqual(await readBlockEditInfo(fx.owner.ctx, 'x', line), { ok: false, reason: 'not_found' })
  })
})
