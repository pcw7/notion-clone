/**
 * 다시 붙을 때 — 무엇을 할지 정하는 순수한 부분 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④)
 *
 * 껍데기의 숨은 틀에서 도는 쪽(`offline-sync.ts`)이 저장소 · 라우트 · 협업 연결을 만지고, 여기는 **정하기만** 한다 — DOM · 네트워크 없이 검사한다
 * (`offline-resync.test.ts`). `yjs` 를 부르지 않는다 — 앱의 화면 쪽(`offline-sync-client.ts`)도 이것을 쓴다(병합은 `offline-merge.ts`).
 *
 *   - **계획** — 사본마다: 서버가 `gone` 이라 하면 지운다(사본 · 보존본 — 보안 · 보낼 곳이 없다) · 보존본이 있으면 보낸다(그 뒤 다시 받는다 —
 *     보낸 것으로 서버 판이 바뀐다) · 서버 판이 더 크면 다시 받는다 · 아니면 그대로. 답을 받지 못한 사본은 건드리지 않는다(다음에 다시)
 *   - **한 번에 하나 · 몰리면 한 번** — 앱을 열 때와 `online` 마다 부르지만 도는 것은 늘 하나다. 기다리는 동안 다시 부르면 한 번만 더 돈다
 */

import type { OfflinePageRecord } from './offline-store.ts'

/** 서버의 답 — 지금의 판, 또는 받을 수 없게 됐다(`offline-status.ts`). */
export type PageStatus = { readonly seq: string } | 'gone'

/** 판을 한 번에 묻는 페이지 수의 상한 — 서버(`offline-status.ts`)가 넘으면 거부하고, 기기는 이만큼씩 나눠 묻는다. */
export const MAX_STATUS_PAGES = 100

export type ResyncAction = 'delete' | 'flush' | 'refresh' | 'keep'

export type ResyncStep = { readonly pageId: string; readonly workspaceId: string; readonly action: ResyncAction }

/** 서버 판이 받아 둔 판보다 큰가 — 숫자가 아니면 아니다(다시 받지 않는다). */
export function isNewerSeq(server: string, local: string): boolean {
  try {
    return BigInt(server) > BigInt(local)
  } catch {
    return false
  }
}

/** 사본마다 할 일. `statuses` 에 없는 사본은 답을 받지 못한 것이다 — 그대로 둔다. */
export function planResync(
  records: readonly Pick<OfflinePageRecord, 'pageId' | 'workspaceId' | 'seq'>[],
  statuses: ReadonlyMap<string, PageStatus>,
  pendingPageIds: ReadonlySet<string>,
): ResyncStep[] {
  return records.map((record) => {
    const status = statuses.get(record.pageId)
    const step = (action: ResyncAction): ResyncStep => ({ pageId: record.pageId, workspaceId: record.workspaceId, action })
    if (status === undefined) return step('keep')
    if (status === 'gone') return step('delete')
    if (pendingPageIds.has(record.pageId)) return step('flush')
    return step(isNewerSeq(status.seq, record.seq) ? 'refresh' : 'keep')
  })
}

/** 보낸 결과 — 서버가 확인했다 · 서버가 거부해 버렸다 · 보내지 못했다(시간 · 끊김 · 로그인 — 보존본이 남는다). */
export type FlushOutcome = 'sent' | 'discarded' | 'kept'

/** 보낸 뒤 다시 받는가 — 보냈거나 버렸으면 서버 판이 바뀌었거나 사본이 서버와 달라졌다. 못 보냈으면 서버 판이 컸을 때만. */
export function refreshAfterFlush(outcome: FlushOutcome, serverNewer: boolean): boolean {
  return outcome !== 'kept' || serverNewer
}

/** 서버의 답(`{ pages }`)을 읽는다 — 물은 id 의 답만 · 모양이 아닌 답은 없는 것으로(그대로 둔다). */
export function parseStatusReply(raw: unknown, asked: readonly string[]): Map<string, PageStatus> {
  const out = new Map<string, PageStatus>()
  const pages = typeof raw === 'object' && raw !== null ? (raw as { pages?: unknown }).pages : null
  if (typeof pages !== 'object' || pages === null) return out
  for (const id of asked) {
    const value: unknown = (pages as Record<string, unknown>)[id]
    if (value === 'gone') out.set(id, 'gone')
    else if (typeof value === 'object' && value !== null && typeof (value as { seq?: unknown }).seq === 'string' && /^\d+$/.test((value as { seq: string }).seq)) {
      out.set(id, { seq: (value as { seq: string }).seq })
    }
  }
  return out
}

