/**
 * 동기화 블록의 수명 — 모두 해제 · 사본 수 · 복제 (SB-4 · F-01-11 · 정본 [보강 SB-0] ⑫ⓑ ⑬ ⑭ [SB-4 고침])
 *
 * 이 파일이 지키는 것.
 *
 *   ① 모두 해제는 행위자가 **고칠 수 있는** 사본 페이지(`edit_content` · 잠기지 않음)에만 X 의 내용을 새 id 로 편다. 보기만 하는 · 볼 수 없는 ·
 *      잠긴 페이지의 사본은 손대지 않는다 — 그 페이지의 Y.Doc · 행 · 검색 색인에 X 의 글이 없다(⑫ⓑ 판결). 같은 페이지의 사본도 펴고 X 의
 *      껍데기를 벗긴다(자식 id 그대로) · 결과의 펴 넣은 수 · 남긴 수 · 남은 사본은 `missing`
 *   ② A 와 사본 페이지들을 한 문장에서 id 순으로 잠근다 — 가장 큰 id 에서 막히면 그보다 작은 것은 모두 이미 쥐었다
 *   ③ 사본이 없으면 아무것도 쓰지 않는다(`no_copies`) · 권한 · 없는 것 · 상한
 *   ④ 사본 수 — 볼 수 없는 페이지까지 · 휴지통은 빼고 · `elsewhere` 는 A 밖 · A 를 볼 수 없으면 답하지 않는다
 *   ⑤ 복제(⑭) — 페이지를 복제하면 원본 X 는 X 를 가리키는 사본이 된다(내용을 복사하지 않는다 · 원본 페이지의 X 는 그대로)
 *
 * 사본 하나의 해제(⑫ⓐ)는 B 의 편집기가 하는 한 트랜잭션이다(서버 명령이 아니다) — 내용은 A 를 볼 수 있을 때만 화면에 있고(협업 서버의 embed
 * 문 · SB-2 db 검사) 쓰기는 B 의 협업 연결의 문(B 의 `edit`)을 지난다. 명령의 거부는 단위 검사(`editor/synced-block.test.ts` ⑧)가 본다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { textRun } from '../contracts/rich-text.ts'
import { getPool } from '../db/pool.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import type { EditorBlock } from '../editor/document.ts'
import { asBlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import type { SessionContext } from '../auth/session-context.ts'
import { openPageBody } from './body-write.ts'
import { duplicatePage } from './duplicate.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'
import { SYNCED_BLOCK_TYPE } from './synced-block.ts'
import { unsyncAllSyncedCopies } from './synced-block-lifecycle.ts'
import { countSyncedCopies, resolveSyncedBlock } from './synced-block-resolve.ts'
import { trashPage } from './trash.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })
const copyOf = (x: string): EditorBlock => ({ id: randomUUID(), type: SYNCED_BLOCK_TYPE, title: [], properties: { synced_from: x }, format: {}, children: [] })

async function newPage(ctx: SessionContext, blocks: EditorBlock[], privateTop = false): Promise<string> {
  const page = (await createPage(ctx, { title: titleFromPlainText(`수명 ${randomUUID().slice(0, 8)}`), privateTop })).id
  const saved = await savePageBody(ctx, page, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page
}

/** 원본 X(글 둘) 가 든 페이지 — 글에는 이 검사만의 표지를 넣는다. */
async function originalPage(ctx: SessionContext, extra: EditorBlock[] = []) {
  const mark = `동기화내용${randomUUID().slice(0, 6)}`
  const [x, a1, a2] = [randomUUID(), randomUUID(), randomUUID()]
  const page = await newPage(ctx, [
    { id: x, type: SYNCED_BLOCK_TYPE, title: [], properties: {}, format: {}, children: [para(a1, `${mark} 하나`), para(a2, '둘')] },
    ...extra,
  ])
  return { page, x, a1, a2, mark }
}

