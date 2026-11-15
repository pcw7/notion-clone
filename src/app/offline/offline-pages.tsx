'use client'

/**
 * 껍데기의 "내려받은 페이지" — 이 기기에 받아 둔 페이지를 보이고, 고르면 오프라인 편집기를 연다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ③)
 *
 * 껍데기는 세션이 없는 정적 화면이다 — 목록은 브라우저에서 IndexedDB 로만 읽는다(서버가 그리는 것은 "불러오는 중"뿐 · API 를 부르지 않는다).
 * 누구의 목록인가는 마지막으로 앱을 연 사람의 id 로 정한다(`offline-store.ts` 의 `meta`). 편집기는 고를 때 지연 로드한다 — 껍데기의 첫 JS 는
 * 작게 두고, 그 청크는 내려받을 때 앱이 이 화면을 숨은 틀로 열어 받아 둔다(`#warm` · `lib/offline/offline-warm.ts`).
 *
 * 다시 붙기 · 로그아웃(OF-3)의 일도 이 화면이 숨은 틀(`#sync`)로 열려 한다 — 앱이 넘긴 일을 받아 하고 답한다(`lib/offline/offline-sync-frame.ts`).
 *
 * 내려받은 데이터베이스(OF-4)도 같은 목록에 선다(아이콘 · "데이터베이스" 표로 가른다). 고르면 읽기 전용 표를 연다 — 이 청크에 함께 있다
 * (`offline-database.tsx` 머리말).
 */

import { useEffect, useState, type ComponentType } from 'react'

import type { SyncReply, SyncRequest } from '@/lib/offline/offline-resync'
import { isDatabaseRecord, openOfflineStore, type OfflineDatabaseRecord, type OfflinePageRecord, type OfflineRecord } from '@/lib/offline/offline-store'
import { isFrameMessage, isSyncFrame, SYNC_READY, SYNC_REPLY, SYNC_REQUEST } from '@/lib/offline/offline-sync-frame'
import { isWarmFrame, WARM_MESSAGE, type WarmReply } from '@/lib/offline/offline-warm'

import { OfflineDatabase } from './offline-database'

type EditorComponent = ComponentType<{ record: OfflinePageRecord; onClose: () => void }>

/** 편집기 청크 — 받아 두기 틀과 고르기가 **같은 `import()`** 를 부른다(같은 파일을 받는다). */
const loadOfflineEditor = (): Promise<EditorComponent> => import('./offline-editor').then((m) => m.OfflineEditor)

type Listing =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly pages: readonly OfflineRecord[] }

type Opened =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading'; readonly record: OfflinePageRecord }
  | { readonly kind: 'open'; readonly record: OfflinePageRecord; readonly Editor: EditorComponent }
  | { readonly kind: 'failed'; readonly record: OfflinePageRecord }
  | { readonly kind: 'database'; readonly record: OfflineDatabaseRecord }

const savedAtLabel = (ms: number): string => new Date(ms).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

