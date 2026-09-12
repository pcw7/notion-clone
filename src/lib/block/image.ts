/**
 * 이미지 블록의 properties 계약 — F-01-15 (P0: image)
 *
 * 정본: 01-block-editor.md F-01-15 "데이터 모델 함의"
 *   `properties.source = {type:'file'|'external', file_id|url}`, `properties.caption`
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 `url` 하나가 아니라 `source` 인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 노션의 파일 오브젝트는 3종이고 그중 둘이 근본적으로 다르다. `external` 은
 * **URL 이 값 자체**이고, `file`(우리가 호스팅) 은 **URL 이 파생값**이다 —
 * 서명 URL 은 만료되므로 렌더 시점에 다시 만들어야 한다(정본 불변식 FS2:
 * 서명 URL 을 저장하지 않는다).
 *
 * 그래서 저장하는 것은 `file_id` 이고, 보여줄 주소는 `imageContentPath()` 가
 * 그때그때 만든다. `properties.url` 에 주소를 넣어두면 R2 로 옮기는 날
 * **저장된 모든 이미지가 한꺼번에 깨진다** — 그 시점에는 고칠 방법이 마이그레이션
 * 밖에 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 외부 URL 은 스킴을 검사한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `external.url` 은 사용자가 친 문자열이 그대로 저장되고, 화면에서는
 * `<img src>` 와 "원본 열기" 링크(`<a href>`)에 동시에 들어간다. `img` 는
 * `javascript:` 를 실행하지 않지만 **`a[href]` 는 실행한다.** 한쪽만 보고
 * 통과시키면 나중에 링크를 붙이는 순간 XSS 가 된다. 그래서 값을 **받을 때**
 * http/https 로 제한한다.
 *
 * 이 검사는 `validateDoc` 이 서버에서도 부른다 — 화면에서만 막으면 API 로
 * 직접 저장하는 경로가 그대로 열려 있다.
 */

import { isUuid } from '../ids.ts'
import { textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'

export const IMAGE_TYPE = 'image' as const

export type ImageSource =
  /** 우리가 호스팅하는 파일. 주소는 파생값이다. */
  | { readonly kind: 'file'; readonly fileId: string }
  /** 외부 URL. 값 자체가 주소다. */
  | { readonly kind: 'external'; readonly url: string }

/** 캡션 최대 길이(평문 기준). rich text 계약의 런 하나 상한과 같은 자릿수로 둔다. */
export const MAX_CAPTION = 2000

/**
 * `<img src>` 와 `<a href>` 양쪽에 넣어도 안전한 스킴인가.
 *
 * 상대 경로도 받지 않는다 — 외부 URL 자리에 `/api/...` 가 들어오면 우리 서버의
 * 아무 엔드포인트나 이미지인 척 호출하게 된다.
 */
export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

/**
 * properties 에서 출처를 읽는다. 모양이 아니면 `null` — **빈 이미지 블록은
 * 정상 상태다**(정본 엣지 케이스: "빈 값 — URL 미입력 상태 → 빈 상태 블록으로
 * 유지, 저장은 됨"). 그래서 `null` 은 오류가 아니다.
 */
export function readImageSource(properties: unknown): ImageSource | null {
  const source = (properties as { source?: unknown } | null | undefined)?.source
  if (typeof source !== 'object' || source === null) return null
  const s = source as { type?: unknown; file_id?: unknown; url?: unknown }

  if (s.type === 'file') {
    return typeof s.file_id === 'string' && isUuid(s.file_id)
      ? { kind: 'file', fileId: s.file_id }
      : null
  }
  if (s.type === 'external') {
    return isSafeImageUrl(s.url) ? { kind: 'external', url: s.url } : null
  }
  return null
}

/** 출처를 정본 모양으로 되돌린다. */
export function sourceToJson(source: ImageSource): Record<string, unknown> {
  return source.kind === 'file'
    ? { type: 'file', file_id: source.fileId }
    : { type: 'external', url: source.url }
}

/**
 * 캡션. 정본(노션 API)에서 caption 은 RichText[] 다.
 *
 * 화면에서는 평문으로만 편집한다 — 원자 노드 안에 또 하나의 편집 영역을 두면
 * 캐럿과 선택이 두 개가 되고, 블록 선택·복붙·되돌리기가 전부 두 벌이 된다.
 * 하지만 **저장 모양은 계약대로** 둔다. 나중에 캡션에 서식을 붙일 때
 * 마이그레이션이 필요 없다.
 */
export function readCaption(properties: unknown): string {
  const caption = (properties as { caption?: unknown } | null | undefined)?.caption
  if (!Array.isArray(caption)) return ''
  return toPlainText(caption as RichTextRun[])
}

export function captionToJson(caption: string): RichTextRun[] {
  const trimmed = caption.slice(0, MAX_CAPTION)
  return trimmed === '' ? [] : [textRun(trimmed)]
}

/**
 * 이미지 블록의 properties 를 만든다.
 *
 * 모르는 키는 그대로 둔다 — F-01-02 가 요구하는 보존이고, 나중에 정렬·크기
 * (`format.block_width`)가 붙어도 이 함수가 지우지 않는다.
 */
export function withImageSource(
  properties: Readonly<Record<string, unknown>> | null | undefined,
  source: ImageSource | null,
  caption?: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(properties ?? {}) }
  if (source === null) delete next.source
  else next.source = sourceToJson(source)
  if (caption !== undefined) {
    const runs = captionToJson(caption)
    if (runs.length === 0) delete next.caption
    else next.caption = runs
  }
  return next
}

