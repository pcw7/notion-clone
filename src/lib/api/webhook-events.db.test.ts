/**
 * 공개 API 웹훅 이벤트 내보내기 — 명령의 목마다 · 묶기 · 되돌림 · 공짜 · 보낼 때의 보기 판정 (API-9 · F-09-09 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑬ · 마이그레이션 0152
 *
 *   ① ★ 페이지 — 만들기 · 옮기기 · 잠금 · 휴지통 · 되살리기 · 제목(속성) · 하위 페이지를 만들면 부모의 본문이 바뀐다
 *   ② ★ 본문 — 서버의 본문 세션과 협업의 update 가 같은 줄에 묶인다(목록 합침 · 저자 합집합) · 15초 전엔 안 나간다 · 봉인 뒤엔 새 줄
 *   ③ ★ 데이터베이스 · 데이터 소스 · 행 · 구조 — 만들기 · 행 · 셀 · 속성 더하기/이름/지우기(묶음) · 소스 휴지통/되살리기 · 옮기기
 *   ④ ★ 댓글 — 달기 · 답글 · 고치기 · 지우기(스레드째 사라져도 간다)
 *   ⑤ ★ 되돌린 명령 · savepoint 는 아무것도 남기지 않는다 · 고르지 않은 종류 · 다른 워크스페이스의 구독은 받지 않는다
 *   ⑥ ★ 공짜 — 구독이 없는 워크스페이스의 본문 쓰기는 웹훅 조회 하나(쿼리를 센다)
 *   ⑦ ★ 보낼 때 — 볼 수 없게 된 대상(댓글 포함)은 건너뛴다 · 휴지통의 page.deleted 는 그 ACL 로 간다 · 영구 삭제는 건너뛴다
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import pg from 'pg'
import type * as Y from 'yjs'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { appendDocUpdate } from '../block/body-write.ts'
import { movePage } from '../block/move-page.ts'
import { createPage, createPageIn, renamePage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { purgePage, restorePage, trashPage } from '../block/trash.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { createDiscussion, deleteComment, editComment, replyToDiscussion } from '../comment/discussion.ts'
import { textRun } from '../contracts/rich-text.ts'
import { addDataSource, restoreDataSource, trashDataSource } from '../database/data-source.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty, deleteProperty, updateProperty } from '../database/property.ts'
import { createRow, trashRow, updateCells } from '../database/row.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import type { EditorBlock } from '../editor/document.ts'
import type { OutboundResult } from '../net/outbound.ts'
import { setPageLock } from '../permissions/lock.ts'
import { createTeamspace } from '../workspace/teamspace.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { createApiToken } from './api-token.ts'
import { runApiWebhookDelivery } from './webhook-deliver.ts'
import { verifyWebhookSignature } from './webhook-format.ts'
import { createApiWebhook, verifyApiWebhook, type ApiWebhookSender } from './webhooks.ts'

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

const HOOK = 'https://hooks.example.com/notion/events'
const ALL = [
  'page.created', 'page.properties_updated', 'page.content_updated', 'page.moved', 'page.deleted', 'page.undeleted', 'page.locked', 'page.unlocked',
  'database.created', 'database.moved', 'database.deleted', 'database.undeleted',
  'data_source.created', 'data_source.content_updated', 'data_source.moved', 'data_source.deleted', 'data_source.undeleted', 'data_source.schema_updated',
  'comment.created', 'comment.updated', 'comment.deleted',
]

type Got = { json: string; headers: Readonly<Record<string, string>> }

function receiver(answer: () => OutboundResult = () => ({ ok: true, status: 200 })): { send: ApiWebhookSender; got: Got[] } {
  const got: Got[] = []
  return { got, send: async (_url, json, headers) => (got.push({ json, headers }), answer()) }
}

async function team(name: string) {
  const ws = await createBareWorkspace(name)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  return { ws, boss, mate }
}

/** 토큰 하나 · 확인까지 마친 구독 하나. */
async function subscribe(who: Actor, eventTypes: string[] = ALL): Promise<{ id: string; secret: string }> {
  const token = await createApiToken(who.ctx, { name: `이벤트 ${randomUUID().slice(0, 6)}` })
  if (!token.ok) throw new Error(`토큰: ${token.reason}`)
  const r = receiver()
  const made = await createApiWebhook(who.ctx, token.value.summary.id, { url: HOOK, eventTypes }, { send: r.send })
  if (!made.ok) throw new Error(`구독: ${made.reason}`)
  const secret = (JSON.parse(r.got[0]!.json) as { verification_token: string }).verification_token
  const verified = await verifyApiWebhook(who.ctx, token.value.summary.id, made.value.id, secret)
  if (!verified.ok) throw new Error(`확인: ${verified.reason}`)
  return { id: made.value.id, secret }
}

