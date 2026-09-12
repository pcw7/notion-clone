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
  'acl_entry', 'block_acl_meta', 'favorite', 'file', 'recent_visit', 'search_document',
  // W8-a DB 코어 (0013)
  'database', 'data_source', 'database_data_source', 'property', 'select_option',
  'page', 'page_property_value', 'relation_edge',
  'schema_migration', 'scim_token', 'session_policy', 'sso_config',
  'user', 'user_email', 'user_session',
  'workspace', 'workspace_invite', 'workspace_member',
]

/** 파티션은 부모 테이블 하나로 센다. doc_update_p00..p15 를 매번 나열하지 않는다. */
const PARTITION_RE = /^doc_update_p\d+$/
const EXPECTED_TYPES = [
  'block_lifecycle', 'block_parent_type', 'moderation_state', 'origin_kind',
  'user_status', 'user_type',
  // W8-a (0013). 정본 §3.5 가 이 둘을 쓰면서 정의하지 않아 03 문서의 전수표에서 가져왔다.
  'property_type', 'option_color',
]

/**
 * **없어야 하는 컬럼.** 정본의 부정 요구사항을 그대로 옮긴 것이다.
 *
 * "컬럼을 추가하지 않는다"는 규칙은 주석으로 두면 반드시 깨진다 — 편해 보이는
 * 순간이 오기 때문이다. 그 순간 순서나 삭제의 진실이 둘이 된다.
 */
