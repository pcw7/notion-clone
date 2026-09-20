/**
 * 페이지 복제 — 복제 6a조각 (F-02-09 · F-08-01, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 서브트리가 통째로 새 id 로 다시 생긴다 — 원본은 그대로다
 *   ② **안쪽은 사본을, 바깥은 원본을 가리킨다**(이 조각이 고정하는 규칙 · 마스터 §5.2-6)
 *   ③ 사본은 원본 바로 뒤에 서고, 자리를 주면 거기에 선다. 제목에는 꼬리표가 붙는다
 *   ④ 본문은 Y.Doc 에서 읽어 Y.Doc 으로 쓴다 — 행과 Y.Doc 이 같은 본문이고, 아이콘도 따라온다
 *   ⑤ **볼 수 없는 하위 페이지는 복제하지 않는다** — 그 참조는 사본 본문에서 빠지고 개수만 알려 준다
 *   ⑥ 거부하면 아무것도 남지 않는다 — 자기 안으로 · 상한 초과 · 못 보는 원본
 *
 * 반사실(HANDOFF §3.3-172~173): 바깥 참조까지 재매핑하면 ②, 사본을 만들기 전에 본문을 쓰면 ④, 볼 수 없는 하위 페이지를
 * 거르지 않으면 ⑤, 상한을 안 보면 ⑥ 이 실패한다.
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { mentionTarget, pageMentionRun, textRun, toPlainText } from '../contracts/rich-text.ts'
import { asBlockId, type BlockId } from '../ids.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import type { EditorBlock } from '../editor/document.ts'
import { createPage, getPage, listChildPages, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { duplicatePage, DuplicateError, MAX_DUPLICATE_PAGES } from './duplicate.ts'
import { COPY_SUFFIX } from './duplicate-remap.ts'

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

const para = (id: string, ...runs: ReturnType<typeof textRun>[]): EditorBlock => ({
  id,
  type: 'paragraph',
  title: runs,
})

/** 하위 페이지 참조 블록 — 본문에서 그 페이지가 서는 자리(`page-refs.ts`). */
const ref = (pageId: string): EditorBlock => ({ id: pageId, type: 'page', title: [] })

const newPage = async (title: string, parent?: BlockId) =>
  createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...(parent ? { parentPageId: parent } : {}) })

const bodyOf = async (pageId: string) => {
  const loaded = await loadPageBody(fx.owner.ctx, asBlockId(pageId))
  assert.ok(loaded !== null, '본문을 읽지 못했다')
  return loaded.doc
}

const titleOf = async (pageId: string) => (await getPage(fx.owner.ctx, asBlockId(pageId)))?.plainTitle ?? null

describe('① 서브트리가 통째로 다시 생긴다', () => {
  test('★ 원본과 자손이 새 id 로 복제된다 — 원본은 그대로다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('기획')
    const child = await newPage('조사', root.id)
    const grand = await newPage('설문', child.id)
    await savePageBody(fx.owner.ctx, root.id, { blocks: [para(randomUUID(), textRun('머리말')), ref(child.id)] })

    const copy = await duplicatePage(fx.owner.ctx, root.id)
    assert.equal(copy.pages, 3, '자기 + 자식 + 손자')
    assert.notEqual(copy.page.id, root.id)

    // 원본은 손대지 않는다.
    assert.equal(await titleOf(root.id), '기획')
    assert.deepEqual((await listChildPages(fx.owner.ctx, root.id)).map((p) => p.id), [child.id])

    // 사본의 트리가 같은 모양이다.
    const copiedChildren = await listChildPages(fx.owner.ctx, copy.page.id)
    assert.deepEqual(copiedChildren.map((p) => p.plainTitle), ['조사'])
    assert.notEqual(copiedChildren[0].id, child.id)
    const copiedGrand = await listChildPages(fx.owner.ctx, copiedChildren[0].id)
    assert.deepEqual(copiedGrand.map((p) => p.plainTitle), ['설문'])
    assert.notEqual(copiedGrand[0].id, grand.id)
  })

  test('본문 블록도 새 id 를 받는다 — 원본의 블록과 겹치지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const page = await newPage('메모')
    const blockId = randomUUID()
    await savePageBody(fx.owner.ctx, page.id, { blocks: [para(blockId, textRun('한 줄'))] })

    const copy = await duplicatePage(fx.owner.ctx, page.id)
    const copied = await bodyOf(copy.page.id)
    assert.equal(copied.blocks.length, 1)
    assert.notEqual(copied.blocks[0].id, blockId)
    assert.equal(toPlainText(copied.blocks[0].title), '한 줄')
  })

  test('빈 페이지도 복제된다 — 오류 없이 제목만 있는 사본', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const page = await newPage('빈 것')
    const copy = await duplicatePage(fx.owner.ctx, page.id)
    assert.equal(copy.pages, 1)
    assert.deepEqual((await bodyOf(copy.page.id)).blocks, [])
  })
})

