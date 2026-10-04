/**
 * 파일 가져오기 — 잔여 묶음 8m-1 (F-09-12)
 *
 *   ① 마크다운 하나 → 내 개인 최상위의 페이지 · 제목은 첫 `# 제목` · 본문은 블록으로
 *   ② 여럿 → 받은 순서대로 · 평문 · 제목 없는 마크다운은 파일 이름(확장자를 뺀다)
 *   ③ 놓을 곳 — 페이지 아래 · 게스트는 페이지를 줘야 한다 · 볼 수 없는 · 없는 · 모양이 틀린 부모는 not_found
 *   ④ 거부 — 형식 · 수 · 크기(요금제의 상한 — 올리면 받는다) · UTF-8 아님 · **전부이거나 아무것도**(뒤 파일이 거부되면 앞 파일도 없다)
 *   ⑤ 옮기지 못한 것 — 파일마다 · 합계
 *   ⑥ ZIP(8m-2a) — 우리 내보내기의 꼴(이름.md + 폴더)이 계층으로 · 폴더만의 페이지 · 노션의 id 접미 · 제목은 # 제목
 *   ⑦ ZIP 의 부분 성공 — 안전하지 않은 경로 · 가져올 수 없는 형식 · UTF-8 아님(빈 페이지로 남기고 자식은 그대로)을 적는다
 *   ⑧ ZIP 의 통째 거부 — ZIP 아님 · 크기 · 페이지 수 · 가져올 것이 없다 · 놓을 곳의 거부는 전부를 되돌린다
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, listChildPages, titleFromPlainText } from '../block/page.ts'
import { loadPageBody } from '../block/save-page-body.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { toPlainText } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { asBlockId } from '../ids.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { crc32 } from 'node:zlib'

import { createZipWriter } from '../export/zip.ts'
import { importFiles, importZip, MAX_IMPORT_FILES, MAX_ZIP_PAGES, type ImportFile } from './import.ts'

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

const file = (name: string, text: string): ImportFile => ({ name, bytes: new TextEncoder().encode(text) })
const pageCount = async () =>
  Number((await query<{ n: number }>(`SELECT count(*)::int AS n FROM block WHERE workspace_id = $1 AND type = 'page'`, [fx.workspaceId]))[0]?.n)
const bodyShape = async (pageId: string) => {
  const body = await loadPageBody(fx.owner.ctx, asBlockId(pageId))
  return (body?.doc.blocks ?? []).map((b) => [b.type, toPlainText(b.title)])
}

test('★ ① 마크다운 하나 → 개인 최상위의 페이지 · 제목은 # 제목 · 본문은 블록', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const result = await importFiles(fx.owner.ctx, [file('notes.md', '# 회의록\n\n- [x] 끝난 일\n\n본문 문단')])
  assert.ok(result.ok, JSON.stringify(result))
  const [page] = result.value.pages
  assert.equal(page?.title, '회의록')
  const row = (await query<{ owner_user_id: string | null; parent_type: string }>(`SELECT owner_user_id, parent_type FROM block WHERE id = $1`, [page!.id]))[0]
  assert.equal(row?.owner_user_id, fx.owner.userId, '개인 최상위가 아니다')
  assert.deepEqual(await bodyShape(page!.id), [['to_do', '끝난 일'], ['paragraph', '본문 문단']])
})

test('② 여럿 → 받은 순서 · 평문 · 제목 없는 마크다운은 파일 이름', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const result = await importFiles(fx.owner.ctx, [file('첫째.txt', '평문 하나\n\n평문 둘'), file('둘째 메모.MD', '그냥 문단')])
  assert.ok(result.ok)
  assert.deepEqual(result.value.pages.map((p) => p.title), ['첫째', '둘째 메모'])
  assert.deepEqual(await bodyShape(result.value.pages[0]!.id), [['paragraph', '평문 하나'], ['paragraph', '평문 둘']])
})

test('★ ③ 놓을 곳 — 페이지 아래 · 게스트는 페이지를 줘야 · 볼 수 없는 · 없는 · 모양이 틀린 부모는 not_found', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const parent = await createPage(fx.owner.ctx, { title: titleFromPlainText('가져올 곳') })
  const under = await importFiles(fx.owner.ctx, [file('child.md', '# 아이')], { parentPageId: parent.id })
  assert.ok(under.ok)
  assert.deepEqual((await listChildPages(fx.owner.ctx, parent.id)).map((p) => p.id), [under.value.pages[0]!.id])

  const guest = await joinAs(fx.workspaceId, await createUser('가져오기의 게스트'), 'guest')
  assert.deepEqual(await importFiles(guest.ctx, [file('g.md', 'x')]), { ok: false, reason: 'not_found' }, '게스트의 개인 최상위')

  // 소유자의 개인 페이지 — 멤버는 볼 수 없다
  const secret = await createPage(fx.owner.ctx, { title: titleFromPlainText('남의 비밀'), privateTop: true })
  const member = await joinAs(fx.workspaceId, await createUser('가져오기의 멤버'), 'member')
  assert.deepEqual(await importFiles(member.ctx, [file('m.md', 'x')], { parentPageId: secret.id }), { ok: false, reason: 'not_found' })
  assert.deepEqual(await importFiles(member.ctx, [file('m.md', 'x')], { parentPageId: '00000000-0000-4000-8000-000000000000' }), { ok: false, reason: 'not_found' })
  assert.deepEqual(await importFiles(member.ctx, [file('m.md', 'x')], { parentPageId: 'not-a-uuid' }), { ok: false, reason: 'not_found' })
})

test('★ ④ 거부 — 형식 · 수 · 크기(올리면 받는다) · UTF-8 아님 · 전부이거나 아무것도', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const before = await pageCount()
  assert.deepEqual(await importFiles(fx.owner.ctx, []), { ok: false, reason: 'no_files' })
  assert.deepEqual(await importFiles(fx.owner.ctx, [file('a.docx', 'x')]), { ok: false, reason: 'unsupported_type', file: 'a.docx' })
  const many = Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, i) => file(`${i}.md`, 'x'))
  assert.deepEqual(await importFiles(fx.owner.ctx, many), { ok: false, reason: 'too_many_files', limit: MAX_IMPORT_FILES })
  const big = file('big.md', 'a'.repeat(5 * 1024 * 1024 + 1))
  assert.deepEqual(await importFiles(fx.owner.ctx, [big]), { ok: false, reason: 'too_large', file: 'big.md', limit: 5 * 1024 * 1024 })
  const latin1: ImportFile = { name: 'bad.txt', bytes: new Uint8Array([0xff, 0xfe, 0x41]) }
  assert.deepEqual(await importFiles(fx.owner.ctx, [latin1]), { ok: false, reason: 'invalid_encoding', file: 'bad.txt' })
  // 앞 파일은 맞는데 뒤 파일이 거부 — 앞 파일의 페이지도 남지 않는다
  assert.deepEqual(await importFiles(fx.owner.ctx, [file('ok.md', '# 남으면 안 된다'), latin1]), { ok: false, reason: 'invalid_encoding', file: 'bad.txt' })
  assert.equal(await pageCount(), before, '거부된 가져오기가 페이지를 남겼다')

  await setWorkspacePlan(fx.workspaceId, 'plus')
  try {
    assert.ok((await importFiles(fx.owner.ctx, [big])).ok, '유료 요금제는 50 MiB 까지')
  } finally {
    await setWorkspacePlan(fx.workspaceId, 'free')
  }
})

test('⑤ 옮기지 못한 것 — 파일마다 · 합계', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const result = await importFiles(fx.owner.ctx, [
    file('a.md', '| a |\n|---|\n| 1 |\n\n![x](./local.png)'),
    file('b.md', '<div>html</div>\n\n| b |\n|---|\n| 2 |'),
  ])
  assert.ok(result.ok)
  assert.deepEqual(result.value.pages.map((p) => p.losses.tables), [1, 1])
  assert.deepEqual(result.value.losses, { tables: 2, html: 1, images: 1, links: 0, formatting: 0 })
})

// ── ZIP (8m-2a) ──
const zipOf = (files: readonly [string, string | Uint8Array][]): ImportFile => {
  const zip = createZipWriter()
  const parts: Uint8Array[] = []
  for (const [path, data] of files) parts.push(...zip.add(path, data))
  parts.push(zip.finish())
  return { name: 'export.zip', bytes: Buffer.concat(parts) }
}
/** 저장(store)만 하는 손 ZIP — 쓰기가 거부하는 경로(`../`)를 넣으려고. */
const rawZip = (files: readonly [string, Uint8Array][]): ImportFile => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [path, data] of files) {
    const name = Buffer.from(path)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt32LE(crc32(data) >>> 0, 14)
    head.writeUInt32LE(data.byteLength, 18)
    head.writeUInt32LE(data.byteLength, 22)
    head.writeUInt16LE(name.byteLength, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc32(data) >>> 0, 16)
    central.writeUInt32LE(data.byteLength, 20)
    central.writeUInt32LE(data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(head, name, Buffer.from(data))
    centrals.push(central, name)
    offset += 30 + name.byteLength + data.byteLength
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  return { name: 'hand.zip', bytes: Buffer.concat([...locals, dir, end]) }
}
const parentOf = async (pageId: string) =>
  (await query<{ parent_id: string }>(`SELECT parent_id FROM block WHERE id = $1`, [pageId]))[0]?.parent_id

test('★ ⑥ ZIP — 이름.md + 폴더가 계층으로 · 폴더만의 페이지 · 노션의 id 접미 · 제목은 # 제목', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const result = await importZip(fx.owner.ctx, zipOf([
    ['회의록.md', '# 2026 회의록\n\n본문'],
    ['회의록/1월.md', '# 1월\n\n- [ ] 할 일'],
    ['회의록/1월/첨부 메모.txt', '메모'],
    ['자료/안내 0123456789abcdef0123456789abcdef.md', '안내 본문'],
  ]))
  assert.ok(result.ok, JSON.stringify(result))
  const byTitle = new Map(result.value.pages.map((p) => [p.title, p.id]))
  assert.deepEqual([...byTitle.keys()], ['2026 회의록', '1월', '첨부 메모', '자료', '안내'])
  assert.equal(await parentOf(byTitle.get('1월')!), byTitle.get('2026 회의록'))
  assert.equal(await parentOf(byTitle.get('첨부 메모')!), byTitle.get('1월'))
  assert.equal(await parentOf(byTitle.get('안내')!), byTitle.get('자료'), '폴더만의 페이지가 부모다')
  // 하위 페이지는 부모 본문에 참조로 선다(보통의 하위 페이지와 같다) — 본문 뒤에
  assert.deepEqual(await bodyShape(byTitle.get('1월')!), [['to_do', '할 일'], ['page', '']])
  assert.deepEqual(result.value.skipped, [])
})

