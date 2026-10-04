/**
 * 요청의 테마 — 루트 레이아웃이 첫 페인트 전에 `<html data-theme>` 에 싣는다 (잔여 묶음 8h · F-12-03)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 값 표 · 테마 ③
 *
 * 테마는 계정의 설정(`account.theme` — `setting_value`)이다. 서버가 첫 HTML 에 싣기 때문에 화면이 밝게 떴다가 어두워지지 않는다 —
 * 쿠키 · localStorage 에 복제하지 않는다(정본이 둘이 된다). 세션이 없으면(로그인 전) · 값이 없거나 모양이 맞지 않으면 기본(`system`)이다.
 * `system` 을 밝게 · 어둡게로 가르는 것은 CSS 다(`globals.css` 의 `dark` 변형 — 서버는 OS 를 모른다).
 *
 * 판정을 하지 않는다 — 세션의 주인이 자기 계정의 값을 읽을 뿐이다(워크스페이스를 묻지 않는다 · 테마는 모든 워크스페이스에서 같다).
 */

import { queryMaybe } from '../db/pool.ts'
import { hashSessionToken } from '../auth/session-context.ts'
import { DEFAULT_THEME, isTheme, type SettingKey, type Theme } from './registry.ts'

const THEME_KEY: SettingKey = 'account.theme'

/**
 * 세션 토큰의 주인의 테마 — 없거나 만료 · 폐기된 세션이면 기본. 쿠키는 루트 레이아웃이 읽어 넘긴다 — 이 모듈이 `next/headers` 를
 * 부르지 않아야 검사가 부를 수 있다.
 */
export async function themeOfSessionToken(token: string | null | undefined): Promise<Theme> {
  if (!token) return DEFAULT_THEME
  const row = await queryMaybe<{ value: unknown }>(
    `SELECT sv.value
       FROM user_session s
       JOIN setting_value sv ON sv.scope = 'account' AND sv.user_id = s.user_id AND sv.key = $2
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashSessionToken(token), THEME_KEY],
  )
  return row !== null && isTheme(row.value) ? row.value : DEFAULT_THEME
}
