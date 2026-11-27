/**
 * 동기화 블록의 읽는 길 — 내보내기 · 공개 · 공개 API 읽기 · 쓰기 (SB-5 · F-01-11 · 정본 §3.4 [보강 SB-0] ⑰ ⑱ ⑳ [SB-5 고침] · SY10)
 *
 * 길마다 한 쌍이다 — 원본 페이지 A 를 그 길의 주체가 읽을 수 있으면 사본 자리에 원본의 글, 못 읽으면 A 의 글 · A 의 블록 id · A 의 페이지 id 가
 * 응답 어디에도 없다(사본 자신의 `synced_from` 은 B 의 값이다).
 *
 *   ① 내보내기 — 내보내는 사람이 A 를 읽으면 사본이 원본의 글(+ 원본 안의 이미지가 첨부로) · 못 읽으면 주석 한 줄 · `omitted_synced_blocks`
 *   ② 공개 — A 가 웹에 열려 있지 않으면 사본을 뺀다 · 열면 원본의 글로 · 펼친 이미지는 B 의 토큰으로 열린다 · 게시를 내리면 다시 닫힌다
 *   ③ API 읽기 — 원본을 볼 수 있는 토큰만 원본의 자식을 · 사본의 자식은 늘 빈 목록
 *   ④ API 쓰기 — 원본 만들기 · 사본은 토큰이 원본을 볼 때만(아니면 없는 원본과 같은 400) · 사본에 붙이기 · 동기화 블록 안 · 고치기는 400
 *
 * AI 의 길(⑲)은 `ai/synced-source.db.test.ts`(가짜 공급자).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createApiToken } from '../api/api-token.ts'
import { appendBlockChildren, retrieveBlockChildren, updateApiBlock } from '../api/blocks.ts'
import { createApiPage } from '../api/pages.ts'
import { v1Route } from '../api/v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION } from '../api/v1-protocol.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { planExport } from '../export/plan.ts'
import { readExportSnapshot } from '../export/snapshot.ts'
import { uploadFile } from '../file/file.ts'
import { setFileStorage, type FileStorage } from '../file/storage.ts'
import { grantAccess } from '../permissions/acl.ts'
import { readPublicBlockFile } from '../publish/public-file.ts'
import { publishPage, unpublishPage } from '../publish/public-link.ts'
import { readPublicPage } from '../publish/public-read.ts'
import { reset } from '../rate-limit.ts'
import type { BlockId } from '../ids.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { loadPageBody, savePageBody } from './save-page-body.ts'
import { SYNCED_BLOCK_TYPE } from './synced-block.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''
// 원본 안의 이미지를 API 로 읽으면 파일 주소에 서명한다
process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

const memoryStorage = (): FileStorage => {
  const store = new Map<string, Uint8Array>()
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
})

after(async () => {
  setFileStorage(null)
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })
const copyOf = (id: string, x: string): EditorBlock => ({ id, type: SYNCED_BLOCK_TYPE, title: [], properties: { synced_from: x }, format: {}, children: [] })

async function newPage(by: Actor, title: string, blocks: EditorBlock[], privateTop: boolean): Promise<BlockId> {
  const page = (await createPage(by.ctx, { title: titleFromPlainText(title), privateTop })).id
  const saved = await savePageBody(by.ctx, page, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page
}

/**
 * 대표의 개인 페이지 A(동료는 볼 수 없다)에 원본 X(표지 글 · 이미지) · 워크스페이스 페이지 B(동료도 본다)에 X 의 사본. 글 · id 는 시험마다 새것.
 */
async function scenario() {
  const ws = await createBareWorkspace(`읽는 길 ${randomUUID().slice(0, 6)}`)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const png = await uploadFile(boss.ctx, { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), mime: 'image/png', originalName: '원본그림.png' })
  assert.ok(png.ok, JSON.stringify(png))
  const mark = `원본표지${randomUUID().slice(0, 6)}`
  const [x, a1, image, copy] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const a = await newPage(boss, '원본 A', [
    {
      id: x, type: SYNCED_BLOCK_TYPE, title: [], properties: {}, format: {},
      children: [para(a1, `${mark} 첫 줄`), { id: image, type: 'image', title: [], properties: { source: { type: 'file', file_id: png.file.id } }, format: {}, children: [] }],
    },
  ], true)
  const b = await newPage(boss, '사본 B', [para(randomUUID(), 'B 앞'), copyOf(copy, x), para(randomUUID(), 'B 끝')], false)
  return { ws, boss, mate, a, b, x, a1, image, copy, mark, fileId: png.file.id }
}