type Row = {
  type: string
  entity_id: string
  entity_type: string
  authors: { id: string; type: string }[]
  data: Record<string, unknown>
  status: string
  skip_reason: string | null
  window_started_at: Date | null
  next_attempt_at: Date | null
  occurred_at: Date
}
const outbox = (subscriptionId: string) =>
  query<Row>(
    `SELECT type, entity_id, entity_type, authors, data, status, skip_reason, window_started_at, next_attempt_at, occurred_at
       FROM api_webhook_event WHERE subscription_id = $1 ORDER BY seq`,
    [subscriptionId],
  )
const ofType = (rows: readonly Row[], type: string, entityId?: string) => rows.filter((r) => r.type === type && (entityId === undefined || r.entity_id === entityId))
const person = (a: Actor) => ({ id: a.userId, type: 'person' })
const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const later = (ms: number) => new Date(Date.now() + ms)

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

/** 협업 서버가 하는 일 — 참여자의 update 를 쌓는다(투영은 미룬다). */
async function typeInto(actor: Actor, pageId: string, blockId: string, text: string, clientId: number) {
  const base = await ydocOf(actor, pageId)
  const client = peer(base, clientId)
  edit(client, (tr: Transaction, doc: PmNode) => {
    tr.insertText(text, findBlock(doc, blockId).pos + 2)
  })
  const appended = await appendDocUpdate(actor.ctx, pageId, changesSince(client, base), { origin: 'editor', projection: 'deferred' })
  assert.ok(appended.ok && appended.appended, JSON.stringify(appended))
}

describe('① 페이지', () => {
  test('★ 만들기 · 하위 페이지(부모 본문) · 옮기기 · 잠금 · 휴지통 · 되살리기 · 제목 — 대상 · 부모 · 저자', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, mate } = await team('웹훅 이벤트 페이지')
    const hook = await subscribe(mate)
    const top = await createPage(mate.ctx, { title: titleFromPlainText('위') })
    const child = await createPage(mate.ctx, { parentPageId: top.id, title: titleFromPlainText('아래') })
    assert.ok((await setPageLock(mate.ctx, child.id, true)).ok)
    assert.ok((await setPageLock(mate.ctx, child.id, false)).ok)
    await movePage(mate.ctx, child.id, null)
    await renamePage(mate.ctx, child.id, titleFromPlainText('바꾼 이름'))
    await trashPage(mate.ctx, child.id)
    await restorePage(mate.ctx, child.id)

    const rows = await outbox(hook.id)
    const plain = rows.filter((r) => r.entity_id === child.id).map((r) => r.type)
    assert.deepEqual(plain, ['page.created', 'page.locked', 'page.unlocked', 'page.moved', 'page.properties_updated', 'page.deleted', 'page.undeleted'])
    const [created] = ofType(rows, 'page.created', top.id)
    assert.deepEqual([created?.entity_type, created?.data, created?.authors], ['page', { parent: { id: ws, type: 'space' } }, [person(mate)]])
    assert.deepEqual(ofType(rows, 'page.created', child.id)[0]?.data, { parent: { id: top.id, type: 'page' } }, '★ 하위 페이지의 부모')
    assert.deepEqual(ofType(rows, 'page.moved', child.id)[0]?.data, { parent: { id: ws, type: 'space' } }, '★ 옮긴 뒤의 부모')
    assert.deepEqual(ofType(rows, 'page.properties_updated', child.id)[0]?.data.updated_properties, ['title'])
    // 부모의 본문 — 참조를 넣고(만들기) 뺐다(옮기기) → 한 줄에 묶인다(같은 블록은 하나)
    const parentBody = ofType(rows, 'page.content_updated', top.id)
    assert.equal(parentBody.length, 1, '★ 부모의 본문 변경은 한 줄')
    assert.deepEqual(parentBody[0]!.data.parent, { id: ws, type: 'space' })
    const touched = (parentBody[0]!.data.updated_blocks as { id: string; type: string }[])
    assert.ok(touched.every((x) => x.type === 'block') && touched.filter((x) => x.id === child.id).length === 1, `★ 참조 블록이 한 번 — ${JSON.stringify(touched)}`)
    assert.ok(parentBody[0]!.window_started_at !== null, '묶는 중')
  })
})

