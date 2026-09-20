/**
 * 데이터베이스 템플릿 — 템플릿 6c-1 · 6c-2조각 (F-08-02 · F-08-03)
 *
 *   6c-1  저장 모양과 서버 명령 — 템플릿 행 만들기 · 목록 · 버리기 · 뷰의 기본 템플릿
 *   6c-2  **템플릿으로 행 만들기** — 셀 · 본문 · 하위 페이지 · relation 을 옮긴다(`createRowFromTemplate`)
 *
 * 정본: 00-canonical-data-model.md §3.5 (`page.is_template` · 불변식 R1) · §3.6 (`view.default_template_page_id`)
 *       08-templates-automation.md F-08-02 · F-08-03
 *       판결 C-3 (DB 행은 `block` 의 행이다)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 템플릿은 표에서 숨긴 행이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 08 F-08-02 의 *"property 기본값은 별도 컬럼이 아니라 템플릿 페이지 자신의 property 값으로 저장 → 스키마 변경 시
 * 자동으로 같은 규칙 적용"* 그대로다. 템플릿은 `page.is_template = true` 인 행이고, 그 밖의 모든 것 — 셀 · 본문 ·
 * 하위 페이지 · 검색 색인 — 은 보통 행과 **완전히 같은 길**을 쓴다. 판결 C-3 의 연장이다: 별도 엔티티를 만들지 않는다.
 *
 * 그래서 이 파일이 하는 일은 작다. 갈라지는 자리는 셋뿐이다:
 *
 *   ① 태어날 때     `is_template = true`                          (`createRowIn` 의 한 칸)
 *   ② 목록          `is_template = true` — 불변식 R1 의 **반대쪽**
 *   ③ 버릴 때       `edit_structure` 를 묻는다 (아래)
 *
 * 나머지는 전부 행의 명령이 그대로 듣는다. 템플릿의 제목을 고치는 것은 `updateCells`(title 셀)이고, 본문을 고치는
 * 것은 협업 서버다. 템플릿만의 편집 명령을 만들지 않는다 — 만들면 행에 생긴 기능이 템플릿에 자동으로 오지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * R1 의 반대쪽 — 템플릿은 표에 보이지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 불변식 R1(*"모든 뷰/API 쿼리는 기본 조건으로 `is_template=false` 를 강제한다"*)은 이 조각보다 먼저 서 있었다:
 * `query.ts`(뷰 질의) · `row.ts`(`listRows`) · `group.ts`(보드의 그룹 · 카운트 · 카드 이동) · `relation.ts`(연결
 * 대상 · 후보 · 제목 맵) · `rollup.ts`(집계에 넣는 행)이 전부 그 조건을 달고 있다. 그러므로 템플릿 행이 생겨도
 * 표 · 보드 · 목록 · 연결 후보 · 집계 어디에도 나타나지 않는다 — **그것이 이 조각을 먼저 쓸 수 있는 이유**다.
 *
 * 이 파일의 목록은 그 조건을 뒤집은 유일한 자리다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한 — 목록을 바꾸는 것과 안을 고치는 것은 다른 축이다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   목록을 읽는다            `view`
 *   템플릿을 만든다 · 버린다  `edit_structure`
 *   템플릿의 셀 · 본문을 고친다  `edit_content` (행 · 페이지의 보통 길 그대로)
 *
 * 만들기 · 버리기가 `edit_structure` 인 이유는 그것이 **모두의 `New ▾` 목록**을 바꾸기 때문이다 — 08 F-08-02 의
 * 엣지 케이스 *"템플릿 사용자에게 DB 편집 권한 없음 → 템플릿 목록 노출은 하되 생성 불가"* 가 가르는 자리다.
 *
 * 안을 고치는 것이 `edit_content` 로 남는 비대칭은 **의도한 것**이다. 이미 모든 행을 고칠 수 있는 사람에게 템플릿의
 * 오타만 잠글 이유가 없고, 그러려면 셀 쓰기 · 본문 쓰기 · 코멘트 …가 전부 "이 행이 템플릿인가"를 따로 알아야 한다.
 * 갈라지는 자리를 늘리는 대신 목록에 무엇이 서는지만 지킨다.
 *
 * ⚠ **`edit_structure` 와 `edit_content` · `create_child` 의 차이는 오늘 관찰되지 않는다** — `resolveCaps` 가
 *   ACL 의 대상 종류를 `'page'` 로 고정해서 데이터베이스 노드에 그 둘만 가진 레벨을 줄 수 없다(HANDOFF §7).
 *   검사가 지키는 것은 "볼 수만 있는 사람은 못 만든다"까지다(`template.db.test.ts` 머리말).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 개수 상한 — 08 은 "제한 없음"이라고 적었다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 08 F-08-02 는 노션을 인용해 *"개수 제한 없음(You can make as many as you want)"* 이라고 적는다. 그럼에도 상한을
 * 두는 이유는 제품의 약속이 아니라 **고르는 화면** 때문이다: `New ▾` 는 페이지네이션이 없는 목록이고, 100개를 넘긴
 * 드롭다운은 이미 고를 수 없다. 페이지네이션이 생기면 이 상한을 올리거나 없앤다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { titleFromPlainText } from '../block/page.ts'
import { orderKeysBetween } from '../block/order-key.ts'
import { DuplicateError, duplicateSubtree, type SubtreeRow } from '../block/duplicate.ts'
import { readableScopes } from '../permissions/effective.ts'
import { isUuid } from '../ids.ts'
import {
  createRowIn,
  isRowFailure,
  openDataSource,
  readRow,
  type RowCell,
  type RowResult,
  type RowSummary,
} from './row.ts'
import type { CellValue } from './property-types.ts'

/** 한 표가 가질 수 있는 템플릿 수(머리말). */
export const MAX_TEMPLATES_PER_SOURCE = 100

