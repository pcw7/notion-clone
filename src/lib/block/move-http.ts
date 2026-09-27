/**
 * 옮기기 API 의 HTTP 경계 — 목적지 읽기 · 거부 코드 매핑 (F-02-08 · 7c-3 · 7c-7 · 7c-13)
 *
 * 옮기기(`POST …/move`)와 미리보기(`POST …/move/preview`)가 **같은 몸체**를 받고 같은 거부를 돌려준다. 두 라우트에 따로 두면
 * 한쪽만 새 자리를 알게 되고, 그러면 미리보기와 옮기기가 다른 곳을 말한다.
 *
 *   `{ "targetParentId": "<uuid>" | null }` — 페이지 밑 · `null` 이면 워크스페이스 최상위
 *   `{ "targetTeamspaceId": "<uuid>" }`     — 그 teamspace 의 최상위(7c-3)
 *   `{ "targetPrivate": true }`             — 내 개인 최상위(7c-7)
 *   자리 지정을 둘 이상 함께 주면 400
 */

import { asBlockId, isUuid } from '../ids.ts'
import { MoveError, type MoveDestination } from './move-page.ts'

/** MoveError 를 HTTP 로. 존재를 유출하지 않는 쪽으로 고른다. */
export function moveStatusFor(code: MoveError['code']): number {
  switch (code) {
    case 'not_found':
    case 'target_not_found':
      return 404
    // 볼 수는 있는데 옮길 수 없다. 볼 수 없으면 not_found 다(§3.3-31).
    case 'forbidden':
    // 뿌리가 바뀌는 이동에 페이지의 전체 권한이 없다(7c-3).
    case 'needs_full_access':
      return 403
    case 'cycle':
    case 'too_deep':
    // 그 대상 종류가 이 노드에 맞지 않는다 — 데이터베이스를 페이지 밑으로(7c-8).
    case 'invalid_target':
      return 400
  }
}

export function moveErrorResponse(e: MoveError): Response {
  return Response.json({ error: e.code, message: e.message }, { status: moveStatusFor(e.code) })
}

/** 몸체의 목적지. 모양이 틀리면 돌려줄 응답을 준다. */
export function readMoveDestination(
  raw: unknown,
): { readonly ok: true; readonly destination: MoveDestination } | { readonly ok: false; readonly response: Response } {
  const body = (raw ?? {}) as { targetParentId?: unknown; targetTeamspaceId?: unknown; targetPrivate?: unknown }

  let targetParentId = null
  if (body.targetParentId != null) {
    try {
      targetParentId = asBlockId(body.targetParentId)
    } catch {
      // uuid 가 아니면 "그런 대상은 없다"와 구분할 이유가 없다.
      return { ok: false, response: Response.json({ error: 'target_not_found' }, { status: 404 }) }
    }
  }

  let destination: MoveDestination = targetParentId
  if (body.targetTeamspaceId != null) {
    if (targetParentId !== null) {
      return {
        ok: false,
        response: Response.json(
          { error: 'invalid_target', message: '부모 페이지와 teamspace 를 함께 줄 수 없습니다.' },
          { status: 400 },
        ),
      }
    }
    if (typeof body.targetTeamspaceId !== 'string' || !isUuid(body.targetTeamspaceId)) {
      return { ok: false, response: Response.json({ error: 'target_not_found' }, { status: 404 }) }
    }
    destination = { teamspaceId: body.targetTeamspaceId }
  }
  if (body.targetPrivate != null) {
    if (body.targetPrivate !== true) {
      return { ok: false, response: Response.json({ error: 'target_not_found' }, { status: 404 }) }
    }
    if (targetParentId !== null || body.targetTeamspaceId != null) {
      return {
        ok: false,
        response: Response.json({ error: 'invalid_target', message: '자리 지정은 하나만 줄 수 있습니다.' }, { status: 400 }),
      }
    }
    destination = { privateTop: true }
  }
  return { ok: true, destination }
}
