/**
 * 익스포트 스냅샷 읽기 — F-09-14 (DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **트리 · 본문 · 순서가 화면과 같다** — 토글 안에 둔 하위 페이지의 순서, 표의 행 · 옵션
 *   ② **볼 수 없는 것은 스냅샷에 없다** — 제목도 본문도. 자리만 남아 조립이 센다
 *   ③ **볼 수 있는 페이지는 빠지지 않는다** — 볼 수 없는 페이지 밑에 따로 공유된 페이지는 위로 올라온다
 *   ④ **실제 스냅샷을 조립에 넣으면 던지지 않는다** — 계약(`ExportSnapshot`)이 맞는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty, addSelectOption, getSchema } from '../database/property.ts'
import { createRow } from '../database/row.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { uploadFile } from '../file/file.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { planExport, type ExportDatabaseNode, type ExportPageNode, type ExportSnapshot } from './plan.ts'
import { readExportSnapshot, type ExportScopeInput } from './snapshot.ts'

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

/** 워크스페이스를 매번 새로 만든다 — 워크스페이스 범위는 전체를 본다. */
async function freshWorkspace(): Promise<{ owner: Actor; member: Actor }> {
  const workspaceId = await createBareWorkspace('익스포트')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  return { owner, member }
}

const mkPage = async (actor: Actor, title: string, parentPageId: string | null = null) =>
  createPage(actor.ctx, { parentPageId: parentPageId as never, title: titleFromPlainText(title) })

const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)] })