/** 그 페이지의 Y.Doc(본문 세션의 읽기) · 행 · 검색 색인에 이 글이 있는가. */
async function textIn(page: string, text: string): Promise<{ ydoc: boolean; rows: boolean; index: boolean }> {
  const ydoc = await withTransaction(async (tx) => JSON.stringify((await openPageBody(tx, fx.owner.ctx, page)).read()).includes(text))
  return withReadTransaction(async (tx) => {
    const rows = (await tx.query(`SELECT 1 FROM block WHERE ancestor_path @> ARRAY[$1]::uuid[] AND lifecycle = 'live' AND properties::text LIKE $2`, [page, `%${text}%`])).length > 0
    const index = (await tx.queryMaybe<{ body_text: string | null }>(`SELECT body_text FROM search_document WHERE doc_id = $1`, [page]))?.body_text?.includes(text) ?? false
    return { ydoc, rows, index }
  })
}

const NONE = { ydoc: false, rows: false, index: false }
const ALL = { ydoc: true, rows: true, index: true }

/** 본문의 최상위 — 사본은 `→X`, 원본은 `원본`, 글은 글. id 도 함께. */
async function top(page: string): Promise<{ id: string; shape: string }[]> {
  const doc = await withTransaction(async (tx) => (await openPageBody(tx, fx.owner.ctx, page)).read())
  return doc.blocks.map((b) => ({
    id: b.id,
    shape: b.type !== SYNCED_BLOCK_TYPE ? b.title.map((r) => r.plain_text).join('') : b.properties?.synced_from ? `→${String(b.properties.synced_from)}` : '원본',
  }))
}