/** A 의 것이 하나도 없는가 — 글 · 원본 안의 블록 id · A 의 페이지 id · 원본 안의 파일 id. */
function assertNoA(text: string, s: Awaited<ReturnType<typeof scenario>>, where: string): void {
  for (const [what, value] of [['글', s.mark], ['원본 안의 블록 id', s.a1], ['이미지 블록 id', s.image], ['A 의 페이지 id', s.a], ['파일 id', s.fileId]] as const) {
    assert.ok(!text.includes(value), `${where} — ${what}가 없다`)
  }
}

describe('① 내보내기 (⑰)', () => {
  const exportOf = async (who: Actor, root: string) => {
    const snap = await readExportSnapshot(who.ctx, { kind: 'page', rootId: root })
    assert.ok(snap.ok, JSON.stringify(snap))
    if (!snap.ok) throw new Error('스냅숏')
    const plan = planExport(snap.value, { untitled: '제목 없음' })
    const markdown = plan.entries.flatMap((e) => (e.kind === 'text' && e.path.endsWith('.md') ? [e.text] : [])).join('\n')
    return { markdown, plan, nodes: JSON.stringify([...snap.value.nodes.values()]), files: [...snap.value.files.keys()] }
  }

  test('★ 원본을 읽을 수 있으면 사본 자리에 원본의 글 · 원본 안의 이미지는 첨부로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const got = await exportOf(s.boss, s.b)
    assert.ok(got.markdown.includes(`${s.mark} 첫 줄`), got.markdown)
    assert.ok(!got.markdown.includes('synced block omitted'), got.markdown)
    assert.match(got.markdown, /B 앞[\s\S]*원본표지[\s\S]*B 끝/, '사본의 자리에')
    assert.equal(got.plan.report.markdown_losses.omitted_synced_blocks, 0)
    assert.ok(got.plan.entries.some((e) => e.kind === 'file' && e.fileId === s.fileId), '원본 안의 이미지가 B 의 첨부로')
  })

  test('★ 원본을 읽을 수 없으면 주석 한 줄 · 생략으로 센다 — A 의 글 · 블록 id · 파일이 스냅숏 어디에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const got = await exportOf(s.mate, s.b)
    assert.ok(got.markdown.includes('<!-- synced block omitted -->'), got.markdown)
    assert.equal(got.plan.report.markdown_losses.omitted_synced_blocks, 1)
    assert.equal(got.plan.report.markdown_losses.unsupported, 0, '모르는 블록이 아니다')
    assertNoA(got.markdown, s, '마크다운')
    assertNoA(got.nodes, s, '스냅숏의 노드')
    assert.ok(!got.files.includes(s.fileId), '원본 안의 파일 메타도 읽지 않는다')
    assert.ok(!got.plan.entries.some((e) => e.kind === 'file'), '첨부도 없다')
    // 볼 수 있게 되면 펼친다 — 같은 사람 · 같은 사본
    assert.ok((await grantAccess(s.boss.ctx, s.a, { type: 'user', id: s.mate.userId }, 'view')).ok)
    assert.ok((await exportOf(s.mate, s.b)).markdown.includes(`${s.mark} 첫 줄`), '권한을 받으면 펼친다')
  })
})

describe('② 공개 (⑱)', () => {
  test('★ 원본 페이지가 웹에 열려 있지 않으면 사본을 뺀다(A 의 글 · id 없음 · 이미지도 닫힘) · 열면 원본의 글로 · 내리면 다시 닫힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const published = await publishPage(s.boss.ctx, s.b)
    assert.ok(published.ok, JSON.stringify(published))
    const token = published.value.token!
    const view = async () => {
      const read = await readPublicPage(token)
      assert.ok(read.ok, JSON.stringify(read))
      if (!read.ok) throw new Error('공개')
      return read.value
    }

    const closed = await view()
    const closedJson = JSON.stringify({ doc: closed.doc, pages: [...closed.pages], files: [...closed.files] })
    assert.deepEqual(closed.doc.blocks.map((b) => b.type), ['paragraph', 'paragraph'], '사본째 빠진다 — 자리도 없다')
    assertNoA(closedJson, s, '닫힌 공개 화면')
    assert.ok(!closedJson.includes(s.copy), '사본 블록도 없다')
    assert.equal(await readPublicBlockFile(token, s.image, 'image'), null, '원본 안의 이미지를 B 의 토큰으로 열 수 없다')

    // A 를 게시 — 이제 웹에 열려 있다
    assert.ok((await publishPage(s.boss.ctx, s.a)).ok)
    const open = await view()
    const copy = open.doc.blocks.find((b) => b.id === s.copy)
    assert.ok(copy !== undefined, '사본이 선다')
    assert.deepEqual(copy.children?.map((c) => c.id), [s.a1, s.image], '원본의 자식으로 편다')
    assert.ok(JSON.stringify(open.doc).includes(`${s.mark} 첫 줄`))
    const file = await readPublicBlockFile(token, s.image, 'image')
    assert.ok(file !== null && file.mime === 'image/png', '펼친 이미지는 B 의 토큰으로 열린다')

    // A 의 게시를 내리면 다시 닫힌다
    assert.ok((await unpublishPage(s.boss.ctx, s.a)).ok)
    assertNoA(JSON.stringify((await view()).doc), s, '다시 닫힌 공개 화면')
    assert.equal(await readPublicBlockFile(token, s.image, 'image'), null)
  })
})

