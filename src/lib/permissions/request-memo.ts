/**
 * 요청 메모 — 화면 요청 하나 안에서 권한의 읽기(주체 집합 · 스코프 · 노드 판정)를 한 번만 (플랫폼 잔여 10l-1 · F-12-07)
 *
 * 정본: 00-canonical-data-model.md §3.11 [보강] 화면 요청 하나 안의 권한 읽기 메모
 *
 * 페이지를 열면 레이아웃 · 화면의 로더 열여덟이 저마다 읽기 트랜잭션을 열고 그 안에서 P(U)(그룹 · teamspace 질의 둘)와 스코프
 * (`scopesWith` — 경계 노드 전부의 사슬 질의)를 따로 읽었다 — 열기마다 쿼리 208개, 그중 170개가 같은 답을 다시 읽는 것이었다(10l-1 측정 ·
 * 병렬이라 벽시계는 180ms 지만 풀을 포화시켜 쿼리 하나가 130~220ms). 같은 요청 · 같은 사람의 답은 같다 — 처음 읽은 것을 요청 안에서 다시 쓴다.
 *
 * **켜는 곳은 하나다** — `requirePageVisitor`(화면 요청마다 하나인 ctx · React `cache`). 그래서 메모의 수명은 그 요청(수십 ms)이다.
 * 협업 서버(연결을 오래 든다) · API 라우트 · 명령은 켜지 않는다 — `SessionContext` 에 P(U) 를 박지 않는 까닭(HANDOFF §3.3-183: 그룹에서 빠진
 * 사람이 옛 그룹으로 판정된다)이 그대로 산다. **쓰기 트랜잭션은 메모를 지나지 않는다** — `Tx.readOnly` 가 없으면 늘 자기 스냅샷에서 읽는다.
 * 판정과 그 결과로 읽는 데이터가 같은 시점이어야 하는 곳(`withReadTransaction` 머리말)은 여전히 한 트랜잭션 안의 이야기고, 메모는 그 트랜잭션들
 * **사이**의 중복만 없앤다 — 요청 안의 로더들은 어차피 저마다 다른 스냅샷을 봤다. 받아들이는 낡음은 요청 하나의 길이다.
 *
 * 실패한 계산은 메모에 남기지 않는다(다음 호출이 다시 읽는다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'

type Memo = { readonly cells: Map<string, Promise<unknown>>; hits: number; misses: number }

const memos = new WeakMap<SessionContext, Memo>()

/** 이 ctx 의 요청 안에서 권한 읽기를 메모한다 — 화면 요청(`requirePageVisitor`)만 부른다(머리말). */
export function enableRequestMemo(ctx: SessionContext): void {
  if (!memos.has(ctx)) memos.set(ctx, { cells: new Map(), hits: 0, misses: 0 })
}

/** 검사 · 진단용 — 켜져 있으면 적중 · 빗나감 수, 아니면 null. */
export function requestMemoStats(ctx: SessionContext): { readonly hits: number; readonly misses: number } | null {
  const memo = memos.get(ctx)
  return memo === undefined ? null : { hits: memo.hits, misses: memo.misses }
}

/**
 * 읽기 전용 트랜잭션이고 ctx 에 메모가 켜져 있으면 `key` 의 값을 요청 안에서 한 번만 계산한다. 아니면 그냥 계산한다.
 * 같은 key 의 계산이 겹치면(병렬 로더) 첫 약속을 나눠 준다.
 */
export function memoized<T>(tx: Tx, ctx: SessionContext, key: string, compute: () => Promise<T>): Promise<T> {
  const memo = tx.readOnly === true ? memos.get(ctx) : undefined
  if (memo === undefined) return compute()
  const hit = memo.cells.get(key)
  if (hit !== undefined) {
    memo.hits += 1
    return hit as Promise<T>
  }
  memo.misses += 1
  const value = compute()
  memo.cells.set(key, value)
  value.catch(() => {
    memo.cells.delete(key)
  })
  return value
}