/** 이름을 주지 않고 만든 템플릿. 화면이 "제목 없음"을 그리는 대신 부를 이름이 있어야 목록에서 고를 수 있다. */
export const DEFAULT_TEMPLATE_NAME = '새 템플릿'

export const MAX_TEMPLATE_NAME_LENGTH = 200

export type TemplateFailure =
  | 'not_found'
  | 'forbidden'
  /** 상한을 넘었다(머리말). */
  | 'too_many'
  | 'invalid_value'
  /** 템플릿이 복제 상한(페이지 · 블록 수)을 넘는다 — `duplicate.ts` 의 `too_large`. */
  | 'too_large'
  /** 템플릿의 하위 페이지가 깊이 상한을 넘는다 — `duplicate.ts` 의 `too_deep`. */
  | 'too_deep'

export type TemplateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: TemplateFailure }

const fail = (reason: TemplateFailure): TemplateResult<never> => ({ ok: false, reason }) as const

/**
 * 행의 실패 어휘를 템플릿의 것으로 옮긴다.
 *
 * `schema_conflict` · `version_conflict` 같은 것은 이 경로에서 나올 수 없다(버전을 주지 않는다). 남는 것은
 * 권한과 값이고, 모르는 것은 `invalid_value` 로 접는다 — 템플릿 라우트가 행의 어휘를 그대로 내보내면 화면이
 * 두 어휘를 다 알아야 한다.
 */
function fromRowFailure(v: RowResult<never>): TemplateResult<never> {
  // `RowResult<never>` 의 성공 쪽은 `value: never` 라 있을 수 없다. 타입을 좁히려고 둔 가지다.
  if (v.ok) return fail('invalid_value')
  if (v.reason === 'not_found' || v.reason === 'forbidden') return fail(v.reason)
  return fail('invalid_value')
}

// ── 만들기 ────────────────────────────────────────────────────────────

