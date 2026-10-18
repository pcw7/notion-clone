/**
 * 아이콘 고르개의 "커스텀" 탭 — 워크스페이스의 커스텀 이모지 (인접 제품 7c-2b · F-13-16)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 고르개(`emoji-picker.tsx`)와 같은 까닭(부르는 쪽이 클라이언트 그래프이고 함수 props 를 받는다).
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ⑥ — 열 때마다 목록을 읽는다(`GET /emoji` — 다른 사람이 방금 올린 것도
 * 보인다). 이름으로 찾는다(`searchCustomEmoji` — 부분 일치 · 앞에서 맞는 것 먼저 · 양 끝의 `:` 와 대소문자 무시). 고르면
 * `{type:'custom_emoji', custom_emoji:{id}}` 를 넘긴다 — 저장 · 판정은 아이콘 명령이 한다(지운 이모지면 `invalid_icon`).
 * 비었으면 설정의 이모지 절로 가는 길을 보인다.
 *
 * 항목은 단추다(이모지 탭처럼 활성 항목을 옮기는 격자가 아니다) — 워크스페이스마다 500개까지라 찾기로 좁히고, 검색칸의 Enter 는 첫 후보를
 * 고른다.
 */

import Link from '@/app/link'
import { useEffect, useMemo, useState } from 'react'

import { customEmojiImagePath, type CustomEmojiIcon } from '@/lib/block/page-icon'
import { searchCustomEmoji } from '@/lib/emoji/custom-emoji-rules'

type Listed = { readonly id: string; readonly name: string }

export function CustomEmojiTab({
  workspaceId,
  currentId,
  onPick,
}: {
  workspaceId: string
  /** 지금 아이콘이 커스텀 이모지면 그 id — 목록에서 표시한다. */
  currentId: string | null
  onPick: (icon: CustomEmojiIcon) => void
}) {
  const [list, setList] = useState<readonly Listed[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/workspaces/${workspaceId}/emoji`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { emoji?: Listed[] } | null
        if (!alive) return
        if (!res.ok || !Array.isArray(body?.emoji)) setFailed(true)
        else setList(body.emoji.map((e) => ({ id: e.id, name: e.name })))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [workspaceId, attempt])

  const shown = useMemo(() => (list === null ? [] : searchCustomEmoji(list, query)), [list, query])
  const pick = (entry: Listed) => onPick({ type: 'custom_emoji', custom_emoji: { id: entry.id } })

  return (
    <div role="tabpanel" aria-label="커스텀 이모지" data-testid="icon-custom-panel" className="flex flex-col gap-2">
      <input
        data-testid="custom-emoji-search"
        aria-label="커스텀 이모지 검색"
        placeholder="이름으로 찾기"
        autoFocus
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // 한글 조합을 끝내는 Enter 는 조합의 것이다.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter') {
            e.preventDefault()
            const first = shown[0]
            if (first !== undefined) pick(first)
          }
        }}
        className="min-w-0 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <div className="max-h-72 overflow-auto">
        {list === null && !failed && <p className="px-1 py-2 text-sm text-neutral-500">불러오는 중…</p>}
        {failed && (
          <p role="alert" className="flex items-center gap-2 px-1 py-2 text-sm text-red-600">
            커스텀 이모지를 불러오지 못했습니다.
            <button
              type="button"
              onClick={() => {
                setFailed(false)
                setAttempt((n) => n + 1)
              }}
              className="underline underline-offset-2"
            >
              다시 시도
            </button>
          </p>
        )}
        {list !== null && list.length === 0 && (
          <p data-testid="custom-emoji-empty" className="px-1 py-2 text-sm text-neutral-500">
            아직 커스텀 이모지가 없습니다.{' '}
            <Link href={`/w/${workspaceId}/settings?s=workspace.emoji`} className="underline underline-offset-2">
              설정에서 추가하기
            </Link>
          </p>
        )}
        {list !== null && list.length > 0 && shown.length === 0 && (
          <p className="px-1 py-2 text-sm text-neutral-500">맞는 이모지가 없습니다</p>
        )}
        <div className="grid grid-cols-8 gap-1">
          {shown.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid="custom-emoji-option"
              data-emoji-id={entry.id}
              data-current={entry.id === currentId ? '' : undefined}
              aria-label={`:${entry.name}:`}
              title={`:${entry.name}:`}
              onClick={() => pick(entry)}
              className={`flex h-9 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                entry.id === currentId ? 'ring-1 ring-neutral-400' : ''
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 세션으로 인증되는 우리 경로(아이콘과 같다) */}
              <img src={customEmojiImagePath(workspaceId, entry.id)} alt="" className="h-6 w-6 object-contain" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
