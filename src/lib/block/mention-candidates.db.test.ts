/**
 * `@` 자동완성 후보 · 멘션 이름 맵 — 권한으로 거르는가 (F-07-08 · 코멘트 5b조각 · DB)
 *
 *   ① **후보에서 볼 수 없는 페이지가 빠진다** — 07 F-07-08 이 "대표적 권한 누출 지점"이라 한 곳
 *   ② 이름 맵도 같다 — 볼 수 없는 페이지는 제목이 아니라 null 이고, 없는 페이지와 가르지 않는다
 *   ③ 나간 멤버의 이름은 남는다(칩 유지) · 멤버였던 적 없는 uuid 는 null
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { pageMentionRun, textRun, userMentionRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { loadMentionLabels, mentionIdsOf, searchMentionCandidates } from './mention-candidates.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { trashPage } from './trash.ts'

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

async function workspace(): Promise<{ owner: Actor; member: Actor }> {
  const workspaceId = await createBareWorkspace('멘션 후보')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('김멤버'), 'member')
  return { owner, member }
}

const mk = async (actor: Actor, title: string): Promise<string> =>
  (await createPage(actor.ctx, { parentPageId: null, title: titleFromPlainText(title) })).id

async function hide(owner: Actor, pageId: string): Promise<void> {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

const labelsOf = (list: readonly { label: string }[]) => list.map((c) => c.label).sort()

describe('후보', () => {
  test('★ 볼 수 없는 페이지는 후보에 없다 — 권한이 쿼리 안에 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    await mk(owner, '온보딩 가이드')
    const secret = await mk(owner, '온보딩 비밀 계획')
    await hide(owner, secret)

    const forOwner = await searchMentionCandidates(owner.ctx, '온보')
    assert.deepEqual(labelsOf(forOwner.filter((c) => c.kind === 'page')), ['온보딩 가이드', '온보딩 비밀 계획'])
    const forMember = await searchMentionCandidates(member.ctx, '온보')
    assert.deepEqual(labelsOf(forMember.filter((c) => c.kind === 'page')), ['온보딩 가이드'])
  })

  test('사람은 이름 · 이메일 부분 일치로, 페이지보다 앞에 온다. 빈 쿼리는 사람 전부 + 최근 페이지', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    await mk(owner, '김씨네 회의록')

    const byName = await searchMentionCandidates(owner.ctx, '김')
    assert.deepEqual(
      byName.map((c) => [c.kind, c.label]),
      [
        ['user', '김멤버'],
        ['page', '김씨네 회의록'],
      ],
    )
    const byEmail = await searchMentionCandidates(owner.ctx, member.email.split('@')[0])
    assert.ok(byEmail.some((c) => c.kind === 'user' && c.id === member.userId))

    const empty = await searchMentionCandidates(owner.ctx, '')
    assert.ok(empty.some((c) => c.kind === 'user' && c.id === member.userId))
    assert.ok(empty.some((c) => c.kind === 'page' && c.label === '김씨네 회의록'))
  })

  test('휴지통에 간 페이지는 빠지고, 패턴 문자는 글자로 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const gone = await mk(owner, '지워질 문서')
    await mk(owner, '50% 할인')
    await trashPage(owner.ctx, gone as never)

    assert.deepEqual(labelsOf((await searchMentionCandidates(owner.ctx, '지워질')).filter((c) => c.kind === 'page')), [])
    assert.deepEqual(labelsOf((await searchMentionCandidates(owner.ctx, '50%')).filter((c) => c.kind === 'page')), ['50% 할인'])
    assert.deepEqual(labelsOf((await searchMentionCandidates(owner.ctx, '5_%')).filter((c) => c.kind === 'page')), [], '`_` 는 와일드카드가 아니다')
  })
})

describe('이름 맵', () => {
  test('★ 볼 수 없는 페이지 · 없는 페이지 · 휴지통은 전부 null 로 같다 — 존재를 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const open = await mk(owner, '공개 문서')
    const secret = await mk(owner, '비밀 문서')
    const trashed = await mk(owner, '버린 문서')
    await hide(owner, secret)
    await trashPage(owner.ctx, trashed as never)
    const missing = randomUUID()

    const forMember = await loadMentionLabels(member.ctx, { userIds: [], pageIds: [open, secret, trashed, missing] })
    assert.deepEqual(forMember.pages, { [open]: '공개 문서', [secret]: null, [trashed]: null, [missing]: null })
    const forOwner = await loadMentionLabels(owner.ctx, { userIds: [], pageIds: [secret] })
    assert.deepEqual(forOwner.pages, { [secret]: '비밀 문서' })
  })

  test('나간 멤버의 이름은 남고, 멤버였던 적 없는 uuid 는 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    await query(`UPDATE workspace_member SET status = 'removed' WHERE user_id = $1 AND workspace_id = $2`, [
      member.userId,
      owner.ctx.workspaceId,
    ])
    const stranger = randomUUID()
    const labels = await loadMentionLabels(owner.ctx, { userIds: [member.userId, stranger], pageIds: [] })
    assert.deepEqual(labels.users, { [member.userId]: '김멤버', [stranger]: null })
  })

  test('본문에서 멘션 id 를 모은다 — 중첩까지, 중복 없이', () => {
    const u = randomUUID()
    const p = randomUUID()
    const ids = mentionIdsOf({
      blocks: [
        { id: randomUUID(), type: 'paragraph', title: [textRun('a '), userMentionRun(u), pageMentionRun(p)] },
        {
          id: randomUUID(),
          type: 'toggle',
          title: [userMentionRun(u)],
          children: [{ id: randomUUID(), type: 'paragraph', title: [pageMentionRun(p)] }],
        },
      ],
    })
    assert.deepEqual(ids, { userIds: [u], pageIds: [p] })
  })
})