describe('② 본문 — 묶기', () => {
  test('★ 서버의 본문 세션 + 협업 update 가 한 줄에 — 목록 합침 · 저자 합집합 · 15초 전엔 안 나간다 · 봉인 뒤의 변경은 새 줄', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 이벤트 본문')
    const hook = await subscribe(mate, ['page.content_updated'])
    const page = await createPage(mate.ctx, { title: titleFromPlainText('본문') })
    const a = randomUUID()
    const b = randomUUID()
    assert.ok((await savePageBody(mate.ctx, page.id, { blocks: [para('가', a), para('나', b)] })).ok)
    let rows = ofType(await outbox(hook.id), 'page.content_updated', page.id)
    assert.equal(rows.length, 1)
    const first = rows[0]!
    assert.ok(first.window_started_at !== null && first.next_attempt_at!.getTime() - first.window_started_at.getTime() === 15_000, '창 + 15초')
    assert.deepEqual(new Set((first.data.updated_blocks as { id: string }[]).map((x) => x.id)), new Set([a, b]))

    await typeInto(mate, page.id, b, '글', 7001)
    await typeInto(boss, page.id, a, '자', 7002)
    rows = ofType(await outbox(hook.id), 'page.content_updated', page.id)
    assert.equal(rows.length, 1, '★ 묶인다 — 줄은 하나')
    assert.deepEqual(new Set((rows[0]!.data.updated_blocks as { id: string }[]).map((x) => x.id)), new Set([a, b]), '★ 같은 블록은 하나')
    assert.deepEqual(rows[0]!.authors, [person(mate), person(boss)], '★ 저자는 합집합')
    assert.ok(rows[0]!.next_attempt_at! <= new Date(rows[0]!.window_started_at!.getTime() + 120_000))

    const r = receiver()
    await runApiWebhookDelivery(later(1_000), { workspaces: [ws], send: r.send })
    assert.equal(r.got.length, 0, '★ 조용한 창(15초) 전에는 나가지 않는다')
    await runApiWebhookDelivery(later(3 * 60_000), { workspaces: [ws], send: r.send })
    assert.equal(r.got.length, 1, '★ 한 번에 나간다')
    const envelope = JSON.parse(r.got[0]!.json) as { type: string; entity: { id: string; type: string }; data: { updated_blocks: unknown[] }; authors: unknown[] }
    assert.deepEqual([envelope.type, envelope.entity, envelope.data.updated_blocks.length, envelope.authors.length], ['page.content_updated', { id: page.id, type: 'page' }, 2, 2])
    assert.ok(verifyWebhookSignature(r.got[0]!.json, r.got[0]!.headers['X-Notion-Signature'], hook.secret))
    rows = ofType(await outbox(hook.id), 'page.content_updated', page.id)
    assert.deepEqual(rows.map((x) => [x.status, x.window_started_at]), [['delivered', null]], '보내기 전에 봉인했다')

    await typeInto(mate, page.id, a, '!', 7003)
    rows = ofType(await outbox(hook.id), 'page.content_updated', page.id)
    assert.deepEqual(rows.map((x) => x.status), ['delivered', 'pending'], '★ 봉인 뒤의 변경은 새 줄 — 보낸 것에 합쳐 사라지지 않는다')
    assert.deepEqual(rows[1]!.data.updated_blocks, [{ id: a, type: 'block' }])
  })
})