async function snap(actor: Actor, scope: ExportScopeInput): Promise<ExportSnapshot> {
  const result = await readExportSnapshot(actor.ctx, scope)
  assert.equal(result.ok, true, result.ok ? '' : result.reason)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function pageOf(snapshot: ExportSnapshot, id: string): ExportPageNode {
  const node = snapshot.nodes.get(id)
  assert.ok(node?.kind === 'page', `페이지 노드가 없다: ${id}`)
  return node
}

async function saveBody(actor: Actor, pageId: string, edit: (doc: EditorDoc) => EditorDoc): Promise<void> {
  const body = await loadPageBody(actor.ctx, pageId as never)
  assert.ok(body !== null)
  const saved = await savePageBody(actor.ctx, pageId as never, edit(body.doc), { expectedVersion: body.version })
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

const refIn = (doc: EditorDoc, id: string): EditorBlock => {
  const found = doc.blocks.find((b) => b.id === id)
  assert.ok(found !== undefined, `본문에 참조가 없다: ${id}`)
  return found
}

/** 스냅샷 전체를 글자로 — "어디에도 없다"를 검사한다. */
const dump = (snapshot: ExportSnapshot): string =>
  JSON.stringify({ ...snapshot, nodes: [...snapshot.nodes.values()], files: [...snapshot.files.values()] })

// ── ① 트리 · 본문 · 순서 ─────────────────────────────────────────────

describe('① 트리 · 본문 · 순서', () => {
  test('페이지 범위 — 토글 안에 둔 하위 페이지까지 본문에 보이는 순서가 자식 순서다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const root = await mkPage(owner, '루트')
    const first = await mkPage(owner, '첫째', root.id)
    const second = await mkPage(owner, '둘째', root.id)
    const grandchild = await mkPage(owner, '손자', first.id)

    // 본문에서 둘째를 앞에, 첫째를 뒤쪽 토글 **안**에 둔다.
    //
    // 저장은 키를 형제 이름공간마다 문서 위치로 다시 매긴다 — 루트의 둘째는 `a1`, 토글 안의
    // 첫째는 `a0` 이 된다. 그래서 `order_key` 로 줄 세우면 첫째가 앞이고 본문 순서는 둘째가 앞이다.
    // (처음에는 둘째를 토글 안에 넣었는데, 그러면 키 순서와 본문 순서가 우연히 같아서 "본문 순서로
    // 줄 세우기"를 빼도 이 검사가 통과했다 — 반사실이 알려줬다.)
    await saveBody(owner, root.id, (doc) => ({
      blocks: [
        para('앞'),
        refIn(doc, second.id),
        { id: randomUUID(), type: 'toggle', title: [textRun('접힘')], children: [refIn(doc, first.id)] },
      ],
    }))

    const snapshot = await snap(owner, { kind: 'page', rootId: root.id })
    assert.deepEqual(snapshot.rootIds, [root.id])
    assert.deepEqual(snapshot.scope, { kind: 'page', rootId: root.id })
    assert.equal(snapshot.nodes.size, 4)
    assert.deepEqual(pageOf(snapshot, root.id).childIds, [second.id, first.id])
    assert.deepEqual(pageOf(snapshot, first.id).childIds, [grandchild.id])
    assert.equal(toPlainText(pageOf(snapshot, first.id).title), '첫째')
    assert.ok(snapshot.exportedAt instanceof Date)

    const plan = planExport(snapshot, { untitled: '제목 없음' })
    assert.deepEqual(
      plan.entries.map((e) => e.path),
      ['루트.md', '루트/둘째.md', '루트/첫째.md', '루트/첫째/손자.md'],
    )
  })

  test('워크스페이스 범위 — 최상위 페이지와 표, 표의 행 · 셀 · 옵션', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const page = await mkPage(owner, '페이지')
    const created = await createDatabase(owner.ctx, { name: '할 일' })
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error('unreachable')
    const { id: databaseId, dataSourceId } = created.value

    assert.equal((await addProperty(owner.ctx, dataSourceId, { name: '상태', type: 'select' })).ok, true)
    const schema = await getSchema(owner.ctx, dataSourceId)
    assert.equal(schema.ok, true)
    if (!schema.ok) throw new Error('unreachable')
    const titleId = schema.value.properties.find((p) => p.type === 'title')?.id as string
    const statusId = schema.value.properties.find((p) => p.name === '상태')?.id as string
    const option = await addSelectOption(owner.ctx, dataSourceId, statusId, { name: '진행 중' })
    assert.equal(option.ok, true)
    if (!option.ok) throw new Error('unreachable')

    const rowA = await createRow(owner.ctx, dataSourceId, {
      cells: [
        { propertyId: titleId, value: { type: 'title', title: [textRun('첫 행')] } },
        { propertyId: statusId, value: { type: 'select', select: { id: option.value.option.id } } },
      ],
    })
    const rowB = await createRow(owner.ctx, dataSourceId, {
      cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun('둘째 행')] } }],
    })
    assert.equal(rowA.ok && rowB.ok, true)
    if (!rowA.ok || !rowB.ok) throw new Error('unreachable')

    const snapshot = await snap(owner, { kind: 'workspace' })
    assert.deepEqual(snapshot.rootIds, [page.id, databaseId])

    const table = snapshot.nodes.get(databaseId) as ExportDatabaseNode
    assert.equal(table.kind, 'database')
    assert.equal(table.name, '할 일')
    assert.deepEqual(table.columns.map((c) => [c.name, c.type]), [['이름', 'title'], ['상태', 'select']])
    assert.deepEqual(table.columns[1].options?.map((o) => o.name), ['진행 중'])
    assert.deepEqual(table.rowIds, [rowA.value.id, rowB.value.id])
    assert.equal(toPlainText(pageOf(snapshot, rowA.value.id).title), '첫 행')
    assert.deepEqual(pageOf(snapshot, rowA.value.id).cells?.[statusId], {
      type: 'select',
      select: { id: option.value.option.id },
    })

    const plan = planExport(snapshot, { untitled: '제목 없음' })
    const csv = plan.entries.find((e) => e.path === '할 일.csv')
    assert.ok(csv?.kind === 'text' && csv.text.includes('첫 행,진행 중'), JSON.stringify(csv))
  })
})

// ── ② · ③ 권한 ────────────────────────────────────────────────────────

