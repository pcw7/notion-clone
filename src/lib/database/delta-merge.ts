/**
 * 바뀐 행만 화면의 목록에 합친다 — DB 실시간 동기화 RT-2조각 (F-05-16 · F-05-06 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md 판결 X-5 [보강] "X-5 의 단계" — 1단계 ⑨(화면의 합치기 · RT-2)
 *       05-collaboration-sync.md F-05-16 *"전체 재조회 금지 → 행 단위 델타 · 변경 행이 필터를 벗어나면 목록에서 제거"*
 *
 * 델타(`…/changes/delta` · `row-delta.ts`)는 바뀐 행마다 지금 값 · 뷰에 서는가(`inView`) · 그 뷰의 차례에서 바로 앞 · 바로 뒤 행
 * (`place.before` · `place.after`) · 화면이 아직 읽지 않은 범위인가(`place.beyond`)를 준다. 여기는 그것을 화면의 평평한 목록에 맞춘다 —
 * 정렬을 다시 평가하지 않는다(평가기 두 벌 — 정본 X-5 [보강] ①). **확신이 없으면 합치지 않는다**: 부르는 쪽이 처음부터 다시 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자리 — 이웃이 화면에서도 이웃이어야 끼운다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 바뀐 행을 먼저 모두 뺀다(남는 것 = 안 바뀐 행). 뷰에 서는 바뀐 행은 `before` · `after` 로 이어 **사슬**을 만든다(바뀐 행끼리 붙어 있으면
 * 한 사슬). 사슬의 앞(P = 머리의 `before`)과 뒤(S = 꼬리의 `after`)가 남은 목록에서도 바로 이웃이면 그 사이에 끼운다. 아니면 화면의
 * 목록이 서버의 지금과 어긋났다(델타의 창 뒤에 커밋된 다른 변경이 이미 순서를 바꿨다 등) — 끼우면 엉뚱한 자리에 남으므로 다시 읽는다.
 * 그 행들의 변경은 다음 델타에 온다(커서의 뜻 — 정본 ④).
 *
 *   P 가 null        사슬이 맨 앞이다 — S 는 남은 목록의 첫 행이어야 한다
 *   S 가 null        사슬이 맨 끝이다 — P 뒤에 남은 행이 없어야 한다
 *   S 가 목록에 없다  "더 보기"가 남았고(`hasMore`) P 가 남은 목록의 끝이면 S 는 아직 읽지 않은 범위다 — 끼운다. 아니면 어긋남
 *
 * 화면이 목록의 앞부분만 들고 있으면(`hasMore`) 서버가 화면의 "더 보기" 커서로 `beyond` 를 판정한다 — 그 행은 아직 읽지 않은 범위라 빼고
 * (더 보기가 가져온다) 끼우지 않는다. 같은 keyset 술어라 더 보기와 어긋나지 않는다(두 번 서거나 빠지지 않는다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 다시 읽기와 같은 규칙 — 내가 고친 행 · 늦게 온 옛 값
 * ──────────────────────────────────────────────────────────────────────
 *
 * 내가 고친 행(`touched`)이 뷰 밖이 되면(`inView` 거짓 · 휴지통) 옛 자리에 남기고 "조건 밖"을 단다(`live-rows.ts` 의 `mergeReloaded` 와
 * 같다 — 04 F-04-24). 남이 고친 행은 뺀다. 화면의 행이 더 새 버전이면 그 값을 지킨다(#468 — 같은 버전이면 델타의 것). 내가 고친 행이
 * 아직 읽지 않은 범위로 옮겨 가면 다시 읽기에 맡긴다(그 규칙이 이미 있다).
 */

import type { Calculations } from './calculate.ts'
import type { RowJson } from './http.ts'
import { MAX_QUERY_PAGINATION } from './limits.ts'

export type DeltaPlace = { readonly before: string | null; readonly after: string | null; readonly beyond: boolean }

export type DeltaRowJson =
  | (RowJson & { readonly kind: 'row_upsert'; readonly inView: boolean; readonly place?: DeltaPlace })
  | { readonly id: string; readonly kind: 'row_delete'; readonly inView: false }

/** 델타 응답(`…/changes/delta` — `row-delta.ts` 의 `RowDelta`)의 화면 쪽 모양. */
export type DeltaJson = {
  readonly cursor: string
  readonly reset: boolean
  readonly behind: boolean
  readonly schemaChanged: boolean
  readonly viewChanged: boolean
  readonly orderChanged: boolean
  /** 내 개인 필터 · 정렬이 커서 뒤로 바뀌었다(RT-3 — 옛 서버는 싣지 않는다 · 없으면 거짓). */
  readonly personalChanged?: boolean
  readonly placed?: boolean
  readonly rows: readonly DeltaRowJson[]
  readonly calculations?: Calculations
}

