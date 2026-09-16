/**
 * 하위 페이지 참조의 제목 — 볼 수 없는 페이지의 제목을 본문에 싣지 않는다 (F-06-01 · F-02-13 · CRDT 6조각 전 선결)
 *
 * 하위 페이지의 제목은 **그 페이지의 것**이고, 보려면 그 페이지를 볼 권한이 있어야 한다. 부모를 볼 수 있다고 하위 페이지의
 * 제목까지 볼 수 있는 것이 아니다 — 상속을 끊고 소유자만 남긴 하위 페이지가 그렇다.
 *
 * 이 파일이 지키는 것.
 *
 *   ① **본문을 읽으면 참조 노드에는 제목이 없다.** 제목은 볼 수 있는 하위 페이지만 따로 준다 — 볼 수 없으면 `null`
 *   ② **참조 노드를 쓰는 어떤 경로도 제목을 Y.Doc 에 남기지 않는다** — 하위 페이지 생성 · 본문 저장(PUT) · 이동 · 휴지통 복원 ·
 *      옮기기 전 페이지의 첫 읽기. 로그 바이트 어디에도 없어야 한다(협업 참여자는 Y.Doc 을 그대로 받는다)
 *   ③ **옛 Y.Doc 의 참조 제목 attr** 을 읽어도 바인딩이 던지거나 참조를 지우지 않고, 다음 본문 저장이 그 attr 을 지운다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'

import { BODY_FRAGMENT, readBodyYDoc } from '../collab/ydoc.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { bind, findBlock } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { appendDocUpdate } from './body-write.ts'
import { movePage } from './move-page.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { restorePage, trashPage } from './trash.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

const token = (label: string) => `${label}-${randomUUID().slice(0, 8)}`

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })

async function workspace() {
  const workspaceId = await createBareWorkspace('참조 제목')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const page = (title: string, parent: string | null = null) =>
    createPage(owner.ctx, { parentPageId: parent as never, title: titleFromPlainText(title) })
  return { workspaceId, owner, member, page }
}

/** 소유자만 남긴다 — 상속을 끊고(복사한 뒤) 소유자에게 full_access, 모두에게서 회수. */
async function hideFromMembers(owner: Actor, pageId: string) {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

/** 그 페이지의 로그 · 스냅샷 바이트 어디에 이 글자가 있는가. */
async function storedBytesContain(pageId: string, text: string): Promise<boolean> {
  const needle = Buffer.from(text, 'utf8')
  const updates = await query<{ payload: Buffer }>(`SELECT payload FROM doc_update WHERE page_id = $1`, [pageId])
  const snapshots = await query<{ state: Buffer }>(`SELECT state FROM doc_snapshot WHERE page_id = $1`, [pageId])
  return updates.some((row) => row.payload.includes(needle)) || snapshots.some((row) => row.state.includes(needle))
}

function refElements(ydoc: Y.Doc): Y.XmlElement[] {
  const found: Y.XmlElement[] = []
  const walk = (node: Y.XmlFragment | Y.XmlElement): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === 'page_ref') found.push(child)
      walk(child)
    }
  }
  walk(ydoc.getXmlFragment(BODY_FRAGMENT))
  return found
}

const refsOf = (doc: EditorDoc): EditorBlock[] => {
  const out: EditorBlock[] = []
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const b of blocks) {
      if (b.type === 'page') out.push(b)
      walk(b.children ?? [])
    }
  }
  walk(doc.blocks)
  return out
}

// ── ① 본문 읽기 ──────────────────────────────────────────────────────

describe('① 본문을 읽으면', () => {
  test('★ 참조 노드에는 제목이 없고, 제목은 볼 수 있는 하위 페이지만 따로 준다 — 볼 수 없으면 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, page } = await workspace()
    const secretTitle = token('secret')

    const parent = await page('부모')
    const visible = await page('보이는 하위', parent.id)
    const secret = await page(secretTitle, parent.id)
    await hideFromMembers(owner, secret.id)

    const seen = await loadPageBody(member.ctx, parent.id)
    assert.ok(seen !== null, '전제: 멤버는 부모를 볼 수 있다')
    assert.deepEqual(
      refsOf(seen.doc).map((ref) => [ref.id, ref.title]),
      [[visible.id, []], [secret.id, []]],
      '참조 노드가 제목을 실었다',
    )
    assert.deepEqual(seen.pageRefTitles, { [visible.id]: '보이는 하위', [secret.id]: null })
    assert.ok(!JSON.stringify(seen).includes(secretTitle), '볼 수 없는 하위 페이지의 제목이 본문 응답에 있다')

    const ownerSees = await loadPageBody(owner.ctx, parent.id)
    assert.deepEqual(ownerSees?.pageRefTitles, { [visible.id]: '보이는 하위', [secret.id]: secretTitle })
  })
})

// ── ② Y.Doc 에 쓰는 경로 ─────────────────────────────────────────────

