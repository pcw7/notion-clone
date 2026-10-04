/**
 * 파일 가져오기 — 잔여 묶음 8m-1 (F-09-12)
 *
 *   ① 마크다운 하나 → 내 개인 최상위의 페이지 · 제목은 첫 `# 제목` · 본문은 블록으로
 *   ② 여럿 → 받은 순서대로 · 평문 · 제목 없는 마크다운은 파일 이름(확장자를 뺀다)
 *   ③ 놓을 곳 — 페이지 아래 · 게스트는 페이지를 줘야 한다 · 볼 수 없는 · 없는 · 모양이 틀린 부모는 not_found
 *   ④ 거부 — 형식 · 수 · 크기(요금제의 상한 — 올리면 받는다) · UTF-8 아님 · **전부이거나 아무것도**(뒤 파일이 거부되면 앞 파일도 없다)
 *   ⑤ 옮기지 못한 것 — 파일마다 · 합계
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
import { importFiles, MAX_IMPORT_FILES, type ImportFile } from './import.ts'

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