describe('② 안쪽은 사본을, 바깥은 원본을', () => {
  test('★ 서브트리 안을 가리키던 멘션은 사본을, 밖을 가리키던 멘션은 원본을 가리킨다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const outside = await newPage('바깥 문서')
    const root = await newPage('기획')
    const child = await newPage('조사', root.id)
    await savePageBody(fx.owner.ctx, root.id, {
      blocks: [
        { id: randomUUID(), type: 'paragraph', title: [pageMentionRun(child.id), pageMentionRun(outside.id)] },
        ref(child.id),
      ],
    })

    const copy = await duplicatePage(fx.owner.ctx, root.id)
    const copiedChild = (await listChildPages(fx.owner.ctx, copy.page.id))[0]
    const runs = (await bodyOf(copy.page.id)).blocks[0].title

    assert.equal(mentionTarget(runs[0])?.id, copiedChild.id, '안쪽 멘션은 **사본의** 하위 페이지를 가리킨다')
    assert.notEqual(mentionTarget(runs[0])?.id, child.id)
    assert.equal(mentionTarget(runs[1])?.id, outside.id, '바깥 멘션은 원본을 그대로 가리킨다')

    // 원본의 본문은 그대로다.
    const original = (await bodyOf(root.id)).blocks[0].title
    assert.equal(mentionTarget(original[0])?.id, child.id)
  })

  test('★ 하위 페이지 참조는 사본의 페이지를 가리킨다 — 행과 문서가 같은 자리', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('기획')
    const child = await newPage('조사', root.id)
    await savePageBody(fx.owner.ctx, root.id, { blocks: [ref(child.id), para(randomUUID(), textRun('뒤'))] })

    const copy = await duplicatePage(fx.owner.ctx, root.id)
    const copiedChild = (await listChildPages(fx.owner.ctx, copy.page.id))[0]
    const blocks = (await bodyOf(copy.page.id)).blocks
    assert.deepEqual(blocks.map((b) => b.type), ['page', 'paragraph'], '참조의 자리도 그대로다')
    assert.equal(blocks[0].id, copiedChild.id)
  })
})

describe('③ 어디에 어떤 이름으로 서는가', () => {
  test('★ 사본은 원본 **바로 뒤**에 서고 제목에 꼬리표가 붙는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const parent = await newPage('부모')
    const first = await newPage('첫째', parent.id)
    const second = await newPage('둘째', parent.id)

    const copy = await duplicatePage(fx.owner.ctx, first.id)
    assert.equal(copy.page.plainTitle, `첫째${COPY_SUFFIX}`)
    const children = await listChildPages(fx.owner.ctx, parent.id)
    assert.deepEqual(children.map((p) => p.plainTitle), ['첫째', `첫째${COPY_SUFFIX}`, '둘째'])
    assert.equal(children[1].id, copy.page.id)
    assert.equal(children[2].id, second.id)
  })

  test('자리를 주면 거기에, `null` 이면 최상위에 선다 · 제목을 주면 꼬리표를 붙이지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const source = await newPage('원본')
    const elsewhere = await newPage('다른 부모')

    const moved = await duplicatePage(fx.owner.ctx, source.id, {
      parentPageId: elsewhere.id,
      title: titleFromPlainText('이름 지정'),
    })
    assert.equal(moved.page.parentPageId, elsewhere.id)
    assert.equal(moved.page.plainTitle, '이름 지정')

    const top = await duplicatePage(fx.owner.ctx, source.id, { parentPageId: null })
    assert.equal(top.page.parentPageId, null, '워크스페이스 최상위')
  })

  test('하위 페이지의 제목에는 꼬리표가 붙지 않는다 — 사본임을 말하는 자리는 뿌리 하나다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('뿌리')
    await newPage('자식', root.id)
    const copy = await duplicatePage(fx.owner.ctx, root.id)
    const children = await listChildPages(fx.owner.ctx, copy.page.id)
    assert.deepEqual(children.map((p) => p.plainTitle), ['자식'])
  })
})

