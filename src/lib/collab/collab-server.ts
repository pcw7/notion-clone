/**
 * 협업 서버 — Hocuspocus 자체 호스팅 (F-05-02 · F-05-19 · F-05-01 · CRDT 5a조각 · 5c조각)
 *
 * 정본: 판결 C-11(페이지 = 동기화 단위 = 권한 단위 = 채널 단위 = CRDT 문서 단위) · V-5(쓰기 경로 ① 은 `doc_update` 1행
 *       append) · §3.7 런타임 구독 레지스트리("구독 시점 권한검사 + 권한 회수 시 서버 강제 unsubscribe")
 *       마스터 문서 §6.2(Hocuspocus 를 별도 프로세스로 · API 3000 / 협업 3001)
 *
 * Hocuspocus 문서 하나 = 페이지 하나다. 문서 이름은 `{workspaceId}:{pageId}` — 세션을 워크스페이스로 해석해야 권한을 물을
 * 수 있다. 서버를 띄우는 것은 `scripts/collab-server.mjs`(`npm run collab`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쌓은 것만 퍼뜨린다
 * ──────────────────────────────────────────────────────────────────────
 *
 * Hocuspocus 는 받은 update 를 메모리 문서에 적용하는 순간 다른 연결에 퍼뜨린다. 그래서 update 는 적용되기 **전에** 쌓는다 —
 * `beforeSync` 훅은 적용 전에 불리고 Hocuspocus 가 끝나기를 기다린다(한 연결의 메시지는 차례로 처리된다 · 4.7.0 소스).
 * 쌓기가 거부되면 던진다 — 그 update 는 메모리 문서에 들어가지 않고 그 문서 연결이 닫힌다(진단으로 확인했다).
 *
 *   - 쌓기는 `appendDocUpdate`(`block/body-write.ts`) — 로그와 행 투영을 한 트랜잭션에서 한다. 세션은 **update 마다
 *     다시 해석한다**(F-05-19 "매 mutation 서버 재검사")
 *   - 참여자의 로컬 문서에는 거부된 update 가 이미 들어가 있다. provider 는 닫힌 문서에 다시 붙지 않고 `close` 의
 *     `reason` 만 받는다 — 로컬 문서를 버리고 다시 여는 것은 에디터 바인딩(6조각)의 일이다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 퍼뜨리기는 커밋 신호를 따라 한 줄로 (5c)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 메모리 문서에 적용하는 곳은 **로그의 꼬리를 적용하는 곳 하나**이고, 그것을 커밋 신호(`change-feed.ts` — 쓰는 트랜잭션의 트리거가
 * 커밋될 때 보낸다, 마이그레이션 0016)가 부른다. 신호는 커밋 순서대로 온다.
 *
 *   - 꼬리에는 참여자가 보낸 변경 · 같은 seq 의 수선 · 다른 프로세스(서버 명령 경로 ②)가 쌓은 것이 함께 있다 — 명령이 쓴 것도
 *     누가 편집하기를 기다리지 않고 곧바로 간다. 수선을 따로 퍼뜨리는 길은 없다(`doc-store.ts` "구조 위반은 여기서 한 번 고친다")
 *   - **권한 신호를 받으면 그 범위의 연결을 다시 판정해 닫은 뒤에야 다음 꼬리를 적용한다.** 그리고 꼬리는 **신호가 알린 seq 까지만**
 *     읽는다 — 끝까지 읽으면 이미 커밋됐지만 신호가 아직 오지 않은 회수보다 앞지른다. 둘이 합쳐 "회수가 커밋된 뒤에 커밋된 본문은
 *     회수된 연결에 가지 않는다"가 된다
 *   - 참여자 update 는 쌓은 뒤 **그 seq 가 꼬리로 적용될 때까지 기다린다.** 그 뒤 Hocuspocus 가 다시 적용하는 것은 이미 가진 것이라
 *     이벤트가 없다(5a 진단). 쌓자마자 직접 적용하면 앞에 커밋된 회수의 신호보다 먼저 퍼진다
 *   - 신호를 듣는 연결이 끊기면 그 사이 신호는 사라진다. 다시 붙으면 **꼬리를 먼저 읽고 → 모든 연결을 다시 판정하고 → 먼저 읽은
 *     꼬리를 적용한다.** 먼저 읽은 꼬리는 판정 전에 커밋된 것이라, 그보다 앞선 회수는 판정이 보고 뒤의 회수는 그 꼬리보다 뒤다
 *   - 메모리 문서는 로그의 부분집합이다 — 받아들인 update 가 로그에 없는 것에 기댈 수 없다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 연결을 받을 때
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - 신원은 업그레이드 요청의 **세션 쿠키**다. 쿠키는 httpOnly 라 브라우저 코드가 읽어 토큰으로 보낼 수 없다 — provider
 *     의 토큰 자리는 쓰지 않는다
 *   - `Origin` 이 있으면 앱의 출처여야 한다 — 쿠키를 싣는 WebSocket 은 다른 사이트의 페이지도 열 수 있다(CSWSH).
 *     `Origin` 이 없으면 브라우저가 아니다 — 쿠키를 가진 쪽이 직접 붙은 것이라 막을 이유가 없다
 *   - 볼 수 없는 페이지 · 없는 페이지 · 멤버가 아닌 워크스페이스는 모두 `not_found` 다(F-05-19 "404와 403을 구분하면 페이지
 *     존재가 새어나간다" · `auth/route-session.ts` 와 같은 매핑)
 *   - 볼 수만 있으면 읽기 전용 연결이다 — Hocuspocus 가 그 연결의 update 를 적용하지 않는다
 *   - 권한 검사(`onAuthenticate`)와 연결 등록 사이에는 문서 불러오기가 끼어 있다. 그 사이에 커밋된 회수는 다시 판정할 연결이 아직
 *     없어 지나간다 — 그래서 **첫 동기화(SyncStep1)에 답하기 전에** 한 번 더 판정한다. 그보다 뒤에 커밋된 회수는 이미 등록된 연결을
 *     권한 신호가 잡는다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 받은 뒤에 권한이 바뀌면 (F-05-19 · 5c)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 권한 신호(워크스페이스 · 사용자 단위 — 0016 머리말)를 받으면 그 범위의 연결을 전부 **연결을 받을 때와 같은 판정**(세션 → 페이지
 * 권한)으로 다시 본다.
 *
 *   - 볼 수 없게 됐으면 `not_found`, 세션이 끊겼으면 세션 거부 이유로 닫는다
 *   - 고칠 수 있던 연결이 볼 수만 있게 됐으면 `forbidden` 으로 **닫는다** — 읽기 전용으로 바꾸지 않는다. Hocuspocus 의 읽기 전용
 *     연결은 보낸 update 를 닫지 않고 조용히 버리고(`MessageReceiver` — 4.7.0 소스), provider 는 자기가 읽기 전용이 된 것을 모른다.
 *     쓰기 거부(5a)와 같은 이유로 닫아야 참여자가 알고 읽기 전용으로 다시 연다(6조각)
 *   - 볼 수만 있던 연결은 권한이 올라가도 그대로다 — 다시 열면 고칠 수 있다(HANDOFF §7)
 *   - 판정하지 못하면(DB 오류) `unavailable` 로 닫는다 — 회수를 모른 채 두지 않는다. 판정 중 DB 오류를 끼우는 검사는 없다
 *
 * 거부 이유(`CollabRejection`)가 provider 와의 계약이다: 연결을 받을 때는 `authenticationFailed` 로, 받은 뒤에는 `close` 로 간다.
 */

