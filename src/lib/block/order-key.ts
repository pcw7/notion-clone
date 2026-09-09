/**
 * 형제 순서 — fractional index (`block.order_key`)
 *
 * 정본: 00-canonical-data-model.md §3.4, 판결 C-10
 *
 * **왜 배열이 아니라 fractional index 인가** (판결 C-10):
 * 원본 Notion 은 부모 블록에 `content uuid[]` 배열을 두지만, 클론은 다른 쪽을 골랐다.
 * 배열이면 자식 하나를 옮겨도 **부모 행을 갱신**해야 해서, 자식 500개짜리 페이지에서
 * 두 사람이 서로 다른 위치에 동시 삽입하면 부모 행이 페이지 전체 편집의 직렬화
 * 락 지점이 된다. fractional index 는 옮긴 자식 한 행만 쓴다.
 *
 * **계산은 직접 하지 않는다.** fractional-indexing(CC0-1.0, 의존성 0)을 쓴다.
 * 이 알고리즘은 경계 조건이 미묘하고, 틀리면 정렬이 조용히 깨져 사용자가
 * "문단 순서가 이상하다"고 신고할 때까지 드러나지 않는다. 검증된 구현을 쓰고
 * 우리는 그 위에 정본 규칙(길이 상한·재균형·결정적 정렬)만 얹는다.
 */

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/** 정본 상수 §3.4. 이 길이를 넘으면 형제 전체를 재균형한다(B7). */
export const ORDER_KEY_MAX_LEN = 32

/**
 * 경계가 실제로 오름차순인지 확인한다.
 *
 * ⚠ 라이브러리는 이걸 검사하지 않는다. `generateKeyBetween('a1', 'a0')` 처럼
 * 인자를 바꿔 넣으면 **예외 없이 `'a0V'` 를 돌려준다** — 두 경계 어느 쪽 사이도
 * 아닌 값이다. 그대로 저장되면 정렬이 조용히 깨지고, 사용자가 "문단 순서가
 * 이상하다"고 신고할 때까지 드러나지 않는다.
 *
 * before/after 를 바꿔 넣는 것은 흔한 실수라 여기서 막는다.
 * (같은 값을 넣는 경우는 라이브러리가 이미 던진다.)
 */
function assertOrdered(before: string | null, after: string | null): void {
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(
      `order_key 경계가 오름차순이 아닙니다: before=${JSON.stringify(before)} ` +
        `after=${JSON.stringify(after)} — 인자 순서를 바꿔 넣지 않았는지 확인하세요.`,
    )
  }
}

/**
 * 두 키 사이의 키를 만든다.
 *
 * @param before 앞 형제의 order_key. 맨 앞에 넣으면 null.
 * @param after  뒤 형제의 order_key. 맨 뒤에 넣으면 null.
 */
export function orderKeyBetween(before: string | null, after: string | null): string {
  assertOrdered(before, after)
  return generateKeyBetween(before, after)
}

/** 한 번에 n개를 만든다. 여러 블록을 연속으로 삽입할 때 왕복을 줄인다. */
export function orderKeysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (count < 0) throw new RangeError(`count 는 0 이상이어야 합니다: ${count}`)
  if (count === 0) return []
  assertOrdered(before, after)
  return generateNKeysBetween(before, after, count)
}

/** 비어 있는 부모에 첫 자식을 넣을 때. */
export function firstOrderKey(): string {
  return generateKeyBetween(null, null)
}

/**
 * 재균형이 필요한가 (B7).
 *
 * fractional index 는 같은 위치에 반복 삽입하면 키가 계속 길어진다.
 * 무한정 길어져도 정렬은 맞지만 인덱스와 저장 비용이 나빠지므로,
 * 정본이 정한 32자를 넘으면 형제 전체를 다시 매긴다.
 */
export function needsRebalance(orderKey: string): boolean {
  return orderKey.length > ORDER_KEY_MAX_LEN
}

/**
 * 형제 n개에 고르게 분배된 키를 만든다. 재균형에 쓴다.
 * 결과는 짧고 균등해서 다음 재균형까지의 여유가 최대가 된다.
 */
export function rebalancedKeys(count: number): string[] {
  return orderKeysBetween(null, null, count)
}

/**
 * 결정적 정렬 (B7: `ORDER BY order_key, id`).
 *
 * order_key 만으로 정렬하면 안 된다. UNIQUE(parent_id, order_key) 가 있어
 * 같은 부모 아래 중복은 없지만, **다른 부모의 자식들을 한 배열에 모아** 정렬하는
 * 경우(검색 결과, 최근 항목)에는 같은 키가 나올 수 있다. 그때 순서가 흔들리면
 * 페이지네이션이 항목을 건너뛰거나 중복해서 보여준다.
 */
export function compareBlockOrder(
  a: { orderKey: string; id: string },
  b: { orderKey: string; id: string },
): number {
  if (a.orderKey < b.orderKey) return -1
  if (a.orderKey > b.orderKey) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
