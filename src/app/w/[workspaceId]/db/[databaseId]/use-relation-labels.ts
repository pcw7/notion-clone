'use client'

/**
 * relation 칸의 제목 맵을 들고 있는다 — 표 · 목록 · 보드가 함께 쓴다 (relation 5b-1조각)
 *
 * 첫 화면의 제목은 서버 렌더가 준다(`page.tsx`). 그 뒤에 온 행 — "더 보기" · 새 행 · 새 카드 — 의 id 중 **아직 묻지 않은
 * 것**만 모아 `POST /relation-labels` 로 받는다. 캐시의 id 로 제목을 직접 읽지 않는다 — 권한과 휴지통을 거르는 곳은 서버의
 * 제목 맵 하나다(`relation.ts` `loadRelationLabels`).
 *
 * 묻는 것은 id 마다 한 번이다. 답에 키가 없는 id(휴지통에 간 행)를 다시 묻지 않으려고 **물은 id** 를 따로 기억한다 —
 * 제목 맵의 키만 보면 그런 id 를 렌더마다 다시 묻게 된다. 첫 화면의 id 는 서버가 이미 물었으므로 묻지 않는다.
 *
 * 응답을 취소하지 않는다. 행이 또 바뀌어 effect 가 다시 돌 때 앞선 응답을 버리면, 그 id 들은 이미 "물은 것"이라 제목을
 * 영영 받지 못한다.
 */

import { useEffect, useRef, useState } from 'react'

import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import { readRelationValue } from '@/lib/database/property-types'
import type { RelationLabels } from './cell-view'
import * as api from './table-api'

export function useRelationLabels(
  workspaceId: string,
  initial: RelationLabels,
  rows: readonly RowJson[],
  columns: readonly ViewColumn[],
): RelationLabels {
  const [labels, setLabels] = useState<RelationLabels>(initial)
  const asked = useRef<Set<string> | null>(null)
  const propertyKey = columns
    .filter((c) => c.type === 'relation')
    .map((c) => c.propertyId)
    .join(',')

  useEffect(() => {
    if (propertyKey === '') return
    const propertyIds = propertyKey.split(',')
    const present: string[] = []
    for (const row of rows) {
      for (const propertyId of propertyIds) {
        for (const ref of readRelationValue(row.properties[propertyId]).relation) present.push(ref.id)
      }
    }

    // 첫 실행: 지금 있는 id 는 서버 렌더가 이미 물었다(답에 없는 것은 휴지통에 간 행이다).
    if (asked.current === null) {
      asked.current = new Set(present)
      return
    }
    const known = asked.current
    const missing = [...new Set(present)].filter((id) => !known.has(id))
    if (missing.length === 0) return
    for (const id of missing) known.add(id)

    void api.loadRelationLabels(workspaceId, missing).then((result) => {
      // 실패하면 칩이 비어 보인다 — 다음에 다시 물을 수 있게 "물은 것"에서 뺀다.
      if (!result.ok) {
        for (const id of missing) known.delete(id)
        return
      }
      setLabels((current) => ({ ...current, ...result.value }))
    })
  }, [rows, propertyKey, workspaceId])

  return labels
}
