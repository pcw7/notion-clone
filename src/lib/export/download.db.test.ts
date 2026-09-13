/**
 * 익스포트 내려받기 준비 — F-09-14 3b (DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **워크스페이스 전체는 소유자만** — 멤버 · 멤버 관리자는 스냅샷을 읽기 **전에** `forbidden`.
 *      페이지 · 표는 멤버도 내보낸다(멤버가 잃는 데이터가 없어야 한다, HANDOFF §3.2-13)
 *   ② **흘려보내기 전에 거부한다** — ZIP 추정 · 블록 수가 상한을 넘으면 `too_large`
 *   ③ **스트림이 저장소의 실제 바이트를 담는다** — 없으면 빼고 보고서가 센다
 *   ④ ZIP 이름 — 제목(이모지 뺌) · 표 이름 · 워크스페이스는 날짜
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { findPython, runPythonJson, unavailable } from '../testing/external-tools.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { loadPageBody, savePageBody } from '../block/save-page-body.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { canExportWorkspace, exportZipStream, prepareExport, type PrepareResult, type PreparedExport } from './download.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

/** 디스크를 건드리지 않는 드라이버 — 바이트를 지워 "행은 있는데 바이트가 없는" 상태를 만든다. */
const store = new Map<string, Uint8Array>()
const memoryStorage: FileStorage = {
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

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
  setFileStorage(memoryStorage)
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

async function freshWorkspace(): Promise<{ owner: Actor; member: Actor; admin: Actor }> {
  const workspaceId = await createBareWorkspace('내려받기')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const admin = await joinAs(workspaceId, await createUser('멤버 관리자'), 'membership_admin')
  return { owner, member, admin }
}

const mkPage = async (actor: Actor, title: string, parentPageId: string | null = null) =>
  createPage(actor.ctx, { parentPageId: parentPageId as never, title: titleFromPlainText(title) })

const para = (text: string): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)] })

async function saveBody(actor: Actor, pageId: string, edit: (doc: EditorDoc) => EditorDoc): Promise<void> {
  const body = await loadPageBody(actor.ctx, pageId as never)
  assert.ok(body !== null)
  const saved = await savePageBody(actor.ctx, pageId as never, edit(body.doc), { expectedVersion: body.version })
  assert.equal(saved.ok, true, JSON.stringify(saved))
}

function prepared(result: PrepareResult): PreparedExport {
  assert.equal(result.ok, true, result.ok ? '' : result.reason)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

type Unzipped = {
  bad: string | null
  names: string[]
  sha: Record<string, string>
  report: { missing_attachments: number; counts: Record<string, number> }
}

const READ_ZIP = [
  'import sys, json, zipfile, hashlib',
  'z = zipfile.ZipFile(sys.argv[1])',
  'names = [i.filename for i in z.infolist()]',
  'print(json.dumps({',
  '  "bad": z.testzip(),',
  '  "names": names,',
  '  "sha": {n: hashlib.sha256(z.read(n)).hexdigest() for n in names},',
  '  "report": json.loads(z.read("_export_report.json").decode("utf-8")),',
  '}))',
].join('\n')

/** 준비 → 스트림 → 바이트를 python zipfile 로 읽는다(우리가 짜지 않은 구현, HANDOFF §3.3-63). */
async function exportAndUnzip(python: string, actor: Actor, rootId: string): Promise<Unzipped> {
  const ready = prepared(await prepareExport(actor.ctx, { kind: 'page', rootId }))
  const bytes = Buffer.from(await new Response(exportZipStream(actor.ctx, ready.plan)).arrayBuffer())
  const dir = mkdtempSync(join(tmpdir(), 'export-download-'))
  try {
    const file = join(dir, 'export.zip')
    writeFileSync(file, bytes)
    return runPythonJson(python, READ_ZIP, [file]) as Unzipped
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

// ── ① 누가 무엇을 ─────────────────────────────────────────────────────

describe('① 누가 무엇을', () => {
  test('★ 워크스페이스 전체는 소유자만 — 멤버 · 멤버 관리자는 스냅샷을 읽기 전에 forbidden', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, admin } = await freshWorkspace()
    await mkPage(owner, '모두의 페이지')

    const whole = prepared(await prepareExport(owner.ctx, { kind: 'workspace' }))
    assert.equal(canExportWorkspace(owner.ctx), true)
    assert.deepEqual(whole.plan.report.counts, { pages: 1, databases: 0, rows: 0, attachments: 0 })
    assert.match(whole.fileName, /^워크스페이스 \d{4}-\d{2}-\d{2}\.zip$/)

    for (const actor of [member, admin]) {
      assert.equal(canExportWorkspace(actor.ctx), false)
      assert.deepEqual(await prepareExport(actor.ctx, { kind: 'workspace' }), { ok: false, reason: 'forbidden' })
      // 읽기 전에 막는다 — 읽었다면 블록 상한 0 에 걸려 too_large 가 먼저 나온다.
      assert.deepEqual(await prepareExport(actor.ctx, { kind: 'workspace' }, { maxBlocks: 0 }), { ok: false, reason: 'forbidden' })
    }
  })

  test('★ 멤버도 페이지 · 표는 내보낸다 — 풀페이지 표는 워크스페이스 직속이라 표 범위로 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await freshWorkspace()
    const root = await mkPage(owner, '📝 회의록')
    await mkPage(owner, '하위', root.id)
    const created = await createDatabase(owner.ctx, { name: '할 일' })
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error('unreachable')

    const page = prepared(await prepareExport(member.ctx, { kind: 'page', rootId: root.id }))
    assert.deepEqual(page.plan.entries.map((e) => e.path), ['회의록.md', '회의록/하위.md'])
    assert.equal(page.fileName, '회의록.zip', '이모지는 ZIP 이름에서도 빠진다')

    const table = prepared(await prepareExport(member.ctx, { kind: 'page', rootId: created.value.id }))
    assert.deepEqual(table.plan.entries.map((e) => e.path), ['할 일.csv'])
    assert.deepEqual(table.plan.report.counts, { pages: 0, databases: 1, rows: 0, attachments: 0 })
    assert.equal(table.fileName, '할 일.zip')
  })

  test('볼 수 없는 페이지 · 다른 워크스페이스의 페이지 · 빈 id 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await freshWorkspace()
    const elsewhere = await freshWorkspace()
    const closed = await mkPage(owner, '비공개')
    assert.equal((await grantAccess(owner.ctx, closed.id, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(owner.ctx, closed.id, { type: 'workspace_everyone' })).ok, true)
    const theirs = await mkPage(elsewhere.owner, '남의 페이지')

    for (const rootId of [closed.id, theirs.id, '']) {
      assert.deepEqual(await prepareExport(member.ctx, { kind: 'page', rootId }), { ok: false, reason: 'not_found' }, rootId)
    }
    assert.equal((await prepareExport(owner.ctx, { kind: 'page', rootId: closed.id })).ok, true)
  })
})

