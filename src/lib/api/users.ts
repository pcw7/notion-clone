/**
 * 공개 API 의 사용자 — `GET /v1/users/me` (API-1 · F-09-02)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① ③ — 개인 토큰은 만든 사람으로 움직인다. 그래서 `users/me` 는 봇이 아니라
 *       **그 사람**(노션의 person 사용자 객체 · 2025-09-03 의 모양)이다.
 */

import { queryMaybe } from '../db/pool.ts'
import { v1Fail, v1Ok, type V1Handler } from './v1.ts'

/** 노션의 person 사용자 객체. */
export type NotionPersonUser = {
  readonly object: 'user'
  readonly id: string
  readonly type: 'person'
  readonly name: string | null
  readonly avatar_url: string | null
  readonly person: { readonly email: string | null }
}

/** 한 사람의 person 객체 — 이메일은 대표 주소. 없는(지운) 사람이면 null. */
export async function personUser(userId: string): Promise<NotionPersonUser | null> {
  const row = await queryMaybe<{ id: string; name: string; avatar_url: string | null; email: string | null }>(
    `SELECT u.id, u.name, u.avatar_url, e.email::text AS email
       FROM "user" u
       LEFT JOIN user_email e ON e.id = u.primary_email_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  )
  if (row === null) return null
  return { object: 'user', id: row.id, type: 'person', name: row.name, avatar_url: row.avatar_url, person: { email: row.email } }
}

/** `GET /v1/users/me` — 토큰을 만든 사람. */
export const usersMe: V1Handler = async ({ ctx }) => {
  const user = await personUser(ctx.userId)
  return user === null ? v1Fail(404, 'object_not_found', `Could not find user with ID: ${ctx.userId}.`) : v1Ok(user)
}
