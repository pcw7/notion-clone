/**
 * 코멘트 스레드 · 코멘트 · 반응 — 서버 명령 (F-05-08 · F-05-07 · 코멘트 1조각 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **코멘트의 자리는 Y.Doc 이 정한다** — 아직 행으로 투영되지 않은 블록(방금 친 문단)에도 코멘트가 달리고,
 *      본문에 없는 블록에는 달리지 않는다. 행에 물었다면 첫 번째가 거부당한다
 *   ② **앵커 블록이 사라져도 스레드는 산다** — 05 F-05-07 의 엣지 케이스. 지우지 않고 `orphaned` 로 표시한다
 *   ③ **쓰는 권한과 정리하는 권한이 다르다** — 작성은 `comment`, 해결은 `edit_content`. 볼 수 없으면 없는 것이다
 *   ④ **지운 코멘트는 내용을 남기지 않는다**(불변식 D3) — 행을 직접 읽어 확인한다
 *   ⑤ **답글은 해결된 스레드를 다시 연다** — 의도된 원본과의 차이(05 F-05-08)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type * as Y from 'yjs'

import { appendDocUpdate } from '../block/body-write.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { textRun } from '../contracts/rich-text.ts'
import { query, queryMaybe } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import type { Level } from '../permissions/levels.ts'
import { changesSince, edit, findBlock, peer } from '../testing/collab-peers.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { textRangeAnchor } from './anchor.ts'
import {
  createDiscussion,
  deleteComment,
  editComment,
  listDiscussions,
  MAX_COMMENT_LENGTH,
  replyToDiscussion,
  setDiscussionResolved,
  toggleReaction,
} from './discussion.ts'

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

const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })
const says = (text: string) => [textRun(text)]

async function workspace(): Promise<{ owner: Actor; member: Actor; other: Actor }> {
  const workspaceId = await createBareWorkspace('코멘트')
  const owner = await joinAs(workspaceId, await createUser('소유자'), 'owner')
  const member = await joinAs(workspaceId, await createUser('멤버'), 'member')
  const other = await joinAs(workspaceId, await createUser('다른멤버'), 'member')
  return { owner, member, other }
}

/** 본문이 있는 최상위 페이지 — 본문 저장이 Y.Doc 까지 만든다(4b). */
async function pageWith(owner: Actor, blocks: EditorBlock[]): Promise<string> {
  const page = await createPage(owner.ctx, { parentPageId: null, title: titleFromPlainText('페이지') })
  const saved = await savePageBody(owner.ctx, page.id as never, { blocks })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  return page.id
}

async function ydocOf(actor: Actor, pageId: string): Promise<Y.Doc> {
  const state = await loadDocState(actor.ctx, pageId)
  if (!state.ok) throw new Error(`본문을 읽지 못했다: ${pageId}`)
  return state.value.ydoc
}

/** 부모에게서 받던 권한을 끊고 소유자에게만 남긴 뒤, 멤버에게 `level` 을 준다(null 이면 아무것도). */
async function restrict(owner: Actor, member: Actor, pageId: string, level: Level | null): Promise<void> {
  assert.equal((await stopInheriting(owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: owner.userId }, 'full_access')).ok, true)
  if (level !== null) {
    assert.equal((await grantAccess(owner.ctx, pageId, { type: 'user', id: member.userId }, level)).ok, true)
  }
  assert.equal((await revokeAccess(owner.ctx, pageId, { type: 'workspace_everyone' })).ok, true)
}

/** 한 스레드를 열고 그 id 를 준다. */
async function openThread(
  actor: Actor,
  pageId: string,
  text: string,
  blockId?: string,
  anchor?: unknown,
): Promise<string> {
  const made = await createDiscussion(actor.ctx, { pageId, blockId, anchor, richText: says(text) })
  assert.equal(made.ok, true, JSON.stringify(made))
  return made.ok ? made.discussionId : ''
}

async function threadsOf(actor: Actor, pageId: string, resolved?: boolean) {
  const listed = await listDiscussions(actor.ctx, pageId, { resolved })
  assert.equal(listed.ok, true, JSON.stringify(listed))
  return listed.ok ? listed.discussions : []
}

const textsOf = (comments: readonly { richText: readonly { plain_text: string }[] }[]): string[] =>
  comments.map((c) => c.richText.map((r) => r.plain_text).join(''))

