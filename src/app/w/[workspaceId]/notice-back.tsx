'use client'

/**
 * 안내 화면의 "뒤로" (59번 트랙 NV-2 · F-07-12) — 404 · 접근 요청 화면에 같은 단추
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑥ [NV-2]
 *
 * 같은 출처의 앞 항목이 있으면 한 칸 뒤로(브라우저의 뒤로와 같다 — 앱의 스택이 없다), 없으면(이 탭의 첫 앱 항목) 앱 안의 대신 갈 곳으로. 단추는 그
 * 대신 갈 곳의 링크다 — JS 가 붙기 전에도 앱 안으로 가고, 수정 키를 누른 클릭은 링크 그대로(새 탭). 두 안내 화면에 같은 모양이라 단추가 존재를
 * 더 알리지 않는다.
 */

import { useParams, useRouter } from 'next/navigation'

import Link from '@/app/link'
import { noticeBackOf } from '@/lib/nav/nav-keys'
import { historyReach } from './nav-shortcut'

export function NoticeBack({ fallbackHref }: { /** 앞 항목이 없을 때 갈 곳 — 주지 않으면 이 워크스페이스의 홈. */ fallbackHref?: string }) {
  const router = useRouter()
  const params = useParams<{ workspaceId?: string }>()
  const fallback = fallbackHref ?? (params.workspaceId === undefined ? '/' : `/w/${params.workspaceId}`)
  return (
    <Link
      href={fallback}
      data-testid="notice-back"
      onClick={(event) => {
        // 새 탭 · 새 창 · 가운데 클릭은 링크에 맡긴다
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (noticeBackOf(historyReach(), window.history.length) !== 'back') return
        event.preventDefault()
        router.back()
      }}
      className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      <span aria-hidden>←</span>
      뒤로
    </Link>
  )
}
