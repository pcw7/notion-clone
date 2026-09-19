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
 */

import { useCallback, useState } from 'react'
import Link from 'next/link'

export type InboxRow = {
  groupKey: string
  kind: string
  pageId: string
  pageTitle: string
  notificationIds: string[]
  count: number
  unreadCount: number
  lastAt: string
  preview: string | null
  deleted: boolean
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
}

const UNTITLED = '제목 없음'

const when = (iso: string): string => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

export function InboxList({
  workspaceId,
  initialItems,
  initialUnread,
}: {
  workspaceId: string
  initialItems: InboxRow[]
  initialUnread: number
}) {
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState(initialItems)
  const [unread, setUnread] = useState(initialUnread)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const url = `/api/workspaces/${workspaceId}/inbox`

  const load = useCallback(
    async (next: string) => {
      try {
        const res = await fetch(`${url}?filter=${next}`)
        if (!res.ok) {
          setError('인박스를 불러오지 못했습니다.')
          return
        }
        const data = (await res.json()) as { items: InboxRow[]; unread: number }
        setItems(data.items)
        setUnread(data.unread)
      } catch {
        setError('연결에 실패했습니다.')
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
        await load(filter)
      } catch {
        setError('연결에 실패했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [filter, load, url],
  )

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
            <li key={item.groupKey} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/w/${workspaceId}/${item.pageId}`}
                  className="text-sm font-medium hover:underline underline-offset-4"
                >
                  {item.pageTitle || UNTITLED}
                </Link>
                <span className="flex-none text-xs text-neutral-500">
                  {KIND_LABEL[item.kind] ?? item.kind}
                  {item.count > 1 && ` ${item.count}`}
                  {item.unreadCount > 0 && <span className="ml-1 text-neutral-900 dark:text-neutral-100">●</span>}
                </span>
              </div>

              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {item.deleted ? <span className="text-neutral-400">삭제된 코멘트</span> : (item.preview ?? '')}
              </p>

              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">{when(item.lastAt)}</span>
                <button
                  type="button"
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
    </div>
  )
}

const SMALL_BUTTON =
  'rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