export type CreateTemplateInput = {
  /** 템플릿의 이름 — 그 행의 **title 셀**이다(08: 템플릿 이름 = 템플릿 페이지의 제목). */
  readonly title?: string
}

/**
 * 템플릿 행을 만든다. **빈 템플릿이다** — 셀도 본문도 비어 있고, 채우는 것은 보통 행을 고치는 길이다.
 *
 * `createRowIn` 을 그대로 쓴다. status 의 기본 옵션도 보통 행과 똑같이 받는다(`defaultCells`) — 템플릿이 받은 그
 * 값은 나중에 사본에 그대로 실리므로, 받지 않게 만들면 "템플릿으로 만든 행만 상태가 빈다"가 된다.
 */
export async function createTemplate(
  ctx: SessionContext,
  dataSourceId: string,
  input: CreateTemplateInput = {},
): Promise<TemplateResult<RowSummary>> {
  const raw = input.title ?? DEFAULT_TEMPLATE_NAME
  if (typeof raw !== 'string') return fail('invalid_value')
  const title = raw.trim().slice(0, MAX_TEMPLATE_NAME_LENGTH) || DEFAULT_TEMPLATE_NAME

  return withCommandTransaction(async (tx) => {
    // 권한을 먼저 본다 — 못 보는 사람에게 개수를 알려 주지 않는다.
    const gate = await openDataSource(tx, ctx, dataSourceId, 'edit_structure')
    if (isRowFailure(gate)) return fromRowFailure(gate)

    const counted = await tx.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND p.is_template AND b.lifecycle = 'live'`,
      [dataSourceId],
    )
    if (Number(counted.n) >= MAX_TEMPLATES_PER_SOURCE) return fail('too_many')

    const created = await createRowIn(tx, ctx, dataSourceId, {
      isTemplate: true,
      // title 프로퍼티가 없는 표는 없다(`createDatabase` 가 만든다). 없으면 이름 없는 템플릿이 되는데, 그때도
      // 만들기를 거부하지는 않는다 — 이름은 셀이고 셀은 나중에 채울 수 있다.
      ...(gate.titlePropertyId === null
        ? {}
        : { cells: [{ propertyId: gate.titlePropertyId, value: { type: 'title' as const, title: titleFromPlainText(title) } }] }),
    })
    return created.ok ? ({ ok: true, value: created.value } as const) : fromRowFailure(created)
  })
}

// ── 목록 ──────────────────────────────────────────────────────────────

export type TemplateSummary = {
  readonly id: string
  /** title 셀의 평문. 비어 있으면 화면이 "제목 없음"을 고른다. */
  readonly title: string
  readonly lastEditedAt: Date
}

/**
 * 이 표의 템플릿 — 불변식 R1 의 반대쪽(머리말).
 *
 * `view` 만 있으면 읽을 수 있다. 08 의 *"템플릿 목록 노출은 하되 생성 불가"* 가 그것이다 — 고를 수 있어야 `New ▾`
 * 가 쓸모 있고, 고른 뒤 만들 수 있는지는 행 생성 권한이 따로 판정한다.
 *
 * 순서는 `order_key` 다. 템플릿도 행이라 같은 형제 키 공간에 서 있고(`UNIQUE (parent_id, order_key)`), 새 템플릿은
 * 맨 뒤에 붙는다 — 목록의 순서가 만든 순서다.
 */
export async function listTemplates(
  ctx: SessionContext,
  dataSourceId: string,
): Promise<TemplateResult<readonly TemplateSummary[]>> {
  return withReadTransaction(async (tx) => {
    const gate = await openDataSource(tx, ctx, dataSourceId, 'view')
    if (isRowFailure(gate)) return fromRowFailure(gate)

    const rows = await tx.query<{ id: string; properties: { title?: unknown } | null; last_edited_at: Date }>(
      `SELECT b.id, b.properties, b.last_edited_at
         FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND p.is_template AND b.lifecycle = 'live'
        ORDER BY b.order_key COLLATE "C", b.id
        LIMIT $2`,
      [dataSourceId, MAX_TEMPLATES_PER_SOURCE],
    )
    return {
      ok: true,
      value: rows.map((row) => ({ id: row.id, title: plainTitle(row.properties), lastEditedAt: row.last_edited_at })),
    } as const
  })
}

/** 투영된 제목(`block.properties.title`)의 평문. 정본은 title 셀이지만 목록에 셀을 조인할 이유가 없다(투영의 목적). */
function plainTitle(properties: { title?: unknown } | null): string {
  const raw = properties?.title
  if (!Array.isArray(raw)) return ''
  return raw
    .map((run) => (typeof run === 'object' && run !== null ? String((run as { plain_text?: unknown }).plain_text ?? '') : ''))
    .join('')
}

// ── 버리기 ────────────────────────────────────────────────────────────

/**
 * 템플릿을 휴지통으로 보낸다.
 *
 * 행과 같은 축이다(`block.lifecycle` · X-3) — 복원하면 목록에 돌아온다. 셀도 본문도 건드리지 않는다.
 *
 * **기본 지정은 풀지 않는다.** 08 F-08-03 이 *"기본 템플릿이 삭제됨 → 지정 해제, 빈 페이지로 폴백"* 이라고 적은
 * 결과는 읽는 쪽이 만든다(`view.ts` `liveDefaultTemplate` — 살아 있는 템플릿을 가리킬 때만 값을 준다). 저장된
 * 값을 지우지 않는 이유는 `group_by` 와 같다: **복원하면 지정이 돌아온다.** 지워 버리면 되살린 템플릿을 다시
 * 기본으로 찍어야 하고, 그 정보는 어디에도 남아 있지 않다.
 *
 * 영구 삭제는 다르다 — 그때는 0026 의 FK(`ON DELETE SET NULL`)가 지정을 푼다. 돌아올 것이 없기 때문이다.
 */
export async function deleteTemplate(ctx: SessionContext, templateId: string): Promise<TemplateResult<null>> {
  if (!isUuid(templateId)) return fail('not_found')

  return withCommandTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ data_source_id: string }>(
      `SELECT p.data_source_id
         FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND p.is_template
        FOR UPDATE OF b`,
      [templateId, ctx.workspaceId],
    )
    if (row === null) return fail('not_found')

    const gate = await openDataSource(tx, ctx, row.data_source_id, 'edit_structure')
    if (isRowFailure(gate)) return fromRowFailure(gate)

    await tx.query(
      `UPDATE block
          SET lifecycle = 'trashed', trashed_at = now(), trashed_by = $2,
              trash_root_id = id, trash_reason = 'user',
              purge_after = now() + make_interval(days => (
                SELECT trash_days FROM workspace WHERE id = $3)),
              last_edited_by = $2, last_edited_at = now(), version = version + 1
        WHERE id = $1`,
      [templateId, ctx.userId, ctx.workspaceId],
    )
    return { ok: true, value: null } as const
  })
}

// ── 템플릿으로 행 만들기 ──────────────────────────────────────────────

/**
 * 템플릿을 복제해 새 행을 만든다 — 08 F-08-02 의 *"`New ▾` 에서 해당 템플릿 선택 시 그 상태로 새 행 생성"*.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 복제이지 참조가 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 08: *"템플릿으로 생성한 페이지는 이후 자유롭게 수정 가능하며, **템플릿 원본과 링크되지 않는다** — 템플릿 변경은
 * 기존 행에 소급되지 않는다."* 그래서 만든 뒤 두 행은 남남이다. 어디에도 "이 행은 저 템플릿에서 왔다"를 적지 않는다.
 *
 * 옮겨 오는 것은 셋이다.
 *
 *   셀 값      `page_property_value` 를 그대로 복사한다(사이드카는 `createRowIn` 이 파생한다)
 *   본문 · 하위 페이지  6a 의 복제 엔진(`duplicateSubtree`) — 뿌리만 **행**으로 만든다
 *   relation 엣지      대상을 **그대로** 물려준다(아래)
 *
 * rollup 은 옮길 것이 없다 — 읽을 때 계산한다(§3.3-167).
 *
 * ──────────────────────────────────────────────────────────────────────
 * relation 은 재매핑하지 않는다 — 08 이 경고한 그대로다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 복제의 규칙은 *"안쪽은 사본을, 바깥은 원본을"*(§3.2-34)인데, relation 의 대상은 **언제나 바깥**이다: 대상은 다른
 * 표(또는 같은 표)의 **행**이고 복제 범위(템플릿과 그 본문의 하위 페이지)에 들어 있지 않다. 그래서 규칙을 그대로
 * 적용하면 "원본 유지"이고, 08 의 경고 *"relation property를 템플릿에 채워두면 그 템플릿으로 만든 모든 페이지가
 * 동일 대상을 참조한다"* 와 같은 동작이 된다. **의도된 것**이다 — "이 프로젝트에 속한 작업" 템플릿의 쓸모가 거기 있다.
 *
 * 단 **볼 수 없는 대상은 잇지 않는다.** `linkRows` 가 볼 수 없는 행을 연결하지 못하게 막는 것과 같은 이유다(양방향이면
 * 거울상이 그 행에 쓰인다 — 볼 수 없는 행을 고치게 된다). 몇 개를 못 이었는지는 돌려준다(`skippedLinks`) — 화면이
 * 말할 수 있게(§3.3-174). 엣지를 쓰는 경로이므로 **거울상을 같은 트랜잭션에 함께 쓰고 건드리는 행을 id 순으로
 * 잠근다**(relation 5a · 0024 의 지연 제약 트리거가 커밋에서 검사한다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 제목에는 꼬리표를 붙이지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 복제는 사본에 ` (1)` 을 붙인다(§3.2-34). 여기서는 붙이지 않는다 — 만들어지는 것은 사본이 아니라 **새 항목**이고,
 * "주간 회의 (1)" 은 복제의 말이지 템플릿의 말이 아니다. 제목도 셀이므로 셀 복사 규칙에 예외를 두지 않는다(08 이
 * property 기본값을 템플릿 페이지 자신의 property 값으로 둔 것과 같은 이유). 호출자가 title 셀을 주면 그것이 이긴다.
 */

export type CreateFromTemplateInput = {
  /**
   * 템플릿의 값을 **덮는** 셀. 08 의 엣지 케이스 *"보드 뷰에서 그룹 컬럼값과 템플릿 property 가 충돌 → 그룹 컬럼값이
   * 템플릿 값을 덮어씀"* 이다 — 보드의 열에서 만든 카드는 그 열의 값이어야 한다.
   */
  readonly cells?: readonly RowCell[]
}

export type TemplateRow = {
  readonly row: RowSummary
  /** 볼 수 없어서 복제하지 않은 하위 페이지 수. */
  readonly skippedPages: number
  /** 대상을 볼 수 없어서 잇지 않은 연결 수. */
  readonly skippedLinks: number
}

type TemplateEdge = { property_id: string; to_page_id: string; order_idx: string; readable: boolean }

export async function createRowFromTemplate(
  ctx: SessionContext,
  dataSourceId: string,
  templateId: string,
  input: CreateFromTemplateInput = {},
): Promise<TemplateResult<TemplateRow>> {
  return withCommandTransaction(async (tx) => {
    // 행을 만드는 것이므로 `create_child` 다 — 템플릿을 **고르는** 것은 목록을 읽는 일이고(`view`), 만드는 것은
    // 보통 행을 만드는 일과 같은 권한이다(08: *"템플릿 목록 노출은 하되 생성 불가"* 의 반대쪽).
    const gate = await openDataSource(tx, ctx, dataSourceId, 'create_child')
    if (isRowFailure(gate)) return fromRowFailure(gate)

    const template = await tx.queryMaybe<SubtreeRow>(
      `SELECT b.id, b.parent_id, b.ancestor_path, b.properties, b.format
         FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template
          AND b.workspace_id = $3 AND b.lifecycle = 'live'`,
      [isUuid(templateId) ? templateId : null, dataSourceId, ctx.workspaceId],
    )
    if (template === null) return fail('not_found')

    // ── 셀 ──
    // 지워진 · 읽기 전용이 된 프로퍼티의 값은 **무시한다**(08: *"템플릿에 저장된 property 가 이후 DB 에서 삭제됨 →
    // 해당 값은 무시"*). 남겨 두면 `prepareCells` 가 요청 전체를 거부해 그 템플릿으로는 영영 행을 못 만든다.
    const stored = await tx.query<{ property_id: string; value: CellValue }>(
      `SELECT v.property_id, v.value
         FROM page_property_value v
         JOIN property pr ON pr.id = v.property_id
        WHERE v.page_id = $1 AND pr.data_source_id = $2
          AND pr.deleted_at IS NULL AND pr.writable <> 'readonly'`,
      [template.id, dataSourceId],
    )
    const given = input.cells ?? []
    const overridden = new Set(given.map((cell) => cell.propertyId))
    const cells: RowCell[] = [
      ...stored.filter((s) => !overridden.has(s.property_id)).map((s) => ({ propertyId: s.property_id, value: s.value })),
      ...given,
    ]

    // ── relation 엣지 ──
    // 잠그기 전에 **무엇을 잠글지** 알아야 한다. 대상 행이 살아 있고 템플릿이 아니어야 하며(`linkRows` 와 같은 조건),
    // 볼 수 있는지는 제목 맵 · 집계와 같은 축으로 묻는다(`perm_scope_id = ANY(readableScopes)`).
    const edges = await tx.query<TemplateEdge>(
      `SELECT e.property_id, e.to_page_id, e.order_idx,
              (tb.perm_scope_id = ANY($3::uuid[])) AS readable
         FROM relation_edge e
         JOIN property pr ON pr.id = e.property_id
         JOIN page tp ON tp.id = e.to_page_id
         JOIN block tb ON tb.id = tp.id
        WHERE e.from_page_id = $1 AND pr.data_source_id = $2
          AND pr.deleted_at IS NULL AND pr.type = 'relation'
          AND tb.lifecycle = 'live' AND tp.is_template = false
        ORDER BY e.property_id, e.order_idx COLLATE "C"`,
      [template.id, dataSourceId, await readableScopes(tx, ctx)],
    )
    const linkable = edges.filter((e) => e.readable)

    // ── 복제 — 뿌리만 행으로 만든다 ──
    let created: RowResult<RowSummary> | null = null
    let copied
    try {
      copied = await duplicateSubtree(tx, ctx, template, {
        // 행은 컨테이너 바로 아래다 — 템플릿과 같은 깊이다.
        depth: template.ancestor_path.length,
        alsoLock: linkable.map((e) => e.to_page_id),
        // ★ 엔진이 주는 제목(`duplicateTitle` 의 꼬리표가 붙은 것)을 **쓰지 않는다.** 행 제목의 정본은 title
        //   셀이고(`row.ts`) 그것은 위에서 셀과 함께 복사했다 — 엔진의 제목은 `block.properties.title` 의
        //   투영이라 서식이 없다. 꼬리표가 붙지 않는 것도 여기서 따라 나온다(머리말).
        create: async () => {
          created = await createRowIn(tx, ctx, dataSourceId, { cells })
          if (!created.ok) throw new RowRejected(created)
          return created.value.id
        },
      })
    } catch (error) {
      if (error instanceof RowRejected) return fromRowFailure(error.failure)
      if (error instanceof DuplicateError) {
        if (error.code === 'too_large') return fail('too_large')
        if (error.code === 'too_deep') return fail('too_deep')
      }
      throw error
    }
    if (created === null || !(created as RowResult<RowSummary>).ok) throw new Error('사본 행이 만들어지지 않았다')

    // ── 엣지 — 대상은 그대로, 거울상은 함께 ──
    for (const edge of linkable) {
      await tx.query(
        `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [edge.property_id, copied.rootId, edge.to_page_id, edge.order_idx],
      )
    }
    await writeMirrors(tx, dataSourceId, copied.rootId, linkable)

    const summary = await readRow(tx, copied.rootId)
    if (summary === null) return fail('not_found')
    return {
      ok: true,
      value: { row: summary, skippedPages: copied.skipped, skippedLinks: edges.length - linkable.length },
    } as const
  })
}