describe('④ 본문은 Y.Doc 으로 쓴다', () => {
  test('★ 사본의 행과 Y.Doc 이 같은 본문이다 — 명령이 본문 세션을 거쳤다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('기획')
    const child = await newPage('조사', root.id)
    await savePageBody(fx.owner.ctx, root.id, { blocks: [para(randomUUID(), textRun('머리말')), ref(child.id)] })
    await savePageBody(fx.owner.ctx, child.id, { blocks: [para(randomUUID(), textRun('조사 내용'))] })

    const copy = await duplicatePage(fx.owner.ctx, root.id)
    await assertBodyMatchesYDoc(fx.owner.ctx, copy.page.id, '사본')
    const copiedChild = (await listChildPages(fx.owner.ctx, copy.page.id))[0]
    await assertBodyMatchesYDoc(fx.owner.ctx, copiedChild.id, '사본의 자식')
    assert.equal(toPlainText((await bodyOf(copiedChild.id)).blocks[0].title), '조사 내용', '자식의 본문도 복제된다')
  })

  test('아이콘 · 커버(format)도 따라온다 — 사본은 원본과 같은 모습이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const page = await newPage('꾸민 것')
    await query(`UPDATE block SET format = '{"page_icon":"🌱"}'::jsonb WHERE id = $1`, [page.id])

    const copy = await duplicatePage(fx.owner.ctx, page.id)
    const rows = await query<{ format: Record<string, unknown> }>(`SELECT format FROM block WHERE id = $1`, [copy.page.id])
    assert.deepEqual(rows[0].format, { page_icon: '🌱' })
  })
})

