/**
 * 표의 변경 기록 — 커서 · 기록 읽기 · 구독이 붙기 전의 틈 · 지우기 (X-5 1단계 서버 · DB 실시간 동기화 RT-1조각 · F-05-16 · F-05-06)
 *
 * 정본: 00-canonical-data-model.md §3.7 `data_source_change` · [보강] X-5 의 단계 — 1단계(RT-1) · 마이그레이션 0153
 *
 * 0063 의 트리거가 쓰기마다 표(data source)의 기록에 한 줄을 쌓는다(무엇이 · 어느 행 · 어느 뷰 · 쓴 트랜잭션의 xid). 여기는 그것을 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 커서는 seq 가 아니라 xid 지평이다(정확성의 근거 전부)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `seq`(identity)는 넣은 차례이지 커밋 차례가 아니다. A 가 seq 10 을 받고 열린 채 B 가 11 을 받아 커밋하면, "11 까지 읽었다"는 커서는
 * 나중에 커밋되는 10 을 영영 건너뛴다. xid 가 앞선 트랜잭션이 뒤의 seq 를 받기도 한다(C 가 xid 99 로 먼저 시작해 다른 것을 쓰고, A 가
 * xid 100 으로 seq 10, C 가 seq 11 로 커밋) — "xid 가 지평 아래인 것만 · 커서는 돌려준 것의 가장 큰 seq" 로 해도 11 을 주고 10 을 잃는다.
 *
 * 그래서 커서 자체를 **xid 지평**으로 둔다. 읽는 문장의 스냅샷에서 `pg_snapshot_xmin`(아직 도는 가장 오래된 xid) = H 이면
 *   · xid < H 인 트랜잭션은 모두 끝났다 — 커밋했으면 이 스냅샷에 보인다
 *   · 앞으로 생길 기록의 xid 는 H 이상이다(도는 것은 H 이상 · 새것은 그보다 크다)
 * 따라서 `after <= xid < H` 를 돌려주고 다음 커서를 H 로 하면, 두 번의 읽기 사이에 빠지는 기록도 두 번 오는 기록도 없다. H 는 시간에 따라
 * 줄지 않는다. 대가: 오래 열린 쓰기 트랜잭션이 하나 있으면 지평이 거기 묶인다 — 그 뒤에 커밋된 기록은 `behind` 로 알리고 곧 다시 묻게 한다.
 *
 * **커서의 뜻** — "이 커서를 받은 뒤에 시작한 읽기는 커서 아래의 모든 변경을 본다". 그래서 처음부터 다시 읽은 화면은 다시 읽기 **전에**
 * 받은 커서(`ready` · `changed` · reset 의 것)부터 이어 물으면 된다. 그 사이의 것은 두 번 올 수 있다(행은 post-image 라 두 번 받아도 같다).
 */

import { query } from '../db/pool.ts'
import { MAX_QUERY_LIMIT } from './limits.ts'

/** 기록을 남기는 시간 — 보관 정리가 이보다 오래된 줄을 지운다. 커서가 그보다 오래면 reset(F-05-06 *"보존기간 초과 시 snapshot"*). */
export const CHANGE_LOG_WINDOW_MS = 24 * 60 * 60_000

/**
 * 델타 한 번에 주는 행의 상한 — 넘으면 reset(다시 읽기가 싸다 · F-05-06 *"델타가 수천 op → snapshot"*). 행 질의 한 번의 상한과 같다
 * (`onlyRowIds` 로 한 번에 묻는다).
 */
export const DELTA_ROW_CAP = MAX_QUERY_LIMIT

/** 델타 한 번에 훑는 기록 줄의 상한 — 같은 행을 여러 번 고쳐도 줄은 늘어난다. 넘으면 reset(읽기의 일이 커서에 비례하지 않게). */
export const DELTA_SCAN_CAP = 2_000

