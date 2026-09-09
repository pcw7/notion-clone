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
import { asBlockId } from '../ids.ts'
import { textRun } from '../contracts/rich-text.ts'
import { orderKeyBetween } from './order-key.ts'

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

    // 같은 부모 아래에 **페이지가 아닌** 본문 블록을 firstChild 뒤에 넣는다.
    // ux_block_sibling_order 는 (parent_id, order_key) 전체에 걸린 UNIQUE 이고
    // type 조건이 없다.
    const bodyKey = orderKeyBetween(firstChild.orderKey, null)
    await query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format,
                          created_by, created_at, last_edited_by, last_edited_at)
       VALUES (gen_random_uuid(), $1, 'paragraph', 'block', $2, $3, $4, $5,
               '{}'::jsonb, '{}'::jsonb, $6, now(), $6, now())`,
      [
        fx.workspaceId,
        root.id,
        bodyKey,
        [root.id],
        root.permScopeId,
        fx.owner.userId,
      ],
    )

    // 이제 자식 페이지를 하나 더 만든다. 본문 블록의 키를 무시하면 여기서 터진다.
    const secondChild = await createPage(fx.owner.ctx, { parentPageId: root.id })
    assert.ok(
      secondChild.orderKey > bodyKey,
      `새 페이지의 order_key(${secondChild.orderKey})가 본문 블록(${bodyKey}) 뒤여야 합니다`,
    )
  })

  test('휴지통에 있는 형제의 order_key 도 점유된 것으로 센다 (B2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')

    const root = await createPage(fx.owner.ctx)
    const doomed = await createPage(fx.owner.ctx, { parentPageId: root.id })

    // B2: 삭제 시 parent_id·order_key 를 절대 변경하지 않는다.
    await query(
      `UPDATE block
          SET lifecycle = 'trashed', trashed_at = now(), trashed_by = $2, trash_root_id = id,
              purge_after = now() + interval '30 days'
        WHERE id = $1`,
      [doomed.id, fx.owner.userId],
    )

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
