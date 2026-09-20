/**
 * 표 화면이 부르는 API — 요청 모양과 **실패 문구**를 한 곳에 둔다.
 *
 * 서버의 거부 코드(`lib/database/http.ts`)를 사람의 말로 바꾸는 곳이 여기 하나다.
 * 컴포넌트마다 문구를 두면 같은 거부가 화면마다 다르게 읽힌다.
 *
 * 이 파일은 던지지 않는다. 네트워크가 끊겨도 `{ ok: false, message }` 다 — 호출자가
 * try/catch 를 빠뜨려 낙관적으로 칠한 칸이 되돌아가지 않는 경로를 만들지 않는다.
 */

import type { FilterNode, SortKey } from '@/lib/database/filter'
import type { GroupBy } from '@/lib/database/group'
import type { RowJson } from '@/lib/database/http'
import type { PropertySummary } from '@/lib/database/property'
import type { CellValue, MvpPropertyType, SelectOption } from '@/lib/database/property-types'
import type { RowCell } from '@/lib/database/row'
import type { MvpViewType, ViewSummary } from '@/lib/database/view'

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

type ErrorBody = { error?: string; issues?: { message?: string }[] } | null

const JSON_HEADERS = { 'content-type': 'application/json' }

function messageOf(status: number, body: ErrorBody): string {
  // 값의 계약 위반은 서버가 필드별로 이유를 준다. 그것이 가장 구체적이다.
  const issue = body?.issues?.[0]?.message
  if (issue) return issue
  switch (body?.error) {
    case 'forbidden':
      return '이 표를 고칠 권한이 없습니다.'
    case 'not_found':
      return '찾을 수 없습니다. 그사이 지워졌을 수 있습니다.'
    case 'duplicate_name':
      return '같은 이름의 속성이 이미 있습니다.'
    case 'invalid_name':
      return '이름을 확인하세요.'
    case 'too_many_properties':
      return '속성을 더 만들 수 없습니다.'
    case 'version_conflict':
    case 'schema_conflict':
      return '다른 곳에서 먼저 바뀌었습니다. 새로고침하세요.'
    case 'readonly_property':
      return '읽기 전용 속성입니다.'
    case 'invalid_filter':
      return '필터를 확인하세요.'
    case 'invalid_sorts':
      return '정렬을 확인하세요.'
    case 'title_required':
      return '제목 속성은 숨길 수 없습니다.'
    case 'title_immutable':
      return '제목 속성은 지울 수 없습니다.'
    // ── 보드 (4b) ──
    case 'group_required':
      return '보드에는 그룹 기준이 필요합니다. 선택 · 상태 · 체크박스 속성을 먼저 만드세요.'
    case 'not_grouped':
      return '이 보드의 그룹 속성이 지워졌습니다. 그룹 기준을 다시 고르세요.'
    case 'invalid_group':
      return '그룹 설정을 확인하세요.'
    case 'invalid_config':
      return '속성 설정을 확인하세요.'
    case 'unsupported_type':
      return '지원하지 않는 뷰 종류입니다.'
    case 'invalid_value':
      return '요청 값을 확인하세요.'
  }
  return status >= 500 ? '서버에서 처리하지 못했습니다.' : '처리하지 못했습니다.'
}

async function call<T>(url: string, init: RequestInit, pick: (body: Record<string, unknown>) => T): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init)
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) return { ok: false, message: messageOf(res.status, body as ErrorBody) }
    return { ok: true, value: pick(body ?? {}) }
  } catch {
    // ⚠ 본문의 저장 큐(F-05-04)는 여기 없다. 끊겼다고 **말한다** — 조용히 사라지지 않는다.
    return { ok: false, message: '연결에 실패했습니다. 바뀐 내용이 저장되지 않았습니다.' }
  }
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}`

export function updateCell(
  workspaceId: string,
  rowId: string,
  propertyId: string,
  value: CellValue,
): Promise<ApiResult<RowJson>> {
  return call(
    `${base(workspaceId)}/rows/${rowId}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ cells: [{ propertyId, value }] }) },
    (body) => body.row as RowJson,
  )
}

/** 행을 만든다. `cells` 는 미리 채울 값 — 보드 열의 `+` 가 그룹 값을 넣는다(F-04-03). */
export function createRow(workspaceId: string, viewId: string, cells: readonly RowCell[] = []): Promise<ApiResult<RowJson>> {
  return call(
    `${base(workspaceId)}/views/${viewId}/rows`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ cells }) },
    (body) => body.row as RowJson,
  )
}

export type RowPage = { rows: RowJson[]; hasMore: boolean; nextCursor: string | null }

export function loadRows(workspaceId: string, viewId: string, cursor: string): Promise<ApiResult<RowPage>> {
  return call(
    `${base(workspaceId)}/views/${viewId}/rows?cursor=${encodeURIComponent(cursor)}`,
    { method: 'GET' },
    (body) => ({
      rows: body.rows as RowJson[],
      hasMore: body.hasMore === true,
      nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
    }),
  )
}

// ── 보드 (4b) ──────────────────────────────────────────────────────────

