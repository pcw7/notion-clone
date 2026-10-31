/**
 * 공개 화면의 파일 — 블록이 가리키는 이미지 · 페이지의 이미지 아이콘 (게시 · 공유 6a-2b · F-06-08 · F-17-11)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ⑨
 *
 * 앱의 파일 경로(`/api/workspaces/{ws}/files/{id}/content`)는 **세션**이 판정한다 — 그 워크스페이스의 사람이면 id 로 어떤 파일이든 읽는다.
 * 공개 쪽에는 세션이 없으므로 **파일 id 로 열지 않는다.** 블록 id 로 연다:
 *
 *   토큰 → 루트(`resolvePublicPageIn` — 게시 · 정책 · 만료 · 루트의 사슬)
 *   → 그 블록이 · 이미지 블록이면 그 블록이 든 페이지(가장 가까운 페이지 조상)가 · 아이콘이면 그 페이지 자신이 이 토큰으로 열린다
 *   → 그 블록이 **지금** 가리키는 파일 하나(이 워크스페이스의 것) — 아이콘이 커스텀 이모지면(7c-2a) 그 이모지(살아 있는 것)의 파일
 *
 * 그래서 공개 주소를 알아도 다른 파일 id 를 찍어 읽을 수 없고, 이미지를 본문에서 지우거나 페이지를 닫으면 그 주소도 닫힌다.
 * 이유는 말하지 않는다 — 열 수 없으면 모두 null(404).
 */

import { readTitle } from '../block/page.ts'
import { pageIconOfFormat, readPageIcon } from '../block/page-icon.ts'
import { customEmojiIdOfRun } from '../contracts/rich-text.ts'
import { readImageSource } from '../block/image.ts'
import { FILE_TYPE, readFileSource } from '../block/file-block.ts'
import { PAGE_TYPE } from '../block/types.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { fileStorage } from '../file/storage.ts'
import { isUuid } from '../ids.ts'
import { openablePagesIn, resolvePublicPageIn } from './public-access.ts'
import type { AiCrawler, RobotsDirective } from './public-token.ts'

/** 공개 파일의 종류 — 본문의 이미지 블록 · 페이지의 이미지 아이콘 · 본문의 파일 블록(F-1a — 내려받기로만 연다). */
export const PUBLIC_FILE_KINDS = ['image', 'icon', 'file'] as const
export type PublicFileKind = (typeof PUBLIC_FILE_KINDS)[number]

export function isPublicFileKind(value: string): value is PublicFileKind {
  return (PUBLIC_FILE_KINDS as readonly string[]).includes(value)
}

export type PublicFile = {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly sizeBytes: number
  /** 원본 이름 — 파일 블록(F-1a)의 내려받기 이름. 이미지 · 아이콘 · 이모지는 쓰지 않는다. */
  readonly originalName: string | null
  /** 링크의 색인 설정 — 파일 응답의 `X-Robots-Tag` 가 따른다. */
  readonly robots: RobotsDirective
  readonly aiCrawler: AiCrawler
}

type BlockRow = { id: string; type: string; ancestor_path: string[]; properties: Record<string, unknown> | null; format: Record<string, unknown> | null }