// ── ① 스레드와 코멘트 ─────────────────────────────────────────────────

describe('스레드와 코멘트', () => {
  test('페이지 스레드를 열고 답글을 단다 — 순서는 쓴 순서다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])

    const discussionId = await openThread(owner, pageId, '여기 정리 필요합니다')
    const reply = await replyToDiscussion(member.ctx, discussionId, says('제가 고치겠습니다'))
    assert.equal(reply.ok, true, JSON.stringify(reply))

    const [thread] = await threadsOf(member, pageId)
    assert.equal(thread.onPage, true, '블록을 주지 않았으니 페이지 스레드다')
    assert.equal(thread.orphaned, false)
    assert.equal(thread.resolved, false)
    assert.equal(thread.createdBy, owner.userId)
    assert.deepEqual(textsOf(thread.comments), ['여기 정리 필요합니다', '제가 고치겠습니다'])
    assert.deepEqual(
      thread.comments.map((c) => c.authorId),
      [owner.userId, member.userId],
    )
  })

  test('빈 코멘트와 너무 긴 코멘트는 거부한다 — 스레드도 생기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])

    const blank = await createDiscussion(owner.ctx, { pageId, richText: says('   ') })
    assert.equal(blank.ok, false)
    assert.equal(blank.ok === false && blank.reason, 'empty')

    // 런 하나의 상한(`MAX_RUN_CONTENT`)은 코멘트 상한과 같으므로 한 런으로는 넘을 수 없다 — 두 런으로 넘긴다.
    const half = Math.ceil((MAX_COMMENT_LENGTH + 1) / 2)
    const long = await createDiscussion(owner.ctx, {
      pageId,
      richText: [textRun('가'.repeat(half)), textRun('나'.repeat(half))],
    })
    assert.equal(long.ok === false && long.reason, 'too_long')

    const broken = await createDiscussion(owner.ctx, { pageId, richText: '문자열' })
    assert.equal(broken.ok === false && broken.reason, 'invalid_rich_text')

    assert.deepEqual(await threadsOf(owner, pageId), [], '거부된 코멘트가 스레드를 남기지 않았다')
  })
})

// ── ② 자리는 Y.Doc 이 정한다 ──────────────────────────────────────────

describe('코멘트의 자리는 Y.Doc 이 정한다', () => {
  test('★ 아직 행으로 투영되지 않은 블록에도 코멘트를 단다 — 방금 친 문단이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const firstId = randomUUID()
    const pageId = await pageWith(owner, [para('원문', firstId)])
    const base = await ydocOf(owner, pageId)

    // 참여자가 문단 하나를 새로 친다. 투영은 미룬다(CRDT 5d 의 창) — 협업 서버가 그렇게 쌓는다.
    const newId = randomUUID()
    const client = peer(base, 71)
    edit(client, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, firstId)
      const schema = doc.type.schema
      const container = schema.nodes.blockContainer.create({ blockId: newId }, [
        schema.nodes.paragraph.create(null, schema.text('방금 친 문단')),
      ])
      tr.insert(pos + node.nodeSize, container)
    })
    const appended = await appendDocUpdate(owner.ctx, pageId, changesSince(client, base), {
      origin: 'editor',
      projection: 'deferred',
    })
    assert.equal(appended.ok, true, JSON.stringify(appended))

    // 전제: 그 블록의 **행은 아직 없다.** 행에 물었다면 아래가 거부당한다.
    assert.equal(await queryMaybe(`SELECT id FROM block WHERE id = $1`, [newId]), null)

    const made = await createDiscussion(owner.ctx, { pageId, blockId: newId, richText: says('이 문장 고치죠') })
    assert.equal(made.ok, true, JSON.stringify(made))

    const [thread] = await threadsOf(owner, pageId)
    assert.equal(thread.blockId, newId)
    assert.equal(thread.onPage, false)
    assert.equal(thread.orphaned, false, '본문에 있으므로 고아가 아니다')
  })

  test('본문에 없는 블록에는 달 수 없다 — 다른 페이지의 블록도 마찬가지다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const elsewhereId = randomUUID()
    const otherPage = await pageWith(owner, [para('남의 본문', elsewhereId)])
    assert.notEqual(otherPage, pageId)

    const ghost = await createDiscussion(owner.ctx, { pageId, blockId: randomUUID(), richText: says('없는 곳') })
    assert.equal(ghost.ok === false && ghost.reason, 'block_not_found')

    const elsewhere = await createDiscussion(owner.ctx, { pageId, blockId: elsewhereId, richText: says('다른 본문') })
    assert.equal(elsewhere.ok === false && elsewhere.reason, 'block_not_found')
  })

  test('★ 앵커 블록이 본문에서 사라져도 스레드는 살아남아 고아로 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const keepId = randomUUID()
    const goneId = randomUUID()
    const pageId = await pageWith(owner, [para('남는 문단', keepId), para('지울 문단', goneId)])

    await openThread(owner, pageId, '이 문장 근거가 뭔가요', goneId)
    assert.equal((await threadsOf(owner, pageId))[0].orphaned, false)

    // 그 문단을 본문에서 없앤다 — 행도 함께 사라진다(프로젝터의 hard delete).
    const saved = await savePageBody(owner.ctx, pageId as never, { blocks: [para('남는 문단', keepId)] })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(await queryMaybe(`SELECT id FROM block WHERE id = $1`, [goneId]), null)

    const [thread] = await threadsOf(owner, pageId)
    assert.equal(thread.orphaned, true, '스레드는 남고 원본 없음으로 표시된다')
    assert.deepEqual(textsOf(thread.comments), ['이 문장 근거가 뭔가요'], '글도 그대로다')
  })
})

