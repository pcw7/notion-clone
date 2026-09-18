/**
 * 브라우저 쪽 협업 연결 — 본문 Y.Doc 하나를 협업 서버에 붙여 두는 단위 (F-05-01 · F-05-04 · F-05-19 · CRDT 6c조각)
 *
 * 편집기(6d)는 이 연결이 준 `doc` 에 바인딩하고(`collab-editor.ts`), 연결이 문서를 바꾸면 다시 바인딩한다. 화면은 없다 — 그래서 실제
 * 협업 서버에 node 의 provider 로 붙어 검사한다(`collab-connection.db.test.ts`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 서버가 닫은 이유로 가른다 (HANDOFF §2 "6조각이 지켜야 할 것 — 5a · 5c")
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이유는 두 길로 온다 — 연결을 받을 때는 `authenticationFailed`, 받은 뒤에는 `close`(이유가 빈 `close` 는 소켓이 끊긴 것이라 provider 가
 * 스스로 다시 붙는다). provider 는 서버가 닫은 문서에 다시 붙지 않고 그 문서를 붙든 채 편집을 세기만 한다(4.7.0 진단) — 그래서 이유를
 * 받으면 그 provider 는 늘 버린다.
 *
 *   - **쓰기 거부 · `forbidden`(강등)** — 로컬 문서에 거부된 update 가 이미 들어가 있다. 그대로 다시 붙으면 동기화가 같은 update 를 또
 *     보내 또 닫힌다. **로컬 문서와 보존본을 버리고** 새 문서로 다시 연다(권한이 줄었으면 서버가 읽기 전용으로 받는다). 새 문서가 동기화된
 *     뒤에 바꾼다 — 빈 화면을 보이지 않는다. 버린 문서는 `onDiscarded` 로 알린다(F-05-19 "조용한 유실 금지")
 *   - **`not_found`** — 닫는다(볼 수 없는 페이지와 없는 페이지를 가르지 않는다). 보낼 수 없는 편집이므로 보존본도 지우고 알린다
 *   - **`unauthenticated` · `sso_required`** — 닫는다(로그인). 보존본은 남긴다 — 다시 로그인하면 보낸다
 *   - **`unavailable`** — 서버가 권한을 다시 판정하지 못했다. 거부된 편집이 아니므로 **로컬을 버리지 않고** 잠시 뒤 다시 붙는다
 *   - **`forbidden_origin`** — 설정이 틀렸다. 닫고 보존본은 남긴다
 *   - 모르는 이유 — 쓰기 거부로 본다(버리고 다시 연다). 서버가 문서를 닫았다는 것은 받은 update 를 쌓지 않았다는 뜻이다
 *
 * 읽기 전용 연결은 보낸 update 를 서버가 버리고 확인 요청에 **확인하지 않는다**고 답한다 — 그 답을 받으면 보낼 수 없는 편집이므로 버리고
 * 다시 연다(`read_only`). 인증 때 받은 scope 로 먼저 버리는 길은 두지 않았다 — 같은 일을 하는 길이 둘이면 한쪽이 검사되지 않는다
 * (반사실에서 그 길을 빼도 서버의 답이 같은 결과를 냈다). scope 는 화면이 편집을 막는 데 쓴다(`readOnly`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 서버가 확인하지 않은 편집만 보존본에 남긴다 (F-05-04)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 로컬 편집(provider 가 적용한 것 · 서버가 준 첫 상태 · 되살린 보존본이 아닌 update)은 쌓아 두고 합쳐 보존본에 쓴다. 다음에 열 때
 * 서버가 준 상태 위에 적용하면 동기화가 서버에 없는 것만 보낸다 — 이미 쌓인 것을 다시 적용해도 아무 일이 없다.
 *
 * 지우는 것은 **서버의 확인 답을 받은 뒤**다(`collab-protocol.ts`). 확인 요청은 동기화가 끝난 연결(`synced`)에서만 보낸다 — 서버는
 * SyncStep1 을 SyncStep2 보다 먼저 보내므로 `synced` 가 되었을 때 로컬 문서 전부가 이 연결로 이미 나갔거나 서버에 있다(동기화 응답 ·
 * 끊긴 동안 큐에 쌓였다 첫 메시지 때 나간 것). 그 요청의 답이 오면 요청 전의 편집은 전부 로그에 있다. provider 의 `unsyncedChanges` 는
 * 다시 붙을 때 먼저 나간 큐의 확인이 동기화 응답의 확인보다 앞서 와 너무 일찍 0 이 된다(HANDOFF §3.3-120).
 * ⚠ "`synced` 뒤에만"은 Hocuspocus 4.7.0 소스로 읽은 순서에 기댄다 — 동기화 전에도 요청하는 반사실에서 검사가 전부 통과했다(동기화
 * 응답보다 요청이 먼저 처리되는 장면을 결정적으로 만들지 못했다).
 *
 * 보존본의 열쇠(`storeKey`)는 부르는 쪽이 정한다 — 사용자를 넣어야 같은 브라우저에서 다른 사람이 열 때 그 편집을 보내지 않는다.
 *
 * ⚠ 다시 여는 동안(`reopening`) 편집기는 버린 문서를 붙들고 있다 — 그 문서에 친 편집은 쌓지 않으므로 편집기를 막아야 한다(6d).
 *
 * 브라우저가 **연결이 돌아왔다고 알리면 곧바로 다시 붙는다**(`online`). provider 의 소켓은 다시 붙을 때마다 간격을 두 배로 늘려
 * (최대 30s) 기다리는데, 그 사이에 연결이 돌아와도 그만큼 조용히 기다린다 — 사용자는 이미 연결이 있는데 저장이 안 되는 것으로 본다.
 *
 * **provider 마다 소켓 하나**다. 문서를 버리고 다시 열 때 provider 와 소켓을 함께 새로 만든다 — 하나의 소켓을 다시 쓰면 소켓이
 * provider 를 **문서 이름 하나로만** 기억해(`providerMap`) 옛 provider 를 떼는 순간 새 provider 의 자리가 지워진다.
 *
 * ⚠ 내린 소켓은 **예약된 재시도로 되살아난다** — 4.7.0 의 `destroy()` 는 `onClose` 가 걸어 둔 재시도 타이머를 지우지 않고, 그
 * 타이머가 부르는 `connect()` 가 "다시 붙기"를 되돌린다. 그래서 내릴 때 그 길을 막는다(막지 않으면 버린 연결마다 소켓이 영영
 * 다시 붙는다 — 검사 프로세스가 끝나지 않아 찾았다).
 */

