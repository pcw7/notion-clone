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
  // Teamspace · 게스트 · 그룹 7c-1조각 (0028)
  'teamspace', 'teamspace_member',
  // 접근 요청 7e-1조각 (0033)
  'access_request',
  // 잠금 7f-1조각 (0034)
  'node_lock',
  // 정책 7g-2조각 (0036)
  'security_policy',
  // 행의 레이아웃 8f-2조각 (0044)
  'page_layout', 'layout_tab', 'layout_module',
  // 설정 값 표 8h조각 (0045)
  'setting_value',
  // 요금제 · 엔타이틀먼트 · 결제 구독 8k-1조각 (0047)
  'plan', 'plan_entitlement', 'billing_subscription',
  // 개인 필터 · 정렬 2h-1조각 (0059)
  'view_user_override',
  // 수식 속성의 의존 그래프 2i-2조각 (0060)
  'property_dependency',
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
  // 불변식 M5: "pin 되었다" = area='heading' 이다. 열로 두면 고정의 진실이 둘이 된다.
  ['layout_module', 'pinned'],
  // 불변식 PE2: 좌석은 workspace_seat_count 뷰가 유일한 원천이다. 구독에 좌석 수를 두면 진실이 둘이 된다.
  ['billing_subscription', 'seats'],
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
      await client.query(
        `INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'b0')`,
        [dbBlockId, otherDs],
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
       VALUES ($1, $2, '{"type":"title","title":[{"type":"text","text":{"content":"첫 행"}}]}'::jsonb, '첫 행', now())`,
      [rowId, pid(1)],
    )
    ok('셀 삽입 — value + 사이드카(text_value)')

    await mustReject(
      '같은 (행, 프로퍼티)에 셀 두 개 — 병합 단위가 이 쌍이다 [X-4]',
      // 봉투는 올바르게 — 0053(CV1)이 먼저 거부하면 이 검사가 PK 가 아니라 봉투 때문에 통과한다.
      `INSERT INTO page_property_value (page_id, property_id, value, updated_at)
       VALUES ($1, $2, '{"type":"title","title":[]}'::jsonb, now())`,
      [rowId, pid(1)],
    )
    await mustReject(
      '거꾸로 된 기간 — 기간 필터가 조용히 0건이 된다',
      `INSERT INTO page_property_value (page_id, property_id, value, date_start, date_end, updated_at)
       VALUES ($1, $2, '{"type":"select","select":null}'::jsonb, '2026-02-01', '2026-01-01', now())`,
      [rowId, pid(7)],
    )
    await mustReject(
      'date_end 만 있는 값',
      `INSERT INTO page_property_value (page_id, property_id, value, date_end, updated_at)
       VALUES ($1, $2, '{"type":"select","select":null}'::jsonb, '2026-01-01', now())`,
      [rowId, pid(7)],
    )
    await mustReject(
      '모르는 filled_by',
      `INSERT INTO page_property_value (page_id, property_id, value, filled_by, updated_at)
       VALUES ($1, $2, '{"type":"select","select":null}'::jsonb, 'telepathy', now())`,
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
      await client.query(
        `INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`,
        [otherDb, otherDs],
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
      // 수식은 설정(식 · 결과 타입)이 있어야 수식이다(0060 ck_property_formula_config) — 그 밖의 타입은 빈 설정
      const typed = async (n, type, key, config = {}) => {
        await client.query(
          `INSERT INTO property (id, data_source_id, name, type, config, order_idx, created_at, updated_at)
           VALUES ($1, $2, $3, $4::property_type, $6::jsonb, $5, now(), now())`,
          [pid(n), dsId, `셀 없는 ${type}`, type, key, JSON.stringify(config)],
        )
        return pid(n)
      }
      await mustReject('C2: relation 프로퍼티에 셀 행', cell, [from, oneWay, '{"type":"relation","relation":[]}'])
      await mustReject('C1: rollup 프로퍼티에 셀 행', cell, [from, await typed(97, 'rollup', 'q1'), '{"type":"number","number":1}'])
      await mustReject('C1: formula 프로퍼티에 셀 행', cell, [from, await typed(98, 'formula', 'q2', { expression: '1', result_type: 'number' }), '{"type":"number","number":1}'])
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

      // ── ⑰ 뷰의 기본 템플릿 (0026 / §3.6 · F-08-03 · 템플릿 6c-1조각) ──
      // `view.default_template_page_id` 는 0015 부터 아무것도 검사하지 않는 컬럼이었다. 일반 행을 가리키면
      // 뷰 질의에는 보이는 행이 `New` 의 원본이 되고(R1 의 반대쪽이 무너진다), 다른 표의 템플릿을 가리키면
      // 셀 복사가 프로퍼티를 하나도 못 맞춰 조용히 빈 행을 만든다.
      {
        const templateIn = async (ds, container, key) => {
          const id = await rowIn(ds, container, key)
          await client.query(`UPDATE page SET is_template = true WHERE id = $1`, [id])
          return id
        }
        const mine = await templateIn(dsId, dbBlockId, 't1')
        const theirs = await templateIn(otherDs, otherDb, 't1')
        const viewId = randomUUID()
        const insertView = `INSERT INTO view (id, database_id, data_source_id, name, type, order_idx, configuration,
                                              default_template_page_id, created_at, updated_at)
                            VALUES ($1, $2, $3, '표', 'table', 'a0', '{}'::jsonb, $4, now(), now())`

        await client.query('SAVEPOINT tmpl')
        try {
          await client.query(insertView, [viewId, dbBlockId, dsId, mine])
          ok('이 표의 템플릿을 기본으로 지정하면 통과한다')
        } catch (e) {
          fail(`이 표의 템플릿이 거부됐다 (${e.code} ${e.message})`)
        }

        // FK — 템플릿을 영구 삭제하면 지정이 풀린다. 휴지통(lifecycle)은 행이 남으므로 여기 걸리지 않는다.
        await client.query(`DELETE FROM block WHERE id = $1`, [mine])
        {
          const { rows } = await client.query(`SELECT default_template_page_id AS id FROM view WHERE id = $1`, [viewId])
          if (rows[0].id === null) ok('템플릿을 영구 삭제하면 기본 지정이 NULL 이 된다 (ON DELETE SET NULL)')
          else fail('템플릿을 지웠는데 기본 지정이 남았다')
        }
        await client.query('ROLLBACK TO SAVEPOINT tmpl')

        await mustReject('F-08-03: 일반 행을 기본 템플릿으로', insertView, [viewId, dbBlockId, dsId, from])
        await mustReject('F-08-03: 다른 표의 템플릿을 기본 템플릿으로', insertView, [viewId, dbBlockId, dsId, theirs])
        // FK 보다 트리거가 먼저 잡는다(23514) — `EXISTS` 가 실패하기 때문이다. FK 가 혼자 일하는 자리는
        // 위의 `ON DELETE SET NULL` 하나다.
        await mustReject('F-08-03: 없는 페이지를 기본 템플릿으로', insertView, [
          viewId,
          dbBlockId,
          dsId,
          randomUUID(),
        ])
        // UPDATE 쪽도 같은 트리거를 탄다 — INSERT 만 막으면 만든 뒤에 바꿔 끼울 수 있다.
        await client.query(insertView, [viewId, dbBlockId, dsId, null])
        await mustReject(
          'F-08-03: 만든 뒤 UPDATE 로 일반 행을 끼울 수 없다',
          `UPDATE view SET default_template_page_id = $2 WHERE id = $1`,
          [viewId, from],
        )
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
      // 7a조각 — 그룹 멤버십이 판정의 입력이 됐다(0027 ③)
      ['group_member', 'tg_collab_access_group_member'],
      ['group_member', 'tg_collab_access_group_member_update'],
      ['group', 'tg_collab_access_group'],
      // 7c-1조각 — teamspace 멤버십 · 보관이 판정의 입력이 됐다(0028 ③)
      ['teamspace_member', 'tg_collab_access_teamspace_member'],
      ['teamspace_member', 'tg_collab_access_teamspace_member_update'],
      ['teamspace', 'tg_collab_access_teamspace'],
      // 7f-1조각 — 잠금이 협업 접속 판정의 입력이 됐다(0034)
      ['node_lock', 'tg_collab_access_node_lock'],
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

    // 7c-3조각(0029) — 최상위 페이지는 부모만 바뀌고 경로 · 스코프가 그대로일 수 있다(teamspace 사이 이동). 트리거가 그 두 열을
    // 보는지 정의에서 본다. 실제로 신호가 오는지는 src/lib/block/move-teamspace.db.test.ts 가 본다.
    const block = await client.query(
      `SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'block' AND t.tgname = 'tg_collab_access_block'`,
    )
    const def = block.rows[0]?.def ?? ''
    const watches = (col) =>
      new RegExp(`UPDATE OF [^\\n]*\\b${col}\\b[^\\n]* ON `, 'i').test(def) &&
      new RegExp(`old\\.${col} IS DISTINCT FROM new\\.${col}`, 'i').test(def)
    if (watches('parent_type') && watches('parent_id')) {
      ok('block 의 신호가 부모 이동(parent_type · parent_id)도 본다 (0029)')
    } else {
      fail(`block 의 신호가 부모 이동을 보지 않는다 — ${def}`)
    }
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

  console.log('\n[14] 그룹 (0027 / §3.3 G2 · 이름 · F-06-03 · 7a조각)')
  {
    // 그룹은 판정의 입력이다(P(U)). 게스트가 살아 있는 그룹 행을 가지면 판정은 무시하지만(principalsOf), 넣는 쪽은 DB 가 막는다.
    const person = async (name, role) => {
      const id = randomUUID()
      const eid = randomUUID()
      await client.query(`INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,$2,$3, now())`, [id, name, eid])
      await client.query(
        `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at) VALUES ($1,$2,$3, now(), true, now())`,
        [eid, id, `${name}@example.com`],
      )
      if (role) {
        await client.query(`INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1,$2,$3,'active')`, [
          wsId,
          id,
          role,
        ])
      }
      return id
    }
    const memberId = await person('group_member1', 'member')
    const restrictedId = await person('group_restricted1', 'restricted_member')
    const guestId = await person('group_guest1', 'guest')
    const outsiderId = await person('group_outsider1', null)
    const groupId = randomUUID()
    await client.query(`INSERT INTO "group" (id, workspace_id, name) VALUES ($1,$2,'Design')`, [groupId, wsId])
    await client.query(`INSERT INTO group_member (group_id, user_id) VALUES ($1,$2), ($1,$3)`, [groupId, memberId, restrictedId])
    ok('멤버 · restricted_member 를 그룹에 넣기 (G3)')

    const addMember = `INSERT INTO group_member (group_id, user_id) VALUES ($1,$2)`
    await mustReject('G2: 게스트를 그룹에', addMember, [groupId, guestId])
    await mustReject('G2: 이 워크스페이스 멤버가 아닌 사람을 그룹에', addMember, [groupId, outsiderId])

    // 빠진 행은 누구의 것이든 남을 수 있다(M1 의 복원 창) — 되살리는 쪽을 막는다.
    await client.query(`INSERT INTO group_member (group_id, user_id, removed_at) VALUES ($1,$2, now())`, [groupId, guestId])
    ok('빠진 게스트 행(removed_at)은 남을 수 있다 — M1')
    await mustReject(
      'G2: 빠진 게스트 행을 UPDATE 로 되살리기',
      `UPDATE group_member SET removed_at = NULL WHERE group_id = $1 AND user_id = $2`,
      [groupId, guestId],
    )

    const addGroup = `INSERT INTO "group" (id, workspace_id, name) VALUES ($1,$2,$3)`
    await mustReject('이름: 대소문자만 다른 살아 있는 그룹', addGroup, [randomUUID(), wsId, 'DESIGN'])
    await client.query(`UPDATE "group" SET deleted_at = now() WHERE id = $1`, [groupId])
    await client.query('SAVEPOINT reuse')
    try {
      await client.query(addGroup, [randomUUID(), wsId, 'design'])
      ok('이름: 지운 그룹의 이름은 다시 쓸 수 있다 (부분 UNIQUE — §3.1-2n)')
    } catch (e) {
      fail(`지운 그룹이 이름을 붙잡았다 (${e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT reuse')
  }

  console.log('\n[15] teamspace (0028 / §3.3 · §3.4 parent_type · F-06-04 · 7c-1조각)')
  {
    // teamspace 는 트리 노드다(C-9). 멤버는 이 워크스페이스의 게스트 아닌 사람 · 살아 있는 그룹이고, 그 아래 블록은 같은
    // 워크스페이스의 teamspace 를 가리키는 페이지 · 데이터베이스다. 둘 다 다형 참조라 FK 대신 트리거가 막는다.
    const teamspaceId = randomUUID()
    const addTeamspace = `INSERT INTO teamspace (id, workspace_id, name, visibility) VALUES ($1, $2, $3, $4)`
    await client.query(addTeamspace, [teamspaceId, wsId, '제품팀', 'closed'])
    ok('teamspace 생성')
    await mustReject('보이는 범위는 open · closed · private 셋뿐이다', addTeamspace, [randomUUID(), wsId, '팀', 'secret'])

    const person = async (name, role) => {
      const id = randomUUID()
      const eid = randomUUID()
      await client.query(`INSERT INTO "user" (id, name, primary_email_id, created_at) VALUES ($1,$2,$3, now())`, [id, name, eid])
      await client.query(
        `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at) VALUES ($1,$2,$3, now(), true, now())`,
        [eid, id, `${name}@example.com`],
      )
      if (role) {
        await client.query(`INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1,$2,$3,'active')`, [wsId, id, role])
      }
      return id
    }
    const memberId = await person('ts_member1', 'member')
    const guestId = await person('ts_guest1', 'guest')
    const outsiderId = await person('ts_outsider1', null)
    const addMember = `INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role) VALUES ($1, $2, $3, 'member')`
    await client.query(addMember, [teamspaceId, 'user', memberId])
    ok('멤버를 teamspace 에 넣기')
    await mustReject('게스트를 teamspace 에', addMember, [teamspaceId, 'user', guestId])
    await mustReject('이 워크스페이스 멤버가 아닌 사람을 teamspace 에', addMember, [teamspaceId, 'user', outsiderId])
    await mustReject('없는 그룹을 teamspace 에', addMember, [teamspaceId, 'group', randomUUID()])
    await mustReject('역할은 owner · member 둘뿐이다',
      `INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role) VALUES ($1, 'user', $2, 'admin')`,
      [teamspaceId, memberId])

    const addBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, 'teamspace', $4, $5, '{}', $4, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(addBlock, [randomUUID(), wsId, 'page', teamspaceId, 't0'])
    ok('teamspace 의 최상위 페이지 (parent_type=teamspace)')
    await mustReject('teamspace 바로 아래에 문단', addBlock, [randomUUID(), wsId, 'paragraph', teamspaceId, 't1'])
    await mustReject('없는 teamspace 를 부모로', addBlock, [randomUUID(), wsId, 'page', randomUUID(), 't2'])
    {
      const otherWs = randomUUID()
      const otherTeamspace = randomUUID()
      await client.query(`INSERT INTO workspace (id, name, region_id, created_at) VALUES ($1,'다른 곳','local', now())`, [otherWs])
      await client.query(addTeamspace, [otherTeamspace, otherWs, '남의 팀', 'open'])
      await mustReject('다른 워크스페이스의 teamspace 를 부모로', addBlock, [randomUUID(), wsId, 'page', otherTeamspace, 't3'])
    }
  }

  console.log('\n[16] 기본 teamspace 는 보관하지 않는다 (0030 / §3.3 [보강] is_default ⑥ · F-06-04 · 7c-11조각)')
  {
    // 보관된 teamspace 로의 자동 추가는 헛돌고, 되살리는 순간 보관 중에 들어온 사람들에게 한꺼번에 열린다. 두 방향 다 막는다.
    const id = randomUUID()
    await client.query(`INSERT INTO teamspace (id, workspace_id, name, visibility, is_default) VALUES ($1, $2, '전사', 'open', true)`, [
      id,
      wsId,
    ])
    ok('기본 teamspace 생성')
    await mustReject('기본 teamspace 를 보관', `UPDATE teamspace SET archived_at = now() WHERE id = $1`, [id])
    await client.query(`UPDATE teamspace SET is_default = false, archived_at = now() WHERE id = $1`, [id])
    ok('기본을 끄면 보관된다')
    await mustReject('보관된 teamspace 를 기본으로', `UPDATE teamspace SET is_default = true WHERE id = $1`, [id])
  }

  console.log('\n[17] teamspace 노드의 부여는 page 매트릭스의 네 레벨만 (0031 / §3.3 [보강] 멤버 기본 레벨 ① · 7c-12조각)')
  {
    // 판정은 teamspace 노드의 행을 page 매트릭스로 읽는다 — database 전용 레벨(edit_content · create)은 그 아래 페이지에서 뜻이 없다.
    const id = randomUUID()
    await client.query(`INSERT INTO teamspace (id, workspace_id, name, visibility) VALUES ($1, $2, '레벨', 'closed')`, [id, wsId])
    const grant = `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level)
                   VALUES ($1, 'teamspace', $2, 'teamspace', $2, $3)`
    await client.query(grant, [randomUUID(), id, 'comment'])
    ok('멤버 레벨 comment')
    await mustReject('teamspace 노드에 edit_content', `UPDATE acl_entry SET level = 'edit_content' WHERE node_kind = 'teamspace' AND node_id = $1`, [id])
    await mustReject('teamspace 노드에 create', `UPDATE acl_entry SET level = 'create' WHERE node_kind = 'teamspace' AND node_id = $1`, [id])
  }

  console.log('\n[18] teamspace 아이콘의 모양 (0032 / §3.3 [보강] teamspace.icon ② · 7c-14조각)')
  {
    // "이모지 한 글자"는 명령이 보고, DB 는 표현할 수 있는 부분(비지 않음 · 16 코드포인트 이하 · 공백 없음)만 막는다.
    const id = randomUUID()
    await client.query(`INSERT INTO teamspace (id, workspace_id, name, visibility, icon) VALUES ($1, $2, '아이콘', 'closed', $3)`, [
      id,
      wsId,
      '👨‍👩‍👧‍👦',
    ])
    ok('ZWJ 가족 이모지(코드포인트 7개)')
    const setIcon = `UPDATE teamspace SET icon = $2 WHERE id = $1`
    await mustReject('빈 아이콘', setIcon, [id, ''])
    await mustReject('공백이 든 아이콘', setIcon, [id, '🚀 '])
    await mustReject('16 코드포인트를 넘는 아이콘', setIcon, [id, 'x'.repeat(17)])
  }

  console.log('\n[19] 접근 요청 (0033 / §3.3 access_request · [보강] 접근 요청의 길 · §3.8 [보강] 접근 요청의 알림 · 7e-1조각)')
  {
    const pageId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'r0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [pageId, wsId],
    )
    const add = `INSERT INTO access_request (id, workspace_id, kind, node_id, requester_id, requested_level, status, decided_by, decided_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
    const first = randomUUID()
    await client.query(add, [first, wsId, 'page_access', pageId, userId, null, 'pending', null, null])
    ok('대기 중인 페이지 접근 요청')
    await mustReject('같은 (페이지, 사람, 종류)의 두 번째 대기 요청', add, [randomUUID(), wsId, 'page_access', pageId, userId, null, 'pending', null, null])
    await client.query(`UPDATE access_request SET status = 'ignored', decided_by = $2, decided_at = now() WHERE id = $1`, [first, userId])
    await client.query(add, [randomUUID(), wsId, 'page_access', pageId, userId, null, 'pending', null, null])
    ok('무시된 요청 뒤의 새 대기 요청 (부분 UNIQUE 는 pending 만 센다)')
    await mustReject('페이지가 없는 페이지 접근 요청', add, [randomUUID(), wsId, 'page_access', null, userId, null, 'pending', null, null])
    await mustReject('요청한 사람이 없는 편집 권한 요청', add, [randomUUID(), wsId, 'edit_access', pageId, null, 'edit', 'pending', null, null])
    await mustReject('결정 시각이 있는 대기 요청', add, [randomUUID(), wsId, 'edit_access', pageId, userId, 'edit', 'pending', null, new Date()])
    await mustReject('결정한 사람이 있는 대기 요청', add, [randomUUID(), wsId, 'edit_access', pageId, userId, 'edit', 'pending', userId, null])
    await mustReject('결정 시각이 없는 허락', add, [randomUUID(), wsId, 'edit_access', pageId, userId, 'edit', 'approved', userId, null])
    await mustReject('모르는 요청 종류', add, [randomUUID(), wsId, 'bribe', pageId, userId, null, 'pending', null, null])
    await mustReject('모르는 요청 레벨', add, [randomUUID(), wsId, 'edit_access', pageId, userId, 'owner', 'pending', null, null])

    const eventId = randomUUID()
    await client.query(
      `INSERT INTO activity_event (id, workspace_id, page_id, actor_id, type, payload, created_at)
       VALUES ($1, $2, $3, $4, 'access.requested', '{}'::jsonb, now())`,
      [eventId, wsId, pageId, userId],
    )
    await client.query(
      `INSERT INTO notification (id, recipient_id, workspace_id, page_id, event_ids, kind, group_key, created_at)
       VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], 'access_requested', 'access_request:x', now())`,
      [randomUUID(), userId, wsId, pageId, eventId],
    )
    ok('접근 요청의 이벤트 · 알림 종류 (access.requested · access_requested)')

    // 페이지가 물리적으로 지워지면 요청도 간다 — 06 F-06-15 *"삭제 시 요청 자동 취소"*.
    await client.query(`DELETE FROM block WHERE id = $1`, [pageId])
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM access_request WHERE node_id = $1`, [pageId])
    if (rows[0].n === 0) ok('페이지를 지우면 그 페이지의 요청도 간다 (ON DELETE CASCADE)')
    else fail(`페이지를 지웠는데 요청 ${rows[0].n}건이 남았다`)
  }

  console.log('\n[20] 잠금 (0034 / §3.3 node_lock · [보강] 잠금이 막는 것 ⑦ · X-9 · 7f-1조각)')
  {
    const addBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, 'workspace', $2, $4, '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`
    const pageId = randomUUID()
    await client.query(addBlock, [pageId, wsId, 'page', `lock-${pageId}`])
    const lock = `INSERT INTO node_lock (node_id, kind, locked_by) VALUES ($1, $2, $3)`
    await mustReject('페이지에 데이터베이스 잠금', lock, [pageId, 'database', userId])
    await mustReject('모르는 잠금 종류', lock, [pageId, 'everything', userId])
    await client.query(lock, [pageId, 'page', userId])
    ok('페이지 잠금 (행이 곧 잠금이다)')
    await mustReject('같은 노드를 두 번 잠금', lock, [pageId, 'page', userId])
    await mustReject('잠금을 데이터베이스로 바꿈', `UPDATE node_lock SET kind = 'database' WHERE node_id = $1`, [pageId])
    await mustReject('모르는 잠금 범위', `UPDATE node_lock SET scope = 'everything' WHERE node_id = $1`, [pageId])

    await client.query(`DELETE FROM block WHERE id = $1`, [pageId])
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM node_lock WHERE node_id = $1`, [pageId])
    if (rows[0].n === 0) ok('블록을 지우면 잠금도 간다 (ON DELETE CASCADE)')
    else fail('블록을 지웠는데 잠금이 남았다')
  }

  console.log('\n[21] 게스트의 대기 초대 (0035 / §3.2 workspace_invite · §3.3 [보강] 게스트 ⑨ · 7g-1조각)')
  {
    const pageId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, $3, '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [pageId, wsId, `invite-${pageId}`],
    )
    const invite = `INSERT INTO workspace_invite (id, workspace_id, kind, email, token_hash, role, created_by, created_at, page_id, page_level)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)`
    const email = `guest-${pageId}@example.com`
    const first = randomUUID()
    await client.query(invite, [first, wsId, 'email', email, randomUUID(), 'guest', userId, pageId, 'view'])
    ok('게스트 대기 초대(페이지 · 레벨)')
    await mustReject('같은 (페이지, 이메일)의 두 번째 대기 게스트 초대', invite, [randomUUID(), wsId, 'email', email, randomUUID(), 'guest', userId, pageId, 'comment'])
    await mustReject('페이지가 없는 게스트 초대', invite, [randomUUID(), wsId, 'email', `a-${email}`, randomUUID(), 'guest', userId, null, null])
    await mustReject('페이지가 있는 멤버 초대', invite, [randomUUID(), wsId, 'email', `b-${email}`, randomUUID(), 'member', userId, pageId, 'view'])
    await mustReject('게스트에게 전체 권한', invite, [randomUUID(), wsId, 'email', `c-${email}`, randomUUID(), 'guest', userId, pageId, 'full_access'])
    await mustReject('링크로 하는 게스트 초대', invite, [randomUUID(), wsId, 'link', null, randomUUID(), 'guest', userId, pageId, 'view'])
    await mustReject('모르는 초대 역할', invite, [randomUUID(), wsId, 'email', `d-${email}`, randomUUID(), 'emperor', userId, null, null])
    await client.query(`UPDATE workspace_invite SET accepted_at = now(), accepted_by_user_id = $2 WHERE id = $1`, [first, userId])
    await client.query(invite, [randomUUID(), wsId, 'email', email, randomUUID(), 'guest', userId, pageId, 'edit'])
    ok('받아들인 초대 뒤의 새 대기 게스트 초대 (부분 UNIQUE 는 열린 것만 센다)')

    await client.query(`DELETE FROM block WHERE id = $1`, [pageId])
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM workspace_invite WHERE page_id = $1`, [pageId])
    if (rows[0].n === 0) ok('페이지를 지우면 그 페이지의 게스트 초대도 간다 (ON DELETE CASCADE)')
    else fail(`페이지를 지웠는데 게스트 초대 ${rows[0].n}건이 남았다`)
  }

  console.log('\n[22] 정책 · 접근 요청으로 들어온 게스트 (0036 / §3.2 security_policy · workspace_member.join_method · 7g-2조각)')
  {
    const policyWs = randomUUID()
    await client.query(`INSERT INTO workspace (id, name, region_id, created_at) VALUES ($1, '정책', 'local', now())`, [policyWs])
    await client.query(`INSERT INTO security_policy (workspace_id) VALUES ($1)`, [policyWs])
    const { rows } = await client.query(
      `SELECT allow_nonmember_page_access_request AS nonmember, allow_member_invite_guests AS invite_guests,
              require_mfa_for_guests AS mfa, who_can_add_restricted_members AS restricted
         FROM security_policy WHERE workspace_id = $1`,
      [policyWs],
    )
    const d = rows[0]
    if (d?.nonmember === true && d.invite_guests === true && d.mfa === false && d.restricted === 'owners') {
      ok('칸을 적지 않은 행은 정본의 기본값 (밖의 요청 받음 · 게스트 MFA 요구 안 함)')
    } else fail(`정책의 기본값이 정본과 다르다: ${JSON.stringify(d)}`)
    await mustReject('한 워크스페이스에 정책 행 둘', `INSERT INTO security_policy (workspace_id) VALUES ($1)`, [policyWs])
    await mustReject('없는 워크스페이스의 정책', `INSERT INTO security_policy (workspace_id) VALUES ($1)`, [randomUUID()])
    await mustReject(
      '밖의 요청 정책이 NULL',
      `UPDATE security_policy SET allow_nonmember_page_access_request = NULL WHERE workspace_id = $1`,
      [policyWs],
    )

    await client.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, status, join_method) VALUES ($1, $2, 'guest', 'active', 'access_request')`,
      [policyWs, userId],
    )
    ok('접근 요청을 허락받아 들어온 게스트 (join_method=access_request)')
    await mustReject(
      '모르는 들어온 길',
      `UPDATE workspace_member SET join_method = 'backdoor' WHERE workspace_id = $1 AND user_id = $2`,
      [policyWs, userId],
    )
  }

  console.log('\n[23] 페이지 아이콘의 모양 (0037 / §3.4 [보강] 페이지 아이콘 ② · 8c-1조각)')
  {
    // "grapheme 하나 · 이모지"는 명령이 보고(`block/page-icon.ts`), DB 는 표현할 수 있는 부분만 막는다 — 페이지 행만 · 객체 ·
    // type=emoji · 비지 않은 16 코드포인트 이하의 공백 없는 글 · 다른 키 없음.
    const addBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, '{}'::jsonb, $9::jsonb, now(), now())`
    const pageId = randomUUID()
    await client.query(addBlock, [pageId, wsId, 'page', 'workspace', wsId, `icon-${pageId}`, [], pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '👨‍👩‍👧‍👦' } })])
    ok('페이지에 ZWJ 가족 이모지 아이콘(코드포인트 7개)')
    const setFormat = `UPDATE block SET format = $2::jsonb WHERE id = $1`
    await client.query(setFormat, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '1️⃣' }, block_color: 'red' })])
    ok('키캡 아이콘 · 다른 format 키와 함께')
    await mustReject('문자열 아이콘(노션 내부 모양)', setFormat, [pageId, JSON.stringify({ page_icon: '🌱' })])
    await mustReject('null 아이콘(지우기는 키를 뺀다)', setFormat, [pageId, JSON.stringify({ page_icon: null })])
    // 이미지(file · external)는 0039 가 넓혔다 — [25]. 노션의 내장 아이콘 세트(`custom_emoji`)는 받지 않는다(§3.2-66).
    await mustReject('모르는 아이콘 종류', setFormat, [pageId, JSON.stringify({ page_icon: { type: 'custom_emoji', id: 'x' } })])
    await mustReject('글자가 아닌 이모지', setFormat, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: 7 } })])
    await mustReject('빈 이모지', setFormat, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '' } })])
    await mustReject('공백이 든 이모지', setFormat, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '🚀 ' } })])
    await mustReject('16 코드포인트를 넘는 이모지', setFormat, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: 'x'.repeat(17) } })])
    await mustReject('다른 키가 붙은 아이콘', setFormat, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '🌱', url: 'https://example.com' } })])
    await mustReject('본문 블록(문단)의 아이콘', addBlock, [
      randomUUID(), wsId, 'paragraph', 'block', pageId, 'a0', [pageId], pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '🌱' } }),
    ])
  }

  console.log('\n[24] 데이터베이스 아이콘의 모양 (0038 / §3.5 [보강] 데이터베이스 아이콘 ② · 8c-3b조각)')
  {
    // 자리는 `database.icon` 이다(블록의 `format.page_icon` 은 페이지 행만 — [23]). 모양은 페이지 아이콘과 같고, 없으면 SQL NULL.
    const dbId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'database', 'workspace', $2, $3, '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [dbId, wsId, `dbicon-${dbId}`],
    )
    await client.query(
      `INSERT INTO database (id, icon, created_at, updated_at) VALUES ($1, $2::jsonb, now(), now())`,
      [dbId, JSON.stringify({ type: 'emoji', emoji: '👨‍👩‍👧‍👦' })],
    )
    ok('데이터베이스에 ZWJ 가족 이모지 아이콘(코드포인트 7개)')
    const setIcon = `UPDATE database SET icon = $2::jsonb WHERE id = $1`
    await client.query(setIcon, [dbId, null])
    ok('아이콘 없음은 SQL NULL')
    await client.query(setIcon, [dbId, JSON.stringify({ type: 'emoji', emoji: '1️⃣' })])
    ok('키캡 아이콘')
    await mustReject('JSON null 아이콘(없음은 SQL NULL 하나다)', setIcon, [dbId, 'null'])
    await mustReject('문자열 아이콘', setIcon, [dbId, JSON.stringify('📚')])
    await mustReject('모르는 아이콘 종류', setIcon, [dbId, JSON.stringify({ type: 'custom_emoji', id: 'x' })])
    await mustReject('글자가 아닌 이모지', setIcon, [dbId, JSON.stringify({ type: 'emoji', emoji: 7 })])
    await mustReject('빈 이모지', setIcon, [dbId, JSON.stringify({ type: 'emoji', emoji: '' })])
    await mustReject('공백이 든 이모지', setIcon, [dbId, JSON.stringify({ type: 'emoji', emoji: '📚 ' })])
    await mustReject('16 코드포인트를 넘는 이모지', setIcon, [dbId, JSON.stringify({ type: 'emoji', emoji: 'x'.repeat(17) })])
    await mustReject('다른 키가 붙은 아이콘', setIcon, [dbId, JSON.stringify({ type: 'emoji', emoji: '📚', url: 'https://example.com' })])
    await mustReject('데이터베이스 블록의 format.page_icon(자리는 database.icon)', `UPDATE block SET format = $2::jsonb WHERE id = $1`, [
      dbId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '📚' } }),
    ])
  }

  console.log('\n[25] 이미지 아이콘의 모양 (0039 / §3.4 [보강] 페이지 아이콘 ② · §3.5 [보강] 데이터베이스 아이콘 ② · 8c-4조각)')
  {
    // 두 자리가 같은 판정 함수(`icon_shape_ok`)를 지난다 — emoji | file(file_id) | external(url). 파일이 이 워크스페이스의
    // 이미지인지는 명령이 본다(jsonb 안의 id 에 FK 를 걸 수 없다).
    const pageId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, $3, '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [pageId, wsId, `imgicon-${pageId}`],
    )
    const dbId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'database', 'workspace', $2, $3, '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [dbId, wsId, `imgicon-db-${dbId}`],
    )
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbId])
    const fileIcon = { type: 'file', file_id: randomUUID() }
    const externalIcon = { type: 'external', url: 'https://example.com/icon.png?size=64' }
    const setPage = `UPDATE block SET format = $2::jsonb WHERE id = $1`
    const setDb = `UPDATE database SET icon = $2::jsonb WHERE id = $1`
    await client.query(setPage, [pageId, JSON.stringify({ page_icon: fileIcon })])
    ok('페이지에 올린 파일 아이콘')
    await client.query(setPage, [pageId, JSON.stringify({ page_icon: externalIcon, block_color: 'red' })])
    ok('페이지에 외부 이미지 아이콘 · 다른 format 키와 함께')
    await client.query(setDb, [dbId, JSON.stringify(fileIcon)])
    await client.query(setDb, [dbId, JSON.stringify(externalIcon)])
    ok('데이터베이스에 올린 파일 · 외부 이미지 아이콘')
    await client.query(setPage, [pageId, JSON.stringify({ page_icon: { type: 'emoji', emoji: '🌱' } })])
    ok('이모지는 그대로 받는다')

    const both = [
      ['file_id 가 uuid 가 아니다', { type: 'file', file_id: 'not-a-uuid' }],
      ['file_id 가 대문자 uuid(명령은 소문자로 쓴다)', { type: 'file', file_id: randomUUID().toUpperCase() }],
      ['file_id 가 글이 아니다', { type: 'file', file_id: 7 }],
      ['파일 아이콘에 다른 키', { ...fileIcon, url: 'https://example.com/a.png' }],
      ['javascript: 주소', { type: 'external', url: 'javascript:alert(1)' }],
      ['상대 주소', { type: 'external', url: '/api/workspaces/x/files/y/content' }],
      ['공백이 든 주소', { type: 'external', url: 'https://example.com/a b.png' }],
      ['2048자를 넘는 주소', { type: 'external', url: `https://example.com/${'a'.repeat(2048)}` }],
      ['외부 아이콘에 다른 키', { ...externalIcon, file_id: fileIcon.file_id }],
      ['노션 API 의 중첩 모양({external:{url}})', { type: 'external', external: { url: 'https://example.com/a.png' } }],
    ]
    for (const [label, icon] of both) {
      await mustReject(`페이지 — ${label}`, setPage, [pageId, JSON.stringify({ page_icon: icon })])
      await mustReject(`데이터베이스 — ${label}`, setDb, [dbId, JSON.stringify(icon)])
    }
    await mustReject('배열 아이콘(객체가 아니면 오류가 아니라 거부)', setDb, [dbId, JSON.stringify([fileIcon])])
  }

  console.log('\n[26] 버전이 담은 로그 위치 (0040 / §3.7 [보강] 버전 기록 ① · 8d-1조각)')
  {
    // 한 위치에 버전은 하나 · 위치는 1 이상 · 이유값은 정본의 다섯(0007).
    const pageId = randomUUID()
    const addVersion = `INSERT INTO page_version (id, page_id, state_ref, state_vector, byte_size, editor_ids, reason, through_seq, created_at, expires_at)
                        VALUES ($1, $2, $3, '\\x00'::bytea, 1, '{}', $4, $5, now(), now() + interval '7 days')`
    await client.query(addVersion, [randomUUID(), pageId, 'versions/x/y/a.yjs', 'idle', 3])
    ok('버전 하나(through_seq 3)')
    await client.query(addVersion, [randomUUID(), pageId, 'versions/x/y/b.yjs', 'interval', 5])
    ok('같은 페이지의 다른 위치')
    await mustReject('같은 페이지 · 같은 위치의 두 번째 버전', addVersion, [randomUUID(), pageId, 'versions/x/y/c.yjs', 'manual', 3])
    await mustReject('위치 0', addVersion, [randomUUID(), randomUUID(), 'versions/x/y/d.yjs', 'idle', 0])
    await mustReject('위치가 없다(NULL)', addVersion, [randomUUID(), randomUUID(), 'versions/x/y/e.yjs', 'idle', null])
    await mustReject('정본에 없는 이유값', addVersion, [randomUUID(), randomUUID(), 'versions/x/y/f.yjs', 'autosave', 1])
  }

  console.log('\n[27] 복원으로 만든 버전 (0041 / §3.7 [보강] 복원 ② · 8d-3조각)')
  {
    // 이유값에 restore 가 있다 · restored_from 은 restore 버전에만.
    const pageId = randomUUID()
    const addVersion = `INSERT INTO page_version (id, page_id, state_ref, state_vector, byte_size, editor_ids, reason, restored_from, through_seq, created_at, expires_at)
                        VALUES ($1, $2, 'versions/x/y/z.yjs', '\\x00'::bytea, 1, '{}', $3, $4, $5, now(), now() + interval '7 days')`
    const target = randomUUID()
    await client.query(addVersion, [target, pageId, 'idle', null, 1])
    ok('쉼 버전 — 출처 없음')
    await client.query(addVersion, [randomUUID(), pageId, 'pre_restore', null, 2])
    ok('되돌리기 전 버전 — 출처 없음')
    await client.query(addVersion, [randomUUID(), pageId, 'restore', target, 3])
    ok('복원 버전 — 출처가 있다')
    await mustReject('출처 없는 복원 버전', addVersion, [randomUUID(), pageId, 'restore', null, 4])
    await mustReject('출처가 있는 쉼 버전', addVersion, [randomUUID(), pageId, 'idle', target, 5])
    await mustReject('출처가 있는 되돌리기 전 버전', addVersion, [randomUUID(), pageId, 'pre_restore', target, 6])
    await mustReject('없는 버전을 출처로', addVersion, [randomUUID(), pageId, 'restore', randomUUID(), 7])
  }

  console.log('\n[28] 데이터베이스 하나에 data source 여럿 (0042 / §3.5 DS1 · DS3 · [보강] 다중 data source · 8e-1조각)')
  {
    // 데이터베이스 둘 — A 는 소스 둘, B 는 소스 하나. 뷰는 붙은 소스만 · DB 뷰는 데이터베이스가 있어야 · 소유 부착 행은 있어야 하고 지울 수 없다.
    const root = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'q0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [root, wsId],
    )
    const database = async (key) => {
      const id = randomUUID()
      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                            ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
         VALUES ($1, $2, 'database', 'block', $3, $4, $5, $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [id, wsId, root, key, [root]],
      )
      await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [id])
      return id
    }
    const source = async (databaseId, key) => {
      const id = randomUUID()
      await client.query(
        `INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '소스', now(), now())`,
        [id, databaseId],
      )
      await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, $3)`, [
        databaseId,
        id,
        key,
      ])
      return id
    }
    const dbA = await database('a0')
    const dbB = await database('a1')
    const a1 = await source(dbA, 'a0')
    const a2 = await source(dbA, 'a1')
    const b1 = await source(dbB, 'a0')
    const checks = ['tg_data_source_owner_attachment', 'tg_data_source_owner_detach']
    const immediate = async () => {
      for (const name of checks) await client.query(`SET CONSTRAINTS ${name} IMMEDIATE`)
    }
    const deferred = async () => {
      for (const name of checks) await client.query(`SET CONSTRAINTS ${name} DEFERRED`)
    }
    try {
      await immediate()
      ok('소스 둘을 가진 데이터베이스 — 소유 부착 행과 함께 넣으면 통과한다')
    } catch (e) {
      fail(`정상 경로가 DS1 에 걸렸다 (${e.code})`)
    }
    await deferred()

    const addView = `INSERT INTO view (id, owner_kind, database_id, data_source_id, type, order_idx, configuration, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, 'table', 'a0', '{}'::jsonb, now(), now())`
    await client.query(addView, [randomUUID(), 'database_view', dbA, a2])
    ok('뷰가 자기 데이터베이스의 둘째 소스를 본다')
    await mustReject('★ 뷰가 다른 데이터베이스의 소스를 본다', addView, [randomUUID(), 'database_view', dbA, b1])
    await mustReject('★ 이미 있는 뷰를 다른 데이터베이스의 소스로 옮긴다', `UPDATE view SET data_source_id = $2 WHERE database_id = $1`, [dbA, b1])
    await mustReject('DB 뷰인데 데이터베이스가 없다', addView, [randomUUID(), 'database_view', null, a1])

    // DS1 · DS3 — 지연 제약. 그 자리에서 돌려 본다.
    const mustRejectDeferred = async (label, statements) => {
      await client.query('SAVEPOINT probe')
      try {
        for (const [sql, params] of statements) await client.query(sql, params)
        await immediate()
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        ok(`${label} — 거부됨 (${e.code})`)
      }
      await deferred()
    }
    await mustRejectDeferred('★ DS1: 소유 부착 행 없이 data source 를 만든다', [
      [`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '맨몸', now(), now())`, [randomUUID(), dbA]],
    ])
    await mustRejectDeferred('★ DS1: 남의 데이터베이스에만 붙인 data source', [
      [`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000000a1', $1, '엇갈림', now(), now())`, [dbA]],
      [`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, '00000000-0000-4000-8000-0000000000a1', 'z0')`, [dbB]],
    ])
    await mustRejectDeferred('★ DS3: 소유 부착 행을 지운다(소스는 남는다)', [
      [`DELETE FROM database_data_source WHERE database_id = $1 AND data_source_id = $2`, [dbA, a2]],
    ])
    await mustRejectDeferred('★ DS3: 소유 부착 행을 다른 데이터베이스로 바꾼다(뷰가 없는 소스 — FK 가 아니라 이 검사가 막는다)', [
      [`UPDATE database_data_source SET database_id = $2 WHERE data_source_id = $1`, [a1, dbB]],
    ])
    await mustRejectDeferred('★ DS1: 주인을 바꾸고 새 주인에 붙이지 않는다', [
      [`UPDATE data_source SET owner_database_id = $2 WHERE id = $1`, [a2, dbB]],
    ])

    // 정당한 삭제는 지나간다 — data source 를 지우면 CASCADE 가 부착 행을 지우지만 커밋 때 그 소스가 없다(0013 이 BEFORE 트리거로 막지 못한 것).
    await client.query('SAVEPOINT drop')
    try {
      await client.query(`DELETE FROM data_source WHERE id = $1`, [a2])
      await immediate()
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM view WHERE data_source_id = $1`, [a2])
      if (rows[0].n === 0) ok('data source 를 지우면 부착 행 · 그 위의 뷰가 CASCADE 되고 DS3 에 걸리지 않는다')
      else fail(`data source 를 지웠는데 뷰가 ${rows[0].n}개 남았다`)
    } catch (e) {
      fail(`data source 삭제가 DS3 에 걸렸다 (${e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT drop')
    await deferred()
    await client.query('SAVEPOINT dropdb')
    try {
      await client.query(`DELETE FROM block WHERE id = $1`, [dbA])
      await immediate()
      ok('데이터베이스를 지우면 소스 · 부착 행이 함께 CASCADE 되고 DS1 · DS3 에 걸리지 않는다')
    } catch (e) {
      fail(`데이터베이스 삭제가 DS1 · DS3 에 걸렸다 (${e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT dropdb')
    await deferred()
  }

  console.log('\n[29] data source 휴지통 (0043 / §3.5 [보강] 다중 data source ⑩ · DSL1 · 8e-3a조각)')
  {
    // 데이터베이스 하나 · 소스 둘(살아 있는 A · 휴지통으로 보낼 B) · B 에 행 하나. 수명주기 CHECK 과 DSL1(살아 있지 않은 소스에 살아 있는 행 없음).
    const root = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 'r0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [root, wsId],
    )
    const dbId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'database', 'block', $3, 'r1', $4, $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [dbId, wsId, root, [root]],
    )
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbId])
    const source = async (key) => {
      const id = randomUUID()
      await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '소스', now(), now())`, [id, dbId])
      await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, $3)`, [dbId, id, key])
      return id
    }
    const a = await source('a0')
    const b = await source('a1')
    const row = async (ds, key, lifecycle = 'live') => {
      const id = randomUUID()
      await client.query(
        `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key, ancestor_path, perm_scope_id,
                            properties, format, created_at, last_edited_at, lifecycle, trashed_at, trash_root_id)
         VALUES ($1, $2, 'page', 'data_source', $3, $4, $5, $6, '{}'::jsonb, '{}'::jsonb, now(), now(), $7::block_lifecycle,
                 CASE WHEN $7 = 'live' THEN NULL ELSE now() END, CASE WHEN $7 = 'live' THEN NULL ELSE $3::uuid END)`,
        [id, wsId, ds, key, [root, dbId], root, lifecycle],
      )
      await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [id, ds])
      return id
    }
    const rowA = await row(a, 'p0')
    const rowB = await row(b, 'p0')

    const trashSource = `UPDATE data_source SET lifecycle = 'trashed', trashed_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`
    const trashRows = `UPDATE block SET lifecycle = 'trashed', trashed_at = now(), trash_root_id = $1 WHERE parent_id = $1 AND lifecycle = 'live'`
    const checks = ['tg_data_source_rows_follow', 'tg_data_source_rows_follow_source', 'tg_data_source_owner_attachment', 'tg_data_source_owner_detach']
    const immediate = async () => {
      for (const name of checks) await client.query(`SET CONSTRAINTS ${name} IMMEDIATE`)
    }
    const deferred = async () => {
      for (const name of checks) await client.query(`SET CONSTRAINTS ${name} DEFERRED`)
    }
    const mustRejectDeferred = async (label, statements) => {
      await client.query('SAVEPOINT probe')
      try {
        for (const [sql, params] of statements) await client.query(sql, params)
        await immediate()
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        ok(`${label} — 거부됨 (${e.code})`)
      }
      await deferred()
    }

    // 수명주기 CHECK — 블록의 ck_lifecycle_ts 와 같은 모양
    await mustReject('휴지통인데 trashed_at 이 없다', `UPDATE data_source SET lifecycle = 'trashed', purge_after = now() WHERE id = $1`, [a])
    await mustReject('휴지통인데 만료 시각이 없다', `UPDATE data_source SET lifecycle = 'trashed', trashed_at = now() WHERE id = $1`, [a])
    await mustReject('살아 있는데 만료 시각이 있다', `UPDATE data_source SET purge_after = now() WHERE id = $1`, [a])
    await mustReject('영구 삭제인데 purged_at 이 없다', `UPDATE data_source SET lifecycle = 'purged', trashed_at = now() WHERE id = $1`, [a])

    // DSL1. 앞에서 넣은 행의 지연 검사를 여기서 털어낸다 — 남겨 두면 아래 프로브에서 그 행 쪽 검사가 함께 터져, 소스 쪽 검사가
    // 막는지 가를 수 없다(반사실이 그것을 보였다).
    await immediate()
    await deferred()
    await mustRejectDeferred('★ DSL1: 살아 있는 행을 남기고 소스만 휴지통으로', [[trashSource, [b]]])
    await client.query('SAVEPOINT together')
    try {
      await client.query(trashSource, [b])
      await client.query(trashRows, [b])
      await immediate()
      ok('소스와 행을 한 트랜잭션에서 함께 휴지통으로 — 통과한다')
    } catch (e) {
      fail(`정상 경로(함께 휴지통)가 DSL1 에 걸렸다 (${e.code})`)
    }
    await deferred()
    await mustRejectDeferred('★ DSL1: 휴지통 소스의 행 하나만 되살린다', [
      [`UPDATE block SET lifecycle = 'live', trashed_at = NULL, trash_root_id = NULL WHERE id = $1`, [rowB]],
    ])
    await client.query('SAVEPOINT newrow')
    try {
      await row(b, 'p1')
      await immediate()
      fail('★ DSL1: 휴지통 소스에 살아 있는 행을 만든다 — 거부되어야 하는데 통과했다')
    } catch (e) {
      ok(`★ DSL1: 휴지통 소스에 살아 있는 행을 만든다 — 거부됨 (${e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT newrow')
    await deferred()
    await mustRejectDeferred('★ DSL1: 살아 있는 행을 휴지통 소스로 옮긴다', [
      [`UPDATE block SET parent_id = $2, order_key = 'p9' WHERE id = $1`, [rowA, b]],
    ])
    await client.query('SAVEPOINT back')
    try {
      await client.query(`UPDATE data_source SET lifecycle = 'live', trashed_at = NULL, purge_after = NULL WHERE id = $1`, [b])
      await client.query(`UPDATE block SET lifecycle = 'live', trashed_at = NULL, trash_root_id = NULL WHERE trash_root_id = $1`, [b])
      await immediate()
      ok('소스와 그 묶음을 함께 되살리면 통과한다')
    } catch (e) {
      fail(`정상 경로(함께 되살리기)가 DSL1 에 걸렸다 (${e.code})`)
    }
    await deferred()
    await client.query('ROLLBACK TO SAVEPOINT together')
  }

  console.log('\n[30] 행의 레이아웃 (0044 / §3.6 T1 · M1 · M2 · [보강] 행의 레이아웃 · 8f-2조각)')
  {
    // 데이터베이스 하나 · 소스 둘(A · B) · 소스마다 속성 하나 · 소스마다 레이아웃 한 벌(머리 · content 탭 · heading · 그룹).
    const root = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'page', 'workspace', $2, 's0', '{}', $1, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [root, wsId],
    )
    const dbId = randomUUID()
    await client.query(
      `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                          ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
       VALUES ($1, $2, 'database', 'block', $3, 's1', $4, $3, '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [dbId, wsId, root, [root]],
    )
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbId])
    const source = async (key) => {
      const id = randomUUID()
      await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '소스', now(), now())`, [id, dbId])
      await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, $3)`, [dbId, id, key])
      return id
    }
    const property = async (ds) => {
      const id = randomUUID().replaceAll('-', '').slice(0, 21)
      await client.query(`INSERT INTO property (id, data_source_id, name, type, order_idx) VALUES ($1, $2, '수량', 'number', 'a0')`, [id, ds])
      return id
    }
    const layout = async (ds) => {
      const ids = { tab: randomUUID(), heading: randomUUID(), group: randomUUID() }
      await client.query(`INSERT INTO page_layout (data_source_id) VALUES ($1)`, [ds])
      await client.query(`INSERT INTO layout_tab (id, data_source_id, kind, order_idx) VALUES ($1, $2, 'content', 'a0')`, [ids.tab, ds])
      await client.query(`INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, order_idx) VALUES ($1, $2, $3, 'heading', 'heading', 'a0')`, [ids.heading, ds, ids.tab])
      await client.query(`INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, order_idx) VALUES ($1, $2, $3, 'property_group', 'main', 'a0')`, [ids.group, ds, ids.tab])
      return ids
    }
    const a = await source('a0')
    const b = await source('a1')
    const pa = await property(a)
    const pb = await property(b)
    const la = await layout(a)
    const lb = await layout(b)
    const mod = `INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, parent_module_id, property_id, visible, order_idx)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
    // 숨김 — 그룹을 부모로 진 property 행 · 보이지 않음 · 자기 순서 없음(스키마 순서를 따른다)
    await client.query(mod, [randomUUID(), a, la.tab, 'property', 'main', la.group, pa, false, null])
    ok('레이아웃 한 벌과 숨긴 속성 행(순서 없음) — 정상 경로가 통과한다')

    // 겨냥한 제약이 막았는지 이름으로 본다 — 다른 제약이 먼저 걸리면 그 제약을 뺀 반사실이 살아남는다(§3.3-261 ①).
    const mustRejectBy = async (label, constraint, sql, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(sql, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    await mustRejectBy('★ T1: 소스의 둘째 content 탭', 'layout_tab_one_content',
      `INSERT INTO layout_tab (id, data_source_id, kind, order_idx) VALUES ($1, $2, 'content', 'a1')`, [randomUUID(), a])
    await mustRejectBy('linked_view 탭인데 뷰가 없다', 'ck_layout_tab_view',
      `INSERT INTO layout_tab (id, data_source_id, kind, order_idx) VALUES ($1, $2, 'linked_view', 'a1')`, [randomUUID(), a])
    await mustRejectBy('★ M1: 탭의 둘째 heading', 'layout_module_one_heading', mod, [randomUUID(), a, la.tab, 'heading', 'heading', null, null, true, 'a1'])
    await mustRejectBy('★ M1: heading 을 heading 영역 밖으로', 'ck_layout_module_heading_area',
      `UPDATE layout_module SET area = 'main' WHERE id = $1`, [la.heading])
    await mustRejectBy('★ M2: 탭의 둘째 property_group', 'layout_module_one_group', mod, [randomUUID(), a, la.tab, 'property_group', 'main', null, null, true, 'a1'])
    await mustRejectBy('한 탭에 같은 속성을 두 번', 'layout_module_prop_once', mod, [randomUUID(), a, la.tab, 'property', 'main', la.group, pa, true, null])
    await mustRejectBy('property 모듈인데 속성이 없다', 'ck_layout_module_property', mod, [randomUUID(), a, la.tab, 'property', 'main', la.group, null, true, null])
    await mustRejectBy('★ 순서 없는 모듈은 property 행뿐 — 순서 없는 섹션', 'ck_layout_module_order', mod, [randomUUID(), a, la.tab, 'section', 'main', la.group, null, true, null])
    await mustRejectBy('★ 모듈의 탭이 다른 소스의 것', 'fk_layout_module_tab_source', mod, [randomUUID(), b, la.tab, 'section', 'main', null, null, true, 'a1'])
    await mustRejectBy('★ 다른 소스의 속성을 숨긴다', 'fk_layout_module_property_source', mod, [randomUUID(), a, la.tab, 'property', 'main', la.group, pb, false, null])
    await mustRejectBy('★ 부모 모듈이 다른 탭의 것', 'fk_layout_module_parent_tab', mod, [randomUUID(), b, lb.tab, 'property', 'main', la.group, pb, false, null])

    // CASCADE — 속성을 영구히 지우면 그 모듈만, 소스를 영구히 지우면 레이아웃 한 벌이 사라진다.
    const count = async (sql, params) => (await client.query(sql, params)).rows[0].n
    await client.query('SAVEPOINT cascade')
    await client.query(`DELETE FROM property WHERE id = $1`, [pa])
    const afterProperty = await count(`SELECT count(*)::int AS n FROM layout_module WHERE data_source_id = $1`, [a])
    await client.query(`DELETE FROM data_source WHERE id = $1`, [a])
    const afterSource = await count(
      `SELECT (SELECT count(*) FROM page_layout WHERE data_source_id = $1) + (SELECT count(*) FROM layout_tab WHERE data_source_id = $1)
            + (SELECT count(*) FROM layout_module WHERE data_source_id = $1) AS n`, [a])
    const otherSource = await count(`SELECT count(*)::int AS n FROM layout_module WHERE data_source_id = $1`, [b])
    if (afterProperty === 2 && Number(afterSource) === 0 && otherSource === 2) ok('속성을 지우면 그 모듈만 · 소스를 지우면 레이아웃 한 벌이 CASCADE 된다 — 다른 소스는 그대로')
    else fail(`CASCADE 가 어긋났다 — 속성 뒤 모듈 ${afterProperty} · 소스 뒤 ${afterSource} · 다른 소스 모듈 ${otherSource}`)
    await client.query('ROLLBACK TO SAVEPOINT cascade')
  }

  console.log('\n[31] 설정 값 표 (0045 / §3.1 [보강] 설정 값 표 · 테마 ① · SV1 ~ SV4 · 8h조각)')
  {
    const put = `INSERT INTO setting_value (scope, user_id, workspace_id, key, value) VALUES ($1, $2, $3, $4, $5::jsonb)`
    await client.query(put, ['account', userId, null, 'account.theme', '"dark"'])
    await client.query(put, ['workspace', null, wsId, 'workspace.sample', 'true'])
    ok('계정의 값 · 워크스페이스의 값 — 정상 경로가 통과한다')

    const mustRejectBy = async (label, constraint, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(put, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    await mustRejectBy('모르는 범위', 'ck_setting_value_scope', ['device', null, null, 'device.contrast', '"high"'])
    await mustRejectBy('★ SV1: 계정의 값인데 주인이 없다', 'ck_setting_value_account_owner', ['account', null, null, 'account.theme', '"dark"'])
    await mustRejectBy('★ SV1: 계정의 값에 워크스페이스가 붙었다', 'ck_setting_value_workspace_owner', ['account', userId, wsId, 'account.other', '"x"'])
    await mustRejectBy('★ SV1: 워크스페이스의 값에 사람이 붙었다', 'ck_setting_value_account_owner', ['workspace', userId, wsId, 'workspace.other', '1'])
    await mustRejectBy('★ SV2: 키가 범위로 시작하지 않는다', 'ck_setting_value_key', ['account', userId, null, 'workspace.theme', '"dark"'])
    await mustRejectBy('SV2: 범위만 있고 이름이 없는 키', 'ck_setting_value_key', ['account', userId, null, 'account.', '"dark"'])
    await mustRejectBy('★ SV3: 값이 스칼라가 아니다', 'ck_setting_value_scalar', ['account', userId, null, 'account.other', '{"a":1}'])
    await mustRejectBy('★ SV4: 같은 사람의 같은 키가 둘', 'ux_setting_value_account', ['account', userId, null, 'account.theme', '"light"'])
    await mustRejectBy('★ SV4: 같은 워크스페이스의 같은 키가 둘', 'ux_setting_value_workspace', ['workspace', null, wsId, 'workspace.sample', 'false'])
    await mustRejectBy('없는 사람의 값', 'setting_value_user_id_fkey', ['account', randomUUID(), null, 'account.theme', '"dark"'])
  }

  console.log('\n[32] 비밀번호 자격증명 (0046 / §3.2 credential · A5 · [보강] 비밀번호 ② · 8i-1a조각)')
  {
    const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g'
    const put = `INSERT INTO credential (id, user_id, kind, password_hash, provider, provider_sub, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())`
    await client.query(put, [randomUUID(), userId, 'password', HASH, null, null])
    ok('비밀번호 줄 하나(argon2id) — 정상 경로가 통과한다')

    const mustRejectBy = async (label, constraint, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(put, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    const other = randomUUID()
    await client.query(`INSERT INTO "user" (id, name, created_at) VALUES ($1, '비밀번호 둘째', now())`, [other])
    await mustRejectBy('★ A5: 같은 사람의 둘째 비밀번호', 'ux_credential_one_password', [randomUUID(), userId, 'password', HASH, null, null])
    await mustRejectBy('★ 해시 없는 비밀번호 줄', 'ck_credential_password_hash', [randomUUID(), userId, 'password', null, null, null])
    await mustRejectBy('비밀번호가 아닌 줄에 해시', 'ck_credential_password_hash', [randomUUID(), userId, 'oauth', HASH, 'google', `sub-${randomUUID()}`])
    await mustRejectBy('★ argon2id 가 아닌 해시(평문)', 'ck_credential_password_argon2id', [randomUUID(), other, 'password', 'hunter2hunter2', null, null])
  }

  console.log('\n[33] 요금제 · 엔타이틀먼트 · 결제 구독 (0047 / §3.10 plan · plan_entitlement · billing_subscription · PE2 · [보강] 엔타이틀먼트 · 8k-1조각)')
  {
    const rejectBy = async (label, constraint, sql, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(sql, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    const planId = async (code) => (await client.query(`SELECT id FROM plan WHERE code = $1`, [code])).rows[0].id
    const free = await planId('free')
    const plus = await planId('plus')
    const putEntitlement = `INSERT INTO plan_entitlement (plan_id, key, kind, value) VALUES ($1, $2, $3, $4::jsonb)`
    await client.query(putEntitlement, [free, 'probe.flag', 'boolean', 'true'])
    await client.query(putEntitlement, [free, 'probe.count', 'limit', 'null'])
    await client.query(putEntitlement, [free, 'probe.days', 'duration', '7'])
    await client.query(putEntitlement, [free, 'probe.credit', 'credit', '{"monthly": 1000}'])
    ok('엔타이틀먼트 넷(참거짓 · 무제한 한도 · 일수 · 크레딧) — 정상 경로가 통과한다')
    await rejectBy('★ 참거짓 키에 숫자', 'ck_plan_entitlement_value', putEntitlement, [free, 'probe.flag_b', 'boolean', '1'])
    await rejectBy('★ 한도가 음수', 'ck_plan_entitlement_value', putEntitlement, [free, 'probe.count_b', 'limit', '-1'])
    await rejectBy('한도가 정수가 아님', 'ck_plan_entitlement_value', putEntitlement, [free, 'probe.count_c', 'limit', '1.5'])
    await rejectBy('일수가 문자열', 'ck_plan_entitlement_value', putEntitlement, [free, 'probe.days_b', 'duration', '"7"'])
    await rejectBy('크레딧이 객체가 아님', 'ck_plan_entitlement_value', putEntitlement, [free, 'probe.credit_b', 'credit', '5'])
    await rejectBy('키에 점이 없음', 'ck_plan_entitlement_key', putEntitlement, [free, 'probe', 'boolean', 'true'])
    await rejectBy('키에 대문자', 'ck_plan_entitlement_key', putEntitlement, [free, 'Probe.flag', 'boolean', 'true'])

    await rejectBy('★ 없는 요금제를 가리키는 워크스페이스', 'fk_workspace_plan_code', `UPDATE workspace SET plan_code = 'gold' WHERE id = $1`, [wsId])

    const putSubscription = `INSERT INTO billing_subscription (workspace_id, plan_id, status, canceled_at, current_period_start, current_period_end)
                             VALUES ($1, $2, $3, $4, $5, $6)`
    await client.query(putSubscription, [wsId, plus, 'active', null, null, null])
    await client.query(putSubscription, [wsId, plus, 'canceled', new Date(), null, null])
    ok('살아 있는 구독 하나 + 취소된 구독(이력) — 정상 경로가 통과한다')
    await rejectBy('★ 살아 있는 구독이 둘', 'ux_billing_subscription_live', putSubscription, [wsId, plus, 'grace', null, null, null])
    await rejectBy('취소했는데 취소 시각이 없음', 'ck_billing_subscription_canceled', putSubscription, [wsId, plus, 'canceled', null, null, null])
    await rejectBy('살아 있는데 취소 시각이 있음', 'ck_billing_subscription_canceled', putSubscription, [wsId, plus, 'active', new Date(), null, null])
    await rejectBy('기간이 거꾸로', 'ck_billing_subscription_period', putSubscription,
      [wsId, plus, 'canceled', new Date(), new Date('2026-02-01'), new Date('2026-01-01')])
  }

  console.log('\n[34] 고유 ID (0050 / §3.5 [보강] 고유 ID · U1 · U2 · ⑦ · 2a-1조각)')
  {
    const rejectBy = async (label, constraint, sql, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(sql, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'u0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'u0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, 'ID 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    const putProp = `INSERT INTO property (id, data_source_id, name, type, order_idx, deleted_at, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, now(), now())`
    const uid = (n) => `u${String(n).padStart(20, '0')}`
    await client.query(putProp, [uid(1), ds, '이름', 'title', 'a0', null])
    await client.query(putProp, [uid(2), ds, 'ID', 'unique_id', 'a1', null])
    await client.query(putProp, [uid(3), ds, '옛 ID', 'unique_id', 'a2', new Date()])
    ok('살아 있는 ID 프로퍼티 하나 + 지운 ID 프로퍼티 — 정상 경로가 통과한다')
    await rejectBy('★ U1: 살아 있는 ID 프로퍼티가 둘', 'ux_property_unique_id_one', putProp, [uid(4), ds, 'ID 둘째', 'unique_id', 'a3', null])

    const setPrefix = `UPDATE data_source SET unique_id_prefix = $2 WHERE id = $1`
    await client.query(setPrefix, [ds, 'TASK'])
    await client.query(setPrefix, [ds, 'A1B2C3D'])
    await client.query(setPrefix, [ds, null])
    ok('접두사 — 대문자 영숫자 4자 · 7자 · 없음이 통과한다')
    await rejectBy('★ ⑦: 접두사에 소문자', 'ck_data_source_unique_id_prefix', setPrefix, [ds, 'task'])
    await rejectBy('⑦: 접두사가 한 글자', 'ck_data_source_unique_id_prefix', setPrefix, [ds, 'T'])
    await rejectBy('⑦: 접두사가 여덟 글자', 'ck_data_source_unique_id_prefix', setPrefix, [ds, 'ABCDEFGH'])
    await rejectBy('⑦: 접두사에 하이픈', 'ck_data_source_unique_id_prefix', setPrefix, [ds, 'TA-SK'])

    const putRow = async (key, isTemplate, seq) => {
      const id = randomUUID()
      await client.query(putBlock, [id, wsId, 'page', 'data_source', ds, key, [root, dbBlock], root])
      await client.query(`INSERT INTO page (id, data_source_id, is_template, unique_seq) VALUES ($1, $2, $3, $4)`, [id, ds, isTemplate, seq])
      return id
    }
    await putRow('r0', false, 1)
    const template = await putRow('r1', true, null)
    ok('번호가 있는 행 · 번호가 없는 템플릿 — 정상 경로가 통과한다')
    await rejectBy('★ U2: 템플릿이 번호를 가진다', 'ck_page_template_no_unique_seq', `UPDATE page SET unique_seq = 7 WHERE id = $1`, [template])
    await rejectBy('같은 표에서 같은 번호(0013 — 동시 발급의 마지막 방어)', 'ux_page_unique_seq', `UPDATE page SET unique_seq = 1 WHERE id = $1`, [await putRow('r2', false, 2)])
  }

  console.log('\n[35] 하위 항목 (0051 / §3.5 [보강] 하위 항목 · SI1 · SI2 · SI3 · 2b-1조각)')
  {
    const rejectBy = async (label, constraint, statements, deferred = null) => {
      await client.query('SAVEPOINT probe')
      try {
        for (const [sql, params] of statements) await client.query(sql, params)
        if (deferred !== null) await client.query(`SET CONSTRAINTS ${deferred} IMMEDIATE`)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'zsub0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'zsub0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '하위 항목 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    const sid = (n) => `s${String(n).padStart(20, '0')}`
    const putProp = `INSERT INTO property (id, data_source_id, name, type, config, order_idx, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), now())`
    const parent = sid(2)
    const children = sid(3)
    await client.query(putProp, [sid(1), ds, '이름', 'title', '{}', 'a0'])
    await client.query(putProp, [parent, ds, '상위 항목', 'relation', JSON.stringify({ target_data_source_id: ds, synced_property_id: children, limit: 'one', sub_items: 'parent' }), 'a1'])
    await client.query(putProp, [children, ds, '하위 항목', 'relation', JSON.stringify({ target_data_source_id: ds, synced_property_id: parent, sub_items: 'children' }), 'a2'])
    ok('상위 항목 · 하위 항목 짝 — 정상 경로가 통과한다')

    await rejectBy('★ 표시가 relation 이 아닌 프로퍼티에', 'ck_property_sub_items',
      [[putProp, [sid(4), ds, '숫자', 'number', JSON.stringify({ sub_items: 'parent' }), 'a3']]])
    await rejectBy('★ 표시가 다른 표를 가리키는 relation 에', 'ck_property_sub_items',
      [[putProp, [sid(4), ds, '다른 표', 'relation', JSON.stringify({ target_data_source_id: randomUUID(), sub_items: 'parent' }), 'a3']]])
    await rejectBy('표시의 값이 둘 중 하나가 아니다', 'ck_property_sub_items',
      [[putProp, [sid(4), ds, '이상한', 'relation', JSON.stringify({ target_data_source_id: ds, sub_items: 'sibling' }), 'a3']]])
    await rejectBy('★ SI1: 살아 있는 상위 항목이 둘', 'ux_property_sub_items',
      [[putProp, [sid(4), ds, '상위 항목 둘째', 'relation', JSON.stringify({ target_data_source_id: ds, limit: 'one', sub_items: 'parent' }), 'a3']]])

    const row = async (key) => {
      const id = randomUUID()
      await client.query(putBlock, [id, wsId, 'page', 'data_source', ds, key, [root, dbBlock], root])
      await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [id, ds])
      return id
    }
    const [a, b, c] = [await row('r0'), await row('r1'), await row('r2')]
    const edge = `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx, role) VALUES ($1, $2, $3, 'a0', $4)`
    const pair = (child, par) => [[edge, [parent, child, par, null]], [edge, [children, par, child, 'sub_item']]]
    for (const [sql, params] of pair(a, b)) await client.query(sql, params)
    const roles = (await client.query(`SELECT property_id, role FROM relation_edge WHERE (from_page_id = $1 AND to_page_id = $2) OR (from_page_id = $2 AND to_page_id = $1)`, [a, b])).rows
    const roleOf = (pid) => roles.find((r) => r.property_id === pid)?.role ?? null
    if (roleOf(parent) === 'sub_item' && roleOf(children) === null) ok('★ role 은 DB 가 매긴다 — 자식 → 부모 엣지만 sub_item · 거울상에 쓴 값은 덮인다')
    else fail(`role 을 DB 가 매기지 않았다: ${JSON.stringify(roles)}`)

    await rejectBy('★ SI2: 부모가 둘', 'ux_relation_edge_one_parent', [[edge, [parent, a, c, null]]])
    await rejectBy('★ SI3: 자기 자신이 부모', 'tg_relation_edge_no_cycle', [[edge, [parent, c, c, null]]], 'tg_relation_edge_no_cycle')
    await rejectBy('★ SI3: 자기 자손이 부모(a 의 부모는 b · b 의 부모로 a)', 'tg_relation_edge_no_cycle', pair(b, a), 'tg_relation_edge_no_cycle')
    for (const [sql, params] of pair(c, a)) await client.query(sql, params)
    try {
      await client.query('SET CONSTRAINTS tg_relation_edge_no_cycle IMMEDIATE')
      ok('SI3: c → a → b 사슬은 통과한다')
    } catch (e) {
      fail(`SI3: 순환이 아닌 사슬이 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('SET CONSTRAINTS tg_relation_edge_no_cycle DEFERRED')
  }

  console.log('\n[36] 종속 관계 (0052 / §3.5 [보강] 종속 관계 · DP1 · DP2 · 2b-3조각)')
  {
    const rejectBy = async (label, constraint, statements, deferred = null) => {
      await client.query('SAVEPOINT probe')
      try {
        for (const [sql, params] of statements) await client.query(sql, params)
        if (deferred !== null) await client.query(`SET CONSTRAINTS ${deferred} IMMEDIATE`)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'zdep0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'zdep0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '종속 관계 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    const did = (n) => `d${String(n).padStart(20, '0')}`
    const putProp = `INSERT INTO property (id, data_source_id, name, type, config, order_idx, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), now())`
    const blockedBy = did(2)
    const blocking = did(3)
    await client.query(putProp, [did(1), ds, '이름', 'title', '{}', 'a0'])
    await client.query(putProp, [blockedBy, ds, '선행 작업', 'relation', JSON.stringify({ target_data_source_id: ds, synced_property_id: blocking, dependencies: 'blocked_by' }), 'a1'])
    await client.query(putProp, [blocking, ds, '후행 작업', 'relation', JSON.stringify({ target_data_source_id: ds, synced_property_id: blockedBy, dependencies: 'blocking' }), 'a2'])
    ok('선행 작업 · 후행 작업 짝 — 정상 경로가 통과한다')

    await rejectBy('★ 표시가 다른 표를 가리키는 relation 에', 'ck_property_dependencies',
      [[putProp, [did(4), ds, '다른 표', 'relation', JSON.stringify({ target_data_source_id: randomUUID(), dependencies: 'blocked_by' }), 'a3']]])
    await rejectBy('★ 하위 항목과 종속 관계를 한 프로퍼티가 함께', 'ck_property_dependencies',
      [[putProp, [did(4), ds, '둘 다', 'relation', JSON.stringify({ target_data_source_id: ds, sub_items: 'parent', dependencies: 'blocked_by' }), 'a3']]])
    await rejectBy('표시의 값이 둘 중 하나가 아니다', 'ck_property_dependencies',
      [[putProp, [did(4), ds, '이상한', 'relation', JSON.stringify({ target_data_source_id: ds, dependencies: 'sideways' }), 'a3']]])
    await rejectBy('★ DP1: 살아 있는 선행 작업이 둘', 'ux_property_dependencies',
      [[putProp, [did(4), ds, '선행 작업 둘째', 'relation', JSON.stringify({ target_data_source_id: ds, dependencies: 'blocked_by' }), 'a3']]])

    const row = async (key) => {
      const id = randomUUID()
      await client.query(putBlock, [id, wsId, 'page', 'data_source', ds, key, [root, dbBlock], root])
      await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [id, ds])
      return id
    }
    const [a, b, c, d] = [await row('r0'), await row('r1'), await row('r2'), await row('r3')]
    const edge = `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx, role) VALUES ($1, $2, $3, 'a0', $4)`
    // (막히는 행, 막는 행) — 선행 작업 엣지와 그 거울상.
    const blocks = (blocked, blocker) => [[edge, [blockedBy, blocked, blocker, null]], [edge, [blocking, blocker, blocked, 'dependency']]]
    for (const [sql, params] of [...blocks(a, b), ...blocks(a, c), ...blocks(b, d), ...blocks(c, d)]) await client.query(sql, params)
    const roles = (await client.query(`SELECT property_id, role FROM relation_edge WHERE from_page_id = $1 OR to_page_id = $1`, [a])).rows
    if (roles.every((r) => (r.property_id === blockedBy ? r.role === 'dependency' : r.role === null))) ok('★ role 은 DB 가 매긴다 — 선행 작업 엣지만 dependency · 거울상에 쓴 값은 덮인다')
    else fail(`role 을 DB 가 매기지 않았다: ${JSON.stringify(roles)}`)
    try {
      await client.query('SET CONSTRAINTS tg_relation_edge_no_dependency_cycle IMMEDIATE')
      ok('DP2: 다이아몬드(a ← b, c ← d)는 순환이 아니다 — 통과한다')
    } catch (e) {
      fail(`DP2: 순환이 아닌 그래프가 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('SET CONSTRAINTS tg_relation_edge_no_dependency_cycle DEFERRED')
    await rejectBy('★ DP2: 자기 자신이 막는다', 'tg_relation_edge_no_dependency_cycle', blocks(b, b), 'tg_relation_edge_no_dependency_cycle')
    await rejectBy('★ DP2: 사슬 끝이 처음을 막는다(d 가 a 에게 막힘)', 'tg_relation_edge_no_dependency_cycle', blocks(d, a), 'tg_relation_edge_no_dependency_cycle')
  }

  console.log('\n[37] 셀 봉투의 타입 (0053 / §3.5 [보강] 프로퍼티 타입 바꾸기 ⑥ · CV1 · 2c-1조각)')
  {
    const rejectBy = async (label, constraint, sql, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(sql, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'zconv0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'zconv0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '봉투 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    const cid = (n) => `c${String(n).padStart(20, '0')}`
    const putProp = `INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())`
    await client.query(putProp, [cid(1), ds, '이름', 'title', 'a0'])
    await client.query(putProp, [cid(2), ds, '수량', 'number', 'a1'])
    const rowId = randomUUID()
    await client.query(putBlock, [rowId, wsId, 'page', 'data_source', ds, 'r0', [root, dbBlock], root])
    await client.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [rowId, ds])
    const putCell = `INSERT INTO page_property_value (page_id, property_id, value, num_value, updated_at) VALUES ($1, $2, $3::jsonb, $4, now())`
    await client.query(putCell, [rowId, cid(2), JSON.stringify({ type: 'number', number: 5 }), 5])
    ok('숫자 프로퍼티에 숫자 봉투 — 정상 경로가 통과한다')
    await rejectBy('★ CV1: 숫자 프로퍼티에 글 봉투', 'tg_ppv_value_type',
      `UPDATE page_property_value SET value = $3::jsonb WHERE page_id = $1 AND property_id = $2`,
      [rowId, cid(2), JSON.stringify({ type: 'rich_text', rich_text: [] })])
    await rejectBy('CV1: 봉투에 타입이 없다', 'tg_ppv_value_type',
      `UPDATE page_property_value SET value = $3::jsonb WHERE page_id = $1 AND property_id = $2`,
      [rowId, cid(2), JSON.stringify({ number: 5 })])
    await client.query(`UPDATE property SET type = 'rich_text' WHERE id = $1`, [cid(2)])
    await rejectBy('★ CV1: 프로퍼티의 타입이 바뀐 뒤 옛 타입으로 다시 쓴다(변환과 엇갈린 쓰기)', 'tg_ppv_value_type',
      `UPDATE page_property_value SET value = $3::jsonb WHERE page_id = $1 AND property_id = $2`,
      [rowId, cid(2), JSON.stringify({ type: 'number', number: 6 })])
  }

  console.log('\n[38] 열 집계의 함수 이름 (0054 / §3.6 [보강] 열 집계 ① · 2d-1조각)')
  {
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const viewId = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'zcalc0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'zcalc0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '집계 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    const kid = (n) => `k${String(n).padStart(20, '0')}`
    await client.query(`INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at) VALUES ($1, $2, '이름', 'title', 'a0', now(), now())`, [kid(1), ds])
    await client.query(
      `INSERT INTO view (id, database_id, data_source_id, type, order_idx, configuration, created_at, updated_at)
       VALUES ($1, $2, $3, 'table', 'a0', '{}'::jsonb, now(), now())`,
      [viewId, dbBlock, ds],
    )
    const putColumn = `INSERT INTO view_property (view_id, property_id, order_idx, calculation) VALUES ($1, $2, 'a0', $3)`
    await client.query('SAVEPOINT probe')
    try {
      await client.query(putColumn, [viewId, kid(1), 'count_all'])
      await client.query(`UPDATE view_property SET calculation = NULL WHERE view_id = $1`, [viewId])
      ok('함수 이름 · 비움 — 정상 경로가 통과한다')
    } catch (e) {
      fail(`정상 경로가 거부됐다 (${e.constraint ?? e.code})`)
    }
    try {
      await client.query(`UPDATE view_property SET calculation = 'sum_of_squares' WHERE view_id = $1`, [viewId])
      fail('★ 목록 밖의 함수 이름 — 거부되어야 하는데 통과했다')
    } catch (e) {
      if (e.constraint === 'ck_view_property_calculation') ok(`★ 목록 밖의 함수 이름 — ck_view_property_calculation 가 거부함 (${e.code})`)
      else fail(`목록 밖의 함수 이름 — ck_view_property_calculation 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
  }

  console.log('\n[39] 그룹 머리의 계산 (0055 / §3.6 [보강] 열 집계 ⑤ · 2d-3조각)')
  {
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const viewId = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'zgcalc0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'zgcalc0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '그룹 집계 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    await client.query(
      `INSERT INTO view (id, database_id, data_source_id, type, order_idx, configuration, created_at, updated_at)
       VALUES ($1, $2, $3, 'board', 'a0', '{}'::jsonb, now(), now())`,
      [viewId, dbBlock, ds],
    )
    const setGroup = `UPDATE view SET group_by = $2::jsonb WHERE id = $1`
    const group = (calculation) => JSON.stringify({ property_id: 'g'.repeat(21), calculation })
    const rejectBy = async (label, constraint, sql, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(sql, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    await client.query('SAVEPOINT probe')
    try {
      await client.query(setGroup, [viewId, JSON.stringify({ property_id: 'g'.repeat(21) })])
      await client.query(setGroup, [viewId, group({ property_id: 'n'.repeat(21), function: 'sum' })])
      ok('계산 없음 · 함수 이름 — 정상 경로가 통과한다')
    } catch (e) {
      fail(`정상 경로가 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
    await rejectBy('★ 목록 밖의 함수 이름', 'ck_view_group_by_calculation', setGroup, [viewId, group({ property_id: 'n'.repeat(21), function: 'sum_of_squares' })])
    await rejectBy('★ 속성이 없다', 'ck_view_group_by_calculation', setGroup, [viewId, group({ function: 'sum' })])
    await rejectBy('계산이 객체가 아니다', 'ck_view_group_by_calculation', setGroup, [viewId, group('sum')])
    await rejectBy('함수 이름이 글이 아니다', 'ck_view_group_by_calculation', setGroup, [viewId, group({ property_id: 'n'.repeat(21), function: 1 })])
    // 0054 의 제약을 같은 이름으로 다시 걸었다 — 목록 함수(`is_calculation_name`)를 보는지
    const kid = 'q'.repeat(21)
    await client.query(`INSERT INTO property (id, data_source_id, name, type, order_idx, created_at, updated_at) VALUES ($1, $2, '이름', 'title', 'a0', now(), now())`, [kid, ds])
    await rejectBy('★ 열 집계의 목록 밖 함수 이름 — 다시 건 제약', 'ck_view_property_calculation',
      `INSERT INTO view_property (view_id, property_id, order_idx, calculation) VALUES ($1, $2, 'a0', 'sum_of_squares')`, [viewId, kid])
  }

  console.log('\n[40] 갤러리 레이아웃 (0057 / §3.6 [보강] 갤러리 ④ · 2f-2조각)')
  {
    const root = randomUUID()
    const dbBlock = randomUUID()
    const ds = randomUUID()
    const viewId = randomUUID()
    const putBlock = `INSERT INTO block (id, workspace_id, type, parent_type, parent_id, order_key,
                                         ancestor_path, perm_scope_id, properties, format, created_at, last_edited_at)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, '{}'::jsonb, now(), now())`
    await client.query(putBlock, [root, wsId, 'page', 'workspace', wsId, 'zgal0', [], root])
    await client.query(putBlock, [dbBlock, wsId, 'database', 'block', root, 'zgal0', [root], root])
    await client.query(`INSERT INTO database (id, created_at, updated_at) VALUES ($1, now(), now())`, [dbBlock])
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '갤러리 표', now(), now())`, [ds, dbBlock])
    await client.query(`INSERT INTO database_data_source (database_id, data_source_id, order_idx) VALUES ($1, $2, 'a0')`, [dbBlock, ds])
    await client.query(
      `INSERT INTO view (id, database_id, data_source_id, type, order_idx, configuration, created_at, updated_at)
       VALUES ($1, $2, $3, 'gallery', 'a0', '{}'::jsonb, now(), now())`,
      [viewId, dbBlock, ds],
    )
    const setConfig = `UPDATE view SET configuration = $2::jsonb WHERE id = $1`
    const layout = (over) => JSON.stringify({ other: 1, gallery: { cover: 'page_content', cover_size: 'medium', cover_aspect: 'cover', ...over } })
    const rejectBy = async (label, constraint, sql, params) => {
      await client.query('SAVEPOINT probe')
      try {
        await client.query(sql, params)
        await client.query('ROLLBACK TO SAVEPOINT probe')
        fail(`${label} — 거부되어야 하는데 통과했다`)
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT probe')
        if (e.constraint === constraint) ok(`${label} — ${constraint} 가 거부함 (${e.code})`)
        else fail(`${label} — ${constraint} 가 아니라 ${e.constraint ?? e.code} 에 걸렸다`)
      }
    }
    await client.query('SAVEPOINT probe')
    try {
      await client.query(setConfig, [viewId, JSON.stringify({ other: 1 })])
      await client.query(setConfig, [viewId, layout({ cover: 'none', cover_size: 'large', cover_aspect: 'contain' })])
      ok('갤러리 키 없음 · 세 키 모두 — 정상 경로가 통과한다')
    } catch (e) {
      fail(`정상 경로가 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
    await rejectBy('★ 모르는 미리보기', 'ck_view_gallery_layout', setConfig, [viewId, layout({ cover: 'page_cover' })])
    await rejectBy('★ 키가 빠졌다(NULL 이면 통과하는 구멍)', 'ck_view_gallery_layout', setConfig,
      [viewId, JSON.stringify({ gallery: { cover: 'none', cover_size: 'small' } })])
    await rejectBy('모르는 크기', 'ck_view_gallery_layout', setConfig, [viewId, layout({ cover_size: 'huge' })])
    await rejectBy('갤러리 키가 객체가 아니다', 'ck_view_gallery_layout', setConfig, [viewId, JSON.stringify({ gallery: 'large' })])

    console.log('\n[41] 캘린더 레이아웃 (0058 / §3.6 [보강] 캘린더 · 2g-1조각)')
    const calendar = (over) => JSON.stringify({ gallery: { cover: 'none', cover_size: 'small', cover_aspect: 'cover' }, calendar: { date_property_id: 'd'.repeat(21), view_range: 'month', ...over } })
    await client.query('SAVEPOINT probe')
    try {
      await client.query(setConfig, [viewId, calendar({})])
      await client.query(setConfig, [viewId, calendar({ view_range: 'week' })])
      ok('날짜 속성 · 달 · 주 — 정상 경로가 통과한다(갤러리 키와 함께)')
    } catch (e) {
      fail(`정상 경로가 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
    await rejectBy('★ 날짜 속성이 없다(NULL 이면 통과하는 구멍)', 'ck_view_calendar_layout', setConfig,
      [viewId, JSON.stringify({ calendar: { view_range: 'month' } })])
    await rejectBy('★ 모르는 보기 단위', 'ck_view_calendar_layout', setConfig, [viewId, calendar({ view_range: 'year' })])
    await rejectBy('날짜 속성이 글이 아니다', 'ck_view_calendar_layout', setConfig, [viewId, calendar({ date_property_id: 7 })])

    console.log('\n[42] 개인 필터 · 정렬 (0059 / §3.6 view_user_override · 2h-1조각)')
    const someUser = (await client.query(`SELECT id FROM "user" LIMIT 1`)).rows[0].id
    const putOverride = `INSERT INTO view_user_override (view_id, user_id, filter, sorts) VALUES ($1, $2, $3::jsonb, $4::jsonb)`
    await client.query('SAVEPOINT probe')
    try {
      await client.query(putOverride, [viewId, someUser, JSON.stringify({ op: 'and', children: [] }), null])
      await client.query(`UPDATE view_user_override SET sorts = '[]'::jsonb WHERE view_id = $1`, [viewId])
      ok('필터만 · 정렬도 — 정상 경로가 통과한다')
    } catch (e) {
      fail(`정상 경로가 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
    await rejectBy('★ 두 칸 다 비었다(덮어쓴 것이 없는 행)', 'ck_view_user_override_some', putOverride, [viewId, someUser, null, null])
    await rejectBy('필터가 객체가 아니다', 'ck_view_user_override_shape', putOverride, [viewId, someUser, JSON.stringify([1]), null])
    await rejectBy('정렬이 배열이 아니다', 'ck_view_user_override_shape', putOverride, [viewId, someUser, null, JSON.stringify({})])
    await client.query('SAVEPOINT probe')
    try {
      await client.query(putOverride, [viewId, someUser, null, JSON.stringify([])])
      await client.query(`DELETE FROM view WHERE id = $1`, [viewId])
      const left = (await client.query(`SELECT count(*)::int AS n FROM view_user_override WHERE view_id = $1`, [viewId])).rows[0].n
      if (left === 0) ok('★ 뷰를 지우면 그 뷰의 개인 설정도 사라진다(cascade)')
      else fail(`뷰를 지웠는데 개인 설정 ${left}개가 남았다`)
    } catch (e) {
      fail(`cascade 확인 중 오류 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')

    console.log('\n[43] 수식 속성 · 의존 그래프 (0060 / §3.5 property_dependency · [보강] 수식 1단계 · 2i-2조각)')
    const putProperty = `INSERT INTO property (id, data_source_id, name, type, order_idx, config, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())`
    const numberProp = 'n'.repeat(21)
    const formulaProp = 'f'.repeat(21)
    const elsewhere = 'x'.repeat(21)
    const otherDs = randomUUID()
    await client.query(`INSERT INTO data_source (id, owner_database_id, name, created_at, updated_at) VALUES ($1, $2, '다른 표', now(), now())`, [otherDs, dbBlock])
    await client.query(putProperty, [numberProp, ds, '시간', 'number', 'b0', '{}'])
    await client.query(putProperty, [elsewhere, otherDs, '남의 시간', 'number', 'b0', '{}'])
    const putEdge = `INSERT INTO property_dependency (dependent_property_id, source_property_id, via_relation_id) VALUES ($1, $2, $3)`
    await client.query('SAVEPOINT probe')
    try {
      await client.query(putProperty, [formulaProp, ds, '두 배', 'formula', 'b1', JSON.stringify({ expression: `\u27e6${numberProp}\u27e7 * 2`, result_type: 'number' })])
      await client.query(putEdge, [formulaProp, numberProp, null])
      ok('수식(식 · 결과 타입) · 같은 표의 간선 — 정상 경로가 통과한다')
    } catch (e) {
      fail(`정상 경로가 거부됐다 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
    await rejectBy('★ 식이 없다(NULL 이면 통과하는 구멍)', 'ck_property_formula_config', putProperty,
      [formulaProp, ds, '두 배', 'formula', 'b1', JSON.stringify({ result_type: 'number' })])
    await rejectBy('★ 모르는 결과 타입', 'ck_property_formula_config', putProperty,
      [formulaProp, ds, '두 배', 'formula', 'b1', JSON.stringify({ expression: '1', result_type: 'list' })])
    await rejectBy('식이 글이 아니다', 'ck_property_formula_config', putProperty,
      [formulaProp, ds, '두 배', 'formula', 'b1', JSON.stringify({ expression: 1, result_type: 'number' })])
    await rejectBy('칸 속성을 설정 없이 수식으로 바꾼다', 'ck_property_formula_config',
      `UPDATE property SET type = 'formula' WHERE id = $1`, [numberProp])

    await client.query(putProperty, [formulaProp, ds, '두 배', 'formula', 'b1', JSON.stringify({ expression: '1', result_type: 'number' })])
    await rejectBy('★ 자기 자신을 읽는 간선', 'ck_property_dependency_not_self', putEdge, [formulaProp, formulaProp, null])
    await rejectBy('★ relation 을 타지 않는데 다른 표의 속성을 읽는다', 'tg_property_dependency_same_source', putEdge, [formulaProp, elsewhere, null])
    await client.query('SAVEPOINT probe')
    try {
      await client.query(putEdge, [formulaProp, numberProp, null])
      await client.query(`DELETE FROM property WHERE id = $1`, [numberProp])
      const left = (await client.query(`SELECT count(*)::int AS n FROM property_dependency WHERE dependent_property_id = $1`, [formulaProp])).rows[0].n
      if (left === 0) ok('★ 읽던 속성의 행이 사라지면 간선도 사라진다(cascade)')
      else fail(`읽던 속성을 지웠는데 간선 ${left}개가 남았다`)
    } catch (e) {
      fail(`cascade 확인 중 오류 (${e.constraint ?? e.code})`)
    }
    await client.query('ROLLBACK TO SAVEPOINT probe')
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
