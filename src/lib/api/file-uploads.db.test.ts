/**
 * 공개 API 의 파일 올리기 — 라우트 수준 (API-7 · F-09-08 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪ · §3.10 `api_file_upload`
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다(`pages.db.test.ts` 와 같다). 서명 주소의 응답은
 * 라우트가 부르는 `serveSignedFile` 을 그대로 부른다. 실제 서버 · SDK · 브라우저로는 e2e '공개 API — 파일 올리기 (API-7 · F-09-08)'.
 *
 *   ★ 만들기 → 보내기 → 읽기 — 세션 id = 파일 id · 앱의 파일 행(uploaded_by) · 상태 · 다시 보내기 400 · complete 400
 *   ★ 붙이기 — 이미지 블록 · 아이콘 · 커버 · files 속성 · 데이터베이스 아이콘 → 읽으면 서명 주소 → 같은 바이트 · 참조 수 · 붙으면 만료 없음
 *   ★ 서명 주소 — 바꾼 서명 · 지난 만료 403 · 없는 파일 404 · 앱의 머리
 *   ★ 왕복 — 읽은 `type:'file'` 을 그대로 PATCH 하면 같은 파일(지난 주소도) · 바깥 주소의 `type:'file'` 400 · 옛 file_upload 도
 *   ★ 거부 — 보내지 않은 · 지난 업로드 · 남의 업로드(404 · 붙이기 400) · 다른 워크스페이스(400) · 너무 큰 · 말과 다른 바이트(행 없이) ·
 *     잠긴 페이지(붙인 표시도 되돌린다) · multi_part
 *   ★ 목록 — 내 것만 · 최근 것부터 · status · 커서
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createPage } from '../block/page.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { query } from '../db/pool.ts'
import { setPageLock } from '../permissions/lock.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createApiToken } from './api-token.ts'
import { appendBlockChildren, retrieveBlockChildren } from './blocks.ts'
import {
  completeApiFileUpload,
  createApiFileUpload,
  listApiFileUploads,
  retrieveApiFileUpload,
  sendApiFileUpload,
} from './file-uploads.ts'
import { fileUrlKey, signedFileUrl } from './file-url.ts'
import { createApiPage, retrievePage, updateApiPage } from './pages.ts'
import { updateApiDatabase } from './schema-writes.ts'
import { serveSignedFile } from './signed-file.ts'
import { v1Route } from './v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION } from './v1-protocol.ts'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

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
    const { closeValkey } = await import('../valkey.ts')
    await closeValkey()
  }
})

// ── 부르기 ────────────────────────────────────────────────────────────

type Caller = Actor & { readonly api: string; readonly apiId: string }

async function withToken(actor: Actor): Promise<Caller> {
  const made = await createApiToken(actor.ctx, { name: 'API-7 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  create: v1Route(createApiFileUpload),
  send: v1Route(sendApiFileUpload, { body: 'multipart' }),
  complete: v1Route(completeApiFileUpload),
  get: v1Route(retrieveApiFileUpload),
  list: v1Route(listApiFileUploads),
  append: v1Route(appendBlockChildren),
  children: v1Route(retrieveBlockChildren),
  getPage: v1Route(retrievePage),
  patchPage: v1Route(updateApiPage),
  postPage: v1Route(createApiPage),
  patchDatabase: v1Route(updateApiDatabase),
}

type Reply = { readonly status: number; readonly body: unknown }

async function call(who: Caller, route: keyof typeof ROUTES, method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Reply> {
  await reset(API_RATE_NAMESPACE, who.apiId)
  const headers: Record<string, string> = { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await ROUTES[route](new Request(`http://localhost${path}`, { method, headers, body: payload }), { params: Promise.resolve(params) })
  return { status: res.status, body: await res.json() }
}

const createUpload = (who: Caller, body: unknown = {}) => call(who, 'create', 'POST', '/v1/file_uploads', {}, body)
const getUpload = (who: Caller, id: string) => call(who, 'get', 'GET', `/v1/file_uploads/${id}`, { file_upload_id: id })
const completeUpload = (who: Caller, id: string) => call(who, 'complete', 'POST', `/v1/file_uploads/${id}/complete`, { file_upload_id: id })
const listUploads = (who: Caller, search = '') => call(who, 'list', 'GET', `/v1/file_uploads${search}`, {})
const append = (who: Caller, id: string, body: unknown) => call(who, 'append', 'PATCH', `/v1/blocks/${id}/children`, { block_id: id }, body)
const children = (who: Caller, id: string) => call(who, 'children', 'GET', `/v1/blocks/${id}/children`, { block_id: id })
const getPage = (who: Caller, id: string) => call(who, 'getPage', 'GET', `/v1/pages/${id}`, { page_id: id })
const patchPage = (who: Caller, id: string, body: unknown) => call(who, 'patchPage', 'PATCH', `/v1/pages/${id}`, { page_id: id }, body)
const postPage = (who: Caller, body: unknown) => call(who, 'postPage', 'POST', '/v1/pages', {}, body)
const patchDatabase = (who: Caller, id: string, body: unknown) => call(who, 'patchDatabase', 'PATCH', `/v1/databases/${id}`, { database_id: id }, body)

function send(who: Caller, id: string, bytes: Uint8Array, type = '', name = 'blob', extra: Record<string, string> = {}): Promise<Reply> {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart], { type }), name)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return call(who, 'send', 'POST', `/v1/file_uploads/${id}/send`, { file_upload_id: id }, form)
}

function dig(value: unknown, ...path: (string | number)[]): unknown {
  let at: unknown = value
  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined
    at = (at as Record<string | number, unknown>)[key]
  }
  return at
}

function assertError(r: Reply, status: number, code: string, message?: RegExp) {
  assert.equal(r.status, status, JSON.stringify(r.body))
  assert.equal(dig(r.body, 'object'), 'error')
  assert.equal(dig(r.body, 'code'), code)
  if (message) assert.match(String(dig(r.body, 'message')), message)
}

/** 서명 주소를 앱처럼 연다(`app/api/files/[fileId]` 가 부르는 그것). */
async function openSigned(url: string, now?: Date): Promise<Response> {
  const fileId = new URL(url).pathname.split('/').pop()!
  return serveSignedFile(new Request(url), fileId, now)
}

