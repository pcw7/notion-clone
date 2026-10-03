/**
 * 버전 복원 — 잔여 묶음 8d-3 (F-11-02 · DB)
 *
 * 시각은 로그의 `created_at` 을 뒤로 밀어 흉내 낸다(`version.db.test.ts` 와 같다).
 *
 *   ① ★ 순서 — 되돌리기 전 상태(`pre_restore`) · `origin='restore'` update(행위자) · `restore` 버전(`restored_from`) · 본문과 행이 그 버전이다
 *   ② ★ 여는 순간 쉼 버전이 지금을 담으면 그것이 되돌리기 전의 상태다 — `pre_restore` 를 따로 만들지 않는다
 *   ③ ★ 지금과 같으면 아무것도 쓰지 않는다 — 새 버전도 로그도 없다
 *   ④ ★ 하위 페이지는 복원 대상이 아니다 — 휴지통의 자식을 되살리지 않고 · 지금의 자식을 지킨다(끝에 붙인다)
 *   ⑤ ★ 권한 — 볼 수만 있으면 forbidden · 못 보면 not_found · 잠기면 locked · 지난 버전 expired · 다른 페이지의 버전 · 바이트 없음 not_found
 *   ⑥ 되돌리기 취소 — 되돌리기 전의 버전을 다시 되돌린다
 *   ⑦ ★ 멘션 알림을 보내지 않는다 — 백링크(역인덱스)는 되살아난다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { textRun, toPlainText, userMentionRun } from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import type { BlockId } from '../ids.ts'
import { restoreVersion } from './restore.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let mate: Actor
const store = new Map<string, Uint8Array>()

function memoryStorage(): FileStorage {
  return {
    kind: 'memory',
    async put(key, bytes) {
      store.set(key, bytes)
    },
    async read(key) {
      return store.get(key) ?? null
    },
    async remove(key) {
      store.delete(key)
    },
  }
}

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  setFileStorage(memoryStorage())
  fx = await makeFixture()
  mate = await joinAs(fx.workspaceId, await createUser('복원 동료'), 'member')
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })

async function newPage(title: string, options: { privateTop?: true; parentPageId?: string } = {}): Promise<string> {
  return (
    await createPage(fx.owner.ctx, {
      title: titleFromPlainText(title),
      ...(options.privateTop ? { privateTop: true } : {}),
      ...(options.parentPageId ? { parentPageId: options.parentPageId as BlockId } : {}),
    })
  ).id
}

async function save(pageId: string, doc: EditorDoc): Promise<void> {
  const saved = await savePageBody(fx.owner.ctx, pageId as BlockId, doc)
  assert.equal(saved.ok, true, JSON.stringify(saved))
}
const write = (pageId: string, texts: readonly string[]) => save(pageId, { blocks: texts.map((t) => para(t)) })

async function age(pageId: string): Promise<void> {
  await query(`UPDATE doc_update SET created_at = created_at - interval '3 minutes' WHERE page_id = $1`, [pageId])
}

type Row = { id: string; reason: string; through_seq: string; restored_from: string | null; editor_ids: string[]; state_ref: string }
const versionsOf = (pageId: string) =>
  query<Row>(
    `SELECT id, reason, through_seq, restored_from, editor_ids, state_ref FROM page_version WHERE page_id = $1 ORDER BY through_seq`,
    [pageId],
  )
const lastLog = async (pageId: string) =>
  (
    await query<{ seq: string; origin: string; actor_id: string | null }>(
      `SELECT seq, origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq DESC LIMIT 1`,
      [pageId],
    )
  )[0]

async function bodyOf(pageId: string): Promise<EditorBlock[]> {
  const body = await loadPageBody(fx.owner.ctx, pageId as BlockId)
  assert.ok(body !== null)
  return body.doc.blocks
}
const textsOf = (blocks: readonly EditorBlock[]) => blocks.map((b) => (b.type === 'page' ? `[${b.id}]` : toPlainText(b.title)))

async function restore(pageId: string, versionId: string, actor: Actor = fx.owner) {
  const result = await restoreVersion(actor.ctx, pageId, versionId)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

describe('① 순서', () => {
  test('★ 되돌리기 전 상태 · restore update · restore 버전 — 본문과 행이 그 버전이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('복원 순서')
    await write(page, ['처음'])
    await age(page)
    await write(page, ['둘째']) // 쉼 버전(through 2 — '처음')
    await write(page, ['지금'])
    const [first] = await versionsOf(page)
    const beforeSeq = (await lastLog(page)).seq

    const done = await restore(page, first.id, mate)
    assert.equal(done.noop, false)
    const versions = await versionsOf(page)
    assert.deepEqual(versions.map((v) => [v.reason, v.through_seq, v.restored_from]), [
      ['idle', '2', null],
      ['pre_restore', beforeSeq, null],
      ['restore', String(BigInt(beforeSeq) + 1n), first.id],
    ])
    assert.equal(done.beforeVersionId, versions[1].id)
    assert.equal(done.restoredVersionId, versions[2].id)
    assert.deepEqual(versions[2].editor_ids, [mate.userId], '되돌린 사람이 그 구간을 고쳤다')
    assert.deepEqual(await lastLog(page), { seq: versions[2].through_seq, origin: 'restore', actor_id: mate.userId })
    assert.deepEqual(textsOf(await bodyOf(page)), ['처음'], '본문(행의 투영)이 그 버전이다')
    const [row] = await query<{ last_edited_by: string }>(`SELECT last_edited_by FROM block WHERE id = $1`, [page])
    assert.equal(row.last_edited_by, mate.userId, '마지막으로 고친 사람은 되돌린 사람')
  })
})

describe('② 쉼 버전이 지금을 담았다', () => {
  test('★ 여는 순간의 판정이 지금을 남기면 그것이 되돌리기 전의 상태다 — pre_restore 를 따로 만들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('쉰 뒤 복원')
    await write(page, ['가'])
    await age(page)
    await write(page, ['나']) // 쉼 버전(through 2 — '가')
    await age(page) // '나' 의 세션도 끝났다 — 되돌리는 순간의 판정이 그것을 남긴다
    const [first] = await versionsOf(page)

    const done = await restore(page, first.id)
    const versions = await versionsOf(page)
    assert.deepEqual(versions.map((v) => v.reason), ['idle', 'idle', 'restore'])
    assert.equal(done.beforeVersionId, versions[1].id, '되돌리기 전의 상태는 방금 판정이 남긴 쉼 버전이다')
  })
})

describe('③ 같은 내용', () => {
  test('★ 지금과 같으면 아무것도 쓰지 않는다 — 새 버전도 로그도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('같은 복원')
    await write(page, ['하나'])
    await age(page)
    await write(page, ['둘'])
    const [first] = await versionsOf(page)
    await restore(page, first.id)
    const versionCount = (await versionsOf(page)).length
    const seq = (await lastLog(page)).seq

    const again = await restore(page, first.id)
    assert.deepEqual(again, { noop: true, beforeVersionId: null, restoredVersionId: null })
    assert.equal((await versionsOf(page)).length, versionCount, '새 버전이 없다')
    assert.equal((await lastLog(page)).seq, seq, '로그에 쌓지 않았다')
  })

  test('★ 휴지통에 간 자식의 참조만 다른 버전도 같은 내용이다 — 쓰지 않는다(그 참조를 먼저 뺀다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('휴지통 자식만 다른 부모')
    const old = await newPage('버린 자식', { parentPageId: parent })
    await save(parent, { blocks: [para('그대로인 글'), ...(await bodyOf(parent)).filter((b) => b.type === 'page')] })
    await age(parent)
    await trashPage(fx.owner.ctx, old as BlockId) // 여는 순간의 판정이 [그대로인 글 · 버린 자식] 을 남긴다
    const [version] = await versionsOf(parent)
    assert.deepEqual(textsOf(await bodyOf(parent)), ['그대로인 글'])
    const versionCount = (await versionsOf(parent)).length
    const seq = (await lastLog(parent)).seq

    assert.deepEqual(await restore(parent, version.id), { noop: true, beforeVersionId: null, restoredVersionId: null })
    assert.equal((await versionsOf(parent)).length, versionCount, '새 버전이 없다')
    assert.equal((await lastLog(parent)).seq, seq, '로그에 쌓지 않았다(넣었다가 투영이 빼는 쓰기가 없다)')
  })
})

describe('④ 하위 페이지', () => {
  test('★ 휴지통의 자식을 되살리지 않고 지금의 자식을 지킨다 — 버전에 없는 자식은 끝에 붙인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('부모')
    const old = await newPage('옛 자식', { parentPageId: parent })
    const withText = async (text: string) => {
      const blocks = await bodyOf(parent)
      await save(parent, { blocks: [para(text), ...blocks.filter((b) => b.type === 'page')] })
    }
    await withText('옛 글')
    await age(parent)
    const fresh = await newPage('새 자식', { parentPageId: parent }) // 여는 순간의 판정이 [옛 글 · 옛 자식] 을 남긴다
    const [version] = await versionsOf(parent)
    assert.deepEqual(textsOf(await bodyOf(parent)), ['옛 글', `[${old}]`, `[${fresh}]`])
    assert.equal((await trashPage(fx.owner.ctx, old as BlockId)).pageId, old)
    await withText('새 글')

    await restore(parent, version.id)
    assert.deepEqual(textsOf(await bodyOf(parent)), ['옛 글', `[${fresh}]`], '휴지통의 자식은 빼고 · 지금의 자식은 끝에')
    const lifecycles = await query<{ id: string; lifecycle: string }>(`SELECT id, lifecycle FROM block WHERE id = ANY($1::uuid[]) ORDER BY id`, [
      [old, fresh],
    ])
    assert.deepEqual(Object.fromEntries(lifecycles.map((r) => [r.id, r.lifecycle])), { [old]: 'trashed', [fresh]: 'live' })
  })
})

describe('⑤ 권한', () => {
  test('★ 볼 수만 있으면 forbidden · 못 보면 not_found · 잠기면 locked · 지난 버전 expired · 다른 페이지 · 바이트 없음 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('권한 복원', { privateTop: true })
    await write(page, ['원래'])
    await age(page)
    await write(page, ['바뀜'])
    const [version] = await versionsOf(page)
    const viewer = await joinAs(fx.workspaceId, await createUser('복원 보기만'), 'member')
    const stranger = await joinAs(fx.workspaceId, await createUser('복원 못 봄'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: viewer.userId }, 'view')).ok)

    assert.deepEqual(await restoreVersion(viewer.ctx, page, version.id), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await restoreVersion(stranger.ctx, page, version.id), { ok: false, reason: 'not_found' })
    assert.ok((await setPageLock(fx.owner.ctx, page, true)).ok)
    assert.deepEqual(await restoreVersion(fx.owner.ctx, page, version.id), { ok: false, reason: 'locked' })
    assert.ok((await setPageLock(fx.owner.ctx, page, false)).ok)

    const other = await newPage('다른 페이지')
    assert.deepEqual(await restoreVersion(fx.owner.ctx, other, version.id), { ok: false, reason: 'not_found' })
    store.delete(version.state_ref)
    assert.deepEqual(await restoreVersion(fx.owner.ctx, page, version.id), { ok: false, reason: 'not_found' }, '바이트가 없으면 빈 본문으로 되돌리지 않는다')
    await query(`UPDATE page_version SET expires_at = now() - interval '1 second' WHERE id = $1`, [version.id])
    assert.deepEqual(await restoreVersion(fx.owner.ctx, page, version.id), { ok: false, reason: 'expired' })
    assert.deepEqual(textsOf(await bodyOf(page)), ['바뀜'], '거부한 뒤 본문은 그대로다')
  })
})

describe('⑥ 되돌리기 취소', () => {
  test('되돌리기 전의 버전을 다시 되돌리면 원래대로 — 그 복원 버전의 출처가 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('취소')
    await write(page, ['옛것'])
    await age(page)
    await write(page, ['지금 것'])
    const [first] = await versionsOf(page)
    const done = await restore(page, first.id)
    assert.deepEqual(textsOf(await bodyOf(page)), ['옛것'])

    const undone = await restore(page, done.beforeVersionId as string)
    assert.deepEqual(textsOf(await bodyOf(page)), ['지금 것'])
    const [last] = (await versionsOf(page)).slice(-1)
    assert.deepEqual([last.reason, last.restored_from, last.id], ['restore', done.beforeVersionId, undone.restoredVersionId])
  })
})

describe('⑦ 멘션', () => {
  test('★ 되살린 멘션은 알림을 보내지 않는다 — 백링크(역인덱스)는 되살아난다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('멘션 복원')
    await save(page, { blocks: [{ ...para('부름 '), title: [textRun('부름 '), userMentionRun(mate.userId)] }] })
    await age(page)
    await write(page, ['멘션 지움'])
    const [withMention] = await versionsOf(page)
    const notified = async () =>
      (await query<{ n: number }>(`SELECT count(*)::int AS n FROM notification WHERE recipient_id = $1 AND page_id = $2`, [mate.userId, page]))[0].n
    const edges = async () =>
      (await query<{ n: number }>(`SELECT count(*)::int AS n FROM link_edge WHERE source_page_id = $1 AND target_kind = 'user' AND target_id = $2`, [page, mate.userId]))[0]
        .n
    const notifiedBefore = await notified()
    assert.equal(await edges(), 0, '전제 — 멘션을 지웠다')

    await restore(page, withMention.id)
    assert.equal(await edges(), 1, '백링크는 되살아난다')
    assert.equal(await notified(), notifiedBefore, '알림은 다시 가지 않는다')
  })
})