// ── ③ 권한 ───────────────────────────────────────────────────────────

describe('권한 — 쓰는 권한과 정리하는 권한이 다르다', () => {
  test('볼 수 없으면 없는 것이다 — 목록도 쓰기도 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('비밀')])
    const discussionId = await openThread(owner, pageId, '소유자만 아는 이야기')
    await restrict(owner, member, pageId, null)

    const listed = await listDiscussions(member.ctx, pageId)
    assert.equal(listed.ok === false && listed.reason, 'not_found')
    const made = await createDiscussion(member.ctx, { pageId, richText: says('끼어들기') })
    assert.equal(made.ok === false && made.reason, 'not_found')
    const reply = await replyToDiscussion(member.ctx, discussionId, says('끼어들기'))
    assert.equal(reply.ok === false && reply.reason, 'not_found', '스레드 id 를 알아도 없는 것이다')
  })

  test('볼 수만 있으면 코멘트를 쓸 수 없다 — 읽기는 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    await openThread(owner, pageId, '소유자의 코멘트')
    await restrict(owner, member, pageId, 'view')

    assert.equal((await threadsOf(member, pageId)).length, 1, '볼 수는 있다')
    const made = await createDiscussion(member.ctx, { pageId, richText: says('쓸 수 없다') })
    assert.equal(made.ok === false && made.reason, 'forbidden')
  })

  test('해결 · 재오픈은 edit_content 가 필요하다 — 코멘트 권한만으로는 못 접는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    await restrict(owner, member, pageId, 'comment')

    const discussionId = await openThread(member, pageId, '쓰는 것은 된다')
    const resolving = await setDiscussionResolved(member.ctx, discussionId, true)
    assert.equal(resolving.ok === false && resolving.reason, 'forbidden')

    const byOwner = await setDiscussionResolved(owner.ctx, discussionId, true)
    assert.equal(byOwner.ok, true, JSON.stringify(byOwner))
  })

  test('남의 코멘트는 고칠 수도 지울 수도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const discussionId = await openThread(owner, pageId, '소유자의 글')
    const [thread] = await threadsOf(owner, pageId)
    const commentId = thread.comments[0].id
    assert.equal(thread.id, discussionId)

    const edited = await editComment(member.ctx, commentId, says('내가 고친다'))
    assert.equal(edited.ok === false && edited.reason, 'forbidden')
    const deleted = await deleteComment(member.ctx, commentId)
    assert.equal(deleted.ok === false && deleted.reason, 'forbidden')

    const mine = await editComment(owner.ctx, commentId, says('내 글은 고친다'))
    assert.equal(mine.ok, true, JSON.stringify(mine))
    const [after] = await threadsOf(owner, pageId)
    assert.deepEqual(textsOf(after.comments), ['내 글은 고친다'])
    assert.notEqual(after.comments[0].editedAt, null, '고친 시각이 남는다')
  })
})

