/**
 * 본문 편집 로그 저장소 — `doc_update` · `doc_snapshot` (F-05-01 · F-05-02 · CRDT 2조각 · 4a조각)
 *
 * 정본: 00-canonical-data-model.md §3.7 — 불변식 S1(로그에 삭제 op 가 없다) · S2(seq 는 재동기 축)
 *       판결 C-11 · C-12 · V-5(쓰기 경로 ① 은 `doc_update` 1행 append, ② 는 서버가 로드해 update 1개)
 *       마이그레이션 0007_doc_sync.sql
 *
 * ──────────────────────────────────────────────────────────────────────
 * 로그가 정본, 스냅샷은 캐시
 * ──────────────────────────────────────────────────────────────────────
 *
 * 페이지 본문 = seq 1 부터의 update 를 차례로 적용한 결과. `doc_snapshot` 은 `merged_seq` 까지를 합쳐 둔
 * 것이라 읽기는 스냅샷 + 그 뒤 update 로 끝난다. 압축은 **스냅샷만** 새로 쓰고 로그를 지우지 않는다(S1 —
 * 로그의 물리 삭제는 purge 뿐이다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * seq 는 페이지 안에서 빈틈 없이 1씩
 * ──────────────────────────────────────────────────────────────────────
 *
 * 쓰기는 그 페이지의 스냅샷 행을 `FOR UPDATE` 로 잡고 마지막 seq + 1 을 쓴다. 한 페이지의 쓰기가 한 줄로
 * 서므로 PK 충돌 재시도가 없고 seq 에 빈틈이 없다 — 빈틈이 없어야 "합치지 않은 update 수 = 최신 seq −
 * merged_seq" 가 성립하고, 재동기(S2)에서 빈틈은 곧 유실이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰기는 모두 본문 세션을 거친다 — `openBodyDoc`
 * ──────────────────────────────────────────────────────────────────────
 *
 * 세션은 **호출자의 트랜잭션 안에서** 스냅샷을 잠그고(처음이면 행에서 옮긴 뒤) 본문을 불러와, 변경을 모아
 * 한 seq 로 쌓는다. 쓰기 경로 둘이 같은 세션을 쓰고, 둘 다 `block/body-write.ts` 의 한 단위(페이지 행 잠금 → 세션 →
 * 투영 → 쌓기)를 거친다 — 본문 행은 Y.Doc 의 투영이라(4b) 투영 없이 쌓는 길을 두지 않는다.
 *
 *   ① 참여자가 보낸 update — `appendDocUpdate`(권한 검사 → 세션 → `applyUpdate` → 투영 → `commit`). 협업 서버가
 *     update 마다 부른다(5a조각이 투영과 함께 `body-write.ts` 로 옮겼다)
 *   ② 서버 명령 — 명령이 자기 권한을 검사하고 세션을 열어 ProseMirror 변경(`change`)을 쓴다. 하위 페이지를
 *     만드는 사람은 부모 본문의 `edit_content` 가 아니라 `create_child` 로 부모 문서에 참조를 넣으므로, 세션은
 *     권한을 보지 않는다
 *
 * ⚠ **처음 여는 세션은 그 순간의 행으로 옮긴다.** 하위 페이지 행을 먼저 넣고 부모 본문을 처음 열면 옮기기가 그
 *   참조를 이미 담는다(`doc-store.db.test.ts` ⑦ 이 고정한다). 명령은 세션을 먼저 열고 행을 쓴다 — 어겨도 참조가 둘이
 *   되지는 않는다(넣기가 멱등이다, `block/page-refs.ts` · `block/body-write.ts` 머리말).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쌓기 전에 적용해 본다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - 깨진 바이트는 거부한다. 앞선 update 가 없는 update(적용하면 Yjs 가 pending 으로 들고 있는다)도
 *     거부한다 — 쌓으면 빠진 조각이 오기 전까지 본문에 보이지 않는 내용이 로그에 산다
 *   - 아무것도 바꾸지 않는 변경(이미 받은 것의 재전송)은 쌓지 않는다
 *   - ⚠ "바뀌었는가"를 **state vector 로 판정하지 않는다.** 지우기만 하는 update 는 state vector 를 바꾸지
 *     않는다(Yjs 는 삭제에 새 clock 을 쓰지 않는다). 그렇게 판정하면 삭제가 조용히 사라진다. Y.Doc 의
 *     `update` 이벤트는 삭제만 있어도 나오므로 그것으로 본다
 *   - 쌓는 것은 받은 바이트가 아니라 **적용해서 실제로 바뀐 부분**(그 이벤트가 준 update)이다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 구조 위반은 여기서 한 번 고친다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 적용한 본문이 스키마를 어기면(동시 편집이 합쳐져서) 수선(`repair.ts`)까지 **같은 seq** 에 쌓는다. 수선을 쓰는
 * 곳이 이 줄 선 세션 하나라서 수선끼리 겹쳐 블록이 복제되지 않는다 — 참여자마다 고치면 복제된다.
 *
 *   - 수선은 보낸 쪽이 갖지 않은 변경이므로 돌려준다(`repair`). 협업 서버는 수선이 든 로그 꼬리를 메모리 문서에 적용해
 *     모든 연결에 퍼뜨린다(`collab-server.ts`)
 *   - 따로 seq 를 주지 않았다 — 수선은 이 변경을 지금 본문에 적용한 결과의 일부이고, 정본 origin 6값에
 *     "시스템 수선"이 없다. 그래서 수선의 actor · origin 은 그 변경을 쌓는 쪽의 것이다
 *   - 바뀐 것이 없는 쓰기(재전송)는 고치지 않는다 — 고칠 것은 바뀐 쓰기가 이미 고쳤다
 *
 * ──────────────────────────────────────────────────────────────────────
 * Phase 0 페이지는 처음 읽을 때 한 번 옮긴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 로그가 없는 페이지는 `block` 행에서 문서를 읽어 Y.Doc 을 만들고 seq 1 로 남긴다. `origin` 은 `'import'`
 * — 정본 CHECK 의 6값 중 "다른 형식에서 Y.Doc 을 처음 만든다"에 가장 가깝다. actor 는 없다(시스템).
 *
 *   - 행은 **같은 트랜잭션**에서 읽는다 — 따로 읽으면 그 사이의 저장이 Y.Doc 에서 빠진다
 *   - 둘이 동시에 처음 읽으면 스냅샷 행의 PK 가 한 명만 통과시키고(`ON CONFLICT DO NOTHING`) 진 쪽은 이긴
 *     쪽이 쓴 것을 읽는다. 각자 만든 Y.Doc 은 client id 가 달라 내용이 같아도 **다른 CRDT 이력**이고,
 *     둘이 섞이면 본문이 두 번 들어간다
 *   - 볼 수만 있는 사람이 처음 읽어도 옮긴다 — 내용은 그대로이고 형식만 바뀐다
 */

