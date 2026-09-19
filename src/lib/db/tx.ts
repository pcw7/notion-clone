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

/** `withCommandTransaction` 이 롤백을 일으키려고 안에서 던지는 표식. 밖으로 나가지 않는다. */
class CommandRejected<T> extends Error {
  readonly result: T
  constructor(result: T) {
    super('command rejected')
    this.result = result
  }
}

/**
 * **명령**을 위한 트랜잭션 — 콜백이 `{ ok: false }` 를 돌려주면 **ROLLBACK** 하고 그 값을 그대로 돌려준다.
 *
 * 이 저장소의 명령은 거부를 던지지 않고 값으로 돌려준다(`{ ok: false, reason }`). `withTransaction` 은 "정상 반환 =
 * COMMIT" 이라 **쓴 뒤에 거부를 돌려주면 그 쓰기가 커밋된다.** 실제로 둘이 그랬다:
 *
 *   · `group.ts` `moveRow` — 셀을 쓰고 옛 자리를 지운 **뒤에** `beforeRowId` 를 검사했다. 화면이 낡아서 거부된 이동이
 *     셀 값은 바꿔 놓은 채 `not_found` 를 돌려줬고, 화면은 낙관적 이동을 되돌려 서버와 어긋났다(#103 이 재현 · 수정)
 *   · `relation.ts` `addRelationProperty` — 첫 프로퍼티를 넣은 뒤 역방향의 이름이 겹치면 반쪽짜리 relation 이 남았다
 *
 * 검사를 쓰기 앞에 두는 것이 먼저다(헛된 쓰기도 없다). 이것은 그 규율이 깨졌을 때의 **안전망**이다 — 거부된 명령은 어떤
 * 경우에도 아무것도 바꾸지 않는다.
 *
 * ⚠ 거부하면서도 **남겨야 하는 것**이 있는 명령에는 쓰지 않는다(로그인 코드의 실패 횟수처럼). 그건 `withTransaction` 이다.
 */
export async function withCommandTransaction<T extends { readonly ok: boolean }>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(async (tx) => {
      const result = await fn(tx)
      if (!result.ok) throw new CommandRejected(result)
      return result
    })
  } catch (e) {
    if (e instanceof CommandRejected) return e.result as T
    throw e
  }
}

/**
 * 읽기 전용 트랜잭션. 스냅샷 일관성이 필요한 조회에 쓴다
 * (예: 권한 판정과 그 결과로 읽는 데이터가 같은 시점이어야 할 때).
 *
 * ★ **REPEATABLE READ** 다. PostgreSQL 의 기본(READ COMMITTED)은 **문장마다** 새 스냅샷을
 *   찍어서, `readableScopes` 를 읽은 뒤 행을 읽는 사이에 커밋된 권한 변경이 섞였다 — 이 머리말의
 *   약속이 지켜지지 않고 있었다. `tx.db.test.ts` 가 먼저 재현했다(두 문장 사이에 커밋한 행이 보였다).
 *   REPEATABLE READ 는 첫 문장의 스냅샷을 끝까지 쓴다. 읽기 전용 트랜잭션은 직렬화 실패가 나지
 *   않으므로 재시도 루프가 필요 없다.
 */
export async function withReadTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
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
