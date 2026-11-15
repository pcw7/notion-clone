/**
 * 다시 붙으면 — 내려받은 페이지를 서버와 맞춘다 · 로그아웃하면 지운다 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④ · CRDT 6c)
 *
 * **껍데기(`/offline`) 안에서 돈다** — 앱의 화면은 껍데기를 숨은 틀(`#sync`)로 열고 일을 넘긴다(`offline-sync-client.ts` ·
 * `offline-sync-frame.ts` — 앱의 화면의 모듈 그래프에서 이것을 떼어 두는 까닭은 그 머리말). 같은 출처라 `fetch` · 협업 연결에 쿠키가 실린다.
 * 무엇을 할지는 순수한 부분이 정한다(`offline-resync.ts`).
 *
 * 한 번 돌기(`runResync`):
 *   1. 이 사람의 사본 · 편집이 남은 보존본을 읽는다. 사본이 없으면 네트워크에 닿지 않고 끝난다
 *   2. 워크스페이스마다 판을 묻는다(`POST …/offline/status` · 상한씩 나눠). 401 · 403 이면 멈춘다(로그인 — 아무것도 지우지 않는다).
 *      워크스페이스 게이트의 404 면 그곳의 사본은 모두 `gone` · 다른 실패는 그 사본을 건드리지 않는다(다음에 다시)
 *   3. **`gone` 은 곧바로 지운다** — 사본과 그 페이지의 보존본(보안 — 보존본은 그 사람의 편집이지만 보낼 곳이 없다)
 *   4. 보존본이 남은 페이지는 **편집기와 같은 협업 연결을 화면 없이 열어** 보내고 서버의 확인 답(6c)을 기다린다 — 한 번에 둘 · 시간을
 *      넘기면 내리고 보존본을 남긴다(다음에 다시). 서버가 거부하면 연결의 길 그대로 버리고(`onDiscarded`) 그 글을 알린다
 *   5. 서버 판이 컸거나 보냈거나 버린 페이지는 다시 받는다(OF-2 의 라우트) — **새 사본 = 서버 상태 + 아직 못 보낸 편집**. 그 사이 볼 수
 *      없게 됐으면(404 · 정책 403) 지운다
 *   6. **데이터베이스(OF-4)는 판을 묻지 않고 늘 다시 받는다** — 처음 50행의 글자뿐이라 작고, 칸의 글자가 다른 표의 제목 · 사람의 이름에도
 *      달려 있어 값싼 판이 없다. 다시 받기가 곧 판정이다 — 볼 수 없게 됐으면(404 · 정책 403) 곧바로 지운다(보존본이 없다 · 읽기만)
 *
 * **보존본은 읽었던 그대로일 때만 지운다**(`replacePendingIf`) — 같은 페이지를 편집기가 열고 있으면 그 연결이 더한 편집이 같은 열쇠에
 * 쓰인다. 뒤에서 보낸 연결이 확인을 받고 지울 때 그것까지 지우면, 탭을 닫았을 때 확인받지 못한 편집이 사라진다.
 *
 * 로그아웃(`prepareOfflineLogout` · `discardOfflineData`) — 지금 계정의 남은 편집은 먼저 보내 본다(시간 상한). 다른 계정의 편집은 보내지
 * 않는다(이 탭의 세션은 그 사람의 것이 아니다). 남으면 화면이 "보내지 못한 편집이 사라집니다"로 묻고, 확인하면 그 사람의 사본과
 * 보존본을 모두 지운다.
 */

import { openCollabConnection, type DiscardedDoc, type PendingEditStore } from '../collab/collab-connection.ts'
import { pendingEditKey } from '../collab/pending-store.ts'
import { readBodyYDocWithSuggestions } from '../collab/ydoc.ts'
import { plainTextForBlocks } from '../editor/block-clipboard.ts'
import { refreshedRecord } from './offline-merge.ts'
import {
  allGone,
  chunked,
  isNewerSeq,
  MAX_STATUS_PAGES,
  parseStatusReply,
  planResync,
  refreshAfterFlush,
  runLimited,
  unsentEditsWarning,
  type FlushOutcome,
  type PageStatus,
  type ResyncConfig,
  type ResyncReport,
  type SyncReply,
  type SyncRequest,
} from './offline-resync.ts'
import { deletePendingEdits, listPendingEdits, readPendingEdit, replacePendingIf } from './offline-pending.ts'
import {
  isDatabaseRecord,
  isPageRecord,
  openOfflineStore,
  parseOfflineDatabasePayload,
  parseOfflinePayload,
  refreshedDatabaseRecord,
  type OfflineDatabaseRecord,
  type OfflinePageRecord,
  type OfflineStore,
} from './offline-store.ts'

