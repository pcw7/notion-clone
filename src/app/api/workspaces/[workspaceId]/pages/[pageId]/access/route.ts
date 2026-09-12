/**
 * 페이지 공유 — GET/POST `/api/workspaces/[workspaceId]/pages/[pageId]/access`
 *
 * 정본: 06-permissions-sharing.md F-06-05 · F-06-01, 00-canonical-data-model.md §3.3
 *
 * ──────────────────────────────────────────────────────────────────────
 * POST 하나에 `action` 을 싣는다 — CRUD 가 아니기 때문이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 공유 패널의 조작은 리소스 하나를 고치는 일이 아니다. **"상속됨 주체를
 * 제거"는 세 번의 쓰기**다 — 상속분을 이 노드로 복사하고, 상속을 끊고,
 * 지목된 주체를 지운다(불변식 P1). 이걸 `DELETE /access/{principal}` 처럼
 * 보이게 만들면 호출자가 "한 행만 지우면 되는 것"으로 오해하고, 그 오해가
 * 정확히 "1명 제거가 전원 상실이 되는" 사고다.
 *
 * 그래서 계약을 동작 이름으로 드러낸다: `grant` · `revoke` · `restrict` · `inherit`.
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  grantAccess,
  listAccess,
  resumeInheriting,
  revokeAccess,
  stopInheriting,
  type AclFailure,
  type PrincipalRef,
} from '@/lib/permissions/acl'
import { effectiveCaps } from '@/lib/permissions/effective'
import { can, LEVELS, type Level } from '@/lib/permissions/levels'
import { listMembers } from '@/lib/workspace/list'
import { withReadTransaction } from '@/lib/db/tx'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/access'>

const STATUS: Readonly<Record<AclFailure, number>> = {
  // 볼 수 없는 페이지는 없는 페이지와 같다 — 403 과 404 를 구분해 주지 않는다.
  not_found: 404,
  forbidden: 403,
  would_orphan: 409,
}

const MESSAGE: Readonly<Record<AclFailure, string>> = {
  not_found: '페이지를 찾을 수 없습니다.',
  forbidden: '이 페이지의 공유 설정을 바꿀 권한이 없습니다.',
  would_orphan:
    '이 페이지를 관리할 수 있는 사람이 아무도 남지 않습니다. 먼저 다른 사람에게 전체 권한을 주세요.',
}

/** 화면이 보내온 주체를 우리 타입으로. 모양이 아니면 null. */
function readPrincipal(raw: unknown): PrincipalRef | null {
  const value = raw as { type?: unknown; id?: unknown } | null | undefined
  if (value?.type === 'workspace_everyone') return { type: 'workspace_everyone' }
  if (value?.type === 'user' && typeof value.id === 'string') {
    try {
      return { type: 'user', id: asBlockId(value.id) }
    } catch {
      return null
    }
  }
  return null
}

function readLevel(raw: unknown): Level | null {
  return typeof raw === 'string' && (LEVELS as readonly string[]).includes(raw)
    ? (raw as Level)
    : null
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const access = await listAccess(session.ctx, pageId)
  if (!access.ok) {
    return Response.json({ error: access.reason, message: MESSAGE[access.reason] }, { status: STATUS[access.reason] })
  }

  const caps = await withReadTransaction((tx) => effectiveCaps(tx, session.ctx, pageId))
  // 사람 이름은 ACL 에 없다. 목록을 함께 보내 화면이 id 를 이름으로 바꾸게 한다.
  // (권한이 없는 사람에게는 애초에 이 응답이 가지 않는다 — 위에서 걸렀다.)
  const members = await listMembers(workspaceId)

  return Response.json({
    ok: true,
    canManage: can(caps, 'manage_perm'),
    entries: access.value,
    members: members
      .filter((m) => m.status !== 'removed')
      .map((m) => ({ userId: m.userId, name: m.name, email: m.email })),
  })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { action?: unknown; principal?: unknown; level?: unknown }

  const fail = (reason: AclFailure): Response =>
    Response.json({ error: reason, message: MESSAGE[reason] }, { status: STATUS[reason] })

  switch (body.action) {
    case 'grant': {
      const principal = readPrincipal(body.principal)
      const level = readLevel(body.level)
      if (principal === null || level === null) {
        return Response.json({ error: 'invalid_body', message: '주체와 레벨이 필요합니다.' }, { status: 400 })
      }
      const result = await grantAccess(session.ctx, pageId, principal, level)
      return result.ok ? Response.json({ ok: true }) : fail(result.reason)
    }

    case 'revoke': {
      const principal = readPrincipal(body.principal)
      if (principal === null) {
        return Response.json({ error: 'invalid_body', message: '주체가 필요합니다.' }, { status: 400 })
      }
      const result = await revokeAccess(session.ctx, pageId, principal)
      return result.ok ? Response.json({ ok: true }) : fail(result.reason)
    }

    // 상속을 끊는다. **끊기 전에 상속분을 이 노드로 복사한다**(P1) — 그 일을
    // 하는 곳이 `stopInheriting` 하나뿐이어야 한다.
    case 'restrict': {
      const result = await stopInheriting(session.ctx, pageId)
      return result.ok ? Response.json({ ok: true }) : fail(result.reason)
    }

    case 'inherit': {
      const result = await resumeInheriting(session.ctx, pageId)
      return result.ok ? Response.json({ ok: true }) : fail(result.reason)
    }

    default:
      return Response.json(
        { error: 'invalid_body', message: 'action 은 grant · revoke · restrict · inherit 중 하나입니다.' },
        { status: 400 },
      )
  }
}
