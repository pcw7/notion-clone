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
import type { RowJson } from '@/lib/database/http'
import type { PropertySummary } from '@/lib/database/property'
import type { CellValue, MvpPropertyType, SelectOption } from '@/lib/database/property-types'

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

export function createRow(workspaceId: string, viewId: string): Promise<ApiResult<RowJson>> {
  return call(
    `${base(workspaceId)}/views/${viewId}/rows`,
    { method: 'POST', headers: JSON_HEADERS, body: '{}' },
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
 * 뷰의 필터 · 정렬을 저장한다. **보낸 키만** 바뀐다 — `filter: null` 은 "필터를 없애라",
 * 키가 없으면 "그대로 둬라"다(`PATCH /views` 라우트가 `'filter' in body` 로 가른다).
 */
export function updateView(
  workspaceId: string,
  viewId: string,
  patch: { readonly filter?: FilterNode | null; readonly sorts?: readonly SortKey[] },
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
