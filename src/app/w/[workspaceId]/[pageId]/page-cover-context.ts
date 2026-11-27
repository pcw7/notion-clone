/**
 * 커버 상태의 공급 통로(BD-2 — `page-cover.tsx` 에서 떼어 냈다).
 *
 * 아이콘 칸(`page-icon-control.tsx`)은 "커버가 있나" 하나만 묻는다. 그 한 줄 때문에 배너 · 고르개 · 올리기까지 끌고 오면 커버가 없는
 * 화면(데이터베이스 템플릿 편집 · 데이터베이스 머리)의 첫 JS 가 그만큼 커졌다.
 */

import { createContext, useContext } from 'react'

import type { PageCover } from '@/lib/block/page-cover'

export type CoverState = {
  readonly workspaceId: string
  readonly cover: PageCover | null
  /** 커버의 세로 위치(PC-3) — 0~1 · 가운데 0.5. */
  readonly position: number
  readonly readOnly: boolean
  readonly error: string | null
  save(next: PageCover | null): Promise<void>
  savePosition(next: number): Promise<void>
}

export const CoverContext = createContext<CoverState | null>(null)

/** 아이콘 칸이 배너에 걸칠지 — 커버가 있으면 참. 공급자가 없으면(데이터베이스 머리) 거짓. */
export function useHasPageCover(): boolean {
  return (useContext(CoverContext)?.cover ?? null) !== null
}
