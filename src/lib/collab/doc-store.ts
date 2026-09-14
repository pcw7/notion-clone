/**
 * 본문 편집 로그 저장소 — `doc_update` · `doc_snapshot` (F-05-01 · F-05-02 · CRDT 2조각)
 *
 * 정본: 00-canonical-data-model.md §3.7 — 불변식 S1(로그에 삭제 op 가 없다) · S2(seq 는 재동기 축)
 *       판결 C-11 · C-12 · V-5(쓰기 경로 ① 은 `doc_update` 1행 append)
 *       마이그레이션 0007_doc_sync.sql
 *
 * **아직 어떤 경로도 부르지 않는다.** 정본을 행에서 Y.Doc 으로 넘기는 것은 4조각이다(HANDOFF §2).
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
 * append 는 그 페이지의 스냅샷 행을 `FOR UPDATE` 로 잡고 마지막 seq + 1 을 쓴다. 한 페이지의 append 가
 * 한 줄로 서므로 PK 충돌 재시도가 없고 seq 에 빈틈이 없다 — 빈틈이 없어야 "합치지 않은 update 수 =
 * 최신 seq − merged_seq" 가 성립하고, 재동기(S2)에서 빈틈은 곧 유실이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쌓기 전에 적용해 본다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - 깨진 바이트는 거부한다. 앞선 update 가 없는 update(적용하면 Yjs 가 pending 으로 들고 있는다)도
 *     거부한다 — 쌓으면 빠진 조각이 오기 전까지 본문에 보이지 않는 내용이 로그에 산다
 *   - 아무것도 바꾸지 않는 update(이미 받은 것의 재전송)는 쌓지 않는다
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
 * 곳이 이 줄 선 append 하나라서 수선끼리 겹쳐 블록이 복제되지 않는다 — 참여자마다 고치면 복제된다.
 *
 *   - 수선은 보낸 쪽이 갖지 않은 변경이므로 돌려준다(`repair`). 협업 서버는 받은 update 와 함께 퍼뜨린다
 *   - 따로 seq 를 주지 않았다 — 수선은 이 update 를 지금 본문에 적용한 결과의 일부이고, 정본 origin 6값에
 *     "시스템 수선"이 없다. 그래서 수선의 actor · origin 은 그 update 를 보낸 쪽의 것이다
 *   - 바뀐 것이 없는 append(재전송)는 고치지 않는다 — 고칠 것은 바뀐 append 가 이미 고쳤다
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
import { withTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { MAX_BODY_BYTES } from '../sync/outbox.ts'
import { repairBodyYDoc } from './repair.ts'
import { createBodyYDoc } from './ydoc.ts'

/** 정본 `doc_update.origin` 의 CHECK 값. */
export const DOC_ORIGINS = ['editor', 'api', 'automation', 'restore', 'import', 'external_sync'] as const
export type DocOrigin = (typeof DOC_ORIGINS)[number]

/** update 한 개의 상한. 본문 한도(F-12-16 · `MAX_BODY_BYTES`)와 같은 자릿수로 둔다. */
export const MAX_DOC_UPDATE_BYTES = MAX_BODY_BYTES

/** 합치지 않은 update 가 이만큼 쌓이면 append 가 스냅샷을 새로 쓴다. */
export const COMPACT_EVERY = 100

export type DocState = {
  readonly ydoc: Y.Doc
  /** 이 상태에 반영된 마지막 seq. 옮긴 페이지는 로그가 비어 있을 수 없으므로 `'1'` 이상이다. */
  readonly seq: string
}

export type LoadDocResult =
  | { readonly ok: true; readonly value: DocState }
  /** 없거나 볼 수 없거나 휴지통에 있는 페이지 — 구분하지 않는다(HANDOFF §3.3-31). */
  | { readonly ok: false; readonly reason: 'not_found' }

export type AppendFailure =
  | 'not_found'
  /** 볼 수는 있지만 고칠 수 없다(`edit_content` 없음). */
  | 'forbidden'
  | 'too_large'
  /** Yjs update 로 읽히지 않는다. */
  | 'invalid_update'
  /** 앞선 update 가 없어 전부 적용되지 않는다. 보낸 쪽이 state vector 로 다시 맞춰야 한다. */
  | 'missing_dependencies'

