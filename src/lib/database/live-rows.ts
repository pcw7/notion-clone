/**
 * 다시 읽은 행을 화면의 목록에 맞춘다 — 표 변경 알림 2k-2조각 (F-04-24 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md 판결 X-5 [보강] "X-5 의 단계"(0단계 — "바뀌었다"를 받으면 다시 읽는다)
 *       04-database-views.md F-04-24 엣지 케이스
 *
 * 표는 하위 항목 트리를 **평평한 목록**으로 그린다(펼친 행 바로 뒤에 자식이 깊이를 달고 · 2b-2). 다시 읽으면 최상위 행과 **펼쳐 둔 행의
 * 자식**을 다시 받고, 여기서 그 둘로 목록을 다시 짓는다 — 펼침이 풀리지 않는다(사라진 행의 펼침만 빠진다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 내가 고친 행은 바로 지우지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 04 *"편집으로 행이 필터 밖으로 나감 → 목록에서 제거. 단 그 편집을 한 당사자에게는 즉시 제거하지 않고 안내(자기 편집으로 화면에서
 * 사라지면 버그로 인식된다)"*. 이 화면에서 고친 행(`touched`)이 다시 읽은 결과에 없으면 **옛 자리에 남기고** `outside` 로 알린다(화면이
 * "이 뷰의 조건에 맞지 않습니다"를 단다). 다른 사람이 고쳐 나간 행은 빠진다. 남긴 행은 다음에 다시 읽어도 남는다 — 사용자가 새로 열 때
 * 빠진다(그때는 이 화면의 기억이 없다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 부모를 바꾼 행은 조건 밖이 아니다(M-1)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 트리에서 "상위 항목" 을 고쳐 행이 접힌 다른 부모 밑으로 옮겨 가면 다시 읽은 결과의 옛 자리에 그 행이 없다. 위 규칙대로면 옛 자리에 남고
 * "조건 밖" 이 붙는데, 조건에 맞지 않아 빠진 것이 아니라 자리가 바뀐 것이다. 부르는 쪽이 행의 지금 부모(`parentOf`)를 주면, 화면의 트리에서
 * 서 있던 자리의 부모와 다를 때 남기지 않는다. 새 부모가 펼쳐져 있으면 다시 읽기가 이미 그 밑에 둔다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 늦게 온 옛 결과는 새 행을 덮지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 다시 읽기는 셀 저장과 겹칠 수 있다 — 저장이 서버에 닿기 전에 DB 를 읽은 결과가, 저장 응답(새 `version`)으로 이미 바뀐 화면의 행보다
 * 늦게 도착한다. 그대로 덮으면 칸이 옛 값으로 돌아가고, 내 쓰기의 알림은 나에게 오지 않아 그대로 남는다(e2e 8c-3a 가 3번 중 1번 보았다 —
 * 서버에는 새 제목 · 칸에는 옛 제목). 그래서 **화면의 행이 더 새 버전이면 그 행을 지킨다**(셀 저장 응답의 `notOlder` 와 같은 규칙 —
 * 같은 버전이면 다시 읽은 것). 버전은 행의 단조 증가 값이다(X-6).
 */

import type { RowJson } from './http.ts'

export type ReloadedRows = {
  /** 화면의 평평한 목록. */
  readonly rows: RowJson[]
  readonly depthOf: Map<string, number>
  /** 아직 펼쳐 둔 행(사라진 행의 펼침은 빠진다). */
  readonly expanded: Set<string>
  /** 결과에 없지만 내가 고쳐서 남긴 행. */
  readonly outside: Set<string>
}

