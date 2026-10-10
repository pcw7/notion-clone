/**
 * /api/workspaces/[workspaceId]/databases/[databaseId]/access-rules — 행 단위 접근 규칙 (게시 · 공유 6f-2a · F-06-10)
 *
 *   GET    — 이 데이터베이스의 규칙(볼 수 있으면) `{ rules: [{ id, dataSourceId, source, propertyId, level }] }`
 *   PUT    — `{ dataSourceId, source: 'created_by', level }` — 둔다(이미 있으면 레벨만 바꾼다) · `manage_perm`
 *   DELETE — `{ dataSourceId, source: 'created_by' }` — 지운다(없어도 성공) · `manage_perm`
 *
 * 거부: 못 보면 404 `not_found` · 관리하지 못하면 403 `forbidden` · 페이지 레벨 넷이 아니면 400 `invalid_level` · 사람 속성은 아직
 * 400 `unsupported_source`(사람 속성 타입이 생길 때 — F-03-07) · 몸체 모양이 틀리면 400 `invalid_input`.
 *
 * 판정은 `permissions/effective.ts` 의 `accessRuleEntries` 가 한다(정본 §3.3 끝 [보강] 행 단위 접근 규칙 ①).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  listAccessRules,
  removeAccessRule,
  setAccessRule,
  type AccessRuleFailure,
} from '@/lib/permissions/access-rule'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/access-rules'>

const STATUS: Record<AccessRuleFailure, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_level: 400,
  unsupported_source: 400,
}

const fail = (reason: AccessRuleFailure) => Response.json({ ok: false, error: reason }, { status: STATUS[reason] })
const invalidInput = () => Response.json({ ok: false, error: 'invalid_input' }, { status: 400 })

/** 몸체의 문자열 칸들 — 하나라도 문자열이 아니면 null. */
function strings<K extends string>(body: unknown, keys: readonly K[]): Record<K, string> | null {
  if (typeof body !== 'object' || body === null) return null
  const out = {} as Record<K, string>
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key]
    if (typeof value !== 'string') return null
    out[key] = value
  }
  return out
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await listAccessRules(session.ctx, databaseId)
  return result.ok ? Response.json({ ok: true, rules: result.value }) : fail(result.reason)
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const input = strings(parsed.body, ['dataSourceId', 'source', 'level'] as const)
  if (input === null) return invalidInput()
  const result = await setAccessRule(session.ctx, databaseId, input)
  return result.ok ? Response.json({ ok: true, rule: result.value }) : fail(result.reason)
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const input = strings(parsed.body, ['dataSourceId', 'source'] as const)
  if (input === null) return invalidInput()
  const result = await removeAccessRule(session.ctx, databaseId, input)
  return result.ok ? Response.json({ ok: true }) : fail(result.reason)
}
