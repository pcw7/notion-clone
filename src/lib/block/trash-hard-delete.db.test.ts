/**
 * 물리 삭제 — 히스토리 · 활동 4b-2 (DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 지운다 — 묶음의 페이지 · 본문 블록 · FK 없는 다섯(권한 · doc 로그 · 스냅샷 · 버전과 그 바이트 · 반응) · CASCADE 로 따라오는
 *      것(스레드 · 즐겨찾기 · 최근 방문 · 검색 문서). 참조를 내린다(본문 이미지 · 파일 아이콘 · 버전 S5). 때가 안 된 purged ·
 *      휴지통 · 살아 있는 것은 그대로 · 두 번 돌아도 같다
 *   ② 기다린다 — 따로 먼저 버린 하위 페이지가 남아 있으면 그 묶음은 지우지 않는다(그 페이지는 휴지통에서 계속 보인다) · 기다리는
 *      묶음이 한 판을 차지하지 않는다 · 자손이 지워지면 다음 판에
 *   ③ 소스 묶음 — 소스 · 그 행 · 속성 · 뷰 · 관계 간선이 함께 · 소스 아래 따로 먼저 버린 행이 남아 있으면 기다린다
 *   ④ 루트를 다른 쪽이 쥐고 있으면 건너뛰고 기다리지 않는다
 *   ⑤ 한 판의 상한
 *
 * 검사는 자기 워크스페이스만 지운다(`workspaces`) — 진짜 GC 는 다른 검사의 휴지통도 지운다.
 *
 * 반사실(HANDOFF §3.3): FK 없는 행을 지우지 않으면 ①, 참조를 내리지 않으면 ①, 기다리지 않으면 ② · ③, 후보에서 거르지 않으면 ② 의
 * 상한, 루트를 기다리면 ④, 상한을 무시하면 ⑤ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { uploadFile } from '../file/file.ts'
import { asBlockId, type BlockId } from '../ids.ts'
import { createPage, setPageIcon, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'
import { listTrash, purgePage, trashPage } from './trash.ts'
import { runTrashHardDelete } from './trash-hard-delete.ts'
import { createDiscussion, toggleReaction } from '../comment/discussion.ts'
import { grantAccess } from '../permissions/acl.ts'
import { addFavorite, recordVisit } from '../nav/recent.ts'
import { createDatabase } from '../database/database.ts'
import { addDataSource, purgeDataSource, trashDataSource } from '../database/data-source.ts'
import { createRow, trashRow } from '../database/row.ts'
import { addRelationProperty, linkRows } from '../database/relation.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor
const store = new Map<string, Uint8Array>()

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  const memory: FileStorage = {
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
  setFileStorage(memory)
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const DAY = 86_400_000
/** 영구 삭제(지금) 뒤 30일이 지난 시각. */
const later = () => new Date(Date.now() + 31 * DAY)
const hardDelete = (now: Date, batch?: number) =>
  runTrashHardDelete(now, { workspaces: [fx.workspaceId], ...(batch === undefined ? {} : { batch }) })