// ── 준비 ──────────────────────────────────────────────────────────────

/** 8x8 PNG(머리만 PNG 면 앱이 받는다 — 바이트 머리로 가린다). */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0])
const TEXT = new TextEncoder().encode('그냥 글자\n')

async function workspace(name: string) {
  const ws = await createBareWorkspace(name)
  const owner = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const member = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  const mate = await withToken(await joinAs(ws, await createUser(`${name} 동료`), 'member'))
  return { ws, owner, member, mate }
}

/** 만들고 보낸 업로드의 id. */
async function uploaded(who: Caller, bytes: Uint8Array = PNG, create: Record<string, unknown> = { filename: '점.png', content_type: 'image/png' }): Promise<string> {
  const made = await createUpload(who, create)
  assert.equal(made.status, 200, JSON.stringify(made.body))
  const id = String(dig(made.body, 'id'))
  const sent = await send(who, id, bytes)
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  return id
}

const fileRow = async (id: string) =>
  (await query<{ id: string; mime: string; size_bytes: string; uploaded_by: string; ref_count: number; original_name: string | null }>(
    `SELECT id, mime, size_bytes, uploaded_by, ref_count, original_name FROM file WHERE id = $1`,
    [id],
  ))[0]
const sessionRow = async (id: string) =>
  (await query<{ status: string; attached_at: Date | null; expires_at: Date | null }>(`SELECT status, attached_at, expires_at FROM api_file_upload WHERE id = $1`, [id]))[0]

/** 지난 업로드로 — 만든 시각까지 옮긴다(만료는 만든 시각보다 뒤여야 한다 — CHECK). */
async function expire(id: string): Promise<void> {
  await query(
    `UPDATE api_file_upload SET created_at = now() - interval '2 hours', last_edited_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1`,
    [id],
  )
}

// 주소의 출처 — 앱과 같은 규칙(`NEXT_PUBLIC_APP_URL` 이 있으면 그것 · 없으면 요청의 것). `.env` 를 읽고 돌려도 맞는다
const ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost').replace(/\/+$/, '')
const ORIGIN_RE = ORIGIN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

