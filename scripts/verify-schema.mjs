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
  // W8-b 뷰 (0015)
  'view', 'view_property', 'filter_operator',
  // 코멘트 1조각 (0018)
  'discussion', 'comment', 'reaction',
  // 코멘트 3조각 — 활동 · 구독 · 알림 (0020)
  'activity_event', 'subscription', 'notification',
  // 코멘트 5a조각 — 멘션의 역인덱스 (0021)
  'link_edge',
  // 보드 4a조각 — 뷰별 · 그룹별 수동 순서 (0022)
  'row_position',
  // 보드 4c-1조각 — status 의 세 범주 (0023)
  'status_group',
  'schema_migration', 'scim_token', 'session_policy', 'sso_config',
  'user', 'user_email', 'user_session',
  'workspace', 'workspace_invite', 'workspace_member',
]

/** 파티션은 부모 테이블 하나로 센다. doc_update_p00..p15 · activity_event_YYYY 를 매번 나열하지 않는다. */
const PARTITION_RE = /^(doc_update_p\d+|activity_event_(\d{4}|default))$/
const EXPECTED_TYPES = [
  'block_lifecycle', 'block_parent_type', 'moderation_state', 'origin_kind',
  'user_status', 'user_type',
  // W8-a (0013). 정본 §3.5 가 이 둘을 쓰면서 정의하지 않아 03 문서의 전수표에서 가져왔다.
  'property_type', 'option_color',
  // 보드 4c-1 (0023)
  'status_group_kind',
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
  // 불변식 V2: 고정은 열별 boolean 이 아니라 경계 포인터 하나다
  // (view.frozen_upto_property_id). boolean 이면 "3번째와 5번째만 고정" 같은
  // 표현 불가능한 상태를 만들 수 있다.
  ['view_property', 'frozen'],
  // F-03-17 은 `(property_type, operator) → sql_template` 을 권했지만 SQL 을 DB 에
  // 두지 않는다 — 같은 절이 "절대 문자열 연결로 SQL 을 만들지 말라"고도 경고한다.
  // SQL 조각은 filter.ts 의 화이트리스트 맵이고 일치는 filter.db.test.ts 가 본다.
  ['filter_operator', 'sql_template'],
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
    const parts = [...got].filter((t) => /^doc_update_p\d+$/.test(t))
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

    // ── ⑪ 뷰 (0015 / W8-b §3.6) ──
    {
      const viewId = randomUUID()
      await client.query(
        `INSERT INTO view (id, database_id, data_source_id, type, order_idx, configuration,
                           created_at, updated_at)
         VALUES ($1, $2, $3, 'table', 'a0', '{}'::jsonb, now(), now())`,
        [viewId, dbBlockId, dsId],
      )
      ok('뷰 생성 (table)')

      await mustReject(
        '모르는 owner_kind',
        `INSERT INTO view (id, database_id, data_source_id, owner_kind, type, order_idx,
                           configuration, created_at, updated_at)
         VALUES ($1, $2, $3, 'sidebar', 'table', 'a1', '{}'::jsonb, now(), now())`,
        [randomUUID(), dbBlockId, dsId],
      )
      await mustReject(
        '모르는 open_pages_in',
        `INSERT INTO view (id, database_id, data_source_id, type, order_idx, open_pages_in,
                           configuration, created_at, updated_at)
         VALUES ($1, $2, $3, 'table', 'a2', 'new_window', '{}'::jsonb, now(), now())`,
        [randomUUID(), dbBlockId, dsId],
      )
      // ★ DB 뷰인데 data_source 가 없으면 어떤 행을 보여줄지 알 수 없다.
      await mustReject(
        'database_view 인데 data_source 가 없다',
        `INSERT INTO view (id, database_id, type, order_idx, configuration, created_at, updated_at)
         VALUES ($1, $2, 'table', 'a3', '{}'::jsonb, now(), now())`,
        [randomUUID(), dbBlockId],
      )
      await mustReject(
        'load_limit 범위 밖',
        `INSERT INTO view (id, database_id, data_source_id, type, order_idx, load_limit,
                           configuration, created_at, updated_at)
         VALUES ($1, $2, $3, 'table', 'a4', 0, '{}'::jsonb, now(), now())`,
        [randomUUID(), dbBlockId, dsId],
      )

      // ── view_property ──
      await client.query(
        `INSERT INTO view_property (view_id, property_id, visible, order_idx)
         VALUES ($1, $2, true, 'a0')`,
        [viewId, pid(1)],
      )
      ok('view_property 생성')
      await mustReject(
        '같은 (뷰, 프로퍼티)에 두 행 — 순서 변경은 단일 행 UPDATE 다 (V1)',
        `INSERT INTO view_property (view_id, property_id, order_idx) VALUES ($1, $2, 'a1')`,
        [viewId, pid(1)],
      )
      await mustReject(
        '폭이 0 이하',
        `INSERT INTO view_property (view_id, property_id, order_idx, width)
         VALUES ($1, $2, 'a5', 0)`,
        [viewId, pid(4)],
      )

      // ★ 불변식 V2 의 경계 포인터가 실제로 프로퍼티를 가리킨다.
      await client.query(`UPDATE view SET frozen_upto_property_id = $2 WHERE id = $1`, [
        viewId,
        pid(1),
      ])
      ok('frozen 은 경계 포인터 하나다 (V2 — 열별 boolean 이 아니다)')

      // 뷰가 사라지면 view_property 도 사라진다 — 유령 설정이 남지 않는다.
      await client.query(`DELETE FROM view WHERE id = $1`, [viewId])
      {
        const { rows } = await client.query(
          `SELECT 1 FROM view_property WHERE view_id = $1`,
          [viewId],
        )
        if (rows.length === 0) ok('뷰 삭제 → view_property CASCADE 삭제')
        else fail('뷰를 지웠는데 view_property 가 남았다')
      }
    }

    // ── ⑫ 연산자 카탈로그 (0015 / F-03-17) ──
    {
      const { rows } = await client.query(
        `SELECT property_type::text AS t, count(*)::int AS n
           FROM filter_operator GROUP BY property_type ORDER BY property_type`,
      )
      const byType = new Map(rows.map((r) => [r.t, r.n]))
      // MVP 6종이 시딩됐는가. TS 맵과의 일치는 filter.db.test.ts 가 본다.
      const expected = { title: 8, rich_text: 8, number: 8, select: 4, checkbox: 2, date: 7 }
      const wrong = Object.entries(expected).filter(([t, n]) => byType.get(t) !== n)
      if (wrong.length === 0) ok(`연산자 카탈로그 6종 시딩 (${rows.reduce((a, r) => a + r.n, 0)}행)`)
      else fail(`카탈로그 개수가 다르다: ${wrong.map(([t, n]) => `${t} ${byType.get(t)}≠${n}`).join(', ')}`)

      await mustReject(
        'arity 는 0 또는 1 뿐이다',
        `INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx)
         VALUES ('number', 'between', 2, '사이', 9)`,
      )
      await mustReject(
        '같은 (타입, 연산자)를 두 번',
        `INSERT INTO filter_operator (property_type, operator, arity, label_ko, order_idx)
         VALUES ('number', 'equals', 1, '중복', 9)`,
      )
    }

    // ── ⑬ row_position · view.type (0022 / §3.6 · 보드 4a조각) ──
    {
      const viewId = randomUUID()
      const boardRow = randomUUID()
      await client.query(
        `INSERT INTO view (id, database_id, data_source_id, type, order_idx, group_by, configuration,
                           created_at, updated_at)
         VALUES ($1, $2, $3, 'board', 'b0', '{"property_id": "p1"}'::jsonb, '{}'::jsonb, now(), now())`,
        [viewId, dbBlockId, dsId],
      )
      ok('뷰 생성 (board · group_by jsonb)')
      await mustReject(
        '정본에 없는 뷰 타입 (ck_view_type — 0022 가 승격)',
        `INSERT INTO view (id, database_id, data_source_id, type, order_idx, configuration, created_at, updated_at)
         VALUES ($1, $2, $3, 'kanban', 'b1', '{}'::jsonb, now(), now())`,
        [randomUUID(), dbBlockId, dsId],
      )

      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
         VALUES ($1, $2, 'page', 'data_source', $3, 'z0', $4, $5, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [boardRow, wsId, dsId, [rootId, dbBlockId], dbBlockId],
      )
      await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [boardRow, dsId])

      // 빈 값 그룹은 '' 다 — DEFAULT 가 그 자리를 준다.
      await client.query(`INSERT INTO row_position (view_id, row_id, order_idx) VALUES ($1, $2, 'a0')`, [viewId, boardRow])
      await client.query(
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, 'a0')`,
        [viewId, randomUUID(), boardRow],
      )
      {
        const { rows } = await client.query(`SELECT group_key FROM row_position WHERE view_id = $1 ORDER BY group_key`, [viewId])
        if (rows.length === 2 && rows[0].group_key === '') ok("row_position 생성 — group_key 기본값 '' · 같은 행이 다른 그룹에 자리를 가질 수 있다(PK 가 그룹을 포함)")
        else fail(`row_position 이 예상과 다르다: ${JSON.stringify(rows)}`)
      }
      await mustReject(
        '같은 (뷰, 그룹, 행)에 두 자리',
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, '', $2, 'a1')`,
        [viewId, boardRow],
      )
      await mustReject(
        '빈 order_idx',
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, 'g', $2, '')`,
        [viewId, boardRow],
      )
      await mustReject(
        '없는 뷰 (FK)',
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, '', $2, 'a0')`,
        [randomUUID(), boardRow],
      )
      await mustReject(
        '행이 아닌 것 (FK → page — 일반 페이지 · 아무 uuid 는 자리를 가질 수 없다)',
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, '', $2, 'a0')`,
        [viewId, randomUUID()],
      )
      {
        const { rows } = await client.query(
          `SELECT collation_name FROM information_schema.columns
            WHERE table_name = 'row_position' AND column_name = 'order_idx'`,
        )
        if (rows[0]?.collation_name === 'C') ok('row_position.order_idx 는 COLLATE "C" (fractional index 는 이진 순서)')
        else fail(`row_position.order_idx collation: ${rows[0]?.collation_name}`)
      }

      // 뷰가 사라지면 자리도 사라진다 · 행이 사라져도 사라진다.
      await client.query(`DELETE FROM view WHERE id = $1`, [viewId])
      {
        const { rows } = await client.query(`SELECT 1 FROM row_position WHERE view_id = $1`, [viewId])
        if (rows.length === 0) ok('뷰 삭제 → row_position CASCADE 삭제')
        else fail('뷰를 지웠는데 row_position 이 남았다')
      }
    }

    // ── ⑭ status_group (0023 / §3.5 [보강] · 보드 4c-1조각) ──
    // 불변식 SG1~SG4. status 는 "그룹이 강제되는 select" 다 — 그 강제를 DB 가 실제로 하는지 본다.
    {
      const statusProp = pid(91)
      const otherStatus = pid(92)
      const selectProp = pid(93)
      for (const [id, name, type, key] of [
        [statusProp, '진행 상태', 'status', 'm1'],
        [otherStatus, '검수 상태', 'status', 'm2'],
        [selectProp, '분류', 'select', 'm3'],
      ]) {
        await client.query(
          `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at)
           VALUES ($1, $2, $3, $4::property_type, $5, now(), now())`,
          [id, dsId, name, type, key],
        )
      }
      const todo = randomUUID()
      const otherTodo = randomUUID()
      await client.query(`INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, 'todo')`, [todo, statusProp])
      await client.query(`INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, 'complete')`, [randomUUID(), statusProp])
      await client.query(`INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, 'todo')`, [otherTodo, otherStatus])
      ok('status_group 생성 (프로퍼티마다 kind 별로)')

      await mustReject(
        'SG1: 같은 (프로퍼티, kind) 의 그룹 두 개',
        `INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, 'todo')`,
        [randomUUID(), statusProp],
      )
      await mustReject(
        '모르는 kind (세 범주는 고정이다 — ENUM)',
        `INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, 'blocked')`,
        [randomUUID(), statusProp],
      )
      await mustReject(
        'SG4: status 가 아닌 프로퍼티에 그룹',
        `INSERT INTO status_group (id, property_id, kind) VALUES ($1, $2, 'todo')`,
        [randomUUID(), selectProp],
      )

      await client.query(
        `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx)
         VALUES ($1, $2, '시작 전', 'gray', $3, 'a0')`,
        [randomUUID(), statusProp, todo],
      )
      ok('status 옵션 생성 (그룹과 함께)')
      await mustReject(
        'SG3: 그룹 없는 status 옵션',
        `INSERT INTO select_option (id, property_id, name, color, order_idx) VALUES ($1, $2, '그룹 없음', 'gray', 'a1')`,
        [randomUUID(), statusProp],
      )
      await mustReject(
        'SG3: 그룹을 가진 select 옵션',
        `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx)
         VALUES ($1, $2, '그룹 있음', 'gray', $3, 'a0')`,
        [randomUUID(), selectProp, todo],
      )
      await mustReject(
        'SG2: **남의 프로퍼티의** 그룹을 가리키는 옵션 (복합 FK — 단일 FK 로는 못 막는다)',
        `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx)
         VALUES ($1, $2, '남의 그룹', 'gray', $3, 'a2')`,
        [randomUUID(), statusProp, otherTodo],
      )
      await mustReject(
        'SG2: 없는 그룹',
        `INSERT INTO select_option (id, property_id, name, color, group_id, order_idx)
         VALUES ($1, $2, '없는 그룹', 'gray', $3, 'a3')`,
        [randomUUID(), statusProp, randomUUID()],
      )
      await mustReject(
        'SG3: 있던 status 옵션의 그룹을 NULL 로',
        `UPDATE select_option SET group_id = NULL WHERE property_id = $1`,
        [statusProp],
      )

      {
        const { rows } = await client.query(
          `SELECT operator FROM filter_operator WHERE property_type = 'status' ORDER BY order_idx`,
        )
        const got = rows.map((r) => r.operator).join(',')
        if (got === 'equals,does_not_equal,is_empty,is_not_empty') ok('status 의 필터 연산자 넷이 시딩됐다 (select 와 같다)')
        else fail(`status 연산자: ${got}`)
      }

      // 프로퍼티가 사라지면 그룹 · 옵션이 함께 사라진다(둘 다 property 를 CASCADE 로 가리킨다 · 복합 FK 가 막지 않는다).
      await client.query(`DELETE FROM property WHERE id = $1`, [statusProp])
      {
        const { rows } = await client.query(
          `SELECT (SELECT count(*) FROM status_group WHERE property_id = $1)::int AS groups,
                  (SELECT count(*) FROM select_option WHERE property_id = $1)::int AS options`,
          [statusProp],
        )
        if (rows[0].groups === 0 && rows[0].options === 0) ok('프로퍼티 삭제 → status_group · select_option CASCADE 삭제')
        else fail(`프로퍼티를 지웠는데 남았다: ${JSON.stringify(rows[0])}`)
      }
    }

    // ── ⑮ relation_edge 의 규칙 (0024 / §3.5 C2 · E1 · [보강] RE1 · relation 5a조각) ──
    // 캐시 투영 · 끝점 검사 · 양방향 대칭. E1 의 트리거는 **지연**(커밋 시점)이라 `SET CONSTRAINTS … IMMEDIATE` 로
    // 그 자리에서 검사를 돌려 본다 — 안 그러면 이 트랜잭션이 끝날 때에야 터진다.
    {
      const otherDb = randomUUID()
      const otherDs = randomUUID()
      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
         VALUES ($1, $2, 'database', 'block', $3, 'zz', $4, $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [otherDb, wsId, rootId, [rootId]],
      )
      await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [otherDb])
      await client.query(
        `INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '대상', now(), now())`,
        [otherDs, otherDb],
      )
      const rowIn = async (ds, container, key) => {
        const id = randomUUID()
        await client.query(
          `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                              ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
           VALUES ($1, $2, 'page', 'data_source', $3, $4, $5, $6, '{}'::jsonb, '{}'::jsonb, now(), now())`,
          [id, wsId, ds, key, [rootId, container], container],
        )
        await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [id, ds])
        return id
      }
      const from = await rowIn(dsId, dbBlockId, 'r1')
      const to = await rowIn(otherDs, otherDb, 'r1')
      const to2 = await rowIn(otherDs, otherDb, 'r2')

      const oneWay = pid(94)
      const pairA = pid(95)
      const pairB = pid(96)
      const property = (id, ds, name, key, config) =>
        client.query(
          `INSERT INTO property (id, data_source_id, name, type, config, order_idx, created_at, updated_at)
           VALUES ($1, $2, $3, 'relation', $4::jsonb, $5, now(), now())`,
          [id, ds, name, JSON.stringify(config), key],
        )
      await property(oneWay, dsId, '단방향', 'n1', { target_data_source_id: otherDs })
      await property(pairA, dsId, '양방향 A', 'n2', { target_data_source_id: otherDs, synced_property_id: pairB })
      await property(pairB, otherDs, '양방향 B', 'n1', { target_data_source_id: dsId, synced_property_id: pairA })

      const edge = `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx) VALUES ($1, $2, $3, $4)`
      await client.query(edge, [oneWay, from, to2, 'a1'])
      await client.query(edge, [oneWay, from, to, 'a0'])
      {
        const { rows } = await client.query(`SELECT properties_cache -> $2 AS v FROM page WHERE id = $1`, [from, oneWay])
        const v = rows[0]?.v
        if (v?.type === 'relation' && v.count === 2 && v.relation?.map((r) => r.id).join() === [to, to2].join()) {
          ok('C2: 엣지가 properties_cache 에 렌더용 배열로 투영된다 — order_idx 순 · count')
        } else fail(`relation 캐시가 예상과 다르다: ${JSON.stringify(v)}`)
      }
      await client.query(`DELETE FROM relation_edge WHERE property_id = $1 AND to_page_id = $2`, [oneWay, to])
      {
        const { rows } = await client.query(`SELECT (properties_cache -> $2 ->> 'count')::int AS n FROM page WHERE id = $1`, [from, oneWay])
        if (rows[0]?.n === 1) ok('엣지를 지우면 캐시가 따라간다 (DELETE 트리거)')
        else fail(`엣지를 지웠는데 캐시의 count 가 ${rows[0]?.n} 이다`)
      }

      await mustReject('RE1: relation 이 아닌 프로퍼티의 엣지', edge, [pid(1), from, to, 'a0'])
      await mustReject('RE1: 시작이 그 프로퍼티의 data_source 의 행이 아니다', edge, [oneWay, to, to2, 'a0'])
      await mustReject('RE1: 끝이 대상 data_source 의 행이 아니다', edge, [oneWay, from, from, 'a0'])

      // E1 — 지연 제약. 그 자리에서 돌려 본다.
      const mustRejectDeferred = async (label, statements) => {
        await client.query('SAVEPOINT probe')
        try {
          for (const [sql, params] of statements) await client.query(sql, params)
          await client.query('SET CONSTRAINTS tg_relation_edge_mirror IMMEDIATE')
          await client.query('ROLLBACK TO SAVEPOINT probe')
          fail(`${label} — 거부되어야 하는데 통과했다`)
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT probe')
          ok(`${label} — 거부됨 (${e.code})`)
        }
      }
      await mustRejectDeferred('E1: 짝이 있는 프로퍼티의 엣지에 거울상이 없다', [[edge, [pairA, from, to, 'a0']]])

      await client.query('SAVEPOINT pair')
      await client.query(edge, [pairA, from, to, 'a0'])
      await client.query(edge, [pairB, to, from, 'a0'])
      try {
        await client.query('SET CONSTRAINTS tg_relation_edge_mirror IMMEDIATE')
        ok('E1: 엣지와 거울상을 함께 넣으면 통과한다')
      } catch (e) {
        fail(`E1: 대칭 엣지가 거부됐다 (${e.code})`)
      }
      await client.query('SET CONSTRAINTS tg_relation_edge_mirror DEFERRED')
      await mustRejectDeferred('E1: 한쪽만 지우면 거울상이 남는다', [
        [`DELETE FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`, [pairA, from]],
      ])
      // 페이지가 사라지면 양쪽 엣지가 함께 CASCADE 된다 — 검사에 걸리지 않는다.
      await client.query(`DELETE FROM block WHERE id = $1`, [to])
      try {
        await client.query('SET CONSTRAINTS tg_relation_edge_mirror IMMEDIATE')
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM relation_edge WHERE property_id IN ($1, $2)`, [pairA, pairB])
        if (rows[0].n === 0) ok('페이지 영구 삭제 → 양쪽 엣지 CASCADE (E1 검사에 걸리지 않는다)')
        else fail(`페이지를 지웠는데 엣지가 ${rows[0].n}개 남았다`)
      } catch (e) {
        fail(`페이지 영구 삭제가 E1 에 걸렸다 (${e.code})`)
      }
      await client.query('SET CONSTRAINTS tg_relation_edge_mirror DEFERRED')
      await client.query('RELEASE SAVEPOINT pair')

      // ── ⑯ 셀을 갖지 않는 타입 (0025 / §3.5 C1 · C2 · [보강] rollup v1 · rollup 5c-1조각) ──
      // relation 의 정본은 엣지이고 rollup 은 읽을 때 계산한다 — 그 프로퍼티들에 셀 행이 생기면 캐시에 걸러지지 않은
      // 값이 실린다. `from` 은 위에서 만든 이 표의 행, `oneWay` 는 이 표의 relation 프로퍼티다.
      const cell = `INSERT INTO page_property_value (page_id, property_id, value, updated_at) VALUES ($1, $2, $3::jsonb, now())`
      const typed = async (n, type, key) => {
        await client.query(
          `INSERT INTO property (id, data_source_id, name, type, config, order_idx, created_at, updated_at)
           VALUES ($1, $2, $3, $4::property_type, '{}'::jsonb, $5, now(), now())`,
          [pid(n), dsId, `셀 없는 ${type}`, type, key],
        )
        return pid(n)
      }
      await mustReject('C2: relation 프로퍼티에 셀 행', cell, [from, oneWay, '{"type":"relation","relation":[]}'])
      await mustReject('C1: rollup 프로퍼티에 셀 행', cell, [from, await typed(97, 'rollup', 'q1'), '{"type":"number","number":1}'])
      await mustReject('C1: formula 프로퍼티에 셀 행', cell, [from, await typed(98, 'formula', 'q2'), '{"type":"number","number":1}'])
      await mustReject('C1: 자동 메타(created_time) 프로퍼티에 셀 행', cell, [from, await typed(99, 'created_time', 'q3'), '{"type":"date","date":null}'])
      {
        await client.query('SAVEPOINT plain')
        try {
          await client.query(cell, [from, await typed(100, 'number', 'q4'), '{"type":"number","number":1}'])
          ok('셀 타입(number) 프로퍼티의 셀 행은 통과한다 — 막는 것은 셀 없는 타입뿐이다')
        } catch (e) {
          fail(`셀 타입의 셀 행이 거부됐다 (${e.code} ${e.message})`)
        }
        await client.query('ROLLBACK TO SAVEPOINT plain')
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

  console.log('\n[10] 협업 서버 신호 트리거 (0016 / CRDT 5c · F-05-19)')
  {
    // 권한 판정이 읽는 표에서 트리거 하나가 빠지면 그 쓰기로 회수된 연결이 계속 본문을 받는다 — 틀려도 조용하다.
    // 여기서는 있고 켜져 있는지만 본다. NOTIFY 는 커밋해야 오므로 롤백하는 이 스크립트로는 보이지 않는다 — 실제 쓰기로 신호가
    // 오는지는 src/lib/collab/change-feed.db.test.ts ① 이 본다.
    const expected = [
      ['doc_update', 'tg_collab_doc_update'],
      ['block', 'tg_collab_access_block'],
      ['acl_entry', 'tg_collab_access_acl_entry'],
      ['block_acl_meta', 'tg_collab_access_block_acl_meta'],
      ['workspace_member', 'tg_collab_access_workspace_member'],
      ['sso_config', 'tg_collab_access_sso_config'],
      ['user_session', 'tg_collab_access_user_session'],
      ['user_session', 'tg_collab_access_user_session_delete'],
    ]
    const { rows } = await client.query(
      `SELECT c.relname AS tbl, t.tgname AS name, t.tgenabled AS enabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname LIKE 'tg_collab_%' AND t.tgparentid = 0`,
    )
    const got = new Map(rows.map((r) => [`${r.tbl}.${r.name}`, r.enabled]))
    const missing = expected.filter(([tbl, name]) => got.get(`${tbl}.${name}`) !== 'O')
    if (missing.length === 0) ok(`신호 트리거 ${expected.length}개가 있고 켜져 있다`)
    else fail(`신호 트리거가 없거나 꺼져 있다: ${missing.map(([tbl, name]) => `${tbl}.${name}`).join(', ')}`)
  }

  console.log('\n[11] 코멘트 (0018 · 0019 / §3.9 · F-05-08 · F-05-07)')
  {
    // 정상 경로가 먼저 통과해야 한다. 페이지 블록 하나를 세우고 그 위에 스레드를 연다.
    const pageId = randomUUID()
    const discussionId = randomUUID()
    const commentId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'c0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [pageId, wsId],
    )
    await client.query(
      `INSERT INTO discussion (id, workspace_id, page_id, parent_block_id, created_by, created_at)
       VALUES ($1, $2, $3, $3, $4, now())`,
      [discussionId, wsId, pageId, userId],
    )
    await client.query(
      `INSERT INTO comment (id, discussion_id, created_by, rich_text, created_at)
       VALUES ($1, $2, $3, '[{"type":"text"}]'::jsonb, now())`,
      [commentId, discussionId, userId],
    )
    ok('스레드 + 코멘트 생성 (page_id = parent_block_id 인 페이지 스레드)')

    // 불변식 D1 — '해결됨'은 세 컬럼이 함께 움직인다.
    await mustReject(
      'D1: 누가 언제 해결했는지 없는 해결',
      `UPDATE discussion SET resolved = true WHERE id = $1`,
      [discussionId],
    )
    await mustReject(
      'D1: 해결하지 않았는데 해결자가 있다',
      `UPDATE discussion SET resolved_by = $2, resolved_at = now() WHERE id = $1`,
      [discussionId, userId],
    )

    // 불변식 D2 — 살아 있는 코멘트는 비어 있지 않다.
    await mustReject(
      'D2: 빈 코멘트',
      `INSERT INTO comment (id, discussion_id, created_by, rich_text, created_at)
       VALUES ($1, $2, $3, '[]'::jsonb, now())`,
      [randomUUID(), discussionId, userId],
    )
    await mustReject(
      'D2: rich_text 가 배열이 아니다',
      `INSERT INTO comment (id, discussion_id, created_by, rich_text, created_at)
       VALUES ($1, $2, $3, '{"text":"안녕"}'::jsonb, now())`,
      [randomUUID(), discussionId, userId],
    )

    // 불변식 D3 — 지운 코멘트는 내용을 남기지 않는다. 읽기에서 거르는 것만으로는 부족하다(0018 머리말).
    await mustReject(
      'D3: 지웠는데 내용이 남았다',
      `UPDATE comment SET deleted_at = now() WHERE id = $1`,
      [commentId],
    )

    // 반응은 PK 가 곧 2P-Set 이다(정본 §3.9).
    await client.query(
      `INSERT INTO reaction (target_kind, target_id, user_id, emoji, created_at) VALUES ('comment', $1, $2, '@', now())`,
      [commentId, userId],
    )
    await mustReject(
      '같은 (대상, 사람, 이모지)를 두 번',
      `INSERT INTO reaction (target_kind, target_id, user_id, emoji, created_at) VALUES ('comment', $1, $2, '@', now())`,
      [commentId, userId],
    )
    await mustReject(
      '반응 대상은 comment · discussion 둘뿐이다',
      `INSERT INTO reaction (target_kind, target_id, user_id, emoji, created_at) VALUES ('block', $1, $2, '@', now())`,
      [commentId, userId],
    )

    // 범위 앵커의 모양 (0019 / F-05-07). 값의 내용은 SQL 로 볼 수 없다 — 모양만 못박는다.
    {
      const anchored = randomUUID()
      const blockId = randomUUID()
      const shape = JSON.stringify({ kind: 'text_range', start: 'AQI=', end: 'AQM=', quoted_text: '인용' })
      await client.query(
        `INSERT INTO discussion (id, workspace_id, page_id, parent_block_id, anchor, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())`,
        [anchored, wsId, pageId, blockId, shape, userId],
      )
      ok('본문 블록에 단 범위 앵커 (parent_block_id 는 투영되지 않은 블록이어도 된다)')

      await mustReject(
        'D4: 페이지 스레드에 범위 앵커',
        `INSERT INTO discussion (id, workspace_id, page_id, parent_block_id, anchor, created_by, created_at)
         VALUES ($1, $2, $3, $3, $4::jsonb, $5, now())`,
        [randomUUID(), wsId, pageId, shape, userId],
      )
      await mustReject(
        'D5: quoted_text 없는 앵커',
        `INSERT INTO discussion (id, workspace_id, page_id, parent_block_id, anchor, created_by, created_at)
         VALUES ($1, $2, $3, $4, '{"kind":"text_range","start":"AQI=","end":"AQM="}'::jsonb, $5, now())`,
        [randomUUID(), wsId, pageId, randomUUID(), userId],
      )
      await mustReject(
        'D5: 모르는 앵커 종류',
        `INSERT INTO discussion (id, workspace_id, page_id, parent_block_id, anchor, created_by, created_at)
         VALUES ($1, $2, $3, $4, '{"kind":"block","quoted_text":"x","start":"a","end":"b"}'::jsonb, $5, now())`,
        [randomUUID(), wsId, pageId, randomUUID(), userId],
      )
    }

    // 부정 요구사항 — parent_block_id 에 FK 가 **없어야** 한다(0018 머리말).
    // 걸리는 순간 ① 방금 친 문단(아직 투영 전)에 코멘트를 달 수 없고 ② 남이 그 문단을 지우면 스레드가 조용히 사라지거나
    // 본문 저장이 막힌다. 05 F-05-07 은 "스레드는 생존"이라고 정했다.
    {
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint
          WHERE contype = 'f' AND conrelid = 'discussion'::regclass
            AND 'parent_block_id' = ANY (
                  SELECT a.attname FROM unnest(conkey) k JOIN pg_attribute a
                    ON a.attrelid = conrelid AND a.attnum = k)`,
      )
      if (rows.length === 0) ok('discussion.parent_block_id 에 FK 가 없다 — 본문 블록 행은 Y.Doc 의 투영이다')
      else fail(`discussion.parent_block_id 에 FK 가 생겼다: ${rows.map((r) => r.conname).join(', ')}`)
    }
  }

  console.log('\n[12] 활동 · 구독 · 알림 (0020 / §3.8 · F-11-07 · F-11-08)')
  {
    const pageId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'n0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [pageId, wsId],
    )
    const eventId = randomUUID()
    await client.query(
      `INSERT INTO activity_event (id, workspace_id, page_id, block_id, actor_id, type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, 'comment.created', '{"discussion_id":"x"}'::jsonb, now())`,
      [eventId, wsId, pageId, randomUUID(), userId],
    )
    ok('활동 이벤트 생성 (block_id 는 투영되지 않은 블록이어도 된다 — FK 없음)')

    // 파티션이 하나라도 빠지면 그 구간의 쓰기가 통째로 실패한다. DEFAULT 는 해가 바뀌어도 받는 마지막 방어다.
    {
      const { rows } = await client.query(
        `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'activity_event'::regclass ORDER BY c.relname`,
      )
      const names = rows.map((r) => r.relname)
      const expected = ['activity_event_2026', 'activity_event_2027', 'activity_event_default']
      if (expected.every((n) => names.includes(n))) ok(`activity_event 파티션 ${names.length}개 (DEFAULT 포함)`)
      else fail(`activity_event 파티션이 부족하다: ${names.join(', ')}`)
    }

    await mustReject(
      '모르는 이벤트 종류',
      `INSERT INTO activity_event (id, workspace_id, page_id, actor_id, type, payload, created_at)
       VALUES ($1, $2, $3, $4, 'comment.exploded', '{}'::jsonb, now())`,
      [randomUUID(), wsId, pageId, userId],
    )

    // 구독 — page_kind 가 level CHECK 의 판별자다(정본 §3.8).
    await client.query(
      `INSERT INTO subscription (id, user_id, page_id, page_kind, level, source, created_at)
       VALUES ($1, $2, $3, 'page', 'all_comments', 'auto_created', now())`,
      [randomUUID(), userId, pageId],
    )
    ok('구독 생성 (page · all_comments · auto_created)')
    await mustReject(
      '같은 사람이 같은 페이지를 두 번 구독',
      `INSERT INTO subscription (id, user_id, page_id, page_kind, level, source, created_at)
       VALUES ($1, $2, $3, 'page', 'none', 'explicit', now())`,
      [randomUUID(), userId, pageId],
    )
    await mustReject(
      'page 인데 db_item 의 레벨',
      `INSERT INTO subscription (id, user_id, page_id, page_kind, level, source, created_at)
       VALUES ($1, $2, $3, 'page', 'all_updates', 'explicit', now())`,
      [randomUUID(), randomUUID(), pageId],
    )

    // 알림 — N3: payload 를 복제하지 않고 event_ids[] 로 가리킨다.
    const notifyOne = randomUUID()
    await client.query(
      `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
       VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'comment', 'discussion:x', now())`,
      [notifyOne, userId, wsId, pageId, eventId],
    )
    ok('알림 생성 (event_ids[] 로 이벤트를 가리킨다)')
    await mustReject(
      '가리키는 이벤트가 없는 알림',
      `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
       VALUES ($1, $2, $3, $4, '{}'::uuid[], 'comment', 'discussion:x', now())`,
      [randomUUID(), userId, wsId, pageId],
    )
    await mustReject(
      '모르는 알림 종류',
      `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
       VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'carrier_pigeon', 'discussion:x', now())`,
      [randomUUID(), userId, wsId, pageId, eventId],
    )

    // 불변식 N2 — **없어야 하는 제약**이다. 같은 group_key 로 안 읽은 알림 둘이 들어가야 한다.
    try {
      await client.query(
        `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
         VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'comment_reply', 'discussion:x', now())`,
        [randomUUID(), userId, wsId, pageId, eventId],
      )
      ok('N2: 같은 group_key 로 안 읽은 알림 둘 — 저장은 개별, 병합은 조회 시점이다')
    } catch (e) {
      fail(`N2: UNIQUE(group_key) WHERE read_at IS NULL 제약이 생겼다 (${e.code})`)
    }
  }

  console.log('\n[13] 멘션 역인덱스 (0021 / §3.9 link_edge · F-07-09 · F-05-09)')
  {
    const sourcePage = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'l0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [sourcePage, wsId],
    )
    const blockId = randomUUID()
    await client.query(
      `INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id, created_at)
       VALUES ($1, $2, 'user', $3, now())`,
      [sourcePage, blockId, userId],
    )
    await client.query(
      `INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id, created_at)
       VALUES ($1, $2, 'page', $3, now())`,
      [sourcePage, blockId, randomUUID()],
    )
    ok('사람 · 페이지 멘션 edge 생성 (source_block_id 는 투영되지 않은 블록, target 은 없는 페이지여도 된다 — FK 없음)')

    await mustReject(
      '같은 (블록, 대상)을 두 번',
      `INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id, created_at)
       VALUES ($1, $2, 'user', $3, now())`,
      [sourcePage, blockId, userId],
    )
    await mustReject(
      '대상 종류는 page · user 둘뿐이다',
      `INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id, created_at)
       VALUES ($1, $2, 'database', $3, now())`,
      [sourcePage, randomUUID(), randomUUID()],
    )
    await mustReject(
      '없는 페이지에서 나가는 edge (source_page_id FK)',
      `INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id, created_at)
       VALUES ($1, $2, 'user', $3, now())`,
      [randomUUID(), randomUUID(), userId],
    )

    // 부정 요구사항 — source_block_id · target_id 에 FK 가 **없어야** 한다(0021 머리말 · §3.3-125 와 같은 이유).
    {
      const { rows } = await client.query(
        `SELECT conname, (SELECT array_agg(a.attname ORDER BY a.attnum) FROM unnest(conkey) k JOIN pg_attribute a
                    ON a.attrelid = conrelid AND a.attnum = k) AS cols
           FROM pg_constraint WHERE contype = 'f' AND conrelid = 'link_edge'::regclass`,
      )
      const fkCols = rows.flatMap((r) => r.cols)
      if (!fkCols.includes('source_block_id') && !fkCols.includes('target_id')) {
        ok('link_edge 의 FK 는 source_page_id 뿐이다 — 본문 블록 · 다형 대상에는 걸지 않는다')
      } else {
        fail(`link_edge 에 걸면 안 되는 FK 가 있다: ${rows.map((r) => `${r.conname}(${r.cols})`).join(', ')}`)
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
