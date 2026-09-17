/**
 * 페이지 CRUD — 트리 불변식 검증
 *
 * 정본: 00-canonical-data-model.md §3.4 (B1·B6·B7·B10), §3.11 (perm_scope_id)
 *
 * 이 저장소의 테스트 철학(HANDOFF §5)대로 **실패 경로를 성공 경로보다 많이** 쓴다.
 * 페이지 트리에서 조용히 깨지는 것 네 가지가 여기 전부 있다:
 *
 *   1. 다른 워크스페이스의 페이지가 읽히는가 (링크 유출 시나리오)
 *   2. `order_key` 가 본문 블록과 충돌하는가 (같은 parent_id 이름공간)
 *   3. `ancestor_path` 가 실제 조상과 어긋나는가
 *   4. 깊이 상한이 정말 거부하는가
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, createUser, createBareWorkspace, joinAs, type Fixture } from '../testing/db-fixtures.ts'
import {
  createPage,
  getPage,
  listChildPages,
  listAncestors,
  renamePage,
  titleFromPlainText,
  PageError,
  MAX_TREE_DEPTH,
} from './page.ts'
import { asBlockId, type BlockId } from '../ids.ts'
import { textRun } from '../contracts/rich-text.ts'
import { orderKeyBetween } from './order-key.ts'
import { savePageBody } from './save-page-body.ts'
import { trashPage } from './trash.ts'
import { query } from '../db/pool.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import type { EditorBlock } from '../editor/document.ts'

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

// ── 순수 함수 (DB 불필요) ─────────────────────────────────────────────

describe('titleFromPlainText', () => {
  test('개행을 공백으로 접는다 — 제목에는 줄바꿈이 없다', () => {
    const runs = titleFromPlainText('첫 줄\n둘째 줄')
    assert.equal(runs.length, 1)
    assert.equal(runs[0].plain_text, '첫 줄 둘째 줄')
  })

  test('빈 제목은 빈 배열이다 — 빈 런을 넣지 않는다', () => {
    // 빈 런을 넣으면 normalizeRichText 가 나중에 제거해서 배열 길이가
    // 저장 전후로 달라진다. 애초에 만들지 않는다.
    assert.deepEqual(titleFromPlainText('   '), [])
    assert.deepEqual(titleFromPlainText(''), [])
    assert.deepEqual(titleFromPlainText(null), [])
    assert.deepEqual(titleFromPlainText(42), [])
  })
})

// ── DB 경로 ───────────────────────────────────────────────────────────

describe('createPage', () => {
  test('루트 페이지는 parent_type=workspace 이고 자기 자신이 권한 스코프다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const page = await createPage(fx.owner.ctx, { title: titleFromPlainText('첫 페이지') })

    assert.equal(page.plainTitle, '첫 페이지')
    assert.equal(page.parentPageId, null)
    assert.deepEqual(page.ancestors, [])
    // 정본 §3.11: "없으면 teamspace 루트(또는 Private 루트) id".
    // MVP 에 teamspace 가 없으므로 루트 페이지가 스코프 루트다.
    assert.equal(page.permScopeId, page.id)
  })

  test('자식 페이지는 ancestor_path 를 이어받고 부모의 권한 스코프를 상속한다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await createPage(fx.owner.ctx, { title: titleFromPlainText('루트') })
    const child = await createPage(fx.owner.ctx, {
      parentPageId: root.id,
      title: titleFromPlainText('자식'),
    })
    const grandchild = await createPage(fx.owner.ctx, {
      parentPageId: child.id,
      title: titleFromPlainText('손자'),
    })

    assert.equal(child.parentPageId, root.id)
    assert.deepEqual(child.ancestors, [root.id])
    // 루트→부모 **순서**가 정본이다. 뒤집히면 breadcrumb 이 거꾸로 나온다.
    assert.deepEqual(grandchild.ancestors, [root.id, child.id])

    // acl_entry 가 아직 없으므로 서브트리 전체가 루트의 스코프다.
    assert.equal(child.permScopeId, root.id)
    assert.equal(grandchild.permScopeId, root.id)
  })

  test('order_key 는 본문 블록과 같은 이름공간을 쓴다 — 페이지만 보고 max 를 구하면 충돌한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')

    const root = await createPage(fx.owner.ctx)
    const firstChild = await createPage(fx.owner.ctx, { parentPageId: root.id })

    // 같은 부모 아래에 **페이지가 아닌** 본문 블록을 firstChild 뒤에 둔다.
    // ux_block_sibling_order 는 (parent_id, order_key) 전체에 걸린 UNIQUE 이고
    // type 조건이 없다. CRDT 4b 부터 본문의 정본은 Y.Doc 이라 SQL 로 행만 넣으면 다음 투영이
    // 그 행을 지운다 — 본문 저장으로 넣는다.
    const bodyId = randomUUID()
    const saved = await savePageBody(fx.owner.ctx, root.id, {
      blocks: [
        { id: firstChild.id, type: 'page', title: [] },
        { id: bodyId, type: 'paragraph', title: [textRun('본문')] },
      ],
    })
    assert.ok(saved.ok, JSON.stringify(saved))
    const [{ order_key: bodyKey }] = await query<{ order_key: string }>(`SELECT order_key FROM block WHERE id = $1`, [bodyId])

    // 이제 자식 페이지를 하나 더 만든다. 본문 블록의 키를 무시하면 여기서 터진다.
    const secondChild = await createPage(fx.owner.ctx, { parentPageId: root.id })
    assert.ok(
      secondChild.orderKey > bodyKey,
      `새 페이지의 order_key(${secondChild.orderKey})가 본문 블록(${bodyKey}) 뒤여야 합니다`,
    )
  })

  test('휴지통에 있는 형제의 order_key 도 점유된 것으로 센다 (B2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await createPage(fx.owner.ctx)
    const doomed = await createPage(fx.owner.ctx, { parentPageId: root.id })

    // B2: 삭제 시 parent_id·order_key 를 절대 변경하지 않는다. CRDT 4b 부터 휴지통은 부모 본문의
    // 참조도 빼므로 SQL 이 아니라 명령으로 버린다 — SQL 로 버리면 참조가 본문에 남아 투영이 그 키를 다시 매긴다.
    await trashPage(fx.owner.ctx, doomed.id)

    const next = await createPage(fx.owner.ctx, { parentPageId: root.id })
    assert.ok(
      next.orderKey > doomed.orderKey,
      '휴지통 형제의 키를 건너뛰지 않으면 UNIQUE 에 충돌한다',
    )
  })

  test('없는 부모 / 다른 워크스페이스의 부모 / 페이지가 아닌 부모 — 전부 parent_not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')

    // ① 존재하지 않는 id
    await assert.rejects(
      () => createPage(fx.owner.ctx, { parentPageId: asBlockId(randomUUID()) }),
      (e: unknown) => e instanceof PageError && e.code === 'parent_not_found',
    )

    // ② 다른 워크스페이스에 실제로 존재하는 페이지
    const otherWs = await createBareWorkspace('남의 워크스페이스')
    const otherUser = await createUser('남')
    const other = await joinAs(otherWs, otherUser, 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('남의 페이지') })

    await assert.rejects(
      () => createPage(fx.owner.ctx, { parentPageId: foreign.id }),
      (e: unknown) => e instanceof PageError && e.code === 'parent_not_found',
      '다른 워크스페이스의 페이지를 부모로 삼을 수 있으면 워크스페이스 경계가 뚫린다',
    )

    // ③ 페이지가 아닌 블록 (본문 문단)
    const root = await createPage(fx.owner.ctx)
    const paragraphId = randomUUID()
    await query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format,
                          created_by, created_at, last_edited_by, last_edited_at)
       VALUES ($1, $2, 'paragraph', 'block', $3, 'a0', $4, $5,
               '{}'::jsonb, '{}'::jsonb, $6, now(), $6, now())`,
      [paragraphId, fx.workspaceId, root.id, [root.id], root.permScopeId, fx.owner.userId],
    )
    await assert.rejects(
      () => createPage(fx.owner.ctx, { parentPageId: asBlockId(paragraphId) }),
      (e: unknown) => e instanceof PageError && e.code === 'parent_not_found',
    )
  })

  test('제목이 RichText[] 계약을 어기면 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    // 존재하지 않는 색. 계약(19색)을 어긴다.
    const bad = [{ ...textRun('x'), annotations: { ...textRun('x').annotations, color: 'default_background' } }]
    await assert.rejects(
      () => createPage(fx.owner.ctx, { title: bad as never }),
      (e: unknown) => e instanceof PageError && e.code === 'invalid_title',
    )
  })

  test('동시에 만든 형제들이 서로 다른 order_key 를 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await createPage(fx.owner.ctx)
    // 부모 행을 FOR UPDATE 로 잠그지 않으면 여기서 UNIQUE 위반이 난다.
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createPage(fx.owner.ctx, { parentPageId: root.id, title: titleFromPlainText(`동시 ${i}`) }),
      ),
    )

    const keys = created.map((p) => p.orderKey)
    assert.equal(new Set(keys).size, keys.length, `order_key 가 중복됐다: ${keys.join(', ')}`)
  })
})

describe('createPage — 부모 본문 (X-1 · CRDT 4b)', () => {
  test('★ 하위 페이지를 만들면 부모 본문 끝에 참조가 들어가고 행과 Y.Doc 이 같다 — 빈 본문에서는 빈 줄 행을 만들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const root = await createPage(fx.owner.ctx, { title: titleFromPlainText('부모') })
    const first = await createPage(fx.owner.ctx, { parentPageId: root.id })
    assert.deepEqual(
      (await assertBodyMatchesYDoc(fx.owner.ctx, root.id, '첫 하위 페이지 뒤')).blocks.map((b) => [b.id, b.type]),
      [[first.id, 'page']],
    )

    const paraId = randomUUID()
    const saved = await savePageBody(fx.owner.ctx, root.id, {
      blocks: [
        { id: first.id, type: 'page', title: [] },
        { id: paraId, type: 'paragraph', title: [textRun('본문')] },
      ],
    })
    assert.ok(saved.ok, JSON.stringify(saved))
    const second = await createPage(fx.owner.ctx, { parentPageId: root.id })
    assert.deepEqual(
      (await assertBodyMatchesYDoc(fx.owner.ctx, root.id, '둘째 하위 페이지 뒤')).blocks.map((b) => b.id),
      [first.id, paraId, second.id],
    )

    const log = await query<{ origin: string; actor_id: string | null }>(
      `SELECT origin, actor_id FROM doc_update WHERE page_id = $1 ORDER BY seq`,
      [root.id],
    )
    assert.deepEqual(log.at(-1), { origin: 'api', actor_id: fx.owner.userId }, '하위 페이지 생성은 서버 명령(api)으로 쌓인다')
    assert.ok(log.some((r) => r.origin === 'editor'), '본문 저장은 editor 로 쌓인다')
  })
})

describe('createPage — 편집기가 준 자리 (F-02-13 · CRDT 6b)', () => {
  const para = (text: string, id: string = randomUUID()): EditorBlock => ({ id, type: 'paragraph', title: text === '' ? [] : [textRun(text)] })
  const rowOf = async (id: string) =>
    (await query<{ parent_id: string; ancestor_path: string[]; order_key: string }>(
      `SELECT parent_id, ancestor_path, order_key FROM block WHERE id = $1`,
      [id],
    ))[0]

  async function parentWith(blocks: EditorBlock[]): Promise<BlockId> {
    const root = await createPage(fx.owner.ctx, { title: titleFromPlainText('부모') })
    const saved = await savePageBody(fx.owner.ctx, root.id, { blocks })
    assert.ok(saved.ok, JSON.stringify(saved))
    return root.id
  }

  test('★ 캐럿이 있던 빈 블록은 참조로 대체하고, 글자가 있는 블록이면 바로 뒤에 넣는다 — 행과 Y.Doc 이 같고 대체한 블록 행은 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const [a, blank, b] = [para('가'), para(''), para('나')]
    const root = await parentWith([a, blank, b])

    const replaced = await createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(blank.id) })
    assert.deepEqual(
      (await assertBodyMatchesYDoc(fx.owner.ctx, root, '빈 블록 자리')).blocks.map((x) => x.id),
      [a.id, replaced.id, b.id],
    )
    assert.equal((await query(`SELECT 1 FROM block WHERE id = $1`, [blank.id])).length, 0, '대체한 빈 블록의 행이 남았다')

    const after = await createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(a.id) })
    assert.deepEqual(
      (await assertBodyMatchesYDoc(fx.owner.ctx, root, '글자 있는 블록 뒤')).blocks.map((x) => x.id),
      [a.id, after.id, replaced.id, b.id],
    )
    assert.equal(after.orderKey, (await rowOf(after.id)).order_key, '돌려준 순서 키가 투영한 행과 다르다')
    assert.deepEqual(
      (await listChildPages(fx.owner.ctx, root)).map((p) => p.id),
      [after.id, replaced.id],
      '하위 페이지 목록이 본문 순서가 아니다',
    )
  })

  test('★ 토글 안의 블록 자리면 하위 페이지의 부모는 그 토글이다 — 돌려준 부모 · 조상도 투영한 자리다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const inner = para('안')
    const toggle: EditorBlock = { id: randomUUID(), type: 'toggle', title: [textRun('토글')], children: [inner] }
    const root = await parentWith([toggle])

    const created = await createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(inner.id) })
    const row = await rowOf(created.id)
    assert.deepEqual([row.parent_id, row.ancestor_path], [toggle.id, [root, toggle.id]])
    assert.deepEqual([created.parentPageId, created.ancestors], [toggle.id, [root, toggle.id]], '돌려준 자리가 투영 전의 자리다')
    const body = await assertBodyMatchesYDoc(fx.owner.ctx, root, '토글 안')
    assert.deepEqual(body.blocks[0].children?.map((x) => x.id), [inner.id, created.id])
  })

  test('★ 그 블록이 부모 본문에 없으면 맨 뒤에 넣는다 — 다른 페이지 본문의 블록이어도 그 본문을 건드리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const a = para('가')
    const root = await parentWith([a])
    const elsewhere = para('다른 페이지')
    const other = await parentWith([elsewhere])
    const otherBefore = await assertBodyMatchesYDoc(fx.owner.ctx, other, '다른 페이지 전')

    const created = await createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(elsewhere.id) })
    assert.deepEqual((await assertBodyMatchesYDoc(fx.owner.ctx, root, '맨 뒤')).blocks.map((x) => x.id), [a.id, created.id])
    assert.deepEqual(await assertBodyMatchesYDoc(fx.owner.ctx, other, '다른 페이지 뒤'), otherBefore)
    const missing = await createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(randomUUID()) })
    assert.deepEqual((await assertBodyMatchesYDoc(fx.owner.ctx, root, '없는 블록')).blocks.map((x) => x.id), [a.id, created.id, missing.id])
  })

  test(`★ 그 자리가 깊이 상한(${MAX_TREE_DEPTH})을 넘기면 too_deep 로 거부하고 아무것도 쓰지 않는다 — 부모 페이지는 얕아도`, async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 토글 99 개 — 가장 안쪽 토글의 자식은 본문 깊이 100 이다. 거기 넣으면 하위 페이지 경로가 [부모, 토글 99 개] 로 상한에 닿는다.
    const deep = para('깊은 곳')
    const ids = Array.from({ length: 99 }, () => randomUUID())
    let chain: EditorBlock = { id: ids[98], type: 'toggle', title: [textRun('t99')], children: [deep] }
    for (let i = 97; i >= 0; i -= 1) chain = { id: ids[i], type: 'toggle', title: [textRun(`t${i + 1}`)], children: [chain] }
    const root = await parentWith([chain])
    const counts = async () =>
      (await query<{ pages: string; log: string }>(
        `SELECT (SELECT count(*) FROM block WHERE workspace_id = $1 AND type = 'page') AS pages,
                (SELECT count(*) FROM doc_update WHERE page_id = $2) AS log`,
        [fx.workspaceId, root],
      ))[0]
    const before = await counts()

    await assert.rejects(
      createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(deep.id) }),
      (e: unknown) => e instanceof PageError && e.code === 'too_deep',
    )
    assert.deepEqual(await counts(), before, '거부한 생성이 페이지 행이나 로그를 남겼다')

    // 한 단 얕은 자리(가장 안쪽 토글 바로 뒤)는 받는다 — 거부가 자리 때문이지 부모 때문이 아니다.
    const shallower = await createPage(fx.owner.ctx, { parentPageId: root, at: asBlockId(ids[98]) })
    assert.equal((await rowOf(shallower.id)).ancestor_path.length, MAX_TREE_DEPTH - 1)
  })
})

describe('getPage', () => {
  test('다른 워크스페이스의 페이지는 id 를 알아도 null 이다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const otherWs = await createBareWorkspace('격리 확인')
    const otherUser = await createUser('격리')
    const other = await joinAs(otherWs, otherUser, 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('비밀') })

    // id 를 정확히 알고 있어도 — uuid 추측 불가능성은 권한이 아니다.
    assert.equal(await getPage(fx.owner.ctx, foreign.id), null)
    // 소유자 쪽에서는 보인다.
    assert.equal((await getPage(other.ctx, foreign.id))?.plainTitle, '비밀')
  })

  test('휴지통에 있는 페이지는 조회되지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')

    const page = await createPage(fx.owner.ctx)
    await query(
      `UPDATE block SET lifecycle='trashed', trashed_at=now(), trashed_by=$2, trash_root_id=id,
                        purge_after = now() + interval '30 days'
        WHERE id = $1`,
      [page.id, fx.owner.userId],
    )
    assert.equal(await getPage(fx.owner.ctx, page.id), null)
  })
})

describe('listChildPages', () => {
  test('order_key 순으로 나오고 본문 블록은 섞이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')

    const root = await createPage(fx.owner.ctx, { title: titleFromPlainText('부모') })
    const a = await createPage(fx.owner.ctx, { parentPageId: root.id, title: titleFromPlainText('가') })
    const b = await createPage(fx.owner.ctx, { parentPageId: root.id, title: titleFromPlainText('나') })

    await query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format,
                          created_by, created_at, last_edited_by, last_edited_at)
       VALUES (gen_random_uuid(), $1, 'paragraph', 'block', $2, $3, $4, $5,
               '{}'::jsonb, '{}'::jsonb, $6, now(), $6, now())`,
      [fx.workspaceId, root.id, orderKeyBetween(null, a.orderKey), [root.id], root.permScopeId, fx.owner.userId],
    )

    const children = await listChildPages(fx.owner.ctx, root.id)
    assert.deepEqual(
      children.map((c) => c.plainTitle),
      ['가', '나'],
    )
    assert.deepEqual(children.map((c) => c.id), [a.id, b.id])
  })

  test('루트 목록은 자식 페이지를 포함하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const ws = await createBareWorkspace('루트 목록')
    const u = await createUser()
    const actor = await joinAs(ws, u, 'owner')

    const root = await createPage(actor.ctx, { title: titleFromPlainText('루트') })
    await createPage(actor.ctx, { parentPageId: root.id, title: titleFromPlainText('자식') })

    const roots = await listChildPages(actor.ctx, null)
    assert.deepEqual(roots.map((p) => p.plainTitle), ['루트'])
  })
})

describe('listAncestors', () => {
  test('ancestor_path 순서를 그대로 지킨다 — IN 조회 결과 순서에 의존하지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const a = await createPage(fx.owner.ctx, { title: titleFromPlainText('A') })
    const b = await createPage(fx.owner.ctx, { parentPageId: a.id, title: titleFromPlainText('B') })
    const c = await createPage(fx.owner.ctx, { parentPageId: b.id, title: titleFromPlainText('C') })
    const d = await createPage(fx.owner.ctx, { parentPageId: c.id, title: titleFromPlainText('D') })

    const detail = await getPage(fx.owner.ctx, d.id)
    assert.ok(detail)
    const chain = await listAncestors(fx.owner.ctx, detail)
    assert.deepEqual(chain.map((p) => p.plainTitle), ['A', 'B', 'C'])
  })

  test('루트 페이지의 조상은 빈 배열이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const root = await createPage(fx.owner.ctx)
    const detail = await getPage(fx.owner.ctx, root.id)
    assert.ok(detail)
    assert.deepEqual(await listAncestors(fx.owner.ctx, detail), [])
  })
})

describe('renamePage', () => {
  test('제목을 바꾸면 version 이 오른다 (X-6)', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const page = await createPage(fx.owner.ctx, { title: titleFromPlainText('전') })
    assert.equal(page.version, '0')

    const renamed = await renamePage(fx.owner.ctx, page.id, titleFromPlainText('후'))
    assert.equal(renamed.plainTitle, '후')
    // version 은 검색 인덱스의 external version 이다. 오르지 않으면 인덱스가 낡는다.
    assert.equal(renamed.version, '1')
  })

  test('다른 워크스페이스의 페이지 이름은 바꿀 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    const otherWs = await createBareWorkspace('개명 격리')
    const otherUser = await createUser()
    const other = await joinAs(otherWs, otherUser, 'owner')
    const foreign = await createPage(other.ctx, { title: titleFromPlainText('원래' ) })

    await assert.rejects(
      () => renamePage(fx.owner.ctx, foreign.id, titleFromPlainText('덮어씀')),
      (e: unknown) => e instanceof PageError && e.code === 'not_found',
    )
    // 실제로 안 바뀌었는지 확인한다. 오류만 던지고 쓰기가 일어났으면 최악이다.
    assert.equal((await getPage(other.ctx, foreign.id))?.plainTitle, '원래')
  })
})

describe('깊이 상한', () => {
  test(`MAX_TREE_DEPTH(${MAX_TREE_DEPTH}) 를 넘으면 명시적으로 거부한다`, async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 100단을 실제로 만든다. 조용히 통과하면 ancestor_path 가 무한히 자란다.
    t.diagnostic(`${MAX_TREE_DEPTH}단 트리를 만든다 — 느리다`)

    const ws = await createBareWorkspace('깊이')
    const u = await createUser()
    const actor = await joinAs(ws, u, 'owner')

    let current = await createPage(actor.ctx, { title: titleFromPlainText('d0') })
    // 루트의 ancestors 는 0개. MAX_TREE_DEPTH-1 개를 더 만들면 마지막 페이지의
    // ancestors 길이가 MAX_TREE_DEPTH-1 이 된다.
    for (let depth = 1; depth < MAX_TREE_DEPTH; depth += 1) {
      current = await createPage(actor.ctx, {
        parentPageId: current.id,
        title: titleFromPlainText(`d${depth}`),
      })
    }
    assert.equal(current.ancestors.length, MAX_TREE_DEPTH - 1)

    await assert.rejects(
      () => createPage(actor.ctx, { parentPageId: current.id }),
      (e: unknown) => e instanceof PageError && e.code === 'too_deep',
    )
  })
})