describe('모두 해제 (⑫ⓑ)', () => {
  test('★ ① 고칠 수 있는 사본 페이지에만 새 id 로 편다 — 보기만 · 볼 수 없는 · 잠긴 페이지의 사본에는 X 의 글이 없다(Y.Doc · 행 · 색인) · 같은 페이지 사본도 · X 는 껍데기만 벗는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mate = await joinAs(fx.workspaceId, await createUser(`해제하는 동료 ${randomUUID().slice(0, 6)}`), 'member')
    // A — 동료의 페이지(같은 페이지의 사본 하나) · B — 동료가 고칠 수 있다
    const { page: a, x, a1, a2, mark } = await originalPage(mate.ctx)
    const sameCopy = copyOf(x)
    assert.ok((await savePageBody(mate.ctx, a, { blocks: [...(await withTransaction(async (tx) => (await openPageBody(tx, mate.ctx, a)).read())).blocks, sameCopy] })).ok)
    const b = await newPage(mate.ctx, [para(randomUUID(), 'B 앞'), copyOf(x), copyOf(x)])
    // V — 소유자의 개인 페이지 · 동료는 보기만 / H — 동료가 볼 수 없다 / L — 동료의 페이지지만 잠겼다
    const v = await newPage(fx.owner.ctx, [copyOf(x)], true)
    assert.ok((await grantAccess(fx.owner.ctx, v, { type: 'user', id: mate.userId }, 'view')).ok)
    const h = await newPage(fx.owner.ctx, [copyOf(x)], true)
    const l = await newPage(mate.ctx, [copyOf(x)])
    assert.ok((await setPageLock(mate.ctx, l, true)).ok)

    const result = await unsyncAllSyncedCopies(mate.ctx, a, x)
    assert.deepEqual(result, { ok: true, value: { state: 'done', expanded: 2, left: 3 } }, '편 곳 B · A(같은 페이지 사본) · 남긴 곳 V · H · L')

    // A — X 의 껍데기가 벗겨지고 자식은 제자리(id 그대로) · 같은 페이지의 사본은 새 id 로 편 내용
    const aTop = await top(a)
    assert.deepEqual(aTop.slice(0, 2).map((r) => r.id), [a1, a2], 'X 의 자식이 그 자리에 · id 그대로')
    assert.deepEqual(aTop.map((r) => r.shape), [`${mark} 하나`, '둘', `${mark} 하나`, '둘'])
    assert.ok(!aTop.slice(2).some((r) => r.id === a1 || r.id === a2), '같은 페이지 사본의 내용은 새 id')
    // B — 사본 둘이 저마다 새 id 의 내용으로
    const bTop = await top(b)
    assert.deepEqual(bTop.map((r) => r.shape), ['B 앞', `${mark} 하나`, '둘', `${mark} 하나`, '둘'])
    assert.equal(new Set(bTop.map((r) => r.id)).size, 5, '사본마다 새 id — 어떤 id 도 두 번 서지 않는다(SY1)')
    assert.deepEqual(await textIn(b, mark), ALL, '고칠 수 있는 페이지 — Y.Doc · 행 · 색인에 X 의 글')

    // 고칠 수 없는 셋 — 사본 그대로 · X 의 글이 어디에도 없다
    for (const [page, why] of [[v, '보기만'], [h, '볼 수 없다'], [l, '잠겼다']] as const) {
      assert.deepEqual((await top(page)).map((r) => r.shape), [`→${x}`], `${why} — 사본 그대로`)
      assert.deepEqual(await textIn(page, mark), NONE, `${why} — 그 페이지에 X 의 글이 없다`)
    }
    // 원본이 껍데기를 벗었다 — 남은 사본은 "원본이 삭제되었다"
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, x), { state: 'missing' })
  })

  test('★ ② 잠금 순서 — A 와 사본 페이지들을 한 문장에서 id 순으로(가장 큰 id 에서 막히면 작은 것은 모두 이미 쥐었다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page: a, x } = await originalPage(fx.owner.ctx)
    const copies = [await newPage(fx.owner.ctx, [copyOf(x)]), await newPage(fx.owner.ctx, [copyOf(x)]), await newPage(fx.owner.ctx, [copyOf(x)])]
    const sorted = [a, ...copies].sort()
    const last = sorted[sorted.length - 1]!
    const holder = await getPool().connect()
    const probe = await getPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT id FROM block WHERE id = $1 FOR UPDATE', [last])
      const running = unsyncAllSyncedCopies(fx.owner.ctx, a, x)
      // 명령이 잠그기 시작했다 = 가장 작은 id 를 쥐었다(다른 검사 파일의 잠금 대기에 속지 않게 그 행으로 본다) — 한 문장이라 곧 가장 큰 id 에서 막힌다
      let started = false
      for (let i = 0; i < 200 && !started; i += 1) {
        await probe.query('BEGIN')
        await probe.query('SELECT id FROM block WHERE id = $1 FOR UPDATE NOWAIT', [sorted[0]]).catch((e: { code?: string }) => {
          started = e.code === '55P03'
        })
        await probe.query('ROLLBACK')
        if (!started) await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.ok(started, '전제: 명령이 잠그기 시작했다')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const held: string[] = []
      for (const id of sorted.slice(0, -1)) {
        await probe.query('BEGIN')
        await probe.query('SELECT id FROM block WHERE id = $1 FOR UPDATE NOWAIT', [id]).catch((e: { code?: string }) => {
          if (e.code === '55P03') held.push(id)
        })
        await probe.query('ROLLBACK')
      }
      assert.deepEqual(held, sorted.slice(0, -1), '그보다 작은 id 는 모두 이미 쥐었다 — 한 방향으로 잠근다')
      await holder.query('COMMIT')
      assert.deepEqual(await running, { ok: true, value: { state: 'done', expanded: 3, left: 0 } })
    } finally {
      holder.release()
      probe.release()
    }
  })

  test('★ ③ 사본이 없으면 아무것도 쓰지 않는다 · 권한(볼 수 없음 404 · 보기만 · 잠긴 A 403) · 없는 원본 · 사본의 id · 상한', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page: a, x } = await originalPage(fx.owner.ctx)
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, a, x), { ok: true, value: { state: 'no_copies' } })
    assert.deepEqual((await top(a))[0]?.shape, '원본', '아무것도 쓰지 않았다 — 편집기가 벗긴다(⑫ⓒ)')

    const copyPage = await newPage(fx.owner.ctx, [copyOf(x)])
    const copyId = (await top(copyPage))[0]!.id
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, a, randomUUID()), { ok: false, reason: 'not_found' }, 'A 의 문서에 없는 원본')
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, copyPage, copyId), { ok: false, reason: 'not_found' }, '사본은 원본이 아니다')
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, 'nope', x), { ok: false, reason: 'not_found' })

    const guest = await joinAs(fx.workspaceId, await createUser('해제하려는 손님'), 'guest')
    assert.deepEqual(await unsyncAllSyncedCopies(guest.ctx, a, x), { ok: false, reason: 'not_found' }, '볼 수 없으면 없는 것과 같다')
    assert.ok((await grantAccess(fx.owner.ctx, a, { type: 'user', id: guest.userId }, 'view')).ok)
    assert.deepEqual(await unsyncAllSyncedCopies(guest.ctx, a, x), { ok: false, reason: 'forbidden' }, '보기만 하면 거부')
    assert.ok((await setPageLock(fx.owner.ctx, a, true)).ok)
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, a, x), { ok: false, reason: 'forbidden' }, '잠긴 A 는 고칠 수 없다')
    assert.ok((await setPageLock(fx.owner.ctx, a, false)).ok)

    await newPage(fx.owner.ctx, [copyOf(x)])
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, a, x, 1), { ok: false, reason: 'too_many' }, '사본 페이지 둘 · 상한 하나')
    assert.deepEqual((await top(copyPage)).map((r) => r.shape), [`→${x}`], '거부하면 아무것도 바꾸지 않는다')
    assert.deepEqual(await unsyncAllSyncedCopies(fx.owner.ctx, a, x, 2), { ok: true, value: { state: 'done', expanded: 2, left: 0 } }, '상한과 같으면 된다')
  })
})