import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket, type HocuspocusProviderWebsocketConfiguration } from '@hocuspocus/provider'

import { collabDocumentName, confirmationRequest, parseConfirmationReply } from './collab-protocol.ts'

/** 서버가 확인하지 않은 편집의 보존본. 페이지 · 사용자마다 합친 update 하나다. */
export type PendingEditStore = {
  /** 탭을 닫아도 남는가. false 면 화면이 "탭을 닫으면 사라진다"고 말할 수 있어야 한다(`pending-store.ts`). */
  readonly durable: boolean
  read(key: string): Promise<Uint8Array | null>
  /** null 이면 지운다. */
  write(key: string, update: Uint8Array | null): Promise<void>
}

/** 검사와 폴백용 — 같은 계약을 지키되 탭을 닫으면 사라진다. */
export function memoryPendingEditStore(): PendingEditStore & { readonly entries: ReadonlyMap<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>()
  return {
    durable: false,
    entries,
    async read(key) {
      return entries.get(key) ?? null
    },
    async write(key, update) {
      if (update === null) entries.delete(key)
      else entries.set(key, update)
    },
  }
}

/** 닫힌 연결이 다시 붙지 않는 이유 — 화면이 그리는 것. */
export type CollabClosed = 'not_found' | 'login' | 'misconfigured'

