/**
 * 협업 서버 — Hocuspocus 자체 호스팅 (F-05-02 · F-05-19 · F-05-01 · CRDT 5a조각)
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
 *     다시 해석한다**(F-05-19 "매 mutation 서버 재검사") — 연결을 받을 때 한 번으로는 그 사이의 로그아웃 · 멤버 제거 ·
 *     권한 회수를 모른다
 *   - 참여자의 로컬 문서에는 거부된 update 가 이미 들어가 있다. provider 는 닫힌 문서에 다시 붙지 않고 `close` 의
 *     `reason` 만 받는다 — 로컬 문서를 버리고 다시 여는 것은 에디터 바인딩(6조각)의 일이다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 메모리 문서는 로그의 꼬리로 맞춘다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 쌓은 뒤 메모리 문서가 알던 seq 뒤의 로그를 차례로 적용한다. 거기에는 방금 쌓은 변경 · 같은 seq 의 수선 · 다른
 * 프로세스(서버 명령 경로 ②)가 쌓은 것이 함께 있고, 메모리 문서에 적용하는 것이 곧 모든 연결에 퍼뜨리는 것이다.
 *
 *   - 받은 update 는 그 뒤에 Hocuspocus 가 다시 적용하지만 이미 가진 것이라 update 이벤트가 나지 않는다(진단으로 확인)
 *   - 수선을 따로 퍼뜨리는 길을 두지 않는다 — 수선은 로그에 있다(`doc-store.ts` "구조 위반은 여기서 한 번 고친다")
 *   - 메모리 문서는 로그의 부분집합이다 — 불러온 로그와 쌓인 뒤에 적용한 것뿐이라, 받아들인 update 가 로그에 없는 것에
 *     기댈 수 없다
 *   - ⚠ 명령이 쓴 것은 **다음 참여자 update 가 올 때까지** 연결된 참여자에게 가지 않는다(HANDOFF §7)
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
 *
 * 거부 이유(`CollabRejection`)가 provider 와의 계약이다: 연결을 받을 때는 `authenticationFailed` 로, 받은 뒤에는 `close` 로 간다.
 */

import * as Y from 'yjs'
import { Server, type Document, type LocalTransactionOrigin } from '@hocuspocus/server'

import { SESSION_COOKIE } from '../auth/constants.ts'
import { resolveSessionContext, type SessionContext, type SessionDenialReason } from '../auth/session-context.ts'
import { appendDocUpdate, type AppendFailure } from '../block/body-write.ts'
import { asWorkspaceId, isUuid, type WorkspaceId } from '../ids.ts'
import { loadDocState, pageAccess, readDocUpdatesAfter } from './doc-store.ts'

/** y-protocols/sync 의 메시지 종류 중 update 를 싣는 둘. SyncStep1(0)은 state vector 뿐이다. */
const SYNC_STEP_2 = 1
const SYNC_UPDATE = 2

/** 로그 꼬리를 메모리 문서에 적용하는 Y 트랜잭션의 origin — Hocuspocus 의 저장 훅을 건너뛴다(쓸 것은 이미 로그에 있다). */
const LOG_ORIGIN: LocalTransactionOrigin = { source: 'local', skipStoreHooks: true }

export type CollabServerOptions = {
  /** 0 이면 OS 가 고른다(검사). */
  readonly port: number
  /** 받을 `Origin` — 앱의 출처(`http://localhost:3000` 같은). */
  readonly allowedOrigins: readonly string[]
  readonly quiet?: boolean
  /** SIGINT · SIGTERM 에 스스로 내려간다. 검사는 끈다. */
  readonly stopOnSignals?: boolean
}

export type CollabContext = {
  readonly token: string
  readonly workspaceId: WorkspaceId
  readonly pageId: string
  /** 연결을 받을 때 해석한 세션 — 문서를 불러오는 데만 쓴다. 쓰기는 update 마다 다시 해석한다. */
  readonly session: SessionContext
}

/** provider 가 받는 거부 이유 — 머리말. 쓰기 거부는 `appendDocUpdate` 의 이유 그대로다. */
export type CollabRejection = 'unauthenticated' | 'not_found' | 'sso_required' | 'forbidden_origin' | AppendFailure

export function collabDocumentName(workspaceId: string, pageId: string): string {
  return `${workspaceId}:${pageId}`
}

export function parseCollabDocumentName(name: string): { readonly workspaceId: WorkspaceId; readonly pageId: string } | null {
  const parts = name.split(':')
  if (parts.length !== 2 || !isUuid(parts[0]) || !isUuid(parts[1])) return null
  return { workspaceId: asWorkspaceId(parts[0]), pageId: parts[1] }
}

export function createCollabServer(options: CollabServerOptions): Server<CollabContext> {
  /** 메모리 문서마다 적용한 마지막 seq. 문서를 내렸다 다시 올리면 새 인스턴스라 불러온 seq 부터 다시 센다. */
  const appliedSeq = new WeakMap<Document, bigint>()
  /**
   * 메모리 문서마다 꼬리 적용을 한 줄로 세운다. 없어도 수렴은 한다 — 이미 가진 update 는 다시 적용해도 아무 일이 없고, 순서가
   * 바뀐 update 는 Yjs 가 앞선 것을 기다렸다 합친다. 줄을 세우는 것은 알던 seq 가 뒤로 가 같은 로그를 다시 읽지 않게 하려는 것이다.
   */
  const catchingUp = new WeakMap<Document, Promise<void>>()

  const applyLogTail = async (document: Document, pageId: string): Promise<void> => {
    const known = appliedSeq.get(document)
    if (known === undefined || document.isDestroyed) return
    const rows = await readDocUpdatesAfter(pageId, String(known))
    for (const row of rows) Y.applyUpdate(document, row.payload, LOG_ORIGIN)
    if (rows.length > 0) appliedSeq.set(document, BigInt(rows[rows.length - 1].seq))
  }

  const catchUp = (document: Document, pageId: string): Promise<void> => {
    const run = (catchingUp.get(document) ?? Promise.resolve()).then(() => applyLogTail(document, pageId))
    catchingUp.set(document, run.catch(() => undefined))
    return run
  }

  return new Server<CollabContext>({
    port: options.port,
    quiet: options.quiet ?? false,
    stopOnSignals: options.stopOnSignals ?? true,

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
      const loaded = await loadDocState(context.session, context.pageId)
      if (!loaded.ok) throw rejection('not_found')
      appliedSeq.set(document, BigInt(loaded.value.seq))
      return loaded.value.ydoc
    },

    async beforeSync({ type, payload, connection, context, document }) {
      if (type !== SYNC_STEP_2 && type !== SYNC_UPDATE) return
      if (connection.readOnly) return // Hocuspocus 가 적용하지 않는다

      const resolved = await resolveSessionContext(context.token, context.workspaceId)
      if (!resolved.ok) throw rejection(sessionRejection(resolved.reason))
      const appended = await appendDocUpdate(resolved.context, context.pageId, payload, { origin: 'editor' })
      if (!appended.ok) throw rejection(appended.reason)
      if (appended.appended) await catchUp(document, context.pageId)
    },
  })
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