export function mergeReloaded(input: {
  /** 지금 화면의 평평한 목록과 깊이. */
  readonly previous: readonly RowJson[]
  readonly depthOf: ReadonlyMap<string, number>
  /** 다시 읽은 최상위 행(트리가 아니면 평평한 행). */
  readonly top: readonly RowJson[]
  /** 다시 읽은 자식 — 펼쳐 둔 행마다. */
  readonly childrenOf: ReadonlyMap<string, readonly RowJson[]>
  readonly expanded: ReadonlySet<string>
  /** 이 화면에서 고친 행. */
  readonly touched: ReadonlySet<string>
  /**
   * 하위 항목 트리면 그 행의 지금 부모(상위 항목 값 · 없으면 null — M-1). 주면 내가 고친 행이 결과에 없을 때 **부모가 바뀌었는지** 먼저 본다 —
   * 화면의 트리에서 서 있던 자리의 부모와 다르면 다른 부모 밑으로 옮겨 간 것이라(새 부모가 접혀 있거나 아직 읽지 않았다) 남기지 않는다.
   */
  readonly parentOf?: (row: RowJson) => string | null
}): ReloadedRows {
  const rows: RowJson[] = []
  const depthOf = new Map<string, number>()
  const expanded = new Set<string>()
  const seen = new Set<string>()
  const shown = new Map(input.previous.map((row) => [row.id, row]))

  const place = (incoming: RowJson, depth: number) => {
    if (seen.has(incoming.id)) return // 한 행이 두 자리에 서지 않는다(부모가 바뀐 사이에 읽혔다)
    // 화면의 행이 더 새 버전이면 지킨다 — 늦게 온 옛 결과(머리말)
    const current = shown.get(incoming.id)
    const row = current !== undefined && newerVersion(current.version, incoming.version) ? current : incoming
    seen.add(row.id)
    rows.push(row)
    depthOf.set(row.id, depth)
    const children = input.expanded.has(row.id) ? input.childrenOf.get(row.id) : undefined
    if (children === undefined) return
    expanded.add(row.id)
    for (const child of children) place(child, depth + 1)
  }
  for (const row of input.top) place(row, 0)

  // 내가 고친 행 중 결과에 없는 것 — 옛 자리(바로 앞의 남은 행 뒤)에 남긴다
  const outside = new Set<string>()
  input.previous.forEach((row, i) => {
    if (seen.has(row.id) || !input.touched.has(row.id)) return
    // 부모를 바꿔 옮겨 간 행 — 조건 밖이 아니라 자리가 바뀐 것이다(M-1 · 정본 [보강] 10n-16 ④). 말없이 옛 자리에서 뺀다
    if (input.parentOf !== undefined && input.parentOf(row) !== treeParentAt(input.previous, input.depthOf, i)) return
    let anchor = -1
    for (let j = i - 1; j >= 0; j--) {
      const at = rows.findIndex((r) => r.id === input.previous[j]!.id)
      if (at >= 0) {
        anchor = at
        break
      }
    }
    const depth = anchor < 0 ? 0 : Math.min(input.depthOf.get(row.id) ?? 0, (depthOf.get(rows[anchor]!.id) ?? 0) + 1)
    rows.splice(anchor + 1, 0, row)
    depthOf.set(row.id, depth)
    seen.add(row.id)
    outside.add(row.id)
  })

  return { rows, depthOf, expanded, outside }
}

/** 평평한 목록에서 `i` 번째 행이 서 있던 자리의 부모 — 앞쪽으로 처음 만나는 한 단계 얕은 행. 최상위면 null. */
function treeParentAt(rows: readonly RowJson[], depthOf: ReadonlyMap<string, number>, i: number): string | null {
  const depth = depthOf.get(rows[i]!.id) ?? 0
  if (depth === 0) return null
  for (let j = i - 1; j >= 0; j--) {
    if ((depthOf.get(rows[j]!.id) ?? 0) === depth - 1) return rows[j]!.id
  }
  return null
}

/** `a` 가 `b` 보다 새 버전인가 — 버전은 정수 문자열(bigint)이다. 읽을 수 없으면 새롭다고 하지 않는다(다시 읽은 것을 쓴다). */
function newerVersion(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b)
  } catch {
    return false
  }
}
