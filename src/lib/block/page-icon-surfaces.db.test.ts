/**
 * 페이지 아이콘이 서는 나머지 자리 — 잔여 묶음 8c-2 (F-02-05 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문의 하위 페이지 참조 맵 — 아이콘은 **볼 수 있고 아이콘이 있는 것만**(볼 수 없는 하위 페이지는 제목도 아이콘도 없다) ·
 *      본문 읽기(`loadPageBody`)와 같은 맵
 *   ② ★ 멘션 이름 맵 — 같은 규칙 · `@` 후보는 페이지 아이콘을 싣는다(후보는 이미 권한으로 걸렀다)
 *   ③ 검색 결과 · 백링크 · 인박스 · 옮기기 후보 · 휴지통이 아이콘을 싣는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createUser, joinAs, probeDatabase, makeFixture, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, setPageIcon, titleFromPlainText } from './page.ts'
import { loadPageBody, loadPageRefLabels, savePageBody } from './save-page-body.ts'
import { loadMentionLabels, searchMentionCandidates } from './mention-candidates.ts'
import { listBacklinks } from './link-edges.ts'
import { listMovableTargets } from './move-page.ts'
import { listTrash, trashPage } from './trash.ts'
import { searchPages } from '../search/search.ts'
import { listInbox } from '../notification/inbox.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { withReadTransaction } from '../db/tx.ts'
import { pageMentionRun, textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { PageIcon } from './page-icon.ts'
import type { BlockId } from '../ids.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let member: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  member = await joinAs(fx.workspaceId, await createUser('아이콘 동료'), 'member')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const emoji = (e: string): PageIcon => ({ type: 'emoji', emoji: e })
const token = (label: string) => `${label}${randomUUID().slice(0, 8)}`

async function page(title: string, parentPageId?: BlockId, icon?: string): Promise<BlockId> {
  const id = (await createPage(fx.owner.ctx, { title: titleFromPlainText(title), ...(parentPageId ? { parentPageId } : {}) })).id
  if (icon !== undefined) await setPageIcon(fx.owner.ctx, id, emoji(icon))
  return id
}

/** 이 페이지를 소유자만 보게 — 상속을 끊고 소유자에게 주고 모두에게서 거둔다(세 단계 모두 단언 — 조용한 거부가 검사를 통과시키지 않게). */
async function hideFromMembers(pageId: BlockId): Promise<void> {
  assert.equal((await stopInheriting(fx.owner.ctx, pageId)).ok, true)
  assert.equal((await grantAccess(fx.owner.ctx, pageId, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(fx.owner.ctx, pageId, { type: 'workspace_everyone', id: null })).ok, true)
}

const para = (title: RichTextRun[]) => ({ id: randomUUID(), type: 'paragraph' as const, title, properties: {}, format: {}, children: [] })

describe('① 하위 페이지 참조', () => {
  test('★ 볼 수 있고 아이콘이 있는 것만 — 볼 수 없는 하위 페이지는 제목도 아이콘도 없다 · 본문 읽기와 같은 맵', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const parent = await page('아이콘 부모')
    const visible = await page('보이는 여우', parent, '🦊')
    const secret = await page('숨은 자물쇠', parent, '🔒')
    const plain = await page('아이콘 없는 하위', parent)
    await hideFromMembers(secret)

    const seen = await loadPageRefLabels(member.ctx, parent)
    assert.ok(seen !== null)
    assert.deepEqual(seen.titles, { [visible]: '보이는 여우', [secret]: null, [plain]: '아이콘 없는 하위' })
    assert.deepEqual(seen.icons, { [visible]: emoji('🦊') })
    assert.ok(!JSON.stringify(seen).includes('🔒'), '볼 수 없는 하위 페이지의 아이콘이 맵에 있다')
    assert.deepEqual((await loadPageBody(member.ctx, parent))?.pageRefIcons, seen.icons, '본문 읽기의 맵과 다르다')

    assert.deepEqual((await loadPageRefLabels(fx.owner.ctx, parent))?.icons, { [visible]: emoji('🦊'), [secret]: emoji('🔒') })
  })
})

describe('② 멘션', () => {
  test('★ 이름 맵의 아이콘은 볼 수 있고 아이콘이 있는 것만 · `@` 후보는 페이지 아이콘을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const name = token('멘션여우')
    const visible = await page(name, undefined, '🦊')
    const secret = await page('숨은 멘션 대상', undefined, '🔒')
    const plain = await page('아이콘 없는 멘션 대상')
    await hideFromMembers(secret)

    const labels = await loadMentionLabels(member.ctx, { userIds: [], pageIds: [visible, secret, plain] })
    assert.deepEqual(labels.pages, { [visible]: name, [secret]: null, [plain]: '아이콘 없는 멘션 대상' })
    assert.deepEqual(labels.pageIcons, { [visible]: emoji('🦊') })
    assert.ok(!JSON.stringify(labels).includes('🔒'))

    const candidates = await searchMentionCandidates(member.ctx, name)
    assert.deepEqual(candidates.filter((c) => c.kind === 'page').map((c) => [c.id, c.icon]), [[visible, emoji('🦊')]])
    assert.ok((await searchMentionCandidates(member.ctx, '')).every((c) => c.kind === 'page' || c.icon === null), '사람 후보는 아이콘이 없다')
  })
})

describe('③ 목록들', () => {
  test('검색 결과 · 백링크 · 인박스 · 옮기기 후보 · 휴지통이 아이콘을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const name = token('목록여우')
    const target = await page(name, undefined, '🦊')
    const mentioner = await page('멘션한 페이지', undefined, '🌳')
    const saved = await savePageBody(fx.owner.ctx, mentioner, {
      blocks: [para([textRun('참고: '), pageMentionRun(target), textRun(' · 담당 '), userMentionRun(member.userId)])],
    })
    assert.ok(saved.ok, JSON.stringify(saved))

    const found = await searchPages(fx.owner.ctx, { query: name })
    assert.ok(found.ok)
    if (found.ok) assert.deepEqual(found.results.results.map((r) => [r.pageId, r.icon]), [[target, emoji('🦊')]])

    const backlinks = await withReadTransaction((tx) => listBacklinks(tx, fx.owner.ctx, target))
    assert.deepEqual(backlinks.map((b) => [b.pageId, b.icon]), [[mentioner, emoji('🌳')]])

    const inbox = await listInbox(member.ctx)
    assert.deepEqual(inbox.filter((i) => i.pageId === mentioner).map((i) => i.pageIcon), [emoji('🌳')])

    const moving = await page('옮길 페이지')
    const targets = await listMovableTargets(fx.owner.ctx, moving)
    assert.deepEqual(targets.find((x) => x.id === target)?.icon, emoji('🦊'))
    assert.deepEqual(targets.find((x) => x.id === mentioner)?.icon, emoji('🌳'))

    const doomed = await page('버릴 페이지', undefined, '🗑️')
    await trashPage(fx.owner.ctx, doomed)
    assert.deepEqual((await listTrash(fx.owner.ctx)).find((e) => e.id === doomed)?.icon, emoji('🗑️'))
  })
})
