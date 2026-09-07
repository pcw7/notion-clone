/**
 * 트랜잭션 헬퍼.
 *
 * 계정 생성처럼 여러 테이블을 한 단위로 써야 하는 경로가 많다. 특히
 * `user` 와 `user_email` 은 순환 FK(DEFERRABLE INITIALLY DEFERRED)로 묶여 있어
 * **반드시 같은 트랜잭션 안에서** 삽입해야 한다.
 */

import type { PoolClient, QueryResultRow } from 'pg'
import { getPool } from './pool.ts'

/** 트랜잭션 안에서만 쓰는 실행기. 풀이 아니라 고정된 커넥션을 쓴다. */
export type Tx = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>
  queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T>
  queryMaybe<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | null>
  /** 부분 롤백이 필요할 때. 이름은 호출자가 관리한다. */
  savepoint<R>(name: string, fn: () => Promise<R>): Promise<R>
}

function wrap(client: PoolClient): Tx {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T[]> {
      return (await client.query<T>(sql, params as unknown[])).rows
    },
    async queryOne<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T> {
      const rows = (await client.query<T>(sql, params as unknown[])).rows
      if (rows.length !== 1) throw new Error(`정확히 1행을 기대했지만 ${rows.length}행입니다.`)
      return rows[0]
    },
    async queryMaybe<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T | null> {
      const rows = (await client.query<T>(sql, params as unknown[])).rows
      if (rows.length > 1) throw new Error(`최대 1행을 기대했지만 ${rows.length}행입니다.`)
      return rows[0] ?? null
    },
    async savepoint(name, fn) {
      // 식별자는 파라미터화할 수 없으므로 형식을 강제한다
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
        throw new Error(`savepoint 이름은 [a-z_][a-z0-9_]* 여야 합니다: ${name}`)
      }
      await client.query(`SAVEPOINT ${name}`)
      try {
        const r = await fn()
        await client.query(`RELEASE SAVEPOINT ${name}`)
        return r
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
        throw e
      }
    },
  }
}

/**
 * 콜백이 정상 반환하면 COMMIT, 던지면 ROLLBACK 한다.
 * 커넥션은 어떤 경우에도 풀에 반납된다.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(wrap(client))
    await client.query('COMMIT')
    return result
  } catch (e) {
    // 롤백 실패가 원래 예외를 가리지 않게 한다
    await client.query('ROLLBACK').catch((rollbackErr) => {
      console.error('[db] ROLLBACK 실패:', rollbackErr.message)
    })
    throw e
  } finally {
    client.release()
  }
}

/**
 * 읽기 전용 트랜잭션. 스냅샷 일관성이 필요한 조회에 쓴다
 * (예: 권한 판정과 그 결과로 읽는 데이터가 같은 시점이어야 할 때).
 */
export async function withReadTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN READ ONLY')
    const result = await fn(wrap(client))
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