test('★ ⑦ ZIP 의 부분 성공 — 위험한 경로 · 가져올 수 없는 형식 · UTF-8 아님(빈 페이지 · 자식은 그대로)', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const enc = new TextEncoder()
  const result = await importZip(fx.owner.ctx, rawZip([
    ['../밖.md', enc.encode('나가면 안 된다')],
    ['그림.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ['깨진.md', new Uint8Array([0xff, 0xfe, 0x41])],
    ['깨진/자식.md', enc.encode('# 살아남은 자식')],
  ]))
  assert.ok(result.ok, JSON.stringify(result))
  assert.deepEqual(result.value.skipped.map((s) => [s.path, s.reason]), [
    ['../밖.md', 'unsafe_path'],
    ['그림.png', 'unsupported_type'],
    ['깨진.md', 'invalid_encoding'],
  ])
  const byTitle = new Map(result.value.pages.map((p) => [p.title, p.id]))
  assert.deepEqual([...byTitle.keys()], ['깨진', '살아남은 자식'])
  assert.deepEqual(await bodyShape(byTitle.get('깨진')!), [['page', '']], '읽지 못한 파일의 자리는 빈 페이지(자식의 참조만)')
  assert.equal(await parentOf(byTitle.get('살아남은 자식')!), byTitle.get('깨진'))
})