export function OfflinePages() {
  const [listing, setListing] = useState<Listing>({ kind: 'loading' })
  const [opened, setOpened] = useState<Opened>({ kind: 'none' })

  useEffect(() => {
    // 일하는 틀이면(OF-3 · `#sync`) 앱이 넘긴 일을 하고 답한다 — 다시 붙기 · 로그아웃. 일의 코드는 편집기 청크에 함께 있다(같은
    // `import()` — 새 청크 묶음을 만들지 않는다 · `offline-editor.tsx`). 목록은 그리지 않는다
    if (isSyncFrame(window.location.hash, window.parent !== window)) {
      const origin = window.location.origin
      const onMessage = (event: MessageEvent): void => {
        if (event.origin !== origin || event.source !== window.parent || !isFrameMessage(event.data, SYNC_REQUEST)) return
        const request = event.data.body as SyncRequest
        void import('./offline-editor')
          .then((m) => m.handleSyncRequest(request))
          .catch((error: unknown): SyncReply => ({ id: request.id, ok: false, error: String(error) }))
          .then((reply) => window.parent.postMessage({ type: SYNC_REPLY, body: reply }, origin))
      }
      window.addEventListener('message', onMessage)
      window.parent.postMessage({ type: SYNC_READY }, origin)
      return () => window.removeEventListener('message', onMessage)
    }
    // 받아 두기 틀이면 편집기 청크를 받고 앱에 답한다(목록은 그대로 그린다 — 보이지 않는다)
    if (isWarmFrame(window.location.hash, window.parent !== window)) {
      const reply = (ok: boolean): void => window.parent.postMessage({ type: WARM_MESSAGE, ok } satisfies WarmReply, window.location.origin)
      loadOfflineEditor().then(
        () => reply(true),
        () => reply(false),
      )
    }
    let cancelled = false
    void (async () => {
      const store = await openOfflineStore()
      if (store === null) {
        if (!cancelled) setListing({ kind: 'unavailable' })
        return
      }
      try {
        const userId = await store.lastUser()
        const pages = userId === null ? [] : await store.list(userId)
        if (!cancelled) setListing({ kind: 'ready', pages })
      } catch {
        if (!cancelled) setListing({ kind: 'unavailable' })
      } finally {
        store.close()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const open = (record: OfflineRecord): void => {
    if (isDatabaseRecord(record)) {
      setOpened({ kind: 'database', record })
      return
    }
    setOpened({ kind: 'loading', record })
    loadOfflineEditor().then(
      (Editor) => setOpened((current) => (current.kind === 'loading' && current.record === record ? { kind: 'open', record, Editor } : current)),
      () => setOpened((current) => (current.kind === 'loading' && current.record === record ? { kind: 'failed', record } : current)),
    )
  }

  return (
    <>
      <div data-testid="offline-pages" data-state={listing.kind} className="mt-2 flex flex-col gap-1">
        {listing.kind === 'loading' && <p className="text-sm text-neutral-500">불러오는 중…</p>}
        {listing.kind === 'unavailable' && <p className="text-sm text-neutral-500">이 브라우저에서는 오프라인 저장소를 쓸 수 없습니다.</p>}
        {listing.kind === 'ready' && listing.pages.length === 0 && (
          <p className="text-sm text-neutral-500">오프라인으로 쓰려고 내려받은 페이지가 여기에 보입니다. 페이지 메뉴의 &quot;오프라인으로 쓰기&quot;를 켜 두세요.</p>
        )}
        {listing.kind === 'ready' &&
          listing.pages.map((page) => {
            const database = isDatabaseRecord(page)
            return (
              <button
                key={page.key}
                type="button"
                data-testid="offline-page"
                data-page-id={page.pageId}
                data-kind={database ? 'database' : 'page'}
                onClick={() => open(page)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
              >
                <span aria-hidden className="w-5 flex-none text-center">
                  {page.icon?.type === 'emoji' ? page.icon.emoji : database ? '🗃️' : '📄'}
                </span>
                <span className="min-w-0 flex-1 truncate">{(database ? page.name : page.title) || '제목 없음'}</span>
                {database && (
                  <span data-testid="offline-page-kind" className="flex-none rounded bg-neutral-100 px-1 text-[11px] text-neutral-500 dark:bg-neutral-800">
                    데이터베이스
                  </span>
                )}
                <span className="flex-none text-xs text-neutral-400">{savedAtLabel(page.savedAt)}</span>
              </button>
            )
          })}
        {opened.kind === 'loading' && (
          <p role="status" className="text-sm text-neutral-500">
            여는 중…
          </p>
        )}
        {opened.kind === 'failed' && (
          <p role="alert" data-testid="offline-open-error" className="text-sm text-red-600">
            편집기를 받아 두지 못해 네트워크 없이 열 수 없습니다. 연결된 채 이 페이지의 &quot;오프라인으로 쓰기&quot;를 다시 켜 주세요.
          </p>
        )}
      </div>
      {opened.kind === 'open' && <opened.Editor record={opened.record} onClose={() => setOpened({ kind: 'none' })} />}
      {opened.kind === 'database' && <OfflineDatabase record={opened.record} onClose={() => setOpened({ kind: 'none' })} />}
    </>
  )
}