/** 한 판에 지우는 기록의 수 — 꽉 차면 보관 정리가 곧 다시 돈다. */
export const CHANGE_LOG_GC_BATCH = 5_000

const XID8_MAX = BigInt('0xffffffffffffffff')
const CURSOR_RE = /^c1\.(\d{1,20})$/

/** 커서 — 판(`c1`)과 xid 지평(10진). 받는 쪽은 열어 보지 않는다. */
export function encodeChangeCursor(horizon: bigint): string {
  return `c1.${horizon.toString()}`
}

/** 커서를 푼다 — 모양이 틀리면(옛 화면 · 손으로 고친 주소 · 다른 판) null. 그때 부르는 쪽은 처음부터(reset). */
export function decodeChangeCursor(raw: unknown): bigint | null {
  if (typeof raw !== 'string') return null
  const m = CURSOR_RE.exec(raw)
  if (m === null) return null
  const value = BigInt(m[1]!)
  return value > XID8_MAX ? null : value
}

export type ChangeKind = 'row_upsert' | 'row_delete' | 'position' | 'reminder' | 'schema' | 'view' | 'layout'

/** 행을 가리키는 종류 — 델타의 `rows` 로 간다(지금 상태로 다시 읽는다). */
export const ROW_KINDS: ReadonlySet<ChangeKind> = new Set(['row_upsert', 'row_delete', 'position', 'reminder'])

export type ChangeEntry = { readonly kind: ChangeKind; readonly rowId: string | null; readonly viewId: string | null }

/** 한 문장(한 스냅샷)으로 읽은 기록의 창. */
export type ChangeWindow = {
  /** 이 스냅샷의 지평 — 다음 커서. */
  readonly horizon: bigint
  /** 보관 정리가 이 표에서 지운 가장 큰 xid — 없으면 null. */
  readonly floor: bigint | null
  /** `after <= xid < horizon` 의 기록 — `DELTA_SCAN_CAP + 1` 줄까지만(넘쳤는지 알 만큼). 차례는 없다. */
  readonly entries: readonly ChangeEntry[]
  /** 지평 이상의 기록이 이미 커밋돼 있다 — 더 오래된 트랜잭션이 끝나지 않아 아직 줄 수 없다. */
  readonly behind: boolean
}

export type ResetReason = 'no_cursor' | 'invalid' | 'expired' | 'too_many'
export type DeltaDecision = { readonly reset: false } | { readonly reset: true; readonly reason: ResetReason }

/**
 * 델타를 줄 수 있는가 — 아니면 "처음부터 다시 읽어라"(reset).
 *
 *   no_cursor  커서가 없다(처음 · 모양이 틀렸다)
 *   invalid    커서가 지평보다 앞선다 — 이 DB 가 준 것이 아니다(볼륨을 다시 만들었다 등). 그 뒤의 기록을 믿을 수 없다
 *   expired    커서가 지운 기록의 xid 이하 — 지운 것을 넘겨야 한다(24시간 창 밖)
 *   too_many   기록 줄 · 바뀐 행이 상한을 넘었다
 */
export function decideDelta(
  after: bigint | null,
  window: { readonly horizon: bigint; readonly floor: bigint | null; readonly entryCount: number; readonly rowCount: number },
  caps: { readonly rows: number; readonly scan: number } = { rows: DELTA_ROW_CAP, scan: DELTA_SCAN_CAP },
): DeltaDecision {
  if (after === null) return { reset: true, reason: 'no_cursor' }
  if (after > window.horizon) return { reset: true, reason: 'invalid' }
  if (window.floor !== null && after <= window.floor) return { reset: true, reason: 'expired' }
  if (window.entryCount > caps.scan || window.rowCount > caps.rows) return { reset: true, reason: 'too_many' }
  return { reset: false }
}

