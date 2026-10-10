/**
 * 공개 화면의 읽기 — 게시 · 공유 6a-2a조각 (F-06-08 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 공개 화면 ②③④).
 *
 *   ① 본문은 그 페이지의 문서 범위다 — 글 블록이 순서대로 오고 · 하위 페이지의 본문은 따라오지 않는다 · 데이터베이스 블록은 빠진다
 *   ② ★ 하위 페이지 참조는 이 토큰으로 열 수 있는 것만 — 상속을 끊은 하위 · 휴지통의 하위는 문서에서 빠지고 제목도 지도에 없다
 *   ③ ★ 페이지 멘션 — 공개 안이면 지도에 제목 · 공개 밖이면 지도에 없다(제목을 싣지 않는다) · 사람 멘션은 이 워크스페이스 사람만 이름
 *   ④ 사슬의 제목 — 루트에서 이 페이지까지만(루트 위의 조상은 없다)
 *   ⑤ 판정이 거절하면 그대로 — 없는 페이지 · 만료
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { savePageBody } from '../block/save-page-body.ts'
import { trashPage } from '../block/trash.ts'
import { pageMentionRun, textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import { createDatabase } from '../database/database.ts'
import { query } from '../db/pool.ts'
import type { EditorBlock } from '../editor/document.ts'
import type { BlockId } from '../ids.ts'
import { stopInheriting } from '../permissions/acl.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { publishPage } from './public-link.ts'
import { readPublicPage } from './public-read.ts'

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

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

async function office() {
  const ws = await createBareWorkspace('공개 화면')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  return { ws, boss }
}

const block = (type: string, title: readonly RichTextRun[], extra: Partial<EditorBlock> = {}): EditorBlock =>
  ({ id: crypto.randomUUID(), type, title, ...extra }) as EditorBlock

const pageNamed = async (by: Actor, title: string, parent?: BlockId): Promise<BlockId> =>
  (await createPage(by.ctx, parent === undefined ? { privateTop: true, title: titleFromPlainText(title) } : { parentPageId: parent, title: titleFromPlainText(title) })).id

async function tokenOf(by: Actor, pageId: string): Promise<string> {
  const result = await publishPage(by.ctx, pageId)
  assert.ok(result.ok, JSON.stringify(result))
  return result.value.token!
}

const plain = (runs: readonly RichTextRun[] | undefined): string => (runs ?? []).map((r) => r.plain_text ?? '').join('')

async function readOk(token: string, pageId?: string) {
  const read = await readPublicPage(token, pageId)
  assert.ok(read.ok, JSON.stringify(read))
  return read.value
}

// ── ① 본문 ────────────────────────────────────────────────────────────

describe('① 본문 — 그 페이지의 문서 범위', () => {
  test('글 블록이 순서대로 · 자식 블록 · 하위 페이지의 본문은 따라오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('위키'))
    const saved = await savePageBody(boss.ctx, doc, {
      blocks: [
        block('heading_1', [textRun('머리')]),
        block('toggle', [textRun('펼치기')], { children: [block('paragraph', [textRun('안쪽')])] }),
        block('paragraph', [textRun('끝')]),
      ],
    })
    assert.ok(saved.ok, JSON.stringify(saved))
    const sub = await pageNamed(boss, '하위', doc)
    assert.ok((await savePageBody(boss.ctx, sub, { blocks: [block('paragraph', [textRun('하위의 본문')])] })).ok)
    const token = await tokenOf(boss, doc)

    const view = await readOk(token)
    const shape = view.doc.blocks.map((b) => `${b.type}:${plain(b.title)}`)
    assert.deepEqual(shape.filter((s) => !s.startsWith('page:')), ['heading_1:머리', 'toggle:펼치기', 'paragraph:끝'])
    assert.equal(plain(view.doc.blocks[1]!.children?.[0]?.title), '안쪽')
    assert.ok(!JSON.stringify(view.doc).includes('하위의 본문'), '하위 페이지의 본문은 이 문서가 아니다')
    assert.equal(plain(view.title).startsWith('위키'), true)
  })

  test('데이터베이스 블록은 빠진다(6a-2b)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('표가 든 문서'))
    const db = await createDatabase(boss.ctx, { name: unique('표') })
    assert.ok(db.ok)
    // 인라인 표처럼 — 데이터베이스 블록을 이 페이지 밑에 둔다(행의 모양만 · 화면 경로와 무관)
    await query(`UPDATE block SET parent_type = 'block', parent_id = $2, ancestor_path = ARRAY[$2]::uuid[] WHERE id = $1`, [db.value.id, doc])
    const token = await tokenOf(boss, doc)
    const view = await readOk(token)
    assert.ok(view.doc.blocks.every((b) => b.id !== db.value.id))
  })
})

// ── ② 하위 페이지 참조 ────────────────────────────────────────────────

describe('② ★ 하위 페이지 참조 — 열 수 있는 것만', () => {
  test('상속을 끊은 하위 · 휴지통의 하위는 빠지고 제목도 없다 · 열린 하위는 제목과 함께', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('루트'))
    const open = await pageNamed(boss, '열린 하위', doc)
    const cut = await pageNamed(boss, '끊은 하위 — 비밀', doc)
    const gone = await pageNamed(boss, '버린 하위', doc)
    assert.ok((await stopInheriting(boss.ctx, cut)).ok)
    await trashPage(boss.ctx, gone)
    const token = await tokenOf(boss, doc)

    const view = await readOk(token)
    const refs = view.doc.blocks.filter((b) => b.type === 'page').map((b) => b.id)
    assert.deepEqual(refs, [open])
    assert.equal(plain(view.pages.get(open)), '열린 하위')
    assert.equal(view.pages.has(cut), false)
    assert.equal(view.pages.has(gone), false)
    assert.ok(!JSON.stringify([...view.pages.values()]).includes('비밀'))
  })
})

// ── ③ 멘션 ────────────────────────────────────────────────────────────

describe('③ ★ 멘션 — 공개 밖은 제목을 싣지 않는다', () => {
  test('공개 안의 페이지 멘션은 제목 · 밖은 지도에 없다 · 사람은 이 워크스페이스의 사람만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const outsider = await createUser('남의 사람')
    const doc = await pageNamed(boss, unique('멘션'))
    const inside = await pageNamed(boss, '안의 페이지', doc)
    const secret = await pageNamed(boss, unique('비밀 계획'))
    const saved = await savePageBody(boss.ctx, doc, {
      blocks: [
        block('paragraph', [textRun('안 '), pageMentionRun(inside), textRun(' 밖 '), pageMentionRun(secret)]),
        block('paragraph', [userMentionRun(boss.userId), textRun(' · '), userMentionRun(outsider.userId)]),
        // 이미 있는 하위 페이지의 참조 — 본문을 통째로 쓸 때 빠뜨리면 거부된다(page_ref_missing)
        { id: inside, type: 'page', title: [] },
      ],
    })
    assert.ok(saved.ok, JSON.stringify(saved))
    const token = await tokenOf(boss, doc)

    const view = await readOk(token)
    assert.equal(plain(view.pages.get(inside)), '안의 페이지')
    assert.equal(view.pages.has(secret), false, '공개 밖의 멘션은 지도에 없다')
    assert.ok(!JSON.stringify([...view.pages.values()]).includes('비밀 계획'))
    assert.equal(view.people.get(boss.userId), '대표')
    assert.equal(view.people.has(outsider.userId), false, '이 워크스페이스의 사람이 아니다')
    void ws
  })
})

// ── ④ 사슬 ────────────────────────────────────────────────────────────

describe('④ 사슬의 제목 — 루트에서 이 페이지까지만', () => {
  test('루트 위의 조상은 지도에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const top = await pageNamed(boss, unique('맨 위 — 공개 아님'))
    const doc = await pageNamed(boss, '게시 루트', top)
    const sub = await pageNamed(boss, '깊은 하위', doc)
    const token = await tokenOf(boss, doc)

    const view = await readOk(token, sub)
    assert.deepEqual(view.target.chain, [doc, sub])
    assert.equal(plain(view.pages.get(doc)), '게시 루트')
    assert.equal(view.pages.has(top), false)
  })
})

// ── ⑤ 거절 ────────────────────────────────────────────────────────────

describe('⑤ 판정이 거절하면 그대로', () => {
  test('없는 페이지 · 만료', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await pageNamed(boss, unique('만료'))
    const elsewhere = await pageNamed(boss, unique('다른 곳'))
    const token = await tokenOf(boss, doc)
    assert.deepEqual(await readPublicPage(token, elsewhere), { ok: false, reason: 'not_found' })
    await query(`UPDATE public_link SET expires_at = now() - interval '1 minute' WHERE node_id = $1`, [doc])
    assert.deepEqual(await readPublicPage(token), { ok: false, reason: 'expired' })
  })
})
