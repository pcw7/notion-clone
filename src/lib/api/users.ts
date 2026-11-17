/**
 * 공개 API 의 사용자 — `GET /v1/users/me` (API-1 · F-09-02) · `GET /v1/users` · `GET /v1/users/{user_id}` (API-5 · F-09-01)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① ③ ⑩ — 개인 토큰은 만든 사람으로 움직인다. 그래서 `users/me` 는 봇이 아니라
 *       **그 사람**(노션의 person 사용자 객체 · 2025-09-03 의 모양)이다.
 *
 * 목록 · 한 사람은 **앱의 멤버 목록**(`listMembers` — 설정의 "멤버" 화면이 읽는 것)과 같은 규칙으로 본다:
 *   · 멤버 목록을 받을 수 없는 사람(게스트 — `canListMembers`)은 자기만 본다(토큰은 멤버 이상만 만들고 게스트로 내려가면 듣지 않으니 실제로는
 *     닿지 않는다 — 같은 판정을 그대로 둔다)
 *   · 목록은 활동 중인 멤버 — 게스트는 빠진다(노션 *"Guests are not included"*) · 멈춘 사람도 빠진다(일하는 사람의 목록이다 — 앱의 사람
 *     고르개와 같다)
 *   · 한 사람은 앱이 이름을 보이는 사람 — 게스트 · 멈춘 사람도 준다(설정 화면이 보인다 · 노션도 게스트는 id 로 읽는다). 나간 사람은 404
 *   · 이메일은 설정 화면이 멤버에게 보이는 그대로 싣는다(`person.email` — 대표 주소)
 *
 * 내보내기 정책의 게이트는 걸지 않는다 — 멤버 목록은 앱에서 정책과 상관없이 보인다(페이지 · 블록의 내용이 아니다).
 */

import { queryMaybe, query } from '../db/pool.ts'
import { canListMembers, listMembers, onlyPeople } from '../workspace/list.ts'
import { invalid } from './pages.ts'
import { v1Fail, v1Ok, type V1Handler } from './v1.ts'
import { API_MAX_PAGE_SIZE, decodeBoundCursor, encodeBoundCursor, invalidPathIdMessage, parseApiId, parsePageSize, shownValue } from './v1-protocol.ts'

/** 노션의 person 사용자 객체. */
export type NotionPersonUser = {
  readonly object: 'user'
  readonly id: string
  readonly type: 'person'
  readonly name: string | null
  readonly avatar_url: string | null
  readonly person: { readonly email: string | null }
}

type PersonRow = { id: string; name: string; avatar_url: string | null; email: string | null }

const PERSON_SELECT = `SELECT u.id, u.name, u.avatar_url, e.email::text AS email
       FROM "user" u
       LEFT JOIN user_email e ON e.id = u.primary_email_id`

const toPerson = (row: PersonRow): NotionPersonUser => ({
  object: 'user',
  id: row.id,
  type: 'person',
  name: row.name,
  avatar_url: row.avatar_url,
  person: { email: row.email },
})

/** 한 사람의 person 객체 — 이메일은 대표 주소. 없는(지운) 사람이면 null. */
export async function personUser(userId: string): Promise<NotionPersonUser | null> {
  const row = await queryMaybe<PersonRow>(`${PERSON_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL`, [userId])
  return row === null ? null : toPerson(row)
}

/** 여러 사람의 person 객체 — 지운 사람은 빠진다. */
async function personUsers(userIds: readonly string[]): Promise<Map<string, NotionPersonUser>> {
  if (userIds.length === 0) return new Map()
  const rows = await query<PersonRow>(`${PERSON_SELECT} WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL`, [[...userIds]])
  return new Map(rows.map((r) => [r.id, toPerson(r)]))
}

const userNotFound = (id: string) => v1Fail(404, 'object_not_found', `Could not find user with ID: ${id}.`)

/** `GET /v1/users/me` — 토큰을 만든 사람. */
export const usersMe: V1Handler = async ({ ctx }) => {
  const user = await personUser(ctx.userId)
  return user === null ? userNotFound(ctx.userId) : v1Ok(user)
}

/** 목록의 커서는 이 목록에 묶인다(다른 목록의 커서는 400). */
const USERS_BINDING = 'users'

/** `GET /v1/users` — 활동 중인 멤버(쪽 나누기). 차례는 앱의 멤버 화면과 같다(들어온 순 → 이름). */
export const listApiUsers: V1Handler = async ({ ctx, request }) => {
  const url = new URL(request.url)
  const pageSize = parsePageSize(url.searchParams.get('page_size'))
  if (pageSize === null) {
    return invalid(`query failed validation: page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(url.searchParams.get('page_size'))}.`)
  }
  const offset = decodeBoundCursor(USERS_BINDING, url.searchParams.get('start_cursor'))
  if (offset === null) {
    return invalid(`query failed validation: start_cursor should be a cursor from a previous response, instead was ${shownValue(url.searchParams.get('start_cursor'))}.`)
  }

  const everyone = await listMembers(ctx.workspaceId)
  const visible = canListMembers(ctx.role) ? everyone : onlyPeople(everyone, [ctx.userId])
  const ids = visible.filter((m) => m.status === 'active' && m.role !== 'guest').map((m) => m.userId)
  const people = await personUsers(ids)
  const all = ids.map((id) => people.get(id)).filter((u): u is NotionPersonUser => u !== undefined)
  const slice = all.slice(offset, offset + pageSize)
  const end = offset + slice.length
  const next = end < all.length ? encodeBoundCursor(USERS_BINDING, end) : null
  return v1Ok({ object: 'list', results: slice, next_cursor: next, has_more: next !== null, type: 'user', user: {} })
}

/** `GET /v1/users/{user_id}` — 앱이 이름을 보이는 이 워크스페이스의 사람(머리말). */
export const retrieveApiUser: V1Handler = async ({ ctx, params }) => {
  const id = parseApiId(params.user_id)
  if (id === null) return invalid(invalidPathIdMessage('user_id', params.user_id))
  const everyone = await listMembers(ctx.workspaceId)
  const visible = canListMembers(ctx.role) ? everyone : onlyPeople(everyone, [ctx.userId])
  const member = visible.find((m) => m.userId === id && (m.status === 'active' || m.status === 'suspended'))
  if (member === undefined) return userNotFound(id)
  const user = await personUser(id)
  return user === null ? userNotFound(id) : v1Ok(user)
}
