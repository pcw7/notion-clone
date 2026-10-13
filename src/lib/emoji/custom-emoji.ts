/**
 * 커스텀 이모지 — 워크스페이스의 이모지 라이브러리 (인접 제품 7c-1 · F-13-16)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ①~④ · 마이그레이션 0096
 *       13 F-13-16 *"워크스페이스 구성원이 직접 올린 이미지를 유니코드 이모지처럼 사용한다"*
 *
 * 이모지는 이름과 이미지 파일 하나다. 이미지는 먼저 올린 파일(파일 경로 · `uploadFile`)이고, 이모지가 그 파일을 **참조**한다
 * (`file.ref_count` — 페이지 아이콘과 같은 규칙 · 같은 트랜잭션). 지우면 표시만 남기고(`deleted_at`) 참조를 내린다 — 쓰인 곳은 id 로
 * 가리키므로 행이 있어야 "지운 이모지" 라고 그릴 수 있다.
 *
 *   · 누가 — 멤버가 올린다(게스트는 아니다) · 설정 `workspace.emoji_owners_only` 를 켜면 소유자만 · 이름 바꾸기 · 지우기는 올린 사람이나
 *     소유자 · 목록은 워크스페이스의 누구나(게스트 포함 — 쓰인 이모지를 그려야 한다)
 *   · 이름 — 소문자 · 숫자 · 밑줄 · 하이픈 40자(받을 때 소문자로) · 살아 있는 것끼리 하나 · 워크스페이스마다 500개
 *
 * 규칙(이름의 모양 · 크기 · 개수)은 화면도 쓰므로 순수 모듈 `custom-emoji-rules.ts` 에 있다(7c-2b).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { readFile } from '../file/file.ts'
import { ALLOWED_IMAGE_MIME } from '../file/limits.ts'
import { isUuid } from '../ids.ts'
import { MAX_CUSTOM_EMOJI, MAX_EMOJI_BYTES, normalizeEmojiName } from './custom-emoji-rules.ts'

export type CustomEmoji = {
  readonly id: string
  readonly name: string
  readonly fileId: string
  readonly createdBy: string | null
  readonly createdAt: string
  /** 이 사람이 이름을 바꾸고 지울 수 있는가 — 올린 사람이나 소유자. */
  readonly canManage: boolean
}

export type EmojiFailure =
  | 'not_found'
  /** 올릴 수 없다(게스트 · 소유자만 설정) · 바꿀 수 없다(올린 사람 · 소유자가 아니다). */
  | 'forbidden'
  | 'invalid_name'
  /** 살아 있는 이모지가 그 이름을 쓴다. */
  | 'duplicate_name'
  /** 500개를 넘는다. */
  | 'too_many'
  /** 이 워크스페이스의 이미지 파일이 아니다. */
  | 'invalid_file'
  /** 1MB 를 넘는다. */
  | 'too_large'

export type EmojiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: EmojiFailure }

export function emojiFailureStatus(reason: EmojiFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'duplicate_name':
    case 'too_many':
      return 409
    case 'invalid_name':
    case 'invalid_file':
    case 'too_large':
      return 400
  }
}

const fail = (reason: EmojiFailure): { readonly ok: false; readonly reason: EmojiFailure } => ({ ok: false, reason })

type EmojiRow = { id: string; name: string; file_id: string; created_by: string | null; created_at: Date }

const toEmoji = (ctx: SessionContext, r: EmojiRow): CustomEmoji => ({
  id: r.id,
  name: r.name,
  fileId: r.file_id,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  canManage: ctx.role === 'owner' || (r.created_by !== null && r.created_by === ctx.userId),
})

