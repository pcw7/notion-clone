/**
 * 파일 업로드 · 조회 — F-12-09 / F-09-08
 *
 * 정본: 00-canonical-data-model.md §3.10 `file`, 09-api-integrations.md F-09-08
 *
 * ──────────────────────────────────────────────────────────────────────
 * 한 번에 올린다 (create → send → complete 가 아니라)
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-09-08 이 적은 노션의 API 는 3단계(세션 생성 → 전송 → 마감)이고 그 상태를 담을
 * `file_upload` 표가 필요하다. **정본 스키마(§3.10)에는 `file` 하나뿐이다.**
 * 그리고 3단계가 필요한 이유는 multi-part 인데, 그건 20 MiB 를 넘는 파일의 이야기고
 * 우리 상한은 5 MiB 다(`limits.ts`). 그래서 요청 하나로 받고, 받은 뒤에 행을 만든다.
 *
 * 20 MiB 를 넘길 수 있게 되는 날(유료 플랜) multi-part 가 필요해지고, 그때 세션 표가
 * 함께 온다. F-09-08 이 그 설계를 이미 적어 뒀다 — *"파트 업로드 자체가 재시도·재개
 * 가능한 잡이어야 한다"*.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 스토리지에 먼저 쓰고 행은 나중에 만든다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 둘 중 하나는 실패할 수 있다. 순서를 뒤집으면 **행은 있는데 바이트가 없는** 파일이
 * 생기고, 그건 화면에서 깨진 이미지로 나타난다. 지금 순서라면 실패했을 때 남는 것은
 * **아무도 가리키지 않는 객체**뿐이고, 그건 `ref_count = 0` GC 가 쓸어간다
 * (정본 불변식 FS1 이 요구하는 그 GC 다 — 아직 없다. §7 부채).
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import {
  isAllowedMime,
  storageKeyFor,
  validateUpload,
  type AllowedMime,
  type UploadRejection,
} from './limits.ts'
import { fileStorage } from './storage.ts'

export type StoredFile = {
  readonly id: string
  readonly workspaceId: string
  readonly storageKey: string
  readonly mime: AllowedMime
  readonly sizeBytes: number
  readonly originalName: string | null
  readonly checksum: string
  readonly refCount: number
}

type FileRow = {
  id: string
  workspace_id: string
  storage_key: string
  mime: string
  size_bytes: string | number
  original_name: string | null
  checksum: string | null
  ref_count: number
}

function toStoredFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    storageKey: row.storage_key,
    mime: row.mime as AllowedMime,
    sizeBytes: Number(row.size_bytes),
    originalName: row.original_name,
    checksum: row.checksum ?? '',
    refCount: row.ref_count,
  }
}

export type UploadResult =
  | { readonly ok: true; readonly file: StoredFile }
  | { readonly ok: false; readonly reason: UploadRejection }

/**
 * 파일을 받아 저장한다.
 *
 * `SessionContext` 를 받는다 — 그것을 갖고 있다는 것이 "이 워크스페이스에 들어올 수
 * 있다"는 증명이다(CLAUDE.md 권한 규칙). 페이지 단위 ACL 은 W6 이라 지금은 다른 쓰기
 * 경로(페이지 생성·본문 저장)와 같은 수준이다.
 */
export async function uploadFile(
  ctx: SessionContext,
  input: { bytes: Uint8Array; mime: string; originalName: string | null },
): Promise<UploadResult> {
  const rejection = validateUpload({
    mime: input.mime,
    size: input.bytes.byteLength,
    originalName: input.originalName,
  })
  if (rejection !== null) return { ok: false, reason: rejection }
  if (!isAllowedMime(input.mime)) return { ok: false, reason: 'unsupported_type' }

  const id = randomUUID()
  const storageKey = storageKeyFor(ctx.workspaceId, id, input.mime)
  // 같은 바이트인지 나중에 확인할 수 있게 남긴다(정본 §3.10 `checksum`).
  const checksum = createHash('sha256').update(input.bytes).digest('hex')

  await fileStorage().put(storageKey, input.bytes)

  const file = await withTransaction(async (tx) => {
    // 리전은 워크스페이스에서 온다 — 불변식 RG1: 엔드포인트를 코드에 박지 않는다.
    const workspace = await tx.queryMaybe<{ region_id: string }>(
      `SELECT region_id FROM workspace WHERE id = $1`,
      [ctx.workspaceId],
    )
    if (workspace === null) return null

    return tx.queryMaybe<FileRow>(
      `INSERT INTO file (id, workspace_id, region_id, storage_key, mime, size_bytes,
                         original_name, checksum, ref_count, uploaded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, now())
       RETURNING id, workspace_id, storage_key, mime, size_bytes, original_name, checksum, ref_count`,
      [
        id,
        ctx.workspaceId,
        workspace.region_id,
        storageKey,
        input.mime,
        input.bytes.byteLength,
        input.originalName,
        checksum,
        ctx.userId,
      ],
    )
  })

  if (file === null) {
    // 방금 쓴 객체는 남겨두지 않는다.
    await fileStorage().remove(storageKey)
    // `SessionContext` 를 갖고 있다는 것이 이 워크스페이스에 들어올 수 있다는 증명이므로
    // 여기 오려면 업로드 도중에 워크스페이스가 사라져야 한다. 거부 사유 중 하나로
    // 둔갑시키지 않는다 — 사용자에게 "지원하지 않는 형식"이라고 말하게 된다.
    throw new Error('업로드 중 워크스페이스가 사라졌습니다')
  }

  return { ok: true, file: toStoredFile(file) }
}

/**
 * 메타데이터. **워크스페이스 밖의 파일은 없는 것과 같다** — 다른 워크스페이스의 id 를
 * 찍어보는 것으로 존재 여부를 알아낼 수 없어야 한다.
 */
export async function getFile(ctx: SessionContext, fileId: string): Promise<StoredFile | null> {
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<FileRow>(
      `SELECT id, workspace_id, storage_key, mime, size_bytes, original_name, checksum, ref_count
         FROM file WHERE id = $1 AND workspace_id = $2`,
      [fileId, ctx.workspaceId],
    )
    return row === null ? null : toStoredFile(row)
  })
}

/**
 * 내용까지.
 *
 * 행은 있는데 객체가 없으면 `null` 이다 — 개발 중 저장 폴더를 지웠거나, 업로드가
 * 중간에 끊긴 흔적이다. 빈 바이트를 돌려주면 화면에는 "깨진 이미지"로만 보이고
 * 원인을 알 수 없다.
 */
export async function readFile(
  ctx: SessionContext,
  fileId: string,
): Promise<{ file: StoredFile; bytes: Uint8Array } | null> {
  const file = await getFile(ctx, fileId)
  if (file === null) return null
  const bytes = await fileStorage().read(file.storageKey)
  return bytes === null ? null : { file, bytes }
}