describe('③ 데이터베이스 · 데이터 소스 · 행 · 구조', () => {
  test('★ 만들기 · 행 · 셀 · 속성(묶음) · 소스 휴지통/되살리기 · 데이터베이스 휴지통/되살리기/옮기기 · 행 휴지통', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 이벤트 데이터베이스')
    const hook = await subscribe(mate)
    const made = await createDatabase(mate.ctx, { name: '작업' })
    assert.ok(made.ok)
    const db = made.value.id
    const ds = made.value.dataSourceId
    const title = (await queryOne<{ id: string }>(`SELECT id FROM property WHERE data_source_id = $1 AND type = 'title'`, [ds])).id
    const row = await createRow(mate.ctx, ds, {})
    assert.ok(row.ok)
    const rowId = row.value.id
    assert.ok((await updateCells(mate.ctx, rowId, { cells: [{ propertyId: title, value: { type: 'title', title: [textRun('할 일')] } }] })).ok)
    const score = await addProperty(mate.ctx, ds, { name: '점수', type: 'number' })
    assert.ok(score.ok)
    const scoreId = (await queryOne<{ id: string }>(`SELECT id FROM property WHERE data_source_id = $1 AND name = '점수'`, [ds])).id
    assert.ok((await updateProperty(mate.ctx, ds, scoreId, { name: '점수2' })).ok)
    const memo = await addProperty(mate.ctx, ds, { name: '메모', type: 'rich_text' })
    assert.ok(memo.ok)
    const memoId = (await queryOne<{ id: string }>(`SELECT id FROM property WHERE data_source_id = $1 AND name = '메모'`, [ds])).id
    assert.ok((await deleteProperty(mate.ctx, ds, memoId)).ok)
    const second = await addDataSource(mate.ctx, db, { name: '둘째' })
    assert.ok(second.ok)
    const ds2 = second.value.dataSource.id
    assert.ok((await trashDataSource(mate.ctx, ds2)).ok)
    assert.ok((await restoreDataSource(mate.ctx, ds2)).ok)
    assert.ok((await trashRow(mate.ctx, rowId)).ok)
    // 풀페이지 데이터베이스는 최상위끼리만 옮긴다 — teamspace 로(대표가 만든 · 대표가 옮기고 버리고 되살린다)
    const teamspace = await createTeamspace(boss.ctx, { name: '팀' })
    assert.ok(teamspace.ok)
    await movePage(boss.ctx, db as never, { teamspaceId: teamspace.value.id })
    await trashPage(boss.ctx, db as never)
    await restorePage(boss.ctx, db as never)

    const rows = await outbox(hook.id)
    assert.deepEqual(rows.filter((r) => r.entity_id === db).map((r) => r.type), ['database.created', 'database.moved', 'database.deleted', 'database.undeleted'])
    assert.deepEqual(ofType(rows, 'database.created', db)[0]?.data, { parent: { id: ws, type: 'space' } })
    assert.deepEqual([ofType(rows, 'database.moved', db)[0]?.data, ofType(rows, 'database.moved', db)[0]?.authors], [{ parent: { id: ws, type: 'space' } }, [person(boss)]],
      '★ teamspace 최상위도 space · 옮긴 사람')
    assert.deepEqual(rows.filter((r) => r.entity_id === ds).map((r) => r.type), ['data_source.created', 'data_source.content_updated', 'data_source.schema_updated'])
    assert.deepEqual(ofType(rows, 'data_source.created', ds)[0]?.data, { parent: { id: db, type: 'database' } })
    assert.deepEqual(rows.filter((r) => r.entity_id === ds2).map((r) => r.type), ['data_source.created', 'data_source.deleted', 'data_source.undeleted'])
    // 행 — 페이지이기도 하다
    assert.deepEqual(rows.filter((r) => r.entity_id === rowId).map((r) => r.type), ['page.created', 'page.properties_updated', 'page.deleted'])
    assert.deepEqual(ofType(rows, 'page.created', rowId)[0]?.data, { parent: { id: ds, type: 'data_source' } }, '★ 행의 부모는 데이터 소스')
    assert.deepEqual(ofType(rows, 'page.properties_updated', rowId)[0]?.data.updated_properties, ['title'], '제목 속성은 title')
    // 행이 생기고 · 바뀌고 · 휴지통에 갔다 → 소스의 content_updated 한 줄
    const content = ofType(rows, 'data_source.content_updated', ds)
    assert.equal(content.length, 1, '★ 행의 변경은 묶인다')
    assert.deepEqual(content[0]!.data, { parent: { id: db, type: 'database' }, updated_blocks: [{ id: rowId, type: 'block' }] })
    const schema = ofType(rows, 'data_source.schema_updated', ds)
    assert.equal(schema.length, 1, '★ 구조 변경도 묶인다')
    assert.deepEqual(schema[0]!.data.updated_properties, [
      { id: scoreId, name: '점수2', action: 'created' },
      { id: memoId, name: '메모', action: 'deleted' },
    ], '★ 만들고 이름을 바꾸면 created(나중 이름) · 만들고 지우면 deleted')
  })
})

