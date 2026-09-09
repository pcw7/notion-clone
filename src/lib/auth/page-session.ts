/**
 * 서버 컴포넌트용 진입 게이트.
 *
 * `route-session.ts` 와 결정은 같고 표현만 다르다 —
 * API 는 상태 코드를, 화면은 `redirect()` / `notFound()` 를 쓴다.
 *
 *   로그인 안 됨 / 만료 / 폐기  →  `/login` 으로 보낸다
 *   그 외 전부                  →  `notFound()`
 *
 * "멤버가 아님"을 404 로 만드는 이유는 API 와 같다(F-02-17). 화면에서
 * "권한이 없습니다"를 보여주면 그 워크스페이스가 존재한다는 사실이 유출된다.
 *
 * ⚠ `redirect()`·`notFound()` 는 예외를 던져 흐름을 끊는다. 그래서 이 함수는
 * 정상 반환하면 **반드시** `SessionContext` 를 준다 — 호출자가 null 검사를
 * 빼먹어도 안전하다.
 */

import { notFound, redirect } from 'next/navigation'

import { asWorkspaceId } from '../ids.ts'
import { readSessionToken } from './session-cookie.ts'
import { resolveSessionContext, type SessionContext } from './session-context.ts'

export async function requirePageSession(rawWorkspaceId: string): Promise<SessionContext> {
  let workspaceId
  try {
    workspaceId = asWorkspaceId(rawWorkspaceId)
  } catch {
    notFound()
  }

  const session = await resolveSessionContext(await readSessionToken(), workspaceId)
  if (session.ok) return session.context

  if (
    session.reason === 'no_session' ||
    session.reason === 'expired' ||
    session.reason === 'revoked'
  ) {
    redirect('/login')
  }

  // not_a_member / member_inactive / sso_required
  notFound()
}