import * as Y from 'yjs'
import { Server, type Connection, type Document, type LocalTransactionOrigin } from '@hocuspocus/server'

import { SESSION_COOKIE } from '../auth/constants.ts'
import { resolveSessionContext, type SessionContext, type SessionDenialReason } from '../auth/session-context.ts'
import { appendDocUpdate, type AppendFailure } from '../block/body-write.ts'
import { asWorkspaceId, isUuid, type WorkspaceId } from '../ids.ts'
import { openChangeFeed, type ChangeFeed, type ChangeFeedHandlers, type CollabSignal } from './change-feed.ts'
import { loadDocState, pageAccess, readDocUpdatesAfter } from './doc-store.ts'

/** y-protocols/sync 의 메시지 종류. SyncStep1(0)은 state vector 뿐이고 답으로 본문이 간다. 둘 · 셋이 update 를 싣는다. */
const SYNC_STEP_1 = 0
const SYNC_STEP_2 = 1
const SYNC_UPDATE = 2

/** 로그 꼬리를 메모리 문서에 적용하는 Y 트랜잭션의 origin — Hocuspocus 의 저장 훅을 건너뛴다(쓸 것은 이미 로그에 있다). */
const LOG_ORIGIN: LocalTransactionOrigin = { source: 'local', skipStoreHooks: true }

/** 서버가 문서 연결을 닫을 때의 코드. provider 는 코드를 1000 으로 바꾸고 이유만 받는다(5a 진단) — 계약은 이유다. */
const CLOSE_CODE = 4403