// ── ④ 해결 · 재오픈 ───────────────────────────────────────────────────

describe('해결과 재오픈', () => {
  test('★ 답글은 해결된 스레드를 다시 연다 — 의도된 원본과의 차이', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const discussionId = await openThread(owner, pageId, '처리했나요')
    assert.equal((await setDiscussionResolved(owner.ctx, discussionId, true)).ok, true)
    assert.deepEqual(await threadsOf(owner, pageId, false), [], '접혀서 열린 목록에 없다')

    const reply = await replyToDiscussion(member.ctx, discussionId, says('아직입니다'))
    assert.equal(reply.ok === true && reply.reopened, true)

    const open = await threadsOf(owner, pageId, false)
    assert.equal(open.length, 1, '답글이 다시 열었다')
    assert.equal(open[0].resolvedBy, null, '해결한 사람도 지워진다')
  })

  test('해결은 멱등이다 — 두 번째는 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const discussionId = await openThread(owner, pageId, '접을 스레드')

    const first = await setDiscussionResolved(owner.ctx, discussionId, true)
    assert.equal(first.ok === true && first.changed, true)
    const second = await setDiscussionResolved(member.ctx, discussionId, true)
    assert.equal(second.ok === true && second.changed, false)

    const [thread] = await threadsOf(owner, pageId, true)
    assert.equal(thread.resolvedBy, owner.userId, '먼저 커밋한 쪽이 해결자로 남는다')
  })
})

// ── ⑤ 삭제 ───────────────────────────────────────────────────────────

describe('삭제', () => {
  test('★ 지운 코멘트는 자리만 남기고 내용을 행에 남기지 않는다 (D3)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const discussionId = await openThread(owner, pageId, '지울 첫 글')
    assert.equal((await replyToDiscussion(member.ctx, discussionId, says('남을 답글'))).ok, true)

    const [before] = await threadsOf(owner, pageId)
    const firstId = before.comments[0].id
    const deleted = await deleteComment(owner.ctx, firstId)
    assert.equal(deleted.ok === true && deleted.discussionDeleted, false, '답글이 남았으니 스레드는 산다')

    const rows = await query<{ rich_text: unknown }>(`SELECT rich_text FROM comment WHERE id = $1`, [firstId])
    assert.deepEqual(rows[0].rich_text, [], '행에도 내용이 없다')

    const [after] = await threadsOf(owner, pageId)
    assert.equal(after.comments.length, 2, '자리는 남는다 — "삭제된 코멘트"')
    assert.equal(after.comments[0].deleted, true)
    assert.deepEqual(after.comments[0].richText, [])
    assert.deepEqual(textsOf(after.comments.slice(1)), ['남을 답글'])

    const again = await deleteComment(owner.ctx, firstId)
    assert.equal(again.ok === false && again.reason, 'not_found', '지운 코멘트는 없는 것이다')
  })

  test('마지막 살아 있는 코멘트를 지우면 스레드와 반응이 함께 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const discussionId = await openThread(owner, pageId, '혼자 있는 글')
    const [thread] = await threadsOf(owner, pageId)
    const commentId = thread.comments[0].id
    assert.equal((await toggleReaction(member.ctx, { targetKind: 'comment', targetId: commentId, emoji: '👍' })).ok, true)
    assert.equal(
      (await toggleReaction(member.ctx, { targetKind: 'discussion', targetId: discussionId, emoji: '🙂' })).ok,
      true,
    )

    const deleted = await deleteComment(owner.ctx, commentId)
    assert.equal(deleted.ok === true && deleted.discussionDeleted, true)
    assert.deepEqual(await threadsOf(owner, pageId), [])
    assert.equal(await queryMaybe(`SELECT id FROM discussion WHERE id = $1`, [discussionId]), null)
    assert.deepEqual(
      await query(`SELECT emoji FROM reaction WHERE target_id = ANY($1::uuid[])`, [[discussionId, commentId]]),
      [],
      '아무도 가리키지 않는 반응을 남기지 않는다',
    )
  })
})

// ── ⑥ 반응 ───────────────────────────────────────────────────────────

