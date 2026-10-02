/**
 * breadcrumb 블록 — 잔여 묶음 8b-2 (F-01-16 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 본문 저장(서버 명령 경로 — Y.Doc → 투영)이 breadcrumb 을 `type='breadcrumb'` 행으로 쓴다 — 내용 · 색을 저장하지 않는다 ·
 *      Y.Doc 과 행이 같은 문서(색은 Y.Doc 에 넣을 때도 버린다 — 8a-1 이 정한 것)
 *   ② 자식을 실어 보내면 거부한다
 *   ③ ★ 페이지의 경로는 볼 수 있는 조상만 — 소유자의 개인 페이지 아래에서 공유받은 사람에게 조상이 없다(머리와 블록이 같은 줄)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createUser, joinAs, probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage, getPage, listAncestors, titleFromPlainText } from './page.ts'
import { savePageBody } from './save-page-body.ts'
import { grantAccess } from '../permissions/acl.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { query } from '../db/pool.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { BREADCRUMB_TYPE, breadcrumbTrail } from './breadcrumb.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const block = (type: string, format: Record<string, unknown> = {}, children: EditorBlock[] = []): EditorBlock => ({
  id: randomUUID(), type: type as EditorBlock['type'], title: [], properties: {}, format, children,
})

describe('① ② 본문 저장', () => {
  test("★ breadcrumb 은 type='breadcrumb' 행 — 내용 · 색을 저장하지 않는다 · Y.Doc 과 같다", async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = (await createPage(fx.owner.ctx, { title: titleFromPlainText('경로') })).id
    const crumb = { ...block(BREADCRUMB_TYPE, { block_color: 'red' }), title: [textRun('실어 보낸 글')] }
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [crumb] })
    assert.ok(saved.ok, JSON.stringify(saved))
    const rows = await query<{ type: string; properties: object; format: object }>(`SELECT type, properties, format FROM block WHERE id = $1`, [crumb.id])
    assert.deepEqual(rows.map((r) => [r.type, r.properties, r.format]), [[BREADCRUMB_TYPE, {}, {}]])
    const ydoc = await assertBodyMatchesYDoc(fx.owner.ctx, pageId)
    assert.deepEqual(ydoc.blocks[0]?.format ?? {}, {}, '색이 Y.Doc 에 남았다')
  })

  test('자식을 실어 보내면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pageId = (await createPage(fx.owner.ctx, { title: titleFromPlainText('경로 자식') })).id
    const saved = await savePageBody(fx.owner.ctx, pageId, { blocks: [block(BREADCRUMB_TYPE, {}, [block('paragraph')])] })
    assert.equal(saved.ok, false)
  })
})

describe('③ 볼 수 있는 조상만', () => {
  test('★ 개인 페이지 아래의 페이지를 공유받은 사람의 경로에는 조상이 없다 — 소유자에게는 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const top = await createPage(fx.owner.ctx, { title: titleFromPlainText('기밀 상위 987654'), privateTop: true })
    const middle = await createPage(fx.owner.ctx, { title: titleFromPlainText('기밀 중간 987654'), parentPageId: top.id })
    const leaf = await createPage(fx.owner.ctx, { title: titleFromPlainText('공유한 페이지'), parentPageId: middle.id })
    const member = await joinAs(fx.workspaceId, await createUser('공유받은 동료'), 'member')
    const granted = await grantAccess(fx.owner.ctx, leaf.id, { type: 'user', id: member.userId }, 'view')
    assert.ok(granted.ok, JSON.stringify(granted))

    const trailFor = async (ctx: typeof fx.owner.ctx) => {
      const page = await getPage(ctx, leaf.id)
      assert.ok(page, '전제 — 볼 수 있다')
      const ancestors = await listAncestors(ctx, page)
      return breadcrumbTrail({ workspaceId: ctx.workspaceId, teamspace: null, ancestors, page }).map((i) => i.label)
    }
    assert.deepEqual(await trailFor(fx.owner.ctx), ['워크스페이스', '기밀 상위 987654', '기밀 중간 987654', '공유한 페이지'])
    const shared = await trailFor(member.ctx)
    assert.deepEqual(shared, ['워크스페이스', '공유한 페이지'])
    assert.ok(!JSON.stringify(shared).includes('987654'), '볼 수 없는 조상의 제목이 경로에 샜다')
  })
})