export type CollabServerOptions = {
  /** 0 이면 OS 가 고른다(검사). */
  readonly port: number
  /** 받을 `Origin` — 앱의 출처(`http://localhost:3000` 같은). */
  readonly allowedOrigins: readonly string[]
  readonly quiet?: boolean
  /** SIGINT · SIGTERM 에 스스로 내려간다. 검사는 끈다. */
  readonly stopOnSignals?: boolean
  /** 커밋 신호를 여는 함수. 없으면 Postgres LISTEN(`openChangeFeed`). 검사가 신호를 붙잡아 두거나 다시 붙는 간격을 줄 때 바꾼다. */
  readonly openFeed?: (handlers: ChangeFeedHandlers) => Promise<ChangeFeed>
}

export type CollabContext = {
  readonly token: string
  readonly workspaceId: WorkspaceId
  readonly pageId: string
  /** 연결을 받을 때 해석한 세션 — 문서를 불러오고 다시 판정할 범위를 고르는 데만 쓴다. 판정은 매번 다시 해석한다. */
  readonly session: SessionContext
}

/** provider 가 받는 거부 이유 — 머리말. 쓰기 거부는 `appendDocUpdate` 의 이유 그대로다. */
export type CollabRejection =
  | 'unauthenticated'
  | 'not_found'
  | 'sso_required'
  | 'forbidden_origin'
  /** 권한 신호를 받고 다시 판정하지 못했다 — 닫는 쪽으로 기운다. */
  | 'unavailable'
  | AppendFailure

export function collabDocumentName(workspaceId: string, pageId: string): string {
  return `${workspaceId}:${pageId}`
}

export function parseCollabDocumentName(name: string): { readonly workspaceId: WorkspaceId; readonly pageId: string } | null {
  const parts = name.split(':')
  if (parts.length !== 2 || !isUuid(parts[0]) || !isUuid(parts[1])) return null
  return { workspaceId: asWorkspaceId(parts[0]), pageId: parts[1] }
}

type LogRow = { readonly seq: string; readonly payload: Uint8Array }
type Waiter = { readonly seq: bigint; resolve(): void; reject(error: Error): void }