/** 행 명령이 거부를 **값으로** 돌려주므로, 엔진 콜백 안에서는 예외로 바꿔 빠져나온다. */
class RowRejected extends Error {
  readonly failure: RowResult<never>

  constructor(failure: RowResult<never>) {
    super('행 만들기가 거부됐다')
    this.name = 'RowRejected'
    this.failure = failure
  }
}

/**
 * 양방향 relation 의 거울상 — **상대 행의 칸 맨 뒤**에 선다(칸마다 순서가 따로다 · `linkRows` 와 같은 규칙).
 *
 * 0024 의 지연 제약 트리거가 커밋에서 대칭을 검사하므로 **같은 트랜잭션**에서 써야 한다. 상대 행의 `block.version`
 * 은 올리지 않는다 — 그 행을 고친 사람이 없다(§3.2-31).
 */
async function writeMirrors(
  tx: Tx,
  dataSourceId: string,
  rowId: string,
  edges: readonly TemplateEdge[],
): Promise<void> {
  if (edges.length === 0) return
  const synced = new Map(
    (
      await tx.query<{ id: string; synced: string | null }>(
        `SELECT id, config->>'synced_property_id' AS synced FROM property
          WHERE data_source_id = $1 AND id = ANY($2::text[])`,
        [dataSourceId, [...new Set(edges.map((e) => e.property_id))]],
      )
    ).map((r) => [r.id, r.synced]),
  )
  for (const edge of edges) {
    const pair = synced.get(edge.property_id)
    if (pair == null) continue
    const tail = await tx.queryOne<{ max: string | null }>(
      `SELECT max(order_idx COLLATE "C") AS max FROM relation_edge WHERE property_id = $1 AND from_page_id = $2`,
      [pair, edge.to_page_id],
    )
    await tx.query(
      `INSERT INTO relation_edge (property_id, from_page_id, to_page_id, order_idx)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [pair, edge.to_page_id, rowId, orderKeysBetween(tail.max, null, 1)[0]],
    )
  }
}

// ── 읽기(다른 명령이 쓴다) ────────────────────────────────────────────

/**
 * 이 id 가 **이 표의 살아 있는 템플릿**인가. 맞으면 그 행을 준다.
 *
 * 기본 템플릿을 지정할 때(`view.ts`)와 템플릿으로 행을 만들 때(6c-2) 둘 다 같은 질문을 한다 — 물어보는 곳이 둘이면
 * 한쪽만 휴지통을 빼먹는다. 권한은 **부르는 쪽**이 이미 봤다(둘 다 표를 열고 들어온다).
 */
export async function readLiveTemplate(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  templateId: string,
): Promise<RowSummary | null> {
  if (!isUuid(templateId)) return null
  const found = await tx.queryMaybe<{ id: string }>(
    `SELECT p.id FROM page p JOIN block b ON b.id = p.id
      WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template
        AND b.workspace_id = $3 AND b.lifecycle = 'live'`,
    [templateId, dataSourceId, ctx.workspaceId],
  )
  return found === null ? null : readRow(tx, templateId)
}
