/**
 * 공개 주소의 토큰 · 색인 설정의 값 (게시 · 공유 6a-1 · 6a-3 · F-06-08 · F-17-11)
 *
 * 정본: 00-canonical-data-model.md §3.3 `public_link` · 끝 [정정] 웹 게시 ①⑤
 *
 * 게시 명령(`public-link.ts`)과 공개 경로의 판정(`public-access.ts`)이 함께 쓴다 — 둘이 서로를 부르므로(게시 상태가 "위 페이지의 게시로
 * 공개되었는가"를 판정에 묻는다) 둘 다 기대는 값은 여기 둔다.
 */

import { randomBytes } from 'node:crypto'

/** 토큰의 바이트 수 — base64url 로 22자(0084 `ck_public_link_token`). */
const TOKEN_BYTES = 16

/** 공개 주소의 토큰 — 무작위 128비트 · base64url 22자. */
export function newPublicToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** 토큰의 모양 — 0084 의 CHECK 과 같다. 공개 경로가 DB 에 묻기 전에 거른다. */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

export type RobotsDirective = 'index' | 'noindex'
export type AiCrawler = 'allow' | 'deny'

export function isRobotsDirective(value: unknown): value is RobotsDirective {
  return value === 'index' || value === 'noindex'
}
