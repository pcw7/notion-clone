#!/usr/bin/env node
/**
 * 로컬 DB 가 정본 데이터 모델의 전제를 만족하는지 확인한다.
 *
 *   npm run db:verify
 *
 * **앱과 똑같은 경로(TCP)로 접속한다.** `docker compose exec` 를 쓰지 않는 이유:
 * 그건 앱이 절대 쓰지 않는 경로다. Windows 의 docker 제어 소켓이 끊겨도
 * localhost:5432 는 멀쩡한 경우가 실제로 있었고, 그때 `docker exec` 기반
 * 검증은 DB 가 죽었다고 잘못 보고했다. 검증은 실제 사용 경로를 재현해야 한다.
 *
 * 확인 항목
 *   1. 필수 확장 4개 (pg_bigm, pg_trgm, citext, pgcrypto)
 *   2. 데이터베이스 collation — 한 번 정하면 못 바꾸므로 지금 확인해야 한다
 *   3. pg_bigm 이 한국어를 실제로 2-gram 으로 쪼개는지 (설치만 되고 안 되는 경우가 있다)
 *   4. Valkey 응답 (RESP PING)
 */

import { readFileSync, existsSync } from 'node:fs'
import { connect } from 'node:net'
import pg from 'pg'

const REQUIRED_EXTENSIONS = ['citext', 'pg_bigm', 'pg_trgm', 'pgcrypto']

/** .env 를 아주 단순하게 읽는다. 의존성을 하나 더 달 이유가 없다. */
function loadEnv(file = '.env') {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnv(), ...process.env }
const DATABASE_URL = env.DATABASE_URL ?? 'postgresql://notion:notion_dev_only@localhost:5432/notion'
const REDIS_URL = env.REDIS_URL ?? 'redis://localhost:6379'

let failed = false
const fail = (msg) => {
  failed = true
  console.error(`  x ${msg}`)
}
const ok = (msg) => console.log(`  o ${msg}`)
const note = (msg) => console.log(`  · ${msg}`)

const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 })

try {
  await client.connect()
} catch (e) {
  console.error(`\nPostgres 접속 실패: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
  console.error(`  ${e.message}`)
  console.error('\n컨테이너가 떠 있는지 확인하세요: npm run db:up\n')
  process.exit(1)
}

try {
  console.log('\n[1] 필수 확장')
  {
    const { rows } = await client.query(
      'SELECT extname, extversion FROM pg_extension ORDER BY extname',
    )
    const byName = new Map(rows.map((r) => [r.extname, r.extversion]))
    for (const ext of REQUIRED_EXTENSIONS) {
      const v = byName.get(ext)
      if (v) ok(`${ext} ${v}`)
      else fail(`${ext} 없음`)
    }
    const extra = rows.map((r) => r.extname).filter((n) => !REQUIRED_EXTENSIONS.includes(n))
    if (extra.length) note(`그 외: ${extra.join(', ')}`)
  }

  console.log('\n[2] 데이터베이스 collation (한 번 정하면 못 바꾼다)')
  {
    // daticulocale 은 PG16 컬럼명이고 PG17 에서 datlocale 로 바뀌었다.
    // 두 버전 모두 존재하는 컬럼만 읽는다.
    const { rows } = await client.query(`
      SELECT pg_encoding_to_char(encoding) AS encoding,
             datlocprovider                AS provider,
             datcollate                    AS collate
        FROM pg_database
       WHERE datname = current_database()
    `)
    const { encoding, provider, collate } = rows[0]

    if (encoding === 'UTF8') ok(`encoding = ${encoding}`)
    else fail(`encoding = ${encoding} (UTF8 이어야 함)`)

    if (provider === 'i') ok('locale provider = icu')
    else fail(`locale provider = ${provider} — ICU 가 아니면 다국어 정렬이 바이트 순서가 된다`)

    note(`libc LC_COLLATE = ${collate}`)

    // ICU 가 실제로 붙었는지는 설정값이 아니라 동작으로 확인한다.
    // C 정렬이면 코드포인트 순서라 'A B a b', ICU 면 'a A b B' 계열이 된다.
    const { rows: sorted } = await client.query(`
      SELECT string_agg(w, ' ' ORDER BY w) AS s
        FROM unnest(ARRAY['b', 'A', 'a', 'B']) AS w
    `)
    if (sorted[0].s.startsWith('A B')) fail(`정렬이 바이트 순서다: ${sorted[0].s}`)
    else ok(`대소문자 혼합 정렬 = ${sorted[0].s}`)
  }

  console.log('\n[3] pg_bigm 한국어 2-gram 동작')
  {
    // 확장이 설치만 되고 CJK 를 안 쪼개면 한국어 검색이 통째로 죽는다.
    const { rows } = await client.query("SELECT show_bigm('안녕하세요')::text AS grams")
    const grams = rows[0].grams
    const count = (grams.match(/,/g) ?? []).length + 1
    if (count >= 4 && grams.includes('안녕')) ok(`show_bigm('안녕하세요') → ${grams} (${count}개)`)
    else fail(`한국어가 2-gram 으로 쪼개지지 않음: ${grams}`)

    // CJK 1자 검색이 되어야 한다 (마스터 문서 §9-Q5)
    const { rows: lq } = await client.query("SELECT likequery('한') AS q")
    if (lq[0].q) ok(`likequery('한') → ${lq[0].q}`)
    else fail("likequery('한') 가 NULL — CJK 1자 검색 불가")

    // 실제 인덱스 검색이 되는지 왕복 확인
    await client.query(`
      CREATE TEMP TABLE _bigm_probe (body text);
      INSERT INTO _bigm_probe VALUES ('노션 클론 프로젝트'), ('전혀 다른 문장');
    `)
    const { rows: hit } = await client.query(
      "SELECT count(*)::int AS n FROM _bigm_probe WHERE body LIKE likequery('클론')",
    )
    if (hit[0].n === 1) ok("LIKE likequery('클론') → 1건 (정확)")
    else fail(`LIKE 검색 결과가 예상과 다름: ${hit[0].n}건 (1이어야 함)`)
  }
} catch (e) {
  fail(`쿼리 실패: ${e.message}`)
} finally {
  await client.end()
}

console.log('\n[4] Valkey')
{
  const u = new URL(REDIS_URL)
  const pong = await new Promise((resolve) => {
    const sock = connect(
      { host: u.hostname, port: Number(u.port || 6379), timeout: 5000 },
      () => sock.write('PING\r\n'),
    )
    sock.on('data', (d) => {
      resolve(d.toString().trim())
      sock.end()
    })
    sock.on('error', (e) => resolve(`ERR ${e.message}`))
    sock.on('timeout', () => {
      resolve('ERR timeout')
      sock.destroy()
    })
  })
  if (pong === '+PONG') ok(`PING → ${pong}`)
  else fail(`예상 밖 응답: ${pong}`)
}

console.log('')
if (failed) {
  console.error('DB 환경 검증 실패.\n')
  process.exit(1)
}
console.log('DB 환경 정상 — 스키마 마이그레이션을 진행할 수 있습니다.\n')