describe('② 참조 노드를 쓰는 경로', () => {
  test('★ 하위 페이지 생성 · 본문 저장 · 이동 · 휴지통 복원 · 옮기기 전 페이지의 첫 읽기 — 어느 것도 제목을 로그에 남기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, page } = await workspace()
    const [created, put, booted] = [token('created'), token('put'), token('booted')]

    // 생성 — 부모 본문 끝에 참조를 넣는다.
    const origin = await page('원래 부모')
    const child = await page(created, origin.id)
    assert.equal(await storedBytesContain(origin.id, created), false, '하위 페이지 생성이 제목을 남겼다')

    // 본문 저장(PUT) — 편집기가 제목을 실어 보내도(옛 클라이언트 · 저장 큐) Y.Doc 에 쓰지 않는다.
    const loaded = await loadPageBody(owner.ctx, origin.id)
    assert.ok(loaded !== null)
    const withTitle: EditorDoc = {
      blocks: [para('본문'), ...loaded.doc.blocks.map((b) => (b.id === child.id ? { ...b, title: [textRun(put)] } : b))],
    }
    const saved = await savePageBody(owner.ctx, origin.id, withTitle)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(await storedBytesContain(origin.id, put), false, '본문 저장이 참조 제목을 남겼다')

    // 이동 — 새 부모 본문 끝에 넣는다. 휴지통 복원 — 원래 자리에 다시 넣는다.
    const target = await page('새 부모')
    await movePage(owner.ctx, child.id as never, target.id as never)
    await trashPage(owner.ctx, child.id as never)
    await restorePage(owner.ctx, child.id as never)
    assert.equal(await storedBytesContain(target.id, created), false, '이동 · 복원이 제목을 남겼다')

    // 옮기기 전 페이지(로그가 없다) — 처음 읽을 때 행에서 Y.Doc 을 만든다.
    const legacy = await page('옮기기 전 페이지')
    await page(booted, legacy.id)
    await query(`DELETE FROM doc_update WHERE page_id = $1`, [legacy.id])
    await query(`DELETE FROM doc_snapshot WHERE page_id = $1`, [legacy.id])
    assert.equal((await loadDocState(owner.ctx, legacy.id)).ok, true)
    assert.equal(await storedBytesContain(legacy.id, booted), false, '행에서 옮기기가 제목을 남겼다')
  })
})

// ── ③ 옛 Y.Doc ───────────────────────────────────────────────────────

describe('③ 참조 노드에 제목 attr 이 남아 있는 옛 Y.Doc', () => {
  test('★ 읽기 · 바인딩이 던지거나 참조를 지우지 않고, 다음 본문 저장이 그 attr 을 지운다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, page } = await workspace()
    const stale = token('stale')

    const parent = await page('부모')
    const paraId = randomUUID()
    assert.equal((await savePageBody(owner.ctx, parent.id as never, { blocks: [para('원문', paraId)] })).ok, true)
    const child = await page('하위', parent.id)

    // 옛 모양을 만든다 — 참여자가 참조 요소에 title attr 을 쓴 update 를 쌓는다.
    const before = await loadDocState(owner.ctx, parent.id)
    assert.ok(before.ok)
    const changes: Uint8Array[] = []
    before.value.ydoc.on('update', (update: Uint8Array) => changes.push(update))
    const [ref] = refElements(before.value.ydoc)
    ref.setAttribute('title', stale)
    const appended = await appendDocUpdate(owner.ctx, parent.id, Y.mergeUpdates(changes), { origin: 'editor' })
    assert.equal(appended.ok, true, JSON.stringify(appended))

    const old = await loadDocState(owner.ctx, parent.id)
    assert.ok(old.ok)
    assert.equal(refElements(old.value.ydoc)[0]?.getAttribute('title'), stale, '전제: 제목 attr 이 남은 Y.Doc 이다')
    assert.deepEqual(refsOf(readBodyYDoc(old.value.ydoc, parent.id).doc).map((r) => [r.id, r.title]), [[child.id, []]])

    const editor = bind(old.value.ydoc)
    try {
      const tr = editor.state.tr
      tr.insertText('앞 ', findBlock(editor.state.doc, paraId).pos + 2)
      editor.dispatch(tr)
      assert.equal(refElements(old.value.ydoc).length, 1, '바인딩이 제목 attr 이 남은 참조를 지웠다')
    } finally {
      editor.destroy()
    }

    const body = await loadPageBody(owner.ctx, parent.id as never)
    assert.ok(body !== null)
    const edited: EditorDoc = { blocks: body.doc.blocks.map((b) => (b.id === paraId ? para('고친 원문', paraId) : b)) }
    assert.equal((await savePageBody(owner.ctx, parent.id as never, edited)).ok, true)
    const after = await loadDocState(owner.ctx, parent.id)
    assert.ok(after.ok)
    assert.deepEqual(
      refElements(after.value.ydoc).map((el) => el.getAttribute('title')),
      [undefined],
      '본문 저장 뒤에도 참조 요소에 제목 attr 이 남았다',
    )
  })
})