describe('공개 API 의 파일 올리기 (API-7)', () => {
  test('★ 만들기 → 보내기 → 읽기 — 세션 id = 파일 id · 앱의 파일 행 · 상태 · 다시 보내기 · complete', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { member } = await workspace('올리기')
    const made = await createUpload(member, { filename: '점.png', content_type: 'image/png' })
    assert.equal(made.status, 200, JSON.stringify(made.body))
    const id = String(dig(made.body, 'id'))
    assert.equal(dig(made.body, 'object'), 'file_upload')
    assert.equal(dig(made.body, 'status'), 'pending')
    assert.equal(dig(made.body, 'upload_url'), `${ORIGIN}/v1/file_uploads/${id}/send`)
    assert.deepEqual(dig(made.body, 'created_by'), { id: member.userId, type: 'person' })
    const ttl = Date.parse(String(dig(made.body, 'expiry_time'))) - Date.parse(String(dig(made.body, 'created_time')))
    assert.ok(Math.abs(ttl - 3600_000) < 2000, `만료는 1시간 뒤 — ${ttl}`)
    assert.equal(await fileRow(id), undefined, '보내기 전에는 파일 행이 없다')

    const sent = await send(member, id, PNG, 'image/png', 'x.png')
    assert.equal(sent.status, 200, JSON.stringify(sent.body))
    assert.equal(dig(sent.body, 'status'), 'uploaded')
    assert.equal(dig(sent.body, 'content_length'), PNG.byteLength)
    assert.equal(dig(sent.body, 'content_type'), 'image/png')
    assert.equal(dig(sent.body, 'filename'), '점.png', '만들 때의 이름이 먼저')
    assert.equal('upload_url' in (sent.body as object), false)
    const file = await fileRow(id)
    assert.ok(file, '파일 행의 id 가 업로드 id 다')
    assert.deepEqual([file.mime, Number(file.size_bytes), file.uploaded_by, file.original_name], ['image/png', PNG.byteLength, member.userId, '점.png'])

    const read = await getUpload(member, id)
    assert.equal(read.status, 200)
    assert.equal(dig(read.body, 'status'), 'uploaded')
    assertError(await send(member, id, PNG), 400, 'validation_error', /already been sent/)
    assertError(await completeUpload(member, id), 400, 'validation_error', /single_part/)
    assertError(await getUpload(member, 'nope'), 400, 'validation_error', /path\.file_upload_id should be a valid uuid/)
    assertError(await createUpload(member, { mode: 'multi_part', number_of_parts: 2 }), 400, 'validation_error', /multi_part" is not supported/)
    assertError(await createUpload(member, { mode: 'external_url', external_url: 'https://example.com/a.png' }), 400, 'validation_error', /external_url" is not supported/)
    assertError(await createUpload(member, { content_type: 'png' }), 400, 'validation_error', /content_type should be a MIME type/)
  })

  test('★ 이미지 블록에 붙이기 → 읽으면 서명 주소 → 같은 바이트 · 바꾼 · 지난 서명 403 · 없는 파일 404 · 붙으면 만료 없음', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { member } = await workspace('블록')
    const page = await createPage(member.ctx, { title: [textRun('파일 페이지')], privateTop: true })
    const id = await uploaded(member)
    const appended = await append(member, page.id, { children: [{ type: 'image', image: { type: 'file_upload', file_upload: { id } } }] })
    assert.equal(appended.status, 200, JSON.stringify(appended.body))
    const attached = await sessionRow(id)
    assert.ok(attached.attached_at !== null && attached.expires_at === null, '붙으면 만료가 없다')
    assert.equal(dig((await getUpload(member, id)).body, 'expiry_time'), null)

    const listed = await children(member, page.id)
    const image = dig(listed.body, 'results', 0, 'image') as { type: string; file: { url: string; expiry_time: string } }
    assert.equal(image.type, 'file')
    assert.match(image.file.url, new RegExp(`^${ORIGIN_RE}/api/files/${id}\\?expires=\\d+&signature=[A-Za-z0-9_-]{43}$`))
    const left = Date.parse(image.file.expiry_time) - Date.now()
    assert.ok(left > 3500_000 && left <= 3600_000, `1시간 — ${left}`)

    const opened = await openSigned(image.file.url)
    assert.equal(opened.status, 200)
    assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), PNG, '같은 바이트')
    assert.equal(opened.headers.get('content-type'), 'image/png')
    assert.equal(opened.headers.get('content-disposition'), 'inline')
    assert.equal(opened.headers.get('x-content-type-options'), 'nosniff')
    assert.match(opened.headers.get('cache-control') ?? '', /^private, max-age=\d+$/)

    const tampered = image.file.url.replace(/signature=(.)/, (_m, c: string) => `signature=${c === 'A' ? 'B' : 'A'}`)
    assert.equal((await openSigned(tampered)).status, 403, '바꾼 서명')
    assert.equal((await openSigned(image.file.url.replace(/expires=\d+/, 'expires=9999999999'))).status, 403, '늘린 만료')
    assert.equal((await openSigned(image.file.url, new Date(Date.now() + 3601_000))).status, 403, '지난 주소')
    const ghost = signedFileUrl('http://localhost', fileUrlKey(), randomUUID(), new Date()).url
    assert.equal((await openSigned(ghost)).status, 404, '서명은 맞지만 없는 파일')

    // 참조 수 — 앱의 본문 투영이 센다
    assert.ok((await fileRow(id)).ref_count >= 1, '이미지 블록이 파일을 가리킨다')
  })

  test('★ 아이콘 · 커버 · files 속성 · 데이터베이스 아이콘 — 읽으면 서명 주소 · 읽은 값을 그대로 PATCH 하면 같은 파일(지난 주소도)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('모습')
    const page = await createPage(member.ctx, { title: [textRun('모습 페이지')], privateTop: true })
    const icon = await uploaded(member)
    const cover = await uploaded(member)
    const set = await patchPage(member, page.id, { icon: { type: 'file_upload', file_upload: { id: icon } }, cover: { file_upload: { id: cover } } })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.equal(dig(set.body, 'icon', 'type'), 'file')
    assert.equal(dig(set.body, 'cover', 'type'), 'file')
    const read = await getPage(member, page.id)
    const iconUrl = String(dig(read.body, 'icon', 'file', 'url'))
    const coverUrl = String(dig(read.body, 'cover', 'file', 'url'))
    assert.ok(iconUrl.includes(`/api/files/${icon}?`) && coverUrl.includes(`/api/files/${cover}?`))
    assert.deepEqual(new Uint8Array(await (await openSigned(iconUrl)).arrayBuffer()), PNG)
    assert.equal((await fileRow(icon)).ref_count, 1, '아이콘의 참조')
    assert.equal((await fileRow(cover)).ref_count, 1, '커버의 참조')

    // 왕복 — 읽은 그대로(만료가 지난 주소여도 서명이 맞으면 같은 파일)
    const stale = signedFileUrl('http://localhost', fileUrlKey(), icon, new Date('2020-01-01T00:00:00Z'))
    const back = await patchPage(member, page.id, { icon: { type: 'file', file: stale }, cover: dig(read.body, 'cover') })
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.ok(String(dig(back.body, 'icon', 'file', 'url')).includes(`/api/files/${icon}?`))
    assert.equal((await fileRow(icon)).ref_count, 1, '같은 아이콘 — 참조가 늘지 않는다')
    assertError(await patchPage(member, page.id, { icon: { type: 'file', file: { url: 'https://cdn.example.com/a.png' } } }), 400, 'validation_error', /body\.icon\.file\.url should be a file URL read from this API/)
    assertError(await patchPage(member, page.id, { cover: { type: 'file', file: { url: iconUrl.replace(/signature=[^&]+/, `signature=${'A'.repeat(43)}`) } } }), 400, 'validation_error', /body\.cover\.file\.url/)

    // files 속성 — 소유자의 워크스페이스 표 · 멤버가 행을 쓴다
    const table = await createDatabase(owner.ctx, { name: '파일 표' })
    if (!table.ok) throw new Error(table.reason)
    const ds = table.value.dataSourceId
    const added = await addProperty(owner.ctx, ds, { name: '첨부', type: 'files' })
    if (!added.ok) throw new Error(added.reason)
    const attachment = await uploaded(member, TEXT, { filename: '메모.txt' })
    const row = await postPage(member, {
      parent: { data_source_id: ds },
      properties: { 첨부: { files: [{ name: '메모.txt', type: 'file_upload', file_upload: { id: attachment } }] } },
    })
    assert.equal(row.status, 200, JSON.stringify(row.body))
    const files = dig(row.body, 'properties', '첨부', 'files') as { name: string; type: string; file: { url: string } }[]
    assert.equal(files[0]?.type, 'file')
    assert.equal(files[0]?.name, '메모.txt')
    const download = await openSigned(files[0]!.file.url)
    assert.equal(download.headers.get('content-type'), 'application/octet-stream', '이미지가 아니면 내려받기(앱의 머리)')
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/)
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), TEXT)
    const rowId = String(dig(row.body, 'id'))
    const again = await patchPage(member, rowId, { properties: { 첨부: { files } } })
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.ok(String(dig(again.body, 'properties', '첨부', 'files', 0, 'file', 'url')).includes(`/api/files/${attachment}?`), '읽은 값을 그대로 — 같은 파일')
    assertError(
      await patchPage(member, rowId, { properties: { 첨부: { files: [{ name: 'x', type: 'file', file: { url: 'https://cdn.example.com/x' } }] } } }),
      400,
      'validation_error',
      /files\[0\]\.file\.url should be a file URL read from this API/,
    )

    // 데이터베이스 아이콘 — 소유자의 업로드
    const dbIcon = await uploaded(owner)
    const dbSet = await patchDatabase(owner, table.value.id, { icon: { type: 'file_upload', file_upload: { id: dbIcon } } })
    assert.equal(dbSet.status, 200, JSON.stringify(dbSet.body))
    assert.ok(String(dig(dbSet.body, 'icon', 'file', 'url')).includes(`/api/files/${dbIcon}?`))
  })

  test('★ 거부 — 보내지 않은 · 지난 업로드 · 남의 것 · 다른 워크스페이스 · 너무 큰 · 말과 다른 바이트 · 잠긴 페이지 · 블록 형식', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { member, mate } = await workspace('거부')
    const page = await createPage(member.ctx, { title: [textRun('거부 페이지')], privateTop: true })
    const image = (id: string) => ({ children: [{ type: 'image', image: { file_upload: { id } } }] })

    // 보내지 않은 업로드
    const pending = String(dig((await createUpload(member, {})).body, 'id'))
    assertError(await append(member, page.id, image(pending)), 400, 'validation_error', /has not been sent yet \(status "pending"\)/)

    // 지난 업로드 — 보내기 · 붙이기 모두
    const late = String(dig((await createUpload(member, {})).body, 'id'))
    await expire(late)
    assertError(await send(member, late, PNG), 400, 'validation_error', /has expired/)
    assert.equal(dig((await getUpload(member, late)).body, 'status'), 'expired')
    const lateSent = await uploaded(member)
    await expire(lateSent)
    assertError(await append(member, page.id, image(lateSent)), 400, 'validation_error', /has expired/)

    // 남의 업로드 — 읽기 · 보내기 · complete 는 404 · 붙이기는 400(모르는 id 와 같은 글)
    const theirs = await uploaded(mate)
    assertError(await getUpload(member, theirs), 404, 'object_not_found')
    assertError(await send(member, theirs, PNG), 404, 'object_not_found')
    assertError(await completeUpload(member, theirs), 404, 'object_not_found')
    assertError(await append(member, page.id, image(theirs)), 400, 'validation_error', /should be a file uploaded to this workspace/)
    // 붙은 뒤로는 보통의 워크스페이스 파일 — 누구의 쓰기든 받는다(노션 — 같은 id 를 여러 곳에)
    const matePage = await createPage(mate.ctx, { title: [textRun('동료 페이지')], privateTop: true })
    assert.equal((await append(mate, matePage.id, image(theirs))).status, 200)
    assert.equal((await append(member, page.id, image(theirs))).status, 200)

    // 다른 워크스페이스의 업로드
    const away = await workspace('다른 곳')
    const foreign = await uploaded(away.member)
    assertError(await append(member, page.id, image(foreign)), 400, 'validation_error', /should be a file uploaded to this workspace/)
    assertError(await getUpload(member, foreign), 404, 'object_not_found')

    // 너무 큰 — 파일의 상한을 넘는 것(앱의 판정) · 본문의 상한을 넘는 것(읽지 않는다) · 둘 다 파일 행 없이 pending 으로 남는다
    const big = String(dig((await createUpload(member, { filename: '큰.bin' })).body, 'id'))
    const over = new Uint8Array(5 * 1024 * 1024 + 1)
    assertError(await send(member, big, over), 400, 'validation_error', /too large.*5MB/)
    assertError(await send(member, big, new Uint8Array(5 * 1024 * 1024 + 200 * 1024)), 400, 'validation_error', /too large/)
    assert.equal(await fileRow(big), undefined)
    assert.equal((await sessionRow(big)).status, 'pending')

    // 이미지라 말하고 글자를 보냈다 — 행 없이 400 · 글자 파일은 이미지 블록에 붙지 않는다(앱의 형식 검사)
    const liar = String(dig((await createUpload(member, { filename: '가짜.png', content_type: 'image/png' })).body, 'id'))
    assertError(await send(member, liar, TEXT), 400, 'validation_error', /file content is not image\/png/)
    assert.equal(await fileRow(liar), undefined)
    const text = await uploaded(member, TEXT, { filename: '글.txt' })
    assertError(await append(member, page.id, image(text)), 400, 'validation_error', /should be an image file, instead was a file of type "text\/plain"/)
    assert.equal((await sessionRow(text)).attached_at, null, '거부된 쓰기는 붙인 표시도 되돌린다')
    assert.equal((await append(member, page.id, { children: [{ type: 'file', file: { file_upload: { id: text } } }] })).status, 200, '파일 블록은 받는다')

    // 잠긴 페이지 — 400 · 붙인 표시도 되돌린다
    const fresh = await uploaded(member)
    assert.equal((await setPageLock(member.ctx, page.id, true)).ok, true)
    assertError(await append(member, page.id, image(fresh)), 400, 'validation_error', /locked/)
    assertError(await patchPage(member, page.id, { icon: { file_upload: { id: fresh } } }), 400, 'validation_error')
    assert.equal((await sessionRow(fresh)).attached_at, null)
    assert.equal((await setPageLock(member.ctx, page.id, false)).ok, true)
    assert.equal((await patchPage(member, page.id, { icon: { file_upload: { id: fresh } } })).status, 200)
    assert.ok((await sessionRow(fresh)).attached_at !== null)
  })

  test('★ 목록 — 내 것만 · 최근 것부터 · status · 커서는 그 거르기에 묶인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { member, mate } = await workspace('목록')
    const a = String(dig((await createUpload(member, { filename: 'a.png' })).body, 'id'))
    const b = await uploaded(member)
    const c = String(dig((await createUpload(member, { filename: 'c.png' })).body, 'id'))
    await expire(a)
    await uploaded(mate)

    const all = await listUploads(member)
    assert.equal(all.status, 200, JSON.stringify(all.body))
    assert.equal(dig(all.body, 'object'), 'list')
    assert.equal(dig(all.body, 'type'), 'file_upload')
    const ids = (dig(all.body, 'results') as { id: string }[]).map((r) => r.id)
    assert.deepEqual(ids, [c, b, a], '내 것만 · 최근 것부터(a 는 두 시간 전으로 옮겼다)')

    const first = await listUploads(member, '?page_size=2')
    assert.equal(dig(first.body, 'has_more'), true)
    const cursor = String(dig(first.body, 'next_cursor'))
    const second = await listUploads(member, `?page_size=2&start_cursor=${cursor}`)
    assert.deepEqual((dig(second.body, 'results') as { id: string }[]).map((r) => r.id), [a])
    assert.equal(dig(second.body, 'has_more'), false)
    assert.equal(dig(second.body, 'next_cursor'), null)

    const only = async (status: string) => ((dig((await listUploads(member, `?status=${status}`)).body, 'results') as { id: string }[]) ?? []).map((r) => r.id)
    assert.deepEqual(await only('pending'), [c])
    assert.deepEqual(await only('uploaded'), [b])
    assert.deepEqual(await only('expired'), [a])
    assert.deepEqual(await only('failed'), [])
    assertError(await listUploads(member, '?status=done'), 400, 'validation_error', /query\.status should be/)
    assertError(await listUploads(member, `?status=pending&start_cursor=${cursor}`), 400, 'validation_error', /start_cursor is not a valid cursor/)
  })
})