/** 워크스페이스에 들어올 수 없다는 답(404)이면 그곳의 사본은 모두 `gone` 이다. */
export function allGone(ids: readonly string[]): Map<string, PageStatus> {
  return new Map(ids.map((id) => [id, 'gone' as const]))
}

/** `size` 개씩 나눈다 — 판을 묻는 수의 상한(`MAX_STATUS_PAGES`). */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 한 번에 `limit` 개까지 돌린다 — 결과는 넣은 차례대로. 하나가 던지면 그 자리는 그 오류로 끝난다(다른 것은 계속). */
export async function runLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next
      next += 1
      try {
        results[i] = { status: 'fulfilled', value: await run(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

// ── 한 번에 하나 · 몰리면 한 번 ──────────────────────────────────────

export type ResyncTimers = {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: ResyncTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export type ResyncScheduler = {
  /** 돌기를 청한다 — `delayMs` 동안 조용하면 돈다. 도는 중이면 끝난 뒤 한 번 더(몇 번을 청해도 한 번). */
  request(): void
  /** 지금 도는 것(없으면 곧바로)이 끝나기를 기다린다. */
  idle(): Promise<void>
}

export function createResyncScheduler(run: () => Promise<void>, options: { readonly delayMs: number; readonly timers?: ResyncTimers }): ResyncScheduler {
  const timers = options.timers ?? realTimers
  let timer: unknown = null
  let running: Promise<void> | null = null
  let again = false

  const start = (): void => {
    timer = null
    if (running !== null) {
      again = true
      return
    }
    running = run()
      .catch(() => undefined)
      .then(() => {
        running = null
        if (!again) return
        again = false
        schedule()
      })
  }
  const schedule = (): void => {
    if (timer !== null) timers.clear(timer)
    timer = timers.set(start, options.delayMs)
  }

  return {
    request: schedule,
    idle: () => running ?? Promise.resolve(),
  }
}

// ── 알림 ─────────────────────────────────────────────────────────────

/** 한 번 돈 결과 — 지운 사본 수 · 서버가 거부해 버린 편집(페이지 제목과 그 글). */
export type ResyncReport = {
  readonly gone: number
  readonly discarded: readonly { readonly title: string; readonly text: string }[]
}

/** 화면이 보일 것 — 알릴 것이 없으면 null. `unsaved` 는 버린 편집의 글(복사할 수 있게). */
export type ResyncNotice = { readonly messages: readonly string[]; readonly unsaved: string | null }

export function resyncNotice(report: ResyncReport): ResyncNotice | null {
  const messages: string[] = []
  if (report.gone > 0) messages.push(`권한이 없어져 오프라인 사본 ${report.gone}개를 지웠습니다.`)
  if (report.discarded.length > 0) {
    messages.push(`서버가 받지 않은 오프라인 편집이 있어 버렸습니다(페이지 ${report.discarded.length}개). 아래에서 내용을 확인해 복사해 주세요.`)
  }
  if (messages.length === 0) return null
  const unsaved = report.discarded.length === 0 ? null : report.discarded.map((d) => `# ${d.title || '제목 없음'}\n${d.text}`).join('\n\n')
  return { messages, unsaved }
}

/** 로그아웃 전에 남은 편집이 있다 — 확인을 묻는 말. */
export function unsentEditsWarning(count: number): string {
  return `보내지 못한 편집이 사라집니다 — 페이지 ${count}개. 그래도 로그아웃할까요?`
}

// ── 숨은 틀과 주고받는 말(`offline-sync-frame.ts` · `offline-sync-client.ts`) ─────

export type ResyncConfig = { readonly userId: string; readonly collabUrl: string }

/** 앱의 화면 → 틀. `id` 로 답을 짝짓는다. */
export type SyncRequest =
  | { readonly id: number; readonly kind: 'resync'; readonly config: ResyncConfig }
  | { readonly id: number; readonly kind: 'prepare-logout'; readonly users: readonly string[]; readonly flushAs: ResyncConfig | null }
  | { readonly id: number; readonly kind: 'discard'; readonly users: readonly string[] }

/** 틀 → 앱의 화면. `resync` 는 `ResyncReport` · `prepare-logout` 은 물을 말(없으면 null) · `discard` 는 null. */
export type SyncReply = { readonly id: number; readonly ok: true; readonly value: unknown } | { readonly id: number; readonly ok: false; readonly error: string }