/** 토큰 · 블록 id · 종류로 공개 파일을 연다. 열 수 없으면 null. */
export async function readPublicBlockFile(token: string, blockId: string, kind: PublicFileKind): Promise<PublicFile | null> {
  if (!isUuid(blockId)) return null
  const found = await withReadTransaction(async (tx) => {
    const access = await resolvePublicPageIn(tx, token)
    if (!access.ok) return null
    const root = access.value

    const block = await tx.queryMaybe<BlockRow>(
      `SELECT id, type, ancestor_path, properties, format FROM block WHERE id = $1 AND workspace_id = $2`,
      [blockId, root.workspaceId],
    )
    if (block === null) return null

    let pageId: string | null
    let fileId: string | null
    if (kind === 'icon') {
      // 데이터베이스의 아이콘은 그 칸(`database.icon` · 8c-3b)이다 — 게시된 데이터베이스(6a-2c-2)의 머리
      const icon =
        block.type === PAGE_TYPE
          ? pageIconOfFormat(block.format)
          : block.type === 'database'
            ? readPageIcon((await tx.queryMaybe<{ icon: unknown }>(`SELECT icon FROM database WHERE id = $1`, [block.id]))?.icon ?? null)
            : null
      pageId = block.id
      fileId =
        icon?.type === 'file'
          ? icon.file_id
          : icon?.type === 'custom_emoji'
            ? ((
                await tx.queryMaybe<{ file_id: string }>(
                  `SELECT file_id FROM custom_emoji WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
                  [icon.custom_emoji.id, root.workspaceId],
                )
              )?.file_id ?? null)
            : null
    } else {
      // 본문 블록 — 종류와 블록 타입이 맞아야 한다(image ↔ 이미지 블록 · file ↔ 파일 블록 — F-1a). 어긋나면 없는 것과 같다.
      const source =
        kind === 'image' && block.type === 'image'
          ? readImageSource(block.properties)
          : kind === 'file' && block.type === FILE_TYPE
            ? readFileSource(block.properties)
            : null
      pageId = await ownerPageOf(tx, block.ancestor_path)
      fileId = source?.kind === 'file' ? source.fileId : null
    }
    if (pageId === null || fileId === null) return null
    if (!(await openablePagesIn(tx, root.workspaceId, root.rootId, [pageId])).has(pageId)) return null

    const file = await tx.queryMaybe<{ storage_key: string; mime: string; size_bytes: string; original_name: string | null }>(
      `SELECT storage_key, mime, size_bytes, original_name FROM file WHERE id = $1 AND workspace_id = $2`,
      [fileId, root.workspaceId],
    )
    return file === null ? null : { file, robots: root.robots, aiCrawler: root.aiCrawler }
  })
  if (found === null) return null

  // 바이트는 스냅샷 밖에서 읽는다 — 파일은 id 로 불변이다(내용을 바꾸면 새 파일이다)
  const bytes = await fileStorage().read(found.file.storage_key)
  if (bytes === null) return null
  return { bytes, mime: found.file.mime, sizeBytes: Number(found.file.size_bytes), originalName: found.file.original_name, robots: found.robots, aiCrawler: found.aiCrawler }
}

/**
 * 블록 제목 안의 커스텀 이모지 그림(7c-3c · 정본 §3.4 [보강] 커스텀 이모지 ⑨) — 블록 id 로 연다(이모지 id 로 열지 않는다).
 *
 *   토큰 → 그 블록이 든 페이지(블록이 페이지면 그 자신)가 이 토큰으로 열린다 → **그 블록의 제목 런에 그 이모지가 지금 있다** →
 *   그 이모지가 이 워크스페이스에 살아 있다 → 그 이모지의 파일
 *
 * 그래서 공개 주소를 알아도 다른 이모지를 찍어 읽을 수 없고, 본문에서 지우거나 이모지를 지우면 그 주소도 닫힌다. 열 수 없으면 null.
 */
export async function readPublicEmojiFile(token: string, blockId: string, emojiId: string): Promise<PublicFile | null> {
  if (!isUuid(blockId) || !isUuid(emojiId)) return null
  const wanted = emojiId.toLowerCase()
  const found = await withReadTransaction(async (tx) => {
    const access = await resolvePublicPageIn(tx, token)
    if (!access.ok) return null
    const root = access.value

    const block = await tx.queryMaybe<BlockRow>(
      `SELECT id, type, ancestor_path, properties, format FROM block WHERE id = $1 AND workspace_id = $2`,
      [blockId, root.workspaceId],
    )
    if (block === null) return null
    if (!readTitle(block.properties).some((run) => customEmojiIdOfRun(run)?.toLowerCase() === wanted)) return null
    const pageId = block.type === PAGE_TYPE ? block.id : await ownerPageOf(tx, block.ancestor_path)
    if (pageId === null) return null
    if (!(await openablePagesIn(tx, root.workspaceId, root.rootId, [pageId])).has(pageId)) return null

    const file = await tx.queryMaybe<{ storage_key: string; mime: string; size_bytes: string }>(
      `SELECT f.storage_key, f.mime, f.size_bytes FROM custom_emoji e JOIN file f ON f.id = e.file_id AND f.workspace_id = e.workspace_id
        WHERE e.id = $1 AND e.workspace_id = $2 AND e.deleted_at IS NULL`,
      [wanted, root.workspaceId],
    )
    return file === null ? null : { file, robots: root.robots, aiCrawler: root.aiCrawler }
  })
  if (found === null) return null
  const bytes = await fileStorage().read(found.file.storage_key)
  if (bytes === null) return null
  return { bytes, mime: found.file.mime, sizeBytes: Number(found.file.size_bytes), originalName: null, robots: found.robots, aiCrawler: found.aiCrawler }
}

/** 본문 블록이 든 페이지 — 조상 중 가장 가까운 페이지. */
async function ownerPageOf(tx: Tx, ancestorPath: readonly string[]): Promise<string | null> {
  if (ancestorPath.length === 0) return null
  const rows = await tx.query<{ id: string; type: string }>(`SELECT id, type FROM block WHERE id = ANY($1::uuid[])`, [ancestorPath])
  const typeOf = new Map(rows.map((row) => [row.id, row.type]))
  for (let at = ancestorPath.length - 1; at >= 0; at -= 1) {
    if (typeOf.get(ancestorPath[at]!) === PAGE_TYPE) return ancestorPath[at]!
  }
  return null
}

/** 파일 응답의 `X-Robots-Tag` — 화면의 meta 와 같은 규칙(정본 [보강] 공개 화면 ⑥). */
export function robotsHeaderOf(file: Pick<PublicFile, 'robots' | 'aiCrawler'>): string {
  const base = file.robots === 'index' ? 'all' : 'noindex, nofollow'
  return file.aiCrawler === 'deny' ? `${base}, noai, noimageai` : base
}
