/**
 * order_key — DB 정렬과 JS 정렬이 같은가
 *
 * 정본: 00-canonical-data-model.md §3.4 불변식 B7, 판결 C-10
 *
 * `order-key.test.ts` 는 fractional index 계산만 본다(DB 없음). 이 파일은
 * **DB 와 JS 가 같은 순서를 보는가**를 본다. 둘이 어긋나면 계산은 옳은데
 * 저장된 결과가 틀린다 — 어느 한쪽만 테스트해서는 절대 잡히지 않는다.
 *
 * 이 파일이 생긴 이유(마이그레이션 0008):
 * DB 는 ICU + ko-KR 로 초기화되는데 fractional index 는 이진 순서를 가정한다.
 * ICU 는 대소문자를 다르게 정렬해서 `max(order_key)` 가 진짜 마지막 형제를
 * 놓치고, 그 뒤에 만든 "새" 키가 이미 존재하는 키가 된다.
 * **실측 임계값은 형제 37개** — 36개까지는 증상이 전혀 없다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createPage } from './page.ts'

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

describe('order_key 정렬 — DB ↔ JS 일치', () => {
  test('형제를 70개 이어 붙여도 충돌하지 않고 순서가 유지된다', async (t) => {
    if (skipReason) return t.skip(skipReason)

    // 70개면 fractional index 가 a0..a9 → aA..aZ → aa..az 를 모두 지나
    // b00.. 구간까지 들어간다. 0008 이전에는 **37번째**에서 터졌다:
    // `aa` 가 생기는 순간 ICU 가 `aZ` 를 max 로 골라 새 키를 다시 `aa` 로 만든다.
    // 36개까지만 만드는 테스트로는 이 버그를 절대 못 잡는다.
    const parent = await createPage(fx.owner.ctx)

    const created: string[] = []
    for (let i = 0; i < 70; i += 1) {
      const child = await createPage(fx.owner.ctx, { parentPageId: parent.id })
      created.push(child.orderKey)
    }

    // ① 키가 전부 다르다
    assert.equal(new Set(created).size, 70, 'order_key 가 중복됐다')

    // ② JS 기준으로 오름차순이다 — 만든 순서와 같아야 한다
    const jsSorted = [...created].sort()
    assert.deepEqual(created, jsSorted, 'JS 정렬 기준으로 생성 순서가 오름차순이 아니다')

    // ③ DB 가 같은 순서를 준다 (여기서 collation 이 어긋나면 잡힌다)
    const { query } = await import('../db/pool.ts')
    const rows = await query<{ order_key: string }>(
      `SELECT order_key FROM block
        WHERE parent_id = $1 AND type = 'page' AND lifecycle = 'live'
        ORDER BY order_key, id`,
      [parent.id],
    )
    assert.deepEqual(
      rows.map((r) => r.order_key),
      created,
      'DB 의 ORDER BY order_key 가 JS 정렬과 다르다 — collation 을 확인하라 (0008)',
    )

    // ④ max(order_key) 도 JS 의 마지막과 같다. 새 형제 키 계산이 여기에 달렸다.
    const maxRow = await query<{ m: string }>(
      `SELECT max(order_key) AS m FROM block WHERE parent_id = $1`,
      [parent.id],
    )
    assert.equal(maxRow[0].m, created[created.length - 1])
  })

  test('대소문자가 섞인 키 구간에서 DB 가 이진 순서를 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { query } = await import('../db/pool.ts')

    // ICU(ko-KR)와 이진 순서가 실제로 갈리는 표본. 0008 이전에는
    // DB 가 `a0 a9 aa aA az aZ z0 Zz` 를 돌려줬다.
    const parent = await createPage(fx.owner.ctx)
    const sample = ['a0', 'a9', 'aA', 'aZ', 'aa', 'az', 'z0', 'Zz']

    for (const key of sample) {
      await query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format,
                            created_by, created_at, last_edited_by, last_edited_at)
         VALUES (gen_random_uuid(), $1, 'paragraph', 'block', $2, $3, $4, $5,
                 '{}'::jsonb, '{}'::jsonb, $6, now(), $6, now())`,
        [fx.workspaceId, parent.id, key, [parent.id], parent.permScopeId, fx.owner.userId],
      )
    }

    const rows = await query<{ order_key: string }>(
      `SELECT order_key FROM block WHERE parent_id = $1 ORDER BY order_key, id`,
      [parent.id],
    )
    assert.deepEqual(rows.map((r) => r.order_key), [...sample].sort())
  })
})
