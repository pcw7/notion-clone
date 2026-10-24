'use client'

/**
 * 인박스 목록 — F-11-07 (코멘트 4조각)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 한 줄이 행 **여럿**이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 병합은 조회 시점이다(불변식 N2). 화면이 보는 한 줄은 같은 스레드의 알림 여럿이 접힌 것이고, 서버가 그 행 id 들을
 * `notificationIds` 로 함께 준다. 읽음 · 보관은 **그 전부**에 건다 — 한 행만 고치면 "읽었는데 배지는 그대로"가 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 필터 넷은 서버가 가른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `read_at` 과 `archived_at` 이 따로인 이유가 그것이다(정본 §3.8). 받아 온 목록을 화면에서 다시 거르지 않는다 —
 * 거르는 규칙이 두 벌이면 "보관했는데 아직 보인다"가 생긴다.
 *
 * 지운 코멘트의 미리보기는 서버가 `null` 로 준다(§3.3-133). 여기서 옛 내용을 기억해 두지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 마지막 요청의 답만 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * "읽음"을 누르고 곧바로 다른 필터를 누르면 두 다시 읽기가 엇갈린다 — 늦게 온 옛 필터의 답이 지금 필터의 목록을 덮으면 "안 읽음"에
 * 읽은 알림이 선다(전체 e2e 가 찾았다). 다시 읽기마다 번호를 매겨 마지막 것만 받고, 표시 뒤의 다시 읽기는 **지금** 필터로 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무한 스크롤 (10n-69 · HANDOFF §3.2-302)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 11 *"패널 … 무한 스크롤"*. 목록 끝의 "더 보기" 단추가 화면에 들어오면 저절로 다음 쪽을 받는다(눌러도 된다 — 키보드 · 보조 기술).
 * 다음 쪽은 다시 읽기 번호를 **올리지 않는다** — 다시 읽기(필터 · 읽음 · 보관)가 그 사이에 오면 늦게 온 다음 쪽은 버린다(옛 목록의 뒤다).
 * 읽음 · 보관 뒤의 다시 읽기는 **펼친 만큼**을 받는다 — 첫 쪽만 다시 받으면 읽던 자리가 사라진다. 같은 줄이 두 번 오면(쪽 사이에 새
 * 알림이 와 줄이 밀렸다) 한 번만 둔다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from '@/app/link'

import type { PageIcon } from '@/lib/block/page-icon'
import { accessInboxLine, inboxHref } from '../access-request-messages'
import { assignmentInboxLine, reminderInboxLine } from './inbox-messages'
import { PageIconView } from '../page-icon-view'

export type InboxRow = {
  groupKey: string
  kind: string
  pageId: string
  pageTitle: string
  /** 그 페이지의 아이콘(8c-2) — 없으면 null(기본 글리프). */
  pageIcon: PageIcon | null
  notificationIds: string[]
  count: number
  unreadCount: number
  lastAt: string
  preview: string | null
  deleted: boolean
  /** 접근 · 편집 요청(7e-1 · 7e-2)의 지금 상태 — 서버가 요청 행에서 읽어 준다. 다른 알림은 null. */
  access: { requesterName: string | null; status: string; kind: string } | null
  /** 리마인더(4c-3) — 울린 날짜 속성의 지금 이름. 다른 알림은 null. */
  reminder: { propertyName: string | null } | null
  /** 담당(6h) — 회원님을 넣은 사람 속성의 지금 이름. 다른 알림은 null. */
  assignment: { propertyName: string | null } | null
}

const FILTERS: readonly { value: string; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'unread', label: '안 읽음' },
  { value: 'read', label: '읽음' },
  { value: 'archived', label: '보관' },
]

const KIND_LABEL: Readonly<Record<string, string>> = {
  comment: '코멘트',
  comment_reply: '답글',
  mention: '멘션',
  page_update: '페이지 변경',
  access_requested: '접근 요청',
  access_granted: '요청 허락',
  reminder: '리마인더',
  person_property_assigned: '담당',
}

const UNTITLED = '제목 없음'

const when = (iso: string): string => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