/**
 * 우리가 호스팅하는 파일을 보여줄 주소.
 *
 * 세션으로 인증되는 우리 엔드포인트다. 서명 URL 이 아니므로 **저장하지 않는다**
 * (FS2). R2 를 붙이는 날 이 경로는 그대로 두고 라우트가 302 로 넘긴다 —
 * 저장된 문서를 고칠 필요가 없다.
 */
export function imageContentPath(workspaceId: string, fileId: string): string {
  return `/api/workspaces/${workspaceId}/files/${fileId}/content`
}

/** 화면에 넣을 최종 주소. 빈 블록이면 `null`. */
export function imageDisplayUrl(workspaceId: string, source: ImageSource | null): string | null {
  if (source === null) return null
  return source.kind === 'file' ? imageContentPath(workspaceId, source.fileId) : source.url
}

// ── 참조 집계 ─────────────────────────────────────────────────────────

/**
 * 블록 목록이 참조하는 파일 id 와 **횟수**.
 *
 * 횟수여야 한다. 같은 파일을 두 블록이 가리키면 `ref_count` 는 2 여야 하고
 * (정본: "같은 파일을 여러 블록이 참조 → 참조 카운트로 물리 삭제 제어"),
 * 그중 하나만 지웠을 때 남은 하나가 깨지면 안 된다. 집합으로 세면 정확히
 * 그 사고가 난다.
 *
 * 블록 타입을 보지 않고 **properties 의 모양**만 본다. 파일을 가리키는 타입이
 * 늘어나도(file · video · pdf) 같은 `source` 모양을 쓰면 여기가 자동으로 센다.
 */
export function countFileReferences(
  blocks: Iterable<{ readonly properties?: Readonly<Record<string, unknown>> | null }>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const block of blocks) {
    const source = readImageSource(block.properties)
    if (source?.kind !== 'file') continue
    counts.set(source.fileId, (counts.get(source.fileId) ?? 0) + 1)
  }
  return counts
}

/**
 * 이전 참조와 이후 참조의 차이. `ref_count` 에 그대로 더할 값이다.
 *
 * 0 인 항목은 넣지 않는다 — 안 바뀐 파일까지 UPDATE 하면 저장 한 번이 워크스페이스의
 * 모든 이미지 행을 건드린다(§9-Q1 프로젝터 쓰기 증폭).
 */
export function fileReferenceDelta(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): Map<string, number> {
  const delta = new Map<string, number>()
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(id) ?? 0) - (before.get(id) ?? 0)
    if (d !== 0) delta.set(id, d)
  }
  return delta
}

// ── 검증 ──────────────────────────────────────────────────────────────

/**
 * 이미지 블록의 properties 검사.
 *
 * **없는 것과 잘못된 것을 구분한다.** `source` 가 아예 없으면 빈 이미지 블록이고
 * 정상이다(정본 엣지 케이스). 있는데 모양이 아니면 거부한다 — 조용히 무시하면
 * `javascript:` URL 이 저장돼 있다가 나중에 "원본 열기" 링크가 붙는 날 실행된다.
 */
export function validateImageProperties(
  properties: unknown,
  path: string,
): { path: string; message: string }[] {
  const raw = (properties as { source?: unknown; caption?: unknown } | null | undefined) ?? {}
  const issues: { path: string; message: string }[] = []

  if (raw.source !== undefined && raw.source !== null) {
    if (readImageSource(raw) === null) {
      issues.push({
        path: `${path}.source`,
        message:
          "{type:'file', file_id} 또는 {type:'external', url}(http/https) 여야 합니다",
      })
    }
  }

  if (raw.caption !== undefined && !Array.isArray(raw.caption)) {
    issues.push({ path: `${path}.caption`, message: 'RichText 배열이어야 합니다' })
  }

  return issues
}