describe('반응', () => {
  test('같은 이모지를 다시 누르면 없어지고, 둘이 누르면 둘 다 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member, other } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    await openThread(owner, pageId, '반응받을 글')
    const commentId = (await threadsOf(owner, pageId))[0].comments[0].id

    const on = await toggleReaction(member.ctx, { targetKind: 'comment', targetId: commentId, emoji: '👍' })
    assert.equal(on.ok === true && on.added, true)
    assert.equal((await toggleReaction(other.ctx, { targetKind: 'comment', targetId: commentId, emoji: '👍' })).ok, true)

    const [thread] = await threadsOf(owner, pageId)
    assert.deepEqual(thread.comments[0].reactions, [{ emoji: '👍', userIds: [member.userId, other.userId] }])

    const off = await toggleReaction(member.ctx, { targetKind: 'comment', targetId: commentId, emoji: '👍' })
    assert.equal(off.ok === true && off.added, false)
    const [again] = await threadsOf(owner, pageId)
    assert.deepEqual(again.comments[0].reactions, [{ emoji: '👍', userIds: [other.userId] }])
  })

  test('지운 코멘트에는 반응할 수 없고, 이모지가 아닌 값은 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner, member } = await workspace()
    const pageId = await pageWith(owner, [para('본문')])
    const discussionId = await openThread(owner, pageId, '지울 글')
    assert.equal((await replyToDiscussion(member.ctx, discussionId, says('남을 답글'))).ok, true)
    const commentId = (await threadsOf(owner, pageId))[0].comments[0].id
    assert.equal((await deleteComment(owner.ctx, commentId)).ok, true)

    const onDeleted = await toggleReaction(member.ctx, { targetKind: 'comment', targetId: commentId, emoji: '👍' })
    assert.equal(onDeleted.ok === false && onDeleted.reason, 'not_found')

    const blank = await toggleReaction(member.ctx, { targetKind: 'discussion', targetId: discussionId, emoji: '  ' })
    assert.equal(blank.ok === false && blank.reason, 'invalid_emoji')
    const sentence = await toggleReaction(member.ctx, {
      targetKind: 'discussion',
      targetId: discussionId,
      emoji: '좋은 생각입니다',
    })
    assert.equal(sentence.ok === false && sentence.reason, 'invalid_emoji')
  })
})

// ── ⑦ 범위 앵커 (2조각) ──────────────────────────────────────────────

