/**
 * 페이지 저장 엔진 — F-05-04
 *
 * 규칙은 `outbox.ts`, 저장소는 `outbox-store.ts`, **순서와 시점**이 여기다.
 * 브라우저 API 를 직접 부르지 않는다 — 보내는 일(`send`)·읽는 일(`fetchRemote`)·
 * 시계(`now`)·타이머(`schedule`)를 전부 주입받으므로 Node 에서 시간을 손으로
 * 돌려가며 시험할 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 디바운스는 **전송**에 건다. 큐 적재에는 걸지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 예전 구현은 편집 후 1초 뒤에 저장을 시작했고, 그 1초 안에 탭을 닫으면 친 글이
 * 사라졌다. 큐에 넣는 것은 네트워크가 아니라 로컬 디스크 쓰기이므로 그렇게 오래
 * 미룰 이유가 없다.
 *
 * 그래도 키 입력마다 쓰지는 않는다(문서 한 벌을 통째로 직렬화한다). 짧은
 * 디바운스(기본 300ms)를 두고, 탭이 숨거나 닫힐 때 `flush()` 가 즉시 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * ack 를 못 받은 저장을 충돌이라고 말하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 응답이 오는 길에 끊기면 저장이 됐는지 알 수 없다. 다시 보내면 서버는 이미 올라간
 * 버전 때문에 409 를 주고, 그대로 믿으면 **아무도 편집하지 않았는데** 사용자에게
 * "다른 곳에서 먼저 저장했습니다"가 뜬다. 그래서 409 를 받으면 서버의 현재 문서를
 * 한 번 읽어 우리가 보낸 것과 비교한다(`sameDoc`). 같으면 우리 저장이 도착한
 * 것이다 — 조용히 끝낸다.
 *
 * 이 비교가 성립하는 근거는 **저장 왕복이 무손실**이라는 것이고, 그것은 추측이
 * 아니라 `outbox.db.test.ts` 가 실제 DB 로 확인한다.
 */

import type { EditorDoc } from '../editor/document.ts'
import {
  afterFailure,
  backoffMs,
  classifyFailure,
  coalesce,
  newEntry,
  rejectionMessage,
  sameDoc,
  syncState,
  type OutboxEntry,
  type SyncState,
} from './outbox.ts'
import type { OutboxStore } from './outbox-store.ts'

export type SendResult =
  | { readonly ok: true; readonly version: string }
  /** `status = 0` 은 응답 자체가 없었다는 뜻이다(네트워크 단절). */
  | { readonly ok: false; readonly status: number; readonly error?: string }

export type Cancel = () => void

export type PageSyncDeps = {
  readonly workspaceId: string
  readonly pageId: string
  readonly store: OutboxStore
  /** 서버가 마지막으로 알려준 버전. 낙관적 잠금의 기준이다. */
  readonly initialVersion: string
  send(entry: OutboxEntry): Promise<SendResult>
  /** 409 를 받았을 때 서버의 현재 문서. 못 읽으면 null. */
  fetchRemote(): Promise<{ version: string; doc: EditorDoc } | null>
  onState(state: SyncState): void
  /** 저장이 확정될 때마다. 사이드바 같은 서버 렌더를 갱신하는 자리. */
  onSaved?: () => void
  now?: () => number
  schedule?: (fn: () => void, ms: number) => Cancel
  sendDebounceMs?: number
  persistDebounceMs?: number
}

export type PageSync = {
  /** 편집이 있었다. 문서를 큐에 넣고 전송을 예약한다. */
  queue(doc: EditorDoc): void
  /** 대기 중인 것을 **지금** 디스크에 쓴다(탭이 숨을 때). */
  flush(): Promise<void>
  /** 지금 보낸다(연결이 돌아왔을 때 · 사용자가 "다시 시도"를 눌렀을 때). */
  sendNow(): Promise<void>
  /**
   * 지난 세션이 못 보낸 것을 되살린다.
   * @returns 에디터에 되돌려 넣어야 할 문서. 없으면 null.
   */
  resume(): Promise<EditorDoc | null>
  /** 충돌을 "내 것으로 덮어쓰기"로 해결한다 — 버전을 빼고 보낸다. */
  overwrite(): Promise<void>
  version(): string
  dispose(): void
}

const DEFAULT_SEND_DEBOUNCE = 1000
const DEFAULT_PERSIST_DEBOUNCE = 300