// ── ② 흘려보내기 전에 거부한다 ────────────────────────────────────────

describe('② 흘려보내기 전에 거부한다', () => {
  test('★ ZIP 추정이 상한을 넘으면 too_large — 딱 상한이면 통과', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const root = await mkPage(owner, '큰 페이지')
    await saveBody(owner, root.id, () => ({ blocks: [para('가'.repeat(1500)), para('나'.repeat(1500))] }))
    const scope = { kind: 'page', rootId: root.id } as const

    const { estimate } = prepared(await prepareExport(owner.ctx, scope))
    assert.deepEqual(await prepareExport(owner.ctx, scope, { maxBytes: estimate.bytes - 1 }), { ok: false, reason: 'too_large' })
    assert.equal((await prepareExport(owner.ctx, scope, { maxBytes: estimate.bytes })).ok, true)
  })

  test('블록 수 상한도 같은 거부다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await freshWorkspace()
    const root = await mkPage(owner, '루트')
    assert.deepEqual(await prepareExport(owner.ctx, { kind: 'page', rootId: root.id }, { maxBlocks: 0 }), {
      ok: false,
      reason: 'too_large',
    })
  })
})

// ── ③ 스트림 ──────────────────────────────────────────────────────────

describe('③ 스트림', () => {
  test('★ 첨부는 저장소의 실제 바이트다 — 저장소에 없으면 빼고 보고서가 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const python = findPython()
    if (python === null) return t.skip(unavailable('python'))

    const { owner } = await freshWorkspace()
    const bytes = randomBytes(300)
    const upload = await uploadFile(owner.ctx, { bytes, mime: 'image/png', originalName: '사진.png' })
    assert.equal(upload.ok, true)
    if (!upload.ok) throw new Error('unreachable')
    const root = await mkPage(owner, '사진첩')
    const image: EditorBlock = {
      id: randomUUID(),
      type: 'image',
      title: [],
      properties: { source: { type: 'file', file_id: upload.file.id } },
    }
    await saveBody(owner, root.id, () => ({ blocks: [para('앞'), image] }))

    const whole = await exportAndUnzip(python, owner, root.id)
    assert.equal(whole.bad, null)
    assert.deepEqual(whole.names, ['사진첩.md', '사진첩/사진.png', '_export_report.json'])
    assert.equal(whole.sha['사진첩/사진.png'], sha256(bytes))
    assert.equal(whole.report.missing_attachments, 0)
    assert.equal(whole.report.counts.attachments, 1)

    store.delete(upload.file.storageKey)
    const holed = await exportAndUnzip(python, owner, root.id)
    assert.equal(holed.bad, null)
    assert.deepEqual(holed.names, ['사진첩.md', '_export_report.json'])
    assert.equal(holed.report.missing_attachments, 1)
  })
})
