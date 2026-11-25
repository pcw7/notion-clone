'use client'

/**
 * 보드 · 갤러리 · 그룹 표의 바뀐 행만 합치기 — DB 실시간 동기화 RT-5조각 (F-05-16 · F-05-06)
 *
 * 정본: 00-canonical-data-model.md 판결 X-5 [보강] "X-5 의 단계" ㉑~㉕ [보강 RT-5]
 *
 * 표(`database-table.tsx`)와 같은 장부(`delta-merge.ts` — 화면이 아는 커서) · 같은 미루기(바쁘면 끝난 뒤에 · 다시 읽기가 델타보다 세다) ·
 * 같은 검사용 신호(`data-sync` — `noteSync`). 다른 것은 **처음부터 다시 읽기가 서버 화면을 다시 부르는 것**(`router.refresh()`)이다 — 이 화면들은
 * 데이터를 서버 렌더에서 받는다(그룹 표는 덩이들도 제 그룹을 다시 읽는다 — 부르는 쪽의 `full`). 다시 부른 서버 화면을 받아들이면(`server` 가
 * 바뀐다 · 바쁘면 끝난 뒤 — `useAdoptServerValue` 와 같은 때) 화면의 커서는 그 화면의 렌더 커서다(그 읽기 **전에** 받은 것 — 정본 ④). 부른 뒤
 * 받아들이기 전에 델타를 합쳤으면 받아들인 화면이 그것을 덮었을 수 있으니 그 커서부터 한 번 더 묻는다(㉔).
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { afterDelta, afterFullRead, createSyncLedger, fullReadCursor, noteSignal, strongerSync, type SyncMode } from '@/lib/database/delta-merge'
import { noteSync, syncStatsOf, useRenderedChangeCursor, useTableChanges, type SyncStats } from './use-table-changes'

/** 델타 한 번의 결과 — 합쳤다(`partial` 이면 일부 덩이는 다시 읽었다) · 묻는 사이 화면이 바뀌었다(다시 묻는다) · 처음부터(그 전에 받은 커서). */
export type DeltaAttempt =
  | { readonly kind: 'applied'; readonly cursor: string; readonly behind: boolean; readonly partial?: boolean }
  | { readonly kind: 'retry' }
  | { readonly kind: 'full'; readonly cursor: string | null }

export function useViewDeltaSync(input: {
  readonly workspaceId: string
  readonly dataSourceId: string
  readonly viewId: string
  /** 끌기 · 편집 · 추가 · 더 보기 · 옮기기를 보내는 중 — 미뤘다가 끝나면 맞춘다(정본 ㉕). */
  readonly busy: boolean
  /** 스스로 구독하는가 — 가로줄 · 덩이는 바깥이 한다. */
  readonly enabled: boolean
  /** 서버 화면이 읽기 전의 시각(ms — `use-table-changes.ts` 머리말). */
  readonly renderedAt?: number
  /** 바뀐 행만 물을 수 있는 화면인가 — 아니면 신호마다 처음부터. */
  readonly deltaCapable: boolean
  /** 커서 뒤의 델타를 묻고 합친다. */
  readonly attempt: (after: string) => Promise<DeltaAttempt>
  /** 처음부터 — 없으면 서버 화면을 다시 부른다. */
  readonly full?: () => void
  /** 서버 화면이 준 값(그룹 · 행) — 정체가 바뀌면 받아들인 것으로 친다(바쁘면 끝난 뒤에). */
  readonly server: unknown
}): SyncStats {
  const router = useRouter()
  const latest = useRef(input)
  useEffect(() => {
    latest.current = input
  })
  const rendered = useRenderedChangeCursor()
  const renderedRef = useRef(rendered)
  useEffect(() => {
    renderedRef.current = rendered
  })
  // 화면이 아는 커서 — 마운트 때의 렌더 커서로 시작한다
  const [ledger] = useState(() => createSyncLedger(rendered))
  const [stats, setStats] = useState(() => syncStatsOf(input.viewId))
  const wanted = useRef<SyncMode>('none')
  const syncing = useRef(false)
  /** 서버 화면을 다시 불렀고 아직 받아들이지 않았다 — 그사이 델타를 합쳤는가. */
  const refreshing = useRef(false)
  const deltaWhileRefreshing = useRef(false)
  const behindTimer = useRef<number | null>(null)
  const [, kick] = useState(0)
  useEffect(
    () => () => {
      if (behindTimer.current !== null) window.clearTimeout(behindTimer.current)
    },
    [],
  )

  const note = (how: 'delta' | 'full') => setStats(noteSync(latest.current.viewId, how))

  const full = (known: string | null) => {
    afterFullRead(ledger, fullReadCursor(ledger, known))
    refreshing.current = true
    deltaWhileRefreshing.current = false
    note('full')
    if (latest.current.full !== undefined) latest.current.full()
    else router.refresh()
  }

  const run = async (): Promise<void> => {
    const mode = wanted.current
    if (mode === 'none') return
    wanted.current = 'none'
    syncing.current = true
    try {
      if (mode === 'full' || !latest.current.deltaCapable || ledger.applied === null) {
        full(null)
        return
      }
      const outcome = await latest.current.attempt(ledger.applied)
      if (outcome.kind === 'retry') {
        wanted.current = strongerSync(wanted.current, 'delta')
        return
      }
      if (outcome.kind === 'full') {
        full(outcome.cursor)
        return
      }
      afterDelta(ledger, outcome.cursor)
      if (refreshing.current) deltaWhileRefreshing.current = true
      note(outcome.partial === true ? 'full' : 'delta')
      // 더 오래된 쓰기 트랜잭션이 지평을 붙잡았다 — 곧 다시 묻는다(정본 ③)
      if (outcome.behind && behindTimer.current === null) {
        behindTimer.current = window.setTimeout(() => {
          behindTimer.current = null
          request('delta')
        }, 1000)
      }
    } finally {
      syncing.current = false
      if (wanted.current !== 'none') kick((n) => n + 1)
    }
  }

  const request = (kind: 'delta' | 'full') => {
    wanted.current = strongerSync(wanted.current, kind)
    if (!latest.current.busy && !syncing.current) void run()
  }

  useTableChanges(
    input.workspaceId,
    input.dataSourceId,
    {
      onChanged: (signal) => {
        noteSignal(ledger, signal.cursor)
        request('delta')
      },
      // 내 개인 설정(RT-3) — 서버 화면이 내 필터 · 정렬로 다시 그린다
      onPersonal: () => request('full'),
      onRevoked: () => router.refresh(),
    },
    input.enabled,
    input.renderedAt,
  )

  // 다시 부른 서버 화면을 받아들였다 — 그 화면의 렌더 커서가 화면의 커서다(머리말)
  const seen = useRef(input.server)
  useEffect(() => {
    if (input.server === seen.current || input.busy) return
    seen.current = input.server
    refreshing.current = false
    afterFullRead(ledger, renderedRef.current)
    if (deltaWhileRefreshing.current) {
      deltaWhileRefreshing.current = false
      request('delta')
    }
  })

  // 미뤄 둔 맞추기 — 바쁜 것이 끝나면 · 다시 청했으면
  useEffect(() => {
    if (wanted.current !== 'none' && !input.busy && !syncing.current) void run()
  })

  return stats
}