/** 서버가 닫은 이유에 따라 하는 일(머리말). */
export type RejectionAction = 'reopen' | 'retry' | 'not_found' | 'login' | 'misconfigured'

export function rejectionAction(reason: string): RejectionAction {
  switch (reason) {
    case 'not_found':
      return 'not_found'
    case 'unauthenticated':
    case 'sso_required':
      return 'login'
    case 'unavailable':
      return 'retry'
    case 'forbidden_origin':
      return 'misconfigured'
    default:
      return 'reopen'
  }
}

export type CollabSnapshot = {
  /** 편집기가 바인딩할 문서. 버리고 다시 열면 바뀐다. */
  readonly doc: Y.Doc
  /** 읽기 전용으로 받았는가. 아직 모르면(첫 인증 전 · 다시 여는 중) null. */
  readonly readOnly: boolean | null
  /** 서버와 이어져 있다. */
  readonly online: boolean
  /** 서버가 확인하지 않은 편집이 있다. */
  readonly unconfirmed: boolean
  /** 문서를 버리고 새 문서가 동기화되기를 기다린다 — `doc` 은 아직 버린 문서다. */
  readonly reopening: boolean
  readonly closed: CollabClosed | null
}

export type DiscardedDoc = {
  /** 서버가 닫은 이유, 또는 읽기 전용으로 받아 보낼 수 없었다(`read_only`). */
  readonly reason: string
  readonly doc: Y.Doc
  /** 서버가 확인하지 않은 편집이 있었다 — 없으면 잃은 것이 없다. */
  readonly unconfirmed: boolean
}

export type CollabConnectionOptions = {
  readonly url: string
  readonly workspaceId: string
  readonly pageId: string
  /** 서버가 준 본문 상태(Y update) — 페이지를 그릴 때 받은 것. 있으면 첫 동기화 전에도 본문이 보인다. */
  readonly initialState?: Uint8Array | null
  readonly store: PendingEditStore
  readonly storeKey: string
  /** 브라우저 밖(검사)에서 쿠키 · Origin 을 싣는 소켓. */
  readonly WebSocketPolyfill?: HocuspocusProviderWebsocketConfiguration['WebSocketPolyfill']
  /** 마지막 로컬 편집에서 확인을 청하기까지. 기본 1s. */
  readonly confirmDelayMs?: number
  /** `unavailable` 뒤 다시 붙기까지의 첫 간격 — 거듭되면 두 배씩, 최대 30s. 기본 1s. */
  readonly retryDelayMs?: number
  /** "연결이 돌아왔다"(`online`)를 알리는 곳. 기본은 브라우저의 `window` — 브라우저 밖(검사)에서는 넣어 준다. */
  readonly onlineSource?: EventTarget
  onChange?(snapshot: CollabSnapshot): void
  onDiscarded?(discarded: DiscardedDoc): void
}

export type CollabConnection = {
  snapshot(): CollabSnapshot
  /**
   * 지금까지의 편집이 서버 로그에 쌓이기를 기다린다 — 확인을 **곧바로** 청하고 답을 받을 때까지(창을 기다리지 않는다).
   *
   * 하위 페이지를 만들 때 쓴다(6d): 편집기는 `/쿼리` 를 지운 편집이 서버에 있는 뒤에야 그 블록 자리를 서버에 넘길 수 있다 —
   * 먼저 넘기면 서버가 보는 그 블록에는 아직 글자가 있어 대체 대신 뒤에 들어간다.
   *
   * 확인할 것이 없으면 곧바로 끝난다. 끊겨 있으면 다시 붙어 확인될 때까지 기다리므로 **부르는 쪽이 시간을 끊는다**.
   * 문서를 버리거나 닫으면 던진다 — 그 편집은 서버에 가지 않는다.
   */
  confirm(): Promise<void>
  /** provider 를 내린다. 보존본은 지우지 않는다 — 탭을 닫아도 확인받지 못한 편집은 남아야 한다. 밀린 보존본 쓰기를 기다린다. */
  destroy(): Promise<void>
}

