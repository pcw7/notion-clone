/**
 * 트랜잭션 헬퍼 — 격리 수준 (DB)
 *
 * `withReadTransaction` 의 머리말은 *"스냅샷 일관성이 필요한 조회에 쓴다"* 다. 그 약속을 **실제로
 * 지키는지** 본다 — 읽기 트랜잭션 안의 두 문장 사이에 다른 커넥션이 커밋해도 두 번째 문장은 첫
 * 문장과 같은 세상을 봐야 한다.
 *
 * 이게 깨지면 권한 목록(`readableScopes`)을 읽은 뒤 행을 읽는 사이에 바뀐 권한이 섞이고, 서브트리를
 * 여러 문장으로 읽는 익스포트는 그 사이 옮겨진 페이지를 두 번 보거나 놓친다(HANDOFF §7).
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createBareWorkspace, probeDatabase } from '../testing/db-fixtures.ts'
import { query } from './pool.ts'
import { withReadTransaction } from './tx.ts'

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
    const { closePool } = await import('./pool.ts')
    await closePool()
  }
})

const COUNT_BY_NAME = `SELECT count(*)::int AS n FROM workspace WHERE name = $1`

test('★ 읽기 트랜잭션의 두 문장은 같은 스냅샷을 본다 — 사이에 다른 커넥션이 커밋한 행이 보이지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const name = `격리-${randomUUID()}`

  const seen = await withReadTransaction(async (tx) => {
    const first = await tx.queryOne<{ n: number }>(COUNT_BY_NAME, [name])
    // 풀의 다른 커넥션에서 커밋된다 — 이 트랜잭션과 무관한 쓰기다.
    await createBareWorkspace(name)
    const second = await tx.queryOne<{ n: number }>(COUNT_BY_NAME, [name])
    return [first.n, second.n]
  })

  assert.deepEqual(seen, [0, 0], '두 번째 문장이 사이에 커밋된 행을 봤다 — 문장마다 스냅샷이 다르다')
  const [outside] = await query<{ n: number }>(COUNT_BY_NAME, [name])
  assert.equal(outside.n, 1, '트랜잭션 밖에서는 보인다 — 커밋은 실제로 됐다')
})

test('읽기 트랜잭션은 쓰기를 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  await assert.rejects(
    withReadTransaction((tx) =>
      tx.query(`INSERT INTO workspace (id, name, region_id, created_at) VALUES (gen_random_uuid(), 'x', 'local', now())`),
    ),
    (e: unknown) => (e as { code?: string }).code === '25006', // read_only_sql_transaction
  )
})
