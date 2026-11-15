/**
 * 다시 붙기 · 로그아웃 — 앱의 화면 쪽 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④)
 *
 * 레이아웃의 알림(`app/w/[workspaceId]/offline-resync.tsx`)과 로그아웃 단추(`app/logout-guard.tsx`)가 지연 로드한다. 일은 껍데기를 숨은
 * 틀(`/offline#sync`)로 열어 그 안에서 한다(`offline-sync-frame.ts` → `offline-sync.ts`) — 여기는 `yjs` · 협업 연결을 부르지 않는다. 앱의
 * 화면의 모듈 그래프에 그것들이 들어오면 페이지 화면의 첫 JS 가 커진다(`offline-sync-frame.ts` 머리말).
 *
 *   - **다시 맞추기** — 한 번에 하나 · 몰리면 한 번(`createResyncScheduler`). 이 사람의 사본이 없으면 틀을 열지 않는다(대부분의 사람은
 *     내려받은 것이 없다 — 사본 수만 센다) · 오프라인이면 돌지 않는다
 *   - **로그아웃** — 남은 편집을 보내 보고 물을 말을 받는다 · 지운다
 *   - 틀은 맡긴 일이 없으면 내린다 — 다음에 다시 연다(워커가 캐시한 껍데기). 답이 오지 않는 일은 시간 상한에서 실패로 끝낸다
 */

import {
  createResyncScheduler,
  resyncNotice,
  type ResyncConfig,
  type ResyncNotice,
  type ResyncReport,
  type ResyncScheduler,
  type SyncReply,
  type SyncRequest,
} from './offline-resync.ts'
import { openOfflineStore } from './offline-store.ts'
import { isFrameMessage, SYNC_HASH, SYNC_READY, SYNC_REPLY, SYNC_REQUEST } from './offline-sync-frame.ts'
import { OFFLINE_URL } from './sw-policy.ts'

/** `online` 이 몰려 와도(끊겼다 붙었다) 이만큼 조용하면 한 번. */
const RESYNC_DELAY_MS = 800
/** 틀이 준비됐다고 말하기까지. */
const FRAME_READY_MS = 20_000
/** 일 하나의 답을 기다리는 상한 — 보내기마다 시간 상한이 있지만 틀이 죽으면 답이 오지 않는다. */
const CALL_TIMEOUT_MS = 5 * 60_000

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
type Frame = { readonly element: HTMLIFrameElement; readonly ready: Promise<Window> }

let frame: Frame | null = null
let ids = 0
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()

function closeFrame(): void {
  frame?.element.remove()
  frame = null
}

/** 맡긴 일이 끝났다 — 남은 것이 없으면 틀을 내린다. */
function settle(id: number): { resolve(value: unknown): void; reject(error: Error): void } | null {
  const waiter = waiting.get(id) ?? null
  waiting.delete(id)
  if (waiting.size === 0) closeFrame()
  return waiter
}

function failAll(error: Error): void {
  const all = [...waiting.values()]
  waiting.clear()
  closeFrame()
  for (const waiter of all) waiter.reject(error)
}

let listening = false
function listenForReplies(): void {
  if (listening) return
  listening = true
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || frame === null || event.source !== frame.element.contentWindow) return
    if (!isFrameMessage(event.data, SYNC_REPLY)) return
    const reply = event.data.body as SyncReply
    const waiter = settle(reply.id)
    if (waiter === null) return
    if (reply.ok) waiter.resolve(reply.value)
    else waiter.reject(new Error(reply.error))
  })
}

/** 껍데기를 숨은 틀로 연다 — 준비됐다는 말을 받으면 그 창. */
function openFrame(): Frame {
  const element = document.createElement('iframe')
  element.hidden = true
  element.tabIndex = -1
  element.setAttribute('aria-hidden', 'true')
  element.dataset.testid = 'offline-sync-frame'
  const ready = new Promise<Window>((resolve, reject) => {
    const onReady = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== element.contentWindow || !isFrameMessage(event.data, SYNC_READY)) return
      clearTimeout(timer)
      window.removeEventListener('message', onReady)
      resolve(event.source as Window)
    }
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReady)
      reject(new Error('틀이 답하지 않는다'))
    }, FRAME_READY_MS)
    window.addEventListener('message', onReady)
  })
  element.src = `${OFFLINE_URL}${SYNC_HASH}`
  document.body.append(element)
  return { element, ready }
}

/** 틀에 일을 맡기고 답을 기다린다. */
function call(body: WithoutId<SyncRequest>): Promise<unknown> {
  listenForReplies()
  frame ??= openFrame()
  const current = frame
  ids += 1
  const id = ids
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(id)?.reject(new Error('답이 오지 않는다')), CALL_TIMEOUT_MS)
    waiting.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    current.ready.then(
      (target) => target.postMessage({ type: SYNC_REQUEST, body: { ...body, id } }, window.location.origin),
      (error: unknown) => failAll(error instanceof Error ? error : new Error(String(error))),
    )
  })
}

/** 이 사람의 사본이 있는가 — 본문은 읽지 않는다. */
async function hasOfflineCopies(userId: string): Promise<boolean> {
  const store = await openOfflineStore()
  if (store === null) return false
  try {
    return (await store.count(userId)) > 0
  } catch {
    return false
  } finally {
    store.close()
  }
}

let scheduler: ResyncScheduler | null = null
let latest: { readonly config: ResyncConfig; readonly onNotice: (notice: ResyncNotice) => void } | null = null

/** 돌기를 청한다 — 앱을 열 때 · 브라우저가 `online` 을 알릴 때. 알릴 것이 있으면 `onNotice`(그 돌기에서 한 일만 — 지운 사본은 다시 세지 않는다). */
export function requestResync(config: ResyncConfig, onNotice: (notice: ResyncNotice) => void): void {
  latest = { config, onNotice }
  scheduler ??= createResyncScheduler(
    async () => {
      const target = latest
      if (target === null || !navigator.onLine || !(await hasOfflineCopies(target.config.userId))) return
      try {
        const notice = resyncNotice((await call({ kind: 'resync', config: target.config })) as ResyncReport)
        if (notice !== null) target.onNotice(notice)
      } catch (error) {
        console.warn('[offline] 다시 맞추지 못했다:', error)
      }
    },
    { delayMs: RESYNC_DELAY_MS },
  )
  scheduler.request()
}

/** 로그아웃 전 — 지금 계정(`flushAs`)의 남은 편집을 보내 보고, 그래도 남았으면 물을 말(없으면 null). */
export async function prepareOfflineLogout(users: readonly string[], flushAs: ResyncConfig | null): Promise<string | null> {
  const warning = await call({ kind: 'prepare-logout', users, flushAs })
  return typeof warning === 'string' ? warning : null
}

/** 그 사람들의 내려받은 사본과 보존본을 모두 지운다. */
export async function discardOfflineData(users: readonly string[]): Promise<void> {
  await call({ kind: 'discard', users })
}
