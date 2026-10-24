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

import { customEmojiMentionRun, pageMentionRun, textRun, userMentionRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { loadMentionLabels, mentionIdsOf, searchMentionCandidates } from './mention-candidates.ts'
import { createPage, titleFromPlainText } from './page.ts'
import { trashPage } from './trash.ts'
import { recordVisit } from '../nav/recent.ts'
import { MENTION_PEOPLE_EMPTY } from './mention-rank.ts'

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

describe('차례 (10n-71)', () => {
  const pagesOf = (list: readonly { kind: string; label: string }[]) => list.filter((c) => c.kind === 'page').map((c) => c.label)

  test('★ 빈 @ — 내가 최근 연 페이지가 먼저(나중에 고친 페이지보다) · 연 적 없는 것은 그 뒤에 최근 고친 순서 · 남의 방문은 차례에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const a = await mk(owner, '가 문서')
    const b = await mk(owner, '나 문서')
    await mk(owner, '다 문서') // 가장 나중에 만들었다(고친 시각이 가장 늦다)
    const d = await mk(owner, '라 문서')
    await recordVisit(owner.ctx, a)
    await recordVisit(owner.ctx, b)
    await recordVisit(member.ctx, d) // 남의 방문
    assert.deepEqual(pagesOf(await searchMentionCandidates(owner.ctx, '')), ['나 문서', '가 문서', '라 문서', '다 문서'])
  })

  test('★ 글자 — 제목이 그 글자로 시작하는 것이 먼저(연 적 없어도) · 같은 무리 안에서는 최근 연 순서', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const inner = await mk(owner, '새 온보딩')
    await mk(owner, '온보딩 가이드')
    const check = await mk(owner, '온보딩 체크')
    await recordVisit(owner.ctx, inner)
    await recordVisit(owner.ctx, check)
    assert.deepEqual(pagesOf(await searchMentionCandidates(owner.ctx, '온보')), ['온보딩 체크', '온보딩 가이드', '새 온보딩'])
  })

  test('★ 멤버가 많아도 빈 @ 에 페이지가 보인다 — 사람은 몇 명까지만 · 이름순', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    for (let i = 0; i < 24; i += 1) await joinAs(owner.ctx.workspaceId, await createUser(`사람${String(i).padStart(2, '0')}`), 'member')
    await mk(owner, '최근 문서')
    const empty = await searchMentionCandidates(owner.ctx, '')
    const people = empty.filter((c) => c.kind === 'user').map((c) => c.label)
    assert.equal(people.length, MENTION_PEOPLE_EMPTY)
    assert.deepEqual(people, [...people].sort((x, y) => x.localeCompare(y, 'ko')), '이름순')
    assert.ok(pagesOf(empty).includes('최근 문서'), '사람이 자리를 다 채웠다')
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

  test('본문에서 멘션 id 를 모은다 — 중첩까지, 중복 없이 · 커스텀 이모지(7c-3a)도', () => {
    const u = randomUUID()
    const p = randomUUID()
    const e = randomUUID()
    const ids = mentionIdsOf({
      blocks: [
        { id: randomUUID(), type: 'paragraph', title: [textRun('a '), userMentionRun(u), pageMentionRun(p), customEmojiMentionRun(e)] },
        {
          id: randomUUID(),
          type: 'toggle',
          title: [userMentionRun(u)],
          children: [{ id: randomUUID(), type: 'paragraph', title: [pageMentionRun(p), customEmojiMentionRun(e)] }],
        },
      ],
    })
    assert.deepEqual(ids, { userIds: [u], pageIds: [p], emojiIds: [e] })
  })

  test('★ 커스텀 이모지(7c-3a) — 이름 · 지웠는가(지운 것도 이름) · 다른 워크스페이스 · 없는 id 는 null · 권한 필터가 없다(게스트도)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const guest = await joinAs(owner.ctx.workspaceId, await createUser('손님'), 'guest')
    const elsewhere = await createBareWorkspace('남의 이모지')
    const putEmoji = async (workspaceId: string, name: string, deleted: boolean): Promise<string> => {
      const fileId = randomUUID()
      await query(
        `INSERT INTO file (id, workspace_id, region_id, storage_key, mime, size_bytes, created_at)
         VALUES ($1, $2, (SELECT region_id FROM workspace WHERE id = $2), $3, 'image/png', 16, now())`,
        [fileId, workspaceId, `mention-labels/${fileId}`],
      )
      const id = randomUUID()
      await query(`INSERT INTO custom_emoji (id, workspace_id, name, file_id, deleted_at) VALUES ($1, $2, $3, $4, $5)`, [
        id, workspaceId, name, fileId, deleted ? new Date() : null,
      ])
      return id
    }
    const live = await putEmoji(owner.ctx.workspaceId, 'party', false)
    const gone = await putEmoji(owner.ctx.workspaceId, 'gone', true)
    const theirs = await putEmoji(elsewhere, 'theirs', false)
    const missing = randomUUID()

    const expected = { [live]: { name: 'party', deleted: false }, [gone]: { name: 'gone', deleted: true }, [theirs]: null, [missing]: null }
    const labels = await loadMentionLabels(owner.ctx, { userIds: [], pageIds: [], emojiIds: [live, gone, theirs, missing] })
    assert.deepEqual(labels.emoji, expected)
    assert.deepEqual((await loadMentionLabels(guest.ctx, { userIds: [], pageIds: [], emojiIds: [live, gone, theirs, missing] })).emoji, expected)
    assert.deepEqual(
      (await loadMentionLabels(owner.ctx, { userIds: [], pageIds: [], emojiIds: [live.toUpperCase(), 'not-a-uuid'] })).emoji,
      { [live]: { name: 'party', deleted: false } },
      '대문자 id 는 소문자로 묻고 uuid 가 아닌 것은 버린다',
    )
    assert.deepEqual((await loadMentionLabels(owner.ctx, { userIds: [], pageIds: [] })).emoji, {}, '묻지 않으면 빈 맵')
  })
})
