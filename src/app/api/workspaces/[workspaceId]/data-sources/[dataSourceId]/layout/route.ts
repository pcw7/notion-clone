/**
 * 행의 레이아웃 — PUT `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/layout` (잔여 묶음 8f-2 · F-16-03 · F-16-07)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 행의 레이아웃 ⑤ · 16 F-16-12 *"PUT 전체 교체 1개면 충분하다(모듈 단위 PATCH 를 만들면
 *       순서 병합 문제가 생긴다)"*
 *
 * 편집 모드의 초안을 한 번에 적용한다. 본문 `{ version, order, hidden, pinned? }`:
 *
 *   version  초안을 시작할 때 읽은 버전(머리가 없으면 `'0'`). 다르면 409 `layout_conflict` — `currentVersion` 과 함께
 *   order    속성 묶음의 속성들 — 원하는 순서. 일부여도 된다(받지 않은 속성은 제자리)
 *   hidden   숨길 속성 — 여기 없는 속성은 보인다
 *   pinned   제목 아래에 고정할 속성 — 원하는 순서(3a-1 · F-16-02). 없으면 그대로. 15개를 넘으면 400 `too_many_pinned`
 *
 * 권한은 주인 데이터베이스의 `edit_structure` 이고, 잠긴 데이터베이스는 409 다(`layout.ts`).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { applyRecordLayout } from '@/lib/database/layout'
import { failureResponse, layoutFailureStatus } from '@/lib/database/http'
import { MAX_PROPERTIES_PER_DATA_SOURCE } from '@/lib/database/property'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/layout'>

/** 속성 id 목록 — 문자열 배열이고 한 소스의 속성 상한을 넘지 않는다. 아니면 null. */
const propertyIds = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length <= MAX_PROPERTIES_PER_DATA_SOURCE && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : null

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as {
    version?: unknown
    order?: unknown
    hidden?: unknown
    pinned?: unknown
  }
  const order = propertyIds(body.order)
  const hidden = propertyIds(body.hidden)
  const pinned = body.pinned === undefined ? undefined : propertyIds(body.pinned)
  if (typeof body.version !== 'string' || !/^\d{1,19}$/.test(body.version) || order === null || hidden === null || pinned === null) {
    return Response.json({ error: 'invalid_layout' }, { status: 400 })
  }

  const applied = await applyRecordLayout(session.ctx, dataSourceId, {
    expectedVersion: body.version,
    order,
    hidden,
    ...(pinned === undefined ? {} : { pinned }),
  })
  if (!applied.ok) return failureResponse(layoutFailureStatus(applied.reason), applied)
  return Response.json({ ok: true, layout: applied.value.layout, changed: applied.value.changed })
}
