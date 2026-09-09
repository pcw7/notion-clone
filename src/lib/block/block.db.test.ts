/**
 * 블록 트리 스키마 검증 — §3.4 / 판결 C-1 · C-3 · C-9 · C-10 · X-1 · X-3 · X-7
 *
 * 마스터 문서: "01 블록 트리로 들어오는 화살표는 02 워크스페이스뿐이고 나가는
 * 화살표는 8개다. 여기서 스키마를 틀리면 되돌리는 비용이 프로젝트 최대다."
 *
 * 그래서 **"이 컬럼은 존재하지 않는다"는 부정 요구사항까지** 테스트한다.
 * 편해 보인다고 content[] 나 deleted_at 을 나중에 추가하면 판결이 무너지는데,
 * 그건 코드 리뷰로만 막기 어렵다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgresql://notion:notion_dev_only@localhost:5432/notion'
const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let available = false
let skipReason = ''
let pool: typeof import('../db/pool.ts')
let orderKey: typeof import('./order-key.ts')

/** 테스트용 워크스페이스와 사용자. */
let wsId: string
let userId: string

before(async () => {
  try {
    pool = await import('../db/pool.ts')
    orderKey = await import('./order-key.ts')
    await pool.query('SELECT 1')

    const { withTransaction } = await import('../db/tx.ts')
    const emailId = randomUUID()
    userId = randomUUID()
    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,'블록테스트',$2, now())`,
        [userId, emailId],
      )
      await tx.query(
        `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
         VALUES ($1,$2,$3, now(), true, now())`,
        [emailId, userId, `blk-${randomUUID().slice(0, 8)}@example.com`],
      )
    })
    const w = await pool.queryOne<{ id: string }>(
      `INSERT INTO workspace (id, name, region_id, created_at)
       VALUES (gen_random_uuid(), '블록 테스트', 'local', now()) RETURNING id`,
    )
    wsId = w.id
    available = true
  } catch (e) {
    skipReason = `DB 사용 불가: ${(e as Error).message.split('\n')[0]}`
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (available) await pool.closePool().catch(() => {})
})

/**
 * 기본 부모(워크스페이스) 아래에서 쓸 order_key 를 순차로 발급한다.
 *
 * 모든 삽입에 firstOrderKey() 를 쓰면 같은 부모 아래 키가 겹쳐
 * ux_block_sibling_order 에 걸린다 — 실제로 그렇게 7개가 실패했다.
 * 스키마가 옳고 헬퍼가 틀렸던 것이다.
 */
let lastRootKey: string | null = null
function nextRootKey(): string {
  lastRootKey = orderKey.orderKeyBetween(lastRootKey, null)
  return lastRootKey
}

/** 최소 필드로 블록 하나를 넣는다. */
async function insertBlock(over: Record<string, unknown> = {}): Promise<string> {
  const id = (over.id as string) ?? randomUUID()
  const fields = {
    id,
    workspace_id: wsId,
    type: 'paragraph',
    parent_type: 'workspace',
    parent_id: wsId,
    order_key: nextRootKey(),
    perm_scope_id: id,
    created_at: 'now()',
    last_edited_at: 'now()',
    ...over,
  }
  const cols = Object.keys(fields)
  const params: unknown[] = []
  const placeholders = cols.map((c) => {
    const v = fields[c as keyof typeof fields]
    if (v === 'now()') return 'now()'
    params.push(v)
    return `$${params.length}`
  })
  await pool.query(
    `INSERT INTO block (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})`,
    params,
  )
  return id
}

async function mustReject(label: string, fn: () => Promise<unknown>): Promise<void> {
  await assert.rejects(fn, (e: Error & { code?: string }) => {
    assert.ok(e.code, `${label} — DB 제약이 아니라 다른 이유로 실패했다: ${e.message}`)
    return true
  }, `${label} — 거부되어야 하는데 통과했다`)
}

describe('B10 — 존재하지 않아야 하는 컬럼', () => {
  test('is_alive / alive / archived / deleted_at / position / order_idx / path 가 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    const rows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'block' AND table_schema = 'public'`,
    )
    const cols = new Set(rows.map((r) => r.column_name))

    // 판결 C-1 / C-10 / X-7 이 명시적으로 폐기한 컬럼들.
    // 하나라도 있으면 어딘가에서 판결을 되돌린 것이다.
    for (const banned of ['is_alive', 'alive', 'archived', 'deleted_at', 'position', 'order_idx', 'path']) {
      assert.equal(cols.has(banned), false, `${banned} 컬럼이 생겼다 — 판결이 무너졌다`)
    }
  })

  test('B6 — content uuid[] 컬럼이 없다', async (t) => {
    if (!available) return t.skip(skipReason)
    const rows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'block' AND column_name = 'content'`,
    )
    assert.equal(rows.length, 0, '자식 목록은 parent_id 인덱스 + order_key 로 재구성한다')
  })

  test('B8 — space_id 컬럼이 없다', async (t) => {
    if (!available) return t.skip(skipReason)
    const rows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'block' AND column_name = 'space_id'`,
    )
    assert.equal(rows.length, 0, 'teamspace 소속은 ancestor_path 로 해석한다')
  })

  test('B9 — origin 컬럼이 없다', async (t) => {
    if (!available) return t.skip(skipReason)
    const rows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'block' AND column_name = 'origin'`,
    )
    assert.equal(rows.length, 0, '외부 origin 행의 본문 블록은 언제나 native 다')
  })
})

describe('X-3 — lifecycle 은 type=page 블록만의 축', () => {
  test('페이지가 아닌 블록은 trashed 가 될 수 없다', async (t) => {
    if (!available) return t.skip(skipReason)

    await mustReject('paragraph 를 trashed 로', () =>
      insertBlock({
        type: 'paragraph',
        lifecycle: 'trashed',
        trashed_at: new Date(),
        trash_root_id: randomUUID(),
      }),
    )
  })

  test('페이지 블록은 trashed 가 될 수 있다', async (t) => {
    if (!available) return t.skip(skipReason)

    const id = randomUUID()
    await insertBlock({
      id,
      type: 'page',
      lifecycle: 'trashed',
      trashed_at: new Date(),
      trash_root_id: id,
      purge_after: new Date(Date.now() + 30 * 86400_000),
      perm_scope_id: id,
    })
    const [row] = await pool.query<{ lifecycle: string }>(
      `SELECT lifecycle FROM block WHERE id = $1`, [id],
    )
    assert.equal(row.lifecycle, 'trashed')
  })
})

describe('C-1 — lifecycle 과 타임스탬프의 정합성', () => {
  test('live 인데 trashed_at 이 있으면 거부', async (t) => {
    if (!available) return t.skip(skipReason)
    await mustReject('live + trashed_at', () =>
      insertBlock({ type: 'page', lifecycle: 'live', trashed_at: new Date() }),
    )
  })

  test('trashed 인데 trash_root_id 가 없으면 거부', async (t) => {
    if (!available) return t.skip(skipReason)
    // trash_root_id 는 복원 범위의 유일한 근거다(B3). 없으면 복원할 수 없다.
    await mustReject('trashed + trash_root_id 없음', () =>
      insertBlock({ type: 'page', lifecycle: 'trashed', trashed_at: new Date() }),
    )
  })

  test('purged 인데 purged_at 이 없으면 거부', async (t) => {
    if (!available) return t.skip(skipReason)
    const id = randomUUID()
    await mustReject('purged + purged_at 없음', () =>
      insertBlock({
        id, type: 'page', lifecycle: 'purged', trashed_at: new Date(), trash_root_id: id,
      }),
    )
  })

  test('trash_reason 은 정해진 3값만', async (t) => {
    if (!available) return t.skip(skipReason)
    await mustReject('알 수 없는 trash_reason', () =>
      insertBlock({ type: 'page', trash_reason: 'because' }),
    )
  })
})

describe('Private 루트 (ck_private_root)', () => {
  test('owner_user_id 는 parent_type=workspace 일 때만 허용', async (t) => {
    if (!available) return t.skip(skipReason)

    const parent = await insertBlock({ type: 'page' })
    await mustReject('block 부모인데 owner_user_id 설정', () =>
      insertBlock({ parent_type: 'block', parent_id: parent, owner_user_id: userId }),
    )
  })

  test('workspace 부모면 허용', async (t) => {
    if (!available) return t.skip(skipReason)
    const id = await insertBlock({ type: 'page', owner_user_id: userId })
    const [row] = await pool.query<{ owner_user_id: string }>(
      `SELECT owner_user_id FROM block WHERE id = $1`, [id],
    )
    assert.equal(row.owner_user_id, userId)
  })
})

describe('C-10 — 형제 순서', () => {
  test('같은 부모 아래 order_key 중복은 거부한다', async (t) => {
    if (!available) return t.skip(skipReason)

    const parent = await insertBlock({ type: 'page' })
    const key = orderKey.firstOrderKey()
    await insertBlock({ parent_type: 'block', parent_id: parent, order_key: key })
    await mustReject('중복 order_key', () =>
      insertBlock({ parent_type: 'block', parent_id: parent, order_key: key }),
    )
  })

  test('order_key 순으로 자식이 정렬된다', async (t) => {
    if (!available) return t.skip(skipReason)

    const parent = await insertBlock({ type: 'page' })
    // 일부러 뒤죽박죽 순서로 삽입한다
    const keys = orderKey.orderKeysBetween(null, null, 5)
    const shuffled = [keys[3], keys[0], keys[4], keys[1], keys[2]]
    const ids: Record<string, string> = {}
    for (const k of shuffled) {
      ids[k] = await insertBlock({ parent_type: 'block', parent_id: parent, order_key: k })
    }

    const rows = await pool.query<{ id: string; order_key: string }>(
      `SELECT id, order_key FROM live_block
        WHERE parent_id = $1 ORDER BY order_key, id`,
      [parent],
    )
    assert.deepEqual(
      rows.map((r) => r.order_key),
      keys,
      '삽입 순서와 무관하게 order_key 순으로 나와야 한다',
    )
  })
})

describe('live_block 뷰', () => {
  test('trashed 블록은 보이지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const parent = await insertBlock({ type: 'page' })
    const liveId = await insertBlock({
      type: 'page', parent_type: 'block', parent_id: parent,
      order_key: orderKey.firstOrderKey(),
    })
    const trashedId = randomUUID()
    await insertBlock({
      id: trashedId, type: 'page', parent_type: 'block', parent_id: parent,
      order_key: orderKey.orderKeyBetween(null, orderKey.firstOrderKey()),
      lifecycle: 'trashed', trashed_at: new Date(), trash_root_id: trashedId,
      perm_scope_id: trashedId,
    })

    const live = await pool.query<{ id: string }>(
      `SELECT id FROM live_block WHERE parent_id = $1`, [parent],
    )
    const all = await pool.query<{ id: string }>(
      `SELECT id FROM block WHERE parent_id = $1`, [parent],
    )
    assert.equal(live.length, 1)
    assert.equal(live[0].id, liveId)
    assert.equal(all.length, 2, 'B2 — 삭제해도 행은 남고 parent_id 도 그대로다')
  })

  test('B2 — 삭제해도 parent_id 와 order_key 가 바뀌지 않는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const parent = await insertBlock({ type: 'page' })
    const key = orderKey.firstOrderKey()
    const id = await insertBlock({
      type: 'page', parent_type: 'block', parent_id: parent, order_key: key,
    })

    await pool.query(
      `UPDATE block SET lifecycle='trashed', trashed_at=now(), trash_root_id=$1 WHERE id=$1`,
      [id],
    )
    const [row] = await pool.query<{ parent_id: string; order_key: string }>(
      `SELECT parent_id, order_key FROM block WHERE id = $1`, [id],
    )
    assert.equal(row.parent_id, parent, '원위치 복원이 공짜여야 한다')
    assert.equal(row.order_key, key)
  })
})

describe('X-7 — ancestor_path', () => {
  test('GIN 인덱스로 서브트리를 한 번에 찾는다', async (t) => {
    if (!available) return t.skip(skipReason)

    const root = await insertBlock({ type: 'page' })
    const mid = await insertBlock({
      type: 'page', parent_type: 'block', parent_id: root,
      order_key: orderKey.firstOrderKey(), ancestor_path: [root],
    })
    const leaf = await insertBlock({
      type: 'page', parent_type: 'block', parent_id: mid,
      order_key: orderKey.firstOrderKey(), ancestor_path: [root, mid],
    })

    // permission 이 요구하는 "서브트리 일괄 갱신" 형태
    const rows = await pool.query<{ id: string }>(
      `SELECT id FROM block WHERE ancestor_path @> ARRAY[$1]::uuid[]`, [root],
    )
    const ids = rows.map((r) => r.id).sort()
    assert.deepEqual(ids, [mid, leaf].sort(), 'root 의 자손 전부가 나와야 한다')
  })
})
