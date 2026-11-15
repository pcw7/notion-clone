'use client'

/**
 * 설정 → 오프라인 — 이 기기에 내려받은 것 · 자동 내려받기 (OF-5 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑥)
 *
 * 이 기기의 것이다 — 목록 · 스위치는 이 브라우저의 IndexedDB(`notion-clone-offline`)에서 읽고 쓴다. 서버가 주는 것은 요금제가 자동 내려받기를
 * 허락하는가뿐이다(`offline.auto_download`).
 *
 *   - **목록** — 이 사람의 사본(페이지 · 데이터베이스 · 모든 워크스페이스) · 종류 · 크기 · 받은 때 · 까닭(직접 · 즐겨찾기 · 최근) · 찾기
 *     (`lib/offline/offline-list.ts`)
 *   - **지우기 · 모두 지우기** — 까닭을 모두 뺀다. 일은 숨은 틀이 한다(`offline-sync-client.ts` → `offline-sync.ts` `removeOfflineCopies`) —
 *     못 보낸 편집은 먼저 보내 보고, 남으면 그 사본을 남기고 그렇게 말한다(편집을 버리지 않는다). 모두 지우기는 화면 안에서 한 번 묻는다
 *   - **자동 내려받기** — 즐겨찾기 · 최근 10개(이 기기 · 이 사람마다). 바꾸면 다시 맞추기를 한 번 청하고 끝나기를 기다린다(받기 · 까닭 빼기).
 *     요금제가 허락하지 않으면 꺼진 스위치와 "Plus 요금제부터"
 *
 * 틀을 부르는 모듈은 누를 때에야 받는다 — 이 화면의 첫 JS 에는 저장소 · 목록의 순수한 부분만 있다.
 */

import { useEffect, useRef, useState } from 'react'

import {
  AUTO_PLAN_NOTE,
  filterOfflineItems,
  formatBytes,
  offlineListItems,
  reasonLabel,
  removedMessage,
  savedAtLabel,
  totalBytes,
  UNTITLED,
} from '@/lib/offline/offline-list'
import { AUTO_DOWNLOAD_OFF, openOfflineStore, type AutoDownloadSettings, type OfflineRecord } from '@/lib/offline/offline-store'

type Listing =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly records: readonly OfflineRecord[]; readonly auto: AutoDownloadSettings }

type AutoKey = keyof AutoDownloadSettings

const NOTE = 'mt-1 text-xs text-neutral-500'
const BUTTON = 'rounded-md border border-neutral-200 px-2 py-0.5 text-xs hover:bg-[rgba(33,27,23,0.05)] disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-white/5'

const AUTO_LABEL: Readonly<Record<AutoKey, string>> = {
  favorites: '즐겨찾기 자동 내려받기',
  recent: '최근 페이지 자동 내려받기(10개)',
}

const AUTO_ON_MESSAGE: Readonly<Record<AutoKey, string>> = {
  favorites: '켰습니다 — 즐겨찾기한 페이지를 이 기기에 내려받았습니다. 다시 연결될 때마다 맞춥니다.',
  recent: '켰습니다 — 최근 페이지 10개를 이 기기에 내려받았습니다. 다시 연결될 때마다 맞춥니다.',
}

const sync = () => import('@/lib/offline/offline-sync-client')

/** 이 사람의 사본 · 스위치 — 저장소를 못 열면 쓸 수 없다고 말한다. */
async function readListing(userId: string): Promise<Listing> {
  const store = await openOfflineStore()
  if (store === null) return { kind: 'unavailable' }
  try {
    const [records, auto] = await Promise.all([store.list(userId), store.autoDownload(userId)])
    return { kind: 'ready', records, auto }
  } catch {
    return { kind: 'unavailable' }
  } finally {
    store.close()
  }
}