/** 행을 가리키는 기록의 행 id — 처음 나온 차례로 · 겹치지 않게. */
export function changedRowIds(entries: readonly ChangeEntry[]): string[] {
  const seen = new Set<string>()
  for (const e of entries) if (ROW_KINDS.has(e.kind) && e.rowId !== null) seen.add(e.rowId)
  return [...seen]
}

/** 지금의 지평 — 아무 기록도 읽지 않는다(표 없이). */
export async function currentChangeHorizon(): Promise<bigint> {
  const rows = await query<{ horizon: string }>(`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS horizon`)
  return BigInt(rows[0]!.horizon)
}

/** 지금의 커서 — 서버 화면이 **읽기 전에** 받아 화면에 준다(구독할 때 들고 온다 · `changedSinceCursor`). */
export async function currentChangeCursor(): Promise<string> {
  return encodeChangeCursor(await currentChangeHorizon())
}

/** 최근의 커서를 나눠 쓴다 — 여러 구독이 한꺼번에 `changed` 를 보낼 때 질의가 구독 수만큼 돌지 않게. 오래된 커서도 안전하다(머리말). */
const RECENT_MS = 250
let recent: { readonly at: number; readonly value: Promise<string> } | null = null
export function recentChangeCursor(now: number = Date.now()): Promise<string> {
  if (recent !== null && now - recent.at < RECENT_MS) return recent.value
  const value = currentChangeCursor()
  const entry = { at: now, value }
  recent = entry
  // 실패한 것은 나눠 쓰지 않는다
  value.catch(() => {
    if (recent === entry) recent = null
  })
  return value
}

/**
 * 한 표의 기록을 커서부터 지평 앞까지 — 한 문장이라 지평 · 지운 자리 · 기록이 같은 스냅샷이다. `after` 는 지평 이하라고 가정하지 않는다
 * (부르는 쪽이 `decideDelta` 로 본다).
 */
export async function readChangeWindow(dataSourceId: string, after: bigint, scanCap: number = DELTA_SCAN_CAP): Promise<ChangeWindow> {
  const rows = await query<{ horizon: string; floor: string | null; behind: boolean; entries: { kind: ChangeKind; row_id: string | null; view_id: string | null }[] }>(
    `WITH h AS (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS horizon)
     SELECT h.horizon::text AS horizon,
            (SELECT f.purged_through::text FROM data_source_change_floor f WHERE f.data_source_id = $1) AS floor,
            EXISTS (SELECT 1 FROM data_source_change c WHERE c.data_source_id = $1 AND c.xid >= h.horizon) AS behind,
            COALESCE((SELECT json_agg(json_build_object('kind', e.kind, 'row_id', e.row_id, 'view_id', e.view_id))
                        FROM (SELECT c.kind, c.row_id, c.view_id FROM data_source_change c
                               WHERE c.data_source_id = $1 AND c.xid >= $2::xid8 AND c.xid < h.horizon
                               LIMIT $3) e), '[]'::json) AS entries
       FROM h`,
    [dataSourceId, after.toString(), scanCap + 1],
  )
  const row = rows[0]!
  return {
    horizon: BigInt(row.horizon),
    floor: row.floor === null ? null : BigInt(row.floor),
    behind: row.behind,
    entries: row.entries.map((e) => ({ kind: e.kind, rowId: e.row_id, viewId: e.view_id })),
  }
}

/**
 * 구독이 붙기 전의 틈(#250) — 서버 화면이 읽기 전에 받은 커서 뒤로 이 표에 **커밋된** 기록이 있는가. 구독을 붙인 **뒤에** 부른다(그 뒤에
 * 커밋되는 것은 구독이 신호로 받는다). 모르면(커서가 지평보다 앞선다 · 지운 기록 아래다) 참 — 거짓 양성(이미 읽은 것을 한 번 더)은 허용한다.
 * 같은 DB 의 xid 하나로 판정하므로 서버 프로세스가 여럿이어도 · 다시 떠도 같은 답이다(옛 판정 `rowsChangedSince` 는 프로세스의 시계와
 * 기억에 기댔다).
 */
