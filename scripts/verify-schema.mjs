#!/usr/bin/env node
/**
 * 마이그레이션된 스키마가 정본과 일치하는지, 그리고 불변식이 실제로 막는지 확인한다.
 *
 *   npm run db:verify:schema
 *
 * "테이블이 생겼다"가 아니라 "제약이 실제로 거부하는가"를 본다.
 * CHECK 을 걸어놓고 동작을 확인하지 않으면 걸지 않은 것과 같다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

function loadEnv(file = '.env') {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnv(), ...process.env }
const client = new pg.Client({
  connectionString: env.DATABASE_URL ?? 'postgresql://notion:notion_dev_only@localhost:5432/notion',
  connectionTimeoutMillis: 5000,
})

// 마이그레이션을 추가하면 여기도 함께 갱신한다. 빠뜨리면 그 테이블은
// 누가 지워도 검증이 통과한다 — 0004 의 level_capability 가 실제로 그랬다.
const EXPECTED_TABLES = [
  'auth_event', 'block', 'credential', 'doc_snapshot', 'doc_update',
  'group', 'group_member', 'level_capability',
  'mfa_backup_code', 'mfa_method', 'organization', 'otp_challenge',
  'page_version', 'region',
  'acl_entry', 'block_acl_meta', 'file',
  'schema_migration', 'scim_token', 'session_policy', 'sso_config',
  'user', 'user_email', 'user_session',
  'workspace', 'workspace_invite', 'workspace_member',
]

/** 파티션은 부모 테이블 하나로 센다. doc_update_p00..p15 를 매번 나열하지 않는다. */
const PARTITION_RE = /^doc_update_p\d+$/
const EXPECTED_TYPES = [
  'block_lifecycle', 'block_parent_type', 'moderation_state', 'origin_kind',
  'user_status', 'user_type',
]

let failed = false
const fail = (m) => { failed = true; console.error(`  x ${m}`) }
const ok = (m) => console.log(`  o ${m}`)

/** 이 쿼리는 반드시 실패해야 한다. 성공하면 제약이 없는 것이다. */
async function mustReject(label, sql, params = []) {
  await client.query('SAVEPOINT probe')
  try {
    await client.query(sql, params)
    await client.query('ROLLBACK TO SAVEPOINT probe')
    fail(`${label} — 거부되어야 하는데 통과했다`)
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT probe')
    ok(`${label} — 거부됨 (${e.code})`)
  }
}

try {
  await client.connect()
} catch (e) {
  console.error(`\nPostgres 접속 실패: ${e.message.split('\n')[0]}`)
  console.error('\n컨테이너가 떠 있는지 확인하세요: npm run db:up\n')
  process.exit(1)
}

