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
import { ACCOUNTS_COOKIE, DEVICE_COOKIE, DEVICE_COOKIE_DAYS, SESSION_COOKIE, SESSION_MAX_LIFETIME_DAYS } from './constants.ts'
import { parseAccountTokens, serializeAccountTokens } from './account-set.ts'
import { isDeviceKey, newDeviceKey } from './device-identity.ts'
import type { IssuedSession } from './session.ts'

export { SESSION_COOKIE }

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

/**
 * 로그인할 이 브라우저의 기기 열쇠(AC-3 · F-14-08) — 쿠키에 모양이 맞는 열쇠가 있으면 그것, 없으면 새로 만든다(쓰는 것은
 * `setDeviceCookie` — 로그인이 성공한 뒤에). 원문은 쿠키에만 있고 DB 에는 해시만 간다(`deviceIdFor`).
 */
export async function deviceKeyForLogin(): Promise<string> {
  const jar = await cookies()
  const value = jar.get(DEVICE_COOKIE)?.value
  return isDeviceKey(value) ? value : newDeviceKey()
}

/** 기기 쿠키를 쓴다 — 로그인마다 수명을 다시 늘린다. 로그아웃은 지우지 않는다(같은 브라우저는 같은 기기다). */
export async function setDeviceCookie(deviceKey: string): Promise<void> {
  const jar = await cookies()
  jar.set(DEVICE_COOKIE, deviceKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(Date.now() + DEVICE_COOKIE_DAYS * 24 * 60 * 60 * 1000),
  })
}

/** 함께 로그인한 다른 계정의 세션들(8j-2) — 모양이 맞는 토큰만 · 겹치면 한 번. */
export async function readAccountTokens(): Promise<string[]> {
  const jar = await cookies()
  return parseAccountTokens(jar.get(ACCOUNTS_COOKIE)?.value)
}

/** 비면 지운다. 만료는 세션의 최대 수명 — 안의 세션이 먼저 끝나면 그 토큰은 "다시 로그인"으로 보인다. */
export async function setAccountTokens(tokens: readonly string[]): Promise<void> {
  const jar = await cookies()
  if (tokens.length === 0) {
    jar.delete(ACCOUNTS_COOKIE)
    return
  }
  jar.set(ACCOUNTS_COOKIE, serializeAccountTokens(tokens), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(Date.now() + SESSION_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
  })
}