/** 토큰 하나로 `v1Route` 를 부른다 — 요청 제한은 부를 때마다 비운다. */
async function apiAs(who: Actor) {
  const made = await createApiToken(who.ctx, { name: `SB-5 ${randomUUID().slice(0, 6)}` })
  assert.ok(made.ok)
  if (!made.ok) throw new Error('토큰')
  return async (handler: Parameters<typeof v1Route>[0], method: string, path: string, params: Record<string, string>, body?: unknown) => {
    await reset(API_RATE_NAMESPACE, made.value.summary.id)
    const headers: Record<string, string> = { authorization: `Bearer ${made.value.token}`, 'notion-version': NOTION_VERSION }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await v1Route(handler)(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), {
      params: Promise.resolve(params),
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
}

describe('③ 공개 API 읽기 (⑳)', () => {
  test('★ 원본을 볼 수 있는 토큰은 원본의 자식을 · 못 보는 토큰은 404 · 사본의 자식은 늘 빈 목록 — 못 보는 쪽 응답에 A 의 것이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const boss = await apiAs(s.boss)
    const mate = await apiAs(s.mate)

    const own = await boss(retrieveBlockChildren, 'GET', `/v1/blocks/${s.x}/children`, { block_id: s.x })
    assert.equal(own.status, 200)
    assert.deepEqual((own.body.results as { id: string }[]).map((r) => r.id), [s.a1, s.image], '볼 수 있으면 원본의 자식')

    const denied = await mate(retrieveBlockChildren, 'GET', `/v1/blocks/${s.x}/children`, { block_id: s.x })
    assert.equal(denied.status, 404, '볼 수 없으면 없는 것과 같다')
    assertNoA(JSON.stringify(denied.body), s, '404')
    const page = await mate(retrieveBlockChildren, 'GET', `/v1/blocks/${s.b}/children`, { block_id: s.b })
    assert.equal(page.status, 200)
    const copy = (page.body.results as Record<string, unknown>[]).find((r) => r.id === s.copy)
    assert.deepEqual(copy?.synced_block, { synced_from: { type: 'block_id', block_id: s.x } }, '사본 자신의 값(B 의 것)')
    assert.equal(copy?.has_children, false)
    assertNoA(JSON.stringify(page.body), s, 'B 의 자식 목록')
    const kids = await mate(retrieveBlockChildren, 'GET', `/v1/blocks/${s.copy}/children`, { block_id: s.copy })
    assert.deepEqual([kids.status, kids.body.results], [200, []], '사본의 자식은 빈 목록')
  })
})

describe('④ 공개 API 쓰기 (⑳)', () => {
  test('★ 원본 만들기 · 사본은 토큰이 원본을 볼 때만 — 못 보는 원본 · 없는 원본 · 사본을 가리키면 같은 400(A 의 것이 없다) · 볼 수 있게 되면 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const mate = await apiAs(s.mate)
    // 동료의 페이지 M — 동료가 고친다
    const m = await newPage(s.mate, '동료의 페이지', [para(randomUUID(), 'M')], false)
    const append = (target: string, children: unknown[]) => mate(appendBlockChildren, 'PATCH', `/v1/blocks/${target}/children`, { block_id: target }, { children })
    const p = (text: string) => ({ type: 'paragraph', paragraph: { rich_text: [{ text: { content: text } }] } })
    const copyReq = (id: string) => ({ type: 'synced_block', synced_block: { synced_from: { type: 'block_id', block_id: id } } })

    // 원본 만들기 — 자식 그대로 · 빈 원본은 빈 문단
    const made = await append(m, [{ type: 'synced_block', synced_block: { synced_from: null, children: [p('동료의 원본 글')] } }, { type: 'synced_block', synced_block: { synced_from: null } }])
    assert.equal(made.status, 200, JSON.stringify(made.body))
    const [mine, empty] = made.body.results as Record<string, unknown>[]
    assert.deepEqual([mine!.type, mine!.synced_block, mine!.has_children], ['synced_block', { synced_from: null }, true])
    assert.equal(empty!.has_children, true, '빈 원본도 자식(빈 문단) 하나')
    const body = (await loadPageBody(s.mate.ctx, m))!.doc.blocks
    assert.deepEqual(body.find((b) => b.id === mine!.id)?.children?.map((c) => c.title.map((r) => r.plain_text).join('')), ['동료의 원본 글'])

    // 사본 — 동료가 볼 수 없는 X · 없는 id · 사본의 id 는 모두 같은 400
    const unknown = randomUUID()
    const refused = [await append(m, [copyReq(s.x)]), await append(m, [copyReq(unknown)]), await append(m, [copyReq(s.copy)])]
    for (const [r, id] of [[refused[0]!, s.x], [refused[1]!, unknown], [refused[2]!, s.copy]] as const) {
      assert.equal(r.status, 400, JSON.stringify(r.body))
      assert.equal(String(r.body.message).replace(id, '<id>'), 'body failed validation: body.children[0].synced_block.synced_from.block_id should be the id of an original synced_block you can read, instead was "<id>".')
      assertNoA(JSON.stringify(r.body), s, '거부')
    }
    assert.ok(!JSON.stringify((await loadPageBody(s.mate.ctx, m))!.doc).includes(s.x), '거부된 사본은 쓰이지 않았다')
    // 새 페이지의 children 도 같은 판정
    const created = await mate(createApiPage, 'POST', '/v1/pages', {}, { parent: { page_id: m }, properties: { title: { title: [{ text: { content: '새 페이지' } }] } }, children: [copyReq(s.x)] })
    assert.equal(created.status, 400, JSON.stringify(created.body))

    // 자기 원본의 사본은 된다 · A 를 볼 수 있게 되면 X 의 사본도 된다
    const ownCopy = await append(m, [copyReq(String(mine!.id))])
    assert.equal(ownCopy.status, 200, JSON.stringify(ownCopy.body))
    assert.ok((await grantAccess(s.boss.ctx, s.a, { type: 'user', id: s.mate.userId }, 'view')).ok)
    const granted = await append(m, [copyReq(s.x)])
    assert.equal(granted.status, 200, JSON.stringify(granted.body))
    const result = (granted.body.results as Record<string, unknown>[])[0]!
    assert.deepEqual([result.synced_block, result.has_children], [{ synced_from: { type: 'block_id', block_id: s.x } }, false])
  })

  test('★ 사본에 붙이기 · 동기화 블록 안에 동기화 블록(그 블록 · 조상) · synced_block 고치기는 400 — 지우기는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const s = await scenario()
    const boss = await apiAs(s.boss)
    const append = (target: string, children: unknown[]) => boss(appendBlockChildren, 'PATCH', `/v1/blocks/${target}/children`, { block_id: target }, { children })
    const p = (text: string) => ({ type: 'paragraph', paragraph: { rich_text: [{ text: { content: text } }] } })

    const toCopy = await append(s.copy, [p('사본에')])
    assert.equal(toCopy.status, 400)
    assert.match(String(toCopy.body.message), /synced copy\. Append to its original/)
    // 원본에 보통 블록은 된다(SB-1) · 원본 안의 토글에 동기화 블록은 안 된다
    const toggle = await append(s.x, [{ type: 'toggle', toggle: { rich_text: [{ text: { content: '토글' } }] } }])
    assert.equal(toggle.status, 200, JSON.stringify(toggle.body))
    const toggleId = String((toggle.body.results as Record<string, unknown>[])[0]!.id)
    for (const target of [s.x, toggleId]) {
      const nested = await append(target, [{ type: 'synced_block', synced_block: { synced_from: null } }])
      assert.equal(nested.status, 400, target)
      assert.match(String(nested.body.message), /cannot be placed inside a synced_block/)
    }
    const patched = await boss(updateApiBlock, 'PATCH', `/v1/blocks/${s.x}`, { block_id: s.x }, { synced_block: { synced_from: null } })
    assert.equal(patched.status, 400)
    const removed = await boss(updateApiBlock, 'PATCH', `/v1/blocks/${s.copy}`, { block_id: s.copy }, { in_trash: true })
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.ok(!(await loadPageBody(s.boss.ctx, s.b))!.doc.blocks.some((b) => b.id === s.copy), '사본 지우기는 보통 블록과 같다')
  })
})
