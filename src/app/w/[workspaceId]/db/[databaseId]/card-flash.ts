'use client'

/**
 * 남이 바꾼 카드를 잠깐 칠한다 — 보드 · 갤러리 (DB 실시간 동기화 RT-5 · 정본 X-5 의 단계 ㉖)
 *
 * ⑳(표의 칸)의 규칙을 카드에 건다 — 어느 칸인가는 `remote-cells.ts` 가 정한다(값이 저장되고 보이는 칸 · 이 탭이 쓴 칸은 빼고 · 너무 많으면
 * 칠하지 않는다 · 화면에 있던 카드만). 카드는 칸이 작고 배지는 값이 없으면 서지도 않아 **카드 하나**를 칠한다. 카드의 바탕을 건드리지 않게
 * 덧씌운 층(`data-card-flash`)을 그리고 그것을 흐린다(움직임 줄이기면 2초 가만히). 카드의 `data-remote-changed` 는 시험용이다.
 */

import { useEffect, useRef, useState } from 'react'

import type { RowJson } from '@/lib/database/http'
import { ownWrites, remoteChanges, REMOTE_FLASH_MS } from '@/lib/database/remote-cells'
import { reducesMotion } from '@/lib/settings/device-preferences'
import { isCellColumn, type ViewColumn } from '@/lib/database/view-columns'

/** 덧씌운 층의 바탕 — 표의 칸(`REMOTE_CELL`)과 같은 색. */
export const CARD_FLASH_LAYER = 'pointer-events-none absolute inset-0 rounded-md bg-amber-100 dark:bg-amber-400/20'

/** 카드에서 칠할 수 있는 속성 — 보이는 것 가운데 값이 저장된 칸 · relation · 검증(⑳ ⓐ). */
export function flashablePropertyIds(columns: readonly ViewColumn[]): string[] {
  return columns.filter((c) => isCellColumn(c) || c.type === 'relation' || c.type === 'verification').map((c) => c.propertyId)
}

export function useCardFlash(root: { readonly current: HTMLElement | null }): {
  /** 칠한 카드(행 id → 칠한 차례). */
  readonly flashed: ReadonlyMap<string, number>
  /** 화면 낭독기의 한 줄(polite). */
  readonly summary: string
  /** 합치기 앞뒤의 카드를 견줘 칠한다. */
  readonly flash: (previous: readonly RowJson[], next: readonly RowJson[], propertyIds: readonly string[]) => void
} {
  const [flashed, setFlashed] = useState<ReadonlyMap<string, number>>(new Map())
  const [summary, setSummary] = useState('')
  const [stamp, setStamp] = useState(0)
  const seq = useRef(0)
  const timers = useRef(new Set<number>())
  useEffect(() => {
    const running = timers.current
    return () => {
      for (const timer of running) window.clearTimeout(timer)
    }
  }, [])

  const flash = (previous: readonly RowJson[], next: readonly RowJson[], propertyIds: readonly string[]) => {
    const found = remoteChanges({ previous, next, propertyIds, isOwn: ownWrites.isOwn })
    if (found.size === 0) return
    seq.current += 1
    const at = seq.current
    const ids = [...found.keys()]
    setFlashed((current) => {
      const marked = new Map(current)
      for (const id of ids) marked.set(id, at)
      return marked
    })
    setStamp(at)
    setSummary(`다른 곳에서 바뀐 카드 ${ids.length}개`)
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setFlashed((current) => {
        const left = new Map(current)
        for (const id of ids) if (left.get(id) === at) left.delete(id)
        return left
      })
      setSummary((text) => (seq.current === at ? '' : text))
    }, REMOTE_FLASH_MS)
    timers.current.add(timer)
  }

  // 새로 칠한 층을 흐린다 — 움직임 줄이기면 가만히(떼는 것은 위의 시계)
  useEffect(() => {
    if (stamp === 0) return
    if (reducesMotion(document.documentElement.dataset.motion, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)) return
    for (const layer of root.current?.querySelectorAll<HTMLElement>(`[data-card-flash="${stamp}"]`) ?? []) {
      if (typeof layer.animate !== 'function') continue
      layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REMOTE_FLASH_MS, easing: 'ease-in', fill: 'forwards' })
    }
  }, [stamp, root])

  return { flashed, summary, flash }
}