describe('② · ③ 권한', () => {
  test('★ 볼 수 없는 하위 페이지 — 제목도 본문도 없고 자리만 남는다 · 그 밑에 공유받은 페이지는 위로 올라온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await freshWorkspace()
    const root = await mkPage(owner, '모두의 루트')
    const secret = await mkPage(owner, '비밀 제목 7f3a', root.id)
    await saveBody(owner, secret.id, (doc) => ({ blocks: [...doc.blocks, para('비밀 본문 9c1d')] }))
    const shared = await mkPage(owner, '공유받은 손자', secret.id)

    // 비밀은 소유자만 · 손자는 멤버에게 따로 준다.
    assert.equal((await stopInheriting(owner.ctx, secret.id)).ok, true)
    assert.equal((await grantAccess(owner.ctx, secret.id, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(owner.ctx, secret.id, { type: 'workspace_everyone' })).ok, true)
    assert.equal((await grantAccess(owner.ctx, shared.id, { type: 'user', id: member.userId }, 'view')).ok, true)

    const snapshot = await snap(member, { kind: 'page', rootId: root.id })
    assert.deepEqual([...snapshot.nodes.keys()].sort(), [root.id, shared.id].sort())
    assert.deepEqual(pageOf(snapshot, root.id).childIds, [shared.id], '공유받은 손자가 루트 밑으로 올라온다')

    const text = dump(snapshot)
    assert.ok(!text.includes('비밀 제목 7f3a'), '볼 수 없는 제목이 스냅샷에 있다')
    assert.ok(!text.includes('비밀 본문 9c1d'), '볼 수 없는 본문이 스냅샷에 있다')
    assert.ok(JSON.stringify(pageOf(snapshot, root.id).doc).includes(secret.id), '자리(참조)는 남는다')

    const plan = planExport(snapshot, { untitled: '제목 없음' })
    assert.equal(plan.report.markdown_losses.omitted_pages, 1)
    assert.deepEqual(plan.entries.map((e) => e.path), ['모두의 루트.md', '모두의 루트/공유받은 손자.md'])

    // 볼 수 없는 페이지를 루트로 부르면 없는 것과 같다.
    assert.deepEqual(await readExportSnapshot(member.ctx, { kind: 'page', rootId: secret.id }), { ok: false, reason: 'not_found' })
    // 소유자는 전부 본다.
    assert.equal((await snap(owner, { kind: 'page', rootId: root.id })).nodes.size, 3)
  })

  test('워크스페이스 범위 — 남의 비공개 최상위 페이지는 흔적도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await freshWorkspace()
    const open = await mkPage(owner, '공개')
    const closed = await mkPage(owner, '비공개 최상위 5e2b')
    assert.equal((await grantAccess(owner.ctx, closed.id, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(owner.ctx, closed.id, { type: 'workspace_everyone' })).ok, true)

    const snapshot = await snap(member, { kind: 'workspace' })
    assert.deepEqual(snapshot.rootIds, [open.id])
    assert.ok(!dump(snapshot).includes(closed.id))
    assert.deepEqual(planExport(snapshot, { untitled: '제목 없음' }).report.markdown_losses.omitted_pages, 0)
  })
})

// ── 그 밖 ─────────────────────────────────────────────────────────────

describe('휴지통 · 파일 · 상한', () => {
  test('휴지통의 페이지는 노드도 참조도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const root = await mkPage(owner, '루트')
    const gone = await mkPage(owner, '지운 페이지', root.id)
    assert.equal((await trashPage(owner.ctx, gone.id)).pageId, gone.id)

    const snapshot = await snap(owner, { kind: 'page', rootId: root.id })
    assert.deepEqual([...snapshot.nodes.keys()], [root.id])
    assert.ok(!JSON.stringify(pageOf(snapshot, root.id).doc).includes(gone.id))
  })

  test('이미지 파일 메타는 이 워크스페이스 것만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const elsewhere = await freshWorkspace()
    const upload = (actor: Actor, name: string) =>
      uploadFile(actor.ctx, { bytes: randomBytes(64), mime: 'image/png', originalName: name })
    const mine = await upload(owner, '내 사진.png')
    const theirs = await upload(elsewhere.owner, '남의 사진.png')
    assert.equal(mine.ok && theirs.ok, true)
    if (!mine.ok || !theirs.ok) throw new Error('unreachable')

    const root = await mkPage(owner, '사진첩')
    const image = (fileId: string): EditorBlock => ({
      id: randomUUID(),
      type: 'image',
      title: [],
      properties: { source: { type: 'file', file_id: fileId } },
    })
    await saveBody(owner, root.id, () => ({ blocks: [image(mine.file.id), image(theirs.file.id)] }))

    const snapshot = await snap(owner, { kind: 'page', rootId: root.id })
    assert.deepEqual([...snapshot.files.values()], [
      { id: mine.file.id, mime: 'image/png', originalName: '내 사진.png', sizeBytes: 64 },
    ])
  })

  test('블록 수가 상한을 넘으면 읽기를 멈춘다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const root = await mkPage(owner, '루트')
    await saveBody(owner, root.id, () => ({ blocks: [para('하나'), para('둘'), para('셋')] }))

    assert.deepEqual(await readExportSnapshot(owner.ctx, { kind: 'workspace' }, { maxBlocks: 3 }), {
      ok: false,
      reason: 'too_large',
    })
    assert.equal((await readExportSnapshot(owner.ctx, { kind: 'workspace' }, { maxBlocks: 4 })).ok, true)
  })

  test('uuid 가 아닌 루트는 없는 것과 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    assert.deepEqual(await readExportSnapshot(owner.ctx, { kind: 'page', rootId: 'not-a-uuid' }), {
      ok: false,
      reason: 'not_found',
    })
  })
})
