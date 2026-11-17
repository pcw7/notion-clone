/**
 * 공개 API 의 코멘트 — 라우트 수준 (API-5 · F-09-07 · F-09-03 · F-09-04 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④ ⑤ ⑩ · §3.9 `discussion` · `comment`
 *
 * 라우트 파일은 `v1Route(handler)` 한 줄이라 같은 것을 여기서 만들어 `Request` 로 부른다. 실제 서버 · 브라우저(열린 코멘트 패널)로는 e2e
 * '공개 API — 검색 · 댓글 · 사용자 (API-5 · F-09-06 · F-09-07)' 가 본다.
 *
 *   ★ 페이지 스레드 · 블록 스레드 · 답글 — 노션의 코멘트 객체 · 행위자는 토큰의 사람 · 페이지의 목록은 둘 다 · 블록의 목록은 그 블록 것만
 *   ★ 해결된 스레드는 목록에 없다(id 로는 읽힌다) · 쪽을 넘겨도 빠짐 · 겹침 없다 · 다른 블록의 커서는 400
 *   ★ 코멘트 안의 사람 멘션은 멘션 알림 — 멘션된 멤버의 인박스 행 · 고칠 때는 새로 든 사람만
 *   ★ 볼 수만 있는 사람은 403 · 볼 수 없으면 404 · 남의 코멘트는 고치기 · 지우기 403 · 내 것은 된다(지우면 지우기 전의 객체 · 그 뒤 404)
 *   ★ 잠긴 페이지에도 단다(앱과 같다) · 데이터베이스 id 는 400 · 내보내기 정책을 끄면 멤버는 403
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { createPage } from '../block/page.ts'
import { setDiscussionResolved } from '../comment/discussion.ts'
import { createDatabase } from '../database/database.ts'
import { query as sql } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { reset } from '../rate-limit.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { writeExportPolicyIn } from '../workspace/security-policy.ts'
import { createApiToken } from './api-token.ts'
import { appendBlockChildren } from './blocks.ts'
import { createApiComment, deleteApiComment, listApiComments, retrieveApiComment, updateApiComment } from './comments.ts'
import { v1Route } from './v1.ts'
import { API_RATE_NAMESPACE, NOTION_VERSION } from './v1-protocol.ts'

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
  const made = await createApiToken(actor.ctx, { name: 'API-5 코멘트 시험' })
  if (!made.ok) throw new Error(made.reason)
  return { ...actor, api: made.value.token, apiId: made.value.summary.id }
}

const ROUTES = {
  list: v1Route(listApiComments),
  create: v1Route(createApiComment),
  get: v1Route(retrieveApiComment),
  patch: v1Route(updateApiComment),
  delete: v1Route(deleteApiComment),
  append: v1Route(appendBlockChildren),
}

type Reply = { readonly status: number; readonly body: Record<string, unknown> }

async function call(who: Caller, route: keyof typeof ROUTES, method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Reply> {
  await reset(API_RATE_NAMESPACE, who.apiId)
  const headers: Record<string, string> = { authorization: `Bearer ${who.api}`, 'notion-version': NOTION_VERSION }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await ROUTES[route](
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve(params) },
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const list = (who: Caller, blockId: string, search = '') => call(who, 'list', 'GET', `/v1/comments?block_id=${blockId}${search}`, {})
const create = (who: Caller, body: unknown) => call(who, 'create', 'POST', '/v1/comments', {}, body)
const get = (who: Caller, id: string) => call(who, 'get', 'GET', `/v1/comments/${id}`, { comment_id: id })
const patch = (who: Caller, id: string, body: unknown) => call(who, 'patch', 'PATCH', `/v1/comments/${id}`, { comment_id: id }, body)
const remove = (who: Caller, id: string) => call(who, 'delete', 'DELETE', `/v1/comments/${id}`, { comment_id: id })

type ApiComment = {
  object: string
  id: string
  parent: Record<string, string>
  discussion_id: string
  created_by: { object: string; id: string }
  rich_text: { plain_text: string; type: string; mention?: Record<string, unknown> }[]
  attachments: unknown[]
  display_name: { type: string; resolved_name: string }
  created_time: string
  last_edited_time: string
}

const comment = (r: Reply): ApiComment => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body as unknown as ApiComment
}
const texts = (r: Reply): string[] => {
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return (r.body.results as ApiComment[]).map((c) => c.rich_text.map((t) => t.plain_text).join(''))
}
function assertError(r: Reply, status: number, code: string, message?: RegExp) {
  assert.equal(r.status, status, JSON.stringify(r.body))
  assert.equal(r.body.object, 'error')
  assert.equal(r.body.code, code)
  if (message) assert.match(String(r.body.message), message)
}

const rt = (content: string) => [{ type: 'text', text: { content } }]

// ── 준비 ──────────────────────────────────────────────────────────────

async function workspace(name: string) {
  const ws = await createBareWorkspace(name)
  const owner = await withToken(await joinAs(ws, await createUser(`${name} 소유자`), 'owner'))
  const member = await withToken(await joinAs(ws, await createUser(`${name} 멤버`), 'member'))
  return { ws, owner, member }
}

const must = <T>(r: { ok: boolean; value?: T; reason?: string }, what: string): T => {
  if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
  return r.value as T
}

/** 본문에 문단 하나를 붙인 페이지 — API-3 의 본문 세션으로(블록 스레드의 자리). */
async function pageWithBlock(who: Caller, title: string, privateTop = false): Promise<{ pageId: string; blockId: string }> {
  const page = await createPage(who.ctx, { title: [textRun(title)], privateTop })
  const appended = await call(who, 'append', 'PATCH', `/v1/blocks/${page.id}/children`, { block_id: page.id }, {
    children: [{ type: 'paragraph', paragraph: { rich_text: rt('코멘트를 달 문단') } }],
  })
  assert.equal(appended.status, 200, JSON.stringify(appended.body))
  return { pageId: page.id, blockId: (appended.body.results as { id: string }[])[0].id }
}