export function OfflinePanel({
  workspaceId,
  userId,
  collabUrl,
  autoAllowed,
}: {
  workspaceId: string
  userId: string
  collabUrl: string
  autoAllowed: boolean
}) {
  const [listing, setListing] = useState<Listing>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void readListing(userId).then((next) => {
      if (alive.current) setListing(next)
    })
    return () => {
      alive.current = false
    }
  }, [userId])

  const load = async (): Promise<void> => {
    const next = await readListing(userId)
    if (alive.current) setListing(next)
  }

  const say = (text: string): void => {
    if (alive.current) setMessage(text)
  }
  const config = { userId, collabUrl, workspaceId }

  const toggleAuto = async (which: AutoKey): Promise<void> => {
    if (listing.kind !== 'ready' || !autoAllowed) return
    const next: AutoDownloadSettings = { ...listing.auto, [which]: !listing.auto[which] }
    setBusy(which)
    say(next[which] ? '내려받는 중…' : '자동으로 받은 사본을 정리하는 중…')
    try {
      const store = await openOfflineStore()
      if (store === null) return setListing({ kind: 'unavailable' })
      try {
        await store.setAutoDownload(userId, next)
      } finally {
        store.close()
      }
      setListing({ ...listing, auto: next })
      if (!navigator.onLine) return say('저장했습니다 — 다시 연결되면 맞춥니다.')
      await (await sync()).requestResync(config)
      say(next[which] ? AUTO_ON_MESSAGE[which] : '껐습니다 — 자동으로 받은 사본을 지웠습니다(직접 내려받은 것은 그대로).')
    } catch {
      say('바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    } finally {
      await load()
      if (alive.current) setBusy(null)
    }
  }

  const remove = async (target: readonly string[] | 'all', key: string): Promise<void> => {
    setBusy(key)
    setConfirmAll(false)
    say('지우는 중…')
    try {
      say(removedMessage(await (await sync()).removeOfflineCopies(config, target)))
    } catch {
      say('지우지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    } finally {
      await load()
      if (alive.current) setBusy(null)
    }
  }

  const all = listing.kind === 'ready' ? offlineListItems(listing.records) : []
  const shown = filterOfflineItems(all, query)
  const auto = listing.kind === 'ready' ? listing.auto : AUTO_DOWNLOAD_OFF

  return (
    <section data-testid="offline-settings" data-state={listing.kind} className="mt-6 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-medium">자동 내려받기</h3>
          <p className={NOTE}>이 기기에만 적용됩니다 — 다시 연결될 때마다 즐겨찾기 · 최근 페이지를 내려받고, 더는 아닌 것은 지웁니다.</p>
          {!autoAllowed && (
            <p data-testid="offline-auto-plan" className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {AUTO_PLAN_NOTE}
            </p>
          )}
        </div>
        {(['favorites', 'recent'] as const).map((which) => {
          const on = autoAllowed && auto[which]
          return (
            <button
              key={which}
              type="button"
              role="switch"
              aria-checked={on}
              aria-busy={busy === which}
              disabled={!autoAllowed || listing.kind !== 'ready' || busy !== null}
              data-testid={`offline-auto-${which}`}
              data-state={on ? 'on' : 'off'}
              onClick={() => void toggleAuto(which)}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-[rgba(33,27,23,0.05)] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
            >
              {AUTO_LABEL[which]}
              <span aria-hidden className={`relative h-3.5 w-6 rounded-full transition-colors ${on ? 'bg-green-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}>
                <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? 'left-3' : 'left-0.5'}`} />
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">이 기기에 내려받은 것</h3>
          {listing.kind === 'ready' && (
            <span data-testid="offline-total" className="text-xs text-neutral-500">
              {all.length}개 · {formatBytes(totalBytes(all))}
            </span>
          )}
        </div>
        {listing.kind === 'loading' && <p className="text-sm text-neutral-500">불러오는 중…</p>}
        {listing.kind === 'unavailable' && <p className="text-sm text-neutral-500">이 브라우저에서는 오프라인 저장소를 쓸 수 없습니다.</p>}
        {listing.kind === 'ready' && all.length === 0 && (
          <p data-testid="offline-empty" className="text-sm text-neutral-500">
            내려받은 것이 없습니다. 페이지 메뉴의 &quot;오프라인으로 쓰기&quot;를 켜거나 자동 내려받기를 켜 두세요.
          </p>
        )}
        {listing.kind === 'ready' && all.length > 0 && (
          <>
            <input
              type="search"
              data-testid="offline-search"
              aria-label="내려받은 것 찾기"
              placeholder="제목으로 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-transparent"
            />
            <ul data-testid="offline-list" className="flex flex-col">
              {shown.map((item) => (
                <li
                  key={item.pageId}
                  data-testid="offline-item"
                  data-page-id={item.pageId}
                  data-kind={item.kind}
                  className="flex items-center gap-2 border-b border-[rgb(240,239,237)] py-1.5 text-sm last:border-b-0 dark:border-[#2c2c2b]"
                >
                  <span aria-hidden className="w-5 flex-none text-center">
                    {item.icon?.type === 'emoji' ? item.icon.emoji : item.kind === 'database' ? '🗃️' : '📄'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span data-testid="offline-item-title" className="block truncate">
                      {item.title || UNTITLED}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-neutral-500">
                      <span data-testid="offline-item-kind">{item.kind === 'database' ? '데이터베이스' : '페이지'}</span>·
                      <span data-testid="offline-item-size">{formatBytes(item.bytes)}</span>·
                      <span>{savedAtLabel(item.savedAt)}</span>
                      {item.reasons.map((reason) => (
                        <span
                          key={reason}
                          data-testid="offline-item-reason"
                          data-reason={reason}
                          className="rounded bg-neutral-100 px-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                        >
                          {reasonLabel(reason)}
                        </span>
                      ))}
                      {item.reasons.length === 0 && (
                        <span data-testid="offline-item-reason" data-reason="unsent" className="rounded bg-amber-50 px-1 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          보낼 편집이 남음
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-testid="offline-item-remove"
                    disabled={busy !== null}
                    onClick={() => void remove([item.pageId], item.pageId)}
                    className={`flex-none ${BUTTON}`}
                  >
                    지우기
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 && (
              <p data-testid="offline-no-match" className="text-sm text-neutral-500">
                찾는 제목이 없습니다.
              </p>
            )}
            {confirmAll ? (
              <div role="alertdialog" aria-label="모두 지우기" data-testid="offline-remove-all-confirm" className="flex flex-wrap items-center gap-2 text-sm">
                <span>이 기기에서 {all.length}개를 모두 지울까요?</span>
                <button type="button" data-testid="offline-remove-all-yes" disabled={busy !== null} onClick={() => void remove('all', 'all')} className={`${BUTTON} text-red-600`}>
                  모두 지우기
                </button>
                <button type="button" data-testid="offline-remove-all-cancel" onClick={() => setConfirmAll(false)} className={BUTTON}>
                  취소
                </button>
              </div>
            ) : (
              <button type="button" data-testid="offline-remove-all" disabled={busy !== null} onClick={() => setConfirmAll(true)} className={`self-start ${BUTTON}`}>
                모두 지우기
              </button>
            )}
          </>
        )}
      </div>

      {message !== '' && (
        <p role="status" data-testid="offline-settings-status" className="text-xs text-neutral-500">
          {message}
        </p>
      )}
    </section>
  )
}