export async function changedSinceCursor(dataSourceId: string, after: bigint): Promise<boolean> {
  const rows = await query<{ horizon: string; floor: string | null; changed: boolean }>(
    `SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS horizon,
            (SELECT f.purged_through::text FROM data_source_change_floor f WHERE f.data_source_id = $1) AS floor,
            EXISTS (SELECT 1 FROM data_source_change c WHERE c.data_source_id = $1 AND c.xid >= $2::xid8) AS changed`,
    [dataSourceId, after.toString()],
  )
  const row = rows[0]!
  if (after > BigInt(row.horizon)) return true
  if (row.floor !== null && after <= BigInt(row.floor)) return true
  return row.changed
}

/**
 * 보관 정리 — `CHANGE_LOG_WINDOW_MS` 가 지난 기록을 지우고 표마다 지운 가장 큰 xid 를 남긴다(한 문장 — 지운 것과 그 자리가 함께 커밋된다).
 *
 * 경계는 "`at` 이 창 안인 가장 작은 seq" 다 — 그보다 앞의 seq 만 지운다. 그래서 창 안의 줄은 지우지 않는다(오래 연 트랜잭션이 뒤늦게 넣은
 * 옛 시각의 줄은 경계가 지나간 뒤 다음 판에). PK 의 차례로 앞에서부터 훑으므로 일은 지우는 줄의 수에 비례한다.
 *
 * @param options.dataSources 이 표들만 — 검사가 다른 검사의 기록을 지우지 않게(워커는 주지 않는다)
 */
export async function collectChangeLog(
  now: Date,
  options: { readonly batch?: number; readonly dataSources?: readonly string[] | null } = {},
): Promise<number> {
  const batch = options.batch ?? CHANGE_LOG_GC_BATCH
  const scope = options.dataSources ?? null
  const gone = await query<{ n: number }>(
    `WITH boundary AS (
       SELECT COALESCE((SELECT c.seq FROM data_source_change c
                         WHERE c.at >= $1 AND ($3::uuid[] IS NULL OR c.data_source_id = ANY($3::uuid[]))
                         ORDER BY c.seq LIMIT 1), 9223372036854775807) AS seq
     ), old AS (
       SELECT c.seq FROM data_source_change c, boundary b
        WHERE c.seq < b.seq AND ($3::uuid[] IS NULL OR c.data_source_id = ANY($3::uuid[]))
        ORDER BY c.seq LIMIT $2
     ), gone AS (
       DELETE FROM data_source_change c USING old WHERE c.seq = old.seq
       RETURNING c.data_source_id, c.xid
     ), floors AS (
       INSERT INTO data_source_change_floor AS f (data_source_id, purged_through)
       SELECT data_source_id, max(xid) FROM gone GROUP BY data_source_id
       ON CONFLICT (data_source_id) DO UPDATE
         SET purged_through = GREATEST(f.purged_through, EXCLUDED.purged_through), updated_at = now()
     )
     SELECT count(*)::int AS n FROM gone`,
    [new Date(now.getTime() - CHANGE_LOG_WINDOW_MS), batch, scope],
  )
  // 없어진 표의 자리 — 남은 기록도 없으면 지운다(그 표의 델타는 더 묻지 못한다 · 404). 범위를 준 검사는 건드리지 않는다
  if (scope === null) {
    await query(
      `DELETE FROM data_source_change_floor f WHERE f.data_source_id IN (
         SELECT f2.data_source_id FROM data_source_change_floor f2
          WHERE NOT EXISTS (SELECT 1 FROM data_source d WHERE d.id = f2.data_source_id)
            AND NOT EXISTS (SELECT 1 FROM data_source_change c WHERE c.data_source_id = f2.data_source_id)
          LIMIT $1)`,
      [batch],
    )
  }
  return gone[0]?.n ?? 0
}
