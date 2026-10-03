/**
 * 페이지 아이콘 — 잔여 묶음 8c-1 (F-02-05 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 달고 · 바꾸고 · 지운다 — `format.page_icon` 하나(다른 format 키는 그대로) · 같은 아이콘이면 쓰지 않는다(version 그대로)
 *   ② ★ 거부는 아무것도 바꾸지 않는다 — 볼 수만 있는 사람(forbidden) · 볼 수 없는 사람(not_found) · 잠긴 페이지(locked) · 모양이 아닌 값
 *   ③ ★ DB 행도 받는다 — 표를 고칠 수 있는 사람만(셀과 같은 축)
 *   ④ ★ 아이콘이 서는 조회 — 페이지 하나 · 하위 목록 · 조상(경로) · 사이드바 트리 · 즐겨찾기 · 최근
 *   ⑤ ★ 본문은 아이콘을 싣지 않는다 — 행에서 부모의 Y.Doc 을 지어도(옮기지 않은 페이지) 하위 페이지의 아이콘이 들어가지 않는다
 *   ⑥ 복제는 아이콘을 옮긴다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { createUser, joinAs, probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, getPage, listAncestors, listChildPages, setPageIcon, titleFromPlainText, PageError, type PageDetail } from './page.ts'
import { listPageTree, type PageTreeNode } from './page-tree.ts'
import { addFavorite, listFavorites, listRecent, recordVisit } from '../nav/recent.ts'
import { duplicatePage } from './duplicate.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { createDatabase } from '../database/database.ts'
import { createRow } from '../database/row.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { BODY_FRAGMENT } from '../collab/ydoc.ts'
import { query } from '../db/pool.ts'
import type { PageIcon } from './page-icon.ts'
import type { BlockId } from '../ids.ts'

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
  }
})

const emoji = (e: string): PageIcon => ({ type: 'emoji', emoji: e })
const newPage = async (title: string, more: { parentPageId?: BlockId; privateTop?: boolean } = {}): Promise<PageDetail> =>
  createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...more })

/** 행 그대로 — format · version · 마지막 편집. */
async function rowOf(id: string): Promise<{ format: Record<string, unknown>; version: string; last_edited_by: string | null }> {
  const rows = await query<{ format: Record<string, unknown>; version: string; last_edited_by: string | null }>(
    `SELECT format, version, last_edited_by FROM block WHERE id = $1`,
    [id],
  )
  return rows[0]
}

/** 거부되는가 — 그 코드로. */
async function rejects(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (e: unknown) => e instanceof PageError && e.code === code)
}

/**
 * Y.Doc 본문을 **정규화 없이** 그대로 — 요소 이름 · attr(객체 그대로) · 글자. `ydoc.toJSON()` 은 객체 attr 을 `[object Object]` 로
 * 쓰고, `readBodyYDoc` 은 정규화가 이 키를 버려 둘 다 새는 것을 가린다.
 */
function rawBody(ydoc: Y.Doc): string {
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): unknown =>
    node instanceof Y.XmlText
      ? node.toString()
      : node instanceof Y.XmlElement
        ? { name: node.nodeName, attrs: node.getAttributes(), children: node.toArray().map(walk) }
        : null
  return JSON.stringify(ydoc.getXmlFragment(BODY_FRAGMENT).toArray().map(walk))
}

function findNode(nodes: readonly PageTreeNode[], id: string): PageTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return undefined
}