describe('사본 수 (⑬ · ⑪ⓒ)', () => {
  test('★ ④ 볼 수 없는 페이지까지 센다(수만) · 휴지통은 빼고 · elsewhere 는 A 밖 · A 를 볼 수 없으면 답하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page: a, x } = await originalPage(fx.owner.ctx)
    assert.ok((await savePageBody(fx.owner.ctx, a, { blocks: [...(await withTransaction(async (tx) => (await openPageBody(tx, fx.owner.ctx, a)).read())).blocks, copyOf(x)] })).ok)
    await newPage(fx.owner.ctx, [copyOf(x), copyOf(x)])
    await newPage(fx.owner.ctx, [copyOf(x)], true)
    const trashed = await newPage(fx.owner.ctx, [copyOf(x)])
    await trashPage(fx.owner.ctx, asBlockId(trashed))
    assert.deepEqual(await countSyncedCopies(fx.owner.ctx, x), { copies: 4, elsewhere: 3 })

    const mate = await joinAs(fx.workspaceId, await createUser('세는 동료'), 'guest')
    assert.equal(await countSyncedCopies(mate.ctx, x), null, 'A 를 볼 수 없으면 답하지 않는다')
    assert.ok((await grantAccess(fx.owner.ctx, a, { type: 'user', id: mate.userId }, 'view')).ok)
    assert.deepEqual(await countSyncedCopies(mate.ctx, x), { copies: 4, elsewhere: 3 }, '볼 수 없는 페이지의 사본도 센다 — 수만')
    assert.equal(await countSyncedCopies(fx.owner.ctx, randomUUID()), null)
  })
})

describe('복제 (⑭)', () => {
  test('★ ⑤ 페이지를 복제하면 원본 X 는 X 를 가리키는 사본이 된다 — 내용을 복사하지 않는다 · 원본 페이지의 X 는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { page: a, x, mark } = await originalPage(fx.owner.ctx, [para(randomUUID(), '끝 줄')])
    const dup = await duplicatePage(fx.owner.ctx, asBlockId(a))
    const dupTop = await top(dup.page.id)
    assert.deepEqual(dupTop.map((r) => r.shape), [`→${x}`, '끝 줄'], '복제본의 동기화 블록은 X 의 사본')
    assert.notEqual(dupTop[0]!.id, x)
    assert.deepEqual(await textIn(dup.page.id, mark), NONE, '복제본에 X 의 글이 없다(SY1 · SY9)')
    const row = await withReadTransaction((tx) =>
      tx.queryOne<{ properties: Record<string, unknown> }>(`SELECT properties FROM block WHERE id = $1`, [dupTop[0]!.id]),
    )
    assert.deepEqual(row.properties, { synced_from: x }, '사본 행')
    assert.deepEqual((await top(a))[0], { id: x, shape: '원본' }, '원본 페이지의 X 는 원본 그대로')
    assert.deepEqual(await resolveSyncedBlock(fx.owner.ctx, x), { state: 'ok', pageId: a })
  })
})
