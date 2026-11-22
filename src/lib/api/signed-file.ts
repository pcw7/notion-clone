/**
 * 서명 주소의 응답 — `GET /api/files/{file_id}?expires=…&signature=…` (API-7 · F-09-08)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑪ · 서명은 `file-url.ts`
 *
 * **세션이 없다** — 서명이 권한이다(노션의 서명 주소와 같다 · 주소를 아는 사람은 만료까지 연다). 차례:
 *   1. 서명(상수 시간) — 틀리거나 모양이 아니면 403
 *   2. 만료 — 지났으면 403(공개 API 로 다시 읽어 새 주소를 받는다)
 *   3. 파일 — 행이 없거나 · 지운 워크스페이스의 것이거나 · 바이트가 없으면 404
 * 머리는 앱의 파일 경로와 같다(`serve.ts` — 이미지 · 비디오만 inline · 그 밖은 내려받기 · `nosniff`). 캐시는 만료까지만 `private`.
 * 라우트(`app/api/files/[fileId]/route.ts`)는 이것 한 줄 — 시험이 같은 것을 부른다.
 */

import { readSignedFile } from '../file/file.ts'
import { fileResponseHeaders } from '../file/serve.ts'
import { checkFileSignature, fileUrlKey } from './file-url.ts'

const refused = (status: 403 | 404): Response => new Response(null, { status, headers: { 'cache-control': 'no-store' } })

export async function serveSignedFile(request: Request, fileId: string, now: Date = new Date()): Promise<Response> {
  const query = new URL(request.url).searchParams
  const expires = query.get('expires')
  if (checkFileSignature(fileUrlKey(), fileId, expires, query.get('signature'), now) !== 'ok') return refused(403)

  const found = await readSignedFile(fileId)
  if (found === null) return refused(404)

  const left = Math.max(0, Number(expires) - Math.floor(now.getTime() / 1000))
  return new Response(found.bytes as BodyInit, {
    headers: {
      ...fileResponseHeaders(found.file),
      'content-length': String(found.file.sizeBytes),
      'cache-control': `private, max-age=${left}`,
      // 주소에 서명이 실려 있다 — 이 응답에서 다른 곳으로 가는 요청에 싣지 않는다
      'referrer-policy': 'no-referrer',
    },
  })
}