export function InboxList({
  workspaceId,
  initialItems,
  initialNext,
  initialUnread,
}: {
  workspaceId: string
  initialItems: InboxRow[]
  /** 다음 쪽의 커서(10n-69) — null 이면 더 없다. */
  initialNext: string | null
  initialUnread: number
}) {
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState(initialItems)
  const [next, setNext] = useState(initialNext)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unread, setUnread] = useState(initialUnread)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 지금 필터 · 마지막 다시 읽기의 번호 — 늦게 온 답이 지금 목록을 덮지 않게(머리말). */
  const filterRef = useRef(filter)
  const latestLoad = useRef(0)
  /** 다음 쪽을 받은 적이 있는가 — 읽음 · 보관 뒤의 다시 읽기가 펼친 만큼을 받게(머리말). */
  const grownRef = useRef(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const moreBusy = useRef(false)

  const url = `/api/workspaces/${workspaceId}/inbox`

  /** 첫 쪽부터 다시 — `extent` 를 주면 그만큼(읽음 · 보관 뒤 — 펼친 만큼). 필터를 바꾸면 첫 쪽만. */
  const load = useCallback(
    async (nextFilter: string, extent?: number) => {
      const ticket = ++latestLoad.current
      if (extent === undefined) grownRef.current = false
      try {
        const res = await fetch(`${url}?filter=${nextFilter}${extent === undefined ? '' : `&limit=${extent}`}`)
        if (ticket !== latestLoad.current) return
        if (!res.ok) {
          setError('인박스를 불러오지 못했습니다.')
          return
        }
        const data = (await res.json()) as { items: InboxRow[]; next: string | null; unread: number }
        if (ticket !== latestLoad.current) return
        setItems(data.items)
        setNext(data.next)
        setUnread(data.unread)
      } catch {
        if (ticket === latestLoad.current) setError('연결에 실패했습니다.')
      }
    },
    [url],
  )

  const mark = useCallback(
    async (ids: string[], patch: { read?: boolean; archived?: boolean }) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, ...patch }),
        })
        if (!res.ok) setError('처리하지 못했습니다.')
        await load(filterRef.current, grownRef.current ? Math.max(items.length, 1) : undefined)
      } catch {
        setError('연결에 실패했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [load, url, items.length],
  )

  /** 다음 쪽 — 다시 읽기 번호를 올리지 않는다: 그 사이에 다시 읽기가 오면 이 답은 옛 목록의 뒤라 버린다(머리말). */
  const loadMore = useCallback(async () => {
    if (next === null || moreBusy.current) return
    moreBusy.current = true
    setLoadingMore(true)
    const ticket = latestLoad.current
    try {
      const res = await fetch(`${url}?filter=${filterRef.current}&after=${encodeURIComponent(next)}`)
      if (ticket !== latestLoad.current) return
      if (!res.ok) {
        setError('알림을 더 불러오지 못했습니다.')
        return
      }
      const data = (await res.json()) as { items: InboxRow[]; next: string | null; unread: number }
      if (ticket !== latestLoad.current) return
      grownRef.current = true
      setItems((current) => {
        const seen = new Set(current.map((i) => `${i.groupKey}:${i.pageId}`))
        return [...current, ...data.items.filter((i) => !seen.has(`${i.groupKey}:${i.pageId}`))]
      })
      setNext(data.next)
      setUnread(data.unread)
    } catch {
      if (ticket === latestLoad.current) setError('연결에 실패했습니다.')
    } finally {
      moreBusy.current = false
      setLoadingMore(false)
    }
  }, [next, url])

  // 목록 끝이 화면에 들어오면 저절로 — 다음 쪽이 바뀔 때마다 다시 단다(받은 뒤에도 끝이 보이면 곧바로 한 쪽 더)
  useEffect(() => {
    const target = moreRef.current
    if (next === null || target === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [next, loadMore])

  const allIds = items.flatMap((i) => i.notificationIds)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="인박스 필터">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => {
                filterRef.current = f.value
                setFilter(f.value)
                void load(f.value)
              }}
              className={`rounded px-2 py-1 text-sm ${
                filter === f.value
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border border-neutral-300 dark:border-neutral-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500" aria-label={`안 읽은 알림 ${unread}개`}>
            안 읽음 {unread}
          </span>
          {allIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void mark(allIds, { read: true })}
              className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
            >
              모두 읽음
            </button>
          )}
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">알림이 없습니다.</p>
      ) : (
        <ul
          aria-label="알림 목록"
          className="flex flex-col divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
        >
          {items.map((item) => (
            <li key={`${item.groupKey}:${item.pageId}`} data-testid="inbox-item" data-group={item.groupKey} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={inboxHref(workspaceId, item.pageId, item.kind)}
                  className="text-sm font-medium hover:underline underline-offset-4"
                >
                  <PageIconView icon={item.pageIcon} fallback className="mr-1.5 align-[-0.125em]" />
                  {item.pageTitle || UNTITLED}
                </Link>
                <span className="flex-none text-xs text-neutral-500">
                  {KIND_LABEL[item.kind] ?? item.kind}
                  {item.count > 1 && ` ${item.count}`}
                  {item.unreadCount > 0 && <span className="ml-1 text-neutral-900 dark:text-neutral-100">●</span>}
                </span>
              </div>

              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {accessInboxLine(item.kind, item.access) ??
                  reminderInboxLine(item.reminder) ??
                  assignmentInboxLine(item.assignment) ??
                  (item.deleted ? <span className="text-neutral-400">삭제된 코멘트</span> : (item.preview ?? ''))}
              </p>

              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">{when(item.lastAt)}</span>
                <button
                  type="button"
                  data-testid="inbox-read"
                  disabled={busy}
                  onClick={() => void mark(item.notificationIds, { read: item.unreadCount > 0 })}
                  className={SMALL_BUTTON}
                >
                  {item.unreadCount > 0 ? '읽음' : '안 읽음으로'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mark(item.notificationIds, { archived: filter !== 'archived' })}
                  className={SMALL_BUTTON}
                >
                  {filter === 'archived' ? '보관 해제' : '보관'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {next !== null && items.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          data-testid="inbox-more"
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
          onClick={() => void loadMore()}
          className="self-center rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </div>
  )
}

const SMALL_BUTTON =
  'rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
