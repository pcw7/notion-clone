/**
 * 업로드 한도와 검증 — F-12-09 / F-09-08
 *
 * 정본: 12-platform-ux.md F-12-09, 09-api-integrations.md F-09-08
 *
 * ──────────────────────────────────────────────────────────────────────
 * 한도는 하나가 아니라 **4개 축**이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-12-09 가 "출처 간 상충"으로 보이던 숫자들을 축으로 갈라 정리했다.
 *
 *   ① 저장     — Free 5 MiB / 유료 5 GiB (파일당)
 *   ② 인라인 렌더 — 이미지 5MB · PDF 20MB 수준
 *   ③ 임포트    — Free 5MB / 유료 50MB
 *   ④ 전송 본문 — 500KB 초과 시 413
 *
 * *"5GiB 는 저장 가능한 한도, 5MB/20MB 는 블록으로 렌더해 보여줄 수 있는 한도"* 다.
 * 여기서 거는 것은 ①이고, 값은 **Free 의 5 MiB** 다 — 플랜별 엔타이틀먼트
 * (`plan_entitlement`)가 아직 스키마에 없기 때문이다. 그 표가 들어오면 이 상수 대신
 * `entitlement(workspace_id, 'file.max_bytes')` 를 묻는다(불변식 PE1: `if (plan ===
 * 'business')` 를 코드에 흩뿌리지 않는다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * MVP 는 이미지만이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `00-feature-ownership.md` 13번: F-01-15 를 *"(a) image 업로드만(F-12-09 와 한 묶음).
 * file/bookmark/video/embed 는 Phase 1"* 로 축소했다. 정본이 지원 포맷으로 열거한
 * HEIC·SVG·PDF·MP4 … 는 그래서 아직 받지 않는다.
 *
 * **SVG 는 목록에서 의도적으로 뺐다.** 이미지처럼 보이지만 스크립트를 품을 수 있어서,
 * 같은 출처로 서빙하면 저장형 XSS 가 된다. 넣으려면 sanitize 가 먼저다.
 */

/** 받는 MIME. 브라우저가 보낸 값을 그대로 믿지 않고 이 목록으로 좁힌다. */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type AllowedMime = (typeof ALLOWED_IMAGE_MIME)[number]

/** F-12-09 ① 저장 축, Free 워크스페이스 값. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** F-12-09: "파일명 최대 길이 900 bytes(확장자 포함)". `file` 테이블의 CHECK 과 같은 값이다. */
export const MAX_FILENAME_BYTES = 900

export type UploadRejection =
  /** 0바이트 — 정본 엣지 케이스: "0바이트 파일 업로드 → 400". */
  | 'empty_file'
  | 'too_large'
  | 'unsupported_type'
  | 'name_too_long'

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)
}

/**
 * 업로드를 받을지 판단한다. 받지 않을 이유가 있으면 그 이유를, 없으면 null.
 *
 * 파일명은 **바이트**로 센다(글자 수가 아니라). 한글은 글자당 3바이트라 글자 수로
 * 세면 900자까지 받아들이고 DB 의 CHECK 에서 터진다.
 */
export function validateUpload(input: {
  mime: string
  size: number
  originalName: string | null
}): UploadRejection | null {
  if (!isAllowedMime(input.mime)) return 'unsupported_type'
  if (input.size <= 0) return 'empty_file'
  if (input.size > MAX_UPLOAD_BYTES) return 'too_large'
  if (input.originalName !== null && Buffer.byteLength(input.originalName, 'utf8') > MAX_FILENAME_BYTES) {
    return 'name_too_long'
  }
  return null
}

const EXTENSION: Readonly<Record<AllowedMime, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * 확장자는 **MIME 에서 정한다.** F-09-08: *"content_type 을 근거로 확장자가 자동
 * 보정된다."* 사용자가 준 파일명의 확장자를 그대로 쓰면 `.png` 라고 적힌 실행 파일이
 * 그 이름으로 저장된다.
 */
export function extensionFor(mime: AllowedMime): string {
  return EXTENSION[mime]
}

/**
 * 스토리지 키. **워크스페이스로 접두어를 준다** — 리전·버킷이 갈릴 때 옮기는 단위가
 * 워크스페이스이고, 목록을 보면 어느 워크스페이스 것인지 바로 보인다.
 * 파일 id 가 uuid 라 충돌하지 않으므로 원본 파일명은 키에 넣지 않는다(경로 주입·길이
 * 문제를 아예 없앤다).
 */
export function storageKeyFor(workspaceId: string, fileId: string, mime: AllowedMime): string {
  return `${workspaceId}/${fileId}.${extensionFor(mime)}`
}
