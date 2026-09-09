/**
 * GET  /api/workspaces/[workspaceId]/pages/[pageId]/body — 본문 문서 읽기
 * PUT  /api/workspaces/[workspaceId]/pages/[pageId]/body — 본문 문서 저장
 *
 * Phase 0 은 **페이지 단위 LWW** 다(마스터 문서 §5.1). 그래서 PUT 이다 —
 * PATCH 로 부분 갱신을 받는 척하면 나중에 CRDT 가 들어올 때 계약이 두 개가 된다.
 *
 * `version` 을 함께 주고받는다 [X-6]. 클라이언트가 읽을 때 받은 값을 저장 시
 * `version` 으로 되돌려 보내면 낙관적 잠금이 되고, 그 사이 누가 저장했으면
 * **409** 다 — §5.1 이 CRDT 대체안으로 요구한 "다른 사람이 편집 중" 배너의 근거.
 * 보내지 않으면 그냥 덮어쓴다(순수 LWW).
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { loadPageBody, savePageBody } from '@/lib/block/save-page-body'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/body'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const body = await loadPageBody(session.ctx, pageId)
  if (!body) return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({ ok: true, version: body.version, doc: body.doc })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const payload = (parsed.body ?? {}) as { doc?: unknown; version?: unknown }

  if (typeof payload.doc !== 'object' || payload.doc === null) {
    return Response.json({ error: 'invalid_body', message: 'doc 이 필요합니다' }, { status: 400 })
  }
  // version 은 bigint 라 JSON 에서 문자열로 다룬다. 숫자로 오면 받아준다.
  const expectedVersion =
    typeof payload.version === 'string' ? payload.version
    : typeof payload.version === 'number' ? String(payload.version)
    : undefined

  const result = await savePageBody(
    session.ctx,
    pageId,
    payload.doc as Parameters<typeof savePageBody>[2],
    { expectedVersion },
  )

  if (result.ok) {
    return Response.json({ ok: true, version: result.version, writes: result.writes })
  }

  switch (result.reason) {
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'invalid_document':
      return Response.json({ error: 'invalid_document', issues: result.issues }, { status: 400 })
    case 'version_conflict':
      // 409 + 서버의 현재 버전. 클라이언트는 다시 읽어 병합하거나 덮어쓴다.
      return Response.json(
        { error: 'version_conflict', currentVersion: result.currentVersion },
        { status: 409 },
      )
    case 'page_ref_missing':
      return Response.json(
        {
          error: 'page_ref_missing',
          missing: result.missing,
          message: '문서에서 하위 페이지가 빠졌습니다. 하위 페이지 삭제는 별도 동작입니다.',
        },
        { status: 409 },
      )
    case 'page_ref_nested':
      return Response.json(
        {
          error: 'page_ref_nested',
          nested: result.nested,
          message: '하위 페이지는 아직 본문 블록 안에 넣을 수 없습니다.',
        },
        { status: 400 },
      )
  }
}
