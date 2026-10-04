/**
 * 라우트 진입 게이트 — `SessionContext` 를 얻거나 응답을 돌려준다.
 *
 * 이 로직은 워크스페이스 스코프 API 마다 똑같이 반복된다. 반복 자체는 참을 수
 * 있지만 **거부 코드 매핑을 한 곳에서만 결정해야** 한다:
 *
 *   not_a_member / member_inactive / 없는 워크스페이스  →  **404**
 *   sso_required                                        →  **403**
 *   no_session / expired / revoked                      →  **401**
 *
 * 404 인 이유는 F-02-17 이다: "이 값과 리소스의 workspace_id 가 불일치하면
 * 403 이 아니라 404 로 응답한다 (리소스 존재 자체를 노출하지 않기 위해)."
 * 한 라우트에서 실수로 403 을 주면 그 라우트만 워크스페이스 존재를 유출한다 —
 * 그래서 매핑을 복사하지 않고 여기서 부른다.
 */

import { asWorkspaceId } from '../ids.ts'
import { resolveOutsiderContext, type OutsiderContext } from './outsider-context.ts'
import { readSessionToken } from './session-cookie.ts'
import { resolveSessionContext, type SessionContext } from './session-context.ts'

export type RouteSession =
  | { readonly ok: true; readonly ctx: SessionContext }
  | { readonly ok: false; readonly response: Response }

/**
 * URL 파라미터의 워크스페이스 id 로 세션을 해석한다.
 *
 * uuid 형식이 아니면 존재 여부를 따질 것도 없이 404 다.
 */
export async function requireWorkspaceSession(rawWorkspaceId: string): Promise<RouteSession> {
  let workspaceId
  try {
    workspaceId = asWorkspaceId(rawWorkspaceId)
  } catch {
    return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) }
  }

  const session = await resolveSessionContext(await readSessionToken(), workspaceId)
  if (session.ok) return { ok: true, ctx: session.context }

  if (session.reason === 'not_a_member' || session.reason === 'member_inactive') {
    return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) }
  }
  if (session.reason === 'mfa_required') {
    // 둘째 단계가 남았다 — 로그인 전과 같은 401 이되, 무엇이 남았는지 말한다(화면이 그 단계로 보낸다 · 8i-2a).
    return { ok: false, response: Response.json({ error: 'mfa_required' }, { status: 401 }) }
  }
  if (session.reason === 'sso_required') {
    return { ok: false, response: Response.json({ error: 'sso_required' }, { status: 403 }) }
  }
  return { ok: false, response: Response.json({ error: 'unauthenticated' }, { status: 401 }) }
}

export type RouteVisitor =
  | { readonly ok: true; readonly ctx: SessionContext; readonly outsider?: undefined }
  | { readonly ok: true; readonly ctx?: undefined; readonly outsider: OutsiderContext }
  | { readonly ok: false; readonly response: Response }

/**
 * `requireWorkspaceSession` 과 같지만 **밖의 사람**(로그인했지만 멤버십이 없거나 떠난 사람 · 7g-2)을 404 로 끝내지 않고 `outsider`
 * 로 준다. 그 사람이 할 수 있는 일은 접근 요청 하나다 — 이것을 부르는 라우트는 그 하나여야 한다. 밖의 사람이 아니면 거부 매핑은
 * `requireWorkspaceSession` 그대로다.
 */
export async function requireWorkspaceVisitor(rawWorkspaceId: string): Promise<RouteVisitor> {
  const session = await requireWorkspaceSession(rawWorkspaceId)
  if (session.ok || session.response.status !== 404) return session
  let workspaceId
  try {
    workspaceId = asWorkspaceId(rawWorkspaceId)
  } catch {
    return session
  }
  const outsider = await resolveOutsiderContext(await readSessionToken(), workspaceId)
  return outsider === null ? session : { ok: true, outsider }
}

/** 요청 본문을 JSON 으로 읽는다. 실패하면 400 응답을 돌려준다. */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: Response.json({ error: 'invalid_body' }, { status: 400 }) }
  }
}
