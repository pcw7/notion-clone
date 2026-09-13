/**
 * 익스포트 내려받기 준비 — F-09-14 (3b조각)
 *
 * 정본: 09-api-integrations.md F-09-14 · 02-page-workspace.md F-02-22
 *
 * 요약 · 내려받기 두 라우트가 **같은 준비**를 부른다:
 *
 *     범위 권한 → readExportSnapshot → planExport → estimateExport  (→ 내려받기만 exportZipStream)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 흘려보내기 전에 거부한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 추정이 상한을 넘으면 여기서 `too_large` 다. 응답 헤더를 보내기 **전**이라 받는 쪽은 상태 코드로
 * 거부를 안다. 흘려보내다 `zip.ts` 가 한계에서 던지면 이미 200 을 보낸 뒤라 망가진 조각만 남는다 —
 * 그 던짐은 마지막 방어다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 동기 다운로드다 — 잡도 서명 URL 도 없다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-09-14 는 비동기 잡 + 만료되는 다운로드 링크를 적지만 정본에 `export_job` 표가 없고 잡 워커도 없다
 * (마스터 문서: "스케줄러는 하나만"). 요청 하나가 스냅샷을 읽고 그 자리에서 흘려보낸다. 산출물을
 * **저장하지 않으므로** F-02-22 의 "다운로드 링크 유출(zip 에는 권한 필터를 다시 걸 수 없다)"이 생기지
 * 않는다 — 링크는 세션이 인증하는 API 주소이고, 누를 때마다 그 사람의 권한으로 다시 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 워크스페이스 전체는 소유자만 (HANDOFF §3.2-13)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - **무엇을 볼 수 있는가는 역할이 아니라 스냅샷이 거른다.** 소유자가 내보내도 남의 비공개 페이지는
 *     없다(F-09-20: admin 이라도 "모든 것을 본다"가 아니다). 역할이 정하는 것은 "워크스페이스 한 번에"
 *     라는 **묶음**뿐이다
 *   - 그래서 멤버가 잃는 데이터가 없다 — 볼 수 있는 페이지 · 표를 각각 내보낸다. **표 화면에도 버튼을
 *     둔 이유**가 이것이다: 풀페이지 표는 워크스페이스 직속이라 페이지 내보내기로는 닿지 않는다
 *   - 노션의 "Export all workspace content" 도 워크스페이스 관리자의 설정 화면에 있다. 멤버 관리자
 *     (`membership_admin`)는 멤버를 관리하는 역할이지 콘텐츠를 관리하지 않는다
 *   - 잡 큐 · 속도 제한이 없는 동안 워크스페이스 한 번이 가장 무거운 동기 요청이다(블록 20만 · ZIP 4GiB)
 *   - 넓히는 것은 이 함수 한 줄이다. 넓게 열었다가 좁히면 쓰던 사람의 기능을 뺏는다(§3.3-49 와 같은 이유)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { toPlainText } from '../contracts/rich-text.ts'
import { readFile } from '../file/file.ts'
import { streamExportZip } from './archive.ts'
import { toReadableStream } from './http.ts'
import { safeFileName } from './names.ts'
import { estimateExport, planExport, type ExportEstimate, type ExportPlan, type ExportSnapshot } from './plan.ts'
import { readExportSnapshot, type ExportScopeInput } from './snapshot.ts'

/** 제목 없는 페이지 · 표의 이름. 화면의 표시 문구와 같은 글자다. */
export const UNTITLED = '제목 없음'

export type ExportRejection =
  /** 없거나 볼 수 없는 페이지 · 데이터베이스. */
  | 'not_found'
  /** 워크스페이스 전체를 소유자가 아닌 사람이 요청했다. */
  | 'forbidden'
  /** 블록 수 또는 ZIP 추정이 상한을 넘는다. */
  | 'too_large'

export type PreparedExport = {
  readonly plan: ExportPlan
  readonly estimate: ExportEstimate
  /** 내려받을 ZIP 의 이름(`.zip` 포함). */
  readonly fileName: string
}

export type PrepareResult =
  | { readonly ok: true; readonly value: PreparedExport }
  | { readonly ok: false; readonly reason: ExportRejection }

export type PrepareOptions = {
  /** 스냅샷 블록 상한. 없으면 `MAX_EXPORT_BLOCKS`. */
  readonly maxBlocks?: number
  /** ZIP 바이트 상한. 없으면 ZIP 의 한계. */
  readonly maxBytes?: number
}

/**
 * 워크스페이스 전체를 내보낼 수 있는가. 화면은 버튼을 그릴지 정하는 데만 쓴다 — 판정은
 * `prepareExport` 가 다시 한다.
 */
export function canExportWorkspace(ctx: SessionContext): boolean {
  return ctx.role === 'owner'
}

export async function prepareExport(
  ctx: SessionContext,
  scope: ExportScopeInput,
  options: PrepareOptions = {},
): Promise<PrepareResult> {
  // 스냅샷을 읽기 전에 막는다 — 거부될 요청에 워크스페이스 전체를 읽지 않는다.
  if (scope.kind === 'workspace' && !canExportWorkspace(ctx)) return { ok: false, reason: 'forbidden' }

  const snapshot = await readExportSnapshot(
    ctx,
    scope,
    options.maxBlocks === undefined ? {} : { maxBlocks: options.maxBlocks },
  )
  if (!snapshot.ok) return { ok: false, reason: snapshot.reason }

  const plan = planExport(snapshot.value, { untitled: UNTITLED })
  const estimate = estimateExport(plan, options.maxBytes)
  if (!estimate.fits) return { ok: false, reason: 'too_large' }

  return { ok: true, value: { plan, estimate, fileName: zipFileName(snapshot.value) } }
}

/**
 * 준비된 계획을 ZIP 바이트 스트림으로. 첨부 바이트는 흘려보낼 때 **이 세션의 워크스페이스에서** 읽는다
 * (`readFile` — 다른 워크스페이스의 id 는 없는 것과 같다). 파일은 id 로 불변이라 스냅샷 밖에서 읽어도
 * 스냅샷과 어긋나지 않는다.
 */
export function exportZipStream(
  ctx: SessionContext,
  plan: ExportPlan,
  options: { readonly maxBytes?: number } = {},
): ReadableStream<Uint8Array> {
  const readAttachment = async (fileId: string): Promise<Uint8Array | null> => (await readFile(ctx, fileId))?.bytes ?? null
  return toReadableStream(streamExportZip(plan, readAttachment, options))
}

/**
 * 페이지 · 표 범위는 그 제목, 워크스페이스는 날짜(UTC). ZIP 안의 이름과 같은 규칙(`safeFileName`)이라
 * 이모지 · 운영체제가 받지 않는 글자가 빠진다.
 */
function zipFileName(snapshot: ExportSnapshot): string {
  if (snapshot.scope.kind === 'workspace') {
    return `워크스페이스 ${snapshot.exportedAt.toISOString().slice(0, 10)}.zip`
  }
  const root = snapshot.nodes.get(snapshot.scope.rootId)
  const title = root === undefined ? '' : root.kind === 'page' ? toPlainText(root.title) : root.name
  return `${safeFileName(title, UNTITLED)}.zip`
}