/** 이 워크스페이스의 다른 지울 묶음을 미리 지워 둔다 — 검사마다 결과의 수가 그 검사의 것만이 되게. */
const settle = async (now: Date) => {
  while ((await hardDelete(now)).more) {
    // 한 판이 꽉 찼으면 다시
  }
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const page = async (title: string, parent: BlockId | null = null) =>
  (await createPage(fx.owner.ctx, { parentPageId: parent, title: titleFromPlainText(title) })).id
const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })
const imageOf = (fileId: string): EditorBlock => ({
  id: randomUUID(),
  type: 'image',
  title: [],
  properties: { source: { type: 'file', file_id: fileId } },
  format: {},
  children: [],
})
async function write(pageId: string, blocks: EditorBlock[]): Promise<void> {
  const saved = await savePageBody(fx.owner.ctx, pageId as BlockId, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
}
/** 쉬었다가 쓴다 — 쓰기 전의 상태가 버전으로 남는다(쉼 2분). */
async function restAndWrite(pageId: string, blocks: EditorBlock[]): Promise<void> {
  await query(`UPDATE doc_update SET created_at = created_at - interval '3 minutes' WHERE page_id = $1`, [pageId])
  await write(pageId, blocks)
}
async function upload(name: string): Promise<string> {
  const up = await uploadFile(fx.owner.ctx, { bytes: new Uint8Array(16).fill(3), mime: 'image/png', originalName: name })
  assert.equal(up.ok, true)
  if (!up.ok) throw new Error('unreachable')
  return up.file.id
}
const refCount = async (fileId: string) => (await queryOne<{ ref_count: number }>(`SELECT ref_count FROM file WHERE id = $1`, [fileId])).ref_count
/** 버리고 곧바로 영구 삭제 — `purged_at` 은 지금. */
async function purged(root: string): Promise<void> {
  await trashPage(fx.owner.ctx, asBlockId(root))
  await purgePage(fx.owner.ctx, asBlockId(root))
}
const alive = async (ids: readonly string[]) =>
  (await query<{ id: string }>(`SELECT id FROM block WHERE id = ANY($1::uuid[])`, [ids])).map((r) => r.id).sort()
const countOf = async (sql: string, params: unknown[]) => (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).n

describe('① 지운다', () => {
  test('★ 페이지 · 본문 · FK 없는 다섯 · CASCADE 가 함께 사라지고 참조가 내려간다 — 때가 안 된 것 · 휴지통 · 살아 있는 것은 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)

    const root = await page('지울 묶음')
    const imageFile = await upload('본문.png')
    const iconFile = await upload('아이콘.png')
    await write(root, [para('사진'), imageOf(imageFile)])
    await restAndWrite(root, [para('사진'), imageOf(imageFile), para('더')]) // 버전 하나 — 이미지를 담았다(S5)
    // 자식은 본문을 다 쓴 뒤에 — 만들면 부모 본문에 참조가 생기고, 그 참조를 뺀 본문은 저장이 거부된다
    const child = await page('자식', root)
    await write(child, [para('자식 본문')])
    await setPageIcon(fx.owner.ctx, asBlockId(root), { type: 'file', file_id: iconFile })
    assert.deepEqual([await refCount(imageFile), await refCount(iconFile)], [2, 1], '전제 — 본문 하나 · 버전 하나 · 아이콘 하나')
    const versions = await query<{ state_ref: string }>(`SELECT state_ref FROM page_version WHERE page_id = ANY($1::uuid[])`, [[root, child]])
    assert.ok(versions.length > 0 && versions.every((v) => store.has(v.state_ref)), '전제 — 버전과 그 바이트')
    const content = (await query<{ id: string }>(`SELECT id FROM block WHERE parent_id = ANY($1::uuid[]) AND type <> 'page'`, [[root, child]])).map(
      (r) => r.id,
    )
    assert.ok(content.length >= 3, '전제 — 본문 블록')

    assert.equal((await grantAccess(fx.owner.ctx, root, { type: 'user', id: other.userId }, 'view')).ok, true)
    const thread = await createDiscussion(fx.owner.ctx, { pageId: root, richText: [textRun('스레드')] })
    assert.equal(thread.ok, true, JSON.stringify(thread))
    if (!thread.ok) return
    assert.equal((await toggleReaction(fx.owner.ctx, { targetKind: 'discussion', targetId: thread.discussionId, emoji: '👍' })).ok, true)
    assert.equal((await toggleReaction(fx.owner.ctx, { targetKind: 'comment', targetId: thread.commentId, emoji: '🙂' })).ok, true)
    await addFavorite(fx.owner.ctx, root)
    await recordVisit(fx.owner.ctx, root)

    const due = await page('때가 안 된 것')
    const trashed = await page('휴지통')
    const live = await page('살아 있음')
    await purged(root)
    await purged(due)
    await query(`UPDATE block SET purged_at = now() + interval '10 days' WHERE id = $1`, [due])
    await trashPage(fx.owner.ctx, asBlockId(trashed))

    const ids = [root, child]
    const traces = async () => ({
      acl: await countOf(`acl_entry WHERE node_id = ANY($1::uuid[])`, [ids]),
      docUpdate: await countOf(`doc_update WHERE page_id = ANY($1::uuid[])`, [ids]),
      snapshot: await countOf(`doc_snapshot WHERE page_id = ANY($1::uuid[])`, [ids]),
      version: await countOf(`page_version WHERE page_id = ANY($1::uuid[])`, [ids]),
      reaction: await countOf(`reaction WHERE target_id = ANY($1::uuid[])`, [[thread.discussionId, thread.commentId]]),
      discussion: await countOf(`discussion WHERE page_id = ANY($1::uuid[])`, [ids]),
      favorite: await countOf(`favorite WHERE block_id = ANY($1::uuid[])`, [ids]),
      visit: await countOf(`recent_visit WHERE block_id = ANY($1::uuid[])`, [ids]),
      search: await countOf(`search_document WHERE doc_id = ANY($1::uuid[])`, [[...ids, ...content]]),
    })
    const before = await traces()
    assert.ok(
      before.acl > 0 && before.docUpdate > 0 && before.snapshot > 0 && before.version > 0 && before.reaction === 2 && before.discussion === 1,
      `전제 — 지울 흔적이 있다 ${JSON.stringify(before)}`,
    )

    const result = await hardDelete(now)
    assert.deepEqual(
      [result.units, result.skipped, result.pages, result.blocks >= content.length, result.sources, result.versions, result.missingBytes, result.more],
      [1, 0, 2, true, 0, versions.length, 0, false],
      JSON.stringify(result),
    )
    assert.deepEqual(await alive([root, child, ...content]), [], '페이지 · 본문 블록이 지워졌다')
    assert.deepEqual(
      await traces(),
      { acl: 0, docUpdate: 0, snapshot: 0, version: 0, reaction: 0, discussion: 0, favorite: 0, visit: 0, search: 0 },
      'FK 없는 다섯 · CASCADE 로 따라오는 것이 함께 사라진다',
    )
    assert.deepEqual([await refCount(imageFile), await refCount(iconFile)], [0, 0], '본문 이미지 · 버전 · 아이콘의 참조가 내려갔다')
    assert.ok(versions.every((v) => !store.has(v.state_ref)), '버전의 바이트가 저장소에서 사라졌다')
    assert.deepEqual(await alive([due, trashed, live]), [due, trashed, live].sort(), '때가 안 된 purged · 휴지통 · 살아 있는 것은 그대로')

    const again = await hardDelete(now)
    assert.equal(again.units, 0, '두 번 돌아도 같다')
  })
})