const isPlace = (v: unknown): v is DeltaPlace => {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  const idOrNull = (x: unknown) => x === null || typeof x === 'string'
  return idOrNull(p.before) && idOrNull(p.after) && typeof p.beyond === 'boolean'
}

/**
 * 응답 → 델타. 모양이 틀리면 null — 커서가 없다 · 모르는 종류의 행 · 깃발이 불리언이 아니다. 부르는 쪽은 다시 읽는다(모르는 것을 반쯤
 * 합치지 않는다).
 */
export function parseDelta(body: Record<string, unknown>): DeltaJson | null {
  if (typeof body.cursor !== 'string' || body.cursor === '') return null
  for (const flag of ['reset', 'behind', 'schemaChanged', 'viewChanged', 'orderChanged'] as const) {
    if (typeof body[flag] !== 'boolean') return null
  }
  if (body.placed !== undefined && typeof body.placed !== 'boolean') return null
  if (body.personalChanged !== undefined && typeof body.personalChanged !== 'boolean') return null
  if (!Array.isArray(body.rows)) return null
  const rows: DeltaRowJson[] = []
  for (const raw of body.rows as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null
    const row = raw as Record<string, unknown>
    if (typeof row.id !== 'string') return null
    if (row.kind === 'row_delete') {
      rows.push({ id: row.id, kind: 'row_delete', inView: false })
      continue
    }
    if (row.kind !== 'row_upsert' || typeof row.inView !== 'boolean' || typeof row.version !== 'string') return null
    if (row.place !== undefined && !isPlace(row.place)) return null
    rows.push(row as unknown as DeltaRowJson)
  }
  return {
    cursor: body.cursor,
    reset: body.reset as boolean,
    behind: body.behind as boolean,
    schemaChanged: body.schemaChanged as boolean,
    viewChanged: body.viewChanged as boolean,
    orderChanged: body.orderChanged as boolean,
    personalChanged: body.personalChanged === true,
    ...(body.placed === undefined ? {} : { placed: body.placed as boolean }),
    rows,
    ...(typeof body.calculations === 'object' && body.calculations !== null ? { calculations: body.calculations as Calculations } : {}),
  }
}

export type FullReason = 'reset' | 'schema' | 'view' | 'personal' | 'unplaced'

/**
 * 델타로 합칠 수 없는 까닭 — 없으면 null. 처음부터 다시 읽는다:
 *   reset    서버가 델타를 줄 수 없다(커서 없음 · 24시간 창 밖 · 바뀐 행이 상한 초과)
 *   schema   속성 · 옵션이 바뀌었다 — 컬럼을 다시 세워야 한다
 *   view     이 뷰(필터 · 정렬 · 컬럼)가 바뀌었다 — 목록의 차례 자체가 바뀐다
 *   personal 내 개인 필터 · 정렬이 바뀌었다(RT-3 — 다른 탭 · 기기) — 차례가 바뀌고 도구줄(내 필터 칩)도 새로 그린다
 *   unplaced 뷰에 서는 행의 자리가 없다(하위 항목 트리 · 카드의 부모만 · 더 보기 커서가 정렬에 맞지 않는다)
 * 손으로 둔 순서(`orderChanged`)는 까닭이 아니다 — 옮긴 행이 `rows` 에 자리와 함께 온다.
 */
export function deltaFallback(delta: DeltaJson): FullReason | null {
  if (delta.personalChanged === true) return 'personal'
  if (delta.reset) return 'reset'
  if (delta.schemaChanged) return 'schema'
  if (delta.viewChanged) return 'view'
  const needsPlace = delta.rows.some((r) => r.kind === 'row_upsert' && r.inView)
  if (needsPlace && (delta.placed !== true || delta.rows.some((r) => r.kind === 'row_upsert' && r.inView && r.place === undefined))) return 'unplaced'
  return null
}

export type MergeFailure = 'stale' | 'beyond_touched' | 'cap'

export type MergedDelta =
  | {
      readonly ok: true
      readonly rows: RowJson[]
      readonly outside: Set<string>
      /** 화면에서 무엇이든 바뀌었는가(행 · 자리 · 조건 밖 표시). */
      readonly changed: boolean
    }
  | { readonly ok: false; readonly reason: MergeFailure }

