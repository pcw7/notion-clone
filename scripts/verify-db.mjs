#!/usr/bin/env node
/**
 * 로컬 DB 컨테이너가 정본 데이터 모델의 전제를 만족하는지 확인한다.
 *
 *   npm run db:verify
 *
 * 확인 항목
 *   1. 필수 확장 4개 (pg_bigm, pg_trgm, citext, pgcrypto)
 *   2. 데이터베이스 collation — 나중에 바꿀 수 없으므로 지금 확인해야 한다
 *   3. pg_bigm 이 한국어를 실제로 2-gram 으로 쪼개는지 (설치만 되고 안 되는 경우가 있다)
 *   4. Valkey 응답
 */

import { spawnSync } from 'node:child_process'

const REQUIRED_EXTENSIONS = ['citext', 'pg_bigm', 'pg_trgm', 'pgcrypto']

/** docker compose 를 통해 psql 을 돌리고 결과를 문자열로 받는다. */
function psql(sql) {
  const r = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'notion', '-d', 'notion', '-At', '-c', sql],
    { encoding: 'utf8' },
  )
  if (r.error) throw new Error(`docker 실행 실패: ${r.error.message}`)
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim())
  return r.stdout.trim()
}

function valkey(...args) {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'cache', 'valkey-cli', ...args], {
    encoding: 'utf8',
  })
  if (r.error) throw new Error(`docker 실행 실패: ${r.error.message}`)
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim())
  return r.stdout.trim()
}

let failed = false
const fail = (msg) => {
  failed = true
  console.error(`  x ${msg}`)
}
const ok = (msg) => console.log(`  o ${msg}`)

console.log('\n[1] 필수 확장')
try {
  const rows = psql('SELECT extname || \' \' || extversion FROM pg_extension ORDER BY extname;')
    .split('\n')
    .filter(Boolean)
  const names = rows.map((r) => r.split(' ')[0])
  for (const ext of REQUIRED_EXTENSIONS) {
    const row = rows.find((r) => r.startsWith(ext + ' '))
    if (row) ok(row)
    else fail(`${ext} 없음`)
  }
  const extra = names.filter((n) => !REQUIRED_EXTENSIONS.includes(n) && n !== 'plpgsql')
  if (extra.length) console.log(`  · 그 외: ${extra.join(', ')}`)
} catch (e) {
  fail(`확장 조회 실패 — 컨테이너가 떠 있나요? (npm run db:up)\n     ${e.message.split('\n')[0]}`)
}

console.log('\n[2] 데이터베이스 collation (한 번 정하면 못 바꾼다)')
try {
  // daticulocale 은 PG16 컬럼명이고 PG17 에서 datlocale 로 바뀌었다.
  // 버전에 안 걸리도록 두 버전 모두 있는 컬럼만 읽는다.
  const [encoding, provider, collate] = psql(
    `SELECT pg_encoding_to_char(encoding), datlocprovider, datcollate
       FROM pg_database WHERE datname = current_database();`,
  ).split('|')

  encoding === 'UTF8' ? ok(`encoding = ${encoding}`) : fail(`encoding = ${encoding} (UTF8 이어야 함)`)
  provider === 'i'
    ? ok('locale provider = icu')
    : fail(`locale provider = ${provider} — ICU 가 아니면 다국어 정렬이 바이트 순서가 된다`)
  console.log(`  · libc LC_COLLATE = ${collate}`)
} catch (e) {
  fail(`collation 조회 실패: ${e.message.split('\n')[0]}`)
}

console.log('\n[3] pg_bigm 한국어 2-gram 동작')
try {
  // 설치만 되고 실제로 CJK 를 안 쪼개면 한국어 검색이 통째로 죽는다.
  const grams = psql("SELECT show_bigm('안녕하세요')::text;")
  const count = (grams.match(/,/g) ?? []).length + 1
  if (count >= 4 && grams.includes('안녕')) {
    ok(`show_bigm('안녕하세요') → ${grams}`)
  } else {
    fail(`한국어가 2-gram 으로 쪼개지지 않음: ${grams}`)
  }

  // 최소 쿼리 길이: CJK 1자로도 검색되어야 한다 (§9-Q5)
  const oneChar = psql("SELECT likequery('한');")
  ok(`likequery('한') → ${oneChar}`)
} catch (e) {
  fail(`pg_bigm 동작 확인 실패: ${e.message.split('\n')[0]}`)
}

console.log('\n[4] Valkey')
try {
  const pong = valkey('ping')
  pong.toUpperCase() === 'PONG' ? ok(`ping → ${pong}`) : fail(`예상 밖 응답: ${pong}`)
  const ver = valkey('--version')
  console.log(`  · ${ver}`)
} catch (e) {
  fail(`Valkey 응답 없음: ${e.message.split('\n')[0]}`)
}

console.log('')
if (failed) {
  console.error('DB 환경 검증 실패.\n')
  process.exit(1)
}
console.log('DB 환경 정상 — 스키마 마이그레이션을 진행할 수 있습니다.\n')