export type AppendDocResult =
  | {
      readonly ok: true
      /** 쌓았으면 새 seq, 바뀐 것이 없어 쌓지 않았으면 지금의 마지막 seq. */
      readonly seq: string
      readonly appended: boolean
      /**
       * 합친 본문의 구조 위반을 고친 update — 같은 seq 에 함께 쌓였다. 보낸 쪽은 이것을 갖고 있지 않으므로
       * 적용하고 다른 참여자에게 퍼뜨린다. 고칠 것이 없었으면 null.
       */
      readonly repair: Uint8Array | null
    }
  | { readonly ok: false; readonly reason: AppendFailure }

export type AppendOptions = {
  readonly origin: DocOrigin
  /** 압축 기준. 없으면 `COMPACT_EVERY`. */
  readonly compactEvery?: number
}

// ── 읽기 ──────────────────────────────────────────────────────────────

export async function loadDocState(ctx: SessionContext, pageId: string): Promise<LoadDocResult> {
  return withTransaction(async (tx) => {
    if ((await accessOf(tx, ctx, pageId)) === 'none') return { ok: false, reason: 'not_found' } as const
    const state = (await readState(tx, pageId)) ?? (await bootstrapThenRead(tx, ctx, pageId))
    return { ok: true, value: state } as const
  })
}

// ── 쓰기 ──────────────────────────────────────────────────────────────

export async function appendDocUpdate(
  ctx: SessionContext,
  pageId: string,
  update: Uint8Array,
  options: AppendOptions,
): Promise<AppendDocResult> {
  if (update.byteLength > MAX_DOC_UPDATE_BYTES) return { ok: false, reason: 'too_large' }

  return withTransaction(async (tx) => {
    const access = await accessOf(tx, ctx, pageId)
    if (access === 'none') return { ok: false, reason: 'not_found' } as const
    if (access !== 'edit') return { ok: false, reason: 'forbidden' } as const

    // 줄 세우기 — 이 페이지의 append · 압축이 여기서 한 줄로 선다. 처음이면 옮긴 뒤에 잡는다.
    let mergedSeq = await lockSnapshot(tx, pageId)
    if (mergedSeq === null) {
      await bootstrap(tx, ctx, pageId)
      mergedSeq = await lockSnapshot(tx, pageId)
    }
    if (mergedSeq === null) throw new Error(`옮긴 직후의 스냅샷이 없다: ${pageId}`)

    // 잠근 뒤에 읽는다 — 잠그기 전에 커밋된 append 까지 전부 보인다.
    const state = await readState(tx, pageId)
    if (state === null) throw new Error(`잠근 스냅샷을 읽지 못했다: ${pageId}`)

    const changes: Uint8Array[] = []
    const collect = (change: Uint8Array): void => void changes.push(change)
    state.ydoc.on('update', collect)
    try {
      Y.applyUpdate(state.ydoc, update)
    } catch {
      return { ok: false, reason: 'invalid_update' } as const
    } finally {
      state.ydoc.off('update', collect)
    }

    if (state.ydoc.store.pendingStructs !== null || state.ydoc.store.pendingDs !== null) {
      return { ok: false, reason: 'missing_dependencies' } as const
    }
    if (changes.length === 0) return { ok: true, seq: state.seq, appended: false, repair: null } as const

    // 합친 결과가 구조를 어기면 같은 줄 안에서 고친다 — 수선을 쓰는 곳은 여기 하나다(머리말 · `repair.ts`).
    const repaired = repairBodyYDoc(state.ydoc, pageId)
    const repair = repaired.kind === 'repaired' ? repaired.update : null
    if (repair !== null) changes.push(repair)

    const seq = String(BigInt(state.seq) + BigInt(1))
    await tx.query(
      `INSERT INTO doc_update (page_id, seq, payload, actor_id, origin, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [pageId, seq, Buffer.from(changes.length === 1 ? changes[0] : Y.mergeUpdates(changes)), ctx.userId, options.origin],
    )

    const compactEvery = options.compactEvery ?? COMPACT_EVERY
    if (BigInt(seq) - BigInt(mergedSeq) >= BigInt(compactEvery)) {
      // 지금 들고 있는 Y.Doc 이 곧 seq 까지의 상태다 — 다시 읽을 필요가 없다.
      await writeSnapshot(tx, pageId, state.ydoc, seq)
    }
    return { ok: true, seq, appended: true, repair } as const
  })
}

// ── 내부 ──────────────────────────────────────────────────────────────

type Access = 'none' | 'view' | 'edit'

/** 살아 있는 페이지에 대한 이 세션의 권한. 볼 수 없으면 없는 것과 같다. */
async function accessOf(tx: Tx, ctx: SessionContext, pageId: string): Promise<Access> {
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
