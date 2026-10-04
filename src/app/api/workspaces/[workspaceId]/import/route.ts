/**
 * POST /api/workspaces/[workspaceId]/import — 마크다운 · 평문 파일을 페이지로 가져온다 (잔여 묶음 8m-1 · F-09-12)
 *
 * `multipart/form-data` — `files`(여럿) · `parentPageId`(선택 — 없으면 내 개인 최상위). 판정은 `importFiles` 가 한다(전부이거나 아무것도).
 *
 *   not_found                                          404  놓을 곳이 없다(볼 수 없는 · 없는 페이지 · 게스트의 개인 최상위)
 *   no_files · too_many_files · unsupported_type · invalid_encoding  400
 *   too_large                                          413  요금제의 파일 크기 상한(`limit` 바이트)
 *   too_deep                                           409
 *
 * 201 `{ pages: [{ id, title, source }], losses }` — 옮기지 못한 것(표 · HTML · 로컬 이미지 …)의 수를 함께 준다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { importFiles, type ImportFailure } from '@/lib/import/import'

const STATUS: Readonly<Record<ImportFailure, number>> = {
  not_found: 404,
  no_files: 400,
  too_many_files: 400,
  unsupported_type: 400,
  invalid_encoding: 400,
  too_large: 413,
  too_deep: 409,
}

export async function POST(request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/import'>): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'no_files' }, { status: 400 })
  }
  const files = await Promise.all(
    form
      .getAll('files')
      .filter((v): v is File => v instanceof File)
      .map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  )
  const parent = form.get('parentPageId')
  const result = await importFiles(session.ctx, files, { parentPageId: typeof parent === 'string' && parent !== '' ? parent : null })
  if (!result.ok) {
    return Response.json(
      { error: result.reason, ...(result.file ? { file: result.file } : {}), ...(result.limit ? { limit: result.limit } : {}) },
      { status: STATUS[result.reason] },
    )
  }
  return Response.json(
    { pages: result.value.pages.map((p) => ({ id: p.id, title: p.title, source: p.source })), losses: result.value.losses },
    { status: 201 },
  )
}