/** 보드 한 열의 다음 페이지 — 그룹별 독립 커서(F-04-15). `cursor` 가 null 이면 첫 페이지다. */
export function loadGroupRows(
  workspaceId: string,
  viewId: string,
  groupKey: string,
  cursor: string | null,
): Promise<ApiResult<RowPage>> {
  const query = new URLSearchParams({ group: groupKey })
  if (cursor !== null) query.set('cursor', cursor)
  return call(`${base(workspaceId)}/views/${viewId}/groups?${query}`, { method: 'GET' }, (body) => ({
    rows: body.rows as RowJson[],
    hasMore: body.hasMore === true,
    nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
  }))
}

export type MoveResult = { readonly row: RowJson; readonly groupKey: string; readonly positioned: boolean }

/**
 * 카드 이동 — **요청 하나**다. 셀 값과 열 안 자리를 서버가 한 트랜잭션으로 쓴다(마스터 문서 §5.2 4번 · §3.3-148).
 * 셀 PATCH 와 자리 저장을 따로 부르지 않는다.
 */
export function moveCard(
  workspaceId: string,
  viewId: string,
  input: { readonly rowId: string; readonly groupKey: string; readonly beforeRowId: string | null },
): Promise<ApiResult<MoveResult>> {
  return call(
    `${base(workspaceId)}/views/${viewId}/groups`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'move', ...input }) },
    (body) => ({
      row: body.row as RowJson,
      groupKey: body.groupKey as string,
      positioned: body.positioned === true,
    }),
  )
}

// ── relation (5b-1) ────────────────────────────────────────────────────

/** 연결된 행들의 제목. 첫 화면의 것은 서버 렌더가 준다 — 이것은 그 뒤에 온 행("더 보기" · 새 행)의 몫이다. */
export function loadRelationLabels(
  workspaceId: string,
  ids: readonly string[],
): Promise<ApiResult<Record<string, string | null>>> {
  return call(
    `${base(workspaceId)}/relation-labels`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) },
    (body) => (body.labels ?? {}) as Record<string, string | null>,
  )
}

/** 뷰를 만든다. 보드인데 `groupBy` 가 없으면 서버가 첫 select 를 고르고, 고를 것이 없으면 `group_required` 다. */
export function createView(
  workspaceId: string,
  databaseId: string,
  input: { readonly name?: string; readonly type: MvpViewType; readonly groupBy?: GroupBy },
): Promise<ApiResult<ViewSummary>> {
  return call(
    `${base(workspaceId)}/databases/${databaseId}/views`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
    (body) => body.view as ViewSummary,
  )
}

export function addColumn(
  workspaceId: string,
  dataSourceId: string,
  name: string,
  type: MvpPropertyType,
): Promise<ApiResult<PropertySummary>> {
  return call(
    `${base(workspaceId)}/data-sources/${dataSourceId}/properties`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, type }) },
    (body) => body.property as PropertySummary,
  )
}

export function addOption(
  workspaceId: string,
  dataSourceId: string,
  propertyId: string,
  name: string,
): Promise<ApiResult<SelectOption>> {
  return call(
    `${base(workspaceId)}/data-sources/${dataSourceId}/properties/${propertyId}/options`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) },
    (body) => body.option as SelectOption,
  )
}

/**
 * 뷰의 필터 · 정렬 · 종류 · 그룹을 저장한다. **보낸 키만** 바뀐다 — `filter: null` 은 "필터를 없애라",
 * 키가 없으면 "그대로 둬라"다(`PATCH /views` 라우트가 `'filter' in body` 로 가른다). `groupBy` 도 같다.
 */
export function updateView(
  workspaceId: string,
  viewId: string,
  patch: {
    readonly type?: MvpViewType
    readonly filter?: FilterNode | null
    readonly sorts?: readonly SortKey[]
    readonly groupBy?: GroupBy | null
  },
): Promise<ApiResult<null>> {
  return call(
    `${base(workspaceId)}/views/${viewId}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
    () => null,
  )
}

/** 컬럼 하나를 보이거나 숨긴다 — 불변식 V1: 컬럼 하나가 주소다. */
export function setColumnVisible(
  workspaceId: string,
  viewId: string,
  propertyId: string,
  visible: boolean,
): Promise<ApiResult<null>> {
  return call(
    `${base(workspaceId)}/views/${viewId}/columns/${encodeURIComponent(propertyId)}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ visible }) },
    () => null,
  )
}

export function renameColumn(
  workspaceId: string,
  dataSourceId: string,
  propertyId: string,
  name: string,
): Promise<ApiResult<null>> {
  return call(
    `${base(workspaceId)}/data-sources/${dataSourceId}/properties/${encodeURIComponent(propertyId)}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) },
    () => null,
  )
}

/** 속성을 지운다 — soft delete 다. 셀 값은 서버에 남는다(`deleteProperty` 머리말). */
export function deleteColumn(workspaceId: string, dataSourceId: string, propertyId: string): Promise<ApiResult<null>> {
  return call(
    `${base(workspaceId)}/data-sources/${dataSourceId}/properties/${encodeURIComponent(propertyId)}`,
    { method: 'DELETE' },
    () => null,
  )
}

export function renameDatabase(workspaceId: string, databaseId: string, name: string): Promise<ApiResult<null>> {
  return call(
    `${base(workspaceId)}/databases/${databaseId}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) },
    () => null,
  )
}