try {
  console.log('\n[1] 테이블')
  {
    const { rows } = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `)
    const got = new Set(rows.map((r) => r.tablename))
    const missing = EXPECTED_TABLES.filter((t) => !got.has(t))
    const extra = [...got].filter((t) => !EXPECTED_TABLES.includes(t) && !PARTITION_RE.test(t))
    if (missing.length) fail(`누락: ${missing.join(', ')}`)
    else ok(`${EXPECTED_TABLES.length}개 전부 존재`)
    if (extra.length) console.log(`  · 목록 밖: ${extra.join(', ')}`)

    // 파티션 수가 줄면 그 해시 구간의 본문이 저장되지 않는다 — 조용히 실패한다.
    const parts = [...got].filter((t) => PARTITION_RE.test(t))
    if (parts.length === 16) ok('doc_update 해시 파티션 16개')
    else fail(`doc_update 파티션이 ${parts.length}개다 (16개여야 함)`)
  }

  console.log('\n[2] ENUM 타입')
  {
    const { rows } = await client.query(`
      SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname
    `)
    const got = new Set(rows.map((r) => r.typname))
    const missing = EXPECTED_TYPES.filter((t) => !got.has(t))
    if (missing.length) fail(`누락: ${missing.join(', ')}`)
    else ok(`${EXPECTED_TYPES.length}개 전부 존재`)
  }

  console.log('\n[3] 뷰')
  for (const view of ['workspace_seat_count', 'live_block']) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_views WHERE schemaname = 'public' AND viewname = $1`,
      [view],
    )
    if (rows[0].n === 1) ok(view)
    else fail(`${view} 없음`)
  }

  console.log('\n[4] 불변식이 실제로 막는가')
  await client.query('BEGIN')

  const orgId = randomUUID()
  const wsId = randomUUID()
  const userId = randomUUID()
  const emailId = randomUUID()

  // 정상 경로가 먼저 통과해야 한다. 안 되면 아래 거부 테스트는 의미가 없다.
  await client.query(
    `INSERT INTO organization (id, name, created_at) VALUES ($1,'테스트조직', now())`, [orgId],
  )
  await client.query(
    `INSERT INTO workspace (id, name, region_id, created_at) VALUES ($1,'테스트',$2, now())`,
    [wsId, 'local'],
  )
  ok('workspace 생성 (region_id=local)')

  // user + user_email 을 같은 트랜잭션에서 — 순환 FK 가 DEFERRABLE 이어야 통과한다
  await client.query(
    `INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,'홍길동',$2, now())`,
    [userId, emailId],
  )
  await client.query(
    `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
     VALUES ($1,$2,'Test@Example.COM', now(), true, now())`,
    [emailId, userId],
  )
  ok('user + user_email 순환 FK — DEFERRABLE 로 같은 트랜잭션에서 삽입 성공')

  // citext: 대소문자 무시 조회
  {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM user_email WHERE email = 'test@example.com'`,
    )
    if (rows[0].n === 1) ok('citext — 대소문자 무시 조회 동작')
    else fail('citext 조회 실패')
  }

  await mustReject(
    'A2 미인증 이메일을 primary 로',
    `INSERT INTO user_email (id, user_id, email, is_primary, added_at)
     VALUES ($1,$2,'unverified@example.com', true, now())`,
    [randomUUID(), userId],
  )

  await mustReject(
    'A1 primary 이메일 2개',
    `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
     VALUES ($1,$2,'second@example.com', now(), true, now())`,
    [randomUUID(), userId],
  )

  await mustReject(
    '전역 이메일 중복',
    `INSERT INTO user_email (id, user_id, email, added_at)
     VALUES ($1,$2,'TEST@example.com', now())`,
    [randomUUID(), userId],
  )

  await mustReject(
    'U3 is_managed 인데 org 없음',
    `INSERT INTO "user" (id, name, is_managed, created_at) VALUES ($1,'관리자계정', true, now())`,
    [randomUUID()],
  )

  await mustReject(
    'workspace.trash_days 범위 밖(0)',
    `INSERT INTO workspace (id, name, region_id, trash_days, created_at)
     VALUES ($1,'나쁜값','local', 0, now())`,
    [randomUUID()],
  )

  await mustReject(
    '없는 region 참조',
    `INSERT INTO workspace (id, name, region_id, created_at) VALUES ($1,'유령','mars', now())`,
    [randomUUID()],
  )

  await mustReject(
    'C-14 is_temporary 인데 expires_at 없음',
    `INSERT INTO workspace_member (workspace_id, user_id, role, is_temporary, status)
     VALUES ($1,$2,'member', true, 'active')`,
    [wsId, userId],
  )

  await mustReject(
    'C-14 is_temporary 인데 role<>member',
    `INSERT INTO workspace_member (workspace_id, user_id, role, is_temporary, expires_at, status)
     VALUES ($1,$2,'owner', true, now() + interval '1 day', 'active')`,
    [wsId, userId],
  )

  await mustReject(
    '초대 kind=email 인데 email 없음',
    `INSERT INTO workspace_invite (id, workspace_id, kind, role, created_by, created_at)
     VALUES ($1,$2,'email','member',$3, now())`,
    [randomUUID(), wsId, userId],
  )

  // ── file (0009 / 정본 §3.10) ───────────────────────────────────────
  const fileRow = (extra = {}) => {
    const row = {
      id: randomUUID(), workspace_id: wsId, region_id: 'local',
      storage_key: `probe/${randomUUID()}`, mime: 'image/png', size_bytes: 10,
      original_name: 'a.png', ref_count: 0, ...extra,
    }
    return [row.id, row.workspace_id, row.region_id, row.storage_key, row.mime,
            row.size_bytes, row.original_name, row.ref_count]
  }
  const insertFile = `INSERT INTO file (id, workspace_id, region_id, storage_key, mime,
                        size_bytes, original_name, ref_count, created_at)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`

  await mustReject('FS1 ref_count 음수', insertFile, fileRow({ ref_count: -1 }))
  await mustReject('file size_bytes 음수', insertFile, fileRow({ size_bytes: -1 }))
  await mustReject('file storage_key 빈 문자열', insertFile, fileRow({ storage_key: '' }))
  await mustReject(
    'F-12-09 파일명 900바이트 초과 (글자 수가 아니라 바이트)',
    insertFile,
    // 한글은 글자당 3바이트다. 301자 = 903바이트 — 글자 수로 세면 통과해 버린다.
    fileRow({ original_name: '가'.repeat(301) }),
  )
  await mustReject('file 없는 region 참조', insertFile, fileRow({ region_id: 'nowhere-1' }))

  const dupKey = `probe/${randomUUID()}`
  await client.query(insertFile, fileRow({ storage_key: dupKey }))
  await mustReject('같은 storage_key 두 번 — 덮어썼다는 뜻이다', insertFile, fileRow({ storage_key: dupKey }))

  // ── ACL (W6-b) ──────────────────────────────────────────────────────
  //
  // 권한은 틀려도 조용하다 — 화면이 깨지지 않고, 그냥 보이면 안 될 것이 보인다.
  // 그래서 표현 가능한 규칙은 전부 CHECK 으로 올리고 여기서 거부를 확인한다.
  const aclRow = (extra = {}) => {
    const row = {
      id: randomUUID(), node_kind: 'block', node_id: randomUUID(),
      principal_type: 'workspace_everyone', principal_id: null,
      level: 'full_access', hidden_from_search: false, ...extra,
    }
    return [row.id, row.node_kind, row.node_id, row.principal_type, row.principal_id,
            row.level, row.hidden_from_search]
  }
  const insertAcl = `INSERT INTO acl_entry (id, node_kind, node_id, principal_type,
                       principal_id, level, hidden_from_search)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`

  await mustReject('A1: level=none 행은 존재하지 않는다', insertAcl, aclRow({ level: 'none' }))
  await mustReject(
    "주체가 'user' 인데 id 가 없다 — '아무 사용자나'가 되어 버린다",
    insertAcl,
    aclRow({ principal_type: 'user', principal_id: null }),
  )
  await mustReject(
    "주체가 'workspace_everyone' 인데 id 가 있다",
    insertAcl,
    aclRow({ principal_type: 'workspace_everyone', principal_id: randomUUID() }),
  )
  await mustReject(
    'hidden_from_search 는 workspace_everyone 에만 의미가 있다',
    insertAcl,
    aclRow({ principal_type: 'user', principal_id: randomUUID(), hidden_from_search: true }),
  )
  await mustReject('모르는 node_kind', insertAcl, aclRow({ node_kind: 'database' }))
  {
    const nodeId = randomUUID()
    await client.query(insertAcl, aclRow({ node_id: nodeId }))
    await mustReject(
      '같은 주체에게 두 번 부여 — 레벨 변경은 UPDATE 다',
      insertAcl,
      aclRow({ node_id: nodeId }),
    )
  }

  // P1: 절단된 노드는 머티리얼라이즈 시각이 있어야 한다. 플래그만 내리면
  //     "1명 제거"가 "전원 상실"이 된다.
  {
    const nodeId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format,
                          created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'a0', '{}', $1,
               '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [nodeId, wsId],
    )
    await mustReject(
      'P1: 상속을 끊었는데 머티리얼라이즈 시각이 없다',
      `INSERT INTO block_acl_meta (node_id, inherits_from_parent, materialized_at)
       VALUES ($1, false, NULL)`,
      [nodeId],
    )
  }

  console.log('\n[5] 좌석 계산 (M2 / M3)')
  {
    // owner 1(활성) + guest 1(활성) + temporary 1(활성) + invited 1 => 좌석은 owner 1개만
    const u = async (name) => {
      const id = randomUUID()
      const eid = randomUUID()
      await client.query(
        `INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,$2,$3, now())`,
        [id, name, eid],
      )
      await client.query(
        `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
         VALUES ($1,$2,$3, now(), true, now())`,
        [eid, id, `${name}@example.com`],
      )
      return id
    }
    const owner = userId
    const guest = await u('guest1')
    const temp = await u('temp1')
    const invited = await u('invited1')

    await client.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1,$2,'owner','active')`,
      [wsId, owner],
    )
    await client.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1,$2,'guest','active')`,
      [wsId, guest],
    )
    await client.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, is_temporary, expires_at, status)
       VALUES ($1,$2,'member', true, now() + interval '30 days', 'active')`,
      [wsId, temp],
    )
    await client.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1,$2,'member','invited')`,
      [wsId, invited],
    )

    const { rows } = await client.query(
      'SELECT seats FROM workspace_seat_count WHERE workspace_id = $1', [wsId],
    )
    const seats = rows[0]?.seats ?? 0
    if (Number(seats) === 1) ok('멤버 4명(owner/guest/temp/invited) → 좌석 1 (guest·temp·invited 미소비)')
    else fail(`좌석 계산이 ${seats} — 1이어야 한다`)
  }

  console.log('\n[6] order_key 가 이진 순서로 비교되는가 (0008)')
  {
    // fractional-indexing 은 키를 `0-9 A-Z a-z` 의 이진 순서로 비교한다고 가정한다.
    // DB 기본 collation(ICU ko-KR)은 대소문자를 다르게 정렬하므로,
    // 그대로 두면 max(order_key) 가 진짜 마지막 형제를 놓치고 그 뒤에 만든 새 키가
    // 이미 존재하는 키가 되어 UNIQUE 에 걸린다. 실측 임계값은 형제 37개다.
    //
    // "COLLATE C 를 걸었다"가 아니라 "실제로 이진 순서로 나오는가"를 확인한다.
    const parentId = randomUUID()
    const sample = ['a0', 'a9', 'aA', 'aZ', 'aa', 'az', 'z0', 'Zz']
    for (const key of sample) {
      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format,
                            created_at, last_edited_at)
         VALUES (gen_random_uuid(), $1, 'paragraph', 'block', $2, $3, '{}', $2,
                 '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [wsId, parentId, key],
      )
    }

    const { rows } = await client.query(
      'SELECT order_key FROM block WHERE parent_id = $1 ORDER BY order_key, id',
      [parentId],
    )
    const got = rows.map((r) => r.order_key).join(' ')
    // JS 의 문자열 비교는 UTF-16 코드 유닛 비교 = 이 문자 집합에서는 이진 순서다.
    const want = [...sample].sort().join(' ')
    if (got === want) ok(`ORDER BY order_key 가 이진 순서다 (${got})`)
    else fail(`ORDER BY order_key 가 이진 순서가 아니다\n      DB: ${got}\n      JS: ${want}`)

    const { rows: maxRows } = await client.query(
      'SELECT max(order_key) AS m FROM block WHERE parent_id = $1',
      [parentId],
    )
    const wantMax = [...sample].sort().at(-1)
    if (maxRows[0].m === wantMax) ok(`max(order_key) = ${wantMax}`)
    else fail(`max(order_key) 가 ${maxRows[0].m} — ${wantMax} 여야 한다. 새 형제 키가 기존 키와 충돌한다`)
  }

  console.log('\n[7] live_block 뷰가 실제로 걸러내는가')
  {
    // 정본 §3.4: "모든 일반 조회는 이 뷰만 본다. 개별 쿼리에서 lifecycle 조건을
    // 빼먹는 것이 1순위 버그다." 뷰가 있다는 것만으로는 부족하고 **걸러내는지**를 본다.
    const parentId = randomUUID()
    const ids = { live: randomUUID(), trashed: randomUUID(), purged: randomUUID() }

    const insert = (id, key) =>
      client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format,
                            created_at, last_edited_at)
         VALUES ($1, $2, 'page', 'block', $3, $4, '{}', $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [id, wsId, parentId, key],
      )

    await insert(ids.live, 'a0')
    await insert(ids.trashed, 'a1')
    await insert(ids.purged, 'a2')

    await client.query(
      `UPDATE block SET lifecycle='trashed', trashed_at=now(), trash_root_id=id,
                        purge_after = now() + interval '30 days'
        WHERE id = $1`,
      [ids.trashed],
    )
    await client.query(
      `UPDATE block SET lifecycle='purged', trashed_at=now(), trash_root_id=id, purged_at=now()
        WHERE id = $1`,
      [ids.purged],
    )

    const { rows } = await client.query(
      `SELECT id FROM live_block WHERE parent_id = $1 ORDER BY order_key`,
      [parentId],
    )
    const got = rows.map((r) => r.id)
    if (got.length === 1 && got[0] === ids.live) ok('live 만 보인다 (trashed · purged 제외)')
    else fail(`live_block 이 ${got.length}행을 돌려줬다 — trashed/purged 가 새고 있다`)

    // 같은 조건으로 block 을 직접 조회하면 3행이다. 뷰가 하는 일이 이것뿐이라는 확인.
    const { rows: all } = await client.query(`SELECT id FROM block WHERE parent_id = $1`, [parentId])
    if (all.length === 3) ok('block 직접 조회는 3행 — 뷰만이 필터를 건다')
    else fail(`block 직접 조회가 ${all.length}행이다 (3행이어야 한다)`)
  }

  await client.query('ROLLBACK')
  console.log('\n  · 검증 데이터는 롤백됨 (DB 는 깨끗한 상태)')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  fail(`검증 중 오류: ${e.message}`)
} finally {
  await client.end()
}

console.log('')
if (failed) {
  console.error('스키마 검증 실패.\n')
  process.exit(1)
}
console.log('스키마 검증 통과 — 정본대로 반영되었고 불변식이 실제로 거부한다.\n')