/** 서버가 준 첫 상태 · 되살린 보존본을 적용하는 Y 트랜잭션의 origin — 로컬 편집으로 쌓지 않는다. */
const INITIAL = Symbol('collab-connection:initial')
const RESTORED = Symbol('collab-connection:restored')
const MAX_RETRY_DELAY_MS = 30_000

export async function openCollabConnection(options: CollabConnectionOptions): Promise<CollabConnection> {
  const { store, storeKey } = options
  const confirmDelayMs = options.confirmDelayMs ?? 1000
  const firstRetryDelayMs = options.retryDelayMs ?? 1000

  let doc = new Y.Doc()
  if (options.initialState) Y.applyUpdate(doc, options.initialState, INITIAL)
  /** 서버가 확인하지 않은 로컬 편집 — 쌓인 차례대로. 확인 답은 앞에서부터 지운다. */
  let unconfirmed: Uint8Array[] = []
  const restored = await store.read(storeKey)
  if (restored !== null) {
    Y.applyUpdate(doc, restored, RESTORED)
    unconfirmed.push(restored)
  }

  let provider: HocuspocusProvider | null = null
  let readOnly: boolean | null = null
  let online = false
  let reopening = false
  let closed: CollabClosed | null = null
  let destroyed = false
  let retryDelayMs = firstRetryDelayMs
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let confirmTimer: ReturnType<typeof setTimeout> | null = null
  /** 답을 기다리는 확인 요청 — 답이 오면 앞의 `covers` 개가 확인된다. 연결이 바뀌면 버린다. */
  let awaiting: { readonly token: string; readonly covers: number; readonly provider: HocuspocusProvider } | null = null
  let tokens = 0
  /** 쌓은 편집 수 · 확인된 편집 수 — `confirm()` 이 "내 편집까지 확인됐다"를 알아보는 기준이다. */
  let appendedCount = unconfirmed.length
  let confirmedCount = 0
  /** `confirm()` 이 기다리는 쪽 — `target` 만큼 확인되면 끝난다. */
  let waiting: { readonly target: number; resolve(): void; reject(error: Error): void }[] = []

  const settleWaiting = (): void => {
    waiting = waiting.filter((waiter) => {
      if (confirmedCount < waiter.target) return true
      waiter.resolve()
      return false
    })
  }

  const failWaiting = (reason: string): void => {
    const waiters = waiting
    waiting = []
    for (const waiter of waiters) waiter.reject(new Error(`편집을 서버에 쌓지 못했다: ${reason}`))
  }

  const snapshot = (): CollabSnapshot => ({
    doc,
    readOnly,
    online,
    unconfirmed: unconfirmed.length > 0,
    reopening,
    closed,
  })
  const emit = (): void => options.onChange?.(snapshot())

  // ── 보존본 ──────────────────────────────────────────────────────────

  /** 쓰기는 한 번에 하나 — 도는 동안 바뀐 것은 끝난 뒤 한 번 더 쓴다(그때의 목록으로). */
  let writing: Promise<void> = Promise.resolve()
  let writeQueued = false
  const persist = (): void => {
    if (writeQueued) return
    writeQueued = true
    writing = writing.then(async () => {
      writeQueued = false
      const value = unconfirmed.length === 0 ? null : unconfirmed.length === 1 ? unconfirmed[0] : Y.mergeUpdates(unconfirmed)
      try {
        await store.write(storeKey, value)
      } catch (error) {
        console.warn('[collab] 보존본을 쓰지 못했다:', error)
      }
    })
  }

  const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === INITIAL || origin === RESTORED || origin instanceof HocuspocusProvider) return
    unconfirmed.push(update)
    appendedCount += 1
    persist()
    scheduleConfirm()
    emit()
  }

  // ── 확인 요청 ───────────────────────────────────────────────────────

  const scheduleConfirm = (): void => {
    if (confirmTimer !== null || awaiting !== null || unconfirmed.length === 0) return
    // 기다리는 쪽(`confirm()`)이 있으면 창을 기다리지 않는다 — 지금 보낼 수 없으면(동기화 전 · 끊김) 다음 `synced` 가 다시 부른다.
    if (waiting.length > 0) {
      sendConfirm()
      return
    }
    confirmTimer = setTimeout(sendConfirm, confirmDelayMs)
  }

  const sendConfirm = (): void => {
    confirmTimer = null
    // 동기화가 끝난 연결에서만 — 머리말. 아니면 다음 `synced` 가 다시 청한다.
    if (provider === null || !provider.isSynced || !online || awaiting !== null || unconfirmed.length === 0) return
    tokens += 1
    awaiting = { token: String(tokens), covers: unconfirmed.length, provider }
    provider.sendStateless(confirmationRequest(awaiting.token))
  }

  const onStateless = (from: HocuspocusProvider, payload: string): void => {
    const reply = parseConfirmationReply(payload)
    if (reply === null || awaiting === null || awaiting.provider !== from || awaiting.token !== reply.token) return
    const { covers } = awaiting
    awaiting = null
    if (!reply.confirmed) {
      discard('read_only')
      return
    }
    unconfirmed = unconfirmed.slice(covers)
    confirmedCount += covers
    persist()
    settleWaiting()
    scheduleConfirm()
    emit()
  }

  // ── provider ────────────────────────────────────────────────────────

  const dropProvider = (): void => {
    const current = provider
    provider = null
    awaiting = null
    online = false
    // **곧바로** 내린다. 소켓은 provider 를 문서 이름 하나로 기억하므로(`providerMap`), 새 provider 를 붙인 뒤에 옛 것을
    // 내리면 그 `detach` 가 새 provider 의 자리를 지운다. 소켓도 함께 내리고 되살아나지 못하게 막는다(머리말).
    if (current !== null) {
      const dying = current.configuration.websocketProvider
      current.destroy()
      dying.destroy()
      dying.connect = () => Promise.resolve()
    }
  }

  /** 지금 붙어 있는(또는 붙을) 문서 — 브라우저가 `online` 을 알리면 그대로 다시 붙는다. */
  let attached: { readonly target: Y.Doc; readonly swap: boolean } | null = null

  /** `target` 에 provider 를 붙인다. `swap` 이면 첫 동기화 때 그 문서로 바꾼다(버리고 다시 열기). */
  const connect = (target: Y.Doc, swap: boolean): void => {
    attached = { target, swap }
    const socket = new HocuspocusProviderWebsocket({ url: options.url, WebSocketPolyfill: options.WebSocketPolyfill })
    const next = new HocuspocusProvider({
      websocketProvider: socket,
      name: collabDocumentName(options.workspaceId, options.pageId),
      document: target,
    })
    provider = next
    const mine = (): boolean => provider === next && !destroyed

    next.on('status', ({ status }: { status: string }) => {
      if (!mine()) return
      online = status === 'connected'
      if (!online) awaiting = null // 끊긴 소켓의 답은 오지 않는다
      emit()
    })
    next.on('authenticated', ({ scope }: { scope: string }) => {
      if (!mine()) return
      readOnly = scope === 'readonly'
      emit()
    })
    next.on('synced', ({ state }: { state: boolean }) => {
      if (!mine() || !state) return
      retryDelayMs = firstRetryDelayMs
      if (swap && reopening) {
        doc.off('update', onLocalUpdate)
        doc = target
        doc.on('update', onLocalUpdate)
        reopening = false
      }
      scheduleConfirm()
      emit()
    })
    next.on('stateless', ({ payload }: { payload: string }) => {
      if (mine()) onStateless(next, payload)
    })
    next.on('authenticationFailed', ({ reason }: { reason: string }) => {
      if (mine()) onRejected(reason)
    })
    next.on('close', ({ event }: { event: { reason?: string } }) => {
      if (mine() && event.reason) onRejected(event.reason)
    })
    // 소켓을 넘겨받은 provider 는 스스로 붙지 않는다. 이벤트를 단 뒤에 붙인다.
    next.attach()
  }

  const onRejected = (reason: string): void => {
    switch (rejectionAction(reason)) {
      case 'reopen':
        discard(reason)
        return
      case 'retry':
        dropProvider()
        retryTimer = setTimeout(() => {
          retryTimer = null
          if (!destroyed && closed === null) connect(reopening ? new Y.Doc() : doc, reopening)
        }, retryDelayMs)
        retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS)
        emit()
        return
      case 'not_found':
        close('not_found', reason, true)
        return
      case 'login':
        close('login', reason, false)
        return
      case 'misconfigured':
        close('misconfigured', reason, false)
        return
    }
  }

  const forgetUnconfirmed = (reason: string): void => {
    const hadEdits = unconfirmed.length > 0
    unconfirmed = []
    failWaiting(reason)
    persist()
    options.onDiscarded?.({ reason, doc, unconfirmed: hadEdits })
  }

  /** 로컬 문서와 보존본을 버리고 새 문서로 다시 연다(머리말). */
  const discard = (reason: string): void => {
    dropProvider()
    if (!reopening) {
      doc.off('update', onLocalUpdate)
      forgetUnconfirmed(reason)
    }
    reopening = true
    readOnly = null
    connect(new Y.Doc(), true)
    emit()
  }

  const close = (kind: CollabClosed, reason: string, forget: boolean): void => {
    dropProvider()
    if (forget && !reopening) forgetUnconfirmed(reason)
    // 닫힌 연결에서는 확인이 오지 않는다 — 기다리는 쪽(`confirm`)을 붙잡아 두지 않는다. 보존본은 남을 수 있다(로그인).
    failWaiting(reason)
    closed = kind
    emit()
  }

  /** 연결이 돌아왔다 — 소켓이 예약해 둔 다음 시도를 기다리지 않고 지금 붙는다(머리말). */
  const onBrowserOnline = (): void => {
    if (destroyed || closed !== null || online || attached === null) return
    const { target, swap } = attached
    dropProvider()
    connect(target, swap)
  }
  const onlineSource = options.onlineSource ?? (typeof window === 'undefined' ? null : window)
  onlineSource?.addEventListener('online', onBrowserOnline)

  doc.on('update', onLocalUpdate)
  connect(doc, false)
  if (unconfirmed.length > 0) scheduleConfirm()

  return {
    snapshot,
    confirm() {
      if (destroyed) return Promise.reject(new Error('연결을 내렸다'))
      if (closed !== null) return Promise.reject(new Error(`연결이 닫혔다: ${closed}`))
      const target = appendedCount
      if (confirmedCount >= target) return Promise.resolve()
      const pending = new Promise<void>((resolve, reject) => {
        waiting = [...waiting, { target, resolve, reject }]
      })
      // 창을 기다리지 않는다 — 지금 청한다(앞선 요청이 도는 중이면 그 답 뒤에 이어서 청한다).
      if (confirmTimer !== null) {
        clearTimeout(confirmTimer)
        confirmTimer = null
      }
      sendConfirm()
      return pending
    },
    async destroy() {
      destroyed = true
      onlineSource?.removeEventListener('online', onBrowserOnline)
      failWaiting('연결을 내렸다')
      if (retryTimer !== null) clearTimeout(retryTimer)
      if (confirmTimer !== null) clearTimeout(confirmTimer)
      doc.off('update', onLocalUpdate)
      dropProvider()
      await writing
    },
  }
}
