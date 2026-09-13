/**
 * 익스포트 API 의 HTTP 경계 — 범위 읽기 · 거부 코드 매핑 · 응답 헤더 · 요약 모양 · 스트림 (F-09-14)
 *
 * `database/http.ts` 와 같은 이유로 한 곳에 둔다. 두 라우트(요약 · 내려받기)가 같은 요청을 같은 범위로
 * 읽고, 같은 거부를 같은 상태로 준다 — 한쪽만 다르면 "요약은 통과했는데 내려받기는 거부"가 생긴다.
 *
 *   not_found  → 404   없거나 볼 수 없는 페이지 — 둘을 구분하지 않는다(HANDOFF §3.3-31)
 *   forbidden  → 403   소유자가 아닌 멤버가 워크스페이스 전체를 요청했다. 멤버이므로 존재는 이미 안다
 *   too_large  → 422   요청은 맞는데 동기 다운로드 한 번으로 만들 수 없는 크기다.
 *                      413 은 **요청 본문**이 클 때의 코드라(RFC 9110 §15.5.14) 쓰지 않는다
 *
 * DB 를 모른다.
 */

import type { ExportRejection, PreparedExport } from './download.ts'
import type { ExportReport } from './plan.ts'
import type { ExportScopeInput } from './snapshot.ts'

/**
 * 쿼리의 `root` 가 범위를 정한다 — 있으면 그 페이지 · 데이터베이스, **없으면** 워크스페이스 전체.
 *
 * `?root=` (빈 값)은 워크스페이스가 아니다. 화면이 id 를 빠뜨린 요청이 워크스페이스 전체로 바뀌면
 * 페이지 하나를 누른 사람이 전부를 받는다. 빈 id 는 페이지 범위로 두어 `not_found` 가 되게 한다.
 */
export function exportScopeOf(url: URL): ExportScopeInput {
  const root = url.searchParams.get('root')
  return root === null ? { kind: 'workspace' } : { kind: 'page', rootId: root }
}

export function exportRejectionStatus(reason: ExportRejection): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'too_large':
      return 422
  }
}

/** 요약 응답. 화면이 "무엇이 얼마나 들어가는가"를 내려받기 **전에** 보여준다. */
export type ExportSummaryJson = {
  readonly ok: true
  readonly fileName: string
  readonly counts: ExportReport['counts']
  /** ZIP 크기의 상한(바이트). deflate 로 줄어드는 몫을 세지 않으므로 실제 ZIP 은 이보다 작다. */
  readonly bytesAtMost: number
}

export function exportSummaryJson(prepared: PreparedExport): ExportSummaryJson {
  return {
    ok: true,
    fileName: prepared.fileName,
    counts: prepared.plan.report.counts,
    bytesAtMost: prepared.estimate.bytes,
  }
}

/** `filename=` 에 넣을 수 없는 이름(ASCII 밖 · 따옴표 · 역슬래시)일 때의 이름. 브라우저는 `filename*` 를 먼저 읽는다. */
export const FALLBACK_ZIP_NAME = 'export.zip'

/** RFC 5987 ext-value — attr-char 밖의 글자는 전부 %XX. `encodeURIComponent` 는 `'()*` 를 남긴다. */
function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** 첨부로 내려받게 한다. 한글 제목은 `filename*`(UTF-8)로 싣는다. */
export function contentDisposition(fileName: string): string {
  const plain = /^[ -~]+$/.test(fileName) && !/["\\]/.test(fileName)
  return `attachment; filename="${plain ? fileName : FALLBACK_ZIP_NAME}"; filename*=UTF-8''${encodeExtValue(fileName)}`
}

export function zipResponseHeaders(fileName: string): Record<string, string> {
  return {
    'content-type': 'application/zip',
    'content-disposition': contentDisposition(fileName),
    // 요청한 사람의 권한으로 걸러 만든 산출물이고, 누를 때마다 그 시점으로 다시 만든다.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
}

/**
 * 비동기 제너레이터 → 웹 `ReadableStream`. 라우트 `Response` 의 본문이 된다.
 *
 * - **당겨 쓴다**(`pull`). 받는 쪽이 느리면 제너레이터도 멈춘다 — 첨부를 앞질러 읽어 메모리에 쌓지 않는다
 * - 제너레이터가 던지면 스트림이 **오류로** 끝난다. 닫힘으로 바꾸지 않는다. Next 는 오류 난 본문을
 *   `pipeTo` 의 abort 로 받아 응답 소켓을 끊는다(`next/dist/server/pipe-readable.js` 의 `res.destroy` —
 *   소스로 확인했고 실험하지는 않았다). 닫힘으로 바꾸면 끝 레코드 없는 ZIP 이 정상 종료된 응답이 된다
 */
export function toReadableStream(chunks: AsyncGenerator<Uint8Array, void, undefined>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
  })
}
