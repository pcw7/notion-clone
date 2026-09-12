/**
 * 저장 큐(outbox) — F-05-04
 *
 * 정본: 05-collaboration-sync.md F-05-04 (낙관적 업데이트 & 로컬 트랜잭션 큐)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 파일은 규칙만 갖는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 저장소(IndexedDB)는 `outbox-store.ts`, 실제로 보내고 재시도하는 일은
 * `page-sync.ts` 다. 여기에는 **언제 다시 보내는가 · 언제 포기하는가 · 무엇을
 * 사용자에게 말하는가**만 있고 브라우저 API 를 쓰지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 우리의 "트랜잭션"은 op 묶음이 아니라 문서 한 벌이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본의 `TransactionQueue` 는 op 들을 묶어 보낸다. Phase 0 에는 op 가 없다 —
 * 마스터 문서 §5.1 이 "페이지 단위 LWW"로 잘랐고, 저장은 문서 전체 PUT 이다.
 *
 * 그래서 **한 페이지에 대기 항목은 언제나 하나**다. 새 편집이 오면 앞의 항목을
 * 덮어쓴다. 정본 엣지 케이스 *"같은 블록에 op 200개 누적 → 전송 전 coalesce"* 가
 * 우리 구조에서는 공짜로 성립한다. Phase 1 에서 Y.Doc 이 들어오면 항목이
 * "업데이트 바이트열"로 바뀌고 병합 규칙이 그때 생긴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 끝나는 길은 둘이다 — 확정, 아니면 거부
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본이 인용한 노션의 원문: *"TransactionQueue stores transactions safely in
 * IndexedDB or SQLite until they're **persisted by the server or rejected**."*
 * 그리고 바로 뒤에 경고가 붙는다 — *"거부 처리 경로를 안 만들면 큐가 영원히 안
 * 비는 좀비 항목이 생긴다."*
 *
 * 그래서 실패를 **다시 보낼 실패**와 **다시 보내도 소용없는 실패**로 가른다.
 * 400(문서가 잘못됐다)을 재시도하면 영원히 도는 좀비가 되고, 5xx·네트워크를
 * 포기하면 사용자가 친 글이 사라진다.
 */

import type { EditorDoc } from '../editor/document.ts'

/** 재시도 상한. 넘으면 격리하고 사용자에게 보여준다(조용한 유실 금지). */
export const MAX_ATTEMPTS = 5

/** 이만큼 밀리면 "동기화 중…"을 보여준다(정본: 기본 무표시, 3초 이상이면 표시). */
export const SYNCING_AFTER_MS = 3000

export type OutboxStatus = 'pending' | 'rejected'

export type OutboxEntry = {
  readonly pageId: string
  readonly workspaceId: string
  /** 보낼 문서 한 벌. 최신 것 하나만 남는다. */
  readonly doc: EditorDoc
  /**
   * 낙관적 잠금의 기준 버전. 빈 문자열이면 **버전을 보내지 않는다**(순수 LWW) —
   * 사용자가 충돌을 보고 "내 것으로 덮어쓰기"를 고른 경우다.
   */
  readonly baseVersion: string
  readonly attempts: number
  readonly status: OutboxStatus
  /** 거부됐을 때 사용자에게 보일 말. */
  readonly reason?: string
  /** 큐에 들어온 시각(ms). "3초 이상 밀렸나"의 기준이다. */
  readonly queuedAt: number
}

export function newEntry(input: {
  pageId: string
  workspaceId: string
  doc: EditorDoc
  baseVersion: string
  now: number
}): OutboxEntry {
  return {
    pageId: input.pageId,
    workspaceId: input.workspaceId,
    doc: input.doc,
    baseVersion: input.baseVersion,
    attempts: 0,
    status: 'pending',
    queuedAt: input.now,
  }
}

