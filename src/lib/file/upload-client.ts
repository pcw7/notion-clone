/**
 * 브라우저에서 파일을 올린다 — F-01-15 / F-12-09
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 `fetch` 가 아니라 `XMLHttpRequest` 인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * **`fetch` 는 업로드 진행률을 주지 않는다.** 요청 본문을 스트림으로 보내는
 * 방법(`duplex: 'half'`)이 있지만 진행률 이벤트는 여전히 없고, 지원도 고르지 않다.
 * 진행률은 정본 F-01-15 의 UI 요구사항("드래그 앤 드롭 업로드, 진행률")이고,
 * 5 MiB 를 느린 회선으로 올릴 때 아무 표시가 없으면 사용자는 멈춘 줄 안다.
 *
 * `XMLHttpRequest` 는 낡았지만 `upload.onprogress` 하나 때문에 여기서는 옳은
 * 도구다. 이 파일 밖으로는 XHR 이 새 나가지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 보내기 전에 같은 규칙으로 먼저 거른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 한도는 `limits.ts` 한 곳에 있고 서버와 클라이언트가 같은 함수를 부른다.
 * 클라이언트 검사는 **서버 검사의 대체가 아니라 왕복 절약**이다 — 20 MB 파일을
 * 다 올려놓고 413 을 받으면 사용자는 그 시간을 그냥 버린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 취소 · 다시 해 볼 만한가 (10n-73 · HANDOFF §3.2-306)
 * ──────────────────────────────────────────────────────────────────────
 *
 * `signal` 을 주면 그것이 끊길 때 요청을 끊는다(`cancelled`). 실패에는 **다시 해 볼 만한가**(`retryable`)를 싣는다 — 연결이 끊겼거나
 * 서버가 넘어졌거나(5xx) 기다리라고 했으면(408 · 429) 같은 파일을 다시 보내면 될 수 있다. 크기 · 형식 · 권한 거절은 다시 보내도 같다 —
 * 화면이 "다시 올리기" 를 세우지 않는다.
 */

import { MAX_UPLOAD_BYTES, validateUpload, type UploadRejection } from './limits.ts'

export type UploadOutcome =
  | { readonly ok: true; readonly fileId: string }
  | {
      readonly ok: false
      readonly message: string
      /** 같은 파일을 다시 보내면 될 수 있는 실패(10n-73) — 연결 · 5xx · 408 · 429. 없으면 다시 보내도 같다. */
      readonly retryable?: true
      /** 부르는 쪽이 끊었다(`signal`). */
      readonly cancelled?: true
    }

/** 그 HTTP 상태의 실패가 다시 해 볼 만한가 — 서버가 넘어졌거나(5xx) 기다리라고 했다(408 · 429). 4xx 의 거절은 다시 보내도 같다. */
export function retryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

/** 업로드 엔드포인트. 라우트 경로를 문자열로 흩뿌리지 않는다. */
export function uploadUrl(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/files`
}

const MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)

/** 거부 사유 → 사용자에게 보일 문장. 서버 라우트의 문구와 같은 뜻을 유지한다. */
export const REJECTION_MESSAGE: Readonly<Record<UploadRejection, string>> = {
  empty_file: '빈 파일은 올릴 수 없습니다.',
  unsupported_type: '지금은 PNG · JPEG · GIF · WEBP 이미지만 올릴 수 있습니다.',
  name_too_long: '파일 이름이 너무 깁니다(900바이트).',
  too_large: `파일이 너무 큽니다. ${MB}MB 까지 올릴 수 있습니다.`,
}

/**
 * 서버 응답에서 보여줄 문장을 고른다.
 *
 * 서버가 준 `message` 를 우선 쓴다 — 거부 사유가 늘어났을 때 클라이언트를 고치지
 * 않아도 맞는 말이 나온다. 모양이 아니면 상태 코드로 되돌아간다.
 */
export function failureMessage(status: number, payload: unknown): string {
  const message = (payload as { message?: unknown } | null | undefined)?.message
  if (typeof message === 'string' && message !== '') return message
  if (status === 401 || status === 403) return '이 워크스페이스에 올릴 권한이 없습니다.'
  if (status === 413) return REJECTION_MESSAGE.too_large
  if (status === 415) return REJECTION_MESSAGE.unsupported_type
  return `업로드에 실패했습니다 (${status}).`
}

export type UploadHandlers = {
  /** 0~1. 진행률을 알 수 없는 구간에서는 부르지 않는다. */
  readonly onProgress?: (fraction: number) => void
  /** 끊기면 요청을 끊는다(10n-73 — 올리는 중의 "취소"). */
  readonly signal?: AbortSignal
}

/**
 * 파일 하나를 올리고 `file.id` 를 돌려준다.
 *
 * 실패를 던지지 않고 `{ok:false, message}` 로 돌려준다 — 부르는 쪽이 노드 뷰라
 * 예외를 삼키면 블록이 "올리는 중" 상태에 영원히 남는다. 실패도 값이어야
 * 화면을 되돌릴 수 있다.
 */
export function uploadImageFile(
  workspaceId: string,
  file: File,
  handlers: UploadHandlers = {},
): Promise<UploadOutcome> {
  const rejection = validateUpload({
    mime: file.type,
    size: file.size,
    originalName: file.name === '' ? null : file.name,
  })
  if (rejection !== null) {
    return Promise.resolve({ ok: false, message: REJECTION_MESSAGE[rejection] })
  }

  if (handlers.signal?.aborted === true) return Promise.resolve({ ok: false, message: '업로드를 취소했습니다.', cancelled: true })

  return new Promise((resolve) => {
    const form = new FormData()
    // 필드명은 `file` 이다 (F-09-08).
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', uploadUrl(workspaceId))
    xhr.responseType = 'json'

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        handlers.onProgress?.(event.loaded / event.total)
      }
    })

    xhr.addEventListener('load', () => {
      const payload = xhr.response as { ok?: boolean; file?: { id?: unknown } } | null
      const fileId = payload?.file?.id
      if (xhr.status >= 200 && xhr.status < 300 && typeof fileId === 'string') {
        resolve({ ok: true, fileId })
        return
      }
      resolve({ ok: false, message: failureMessage(xhr.status, payload), ...(retryableStatus(xhr.status) ? { retryable: true as const } : {}) })
    })

    // 네트워크가 끊기거나 사용자가 페이지를 떠난 경우. 둘 다 "실패"로 같다.
    xhr.addEventListener('error', () =>
      resolve({ ok: false, message: '연결에 실패했습니다. 다시 시도해 주세요.', retryable: true }),
    )
    xhr.addEventListener('abort', () => resolve({ ok: false, message: '업로드를 취소했습니다.', cancelled: true }))
    handlers.signal?.addEventListener('abort', () => xhr.abort(), { once: true })

    xhr.send(form)
  })
}
