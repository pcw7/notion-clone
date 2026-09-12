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
 *
 * ──────────────────────────────────────────────────────────────────────
 * 오류에 `retryable` 을 싣는다 — F-12-16
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본: *"retryable=false 인데 재시도하면 무한 루프가 된다. **retryable 플래그는
 * 선택이 아니라 필수.**"* 저장 큐(`src/lib/sync/`)가 이 값을 보고 "다시 보낼
 * 실패"와 "보내도 소용없는 실패"를 가른다. 상태 코드로 유추하는 길도 있지만,
 * 같은 409 가 충돌(재시도 의미 있음)일 수도 하위 페이지 누락(의미 없음)일 수도
 * 있어서 서버가 말해 주는 편이 정확하다.
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { loadPageBody, savePageBody } from '@/lib/block/save-page-body'
import { MAX_BODY_BYTES, TOO_LARGE_MESSAGE } from '@/lib/sync/outbox'

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

  // 한도는 사후 오류가 아니라 사전 경고다(F-12-16 관찰 ②). 클라이언트도 같은
  // 값으로 먼저 막지만, API 는 직접 불릴 수 있으므로 여기가 마지막 경계다.
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    return Response.json(
      { error: 'too_large', retryable: false, message: TOO_LARGE_MESSAGE },
      { status: 413 },
    )
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const payload = (parsed.body ?? {}) as { doc?: unknown; version?: unknown }

  if (typeof payload.doc !== 'object' || payload.doc === null) {
    return Response.json(
      { error: 'invalid_body', retryable: false, message: 'doc 이 필요합니다' },
      { status: 400 },
    )
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
      return Response.json({ error: 'not_found', retryable: false }, { status: 404 })
    case 'invalid_document':
      return Response.json(
        { error: 'invalid_document', retryable: false, issues: result.issues },
        { status: 400 },
      )
    case 'version_conflict':
      // 409 + 서버의 현재 버전. 클라이언트는 다시 읽어 병합하거나 덮어쓴다.
      // **retryable 은 true 다** — 사람이 결정하면 그 결정으로 다시 보낸다.
      return Response.json(
        { error: 'version_conflict', retryable: true, currentVersion: result.currentVersion },
        { status: 409 },
      )
    case 'page_ref_missing':
      // 같은 409 지만 이쪽은 다시 보내도 같은 답이다.
      return Response.json(
        {
          error: 'page_ref_missing',
          retryable: false,
          missing: result.missing,
          message: '문서에서 하위 페이지가 빠졌습니다. 하위 페이지 삭제는 별도 동작입니다.',
        },
        { status: 409 },
      )
    case 'page_ref_too_deep':
      return Response.json(
        { error: 'page_ref_too_deep', retryable: false, pageId: result.pageId, message: result.message },
        { status: 400 },
      )
  }
}