/** 뒤에서 보내기 하나의 시간 상한 — 넘기면 내리고 보존본을 남긴다. */
const FLUSH_TIMEOUT_MS = 15_000
/** 로그아웃 전에 보내 보는 시간 — 넘기면 남은 것을 묻는다. */
const LOGOUT_FLUSH_MS = 6000
const CONCURRENCY = 2

const JSON_HEADERS = { 'content-type': 'application/json' }

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('시간을 넘겼다')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const errorOf = async (res: Response): Promise<string | null> => {
  const body: unknown = await res.json().catch(() => null)
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
  return typeof error === 'string' ? error : null
}

/** 사본과 그 페이지의 보존본을 지운다 — 볼 수 없게 된 페이지. */
async function forget(store: OfflineStore, userId: string, pageId: string): Promise<void> {
  await store.remove(userId, pageId)
  await deletePendingEdits(userId, [pageId])
}

/** 한 워크스페이스의 판들. 'stop' 이면 로그인이 풀렸다 — 이번 돌기를 멈춘다. 답을 받지 못한 id 는 빠진다. */
async function fetchStatuses(workspaceId: string, pageIds: readonly string[]): Promise<Map<string, PageStatus> | 'stop'> {
  const out = new Map<string, PageStatus>()
  for (const ids of chunked(pageIds, MAX_STATUS_PAGES)) {
    let res: Response
    try {
      res = await fetch(`/api/workspaces/${workspaceId}/offline/status`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ pageIds: ids }), cache: 'no-store' })
    } catch {
      return out
    }
    if (res.status === 401 || res.status === 403) return 'stop'
    if (res.status === 404) {
      // 워크스페이스 게이트의 답만 — 라우트가 없는 서버(배포 중)의 404 로 사본을 지우지 않는다
      if ((await errorOf(res)) === 'not_found') for (const [id, status] of allGone(ids)) out.set(id, status)
      continue
    }
    if (!res.ok) continue
    for (const [id, status] of parseStatusReply(await res.json().catch(() => null), ids)) out.set(id, status)
  }
  return out
}

type Flushed = { readonly outcome: FlushOutcome; readonly discarded: DiscardedDoc | null }

/**
 * 이 페이지의 보존본을 화면 없이 보낸다 — 편집기와 같은 연결(`openCollabConnection`). 문서는 비어서 시작한다: 보존본만 얹고, 서버와
 * 동기화하면 서버에 없는 것(보존본)이 나간다. 받은 사본을 얹지 않는다 — 서버가 거부해 버린 글이 사본에 남아 있으면 그것까지 다시 보낸다.
 */
async function flushPage(config: ResyncConfig, record: OfflinePageRecord, timeoutMs: number): Promise<Flushed> {
  const key = pendingEditKey(config.userId, record.pageId)
  let seen: Uint8Array | null = null
  const store: PendingEditStore = {
    durable: true,
    async read(k) {
      seen = await readPendingEdit(k)
      return seen
    },
    async write(k, update) {
      // 읽었던 그대로일 때만(머리말) — 편집기가 더한 편집은 그 연결이 확인받고 지운다
      if (await replacePendingIf(k, seen, update)) seen = update
    },
  }
  let discarded: DiscardedDoc | null = null
  const connection = await openCollabConnection({
    url: config.collabUrl,
    workspaceId: record.workspaceId,
    pageId: record.pageId,
    store,
    storeKey: key,
    onDiscarded: (d) => {
      discarded ??= d
    },
  })
  try {
    await withTimeout(connection.confirm(), timeoutMs)
    return { outcome: 'sent', discarded: null }
  } catch {
    const lost = discarded as DiscardedDoc | null
    return lost !== null && lost.unconfirmed ? { outcome: 'discarded', discarded: lost } : { outcome: 'kept', discarded: null }
  } finally {
    await connection.destroy()
  }
}