describe('① 달고 · 바꾸고 · 지운다', () => {
  test('★ format.page_icon 하나만 — 다른 키는 그대로 · 지우면 키가 없다 · 바뀔 때만 version 이 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('아이콘 단 페이지')
    await query(`UPDATE block SET format = '{"page_full_width": true}'::jsonb WHERE id = $1`, [page.id])
    const v0 = (await rowOf(page.id)).version

    assert.deepEqual(await setPageIcon(fx.owner.ctx, page.id, emoji('🌱')), emoji('🌱'))
    const r1 = await rowOf(page.id)
    assert.deepEqual(r1.format, { page_full_width: true, page_icon: { type: 'emoji', emoji: '🌱' } })
    assert.equal(BigInt(r1.version), BigInt(v0) + 1n)
    assert.equal(r1.last_edited_by, fx.owner.userId)

    // 같은 아이콘 — 쓰지 않는다.
    await setPageIcon(fx.owner.ctx, page.id, emoji('🌱'))
    assert.equal((await rowOf(page.id)).version, r1.version, '같은 아이콘에 version 이 올랐다')

    // 바꾸기 — 받은 객체의 다른 키 · 앞뒤 공백은 싣지 않는다.
    await setPageIcon(fx.owner.ctx, page.id, { type: 'emoji', emoji: ' 🚀 ', extra: 1 } as unknown as PageIcon)
    assert.deepEqual((await rowOf(page.id)).format, { page_full_width: true, page_icon: { type: 'emoji', emoji: '🚀' } })
    assert.deepEqual((await getPage(fx.owner.ctx, page.id))?.icon, emoji('🚀'))

    assert.equal(await setPageIcon(fx.owner.ctx, page.id, null), null)
    assert.deepEqual((await rowOf(page.id)).format, { page_full_width: true })
    assert.equal((await getPage(fx.owner.ctx, page.id))?.icon, null)
  })
})

describe('② 거부는 아무것도 바꾸지 않는다', () => {
  test('★ 볼 수만 있는 사람 forbidden · 볼 수 없는 사람 not_found · 잠긴 페이지 locked · 모양이 아닌 값 invalid_icon', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('지키는 페이지', { privateTop: true })
    await setPageIcon(fx.owner.ctx, page.id, emoji('🔒'))
    const before = await rowOf(page.id)

    const reader = await joinAs(fx.workspaceId, await createUser('읽기만'), 'member')
    const outsider = await joinAs(fx.workspaceId, await createUser('못 보는 사람'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, page.id, { type: 'user', id: reader.userId }, 'view')).ok)

    await rejects(() => setPageIcon(reader.ctx, page.id, emoji('😈')), 'forbidden')
    await rejects(() => setPageIcon(outsider.ctx, page.id, emoji('😈')), 'not_found')
    for (const bad of ['', 'a', '🚀🚀', '🚀 x', 'x'.repeat(17)]) {
      await rejects(() => setPageIcon(fx.owner.ctx, page.id, emoji(bad)), 'invalid_icon')
    }
    // 이미지 아이콘은 8c-4 부터 받는다 — 안전하지 않은 주소는 여전히 거부한다(`icon-reference.db.test.ts` ②).
    await rejects(() => setPageIcon(fx.owner.ctx, page.id, { type: 'external', url: 'javascript:alert(1)' } as unknown as PageIcon), 'invalid_icon')

    assert.ok((await setPageLock(fx.owner.ctx, page.id, true)).ok)
    await rejects(() => setPageIcon(fx.owner.ctx, page.id, emoji('🔓')), 'locked')
    await rejects(() => setPageIcon(fx.owner.ctx, page.id, null), 'locked')

    assert.deepEqual(await rowOf(page.id), before, '거부한 뒤에 행이 바뀌었다')
    assert.ok((await setPageLock(fx.owner.ctx, page.id, false)).ok)
    await setPageIcon(fx.owner.ctx, page.id, emoji('🔓'))
    assert.deepEqual((await getPage(fx.owner.ctx, page.id))?.icon, emoji('🔓'), '잠금을 풀면 다시 고친다')
  })
})

describe('③ DB 행', () => {
  test('★ 표를 고칠 수 있는 사람은 행에 아이콘을 단다 — 표를 볼 수만 있는 사람은 forbidden', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const table = await createDatabase(fx.owner.ctx, { name: '아이콘 표', privateTop: true })
    assert.ok(table.ok)
    const row = await createRow(fx.owner.ctx, table.value.dataSourceId)
    assert.ok(row.ok)
    const rowId = row.value.id as BlockId

    assert.deepEqual(await setPageIcon(fx.owner.ctx, rowId, emoji('📌')), emoji('📌'))
    assert.deepEqual(pageIconOfRow(await rowOf(rowId)), emoji('📌'))

    const reader = await joinAs(fx.workspaceId, await createUser('표 읽기만'), 'member')
    assert.ok((await grantAccess(fx.owner.ctx, table.value.id, { type: 'user', id: reader.userId }, 'view')).ok)
    const before = await rowOf(rowId)
    await rejects(() => setPageIcon(reader.ctx, rowId, emoji('😈')), 'forbidden')
    assert.deepEqual(await rowOf(rowId), before)
  })
})

