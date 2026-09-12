/**
 * POST /api/workspaces/[workspaceId]/files — 파일 업로드 (F-12-09 / F-09-08)
 *
 * 정본: 09-api-integrations.md F-09-08 — 전송은 `multipart/form-data` 이고
 * **폼 필드명은 반드시 `file`** 이다. 노션의 3단계(create → send → complete) 중
 * 가운데 단계와 같은 모양으로 맞춰 두면, multi-part 가 필요해질 때 앞뒤 단계만 붙는다.
 *
 * 거부 이유는 그대로 상태 코드가 된다. 특히 **413** 은 정본이 "요청 본문 상한 초과"에
 * 쓰는 코드라 크기 초과에 맞춘다 — 400 으로 뭉뚱그리면 클라이언트가 "다시 올려도
 * 소용없다"를 구분할 수 없다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { uploadFile } from '@/lib/file/file'
import { MAX_UPLOAD_BYTES, type UploadRejection } from '@/lib/file/limits'

const STATUS: Readonly<Record<UploadRejection, number>> = {
  empty_file: 400,
  unsupported_type: 415,
  name_too_long: 400,
  too_large: 413,
}

const MESSAGE: Readonly<Record<UploadRejection, string>> = {
  empty_file: '빈 파일은 올릴 수 없습니다.',
  unsupported_type: '지금은 PNG · JPEG · GIF · WEBP 이미지만 올릴 수 있습니다.',
  name_too_long: '파일 이름이 너무 깁니다(900바이트).',
  too_large: `파일이 너무 큽니다. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 까지 올릴 수 있습니다.`,
}

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/files'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json(
      { error: 'invalid_body', message: 'multipart/form-data 로 보내주세요.' },
      { status: 400 },
    )
  }

  const value = form.get('file')
  if (!(value instanceof File)) {
    return Response.json(
      { error: 'invalid_body', message: '`file` 필드에 파일을 담아주세요.' },
      { status: 400 },
    )
  }

  // 이름이 비어 있으면(클립보드 이미지 등) 없는 것으로 둔다 — 빈 문자열을 저장하면
  // "이름이 있는데 빈 이름"인 상태가 생긴다.
  const originalName = value.name.trim() === '' ? null : value.name

  const result = await uploadFile(session.ctx, {
    bytes: new Uint8Array(await value.arrayBuffer()),
    mime: value.type,
    originalName,
  })

  if (!result.ok) {
    return Response.json(
      { error: result.reason, message: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    )
  }

  return Response.json({
    ok: true,
    file: {
      id: result.file.id,
      mime: result.file.mime,
      size: result.file.sizeBytes,
      name: result.file.originalName,
    },
  })
}