describe('⑤ 볼 수 없는 하위 페이지', () => {
  test('★ 볼 수 없는 하위 페이지는 복제하지 않고, 그 참조도 사본 본문에서 뺀다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('공유 문서')
    const open = await newPage('보이는 자식', root.id)
    const secret = await newPage('비밀 자식', root.id)
    const underSecret = await newPage('비밀의 자식', secret.id)
    await savePageBody(fx.owner.ctx, root.id, { blocks: [ref(open.id), ref(secret.id)] })

    // `other` 는 root 는 보지만 secret 은 못 본다.
    assert.equal((await stopInheriting(fx.owner.ctx, secret.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, secret.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, secret.id, { type: 'workspace_everyone', id: null })).ok, true)

    const copy = await duplicatePage(other.ctx, root.id)
    assert.equal(copy.pages, 2, '자기 + 보이는 자식')
    assert.equal(copy.skipped, 2, '비밀 자식과 그 자손')

    const children = await listChildPages(fx.owner.ctx, copy.page.id)
    assert.deepEqual(children.map((p) => p.plainTitle), ['보이는 자식'])

    const blocks = (await bodyOf(copy.page.id)).blocks
    assert.deepEqual(blocks.map((b) => b.id), [children[0].id], '볼 수 없던 참조는 빠졌다')

    // 원본은 그대로다 — 비밀 자식도 그 자손도 살아 있다.
    assert.equal(await titleOf(secret.id), '비밀 자식')
    assert.equal(await titleOf(underSecret.id), '비밀의 자식')
  })

  test('★ 볼 수 없는 **부모 아래**의 볼 수 있는 손자도 빠진다 — 조부모에 붙이지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('뿌리')
    const middle = await newPage('가운데', root.id)
    const leaf = await newPage('잎', middle.id)
    await savePageBody(fx.owner.ctx, root.id, { blocks: [ref(middle.id)] })
    await savePageBody(fx.owner.ctx, middle.id, { blocks: [ref(leaf.id)] })

    // 가운데는 못 보게, 잎은 보게 만든다 — 둘 다 자기 스코프를 갖는다.
    for (const id of [middle.id, leaf.id]) {
      assert.equal((await stopInheriting(fx.owner.ctx, id)).ok, true)
      assert.equal((await grantAccess(fx.owner.ctx, id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
      assert.equal((await revokeAccess(fx.owner.ctx, id, { type: 'workspace_everyone', id: null })).ok, true)
    }
    assert.equal((await grantAccess(fx.owner.ctx, leaf.id, { type: 'user', id: other.userId }, 'view')).ok, true)

    // 잎은 볼 수 있지만 그 자리(가운데)를 복제하지 못한다 — 조부모에 붙이면 원본에 없던 부모-자식이 생긴다.
    const copy = await duplicatePage(other.ctx, root.id)
    assert.equal(copy.pages, 1, '뿌리만')
    assert.equal(copy.skipped, 2)
    assert.deepEqual(await listChildPages(fx.owner.ctx, copy.page.id), [])
    assert.deepEqual((await bodyOf(copy.page.id)).blocks, [])
  })
})

describe('⑥ 거부하면 아무것도 남지 않는다', () => {
  test('★ 자기 자신 · 자기 자손 안으로는 복제할 수 없다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('뿌리')
    const child = await newPage('자식', root.id)
    const before = (await listChildPages(fx.owner.ctx, root.id)).length

    for (const target of [root.id, child.id]) {
      const failed = await duplicatePage(fx.owner.ctx, root.id, { parentPageId: target }).catch((e) => e)
      assert.ok(failed instanceof DuplicateError, String(failed))
      assert.equal(failed.code, 'cycle')
    }
    assert.equal((await listChildPages(fx.owner.ctx, root.id)).length, before, '아무것도 생기지 않았다')
  })

  test('★ 볼 수 없는 페이지는 없는 페이지와 같은 답이다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const secret = await newPage('비밀')
    assert.equal((await stopInheriting(fx.owner.ctx, secret.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, secret.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, secret.id, { type: 'workspace_everyone', id: null })).ok, true)

    const denied = await duplicatePage(other.ctx, secret.id).catch((e) => e)
    assert.ok(denied instanceof DuplicateError)
    assert.equal(denied.code, 'not_found')

    const ghost = await duplicatePage(fx.owner.ctx, asBlockId(randomUUID())).catch((e) => e)
    assert.equal(ghost.code, 'not_found')
  })

  test(`★ 페이지 ${MAX_DUPLICATE_PAGES}개를 넘으면 거부한다 — 반쯤 복제하고 멈추지 않는다`, async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const root = await newPage('큰 것')
    // 상한 + 1 개(자기 포함)가 되도록 자식을 만든다.
    for (let i = 0; i < MAX_DUPLICATE_PAGES; i += 1) await newPage(`자식 ${i}`, root.id)

    const before = await query<{ n: string }>(`SELECT count(*) AS n FROM block WHERE workspace_id = $1`, [fx.workspaceId])
    const failed = await duplicatePage(fx.owner.ctx, root.id).catch((e) => e)
    assert.ok(failed instanceof DuplicateError, String(failed))
    assert.equal(failed.code, 'too_large')
    const after = await query<{ n: string }>(`SELECT count(*) AS n FROM block WHERE workspace_id = $1`, [fx.workspaceId])
    assert.equal(after[0].n, before[0].n, '블록이 하나도 늘지 않았다')
  })

  test('볼 수만 있는 사람도 복제할 수 있다 — 원본을 고치지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const source = await newPage('읽기만')
    assert.equal((await stopInheriting(fx.owner.ctx, source.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, source.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, source.id, { type: 'workspace_everyone', id: null })).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, source.id, { type: 'user', id: other.userId }, 'view')).ok, true)

    // 사본은 그 사람이 만들 수 있는 자리(워크스페이스 최상위)에 둔다.
    const copy = await duplicatePage(other.ctx, source.id, { parentPageId: null })
    assert.equal(copy.page.plainTitle, `읽기만${COPY_SUFFIX}`)
  })
})