import * as Y from 'yjs'

import type { SessionContext } from '../auth/session-context.ts'
import { readLiveBody } from '../block/save-page-body.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { MAX_BODY_BYTES } from '../sync/outbox.ts'
import { writeEditorChange, type EditorChange } from './body-edit.ts'
import { repairBodyYDoc } from './repair.ts'
import { createBodyYDoc, readBodyYDoc, type BodyRead, type BodyReadOptions } from './ydoc.ts'

/** 정본 `doc_update.origin` 의 CHECK 값. */
export const DOC_ORIGINS = ['editor', 'api', 'automation', 'restore', 'import', 'external_sync'] as const
export type DocOrigin = (typeof DOC_ORIGINS)[number]

/** update 한 개의 상한. 본문 한도(F-12-16 · `MAX_BODY_BYTES`)와 같은 자릿수로 둔다. */
export const MAX_DOC_UPDATE_BYTES = MAX_BODY_BYTES

/** 합치지 않은 update 가 이만큼 쌓이면 쓰기가 스냅샷을 새로 쓴다. */
export const COMPACT_EVERY = 100

/** 서버 명령이 세션에서 쓰는 변경의 Y 트랜잭션 origin. 참여자의 UndoManager 가 추적하지 않는다. */
export const SERVER_COMMAND_ORIGIN = 'server-command'