/** 다시 받는다 — 새 사본 = 서버 상태 + 아직 못 보낸 편집. 'gone' 이면 그 사이 볼 수 없게 됐다. */
async function refreshPage(config: ResyncConfig, store: OfflineStore, record: OfflinePageRecord): Promise<'refreshed' | 'gone' | 'failed'> {
  let res: Response
  try {
    res = await fetch(`/api/workspaces/${record.workspaceId}/pages/${record.pageId}/offline`, { cache: 'no-store' })
  } catch {
    return 'failed'
  }
  if (res.status === 404 || res.status === 403) {
    const error = await errorOf(res)
    return error === 'not_found' || error === 'policy_disabled' ? 'gone' : 'failed'
  }
  if (!res.ok) return 'failed'
  const payload = parseOfflinePayload(await res.json().catch(() => null))
  if (payload === null || payload.pageId !== record.pageId) return 'failed'
  const pending = await readPendingEdit(pendingEditKey(config.userId, record.pageId))
  const now = Date.now()
  await store.replace(config.userId, record.pageId, (current) => refreshedRecord(current, payload, pending, now))
  return 'refreshed'
}

/** 데이터베이스를 다시 받는다(OF-4) — 늘(머리말 6). 'gone' 이면 볼 수 없게 됐다(정책 포함). */
async function refreshDatabase(store: OfflineStore, record: OfflineDatabaseRecord): Promise<'refreshed' | 'gone' | 'failed'> {
  let res: Response
  try {
    res = await fetch(`/api/workspaces/${record.workspaceId}/databases/${record.pageId}/offline`, { cache: 'no-store' })
  } catch {
    return 'failed'
  }
  if (res.status === 404 || res.status === 403) {
    // 워크스페이스 게이트의 404 도 `not_found` 다 — 라우트가 없는 서버(배포 중)의 404 로는 지우지 않는다
    const error = await errorOf(res)
    return error === 'not_found' || error === 'policy_disabled' ? 'gone' : 'failed'
  }
  if (!res.ok) return 'failed'
  const payload = parseOfflineDatabasePayload(await res.json().catch(() => null))
  if (payload === null || payload.databaseId !== record.pageId) return 'failed'
  const now = Date.now()
  await store.replaceDatabase(record.userId, record.pageId, (current) => refreshedDatabaseRecord(current, payload, now))
  return 'refreshed'
}

/** 버린 문서의 글 — 편집기의 "다시 불러왔습니다"와 같은 것(복사할 수 있게). */
function discardedText(discarded: DiscardedDoc, pageId: string): string {
  try {
    return plainTextForBlocks(readBodyYDocWithSuggestions(discarded.doc, pageId).blocks)
  } catch {
    return ''
  }
}

/** 한 번 돈다(머리말). */
export async function runResync(config: ResyncConfig): Promise<ResyncReport> {
  let gone = 0
  const discarded: { title: string; text: string }[] = []
  const report = (): ResyncReport => ({ gone, discarded })
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return report()
  const store = await openOfflineStore()
  if (store === null) return report()
  try {
    const all = await store.list(config.userId)
    if (all.length === 0) return report()
    const records = all.filter(isPageRecord)
    const databases = all.filter(isDatabaseRecord)
    const pending = new Set(records.length === 0 ? [] : await listPendingEdits(config.userId))

    const statuses = new Map<string, PageStatus>()
    for (const workspaceId of new Set(records.map((r) => r.workspaceId))) {
      const answer = await fetchStatuses(
        workspaceId,
        records.filter((r) => r.workspaceId === workspaceId).map((r) => r.pageId),
      )
      if (answer === 'stop') return report()
      for (const [id, status] of answer) statuses.set(id, status)
    }
    const steps = planResync(records, statuses, pending)
    const byPage = new Map(records.map((r) => [r.pageId, r]))

    // 볼 수 없게 된 것 — 곧바로
    for (const step of steps) {
      if (step.action !== 'delete') continue
      await forget(store, config.userId, step.pageId)
      gone += 1
    }

    // 남은 편집 — 보내고, 결과에 따라 다시 받는다
    const flushing = steps.filter((s) => s.action === 'flush').map((s) => byPage.get(s.pageId)!)
    const flushed = await runLimited(flushing, CONCURRENCY, (record) => flushPage(config, record, FLUSH_TIMEOUT_MS))
    const refreshing = steps.filter((s) => s.action === 'refresh').map((s) => byPage.get(s.pageId)!)
    flushing.forEach((record, i) => {
      const result = flushed[i]
      const { outcome, discarded: lost } = result.status === 'fulfilled' ? result.value : ({ outcome: 'kept', discarded: null } satisfies Flushed)
      // 볼 수 없게 돼 버린 것은 글을 보이지 않는다 — 다시 받기가 404 를 받아 지우고 그 수로 알린다
      if (lost !== null && lost.reason !== 'not_found') discarded.push({ title: record.title, text: discardedText(lost, record.pageId) })
      const status = statuses.get(record.pageId)
      const newer = status !== undefined && status !== 'gone' && isNewerSeq(status.seq, record.seq)
      if (refreshAfterFlush(outcome, newer)) refreshing.push(record)
    })

    const refreshed = await runLimited(refreshing, CONCURRENCY, (record) => refreshPage(config, store, record))
    for (const [i, result] of refreshed.entries()) {
      if (result.status !== 'fulfilled' || result.value !== 'gone') continue
      await forget(store, config.userId, refreshing[i].pageId)
      gone += 1
    }

    // 데이터베이스(OF-4) — 늘 다시 받는다 · 볼 수 없게 됐으면 지운다(머리말 6)
    const databaseResults = await runLimited(databases, CONCURRENCY, (record) => refreshDatabase(store, record))
    for (const [i, result] of databaseResults.entries()) {
      if (result.status !== 'fulfilled' || result.value !== 'gone') continue
      await store.remove(config.userId, databases[i].pageId)
      gone += 1
    }
    return report()
  } finally {
    store.close()
  }
}