describe('④ 댓글', () => {
  test('★ 달기 · 블록에 달기 · 답글 · 고치기 · 지우기(마지막 글이면 스레드째 — 그래도 간다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 이벤트 댓글')
    const hook = await subscribe(mate, ['comment.created', 'comment.updated', 'comment.deleted'])
    const page = await createPage(mate.ctx, { title: titleFromPlainText('댓글') })
    const blockId = randomUUID()
    assert.ok((await savePageBody(mate.ctx, page.id, { blocks: [para('본문', blockId)] })).ok)
    const thread = await createDiscussion(mate.ctx, { pageId: page.id, richText: [textRun('첫 댓글')] })
    assert.ok(thread.ok)
    const onBlock = await createDiscussion(boss.ctx, { pageId: page.id, blockId, richText: [textRun('블록에')] })
    assert.ok(onBlock.ok)
    const reply = await replyToDiscussion(boss.ctx, thread.discussionId, [textRun('답글')])
    assert.ok(reply.ok)
    assert.ok((await editComment(mate.ctx, thread.commentId, [textRun('고친 댓글')])).ok)
    assert.ok((await deleteComment(boss.ctx, onBlock.commentId)).ok)

    const rows = await outbox(hook.id)
    assert.deepEqual(rows.map((r) => [r.type, r.entity_id === thread.commentId ? 'thread' : r.entity_id === onBlock.commentId ? 'block' : 'reply', r.window_started_at]), [
      ['comment.created', 'thread', null],
      ['comment.created', 'block', null],
      ['comment.created', 'reply', null],
      ['comment.updated', 'thread', null],
      ['comment.deleted', 'block', null],
    ], '★ 댓글은 묶지 않는다')
    assert.deepEqual(rows[0]!.data, { page_id: page.id, parent: { id: page.id, type: 'page' } })
    assert.deepEqual(rows[1]!.data, { page_id: page.id, parent: { id: blockId, type: 'block' } }, '★ 블록의 댓글은 부모가 블록')
    assert.deepEqual([rows[0]!.entity_type, rows[1]!.authors], ['comment', [person(boss)]])
    assert.equal((await query(`SELECT 1 FROM discussion WHERE id = $1`, [onBlock.discussionId])).length, 0, '마지막 글이라 스레드째 사라졌다')

    const r = receiver()
    const pass = await runApiWebhookDelivery(later(60_000), { workspaces: [ws], send: r.send })
    assert.deepEqual([pass.delivered, pass.skipped], [5, 0], '★ 사라진 스레드의 comment.deleted 도 간다(data.page_id 로 본다)')
  })
})