export function createCollabServer(options: CollabServerOptions): Server<CollabContext> {
  /** 불러온 메모리 문서 — 페이지 id 로. 신호가 가리키는 문서와 다시 판정할 연결을 여기서 찾는다. */
  const loaded = new Map<string, Document>()
  /** 메모리 문서마다 적용한 마지막 seq. 문서를 내렸다 다시 올리면 새 인스턴스라 불러온 seq 부터 다시 센다. */
  const appliedSeq = new WeakMap<Document, bigint>()
  /**
   * 메모리 문서마다 꼬리 적용을 한 줄로 세운다. 없어도 수렴은 한다 — 이미 가진 update 는 다시 적용해도 아무 일이 없다. 줄을 세우는
   * 것은 알던 seq 가 뒤로 가 같은 로그를 다시 읽지 않게 하려는 것이다.
   */
  const catchingUp = new WeakMap<Document, Promise<void>>()
  /** 쌓은 참여자 update 가 꼬리로 적용되기를 기다리는 쪽(머리말). */
  const waiters = new WeakMap<Document, Waiter[]>()
  /** 다시 판정할 범위 — `ws:{id}` · `user:{id}` — 와 다시 붙은 뒤의 전부 다시 맞추기. */
  let pending = { scopes: new Set<string>(), resync: false }
  /** 지금 도는 다시 판정. 꼬리 적용은 이것이 끝난 뒤에 한다(머리말). */
  let rechecking: Promise<void> | null = null
  let feed: ChangeFeed | null = null

  const settleWaiters = (document: Document, outcome: bigint | Error): void => {
    const list = waiters.get(document)
    if (list === undefined) return
    waiters.set(
      document,
      list.filter((waiter) => {
        if (outcome instanceof Error) waiter.reject(outcome)
        else if (waiter.seq <= outcome) waiter.resolve()
        else return true
        return false
      }),
    )
  }

  /** 읽어 둔 로그를 적용한다. 그 사이 다른 적용이 앞서 갔으면 그 seq 까지는 건너뛴다. */
  const applyRows = (document: Document, rows: readonly LogRow[]): void => {
    let known = appliedSeq.get(document)
    if (known === undefined || document.isDestroyed) return
    for (const row of rows) {
      const seq = BigInt(row.seq)
      if (seq <= known) continue
      Y.applyUpdate(document, row.payload, LOG_ORIGIN)
      known = seq
    }
    appliedSeq.set(document, known)
    settleWaiters(document, known)
  }

  const applyLogTail = async (document: Document, pageId: string, through: bigint | undefined): Promise<void> => {
    const known = appliedSeq.get(document)
    if (known === undefined || document.isDestroyed) return
    if (through !== undefined && known >= through) return
    applyRows(document, await readDocUpdatesAfter(pageId, String(known), through === undefined ? undefined : String(through)))
  }

  /**
   * 꼬리를 `through` 까지(없으면 끝까지) 적용한다 — 그 문서의 앞선 적용과 **지금 도는 다시 판정이 끝난 뒤에**(머리말).
   *
   * 끝까지 읽는 것은 문서를 막 불러왔을 때뿐이다 — 그때는 아직 붙은 연결이 없고, 첫 연결은 첫 동기화 전에 다시 판정한다.
   */
  const catchUp = (document: Document, pageId: string, through?: bigint): Promise<void> => {
    const run = Promise.all([catchingUp.get(document), rechecking]).then(() => applyLogTail(document, pageId, through))
    catchingUp.set(
      document,
      run.catch((error: unknown) => {
        console.error('[collab] 로그 꼬리를 적용하지 못했다:', pageId, error)
        settleWaiters(document, error instanceof Error ? error : new Error(String(error)))
      }),
    )
    return run
  }

  const appliedThrough = (document: Document, seq: bigint): Promise<void> => {
    const known = appliedSeq.get(document)
    if (known !== undefined && known >= seq) return Promise.resolve()
    return new Promise((resolve, reject) => {
      waiters.set(document, [...(waiters.get(document) ?? []), { seq, resolve, reject }])
    })
  }

  /** 범위 안의 연결을 다시 판정해 닫는다(머리말 "받은 뒤에 권한이 바뀌면"). */
  const recheck = async (inScope: (context: CollabContext) => boolean): Promise<void> => {
    const targets: Connection[] = []
    for (const document of loaded.values()) {
      for (const connection of document.getConnections()) {
        if (inScope(connection.context as CollabContext)) targets.push(connection)
      }
    }
    await Promise.all(
      targets.map(async (connection) => {
        let verdict: CollabRejection | null
        try {
          verdict = await connectionVerdict(connection.context as CollabContext, connection.readOnly)
        } catch (error) {
          console.error('[collab] 연결의 권한을 다시 판정하지 못했다 — 닫는다:', error)
          verdict = 'unavailable'
        }
        if (verdict !== null) connection.close({ code: CLOSE_CODE, reason: verdict })
      }),
    )
  }

  /** 끊긴 사이의 신호를 잃었다 — 꼬리를 먼저 읽고, 모든 연결을 다시 판정하고, 먼저 읽은 꼬리를 적용한다(머리말). */
  const resyncAll = async (): Promise<void> => {
    const tails = await Promise.all(
      [...loaded].map(async ([pageId, document]) => {
        const known = appliedSeq.get(document)
        const rows = known === undefined ? [] : await readDocUpdatesAfter(pageId, String(known))
        return { document, rows }
      }),
    )
    await recheck(() => true)
    for (const { document, rows } of tails) applyRows(document, rows)
  }

  const drainRechecks = async (): Promise<void> => {
    await Promise.resolve() // `rechecking` 에 이 약속이 들어간 뒤에 돈다
    while (pending.resync || pending.scopes.size > 0) {
      const job = pending
      pending = { scopes: new Set(), resync: false }
      if (job.resync) await resyncAll()
      else await recheck((context) => job.scopes.has(`ws:${context.workspaceId}`) || job.scopes.has(`user:${context.session.userId}`))
    }
    rechecking = null
  }

  const requestRecheck = (scope: string | 'resync'): void => {
    if (scope === 'resync') pending.resync = true
    else pending.scopes.add(scope)
    rechecking ??= drainRechecks()
  }

  const handlers: ChangeFeedHandlers = {
    onSignal(signal: CollabSignal) {
      if (signal.kind === 'access') {
        requestRecheck(`ws:${signal.workspaceId}`)
      } else if (signal.kind === 'session') {
        requestRecheck(`user:${signal.userId}`)
      } else {
        const document = loaded.get(signal.pageId)
        const seq = BigInt(signal.seq)
        const known = document === undefined ? undefined : appliedSeq.get(document)
        if (document !== undefined && (known === undefined || known < seq)) {
          catchUp(document, signal.pageId, seq).catch(() => undefined) // 기록은 catchUp 이 한다
        }
      }
    },
    onResync() {
      requestRecheck('resync')
    },
  }

  return new Server<CollabContext>({
    port: options.port,
    quiet: options.quiet ?? false,
    stopOnSignals: options.stopOnSignals ?? true,

    async onListen() {
      feed = await (options.openFeed ?? openChangeFeed)(handlers)
    },

    async onDestroy() {
      await feed?.close()
      feed = null
    },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const origin = requestHeaders.get('origin')
      if (origin !== null && !options.allowedOrigins.includes(origin)) throw rejection('forbidden_origin')

      const address = parseCollabDocumentName(documentName)
      if (address === null) throw rejection('not_found')
      const token = sessionTokenOf(requestHeaders)
      if (token === null) throw rejection('unauthenticated')
      const resolved = await resolveSessionContext(token, address.workspaceId)
      if (!resolved.ok) throw rejection(sessionRejection(resolved.reason))

      const access = await pageAccess(resolved.context, address.pageId)
      if (access === 'none') throw rejection('not_found')
      connectionConfig.readOnly = access !== 'edit'

      const context: CollabContext = { token, ...address, session: resolved.context }
      return context
    },

    async onLoadDocument({ context, document }) {
      const loadedState = await loadDocState(context.session, context.pageId)
      if (!loadedState.ok) throw rejection('not_found')
      appliedSeq.set(document, BigInt(loadedState.value.seq))
      return loadedState.value.ydoc
    },

    async afterLoadDocument({ context, document }) {
      // 등록한 **뒤에** 꼬리를 읽는다 — 불러온 뒤 등록 전에 커밋된 것은 이 읽기가, 등록 뒤에 커밋된 것은 신호가 가져온다.
      // ⚠ 검사로 강제하지 못한 방어다 — 불러오기와 등록 사이에 커밋을 끼우는 장면을 만들지 못했고, 이 읽기를 빼는 반사실에서
      // 검사가 전부 통과했다.
      loaded.set(context.pageId, document)
      try {
        await catchUp(document, context.pageId)
      } catch (error) {
        loaded.delete(context.pageId)
        throw error
      }
    },

    async afterUnloadDocument({ documentName }) {
      const address = parseCollabDocumentName(documentName)
      const document = address === null ? undefined : loaded.get(address.pageId)
      if (address === null || document === undefined || !document.isDestroyed) return
      loaded.delete(address.pageId)
      settleWaiters(document, new Error(`문서를 내렸다: ${documentName}`))
    },

    async beforeSync({ type, payload, connection, context, document }) {
      if (type === SYNC_STEP_1) {
        // 첫 동기화에 본문을 답하기 전에 다시 판정한다(머리말 "연결을 받을 때").
        const verdict = await connectionVerdict(context, connection.readOnly)
        if (verdict !== null) throw rejection(verdict)
        return
      }
      if (type !== SYNC_STEP_2 && type !== SYNC_UPDATE) return
      if (connection.readOnly) return // Hocuspocus 가 적용하지 않는다

      const resolved = await resolveSessionContext(context.token, context.workspaceId)
      if (!resolved.ok) throw rejection(sessionRejection(resolved.reason))
      const appended = await appendDocUpdate(resolved.context, context.pageId, payload, { origin: 'editor' })
      if (!appended.ok) throw rejection(appended.reason)
      if (appended.appended) await appliedThrough(document, BigInt(appended.seq))
    },
  })
}