/** `a` 가 `b` 보다 새 버전인가 — 버전은 정수 문자열(bigint)이다. 읽을 수 없으면 새롭다고 하지 않는다(델타의 것을 쓴다). */
function newerVersion(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b)
  } catch {
    return false
  }
}

/** 델타의 행에서 화면의 행으로 — 종류 · 자리 표시를 뗀다. */
function rowOf(delta: DeltaRowJson & { kind: 'row_upsert' }): RowJson {
  const row: Record<string, unknown> = { ...delta }
  delete row.kind
  delete row.inView
  delete row.place
  return row as unknown as RowJson
}

/** 화면의 행과 델타의 행 중 지킬 것 — 화면의 것이 더 새 버전이면 그것(#468). */
function keepNewer(current: RowJson | undefined, incoming: DeltaRowJson & { kind: 'row_upsert' }): RowJson {
  return current !== undefined && newerVersion(current.version, incoming.version) ? current : rowOf(incoming)
}

/**
 * 델타를 평평한 목록에 합친다(머리말). 하위 항목 트리(깊이가 있는 목록)에는 쓰지 않는다 — 부르는 쪽이 다시 읽는다.
 *
 * @param input.previous 지금 화면의 목록(조건 밖으로 남긴 행 포함)
 * @param input.outside  조건 밖으로 남긴 행
 * @param input.touched  이 화면에서 고친 행
 * @param input.rows     델타의 행 — 뷰에 서는 것은 `place` 가 있어야 한다(`deltaFallback` 이 먼저 본다)
 * @param input.hasMore  화면이 목록의 앞부분만 들고 있다("더 보기"가 남았다)
 * @param input.cap      목록의 상한(F-03-17 — 넘으면 다시 읽기가 상한까지 읽는다)
 */
export function mergeDelta(input: {
  readonly previous: readonly RowJson[]
  readonly outside: ReadonlySet<string>
  readonly touched: ReadonlySet<string>
  readonly rows: readonly DeltaRowJson[]
  readonly hasMore: boolean
  readonly cap?: number
}): MergedDelta {
  const cap = input.cap ?? MAX_QUERY_PAGINATION
  const shown = new Map(input.previous.map((row) => [row.id, row]))
  const byId = new Map(input.rows.map((row) => [row.id, row]))
  const outside = new Set(input.outside)
  let changed = false

  // ① 바뀐 행을 뺀다 — 뷰 밖이 된 내 행은 옛 자리에 남기고 "조건 밖"
  const kept: RowJson[] = []
  for (const row of input.previous) {
    const delta = byId.get(row.id)
    if (delta === undefined) {
      kept.push(row)
      continue
    }
    changed = true
    if (delta.inView) continue // ② 에서 제자리에 선다(또는 아직 읽지 않은 범위로 빠진다)
    if (input.touched.has(row.id)) {
      kept.push(delta.kind === 'row_upsert' ? keepNewer(row, delta) : row)
      outside.add(row.id)
    } else outside.delete(row.id)
  }

  // ② 뷰에 서는 바뀐 행 — 아직 읽지 않은 범위는 빼고, 나머지는 자리에
  const placed = new Map<string, { readonly row: RowJson; readonly place: DeltaPlace }>()
  for (const delta of input.rows) {
    if (delta.kind !== 'row_upsert' || !delta.inView) continue
    const place = delta.place
    if (place === undefined) return { ok: false, reason: 'stale' }
    outside.delete(delta.id)
    if (place.beyond) {
      // 내가 고친 행이 더 보기 너머로 — 다시 읽기의 규칙(남긴다)에 맡긴다
      if (input.touched.has(delta.id) && shown.has(delta.id)) return { ok: false, reason: 'beyond_touched' }
      continue
    }
    placed.set(delta.id, { row: keepNewer(shown.get(delta.id), delta), place })
    changed = true
  }

  // ③ 사슬 — 바뀐 행끼리 이웃이면 한 줄로
  const chains: string[][] = []
  const chained = new Set<string>()
  for (const [id, { place }] of placed) {
    if (place.before !== null && placed.has(place.before)) continue // 머리가 아니다
    const chain = [id]
    chained.add(id)
    let at = place
    while (at.after !== null && placed.has(at.after)) {
      const next = at.after
      // 순환 · 서로 맞지 않는 이웃 — 한 스냅샷이면 생기지 않는다
      if (chained.has(next) || placed.get(next)!.place.before !== chain[chain.length - 1]) return { ok: false, reason: 'stale' }
      chain.push(next)
      chained.add(next)
      at = placed.get(next)!.place
    }
    chains.push(chain)
  }
  if (chained.size !== placed.size) return { ok: false, reason: 'stale' }

  // ④ 사슬의 앞뒤가 남은 목록에서도 이웃인가 — 조건 밖으로 남긴 행은 서버의 차례에 없으니 건너뛴다
  const viewRows = kept.filter((row) => !outside.has(row.id))
  const indexInView = new Map(viewRows.map((row, i) => [row.id, i]))
  const keptIds = new Set(kept.map((row) => row.id))
  const after = new Map<string | null, string[]>()
  for (const chain of chains) {
    const p = placed.get(chain[0]!)!.place.before
    const s = placed.get(chain[chain.length - 1]!)!.place.after
    const at = p === null ? -1 : indexInView.get(p)
    if (at === undefined) return { ok: false, reason: 'stale' }
    const next = viewRows[at + 1]
    const fits = next !== undefined ? s === next.id : s === null || (input.hasMore && !keptIds.has(s))
    if (!fits || after.has(p)) return { ok: false, reason: 'stale' }
    after.set(p, chain)
  }

  // ⑤ 짓는다
  const rows: RowJson[] = []
  const put = (chain: readonly string[] | undefined) => {
    if (chain !== undefined) for (const id of chain) rows.push(placed.get(id)!.row)
  }
  put(after.get(null))
  for (const row of kept) {
    rows.push(row)
    put(after.get(row.id))
  }
  if (rows.length > cap) return { ok: false, reason: 'cap' }
  if (!changed && outside.size !== input.outside.size) changed = true
  return { ok: true, rows, outside, changed }
}

