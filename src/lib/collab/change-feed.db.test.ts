/**
 * 커밋 신호 — CRDT 5c조각 (DB · 마이그레이션 0016)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **권한 판정이 읽는 것을 바꾸는 쓰기는 모두 신호를 보낸다** — 부여 · 회수 · 상속 끊기 · 이동 · 휴지통 · 멤버 · 세션 · SSO. 본문을
 *      쌓는 쓰기는 쌓은 seq 마다 보낸다. 신호는 한 트랜잭션 안에서 쓴 순서대로 온다(휴지통은 권한이 부모 본문보다 먼저)
 *   ② **커밋한 것만 온다** — 되돌린 트랜잭션은 보내지 않는다
 *   ③ **끊기면 다시 붙고, 붙은 뒤에 다시 맞추라고 알린다** — 끊긴 사이의 신호는 오지 않는다(그래서 `onResync` 가 있다)
 *
 * 신호는 DB 전체에서 온다 — 다른 검사 파일이 동시에 쓰는 것까지. 그래서 이 검사가 만든 페이지 · 워크스페이스 · 사용자의 신호만 본다.
 * "오지 않았다"는 기다려서 보지 않는다 — **뒤에 보낸 신호가 도착한 뒤에** 본다(신호는 커밋 순서대로 온다).
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { revokeSession } from '../auth/session.ts'
import { hashSessionToken } from '../auth/session-context.ts'
import { movePage } from '../block/move-page.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { grantAccess, resumeInheriting, stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { openChangeFeed, parseCollabSignal, type ChangeFeed, type CollabSignal } from './change-feed.ts'

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

async function waitFor(label: string, check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  for (;;) {
    if (await check()) return
    if (Date.now() > end) assert.fail(`기다리다 끝났다 — ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

type Listening = { readonly feed: ChangeFeed; readonly signals: CollabSignal[]; resyncs: number }

async function listen(t: TestContext, retryDelayMs?: number): Promise<Listening> {
  const state = { signals: [] as CollabSignal[], resyncs: 0 }
  const feed = await openChangeFeed(
    {
      onSignal: (signal) => void state.signals.push(signal),
      onResync: () => void (state.resyncs += 1),
    },
    { retryDelayMs },
  )
  t.after(() => feed.close())
  return {
    feed,
    signals: state.signals,
    get resyncs() {
      return state.resyncs
    },
  }
}

const docSignals = (pageId: string, seqs: readonly string[]): CollabSignal[] => seqs.map((seq) => ({ kind: 'doc', pageId, seq }))
const access = (workspaceId: string): CollabSignal => ({ kind: 'access', workspaceId })

const seqsOf = async (pageId: string): Promise<string[]> =>
  (await query<{ seq: string }>(`SELECT seq FROM doc_update WHERE page_id = $1 ORDER BY seq`, [pageId])).map((row) => row.seq)

const para = (text: string) => ({ id: randomUUID(), type: 'paragraph' as const, title: [textRun(text)] })

// ── ① · ② ────────────────────────────────────────────────────────────

describe('① 권한 · 본문을 바꾸는 쓰기가 신호를 보낸다 · ② 커밋한 것만', () => {
  test('★ 부여 · 상속 끊기 · 이동 · 휴지통 · 멤버 · SSO 는 워크스페이스, 세션은 사용자, 본문은 seq 마다 — 되돌린 쓰기는 보내지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const heard = await listen(t)

    const workspaceId = await createBareWorkspace('커밋 신호')
    const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
    const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
    const page = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText('페이지') })
    const other = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText('다른 페이지') })
    const mine = (signal: CollabSignal): boolean =>
      signal.kind === 'doc'
        ? signal.pageId === page.id || signal.pageId === other.id
        : signal.kind === 'access'
          ? signal.workspaceId === workspaceId
          : signal.userId === member.userId
    const logBefore = async (pageId: string) => (await seqsOf(pageId)).length
    const newSeqs = async (pageId: string, from: number) => (await seqsOf(pageId)).slice(from)

    // 여기까지(멤버 넣기 · 최상위 페이지의 ACL)의 신호는 보지 않는다 — 이 저장의 신호가 도착한 뒤부터 센다. 처음 여는 본문은
    // 옮기기(seq 1)와 저장(seq 2)을 한 트랜잭션에서 쌓는다.
    assert.equal((await savePageBody(owner.ctx, page.id as never, { blocks: [para('원문')] })).ok, true)
    const markSeq = (await seqsOf(page.id)).at(-1)
    await waitFor('시작 표식이 온다', () => heard.signals.some((s) => s.kind === 'doc' && s.pageId === page.id && s.seq === markSeq))
    const start = heard.signals.findIndex((s) => s.kind === 'doc' && s.pageId === page.id && s.seq === markSeq) + 1

    const expected: CollabSignal[] = []

    // 옮기기가 이동 · 휴지통 가운데 끼지 않게 다른 본문도 미리 연다.
    assert.equal((await savePageBody(owner.ctx, other.id as never, { blocks: [para('다른 원문')] })).ok, true)
    expected.push(...docSignals(other.id, await newSeqs(other.id, 0)))

    // 하위 페이지 생성 — 부모 본문만 바뀐다. 새 페이지 행을 넣는 것은 권한을 줄이지 않는다.
    let from = await logBefore(page.id)
    const child = await createPage(owner.ctx, { parentPageId: page.id as never, title: titleFromPlainText('하위') })
    expected.push(...docSignals(page.id, await newSeqs(page.id, from)))

    // 부여 — 첫 ACL 이라 스코프도 다시 쓰지만 같은 신호는 한 번이다.
    assert.equal((await grantAccess(owner.ctx, child.id, { type: 'user', id: member.userId }, 'view')).ok, true)
    expected.push(access(workspaceId))

    // 레벨만 바꾼다 — ACL 행 하나만 바뀐다. 위의 첫 부여는 스코프 갱신이 같은 신호를 함께 보내 ACL 트리거를 가려내지 못한다
    // (트리거를 끄는 반사실에서 통과해서 알았다).
    assert.equal((await grantAccess(owner.ctx, child.id, { type: 'user', id: member.userId }, 'edit')).ok, true)
    expected.push(access(workspaceId))

    assert.equal((await stopInheriting(owner.ctx, child.id)).ok, true)
    expected.push(access(workspaceId))

    // 상속 되받기 — ACL 행이 남아 있어 메타 행만 바뀐다(스코프도 그대로). 끊기는 ACL 행을 함께 넣어 이 트리거를 가려내지 못한다.
    assert.equal((await resumeInheriting(owner.ctx, child.id)).ok, true)
    expected.push(access(workspaceId))

    // 이동 — 경로가 바뀐다(권한 신호), 두 본문이 바뀐다(옛 부모에서 빼고 새 부모에 넣는다).
    from = await logBefore(page.id)
    const fromOther = await logBefore(other.id)
    await movePage(owner.ctx, child.id as never, other.id as never)
    expected.push(access(workspaceId))
    const movedSeqs = [...docSignals(page.id, await newSeqs(page.id, from)), ...docSignals(other.id, await newSeqs(other.id, fromOther))]
    // 두 본문을 id 순으로 잠그고 그 순서로 쌓는다(move-page.ts).
    movedSeqs.sort((a, b) => ((a as { pageId: string }).pageId < (b as { pageId: string }).pageId ? -1 : 1))
    expected.push(...movedSeqs)

    // 휴지통 — 행(권한 신호)을 쓴 뒤 부모 본문에서 참조를 뺀다. 신호도 그 순서다.
    const otherFrom = await logBefore(other.id)
    await trashPage(owner.ctx, child.id as never)
    expected.push(access(workspaceId), ...docSignals(other.id, await newSeqs(other.id, otherFrom)))

    // 되돌린 트랜잭션 — 멤버 역할을 바꿨다가 되돌린다.
    await assert.rejects(
      withTransaction(async (tx) => {
        await tx.query(`UPDATE workspace_member SET role = 'guest' WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, member.userId])
        throw new Error('되돌린다')
      }),
      /되돌린다/,
    )

    await query(`UPDATE workspace_member SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, member.userId])
    expected.push(access(workspaceId))

    await revokeSession(member.token)
    expected.push({ kind: 'session', userId: member.userId })

    await query(`DELETE FROM user_session WHERE token_hash = $1`, [hashSessionToken(member.token)])
    expected.push({ kind: 'session', userId: member.userId })

    await query(`INSERT INTO sso_config (workspace_id, enforced) VALUES ($1, true)`, [workspaceId])
    expected.push(access(workspaceId))

    // 마지막 신호가 도착한 뒤에 본다 — 되돌린 것이 왔다면 그보다 앞에 있다.
    from = await logBefore(page.id)
    assert.equal((await savePageBody(owner.ctx, page.id as never, { blocks: [para('끝')] })).ok, true)
    const last = docSignals(page.id, await newSeqs(page.id, from))
    expected.push(...last)
    const lastSeq = (last.at(-1) as { seq: string }).seq
    await waitFor('마지막 저장의 신호가 온다', () =>
      heard.signals.some((s) => s.kind === 'doc' && s.pageId === page.id && s.seq === lastSeq),
    )

    assert.deepEqual(heard.signals.slice(start).filter(mine), expected)
  })
})

// ── ③ 끊기면 ─────────────────────────────────────────────────────────

describe('③ 듣는 연결이 끊기면', () => {
  test('★ 다시 붙고 onResync 를 부른다 — 끊긴 사이에 커밋한 것의 신호는 오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const heard = await listen(t, 1500)
    assert.equal(heard.resyncs, 1, '처음 붙을 때도 부른다')

    const workspaceId = await createBareWorkspace('끊기는 신호')
    const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
    const page = await createPage(owner.ctx, { parentPageId: null as never, title: titleFromPlainText('페이지') })

    const pid = heard.feed.backendPid()
    assert.ok(pid !== null)
    await query(`SELECT pg_terminate_backend($1)`, [pid])
    await waitFor('끊긴 것을 안다', () => heard.feed.backendPid() === null)

    assert.equal((await savePageBody(owner.ctx, page.id as never, { blocks: [para('끊긴 사이')] })).ok, true)
    const downSeqs = await seqsOf(page.id)
    assert.equal(heard.feed.backendPid(), null, '전제: 끊긴 사이에 커밋했다')

    await waitFor('다시 붙어 다시 맞추라고 알린다', () => heard.resyncs === 2)
    assert.notEqual(heard.feed.backendPid(), null)

    assert.equal((await savePageBody(owner.ctx, page.id as never, { blocks: [para('붙은 뒤')] })).ok, true)
    const afterSeq = (await seqsOf(page.id)).at(-1)
    await waitFor('다시 붙은 뒤의 신호는 온다', () => heard.signals.some((s) => s.kind === 'doc' && s.pageId === page.id && s.seq === afterSeq))
    assert.deepEqual(
      heard.signals.filter((s) => s.kind === 'doc' && s.pageId === page.id && downSeqs.includes(s.seq)),
      [],
      '끊긴 사이의 신호가 왔다',
    )
  })
})

describe('신호 읽기', () => {
  test('모르는 채널 · 모양이 틀린 페이로드는 신호가 아니다', () => {
    const page = randomUUID()
    assert.deepEqual(parseCollabSignal('collab_doc', `${page}:12`), { kind: 'doc', pageId: page, seq: '12' })
    assert.deepEqual(parseCollabSignal('collab_access', `ws:${page}`), { kind: 'access', workspaceId: page })
    assert.deepEqual(parseCollabSignal('collab_access', `user:${page}`), { kind: 'session', userId: page })
    for (const [channel, payload] of [
      ['collab_doc', `${page}:`],
      ['collab_doc', `${page}:1a`],
      ['collab_doc', `nope:1`],
      ['collab_access', `ws:nope`],
      ['collab_access', `team:${page}`],
      ['other', `ws:${page}`],
    ] as const) {
      assert.equal(parseCollabSignal(channel, payload), null, `${channel} ${payload}`)
    }
    assert.equal(parseCollabSignal('collab_doc', undefined), null)
  })
})
