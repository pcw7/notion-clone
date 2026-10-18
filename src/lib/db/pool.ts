/**
 * Postgres 커넥션 풀.
 *
 * ORM 을 쓰지 않는다(CLAUDE.md). 정본 스키마가 부분 인덱스 · GIN on uuid[] ·
 * 생성 컬럼 · 파티셔닝 · DEFERRABLE 순환 FK 를 쓰기 때문이다.
 * 스키마는 SQL 이 소유하고, 여기서는 그것을 읽기만 한다.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg'

declare global {
  // Next.js 개발 모드는 모듈을 다시 평가한다. 그때마다 새 풀을 만들면
  // 커넥션이 계속 새고 결국 Postgres 의 max_connections 에 걸린다.
  var __notionClonePool: Pool | undefined
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL 이 설정되지 않았습니다. .env.example 를 .env 로 복사하세요.')
  }

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // 애플리케이션 이름을 붙여두면 pg_stat_activity 에서 누가 붙었는지 보인다
    application_name: 'notion-clone',
  })

  // 유휴 커넥션에서 나는 에러는 여기서 잡지 않으면 프로세스를 죽인다
  pool.on('error', (err) => {
    console.error('[db] 유휴 커넥션 오류:', err.message)
  })

  return pool
}

export function getPool(): Pool {
  if (!globalThis.__notionClonePool) {
    globalThis.__notionClonePool = createPool()
  }
  return globalThis.__notionClonePool
}

/**
 * 쿼리 계측(플랫폼 잔여 10l-1 · F-12-07) — `PERF_SQL=1` 이면 쿼리마다 `[sql] 시각 소요 행수 프로세스:SQL머리` 한 줄을 찍는다. 측정 판
 * (`E2E_PERF` · HANDOFF §6)이 서버 출력에서 이 줄을 모아 "요청 하나에 쿼리 몇 개 · 몇 단계"로 묶는다. 앱과 협업 서버가 한 출력에 섞이므로
 * 프로세스 표지를 단다. 꺼져 있으면 비용이 없다(분기 하나).
 */
export const perfSqlEnabled = process.env.PERF_SQL === '1'
const PROCESS_TAG = process.argv[1]?.includes('collab') ? 'collab' : 'app'

export function logSql(startedAt: number, rowCount: number | null, sql: string, prefix = ''): void {
  console.log(`[sql] ${startedAt.toFixed(1)} ${(performance.now() - startedAt).toFixed(1)} ${rowCount ?? 0} ${PROCESS_TAG}:${prefix}${sql.replace(/\s+/g, ' ').trim().slice(0, 80)}`)
}

/** 풀에서 한 번 실행. 트랜잭션이 필요하면 withTransaction 을 쓴다. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  if (perfSqlEnabled) {
    const startedAt = performance.now()
    const result = await getPool().query<T>(sql, params as unknown[])
    logSql(startedAt, result.rowCount, sql)
    return result.rows
  }
  const result = await getPool().query<T>(sql, params as unknown[])
  return result.rows
}

/** 정확히 한 행을 기대한다. 0행이거나 2행 이상이면 던진다. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const rows = await query<T>(sql, params)
  if (rows.length !== 1) {
    throw new Error(`정확히 1행을 기대했지만 ${rows.length}행입니다.`)
  }
  return rows[0]
}

/** 0 또는 1행. 없으면 null. */
export async function queryMaybe<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  if (rows.length > 1) {
    throw new Error(`최대 1행을 기대했지만 ${rows.length}행입니다.`)
  }
  return rows[0] ?? null
}

export type { PoolClient }

/** 테스트·스크립트 종료용. 애플리케이션 코드에서는 부르지 않는다. */
export async function closePool(): Promise<void> {
  const pool = globalThis.__notionClonePool
  if (pool) {
    globalThis.__notionClonePool = undefined
    await pool.end()
  }
}
