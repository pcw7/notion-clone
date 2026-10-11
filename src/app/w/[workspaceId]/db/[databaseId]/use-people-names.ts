'use client'

/**
 * 사람 칸의 이름 지도를 들고 있는다 — 표 · 행 화면이 함께 쓴다 (게시 · 공유 6g-2 · F-03-07)
 *
 * 첫 화면의 이름은 서버 렌더가 준다(`page.tsx`). 그 뒤에 온 행("더 보기" · 새 행)의 사람 중 **아직 묻지 않은 id** 만 모아
 * `GET /people?ids=` 로 받는다 — 관계형 칩의 제목 맵(`use-relation-labels.ts`)과 같은 모양이다. 답에 없는 id 는 떠난 사람이다(칩은
 * "떠난 사용자") — 다시 묻지 않으려고 **물은 id** 를 따로 기억한다.
 *
 * 고르개에서 방금 고른 사람의 이름은 후보 목록이 갖고 있었다 — `addNames` 로 바로 넣는다(칩이 한 번 "떠난 사용자"로 깜빡이지 않게).
 */

import { useEffect, useRef, useState } from 'react'

import type { RowJson } from '@/lib/database/http'
import type { ViewColumn } from '@/lib/database/view'
import type { PeopleNames } from './cell-view'
import * as api from './table-api'

function idsOf(value: unknown): string[] {
  const people = (value as { type?: unknown; people?: unknown } | null)?.people
  if ((value as { type?: unknown } | null)?.type !== 'people' || !Array.isArray(people)) return []
  return people.flatMap((p) => (typeof (p as { id?: unknown })?.id === 'string' ? [(p as { id: string }).id] : []))
}

export function usePeopleNames(
  workspaceId: string,
  initial: PeopleNames,
  rows: readonly RowJson[],
  columns: readonly ViewColumn[],
): { readonly names: PeopleNames; readonly addNames: (known: PeopleNames) => void } {
  const [names, setNames] = useState<PeopleNames>(initial)
  const asked = useRef<Set<string> | null>(null)
  const propertyKey = columns
    .filter((c) => c.type === 'people')
    .map((c) => c.propertyId)
    .join(',')

  useEffect(() => {
    if (propertyKey === '') return
    const propertyIds = propertyKey.split(',')
    const present = rows.flatMap((row) => propertyIds.flatMap((id) => idsOf(row.properties[id])))

    // 첫 실행: 지금 있는 id 는 서버 렌더가 이미 물었다(답에 없는 것은 떠난 사람이다).
    if (asked.current === null) {
      asked.current = new Set(present)
      return
    }
    const known = asked.current
    const missing = [...new Set(present)].filter((id) => !known.has(id))
    if (missing.length === 0) return
    for (const id of missing) known.add(id)

    void api.loadPeopleNames(workspaceId, missing).then((result) => {
      // 실패하면 다음에 다시 묻는다
      if (!result.ok) {
        for (const id of missing) known.delete(id)
        return
      }
      setNames((current) => ({ ...current, ...result.value }))
    })
  }, [rows, propertyKey, workspaceId])

  const addNames = (known: PeopleNames) => {
    asked.current ??= new Set()
    for (const id of Object.keys(known)) asked.current.add(id)
    setNames((current) => ({ ...current, ...known }))
  }

  return { names, addNames }
}