/** 이 연결이 지금 권한으로도 그대로 있어도 되는가 — 아니면 닫을 이유. 연결을 받을 때와 같은 판정이다. */
async function connectionVerdict(context: CollabContext, readOnly: boolean): Promise<CollabRejection | null> {
  const resolved = await resolveSessionContext(context.token, context.workspaceId)
  if (!resolved.ok) return sessionRejection(resolved.reason)
  const access = await pageAccess(resolved.context, context.pageId)
  if (access === 'none') return 'not_found'
  if (access === 'view' && !readOnly) return 'forbidden'
  return null
}

/** Hocuspocus 는 던진 값의 `reason` 을 provider 에 보낸다 — 연결을 받을 때는 permission denied 로, 받은 뒤에는 닫기로. */
function rejection(reason: CollabRejection): Error & { readonly reason: CollabRejection } {
  return Object.assign(new Error(reason), { reason })
}

function sessionRejection(reason: SessionDenialReason): CollabRejection {
  if (reason === 'not_a_member' || reason === 'member_inactive') return 'not_found'
  if (reason === 'sso_required') return 'sso_required'
  return 'unauthenticated'
}

function sessionTokenOf(headers: Headers): string | null {
  const cookie = headers.get('cookie')
  if (cookie === null) return null
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null
  }
  return null
}
