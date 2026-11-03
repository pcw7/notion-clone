'use client'

/**
 * 페이지의 모습 — 서체 셋 · 작은 글씨 · 전체 폭 (36번 트랙 PL-1 · F-02-07 · 정본 §3.4 [보강 PL-1] ⑤)
 *
 * 노션의 "···" 메뉴 맨 위와 같은 자리다(02 *"상단 폰트 3종 중 하나 클릭 → Small text 토글 → Full width 토글 → 메뉴 닫으면 즉시 반영"*).
 * 고를 때마다 곧바로 저장한다(`PATCH` 의 `appearance` — 준 칸만) — 화면은 먼저 바꾸고 거부되면 되돌린다. 그리는 것(본문 칸의 서체 · 글씨 ·
 * 폭)은 서버 렌더라 저장 뒤 다시 그린다(`router.refresh`). 고칠 수 있는 사람에게만 서고, 데이터베이스 행에는 없다(레이아웃이 정한다).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { DEFAULT_PAGE_APPEARANCE, type PageAppearance, type PageFont } from '@/lib/block/page-appearance'
import { MENU_ROW } from './page-menu'

const FONTS: readonly { readonly font: PageFont; readonly label: string; readonly sample: string }[] = [
  { font: 'default', label: '기본', sample: 'font-sans' },
  { font: 'serif', label: '세리프', sample: 'font-serif' },
  { font: 'mono', label: '고정폭', sample: 'font-mono' },
]

export function PageAppearanceControl({ workspaceId, pageId, initial }: { workspaceId: string; pageId: string; initial: PageAppearance }) {
  const router = useRouter()
  const [look, setLook] = useState<PageAppearance>(initial ?? DEFAULT_PAGE_APPEARANCE)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: Partial<PageAppearance>): Promise<void> => {
    const before = look
    setLook({ ...look, ...patch })
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appearance: patch }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown }
        setError(data.error === 'locked' ? '잠긴 페이지입니다 — 잠금을 풀어야 모습을 바꿀 수 있습니다.' : '모습을 저장하지 못했습니다.')
        setLook(before)
        return
      }
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
      setLook(before)
    }
  }

  return (
    <div className="flex flex-col" data-testid="page-appearance">
      <div role="group" aria-label="서체" className="grid grid-cols-3 gap-1 px-1 pb-1">
        {FONTS.map(({ font, label, sample }) => (
          <button
            key={font}
            type="button"
            data-testid="page-font"
            data-font={font}
            aria-pressed={look.font === font}
            onClick={() => void save({ font })}
            className={`flex flex-col items-center rounded-md py-1.5 text-xs hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5 ${look.font === font ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500'}`}
          >
            <span className={`${sample} text-xl leading-tight`}>Ag</span>
            {label}
          </button>
        ))}
      </div>
      {(
        [
          ['smallText', '작은 글씨'],
          ['fullWidth', '전체 폭'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="switch"
          aria-checked={look[key]}
          data-testid={key === 'smallText' ? 'page-small-text' : 'page-full-width'}
          onClick={() => void save({ [key]: !look[key] })}
          className={`${MENU_ROW} justify-between`}
        >
          {label}
          <span aria-hidden className={`relative h-3.5 w-6 rounded-full transition-colors ${look[key] ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}>
            <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${look[key] ? 'left-3' : 'left-0.5'}`} />
          </span>
        </button>
      ))}
      {error !== null && (
        <p role="alert" className="px-2 py-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