function pageIconOfRow(row: { format: Record<string, unknown> }): unknown {
  return row.format.page_icon
}

describe('④ 아이콘이 서는 조회', () => {
  test('★ 페이지 하나 · 하위 목록 · 조상 · 사이드바 트리 · 즐겨찾기 · 최근이 아이콘을 싣는다 — 없는 페이지는 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await newPage('아이콘 위')
    const child = await newPage('아이콘 아래', { parentPageId: top.id })
    const plain = await newPage('아이콘 없는 형제', { parentPageId: top.id })
    await setPageIcon(fx.owner.ctx, top.id, emoji('🌳'))
    await setPageIcon(fx.owner.ctx, child.id, emoji('🍃'))

    const childDetail = await getPage(fx.owner.ctx, child.id)
    assert.ok(childDetail)
    assert.deepEqual(childDetail.icon, emoji('🍃'))
    assert.deepEqual((await listAncestors(fx.owner.ctx, childDetail)).map((a) => [a.id, a.icon]), [[top.id, emoji('🌳')]])
    assert.deepEqual(
      (await listChildPages(fx.owner.ctx, top.id)).map((c) => [c.id, c.icon]),
      [[child.id, emoji('🍃')], [plain.id, null]],
    )

    const tree = await listPageTree(fx.owner.ctx)
    assert.deepEqual(findNode(tree, top.id)?.icon, emoji('🌳'))
    assert.deepEqual(findNode(tree, child.id)?.icon, emoji('🍃'))
    assert.equal(findNode(tree, plain.id)?.icon, null)

    await addFavorite(fx.owner.ctx, child.id)
    await recordVisit(fx.owner.ctx, top.id)
    assert.deepEqual((await listFavorites(fx.owner.ctx)).find((e) => e.id === child.id)?.icon, emoji('🍃'))
    assert.deepEqual((await listRecent(fx.owner.ctx)).find((e) => e.id === top.id)?.icon, emoji('🌳'))
  })
})

describe('⑤ 본문은 아이콘을 싣지 않는다', () => {
  test('★ 행에서 부모의 Y.Doc 을 지어도 하위 페이지 참조에 그 아이콘이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await newPage('옮기지 않은 부모')
    const child = await newPage('아이콘 단 자식', { parentPageId: parent.id })
    await setPageIcon(fx.owner.ctx, child.id, emoji('🦄'))
    // 옮기지 않은 페이지처럼 — 부모의 Y.Doc 을 지운다. 다음 읽기가 행에서 다시 짓는다(`doc-store.ts` bootstrap).
    await query(`DELETE FROM doc_update WHERE page_id = $1`, [parent.id])
    await query(`DELETE FROM doc_snapshot WHERE page_id = $1`, [parent.id])

    const state = await loadDocState(fx.owner.ctx, parent.id)
    assert.ok(state.ok)
    const json = rawBody(state.value.ydoc)
    assert.ok(json.includes(child.id), '전제 — 부모의 본문에 하위 페이지 참조가 있다')
    assert.ok(!json.includes('🦄') && !json.includes('page_icon'), `하위 페이지의 아이콘이 부모의 Y.Doc 에 들어갔다: ${json}`)
  })
})

describe('⑥ 복제', () => {
  test('복제는 아이콘을 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await newPage('꾸민 원본')
    await setPageIcon(fx.owner.ctx, page.id, emoji('🎨'))
    const copy = await duplicatePage(fx.owner.ctx, page.id)
    assert.deepEqual((await getPage(fx.owner.ctx, copy.page.id))?.icon, emoji('🎨'))
  })
})