describe('⑤ 되돌림 · 고르기 · 워크스페이스', () => {
  test('★ 되돌린 명령 · savepoint 는 아무것도 남기지 않는다 · 고르지 않은 종류는 쌓지 않는다 · 다른 워크스페이스의 구독은 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('웹훅 이벤트 되돌림')
    const other = await team('웹훅 이벤트 남')
    const hook = await subscribe(mate, ['page.created'])
    const onlyComments = await subscribe(mate, ['comment.created'])
    const stranger = await subscribe(other.mate, ALL)

    await assert.rejects(
      withTransaction(async (tx) => {
        await createPageIn(tx, mate.ctx, { title: titleFromPlainText('되돌린다') })
        throw new Error('되돌린다')
      }),
      /되돌린다/,
    )
    const kept = await withTransaction(async (tx) => {
      await tx.savepoint('webhook_probe', async () => {
        await createPageIn(tx, mate.ctx, { title: titleFromPlainText('savepoint 안') })
        throw new Error('안쪽만 되돌린다')
      }).catch(() => undefined)
      return createPageIn(tx, mate.ctx, { title: titleFromPlainText('남는다') })
    })

    const rows = await outbox(hook.id)
    assert.deepEqual(rows.map((r) => [r.type, r.entity_id]), [['page.created', kept.id]], '★ 커밋된 것만 · savepoint 의 것은 버렸다')
    assert.equal((await outbox(onlyComments.id)).length, 0, '★ 고르지 않은 종류')
    assert.equal((await outbox(stranger.id)).length, 0, '★ 다른 워크스페이스')
  })
})

/** 이 일이 보낸 SQL — pg 의 클라이언트 질의를 센다. */
async function sqlOf<T>(fn: () => Promise<T>): Promise<{ result: T; sqls: string[] }> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }
  const original = proto.query
  const sqls: string[] = []
  proto.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0]
    sqls.push(typeof first === 'string' ? first : String((first as { text?: unknown } | null)?.text ?? ''))
    return original.apply(this, args)
  }
  try {
    return { result: await fn(), sqls }
  } finally {
    proto.query = original
  }
}
const webhookSql = (sqls: readonly string[]) => sqls.filter((s) => /api_webhook_(subscription|event)/.test(s))

describe('⑥ 공짜', () => {
  test('★ 구독이 없으면 본문 쓰기(협업 update) · 하위 페이지 만들기는 트랜잭션마다 웹훅 조회 하나 — 쓰기 없음 · 고르지 않은 구독도 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { mate } = await team('웹훅 이벤트 공짜')
    const page = await createPage(mate.ctx, { title: titleFromPlainText('공짜') })
    const blockId = randomUUID()
    assert.ok((await savePageBody(mate.ctx, page.id, { blocks: [para('가', blockId)] })).ok)

    const typed = await sqlOf(() => typeInto(mate, page.id, blockId, '나', 8001))
    const appendSqls = typed.sqls.filter((s) => s !== '' )
    const hooks = webhookSql(typed.sqls)
    assert.equal(hooks.length, 1, `★ 협업 update 한 번 = 웹훅 조회 하나 · 전체 ${appendSqls.length}개 중`)
    assert.match(hooks[0]!, /FROM api_webhook_subscription/)
    const child = await sqlOf(() => createPage(mate.ctx, { parentPageId: page.id, title: titleFromPlainText('아래') }))
    assert.equal(webhookSql(child.sqls).length, 1, '★ 한 트랜잭션에 두 이벤트(page.created · 부모 content_updated) — 조회는 하나')

    await subscribe(mate, ['comment.created'])
    const unselected = await sqlOf(() => typeInto(mate, page.id, blockId, '다', 8002))
    assert.equal(webhookSql(unselected.sqls).length, 1, '★ 고르지 않은 종류만 있는 구독 — 여전히 조회 하나 · 쓰기 없음')
    await subscribe(mate, ['page.content_updated'])
    const selected = await sqlOf(() => typeInto(mate, page.id, blockId, '라', 8003))
    const selectedHooks = webhookSql(selected.sqls)
    assert.ok(selectedHooks.some((s) => /INSERT INTO api_webhook_event/.test(s)), '고른 구독이 있으면 쓴다')
    console.log(`[API-9 측정] 협업 update 한 번: 전체 ${typed.sqls.length}개 질의 · 웹훅 ${hooks.length}개(구독 없음) · 고른 구독이 있으면 웹훅 ${selectedHooks.length}개`)
  })
})