describe('공개 API 의 코멘트 (API-5)', () => {
  test('★ 페이지 스레드 · 블록 스레드 · 답글 — 노션의 객체 · 행위자는 토큰의 사람 · 페이지의 목록은 둘 다 · 블록의 목록은 그 블록 것만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('코멘트 기본')
    const { pageId, blockId } = await pageWithBlock(owner, '코멘트 페이지')

    const first = comment(await create(member, { parent: { page_id: pageId }, rich_text: [{ text: { content: '페이지에 ' }, annotations: { bold: true } }, { text: { content: '한마디' } }] }))
    assert.equal(first.object, 'comment')
    assert.deepEqual(first.parent, { type: 'page_id', page_id: pageId })
    assert.deepEqual(first.created_by, { object: 'user', id: member.userId })
    assert.deepEqual(first.display_name, { type: 'user', resolved_name: '코멘트 기본 멤버' })
    assert.deepEqual(first.attachments, [])
    assert.equal(first.created_time, first.last_edited_time)
    assert.equal(first.rich_text.map((r) => r.plain_text).join(''), '페이지에 한마디')
    // 행위자는 토큰의 사람 — 저장된 행
    const stored = await sql<{ created_by: string; page_id: string; parent_block_id: string }>(
      `SELECT c.created_by, d.page_id, d.parent_block_id FROM comment c JOIN discussion d ON d.id = c.discussion_id WHERE c.id = $1`,
      [first.id],
    )
    assert.deepEqual(stored[0], { created_by: member.userId, page_id: pageId, parent_block_id: pageId })

    const onBlock = comment(await create(member, { parent: { type: 'block_id', block_id: blockId }, rich_text: rt('문단에 한마디') }))
    assert.deepEqual(onBlock.parent, { type: 'block_id', block_id: blockId })
    assert.notEqual(onBlock.discussion_id, first.discussion_id)

    const reply = comment(await create(owner, { discussion_id: first.discussion_id, rich_text: rt('답글') }))
    assert.equal(reply.discussion_id, first.discussion_id)
    assert.deepEqual(reply.created_by, { object: 'user', id: owner.userId })
    assert.deepEqual(reply.parent, { type: 'page_id', page_id: pageId })

    // 페이지 id 를 블록으로 주면 페이지 스레드다
    const viaBlockKey = comment(await create(member, { parent: { block_id: pageId }, rich_text: rt('블록 열쇠로 페이지') }))
    assert.deepEqual(viaBlockKey.parent, { type: 'page_id', page_id: pageId })

    const all = await list(owner, pageId)
    assert.equal(all.body.type, 'comment')
    assert.deepEqual(all.body.comment, {})
    assert.deepEqual(texts(all), ['페이지에 한마디', '답글', '문단에 한마디', '블록 열쇠로 페이지'])
    assert.deepEqual(texts(await list(owner, blockId)), ['문단에 한마디'])
    assert.deepEqual(comment(await get(owner, reply.id)), reply)
    // 볼 수 없는 페이지에 있다고 말하지 않는다 — 없는 블록 · 없는 스레드
    assertError(await list(owner, '00000000-0000-4000-8000-000000000000'), 404, 'object_not_found', /Could not find block/)
    assertError(await create(owner, { discussion_id: '00000000-0000-4000-8000-000000000000', rich_text: rt('x') }), 404, 'object_not_found', /discussion/)
  })

  test('★ 해결된 스레드는 목록에 없다(id 로는 읽힌다) · 쪽 · 다른 블록의 커서는 400 · 빈 코멘트는 400', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace('코멘트 쪽')
    const { pageId, blockId } = await pageWithBlock(owner, '쪽 페이지')
    const made: ApiComment[] = []
    for (const word of ['하나', '둘', '셋', '넷']) made.push(comment(await create(member, { parent: { page_id: pageId }, rich_text: rt(word) })))
    must(await setDiscussionResolved(owner.ctx, made[1].discussion_id, true), '해결')
    assert.deepEqual(texts(await list(member, pageId)), ['하나', '셋', '넷'])
    assert.equal(comment(await get(member, made[1].id)).id, made[1].id, '해결된 것도 id 로는 읽힌다')

    const p1 = await list(member, pageId, '&page_size=2')
    assert.deepEqual(texts(p1), ['하나', '셋'])
    assert.equal(p1.body.has_more, true)
    const p2 = await list(member, pageId, `&page_size=2&start_cursor=${p1.body.next_cursor}`)
    assert.deepEqual(texts(p2), ['넷'])
    assert.equal(p2.body.has_more, false)
    assert.equal(p2.body.next_cursor, null)
    assertError(await list(member, blockId, `&start_cursor=${p1.body.next_cursor}`), 400, 'validation_error', /start_cursor/)
    assertError(await list(member, pageId, '&page_size=0'), 400, 'validation_error')
    assertError(await call(member, 'list', 'GET', '/v1/comments', {}), 400, 'validation_error', /block_id should be defined/)

    assertError(await create(member, { parent: { page_id: pageId }, rich_text: rt('   ') }), 400, 'validation_error', /cannot be blank/)
    // 멘션만 든 코멘트도 빈 코멘트다(멘션의 plain_text 는 비어 있다)
    assertError(await create(member, { parent: { page_id: pageId }, rich_text: [{ mention: { user: { id: owner.userId } } }] }), 400, 'validation_error')
    assertError(await create(member, { parent: { page_id: pageId }, rich_text: rt('x'), display_name: { type: 'integration' } }), 400, 'validation_error')
  })

  test('★ 코멘트 안의 사람 멘션은 멘션 알림 — 멘션된 멤버의 인박스 행 · 고칠 때는 새로 든 사람만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('코멘트 멘션')
    const third = await withToken(await joinAs(ws, await createUser('코멘트 멘션 셋째'), 'member'))
    const page = await createPage(owner.ctx, { title: [textRun('멘션 페이지')] })
    const mentions = async (who: Actor) =>
      (await sql<{ n: string }>(`SELECT count(*) AS n FROM notification WHERE recipient_id = $1 AND page_id = $2 AND kind = 'mention'`, [who.userId, page.id]))[0].n

    const made = comment(
      await create(owner, { parent: { page_id: page.id }, rich_text: [{ text: { content: '확인 부탁 ' } }, { mention: { user: { id: member.userId } } }] }),
    )
    assert.deepEqual(made.rich_text[1].mention, { type: 'user', user: { object: 'user', id: member.userId } })
    assert.equal(await mentions(member), '1')
    assert.equal(await mentions(third), '0')
    assert.equal(await mentions(owner), '0', '나를 나에게 알리지 않는다')
    // 인박스가 그 코멘트를 미리 보인다 — 활동이 코멘트 · 스레드를 가리킨다
    const payload = await sql<{ payload: Record<string, string> }>(
      `SELECT a.payload FROM notification n JOIN activity_event a ON a.id = n.event_ids[1] WHERE n.recipient_id = $1 AND n.kind = 'mention'`,
      [member.userId],
    )
    assert.equal(payload[0].payload.comment_id, made.id)
    assert.equal(payload[0].payload.discussion_id, made.discussion_id)

    // 고치기 — 이미 멘션된 사람에게 다시 보내지 않고 새로 든 사람에게만
    const edited = comment(
      await patch(owner, made.id, {
        rich_text: [{ text: { content: '둘 다 ' } }, { mention: { user: { id: member.userId } } }, { text: { content: ' ' } }, { mention: { user: { id: third.userId } } }],
      }),
    )
    assert.notEqual(edited.last_edited_time, edited.created_time)
    assert.equal(await mentions(member), '1')
    assert.equal(await mentions(third), '1')

    // 스레드를 연 사람을 답글에서 멘션하면 알림은 멘션 하나뿐 — 같은 코멘트로 답글 알림을 또 보내지 않는다
    const replies = async (who: Actor) =>
      (await sql<{ n: string }>(`SELECT count(*) AS n FROM notification WHERE recipient_id = $1 AND page_id = $2 AND kind = 'comment_reply'`, [who.userId, page.id]))[0].n
    comment(await create(member, { discussion_id: made.discussion_id, rich_text: [{ text: { content: '여기요 ' } }, { mention: { user: { id: owner.userId } } }] }))
    assert.equal(await mentions(owner), '1')
    assert.equal(await replies(owner), '0', '멘션된 참여자는 답글 알림을 따로 받지 않는다')
    // 멘션 없는 답글은 그대로 답글 알림
    comment(await create(third, { discussion_id: made.discussion_id, rich_text: rt('저도요') }))
    assert.equal(await replies(owner), '1')
  })

  test('★ 권한 — 볼 수만 있으면 403 · 볼 수 없으면 404 · 남의 코멘트는 고치기 · 지우기 403 · 내 것은 된다 · 잠긴 페이지에도 단다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('코멘트 권한')
    const outsider = await withToken(await joinAs(ws, await createUser('코멘트 권한 남'), 'member'))
    const { pageId } = await pageWithBlock(owner, '개인 페이지', true)
    must(await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, 'view'), '보기 공유')
    const mine = comment(await create(owner, { parent: { page_id: pageId }, rich_text: rt('소유자의 글') }))

    assert.deepEqual(texts(await list(member, pageId)), ['소유자의 글'], '볼 수 있으면 읽는다')
    assertError(await create(member, { parent: { page_id: pageId }, rich_text: rt('못 단다') }), 403, 'restricted_resource')
    assertError(await create(member, { discussion_id: mine.discussion_id, rich_text: rt('못 단다') }), 403, 'restricted_resource')
    assertError(await list(outsider, pageId), 404, 'object_not_found')
    assertError(await get(outsider, mine.id), 404, 'object_not_found')
    assertError(await create(outsider, { parent: { page_id: pageId }, rich_text: rt('x') }), 404, 'object_not_found')
    assertError(await create(outsider, { discussion_id: mine.discussion_id, rich_text: rt('x') }), 404, 'object_not_found')

    // 코멘트할 수 있게 올리면 단다 — 그래도 남의 코멘트는 고치거나 지울 수 없다
    must(await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, 'comment'), '코멘트 공유')
    const theirs = comment(await create(member, { discussion_id: mine.discussion_id, rich_text: rt('멤버의 답') }))
    assertError(await patch(member, mine.id, { rich_text: rt('바꿈') }), 403, 'restricted_resource', /Only the author/)
    assertError(await remove(member, mine.id), 403, 'restricted_resource', /Only the author/)
    assertError(await patch(outsider, mine.id, { rich_text: rt('바꿈') }), 404, 'object_not_found')

    const changed = comment(await patch(member, theirs.id, { rich_text: rt('멤버의 답(고침)') }))
    assert.equal(changed.rich_text[0].plain_text, '멤버의 답(고침)')
    const removed = comment(await remove(member, theirs.id))
    assert.equal(removed.id, theirs.id)
    assert.equal(removed.rich_text[0].plain_text, '멤버의 답(고침)', '지우기 전의 객체')
    assertError(await get(member, theirs.id), 404, 'object_not_found')
    assert.deepEqual(texts(await list(owner, pageId)), ['소유자의 글'])

    // 잠긴 페이지에도 코멘트를 단다(앱과 같다 — 잠금은 본문 · 속성을 막는다)
    must(await setPageLock(owner.ctx, pageId, true), '잠금')
    assert.equal((await create(member, { parent: { page_id: pageId }, rich_text: rt('잠겨도 단다') })).status, 200)
    // 마지막 글을 지우면 스레드째 — 그 스레드에 답할 수 없다
    const lone = comment(await create(owner, { parent: { page_id: pageId }, rich_text: rt('혼자') }))
    comment(await remove(owner, lone.id))
    assertError(await create(owner, { discussion_id: lone.discussion_id, rich_text: rt('x') }), 404, 'object_not_found')
  })

  test('★ 데이터베이스 id 는 400 · 내보내기 정책을 끄면 멤버는 403(읽기 · 쓰기) · 소유자는 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, owner, member } = await workspace('코멘트 정책')
    const page = await createPage(owner.ctx, { title: [textRun('정책 페이지')] })
    const table = must(await createDatabase(owner.ctx, { name: '표' }), '표')
    assertError(await list(member, table.id), 400, 'validation_error', /Databases have no comments/)
    assertError(await create(member, { parent: { block_id: table.id }, rich_text: rt('x') }), 400, 'validation_error')
    assertError(await create(member, { parent: { page_id: table.id }, rich_text: rt('x') }), 404, 'object_not_found')

    await withTransaction((tx) => writeExportPolicyIn(tx, ws, false))
    try {
      assertError(await list(member, page.id), 403, 'restricted_resource', /security policy/)
      assertError(await create(member, { parent: { page_id: page.id }, rich_text: rt('x') }), 403, 'restricted_resource')
      assert.equal((await create(owner, { parent: { page_id: page.id }, rich_text: rt('소유자') })).status, 200)
    } finally {
      await withTransaction((tx) => writeExportPolicyIn(tx, ws, true))
    }
    assert.deepEqual(texts(await list(member, page.id)), ['소유자'])
  })
})