describe('② 기다린다', () => {
  test('★ 따로 먼저 버린 하위 페이지가 남아 있으면 지우지 않는다 — 그 페이지는 휴지통에서 계속 보이고, 지워진 다음 판에 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const parent = await page('부모')
    const early = await page('먼저 버린 자식', parent)
    await trashPage(fx.owner.ctx, asBlockId(early))
    await purged(parent)

    const first = await hardDelete(now)
    assert.equal(first.units, 0, '다른 묶음의 자손이 휴지통에 있다 — 기다린다')
    assert.deepEqual(await alive([parent, early]), [parent, early].sort())
    assert.equal((await listTrash(fx.owner.ctx)).some((e) => e.id === early), true, '남은 자손은 휴지통에서 계속 보인다')

    // 자손도 영구 삭제되어 때가 되면 — 자손이 먼저, 부모는 다음 판에
    await purgePage(fx.owner.ctx, asBlockId(early))
    const second = await hardDelete(new Date(now.getTime() + DAY))
    assert.deepEqual([second.units, second.pages], [1, 1], '자손의 묶음 — 부모는 이 판의 후보를 고를 때 아직 기다렸다')
    assert.deepEqual(await alive([parent, early]), [parent])
    const third = await hardDelete(new Date(now.getTime() + DAY))
    assert.deepEqual([third.units, third.pages], [1, 1])
    assert.deepEqual(await alive([parent]), [])
  })

  test('★ 기다리는 묶음이 한 판을 차지하지 않는다 — 더 오래된 기다리는 묶음 뒤의 묶음도 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const parent = await page('기다리는 부모')
    const early = await page('먼저 버린 자식', parent)
    await trashPage(fx.owner.ctx, asBlockId(early))
    await purged(parent)
    // 기다리는 묶음이 더 오래됐다 — 후보 순서의 맨 앞
    await query(`UPDATE block SET purged_at = purged_at - interval '1 day' WHERE trash_root_id = $1`, [parent])
    const next = await page('뒤의 묶음')
    await purged(next)

    const result = await hardDelete(now, 1)
    assert.deepEqual([result.units, result.skipped], [1, 0], '한 판(1)이 기다리는 묶음에 쓰이지 않았다')
    assert.deepEqual(await alive([parent, next]), [parent])
  })
})

