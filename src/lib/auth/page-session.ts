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
import { resolveOutsiderContext, type OutsiderContext } from './outsider-context.ts'
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

/** 페이지 화면에 온 사람 — 이 워크스페이스의 사람(`member`)이거나, 요청만 할 수 있는 밖의 사람(`outsider` · 7g-2). */
export type PageVisitor = { readonly member: SessionContext } | { readonly outsider: OutsiderContext }

/**
 * `requirePageSession` 과 같지만 **밖의 사람을 404 로 끝내지 않는다**(7g-2 · 정본 §3.3 [보강] 접근 요청 ⑩) — 로그인했지만 이
 * 워크스페이스의 사람이 아니면(멤버십이 없거나 떠났다) `outsider` 를 준다. 그 사람에게 무엇을 보여 줄지는 부르는 쪽이 정한다 —
 * 페이지 화면만 요청 화면을 그리고, 나머지(레이아웃)는 아무것도 싣지 않는다.
 *
 * 멈춘 사람 · SSO 가 막은 사람은 여전히 404 다. 로그인이 안 됐으면 `/login` 이다.
 */
export async function requirePageVisitor(rawWorkspaceId: string): Promise<PageVisitor> {
  let workspaceId
  try {
    workspaceId = asWorkspaceId(rawWorkspaceId)
  } catch {
    notFound()
  }

  const token = await readSessionToken()
  const session = await resolveSessionContext(token, workspaceId)
  if (session.ok) return { member: session.context }

  if (session.reason === 'no_session' || session.reason === 'expired' || session.reason === 'revoked') {
    redirect('/login')
  }
  if (session.reason === 'not_a_member' || session.reason === 'member_inactive') {
    const outsider = await resolveOutsiderContext(token, workspaceId)
    if (outsider !== null) return { outsider }
  }
  notFound()
}