/** 이 워크스페이스의 살아 있는 이모지 — 이름 순. 워크스페이스의 누구나. */
export async function listCustomEmoji(ctx: SessionContext): Promise<CustomEmoji[]> {
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<EmojiRow>(
      `SELECT id, name, file_id, created_by, created_at FROM custom_emoji
        WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [ctx.workspaceId],
    )
    return rows.map((r) => toEmoji(ctx, r))
  })
}

/**
 * 설정의 이모지 절(7c-2b)이 서는가 — 게스트가 아닌 사람. 게스트는 올리지 못하고, 쓰인 이모지를 그리는 데는 목록 라우트로 족하다
 * (정본 [보강] 커스텀 이모지 ⑥). 올릴 수 있는가는 따로 묻는다(`canCreateCustomEmoji` — 소유자만 설정).
 */
export function canSeeEmojiLibrary(role: WorkspaceRole): boolean {
  return role !== 'guest'
}

/** 이 사람이 지금 이모지를 올릴 수 있는가 — 화면이 올리기 대신 안내를 세울지 정한다. 판정은 `createCustomEmoji` 가 다시 한다. */
export async function canCreateCustomEmoji(ctx: SessionContext): Promise<boolean> {
  return withReadTransaction((tx) => canCreateIn(tx, ctx))
}

/** 올릴 수 있는가 — 게스트가 아니고, 소유자만 설정이 켜져 있으면 소유자. */
async function canCreateIn(tx: Tx, ctx: SessionContext): Promise<boolean> {
  if (ctx.role === 'guest') return false
  if (ctx.role === 'owner') return true
  const setting = await tx.queryMaybe<{ value: unknown }>(
    `SELECT value FROM setting_value WHERE scope = 'workspace' AND workspace_id = $1 AND key = 'workspace.emoji_owners_only'`,
    [ctx.workspaceId],
  )
  return setting?.value !== true
}

/** 이 워크스페이스의 이미지 파일이고 크기가 맞는가. */
async function checkFileIn(tx: Tx, ctx: SessionContext, fileId: unknown): Promise<EmojiFailure | null> {
  if (typeof fileId !== 'string' || !isUuid(fileId)) return 'invalid_file'
  const file = await tx.queryMaybe<{ size_bytes: string | null }>(
    `SELECT size_bytes FROM file WHERE id = $1 AND workspace_id = $2 AND mime = ANY($3::text[])`,
    [fileId, ctx.workspaceId, [...ALLOWED_IMAGE_MIME]],
  )
  if (file === null) return 'invalid_file'
  if (file.size_bytes !== null && Number(file.size_bytes) > MAX_EMOJI_BYTES) return 'too_large'
  return null
}

async function nameTakenIn(tx: Tx, workspaceId: string, name: string, except: string | null): Promise<boolean> {
  const row = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM custom_emoji WHERE workspace_id = $1 AND name = $2 AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3)`,
    [workspaceId, name, except],
  )
  return row !== null
}

/** 이모지를 올린다 — 이미지는 먼저 올린 파일. 그 파일의 참조를 하나 올린다. */
export async function createCustomEmoji(
  ctx: SessionContext,
  input: { readonly name: unknown; readonly fileId: unknown },
): Promise<EmojiResult<CustomEmoji>> {
  const name = normalizeEmojiName(input.name)
  if (name === null) return fail('invalid_name')

  return withCommandTransaction(async (tx) => {
    // 워크스페이스로 줄을 세운다 — 개수 · 이름을 읽고 넣는 사이에 다른 요청이 끼지 않게
    await tx.query(`SELECT 1 FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    if (!(await canCreateIn(tx, ctx))) return fail('forbidden')
    const bad = await checkFileIn(tx, ctx, input.fileId)
    if (bad !== null) return fail(bad)
    if (await nameTakenIn(tx, ctx.workspaceId, name, null)) return fail('duplicate_name')
    const count = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM custom_emoji WHERE workspace_id = $1 AND deleted_at IS NULL`,
      [ctx.workspaceId],
    )
    if (count.n >= MAX_CUSTOM_EMOJI) return fail('too_many')

    const row = await tx.queryOne<EmojiRow>(
      `INSERT INTO custom_emoji (id, workspace_id, name, file_id, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, file_id, created_by, created_at`,
      [randomUUID(), ctx.workspaceId, name, input.fileId, ctx.userId],
    )
    await tx.query(`UPDATE file SET ref_count = ref_count + 1 WHERE id = $1 AND workspace_id = $2`, [row.file_id, ctx.workspaceId])
    return { ok: true, value: toEmoji(ctx, row) } as const
  })
}