export function createPageSync(deps: PageSyncDeps): PageSync {
  const now = deps.now ?? (() => Date.now())
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    })
  const sendDebounce = deps.sendDebounceMs ?? DEFAULT_SEND_DEBOUNCE
  const persistDebounce = deps.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE

  let version = deps.initialVersion
  let entry: OutboxEntry | null = null
  /** 아직 디스크에 쓰지 않은 항목. `flush()` 가 이것을 쓴다. */
  let unpersisted: OutboxEntry | null = null
  let sending = false
  let disposed = false

  let cancelPersist: Cancel | null = null
  let cancelSend: Cancel | null = null

  const clearTimers = (): void => {
    cancelPersist?.()
    cancelSend?.()
    cancelPersist = null
    cancelSend = null
  }

  const report = (): void => {
    if (!disposed) deps.onState(syncState(entry, now()))
  }

  const persist = async (): Promise<void> => {
    cancelPersist?.()
    cancelPersist = null
    const pending = unpersisted
    if (pending === null) return
    unpersisted = null
    await deps.store.write(pending)
  }

  const forget = async (): Promise<void> => {
    entry = null
    unpersisted = null
    clearTimers()
    await deps.store.clear(deps.pageId)
    report()
  }

  /** 성공으로 끝났다. 버전을 갱신하고 큐를 비운다. */
  const settle = async (nextVersion: string): Promise<void> => {
    version = nextVersion
    await forget()
    deps.onSaved?.()
  }

  const scheduleSend = (ms: number): void => {
    cancelSend?.()
    cancelSend = schedule(() => {
      cancelSend = null
      void attempt()
    }, ms)
  }

  /**
   * 409 를 받았다. 진짜 충돌인가, 아니면 ack 를 못 받은 우리 저장인가.
   * @returns 우리 저장이었으면 true.
   */
  const wasOurOwnSave = async (sent: OutboxEntry): Promise<boolean> => {
    const remote = await deps.fetchRemote()
    if (remote === null) return false
    if (!sameDoc(sent.doc, remote.doc)) return false
    await settle(remote.version)
    return true
  }

  const attempt = async (): Promise<void> => {
    if (disposed || sending) return
    // 보내기 전에 디스크에 먼저 쓴다 — 요청 도중 탭이 닫혀도 남아 있어야 한다.
    await persist()
    const current = entry
    if (current === null || current.status === 'rejected') return

    sending = true
    try {
      const result = await deps.send(current)
      if (disposed) return

      if (result.ok) {
        // 보내는 동안 새 편집이 들어왔으면 큐에는 더 새 문서가 있다. 그것은
        // 지우지 않고 다음 차례에 보낸다.
        if (entry === current) await settle(result.version)
        else {
          version = result.version
          scheduleSend(0)
        }
        return
      }

      const failure = classifyFailure(result.status, result.error)
      if (failure === 'conflict' && (await wasOurOwnSave(current))) return

      const next = afterFailure(entry ?? current, failure)
      entry = next
      unpersisted = next
      await persist()
      report()
      if (next.status === 'pending') scheduleSend(backoffMs(next.attempts))
    } finally {
      sending = false
    }
  }

  return {
    queue(doc) {
      if (disposed) return
      entry = coalesce(
        entry,
        newEntry({
          pageId: deps.pageId,
          workspaceId: deps.workspaceId,
          doc,
          baseVersion: version,
          now: now(),
        }),
      )
      unpersisted = entry
      report()

      if (cancelPersist === null) {
        cancelPersist = schedule(() => {
          cancelPersist = null
          void persist()
        }, persistDebounce)
      }
      scheduleSend(sendDebounce)
    },

    flush: persist,

    async sendNow() {
      if (entry === null) return
      // 사용자가 "다시 시도"를 눌렀거나 연결이 돌아왔다. 격리를 풀고 처음부터.
      if (entry.status === 'rejected') {
        entry = { ...entry, status: 'pending', attempts: 0, reason: undefined, queuedAt: now() }
        unpersisted = entry
        report()
      }
      clearTimers()
      await attempt()
    },

    async resume() {
      const stored = await deps.store.read(deps.pageId)
      if (stored === null) return null
      // 지난 세션이 못 보낸 문서다. **서버 문서보다 새것**이므로 화면에도 되돌려
      // 넣어야 한다 — 큐만 보내고 화면을 그대로 두면, 다음 키 입력이 낡은 화면
      // 내용을 그대로 저장해 방금 되살린 것을 다시 지운다.
      entry = { ...stored, status: 'pending', attempts: 0, reason: undefined, queuedAt: now() }
      unpersisted = entry
      report()
      scheduleSend(0)
      return stored.doc
    },

    async overwrite() {
      if (entry === null) return
      // 버전을 빼면 서버가 무조건 덮어쓴다(순수 LWW).
      entry = { ...entry, baseVersion: '', status: 'pending', attempts: 0, reason: undefined }
      unpersisted = entry
      version = ''
      report()
      clearTimers()
      await attempt()
    },

    version: () => version,

    dispose() {
      disposed = true
      clearTimers()
    },
  }
}

/** 화면에 보일 문장. 상태가 곧 문구인 곳이 한 군데여야 한다. */
export function syncMessage(state: SyncState): string {
  switch (state.kind) {
    case 'idle':
    case 'queued':
      return ''
    case 'syncing':
      return '동기화 중…'
    case 'rejected':
      return state.message
  }
}

export { rejectionMessage }
