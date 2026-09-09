/**
 * POST /api/workspaces — 워크스페이스 생성 (F-02-17)
 */

import { getCurrentUser } from '@/lib/auth/current-user'
import { createWorkspace, normalizeWorkspaceName } from '@/lib/workspace/create'

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const name = normalizeWorkspaceName((body as { name?: unknown })?.name)
  if (name === null) {
    return Response.json({ error: 'invalid_name' }, { status: 400 })
  }

  const created = await createWorkspace({ ownerUserId: user.userId, name })

  return Response.json({ ok: true, workspaceId: created.workspaceId, name: created.name })
}