export type DocState = {
  readonly ydoc: Y.Doc
  /** 이 상태에 반영된 마지막 seq. 옮긴 페이지는 로그가 비어 있을 수 없으므로 `'1'` 이상이다. */
  readonly seq: string
}

export type LoadDocResult =
  | { readonly ok: true; readonly value: DocState }
  /** 없거나 볼 수 없거나 휴지통에 있는 페이지 — 구분하지 않는다(HANDOFF §3.3-31). */
  | { readonly ok: false; readonly reason: 'not_found' }

/** 살아 있는 페이지에 대한 이 세션의 권한. 볼 수 없으면 없는 것과 같다(`none`). */
export type PageAccess = 'none' | 'view' | 'edit'

export type CommitOptions = BodyReadOptions & {
  /** 쌓는 사람. 시스템이면 null. */
  readonly actorId: string | null
  readonly origin: DocOrigin
  /** 압축 기준. 없으면 `COMPACT_EVERY`. */
  readonly compactEvery?: number
}

export type BodyCommit =
  | { readonly appended: false; readonly seq: string }
  | { readonly appended: true; readonly seq: string; readonly repair: Uint8Array | null }

/** 호출자의 트랜잭션 안에서 잠근 한 페이지의 본문. 한 번 쌓으면 끝난다. */
export type BodyDocSession = {
  readonly pageId: string
  /** 잠근 뒤 읽은 본문 + 이 세션의 변경. */
  readonly ydoc: Y.Doc
  /** 잠근 뒤 읽은 본문의 마지막 seq. */
  readonly seq: string
  /** 이 세션이 본문을 바꿨는가 — 받은 update 가 이미 가진 것뿐이면 false 다. */
  readonly changed: boolean
  /** 지금 본문을 정규화해 읽는다(`readBodyYDoc`). 투영이 이것으로 읽었으면 쌓을 때 같은 것을 넘긴다(`CommitOptions`). */
  read(options?: BodyReadOptions): BodyRead
  /** ProseMirror 변경을 쓴다 — 서버 명령 경로 ②(`body-edit.ts`). */
  change(change: EditorChange): void
  /** 참여자가 보낸 update 를 적용한다 — 경로 ①. 실패를 돌려준 세션은 쌓을 수 없다. */
  applyUpdate(update: Uint8Array): 'applied' | 'invalid_update' | 'missing_dependencies'
  /** 이 세션의 변경을 한 seq 로 쌓는다(구조 위반의 수선까지 — 읽을 때 넘긴 것과 같은 것으로 고친다). */
  commit(options: CommitOptions): Promise<BodyCommit>
}

// ── 읽기 ──────────────────────────────────────────────────────────────

export async function loadDocState(ctx: SessionContext, pageId: string): Promise<LoadDocResult> {
  return withTransaction(async (tx) => {
    if ((await accessOf(tx, ctx, pageId)) === 'none') return { ok: false, reason: 'not_found' } as const
    const state = (await readState(tx, pageId)) ?? (await bootstrapThenRead(tx, ctx, pageId))
    return { ok: true, value: state } as const
  })
}

/** 이 세션이 이 페이지를 볼 수 있는가 · 고칠 수 있는가 — 협업 서버가 연결을 받을 때 묻는다. */
export async function pageAccess(ctx: SessionContext, pageId: string): Promise<PageAccess> {
  return withReadTransaction((tx) => accessOf(tx, ctx, pageId))
}

/**
 * `afterSeq` 뒤에 쌓인 update 를 seq 순서로 — 권한을 보지 않는다.
 *
 * 협업 서버가 메모리 문서를 로그에 맞출 때 읽는다. 그 문서의 연결은 이미 권한 검사를 거쳤다.
 *
 * @param throughSeq 여기까지만 읽는다. 커밋 신호가 알린 seq 를 넘겨 읽으면 아직 도착하지 않은 권한 신호를 앞지른다
 *   (`collab-server.ts` 머리말).
 */