describe('글자 범위에 단 스레드', () => {
  test('목록이 지금 범위와 만들 때의 원문 스냅샷을 함께 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const blockId = randomUUID()
    const pageId = await pageWith(owner, [para('가나다라마바사', blockId)])
    const anchor = textRangeAnchor(await ydocOf(owner, pageId), blockId, 2, 5)
    assert.ok(anchor !== null)

    const made = await createDiscussion(owner.ctx, { pageId, blockId, anchor, richText: says('이 표현이 맞나요') })
    assert.equal(made.ok, true, JSON.stringify(made))

    const [thread] = await threadsOf(owner, pageId)
    assert.equal(thread.onPage, false)
    assert.equal(thread.orphaned, false)
    assert.equal(thread.anchor?.quotedText, '다라마')
    assert.deepEqual(thread.anchor?.range, { start: 2, end: 5, text: '다라마' })
  })

  test('★ 범위가 밀려도 같은 글자를 가리키고, 그 글자를 다 지우면 고아가 된다 — 원문은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const blockId = randomUUID()
    const pageId = await pageWith(owner, [para('가나다라마바사', blockId)])
    const base = await ydocOf(owner, pageId)
    const anchor = textRangeAnchor(base, blockId, 2, 5)
    assert.ok(anchor !== null)
    await openThread(owner, pageId, '이 표현이 맞나요', blockId, anchor)

    // 참여자가 앞에 글자를 친다 — 협업 서버가 쓰는 그 경로다.
    const typing = peer(base, 91)
    edit(typing, (tr: Transaction, doc: PmNode) => {
      tr.insertText('앞앞', findBlock(doc, blockId).pos + 2)
    })
    assert.equal((await appendDocUpdate(owner.ctx, pageId, changesSince(typing, base), { origin: 'editor' })).ok, true)

    const [moved] = await threadsOf(owner, pageId)
    assert.deepEqual(moved.anchor?.range, { start: 4, end: 7, text: '다라마' }, '밀렸을 뿐 같은 글자다')
    assert.equal(moved.orphaned, false)

    // 이제 그 글자를 전부 지운다.
    const after = await ydocOf(owner, pageId)
    const deleting = peer(after, 92)
    edit(deleting, (tr: Transaction, doc: PmNode) => {
      const { pos } = findBlock(doc, blockId)
      tr.delete(pos + 2 + 4, pos + 2 + 7)
    })
    assert.equal((await appendDocUpdate(owner.ctx, pageId, changesSince(deleting, after), { origin: 'editor' })).ok, true)

    const [lost] = await threadsOf(owner, pageId)
    assert.equal(lost.orphaned, true, '가리킬 글자가 없다')
    assert.deepEqual(lost.anchor?.range, { start: 4, end: 4, text: '' }, '범위는 비었지만 자리는 안다')
    assert.equal(lost.anchor?.quotedText, '다라마', '보여줄 원문은 남는다')
    assert.deepEqual(textsOf(lost.comments), ['이 표현이 맞나요'], '스레드와 글은 그대로다')
  })

  test('★ 아직 서버에 없는 글자를 가리켜도 받아 두고, 그 update 가 도착하면 스스로 풀린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const blockId = randomUUID()
    const pageId = await pageWith(owner, [para('원문', blockId)])
    const base = await ydocOf(owner, pageId)

    // 편집기가 방금 친 글자를 고른다 — 그 update 는 아직 서버에 가지 않았다.
    const typing = peer(base, 93)
    edit(typing, (tr: Transaction, doc: PmNode) => {
      tr.insertText('새글', findBlock(doc, blockId).pos + 2)
    })
    const anchor = textRangeAnchor(typing, blockId, 0, 2)
    assert.ok(anchor !== null)
    assert.equal(anchor.quotedText, '새글')

    const made = await createDiscussion(owner.ctx, { pageId, blockId, anchor, richText: says('방금 친 글에') })
    assert.equal(made.ok, true, '풀리지 않는다고 거부하면 "방금 고른 글에 코멘트"가 끊긴다')

    const [pending] = await threadsOf(owner, pageId)
    assert.equal(pending.anchor?.range, null, '서버는 아직 그 글자를 모른다')
    assert.equal(pending.orphaned, true)

    assert.equal((await appendDocUpdate(owner.ctx, pageId, changesSince(typing, base), { origin: 'editor' })).ok, true)

    const [healed] = await threadsOf(owner, pageId)
    assert.deepEqual(healed.anchor?.range, { start: 0, end: 2, text: '새글' })
    assert.equal(healed.orphaned, false, '도착하자 스스로 풀렸다')
  })

  test('페이지 스레드에는 범위를 둘 수 없고, 모양이 아닌 앵커는 받지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const blockId = randomUUID()
    const pageId = await pageWith(owner, [para('가나다라마바사', blockId)])
    const anchor = textRangeAnchor(await ydocOf(owner, pageId), blockId, 2, 5)
    assert.ok(anchor !== null)

    const onPage = await createDiscussion(owner.ctx, { pageId, anchor, richText: says('페이지에') })
    assert.equal(onPage.ok === false && onPage.reason, 'invalid_anchor')

    const junk = await createDiscussion(owner.ctx, {
      pageId,
      blockId,
      anchor: { ...anchor, start: '!!!' },
      richText: says('망가진 앵커'),
    })
    assert.equal(junk.ok === false && junk.reason, 'invalid_anchor')

    const noSnapshot = await createDiscussion(owner.ctx, {
      pageId,
      blockId,
      anchor: { start: anchor.start, end: anchor.end, quotedText: '' },
      richText: says('원문 없는 앵커'),
    })
    assert.equal(noSnapshot.ok === false && noSnapshot.reason, 'invalid_anchor')

    assert.deepEqual(await threadsOf(owner, pageId), [], '거부된 앵커가 스레드를 남기지 않았다')
  })

  test('블록 스레드는 앵커 없이 그대로다 — 2조각이 1조각을 바꾸지 않았다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { owner } = await workspace()
    const blockId = randomUUID()
    const pageId = await pageWith(owner, [para('가나다라마바사', blockId)])
    await openThread(owner, pageId, '블록 전체에', blockId)

    const [thread] = await threadsOf(owner, pageId)
    assert.equal(thread.anchor, null)
    assert.equal(thread.onPage, false)
    assert.equal(thread.orphaned, false)
  })
})
