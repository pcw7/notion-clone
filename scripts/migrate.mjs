#!/usr/bin/env node
/**
 * raw SQL 마이그레이션 러너.
 *
 *   npm run db:migrate           미적용 마이그레이션 실행
 *   npm run db:migrate:status    적용 현황 출력
 *
 * ORM 을 쓰지 않는 이유: 정본 스키마(docs/research/00-canonical-data-model.md)가
 * 부분 인덱스 · GIN on uuid[] · 생성 컬럼 · 파티셔닝 · DEFERRABLE 순환 FK 를 쓴다.
 * 스키마를 소유하려는 ORM 은 이것들을 표현하지 못하거나 매번 싸운다.
 * 스키마는 SQL 로 쓰고, 애플리케이션은 그것을 읽기만 한다.
 *
 * 규칙
 *   - 파일명은 `NNNN_snake_case.sql`. 번호는 단조 증가하며 재사용하지 않는다.
 *   - 적용된 마이그레이션 파일은 **수정하지 않는다.** 체크섬이 어긋나면 실행을 거부한다.
 *     고칠 것이 있으면 새 마이그레이션을 추가한다.
 *   - 각 마이그레이션은 하나의 트랜잭션에서 돈다. CREATE INDEX CONCURRENTLY 처럼
 *     트랜잭션 안에서 못 도는 것이 있으면 파일 첫 줄에 `-- migrate:no-transaction`.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const MIGRATIONS_DIR = 'db/migrations'
const LOCK_KEY = 8_421_337 // pg_advisory_lock — 동시 실행 방지

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
const DATABASE_URL = env.DATABASE_URL ?? 'postgresql://notion:notion_dev_only@localhost:5432/notion'
const STATUS_ONLY = process.argv.includes('--status')

/** db/migrations/*.sql 를 번호순으로 읽는다. */
function readMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return []
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const m = file.match(/^(\d{4})_(.+)\.sql$/)
      if (!m) throw new Error(`파일명 규칙 위반 (NNNN_name.sql): ${file}`)
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      return {
        version: m[1],
        name: m[2],
        file,
        sql,
        checksum: createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16),
        noTransaction: /^\s*--\s*migrate:no-transaction/m.test(sql),
      }
    })
}

const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 })

try {
  await client.connect()
} catch (e) {
  console.error(`\nPostgres 접속 실패: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
  console.error(`  ${e.message}`)
  console.error('\n컨테이너가 떠 있는지 확인하세요: npm run db:up\n')
  process.exit(1)
}

let exitCode = 0

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version     text PRIMARY KEY,
      name        text        NOT NULL,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL
    )
  `)

  const migrations = readMigrations()
  const { rows: applied } = await client.query(
    'SELECT version, name, checksum, applied_at, duration_ms FROM schema_migration ORDER BY version',
  )
  const appliedByVersion = new Map(applied.map((r) => [r.version, r]))

  // 적용된 마이그레이션이 수정되었는지 먼저 검사한다. 이미 반영된 스키마와
  // 파일이 어긋난 상태로 새 마이그레이션을 얹으면 원인 추적이 불가능해진다.
  const drifted = migrations.filter(
    (m) => appliedByVersion.has(m.version) && appliedByVersion.get(m.version).checksum !== m.checksum,
  )
  if (drifted.length) {
    console.error('\n적용된 마이그레이션 파일이 수정되었습니다:')
    for (const d of drifted) {
      console.error(`  ${d.file}`)
      console.error(`    DB: ${appliedByVersion.get(d.version).checksum}  파일: ${d.checksum}`)
    }
    console.error('\n적용된 마이그레이션은 수정하지 않습니다. 새 마이그레이션을 추가하세요.\n')
    process.exit(1)
  }

  const missingFiles = applied.filter((a) => !migrations.some((m) => m.version === a.version))
  if (missingFiles.length) {
    console.error(
      `\nDB 에 기록된 마이그레이션의 파일이 없습니다: ${missingFiles.map((m) => m.version).join(', ')}\n`,
    )
    process.exit(1)
  }

  if (STATUS_ONLY) {
    console.log(`\n마이그레이션 ${migrations.length}개 (적용 ${applied.length}개)\n`)
    for (const m of migrations) {
      const a = appliedByVersion.get(m.version)
      if (a) {
        const when = new Date(a.applied_at).toISOString().replace('T', ' ').slice(0, 19)
        console.log(`  o ${m.version}  ${m.name.padEnd(28)} ${when}  ${a.duration_ms}ms`)
      } else {
        console.log(`  · ${m.version}  ${m.name.padEnd(28)} 미적용`)
      }
    }
    console.log('')
    process.exit(0)
  }

  const pending = migrations.filter((m) => !appliedByVersion.has(m.version))
  if (pending.length === 0) {
    console.log('\n적용할 마이그레이션이 없습니다. 스키마가 최신입니다.\n')
    process.exit(0)
  }

  // 동시 실행 방지 (CI 와 로컬이 겹칠 수 있다)
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])

  console.log(`\n미적용 마이그레이션 ${pending.length}개\n`)

  for (const m of pending) {
    const started = Date.now()
    process.stdout.write(`  ${m.version} ${m.name} ... `)
    try {
      if (!m.noTransaction) await client.query('BEGIN')
      await client.query(m.sql)
      const ms = Date.now() - started
      await client.query(
        'INSERT INTO schema_migration (version, name, checksum, duration_ms) VALUES ($1,$2,$3,$4)',
        [m.version, m.name, m.checksum, ms],
      )
      if (!m.noTransaction) await client.query('COMMIT')
      console.log(`${ms}ms`)
    } catch (e) {
      if (!m.noTransaction) await client.query('ROLLBACK').catch(() => {})
      console.log('실패')
      console.error(`\n${m.file} 적용 실패:`)
      console.error(`  ${e.message}`)
      if (e.position) {
        const upto = m.sql.slice(0, Number(e.position))
        console.error(`  위치: ${upto.split('\n').length}번째 줄 부근`)
      }
      if (e.hint) console.error(`  힌트: ${e.hint}`)
      console.error('')
      exitCode = 1
      break
    }
  }

  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])

  if (exitCode === 0) console.log('\n마이그레이션 완료.\n')
} finally {
  await client.end()
}

process.exit(exitCode)
