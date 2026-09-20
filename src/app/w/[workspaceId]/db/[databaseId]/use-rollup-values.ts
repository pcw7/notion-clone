'use client'

/**
 * rollup 칸의 값을 들고 있는다 — 표 · 목록이 쓴다 (rollup 5c-2조각)
 *
 * 값은 행에 없다. 어디에도 저장하지 않고 **읽을 때 계산한다**(정본 §3.5 [보강] rollup v1) — 결과가 보는 사람마다 다르기
 * 때문이다(볼 수 없는 행을 집계에서 뺀다). 그래서 행을 받을 때마다 그 행들의 칸을 따로 묻는다. 첫 화면의 것은 서버
 * 렌더가 함께 계산해 준다(`page.tsx`) — 마운트 뒤에 받으면 숫자가 빈 채로 한 번 그려졌다가 채워진다.
 *
 * `use-relation-labels.ts` 와 같은 모양이다: **아직 묻지 않은 것만** 묻고, 물은 것을 따로 기억한다(답에 키가 없는 행 —
 * 그사이 지워진 행 — 을 렌더마다 다시 묻지 않으려고). 다른 점 둘:
 *
 *   ① **컬럼이 바뀌면 전부 다시 묻는다.** rollup 속성을 방금 만들었으면 이미 불러온 행들에도 그 칸이 생긴다 —
 *      새 행만 물으면 먼저 있던 행의 새 칸이 영영 빈 채로 남는다
 *   ② **`refresh(rowIds)`** — relation 을 고치면 그 행이 무엇을 모으는지가 바뀐다. 고친 행만 다시 묻는다
 *
 * ⚠ 이 훅이 다시 묻지 **않는** 경우가 하나 있다: 같은 표를 가리키는 relation 의 rollup(하위 작업의 합 같은 것)에서 대상
 *   행의 셀을 고친 때다. 새로고침 전까지 옛 값이다 — 셀 쓰기마다 왕복을 하나 더 만드는 값이 아니라고 봤다(HANDOFF §7).
 *   다른 표의 rollup 은 그 표를 열 때 계산되므로 애초에 문제가 아니다.
 */

import { useEffect, useRef, useState } from 'react'

import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import { MAX_ROLLUP_ROWS, type RollupPage } from '@/lib/database/rollup-functions'
import * as api from './table-api'

export function useRollupValues(
  workspaceId: string,
  dataSourceId: string,
  initial: RollupPage,
  rows: readonly RowJson[],
  columns: readonly ViewColumn[],
): { readonly page: RollupPage; readonly refresh: (rowIds: readonly string[]) => void } {
  const [page, setPage] = useState<RollupPage>(initial)
  /**
   * 물어 본 행 id. **서버가 계산해 준 행으로 시작한다**(`initial.values` 의 키) — 그것이 이미 물은 것이다.
   *
   * "지금 그려진 행"으로 시작하면 안 된다: 마운트 때 rollup 컬럼이 없었으면 서버는 아무것도 계산하지 않았는데
   * 그 행들이 "물은 것"으로 기록되고, 나중에 첫 rollup 컬럼을 만들어도 **그 행들의 칸이 영영 빈 채로 남는다.**
   */
  const asked = useRef<Set<string>>(new Set(Object.keys(initial.values)))
  /** 그때 물었던 컬럼 묶음. 마운트 시점의 것으로 시작한다(서버가 그 묶음으로 계산했다). */
  const [mountedKey] = useState(() =>
    columns
      .filter((c) => c.type === 'rollup')
      .map((c) => c.propertyId)
      .join(','),
  )
  const askedFor = useRef(mountedKey)
  const propertyKey = columns
    .filter((c) => c.type === 'rollup')
    .map((c) => c.propertyId)
    .join(',')

  /** 물어서 받은 것을 덮어쓴다. 컬럼은 답이 늘 전부를 싣고, 값은 물은 행의 것만 온다. */
  const ask = (rowIds: readonly string[]) => {
    for (let at = 0; at < rowIds.length; at += MAX_ROLLUP_ROWS) {
      const chunk = rowIds.slice(at, at + MAX_ROLLUP_ROWS)
      void api.rollupValues(workspaceId, dataSourceId, chunk).then((result) => {
        if (!result.ok) {
          // 실패하면 칸이 빈 채로 남는다 — 다음에 다시 물을 수 있게 "물은 것"에서 뺀다.
          for (const id of chunk) asked.current.delete(id)
          return
        }
        setPage((current) => ({
          columns: { ...current.columns, ...result.value.columns },
          values: { ...current.values, ...result.value.values },
        }))
      })
    }
  }

  useEffect(() => {
    if (propertyKey === '') return
    const ids = rows.map((row) => row.id)
    // 컬럼이 바뀌었다 — 이미 불러온 행에도 새 칸이 생긴다(머리말 ①). 마운트 때 rollup 이 없었다면 여기서 전부 묻는다.
    const all = askedFor.current !== propertyKey
    askedFor.current = propertyKey
    const missing = all ? ids : ids.filter((id) => !asked.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) asked.current.add(id)
    ask(missing)
    // `ask` 는 매 렌더 새로 만들어지는 함수다 — 의존성에 넣으면 이 효과가 매번 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, propertyKey, workspaceId, dataSourceId])

  /** 이 행들이 무엇을 모으는지가 바뀌었다(relation 을 고쳤다). 다시 묻는다. */
  const refresh = (rowIds: readonly string[]) => {
    if (propertyKey === '' || rowIds.length === 0) return
    for (const id of rowIds) asked.current.add(id)
    ask(rowIds)
  }

  return { page, refresh }
}