describe('⑦ 보낼 때의 보기 판정', () => {
  test('★ 볼 수 없게 된 페이지 · 그 댓글은 건너뛴다 · 휴지통의 page.deleted(와 그 전의 댓글)는 ACL 로 간다 · 영구 삭제한 것은 건너뛴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team('웹훅 이벤트 보기')
    const hook = await subscribe(mate, ['page.created', 'page.deleted', 'comment.created'])
    // 대표의 공용 페이지 — 동료도 본다 → 대표가 자기만의 자리로 옮긴다
    const shared = await createPage(boss.ctx, { title: titleFromPlainText('공용') })
    const said = await createDiscussion(boss.ctx, { pageId: shared.id, richText: [textRun('대표의 댓글')] })
    assert.ok(said.ok)
    await movePage(boss.ctx, shared.id, { privateTop: true })
    // 동료의 페이지 — 댓글을 달고 휴지통으로
    const mine = await createPage(mate.ctx, { title: titleFromPlainText('내 것') })
    const mineSaid = await createDiscussion(mate.ctx, { pageId: mine.id, richText: [textRun('내 댓글')] })
    assert.ok(mineSaid.ok)
    await trashPage(mate.ctx, mine.id)
    // 휴지통에서 영구 삭제
    const gone = await createPage(mate.ctx, { title: titleFromPlainText('사라짐') })
    await trashPage(mate.ctx, gone.id)
    await purgePage(mate.ctx, gone.id)

    const r = receiver()
    await runApiWebhookDelivery(later(60_000), { workspaces: [ws], send: r.send })
    const rows = await outbox(hook.id)
    const outcome = (entity: string, type: string) => rows.find((x) => x.entity_id === entity && x.type === type)
    assert.deepEqual([outcome(shared.id, 'page.created')?.skip_reason, outcome(said.commentId, 'comment.created')?.skip_reason], ['entity_not_visible', 'entity_not_visible'],
      '★ 볼 수 없게 된 페이지 · 그 페이지의 댓글')
    assert.deepEqual(
      [outcome(mine.id, 'page.created')?.status, outcome(mineSaid.commentId, 'comment.created')?.status, outcome(mine.id, 'page.deleted')?.status],
      ['delivered', 'delivered', 'delivered'],
      '★ 휴지통의 페이지는 그 ACL 로 본다 — page.deleted · 그 전의 댓글이 간다',
    )
    assert.deepEqual([outcome(gone.id, 'page.created')?.skip_reason, outcome(gone.id, 'page.deleted')?.skip_reason], ['entity_not_visible', 'entity_not_visible'], '★ 영구 삭제한 것')
    const deleted = r.got.map((g) => JSON.parse(g.json) as { type: string; entity: { id: string }; authors: unknown[] }).find((e) => e.type === 'page.deleted')
    assert.deepEqual(deleted?.authors, [person(mate)])
  })
})