describe('③ 소스 묶음', () => {
  test('★ 소스 · 그 행 · 속성 · 뷰 · 관계 간선이 함께 — 소스 아래 따로 먼저 버린 행이 남아 있으면 기다린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const db = unwrap(await createDatabase(fx.owner.ctx, { name: '지울 표' }))
    const second = unwrap(await addDataSource(fx.owner.ctx, db.id, { name: '둘째' }))
    const source = second.dataSource.id
    const row = unwrap(await createRow(fx.owner.ctx, source)).id
    const early = unwrap(await createRow(fx.owner.ctx, source)).id
    const mainRow = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
    const relation = unwrap(
      await addRelationProperty(fx.owner.ctx, db.dataSourceId, { name: '둘째로', targetDataSourceId: source, twoWay: { name: '첫째로' } }),
    )
    unwrap(await linkRows(fx.owner.ctx, mainRow, relation.propertyId, { add: [row] }))
    assert.equal(await countOf(`relation_edge WHERE from_page_id = $1 OR to_page_id = $1`, [row]), 2, '전제 — 간선과 거울상')

    unwrap(await trashRow(fx.owner.ctx, early)) // 소스보다 먼저 따로 버린 행 — 제 묶음
    unwrap(await trashDataSource(fx.owner.ctx, source))
    unwrap(await purgeDataSource(fx.owner.ctx, source))

    const waiting = await hardDelete(now)
    assert.equal(waiting.units, 0, '소스 아래 다른 묶음의 행이 남았다 — 기다린다')
    assert.equal(await countOf(`data_source WHERE id = $1`, [source]), 1)

    // 그 행도 영구 삭제되어 때가 되면 — 행이 먼저, 소스는 다음 판에
    await purgePage(fx.owner.ctx, asBlockId(early))
    const at = new Date(now.getTime() + DAY)
    assert.deepEqual([(await hardDelete(at)).units, await alive([early])], [1, []])
    const swept = await hardDelete(at)
    assert.deepEqual([swept.units, swept.pages, swept.sources], [1, 1, 1])
    assert.deepEqual(
      {
        source: await countOf(`data_source WHERE id = $1`, [source]),
        rows: (await alive([row])).length,
        properties: await countOf(`property WHERE data_source_id = $1`, [source]),
        views: await countOf(`view WHERE data_source_id = $1`, [source]),
        edges: await countOf(`relation_edge WHERE from_page_id = $1 OR to_page_id = $1`, [row]),
      },
      { source: 0, rows: 0, properties: 0, views: 0, edges: 0 },
    )
    assert.deepEqual(await alive([mainRow]), [mainRow], '다른 소스의 행은 그대로 — 간선만 사라진다')
  })
})

describe('④ 루트를 쥐고 있으면', () => {
  test('★ 건너뛰고 기다리지 않는다 — 놓으면 다음 판에 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    const root = await page('쥔 묶음')
    await purged(root)

    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let held: () => void = () => undefined
    const holding = new Promise<void>((resolve) => (held = resolve))
    const holder = withTransaction(async (tx) => {
      await tx.query(`SELECT id FROM block WHERE id = $1 FOR UPDATE`, [root])
      held()
      await gate
    })
    await holding

    const running = hardDelete(now)
    try {
      const raced = await Promise.race([running, new Promise<'waited'>((r) => setTimeout(() => r('waited'), 3000))])
      assert.notEqual(raced, 'waited', '잠긴 루트를 기다렸다 — 워커가 다른 쪽에 묶인다')
      if (raced !== 'waited') assert.deepEqual([raced.units, raced.skipped], [0, 1])
      assert.deepEqual(await alive([root]), [root])
    } finally {
      release()
      await holder
      await running
    }
    assert.equal((await hardDelete(now)).units, 1, '놓으면 다음 판에 지운다')
    assert.deepEqual(await alive([root]), [])
  })
})

describe('⑤ 한 판의 상한', () => {
  test('꽉 차면 more — 다음 판이 나머지를 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const now = later()
    await settle(now)
    for (const title of ['하나', '둘', '셋']) await purged(await page(title))

    const first = await hardDelete(now, 2)
    assert.deepEqual([first.units, first.more], [2, true])
    const second = await hardDelete(now, 2)
    assert.deepEqual([second.units, second.more], [1, false])
  })
})