/**
 * 새 편집이 왔다. 앞의 항목을 덮어쓰되 **기준 버전과 대기 시작 시각은 앞의 것을
 * 유지**한다.
 *
 * 기준 버전을 새로 쓰면 안 된다 — 대기 중에는 서버가 아직 우리 저장을 받지 않았고,
 * 우리가 아는 최신 버전은 여전히 **처음 큐에 넣을 때의 그 버전**이다.
 *
 * 시각을 유지하는 이유는 표시 때문이다. 계속 타이핑하는 동안 시계가 매번
 * 0 으로 돌아가면, 네트워크가 죽어 3초 넘게 밀려 있어도 "동기화 중"이 영영
 * 안 뜬다.
 */
export function coalesce(previous: OutboxEntry | null, next: OutboxEntry): OutboxEntry {
  if (previous === null) return next
  return {
    ...next,
    baseVersion: previous.baseVersion,
    queuedAt: previous.queuedAt,
    // 앞 항목이 거부돼 격리된 상태였다면, 새 편집은 그 상태를 푼다 —
    // 사용자가 고치고 다시 시도하는 중이다.
    attempts: 0,
    status: 'pending',
  }
}

// ── 실패의 종류 ───────────────────────────────────────────────────────

export type Failure =
  /** 잠깐의 문제. 다시 보낸다 — 네트워크 · 5xx · 429. */
  | 'retry'
  /** 그 사이 누가 저장했다. 사람이 결정해야 한다. */
  | 'conflict'
  /** 권한이 없다. 다시 보내도 같다. */
  | 'forbidden'
  /** 페이지가 없다(지워졌다). */
  | 'gone'
  /** 문서가 잘못됐다. 다시 보내면 영원히 도는 좀비가 된다. */
  | 'invalid'

/**
 * HTTP 상태를 위 다섯 갈래로.
 *
 * `status = 0` 은 "응답 자체가 없었다"(네트워크 단절 · 탭 종료)를 뜻하는 우리
 * 약속이다. 그게 **가장 중요한 재시도 경로**다 — 이 기능이 존재하는 이유다.
 */
export function classifyFailure(status: number, error?: string): Failure {
  if (status === 0) return 'retry'
  if (status === 429 || status >= 500) return 'retry'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404) return 'gone'
  if (status === 409) {
    // `page_ref_missing` 도 409 지만 성격이 다르다 — 문서에서 하위 페이지가
    // 빠졌다는 뜻이라 다시 보내도 같은 답이 온다.
    return error === 'page_ref_missing' ? 'invalid' : 'conflict'
  }
  return 'invalid'
}

/**
 * 다음 재시도까지 기다릴 시간.
 *
 * 지수 백오프 + 상한. 정본은 429 를 *"실패가 아니라 백오프 신호"* 로 다루라고
 * 했고(공개 API 기준 연결당 평균 초당 3요청), 백오프가 없으면 끊긴 네트워크에서
 * 초당 수십 번을 두드리게 된다.
 *
 * 지터는 넣지 않는다 — 우리는 브라우저 탭 하나이고, 난수를 넣으면 테스트가
 * 시간을 확정할 수 없게 된다. 서버가 여러 클라이언트의 동시 재시도에 몰리는
 * 문제(thundering herd)가 실제로 보이면 그때 넣는다.
 */
export function backoffMs(attempts: number): number {
  const base = 1000 * 2 ** Math.max(0, attempts - 1)
  return Math.min(base, 30_000)
}

/** 실패를 반영한 다음 상태. `null` 이면 큐에서 **버린다**(더 보낼 이유가 없다). */
export function afterFailure(entry: OutboxEntry, failure: Failure): OutboxEntry {
  const attempts = entry.attempts + 1
  if (failure === 'retry' && attempts < MAX_ATTEMPTS) {
    return { ...entry, attempts, status: 'pending' }
  }
  return { ...entry, attempts, status: 'rejected', reason: rejectionMessage(failure, attempts) }
}