const FORBIDDEN_COLUMNS = [
  // 불변식 R4: 행 순서는 block.order_key, 삭제는 block.lifecycle 이다.
  ['page', 'order_idx'], ['page', 'lifecycle'], ['page', 'deleted_at'],
  // [X-9] 잠금은 node_lock 하나로 통합됐다. 04 문서 DDL 에 남아 있던 컬럼이다.
  ['database', 'is_locked'],
  // 불변식 DS2: is_linked 는 파생값이다.
  ['data_source', 'is_linked'],
  // [X-8] U-3 이 폐기했다. perm_scope_id 가 유일한 권한 축이다.
  ['search_document', 'principals'],
  // [X-7] ancestor_path uuid[] 단일 유지. block.path text 는 폐기됐다.
  ['block', 'path'],
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

  console.log('\n[8] 검색 색인 (0012 / F-07-06)')
  {
    // 이 절이 확인하는 것은 "테이블이 생겼다"가 아니라 **트리거가 실제로 유지하는가**
    // 다. 색인의 권한 축(`perm_scope_id`)을 DB 가 따라가게 만든 것이 0012 의 핵심
    // 설계이고, 그게 동작하지 않으면 검색이 권한을 우회한다.
    const parentId = randomUUID()
    const pageId = randomUUID()
    const bodyId = randomUUID()

    const insertBlock = (id, type, parent, key, scope) =>
      client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format,
                            created_at, last_edited_at)
         VALUES ($1, $2, $3, 'block', $4, $5, '{}', $6, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [id, wsId, type, parent, key, scope],
      )

    await insertBlock(pageId, 'page', parentId, 'a0', pageId)

    // ① 트리거가 페이지 INSERT 에서 행을 만들었는가
    {
      const { rows } = await client.query(
        `SELECT perm_scope_id, in_trash, version, region_id, page_id, parent_id
           FROM search_document WHERE doc_id = $1`,
        [pageId],
      )
      if (rows.length !== 1) fail(`페이지를 만들었는데 색인 행이 ${rows.length}개다`)
      else if (rows[0].perm_scope_id !== pageId) fail('색인의 perm_scope_id 가 block 과 다르다')
      else if (rows[0].in_trash !== false) fail('새 페이지가 in_trash = true 로 색인됐다')
      else if (rows[0].page_id !== pageId) fail('page_id 가 doc_id 와 다르다')
      else if (rows[0].parent_id !== parentId) fail('블록 부모가 parent_id 에 안 들어갔다')
      else ok('페이지 INSERT → 색인 행 1건 (perm_scope_id · parent_id 동기)')
    }

    // ② 본문 블록은 색인 행을 만들지 않는다 (Phase 0 은 페이지 단위)
    await insertBlock(bodyId, 'paragraph', pageId, 'a0', pageId)
    {
      const { rows } = await client.query(`SELECT 1 FROM search_document WHERE doc_id = $1`, [bodyId])
      if (rows.length === 0) ok('본문 블록은 색인 행을 만들지 않는다')
      else fail('본문 블록에 색인 행이 생겼다 — 트리거의 WHEN 조건이 새고 있다')
    }

    // ③ 앱이 텍스트를 쓰고, 그 뒤 메타 변경이 텍스트를 덮지 않는가
    //    F-07-06: "본문 재색인 없이 메타만 partial update 하는 경로가 필요"
    await client.query(
      `UPDATE search_document SET title_text = '제목', body_text = '본문 내용', lang = 'ko'
        WHERE doc_id = $1`,
      [pageId],
    )
    const newScope = randomUUID()
    await insertBlock(newScope, 'page', parentId, 'a5', newScope)
    await client.query(`UPDATE block SET perm_scope_id = $2 WHERE id = $1`, [pageId, newScope])
    {
      const { rows } = await client.query(
        `SELECT title_text, body_text, perm_scope_id FROM search_document WHERE doc_id = $1`,
        [pageId],
      )
      if (rows[0].perm_scope_id !== newScope) fail('perm_scope_id 변경이 색인에 반영되지 않았다')
      else if (rows[0].title_text !== '제목' || rows[0].body_text !== '본문 내용') {
        fail('메타 갱신이 텍스트를 덮었다 — ON CONFLICT 가 텍스트 컬럼을 건드리고 있다')
      } else ok('메타만 갱신되고 title_text · body_text 는 보존된다')
    }

    // ④ tsvector GENERATED 가 제목에 weight A 를 주는가
    {
      const { rows } = await client.query(
        `SELECT tsv::text AS v FROM search_document WHERE doc_id = $1`,
        [pageId],
      )
      if (/'제목':1A/.test(rows[0].v)) ok("tsvector 가 제목에 weight A 를 준다")
      else fail(`tsvector 의 가중치가 기대와 다르다: ${rows[0].v}`)
    }

    // ⑤ 긴 본문이 색인을 깨뜨리지 않는가 — `left()` 가드가 없으면 여기서 죽는다.
    //
    //    tsvector 에는 1MB 한도가 있고 우리 본문 한도는 1MB 다(F-12-16). 자르지
    //    않으면 `string is too long for tsvector` 가 나고, GENERATED 컬럼이라
    //    그 예외가 **저장을 통째로 거부한다** — 색인 때문에 글을 잃는다.
    //
    //    ⚠ 본문은 **전부 서로 다른 토큰**이어야 한다. 같은 글자를 반복한 문자열은
    //      (공백이 없으면) 거대한 토큰 하나가 되어 Postgres 가 lexeme 을 잘라버리고,
    //      tsvector 가 작아져 한도에 닿지 않는다. 반사실로 확인했다 — 반복 문자열을
    //      쓰면 `left()` 를 빼도 이 검사가 통과해 버려 검사가 무의미해진다.
    {
      const toks = []
      for (let i = 0; i < 200_000; i += 1) {
        toks.push(
          String.fromCodePoint(0xac00 + (i % 11172)) +
            String.fromCodePoint(0xac00 + (Math.floor(i / 11172) % 11172)) +
            String.fromCodePoint(0xac00 + (Math.floor(i / 124813584) % 11172)),
        )
      }
      const huge = toks.join(' ') // 고유 토큰 20만개 / 80만 자. 자르지 않으면 한도의 3배가 넘는다
      try {
        await client.query(`UPDATE search_document SET body_text = $2 WHERE doc_id = $1`, [pageId, huge])
        ok('고유 토큰 20만개(80만 자) 본문 색인 성공 — left() 가 tsvector 1MB 한도를 막는다')
      } catch (e) {
        fail(`긴 본문이 색인을 깨뜨린다: ${e.message}`)
      }
      await client.query(`UPDATE search_document SET body_text = '본문 내용' WHERE doc_id = $1`, [pageId])
    }

    // ⑥ 휴지통 전이가 in_trash 로 따라가는가
    await client.query(
      `UPDATE block SET lifecycle='trashed', trashed_at=now(), trash_root_id=id,
                        purge_after = now() + interval '30 days' WHERE id = $1`,
      [pageId],
    )
    {
      const { rows } = await client.query(`SELECT in_trash FROM search_document WHERE doc_id = $1`, [pageId])
      if (rows[0]?.in_trash === true) ok('trashed → in_trash = true')
      else fail('휴지통으로 보냈는데 색인이 in_trash = false 다 — 지운 페이지가 검색된다')
    }

    // ⑦ 영구 삭제는 색인에서 **사라져야** 한다 (유령 결과 금지).
    //    `purged` 는 행이 남는 상태라 FK CASCADE 가 돌지 않는다 — 트리거가 지운다.
    await client.query(
      `UPDATE block SET lifecycle='purged', purged_at=now() WHERE id = $1`,
      [pageId],
    )
    {
      const { rows } = await client.query(`SELECT 1 FROM search_document WHERE doc_id = $1`, [pageId])
      if (rows.length === 0) ok('purged → 색인 행 삭제 (유령 결과 금지)')
      else fail('영구 삭제된 페이지가 색인에 남아 있다')
    }

    // ⑧ 물리 삭제는 CASCADE 로 사라지는가
    await client.query(`DELETE FROM block WHERE id = $1`, [newScope])
    {
      const { rows } = await client.query(`SELECT 1 FROM search_document WHERE doc_id = $1`, [newScope])
      if (rows.length === 0) ok('block 물리 삭제 → 색인 행 CASCADE 삭제')
      else fail('삭제된 블록의 색인 행이 남아 있다')
    }

    // ⑨ 페이지 단위 색인의 불변식이 실제로 거부하는가
    const anyPage = randomUUID()
    await insertBlock(anyPage, 'page', parentId, 'a9', anyPage)
    await mustReject(
      'ck_search_page_scoped: type <> page 인 색인 행',
      `UPDATE search_document SET type = 'paragraph' WHERE doc_id = $1`,
      [anyPage],
    )
    await mustReject(
      'ck_search_page_scoped: page_id <> doc_id',
      `UPDATE search_document SET page_id = $2 WHERE doc_id = $1`,
      [anyPage, parentId],
    )
  }

  console.log('\n[9] DB 코어 (0013 / W8-a §3.5)')
  {
    // 3계층을 실제로 세워 본다. 정상 경로가 통과하지 않으면 아래 거부 검사가
    // 무의미하다 — "막혔다"가 "제약이 동작한다"가 아니라 "설정이 틀렸다"일 수 있다.
    const dbBlockId = randomUUID()
    const dsId = randomUUID()
    const rootId = randomUUID()

    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'd0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [rootId, wsId],
    )
    // DB 컨테이너 블록. `type='database'` 는 블록 타입 레지스트리(애플리케이션)에
    // 아직 없지만, `block.type` 은 text 라 DB 는 받는다 — 레지스트리 추가는 에디터
    // 스키마에 영향이 있어 별도 변경이다.
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'database', 'block', $3, 'd0', $4, $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [dbBlockId, wsId, rootId, [rootId]],
    )
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlockId])
    await client.query(
      `INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at)
       VALUES ($1, $2, '표', now(), now())`,
      [dsId, dbBlockId],
    )
    await client.query(
      `INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`,
      [dbBlockId, dsId],
    )
    ok('3계층 생성 — block(database) → database → data_source → 부착')

    // ── 프로퍼티 ──
    const pid = (n) => `p${String(n).padStart(20, '0')}` // nanoid(21) 자리 흉내
    await client.query(
      `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
       VALUES ($1, $2, '이름', 'title', 'a0', now(), now())`,
      [pid(1), dsId],
    )
    ok('title 프로퍼티 생성')

    // 불변식 P1: 살아있는 title 은 정확히 1개.
    await mustReject(
      'P1: data_source 당 살아있는 title 은 1개뿐',
      `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
       VALUES ($1, $2, '제목2', 'title', 'a1', now(), now())`,
      [pid(2), dsId],
    )
    // P1 의 나머지 절반 — title 은 soft delete 할 수 없다.
    await mustReject(
      'P1: title 프로퍼티는 soft delete 할 수 없다',
      `UPDATE property SET deleted_at = now() WHERE id = $1`,
      [pid(1)],
    )

    await mustReject(
      'C-4: property.id 는 21자여야 한다 (nanoid)',
      `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
       VALUES ('too-short', $1, '짧은id', 'rich_text', 'a2', now(), now())`,
      [dsId],
    )
    await mustReject(
      '모르는 writable 값',
      `INSERT INTO property (id, data_source_id, name, type, order_idx, writable, created_at, updated_at)
       VALUES ($1, $2, '쓰기', 'rich_text', 'a3', 'sometimes', now(), now())`,
      [pid(3), dsId],
    )

    // 이름 UNIQUE — 대소문자는 **구분한다** <V-7>.
    await client.query(
      `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
       VALUES ($1, $2, '상태', 'select', 'a4', now(), now())`,
      [pid(4), dsId],
    )
    await mustReject(
      'V-7: 같은 이름의 살아있는 프로퍼티 두 개',
      `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
       VALUES ($1, $2, '상태', 'rich_text', 'a5', now(), now())`,
      [pid(5), dsId],
    )
    {
      // 대소문자가 다르면 **다른 이름**이다. select_option 과 반대 규칙이다.
      await client.query('SAVEPOINT casecheck')
      try {
        await client.query(
          `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
           VALUES ($1, $2, 'Status', 'rich_text', 'a6', now(), now())`,
          [pid(6), dsId],
        )
        ok('V-7: 대소문자가 다르면 다른 이름이다 (select_option 과 반대)')
        await client.query(`DELETE FROM property WHERE id = $1`, [pid(6)])
      } catch (e) {
        fail(`대소문자가 다른 이름이 막혔다: ${e.message}`)
      }
      await client.query('RELEASE SAVEPOINT casecheck')
    }

    // ★ [정정] 정본의 전체 UNIQUE 를 부분 인덱스로 좁힌 것이 실제로 동작하는가.
    //   이 검사가 없으면 "지운 이름을 다시 쓸 수 없다"는 버그가 조용히 남는다.
    {
      await client.query(`UPDATE property SET deleted_at = now() WHERE id = $1`, [pid(4)])
      await client.query('SAVEPOINT reuse')
      try {
        await client.query(
          `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
           VALUES ($1, $2, '상태', 'select', 'a7', now(), now())`,
          [pid(7), dsId],
        )
        ok('★ 지운 프로퍼티의 이름을 다시 쓸 수 있다 (정본 §3.5 [정정])')
      } catch (e) {
        fail(`지운 이름을 다시 쓸 수 없다 — 부분 UNIQUE 가 동작하지 않는다: ${e.message}`)
      }
      await client.query('RELEASE SAVEPOINT reuse')
    }

    // ── select 옵션: 이름은 대소문자 **무시** 유니크 ──
    await client.query(
      `INSERT INTO select_option (id, property_id, name, color, order_idx)
       VALUES ($1, $2, '진행중', 'blue', 'a0')`,
      [randomUUID(), pid(7)],
    )
    await mustReject(
      '옵션 이름은 대소문자 무시 유니크 (property.name 과 반대)',
      `INSERT INTO select_option (id, property_id, name, color, order_idx)
       VALUES ($1, $2, '진행중', 'red', 'a1')`,
      [randomUUID(), pid(7)],
    )
    await mustReject(
      '모르는 옵션 색 (19색 블록 컬러와 다른 10색 집합이다)',
      `INSERT INTO select_option (id, property_id, name, color, order_idx)
       VALUES ($1, $2, '보라', 'lavender', 'a2')`,
      [randomUUID(), pid(7)],
    )

    // ── ★ 불변식 R3 — 트리거가 실제로 거부하는가 ──
    //
    // CHECK 으로 쓸 수 없는 불변식(다른 표를 본다)이라 트리거로 승격했다.
    // 걸어만 두고 확인하지 않으면 걸지 않은 것과 같다.
    {
      const notDsChild = randomUUID()
      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
         VALUES ($1, $2, 'page', 'block', $3, 'd1', $4, $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [notDsChild, wsId, rootId, [rootId]],
      )
      await mustReject(
        '★ R3: parent_type 이 data_source 가 아닌 블록은 DB 행이 될 수 없다',
        `INSERT INTO page (id, data_source_id) VALUES ($1, $2)`,
        [notDsChild, dsId],
      )

      const paragraphInDs = randomUUID()
      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
         VALUES ($1, $2, 'paragraph', 'data_source', $3, 'd0', $4, $5, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [paragraphInDs, wsId, dsId, [rootId], dbBlockId],
      )
      await mustReject(
        '★ R3: type 이 page 가 아닌 블록은 DB 행이 될 수 없다',
        `INSERT INTO page (id, data_source_id) VALUES ($1, $2)`,
        [paragraphInDs, dsId],
      )
    }

    // ── 정상 행 ──
    const rowId = randomUUID()
    // ⚠ `order_key` 가 'd1' 인 이유: 위 R3 거부 검사가 같은 data_source 아래에
    //   'd0' 짜리 블록을 이미 만들어 뒀다. `UNIQUE (parent_id, order_key)` 가
    //   그것을 잡는다 — 처음에 'd0' 을 줬다가 여기서 걸렸다.
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'data_source', $3, 'd1', $4, $5, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [rowId, wsId, dsId, [rootId], dbBlockId],
    )
    await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [rowId, dsId])
    ok('★ R3: type=page AND parent_type=data_source 인 블록은 DB 행이 된다')

    // `data_source_id` 가 `block.parent_id` 의 파생 캐시라는 것도 트리거가 본다.
    {
      const otherDs = randomUUID()
      await client.query(
        `INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at)
         VALUES ($1, $2, '다른 표', now(), now())`,
        [otherDs, dbBlockId],
      )
      await mustReject(
        '★ R3: page.data_source_id 가 block.parent_id 와 어긋날 수 없다',
        `UPDATE page SET data_source_id = $2 WHERE id = $1`,
        [rowId, otherDs],
      )
    }

    // ── 셀 ──
    await client.query(
      `INSERT INTO page_property_value (page_id, property_id, value, text_value, updated_at)
       VALUES ($1, $2, '[{"type":"text","text":{"content":"첫 행"}}]'::jsonb, '첫 행', now())`,
      [rowId, pid(1)],
    )
    ok('셀 삽입 — value + 사이드카(text_value)')

    await mustReject(
      '같은 (행, 프로퍼티)에 셀 두 개 — 병합 단위가 이 쌍이다 [X-4]',
      `INSERT INTO page_property_value (page_id, property_id, value, updated_at)
       VALUES ($1, $2, '"중복"'::jsonb, now())`,
      [rowId, pid(1)],
    )
    await mustReject(
      '거꾸로 된 기간 — 기간 필터가 조용히 0건이 된다',
      `INSERT INTO page_property_value (page_id, property_id, value, date_start, date_end, updated_at)
       VALUES ($1, $2, '{}'::jsonb, '2026-02-01', '2026-01-01', now())`,
      [rowId, pid(7)],
    )
    await mustReject(
      'date_end 만 있는 값',
      `INSERT INTO page_property_value (page_id, property_id, value, date_end, updated_at)
       VALUES ($1, $2, '{}'::jsonb, '2026-01-01', now())`,
      [rowId, pid(7)],
    )
    await mustReject(
      '모르는 filled_by',
      `INSERT INTO page_property_value (page_id, property_id, value, filled_by, updated_at)
       VALUES ($1, $2, '{}'::jsonb, 'telepathy', now())`,
      [rowId, pid(7)],
    )

    // ── relation_edge 는 자리만 예약했지만 제약은 동작해야 한다 ──
    await mustReject(
      '모르는 relation role',
      `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx, role)
       VALUES ($1, $2, $2, 'a0', 'sibling')`,
      [pid(7), rowId],
    )
    await mustReject(
      '모르는 relation owner — sync 가 사용자 엣지를 지우지 못하게 하는 축이다 (E3)',
      `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx, owner)
       VALUES ($1, $2, $2, 'a0', 'robot')`,
      [pid(7), rowId],
    )

    // ── order_idx 가 이진 순서인가 (0008 과 같은 함정) ──
    {
      // ⚠ `b` 로 시작하는 키를 쓴다. 위에서 만든 옵션이 이미 'a0' 을 점유하고
      //   있어서 `IN ('a0', …)` 가 그 행까지 끌어온다 — 처음에 그렇게 써서
      //   "정렬이 ICU 로 돈다"는 거짓 실패를 봤다. 정렬은 맞았고 단언이 틀렸다.
      for (const [i, k] of ['ba', 'bZ', 'b0'].entries()) {
        await client.query(
          `INSERT INTO select_option (id, property_id, name, color, order_idx)
           VALUES ($1, $2, $3, 'default', $4)`,
          [randomUUID(), pid(7), `옵션${i}`, k],
        )
      }
      const { rows } = await client.query(
        `SELECT order_idx FROM select_option WHERE property_id = $1 AND order_idx IN ('ba','bZ','b0')
          ORDER BY order_idx`,
        [pid(7)],
      )
      const got = rows.map((r) => r.order_idx).join(' ')
      // ICU + ko-KR 로 돌면 'bZ' 가 'ba' 보다 뒤에 온다(마이그레이션 0008 의 그 함정).
      if (got === 'b0 bZ ba') ok('order_idx 가 이진 순서로 비교된다 (b0 bZ ba)')
      else fail(`order_idx 정렬이 ICU 로 돌고 있다: ${got} (b0 bZ ba 여야 한다)`)
    }

    // ── ⑩ 파생 캐시 트리거 (0014 / 불변식 R2) ──
    //
    // "캐시는 트리거로만 갱신된다"는 규칙은 트리거가 실제로 도는지 확인해야
    // 성립한다. 특히 **CASCADE DELETE 도 트리거를 돈다**는 것을 본다 — 안 돌면
    // 프로퍼티를 물리 삭제했을 때 캐시에 유령 키가 남는다.
    {
      // rich_text 컬럼 하나를 더 만든다. 위의 pid(7) 은 **select** 라서 그 셀의
      // text_value 는 옵션 id 이고, 트리거가 타입으로 걸러야 한다 — 두 방향을
      // 모두 보려면 사람이 쓴 텍스트 컬럼이 따로 있어야 한다.
      //
      // ⚠ 처음에 select 셀에 텍스트를 넣고 rich_text 를 기대해서 거짓 실패를 봤다.
      //   트리거는 옳게 걸렀고 단언이 틀렸다.
      await client.query(
        `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
         VALUES ($1, $2, '메모', 'rich_text', 'c0', now(), now())`,
        [pid(8), dsId],
      )
      await client.query(
        `INSERT INTO page_property_value (page_id, property_id, value, text_value, updated_at)
         VALUES ($1, $2, '{"type":"rich_text","rich_text":[]}'::jsonb, '사람이쓴텍스트', now())`,
        [rowId, pid(8)],
      )
      // select 셀에는 옵션 id 모양의 값을 넣는다. 이것이 벡터에 들어가면 안 된다.
      await client.query(
        `INSERT INTO page_property_value (page_id, property_id, value, text_value, updated_at)
         VALUES ($1, $2, '{"type":"select","select":null}'::jsonb, '옵션아이디값', now())`,
        [rowId, pid(7)],
      )
      const read = async () => {
        const { rows } = await client.query(
          `SELECT properties_cache, cache_version, search_tsv::text AS tsv FROM page WHERE id = $1`,
          [rowId],
        )
        return rows[0]
      }

      const after = await read()
      // title(pid 1) · select(pid 7) · rich_text(pid 8) 세 셀이 전부 캐시에 있어야 한다.
      const keys = Object.keys(after.properties_cache)
      if (keys.length === 3) ok('셀을 쓰면 properties_cache 가 따라온다 (R2 · 3개 셀)')
      else fail(`properties_cache 에 ${keys.length}개가 있다: ${JSON.stringify(after.properties_cache)}`)

      if (Number(after.cache_version) > 0) ok(`cache_version 이 오른다 (${after.cache_version})`)
      else fail('cache_version 이 오르지 않았다')

      // ★ 양방향으로 본다: 사람이 쓴 텍스트는 들어가고, select 의 옵션 id 는 안 들어간다.
      const tsv = after.tsv ?? ''
      if (/사람이쓴텍스트/.test(tsv)) ok('search_tsv 에 rich_text 가 들어간다')
      else fail(`search_tsv 에 rich_text 가 없다: ${tsv}`)

      if (!/옵션아이디값/.test(tsv)) {
        ok('★ search_tsv 에 select 의 text_value(옵션 id)가 들어가지 않는다')
      } else {
        fail(`옵션 id 가 검색 벡터에 색인됐다 — 사람이 찾을 수 없는 토큰이다: ${tsv}`)
      }

      // ★ CASCADE 로 셀이 사라져도 캐시가 따라오는가. "CASCADE 는 트리거를 안
      //   돈다"고 착각하기 쉬운 지점이다.
      await client.query(`DELETE FROM property WHERE id = $1`, [pid(8)])
      const purged = await read()
      if (!(pid(8) in purged.properties_cache) && !/사람이쓴텍스트/.test(purged.tsv ?? '')) {
        ok('★ 프로퍼티 물리 삭제 → CASCADE 가 트리거를 돌려 캐시·벡터에서 사라진다')
      } else {
        fail(`프로퍼티를 지웠는데 캐시에 유령이 남았다: ${JSON.stringify(purged.properties_cache)} / ${purged.tsv}`)
      }
    }

    // ── 부정 요구사항 — 없어야 하는 컬럼 ──
    {
      const { rows } = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (table_name, column_name) IN (${FORBIDDEN_COLUMNS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
        FORBIDDEN_COLUMNS.flat(),
      )
      if (rows.length === 0) {
        ok(`부정 요구사항 ${FORBIDDEN_COLUMNS.length}건 — 폐기된 컬럼이 되살아나지 않았다`)
      } else {
        fail(`폐기된 컬럼이 존재한다: ${rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ')}`)
      }
    }
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