/** 바꿀 수 있는 이모지를 잡는다 — 없거나 지웠으면 not_found · 올린 사람이나 소유자가 아니면 forbidden. */
async function lockManageableIn(tx: Tx, ctx: SessionContext, id: string): Promise<EmojiRow | EmojiFailure> {
  if (!isUuid(id)) return 'not_found'
  const row = await tx.queryMaybe<EmojiRow>(
    `SELECT id, name, file_id, created_by, created_at FROM custom_emoji
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [id, ctx.workspaceId],
  )
  if (row === null) return 'not_found'
  if (!toEmoji(ctx, row).canManage) return 'forbidden'
  return row
}

/** 이름을 바꾼다 — 쓰인 곳은 id 로 가리키므로 곧바로 따라간다. */
export async function renameCustomEmoji(ctx: SessionContext, id: string, rawName: unknown): Promise<EmojiResult<CustomEmoji>> {
  const name = normalizeEmojiName(rawName)
  if (name === null) return fail('invalid_name')
  return withCommandTransaction(async (tx) => {
    await tx.query(`SELECT 1 FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    const row = await lockManageableIn(tx, ctx, id)
    if (typeof row === 'string') return fail(row)
    if (row.name === name) return { ok: true, value: toEmoji(ctx, row) } as const
    if (await nameTakenIn(tx, ctx.workspaceId, name, id)) return fail('duplicate_name')
    const updated = await tx.queryOne<EmojiRow>(
      `UPDATE custom_emoji SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, name, file_id, created_by, created_at`,
      [id, name],
    )
    return { ok: true, value: toEmoji(ctx, updated) } as const
  })
}

/** 지운다 — 표시만 남기고(쓰인 곳이 이름을 찾는다) 파일 참조를 내린다. */
export async function deleteCustomEmoji(ctx: SessionContext, id: string): Promise<EmojiResult<null>> {
  return withCommandTransaction(async (tx) => {
    const row = await lockManageableIn(tx, ctx, id)
    if (typeof row === 'string') return fail(row)
    await tx.query(`UPDATE custom_emoji SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id])
    await tx.query(`UPDATE file SET ref_count = GREATEST(ref_count - 1, 0) WHERE id = $1 AND workspace_id = $2`, [row.file_id, ctx.workspaceId])
    return { ok: true, value: null } as const
  })
}

/**
 * 이모지의 그림 — 아이콘(7c-2a)이 `<img>` 로 부른다. 워크스페이스의 누구나(목록과 같다). **살아 있는 것만** — 지운 이모지 · 없는 id ·
 * 다른 워크스페이스의 것은 모두 null(404 · 구분하지 않는다) — 화면은 없을 때의 표시로 바꾼다(정본 [보강] 커스텀 이모지 ⑤).
 */
export async function readCustomEmojiImage(
  ctx: SessionContext,
  id: string,
): Promise<{ readonly bytes: Uint8Array; readonly mime: string; readonly sizeBytes: number } | null> {
  if (!isUuid(id)) return null
  const row = await withReadTransaction((tx) =>
    tx.queryMaybe<{ file_id: string }>(
      `SELECT file_id FROM custom_emoji WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, ctx.workspaceId],
    ),
  )
  if (row === null) return null
  const found = await readFile(ctx, row.file_id)
  return found === null ? null : { bytes: found.bytes, mime: found.file.mime, sizeBytes: found.file.sizeBytes }
}

/**
 * 본문 인라인 멘션(7c-3a)이 그릴 이름 — id → `{ name, deleted }`. **지운 것도 이름을 준다**(정본 [보강] 커스텀 이모지 ③ "이름만" · ⑦).
 * 이 워크스페이스에 없는 id 는 null. 권한 필터가 없다 — 목록은 워크스페이스의 누구나 본다(②).
 */
export async function emojiLabelsIn(
  tx: Tx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Record<string, { readonly name: string; readonly deleted: boolean } | null>> {
  const out: Record<string, { readonly name: string; readonly deleted: boolean } | null> = Object.fromEntries(ids.map((id) => [id, null]))
  if (ids.length === 0) return out
  const rows = await tx.query<{ id: string; name: string; deleted: boolean }>(
    `SELECT id, name, deleted_at IS NOT NULL AS deleted FROM custom_emoji WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, ids],
  )
  for (const r of rows) out[r.id] = { name: r.name, deleted: r.deleted }
  return out
}
