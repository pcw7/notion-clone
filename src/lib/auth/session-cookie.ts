/**
 * 세션 쿠키 — **Next.js 런타임 전용.**
 *
 * next/headers 의 cookies() 는 Next.js 요청 컨텍스트 안에서만 동작한다.
 * 그래서 DB 로직(session.ts)과 분리한다. 합쳐두면 establish-login 같은
 * 순수 서버 로직을 node --test 로 돌릴 수 없다 — 실제로 그렇게 막혔다.
 *
 * Route Handler / Server Component / Server Action 에서만 import 한다.
 */

import { cookies } from 'next/headers'
import type { IssuedSession } from './session.ts'

/** 쿠키 이름. */
export const SESSION_COOKIE = 'nc_session'

export async function setSessionCookie(session: IssuedSession): Promise<void> {
  // Next.js 16 에서 cookies() 는 async 다 (14 이하와 다르다).
  const jar = await cookies()
  jar.set(SESSION_COOKIE, session.token, {
    httpOnly: true, // JS 로 읽을 수 없다. XSS 로 토큰이 새는 경로를 막는다
    sameSite: 'lax', // CSRF 완화. lax 면 외부 사이트의 POST 에 쿠키가 안 실린다
    secure: process.env.NODE_ENV === 'production', // 개발은 http 라 false
    path: '/',
    expires: session.expiresAt,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(SESSION_COOKIE)?.value ?? null
}