export function rejectionMessage(failure: Failure, attempts = 0): string {
  switch (failure) {
    case 'forbidden':
      return '이 페이지를 편집할 권한이 없습니다. 변경 사항은 보관해 두었습니다.'
    case 'gone':
      return '페이지를 찾을 수 없습니다. 삭제됐을 수 있습니다.'
    case 'conflict':
      return '다른 곳에서 먼저 저장했습니다.'
    case 'invalid':
      return '이 내용은 저장할 수 없습니다.'
    case 'retry':
      return `${attempts}번 시도했지만 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.`
  }
}

// ── 표시 ──────────────────────────────────────────────────────────────

export type SyncState =
  /** 보낼 것이 없다. 아무것도 보여주지 않는다. */
  | { readonly kind: 'idle' }
  /** 대기 중이지만 아직 짧다. 역시 보여주지 않는다. */
  | { readonly kind: 'queued' }
  /** 3초 이상 밀렸다. */
  | { readonly kind: 'syncing' }
  /** 격리됐다. 사용자가 봐야 한다. */
  | { readonly kind: 'rejected'; readonly message: string; readonly conflict: boolean }

/**
 * 큐 상태 → 화면 상태.
 *
 * 정본: *"기본 무표시. 미전송 op가 3초 이상이면 '동기화 중…', 실패 시
 * '변경 사항을 저장하지 못했습니다 / 재시도'."*
 *
 * 저장할 때마다 "저장됨"을 띄우지 않는 것이 의도다. 잘 되는 것은 조용해야 한다 —
 * 1초마다 깜빡이는 표시는 정보가 아니라 소음이고, 진짜 문제가 생겼을 때 묻힌다.
 */
export function syncState(entry: OutboxEntry | null, now: number): SyncState {
  if (entry === null) return { kind: 'idle' }
  if (entry.status === 'rejected') {
    return {
      kind: 'rejected',
      message: entry.reason ?? rejectionMessage('retry', entry.attempts),
      conflict: entry.reason === rejectionMessage('conflict'),
    }
  }
  return now - entry.queuedAt >= SYNCING_AFTER_MS ? { kind: 'syncing' } : { kind: 'queued' }
}

// ── 문서 비교 ─────────────────────────────────────────────────────────

/**
 * 키 순서에 무관한 JSON. 두 문서가 같은지 보는 데만 쓴다.
 *
 * `save-page-body.ts` 의 `stableJson` 과 같은 일을 한다. 한 벌로 합치지 않은
 * 이유는 그 파일이 DB 커넥션 풀을 끌고 오기 때문이다 — 이 모듈은 브라우저에서
 * 로드된다.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}

/**
 * **보낸 문서와 서버의 문서가 같은가.**
 *
 * 이것이 "ack 를 못 받은 저장"을 구분하는 유일한 방법이다. 응답이 오는 길에
 * 끊기면 클라이언트는 저장이 됐는지 안 됐는지 모른다. 다시 보내면 서버는 이미
 * 올라간 버전 때문에 **409 를 준다** — 아무도 편집하지 않았는데 사용자에게
 * "다른 곳에서 먼저 저장했습니다"라고 말하게 된다.
 *
 * 그때 서버의 현재 문서를 받아 우리가 보낸 것과 비교한다. 같으면 우리 저장이
 * 도착한 것이므로 조용히 끝내고, 다르면 진짜 충돌이다.
 *
 * 빈 자식 배열과 없는 자식 배열은 같은 것으로 본다 — 서버는 `children: []` 로
 * 돌려주고 클라이언트는 생략할 수 있다.
 */
export function sameDoc(a: EditorDoc | null | undefined, b: EditorDoc | null | undefined): boolean {
  if (!a || !b) return false
  return stableJson(normalizeDoc(a)) === stableJson(normalizeDoc(b))
}

function normalizeDoc(doc: EditorDoc): unknown {
  const walk = (blocks: EditorDoc['blocks']): unknown =>
    blocks.map((b) => ({
      id: b.id,
      type: b.type,
      title: b.title ?? [],
      properties: b.properties ?? {},
      format: b.format ?? {},
      children: walk(b.children ?? []),
    }))
  return walk(doc.blocks)
}