// ── 커서 장부 ─────────────────────────────────────────────────────────
//
// 커서의 뜻(정본 X-5 1단계 ④): "이 커서를 받은 **뒤에** 시작한 읽기는 커서 아래의 모든 변경을 본다". 그래서
//   · 델타를 합쳤으면 화면은 그 응답의 커서까지 안다(`applied` = 응답의 커서)
//   · 처음부터 다시 읽었으면 그 읽기 **전에** 받은 커서까지 안다 — 신호(`ready` · `changed`)의 것이나 reset 응답의 것. 없으면 옛 것을 둔다
//     (더 오래된 커서는 안전하다 — 이미 본 변경이 한 번 더 올 뿐이다 · 행은 post-image)
// 처음의 `applied` 는 서버 화면이 **읽기 전에** 받은 렌더 커서(`RenderedChangeCursor`)다. 없으면 null — 첫 신호에 다시 읽는다.

export type SyncLedger = {
  /** 화면이 그 아래의 변경을 다 반영한 커서 — 델타는 이것부터 묻는다. null 이면 델타를 묻지 못한다(다시 읽는다). */
  applied: string | null
  /** 신호(`ready` · `changed`)가 마지막으로 실어 온 커서. */
  signal: string | null
}

export function createSyncLedger(rendered: string | null): SyncLedger {
  return { applied: rendered, signal: null }
}

/** 신호가 커서를 실어 왔다(없으면 그대로). */
export function noteSignal(ledger: SyncLedger, cursor: string | null | undefined): void {
  if (typeof cursor === 'string' && cursor !== '') ledger.signal = cursor
}

/** 다시 읽기를 **시작하기 전에** — 다 읽으면 이 커서까지 안다. `known` 은 reset 응답처럼 손에 든 더 확실한 커서. */
export function fullReadCursor(ledger: SyncLedger, known: string | null = null): string | null {
  return known ?? ledger.signal
}

/** 다시 읽기를 마쳤다 — 시작 전에 받아 둔 커서(`fullReadCursor`)로. 없으면 옛 것을 둔다. */
export function afterFullRead(ledger: SyncLedger, before: string | null): void {
  if (before !== null) ledger.applied = before
}

/** 델타를 합쳤다 — 응답의 커서로. */
export function afterDelta(ledger: SyncLedger, cursor: string): void {
  ledger.applied = cursor
}

/** 맞추기의 종류 — 다시 읽기가 델타보다 세다(미뤄 둔 둘이 겹치면 다시 읽는다). */
export type SyncMode = 'none' | 'delta' | 'full'
export function strongerSync(a: SyncMode, b: SyncMode): SyncMode {
  return a === 'full' || b === 'full' ? 'full' : a === 'delta' || b === 'delta' ? 'delta' : 'none'
}
