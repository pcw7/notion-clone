/**
 * 데이터베이스 API 의 HTTP 경계 — 거부 코드 매핑 · 요청 모양 검사 · 응답 모양
 *
 * `auth/route-session.ts` 와 같은 이유로 한 곳에 둔다. 라우트마다 매핑을 복사하면
 * 한 라우트만 `not_found` 를 403 으로 줘도 **그 라우트만** 표의 존재를 흘린다.
 *
 *   not_found  → 404   못 보는 경우를 포함한다(라이브러리가 이미 그렇게 돌려준다)
 *   forbidden  → 403   볼 수는 있다 — 그러니 존재는 이미 알고 있다
 *   상태 충돌  → 409   입력은 맞는데 지금 상태가 허락하지 않는다. 다시 읽으면 풀린다 · 잠겼다(`locked` — 7f-2 · 풀면 풀린다)
 *   입력 오류  → 400
 */

import type { PageIcon } from '../block/page-icon.ts'
import type { DatabaseFailure } from './database.ts'
import type { DataSourceFailure } from './data-source.ts'
import type { LayoutFailure } from './layout.ts'
import type { PropertyFailure } from './property.ts'
import type { RowCell, RowFailure } from './row.ts'
import type { GroupFailure } from './group.ts'
import type { TemplateFailure } from './template.ts'
import type { ViewFailure } from './view.ts'

export function rowFailureStatus(reason: RowFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'schema_conflict':
    case 'version_conflict':
    case 'locked':
      return 409
    case 'unknown_property':
    case 'readonly_property':
    case 'invalid_value':
      return 400
  }
}

export function groupFailureStatus(reason: GroupFailure): number {
  // 그룹이 없는 뷰에 보드 질의 · 카드 이동 — 입력이 아니라 뷰의 상태가 허락하지 않는다.
  if (reason === 'not_grouped') return 409
  return rowFailureStatus(reason)
}

export function propertyFailureStatus(reason: PropertyFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'duplicate_name':
    case 'schema_conflict':
    case 'too_many_properties':
    case 'locked':
    // ID 프로퍼티는 하나뿐이다(U1) — 입력이 아니라 지금 상태가 허락하지 않는다. 있는 것을 지우면 같은 요청이 통과한다.
    case 'unique_id_exists':
      return 409
    case 'invalid_name':
    case 'invalid_color':
    case 'invalid_group':
    case 'invalid_config':
    case 'invalid_target':
    case 'unsupported_type':
    case 'title_immutable':
      return 400
  }
}

export function templateFailureStatus(reason: TemplateFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    // 상한은 입력이 아니라 **지금 상태**가 허락하지 않는 것이다 — 하나 지우면 같은 요청이 통과한다.
    // 복제 상한 · 깊이도 같다: 요청은 맞고 템플릿이 커졌을 뿐이다.
    case 'too_many':
    case 'too_large':
    case 'too_deep':
    case 'locked':
      return 409
    case 'invalid_value':
      return 400
  }
}

/** data source 명령의 거부(8e-1) — 빠짐없는 switch 다. */
export function dataSourceFailureStatus(reason: DataSourceFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    // 잠김 · 마지막 살아 있는 소스(8e-3a) — 입력이 아니라 지금 상태가 허락하지 않는다.
    case 'locked':
    case 'last_source':
      return 409
    case 'invalid_name':
      return 400
  }
}

export function layoutFailureStatus(reason: LayoutFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    // 잠김 · 남이 먼저 적용했다(8f-2) — 입력이 아니라 지금 상태가 허락하지 않는다. 다시 읽으면 풀린다.
    case 'locked':
    case 'layout_conflict':
      return 409
    case 'invalid_layout':
      return 400
  }
}

export function databaseFailureStatus(reason: DatabaseFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'locked':
      return 409
    case 'invalid_name':
    case 'invalid_icon':
      return 400
  }
}

/**
 * 뷰 명령의 거부 — 빠짐없는 switch 다(7f-2). 전에는 뷰 라우트 셋이 저마다 `default: 400` 으로 매핑해, 새 거부(`locked`)가
 * **조용히 400 이 되었다** — 한 곳에 두고 새 코드가 생기면 컴파일이 멈추게 한다.
 */
export function viewFailureStatus(reason: ViewFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    // 규칙상 불가능한 요청(마지막 뷰) · 잠긴 데이터베이스 — 입력이 틀린 것이 아니라 지금 상태가 허락하지 않는다.
    case 'last_view':
    case 'locked':
      return 409
    case 'invalid_name':
    case 'unsupported_type':
    case 'invalid_filter':
    case 'invalid_sorts':
    case 'title_required':
    case 'invalid_group':
    case 'group_required':
    case 'invalid_template':
      return 400
  }
}

/** 실패 결과를 응답으로. 라이브러리가 준 `issues` · `currentVersion` 을 그대로 싣는다. */
export function failureResponse(
  status: number,
  failure: { readonly reason: string; readonly issues?: readonly unknown[]; readonly currentVersion?: string },
): Response {
  return Response.json(
    {
      error: failure.reason,
      ...(failure.issues ? { issues: failure.issues } : {}),
      ...(failure.currentVersion !== undefined ? { currentVersion: failure.currentVersion } : {}),
    },
    { status },
  )
}

/** 한 요청이 쓸 수 있는 셀 수. 프로퍼티 상한(`MAX_PROPERTIES_PER_DATA_SOURCE`)과 같다. */
export const MAX_CELLS_PER_REQUEST = 500

/**
 * 셀 목록의 **모양**만 본다. 값의 계약은 보지 않는다.
 *
 * 값을 검사하려면 프로퍼티 타입을 알아야 하고, 타입은 권한 게이트를 지난 뒤에
 * 라이브러리가 읽는다(`prepareCells`). 여기서 먼저 보려고 타입을 읽으면 권한보다
 * 스키마 조회가 앞서게 된다.
 *
 * @returns 모양이 틀리면 `null`. `undefined` 는 빈 목록이다.
 */
export function parseCells(raw: unknown): RowCell[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_CELLS_PER_REQUEST) return null
  const cells: RowCell[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const { propertyId, value } = item as Record<string, unknown>
    if (typeof propertyId !== 'string') return null
    cells.push({ propertyId, value: value as RowCell['value'] })
  }
  return cells
}

export type RowJson = {
  readonly id: string
  readonly title: string
  /** 행 페이지의 아이콘(8c-3a) — 없으면 null(화면이 기본 글리프를 고른다). */
  readonly icon: PageIcon | null
  readonly properties: Readonly<Record<string, unknown>>
  /** 고유 ID 의 번호(2a-1 · `page.unique_seq`). 접두사는 컬럼에 있다. 없으면 null. */
  readonly uniqueSeq: number | null
  readonly lastEditedAt: string
  readonly version: string
}

/** 표가 그리는 행 한 줄. 읽기(`GET /rows`)와 쓰기 응답이 **같은 모양**이어야 화면이 그대로 갈아 끼운다. */
export function rowJson(row: {
  readonly id: string
  readonly title: string
  readonly icon: PageIcon | null
  readonly properties: Readonly<Record<string, unknown>>
  readonly uniqueSeq: number | null
  readonly lastEditedAt: Date
  readonly version: string
}): RowJson {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    properties: row.properties,
    uniqueSeq: row.uniqueSeq,
    lastEditedAt: row.lastEditedAt.toISOString(),
    version: row.version,
  }
}