test('★ ⑧ ZIP 의 통째 거부 — ZIP 아님 · 크기 · 페이지 수 · 가져올 것 없음 · 놓을 곳(전부 되돌린다)', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const before = await pageCount()
  assert.deepEqual(await importZip(fx.owner.ctx, { name: 'x.zip', bytes: new TextEncoder().encode('not a zip, really not') }), { ok: false, reason: 'invalid_zip', file: 'x.zip' })
  const big: ImportFile = { name: 'big.zip', bytes: new Uint8Array(5 * 1024 * 1024 + 1) }
  assert.deepEqual(await importZip(fx.owner.ctx, big), { ok: false, reason: 'too_large', file: 'big.zip', limit: 5 * 1024 * 1024 })
  const many = zipOf(Array.from({ length: MAX_ZIP_PAGES + 1 }, (_, i): [string, string] => [`p${i}.md`, 'x']))
  assert.deepEqual(await importZip(fx.owner.ctx, many), { ok: false, reason: 'too_many_files', file: 'export.zip', limit: MAX_ZIP_PAGES })
  assert.deepEqual(await importZip(fx.owner.ctx, zipOf([['그림.png', 'x']])), { ok: false, reason: 'no_files', file: 'export.zip' })
  const member = await joinAs(fx.workspaceId, await createUser('ZIP 의 멤버'), 'member')
  const secret = await createPage(fx.owner.ctx, { title: titleFromPlainText('ZIP 의 비밀'), privateTop: true })
  assert.deepEqual(await importZip(member.ctx, zipOf([['a.md', 'x'], ['a/b.md', 'y']]), { parentPageId: secret.id }), { ok: false, reason: 'not_found' })
  assert.equal(await pageCount(), before + 1, '거부된 ZIP 이 페이지를 남겼다(비밀 페이지 하나만 늘었다)')
})
