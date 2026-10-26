'use client'

/**
 * 보이는 행들의 날짜 리마인더 — 표 · 보드 · 갤러리가 같이 쓴다 (히스토리 · 활동 4c-3 · 카드의 종 10n-76 · F-11-10)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑨ ⓑ — 행의 읽기에 싣지 않고 보이는 행들의 것을 따로 읽는다. 행의 판이 바뀌면 다시
 * 읽는다(날짜를 옮기면 트리거가 시각 · "지남"을 바꾼다). 날짜 칸이 없는 화면은 읽지 않는다. `tick` 이 바뀌어도 다시 읽는다 — 남이 걸고 푼
 * 리마인더 · 울림은 행의 판을 바꾸지 않는다(⑩ · 10n-17): 표는 다시 읽기마다, 보드 · 갤러리는 서버가 다시 그릴 때마다(`renderedAt`) 올린다.
 * 원래 표 안에 있던 것을 꺼냈다(10n-76).
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import type { DateReminderJson } from '@/lib/database/reminder'
import * as api from './table-api'

/** 한 번에 묻는 행 수 — 라우트의 상한과 같다. */
const REMINDER_CHUNK = 200

export function useRowReminders(
  workspaceId: string,
  dataSourceId: string,
  rows: readonly { readonly id: string; readonly version: string }[],
  hasDate: boolean,
  tick: unknown,
): [api.ReminderMap, Dispatch<SetStateAction<api.ReminderMap>>] {
  const [reminders, setReminders] = useState<api.ReminderMap>({})
  const key = hasDate ? rows.map((r) => `${r.id}:${r.version}`).join(',') : ''
  useEffect(() => {
    if (key === '') return
    let stale = false
    const ids = key.split(',').map((entry) => entry.slice(0, entry.indexOf(':')))
    void (async () => {
      const merged: Record<string, Readonly<Record<string, DateReminderJson>>> = {}
      for (let i = 0; i < ids.length; i += REMINDER_CHUNK) {
        const read = await api.loadReminders(workspaceId, dataSourceId, ids.slice(i, i + REMINDER_CHUNK))
        if (!read.ok) return
        Object.assign(merged, read.value)
      }
      if (!stale) setReminders(merged)
    })()
    return () => {
      stale = true
    }
  }, [key, tick, workspaceId, dataSourceId])
  return [reminders, setReminders]
}