export async function readDocUpdatesAfter(
  pageId: string,
  afterSeq: string,
  throughSeq?: string,
): Promise<readonly { readonly seq: string; readonly payload: Uint8Array }[]> {
  return throughSeq === undefined
    ? query<{ seq: string; payload: Buffer }>(
        `SELECT seq, payload FROM doc_update WHERE page_id = $1 AND seq > $2 ORDER BY seq`,
        [pageId, afterSeq],
      )
    : query<{ seq: string; payload: Buffer }>(
        `SELECT seq, payload FROM doc_update WHERE page_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq`,
        [pageId, afterSeq, throughSeq],
      )
}

// ── 쓰기 ──────────────────────────────────────────────────────────────

/**
 * 한 페이지의 본문을 잠그고 연다. **권한을 보지 않는다** — 호출자가 이미 검사했다(머리말).
 *
 * 이 페이지의 쓰기 · 압축이 여기서 한 줄로 선다. 잠근 뒤에 읽으므로 잠그기 전에 커밋된 쓰기까지 전부 보인다.
 */
export async function openBodyDoc(tx: Tx, ctx: SessionContext, pageId: string): Promise<BodyDocSession> {
  let mergedSeq = await lockSnapshot(tx, pageId)
  if (mergedSeq === null) {
    await bootstrap(tx, ctx, pageId)
    mergedSeq = await lockSnapshot(tx, pageId)
  }
  if (mergedSeq === null) throw new Error(`옮긴 직후의 스냅샷이 없다: ${pageId}`)
  const lockedMergedSeq = mergedSeq

  const state = await readState(tx, pageId)
  if (state === null) throw new Error(`잠근 스냅샷을 읽지 못했다: ${pageId}`)
  const { ydoc } = state

  const changes: Uint8Array[] = []
  const collect = (change: Uint8Array): void => void changes.push(change)
  ydoc.on('update', collect)
  let status: 'open' | 'broken' | 'committed' = 'open'
  const assertOpen = (): void => {
    if (status === 'committed') throw new Error(`이미 쌓은 본문 세션이다: ${pageId}`)
  }

  return {
    pageId,
    ydoc,
    seq: state.seq,
    get changed() {
      return changes.length > 0
    },
    read: (options) => readBodyYDoc(ydoc, pageId, options),
    change(change) {
      assertOpen()
      writeEditorChange(ydoc, change, SERVER_COMMAND_ORIGIN)
    },
    applyUpdate(update) {
      assertOpen()
      try {
        Y.applyUpdate(ydoc, update)
      } catch {
        status = 'broken'
        return 'invalid_update'
      }
      if (ydoc.store.pendingStructs !== null || ydoc.store.pendingDs !== null) {
        status = 'broken'
        return 'missing_dependencies'
      }
      return 'applied'
    },
    async commit(options) {
      assertOpen()
      if (status === 'broken') throw new Error(`적용하지 못한 update 가 있는 세션은 쌓을 수 없다: ${pageId}`)
      status = 'committed'
      ydoc.off('update', collect)
      if (changes.length === 0) return { appended: false, seq: state.seq }

      // 합친 결과가 구조를 어기면 같은 줄 안에서 고친다 — 수선을 쓰는 곳은 여기 하나다(머리말 · `repair.ts`).
      const repaired = repairBodyYDoc(ydoc, pageId, { pageRefDepth: options.pageRefDepth, pageRefs: options.pageRefs })
      // 올리거나 뺀 참조를 쓰지 못하면 행(투영은 고친 문서를 읽었다)과 Y.Doc 이 다르다. 호출자가 먼저 거른다
      // (`block/body-write.ts` — 모르는 노드가 있으면 거부) — 여기 닿으면 그 거르기가 빠진 것이다. 검사로 강제하지 못한
      // 방어다: 앞의 거르기가 있는 한 닿는 입력이 없어, 이 줄을 빼는 반사실(올리기 #82 · 빼기 #83)에서 검사가 전부 통과했다
      // (HANDOFF §3.3-110 · §3.3-113).
      if (repaired.kind === 'skipped' && repaired.fixes.some((fix) => fix === 'page_ref_lifted' || fix === 'page_ref_dropped')) {
        throw new Error(`고친 하위 페이지 참조를 Y.Doc 에 쓰지 못했다(${repaired.reason}): ${pageId}`)
      }
      const repair = repaired.kind === 'repaired' ? repaired.update : null
      if (repair !== null) changes.push(repair)

      const seq = String(BigInt(state.seq) + BigInt(1))
      await tx.query(
        `INSERT INTO doc_update (page_id, seq, payload, actor_id, origin, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [pageId, seq, Buffer.from(changes.length === 1 ? changes[0] : Y.mergeUpdates(changes)), options.actorId, options.origin],
      )

      const compactEvery = options.compactEvery ?? COMPACT_EVERY
      if (BigInt(seq) - BigInt(lockedMergedSeq) >= BigInt(compactEvery)) {
        // 지금 들고 있는 Y.Doc 이 곧 seq 까지의 상태다 — 다시 읽을 필요가 없다.
        await writeSnapshot(tx, pageId, ydoc, seq)
      }
      return { appended: true, seq, repair }
    },
  }
}

// ── 내부 ──────────────────────────────────────────────────────────────

async function accessOf(tx: Tx, ctx: SessionContext, pageId: string): Promise<PageAccess> {
  if (!isUuid(pageId)) return 'none'
  const page = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
    [pageId, ctx.workspaceId],
  )
  if (page === null) return 'none'
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (!can(caps, 'view')) return 'none'
  return can(caps, 'edit_content') ? 'edit' : 'view'
}

/** 스냅샷 + 그 뒤의 update. 옮기지 않은 페이지면 null. */
async function readState(tx: Tx, pageId: string): Promise<DocState | null> {
  const snapshot = await tx.queryMaybe<{ state: Buffer; merged_seq: string }>(
    `SELECT state, merged_seq FROM doc_snapshot WHERE page_id = $1`,
    [pageId],
  )
  if (snapshot === null) return null
  const updates = await tx.query<{ seq: string; payload: Buffer }>(
    `SELECT seq, payload FROM doc_update WHERE page_id = $1 AND seq > $2 ORDER BY seq`,
    [pageId, snapshot.merged_seq],
  )
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, snapshot.state)
  for (const row of updates) Y.applyUpdate(ydoc, row.payload)
  return { ydoc, seq: updates.at(-1)?.seq ?? snapshot.merged_seq }
}

async function lockSnapshot(tx: Tx, pageId: string): Promise<string | null> {
  const row = await tx.queryMaybe<{ merged_seq: string }>(
    `SELECT merged_seq FROM doc_snapshot WHERE page_id = $1 FOR UPDATE`,
    [pageId],
  )
  return row?.merged_seq ?? null
}

/** 행의 본문으로 seq 1 을 만든다. 누가 먼저 만들었으면 아무것도 하지 않는다(머리말). */
async function bootstrap(tx: Tx, ctx: SessionContext, pageId: string): Promise<void> {
  const initial = createBodyYDoc(await readLiveBody(tx, ctx, pageId))
  const bytes = Buffer.from(Y.encodeStateAsUpdate(initial))
  const claimed = await tx.queryMaybe<{ page_id: string }>(
    `INSERT INTO doc_snapshot (page_id, state, state_vector, merged_seq, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (page_id) DO NOTHING
     RETURNING page_id`,
    [pageId, bytes, Buffer.from(Y.encodeStateVector(initial))],
  )
  initial.destroy()
  if (claimed === null) return
  await tx.query(
    `INSERT INTO doc_update (page_id, seq, payload, actor_id, origin, created_at)
     VALUES ($1, 1, $2, NULL, 'import', now())`,
    [pageId, bytes],
  )
}

async function bootstrapThenRead(tx: Tx, ctx: SessionContext, pageId: string): Promise<DocState> {
  await bootstrap(tx, ctx, pageId)
  const state = await readState(tx, pageId)
  if (state === null) throw new Error(`옮긴 직후의 본문을 읽지 못했다: ${pageId}`)
  return state
}

async function writeSnapshot(tx: Tx, pageId: string, ydoc: Y.Doc, seq: string): Promise<void> {
  await tx.query(
    `UPDATE doc_snapshot
        SET state = $2, state_vector = $3, merged_seq = $4, updated_at = now()
      WHERE page_id = $1`,
    [pageId, Buffer.from(Y.encodeStateAsUpdate(ydoc)), Buffer.from(Y.encodeStateVector(ydoc)), seq],
  )
}