// ── 로그아웃 ──────────────────────────────────────────────────────────

/** 로그아웃할 사람들 — 지금 계정 · 다른 계정 하나 · 모두(이 브라우저에 함께 로그인한 계정들). */
export type LogoutUsers = readonly string[]

/**
 * 로그아웃 전 — `flushAs`(지금 계정 · 이 탭의 세션)의 남은 편집을 먼저 보내 본다(연결돼 있을 때 · 시간 상한). 그래도 남은 편집이 있으면
 * 물을 말을 돌려준다(없으면 null — 곧바로 지우고 로그아웃한다).
 */
export async function prepareOfflineLogout(users: LogoutUsers, flushAs: ResyncConfig | null): Promise<string | null> {
  if (flushAs !== null && (typeof navigator === 'undefined' || navigator.onLine)) {
    const store = await openOfflineStore()
    if (store !== null) {
      try {
        const pending = new Set(await listPendingEdits(flushAs.userId))
        const targets = (await store.list(flushAs.userId)).filter(isPageRecord).filter((r) => pending.has(r.pageId))
        // 전체로도 상한 — 페이지가 많아도 그만큼만 기다린다(넘긴 연결은 제 시간 상한에 내려간다 · 지운 보존본을 되살리지 않는다)
        await withTimeout(
          runLimited(targets, CONCURRENCY, (record) => flushPage(flushAs, record, LOGOUT_FLUSH_MS)),
          LOGOUT_FLUSH_MS + 1000,
        ).catch(() => undefined)
      } finally {
        store.close()
      }
    }
  }
  const left = (await Promise.all(users.map((id) => listPendingEdits(id)))).flat()
  return left.length === 0 ? null : unsentEditsWarning(left.length)
}

/** 그 사람들의 내려받은 사본과 보존본을 모두 지운다(정본 ④ "로그아웃하면 그 사람의 내려받은 것을 모두 지운다"). */
export async function discardOfflineData(users: LogoutUsers): Promise<void> {
  const store = await openOfflineStore()
  try {
    for (const userId of users) {
      await store?.clear(userId)
      await deletePendingEdits(userId, 'all')
    }
  } finally {
    store?.close()
  }
}

// ── 틀이 받은 일 하나 ─────────────────────────────────────────────────

/** 앱의 화면이 넘긴 일 하나를 하고 답을 만든다(`offline-sync-frame.ts`). 던지면 그 일에만 실패로 답한다. */
export async function handleSyncRequest(request: SyncRequest): Promise<SyncReply> {
  try {
    switch (request.kind) {
      case 'resync':
        return { id: request.id, ok: true, value: await runResync(request.config) }
      case 'prepare-logout':
        return { id: request.id, ok: true, value: await prepareOfflineLogout(request.users, request.flushAs) }
      case 'discard':
        await discardOfflineData(request.users)
        return { id: request.id, ok: true, value: null }
    }
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
