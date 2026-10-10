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
 *   → 그 블록이 **지금** 가리키는 파일 하나(이 워크스페이스의 것)
 *
 * 그래서 공개 주소를 알아도 다른 파일 id 를 찍어 읽을 수 없고, 이미지를 본문에서 지우거나 페이지를 닫으면 그 주소도 닫힌다.
 * 이유는 말하지 않는다 — 열 수 없으면 모두 null(404).
 */

import { pageIconOfFormat } from '../block/page-icon.ts'
import { readImageSource } from '../block/image.ts'
import { PAGE_TYPE } from '../block/types.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { fileStorage } from '../file/storage.ts'
import { isUuid } from '../ids.ts'
import { openablePagesIn, resolvePublicPageIn } from './public-access.ts'
import type { AiCrawler, RobotsDirective } from './public-link.ts'

/** 공개 파일의 종류 — 본문의 이미지 블록 · 페이지의 이미지 아이콘. */
export const PUBLIC_FILE_KINDS = ['image', 'icon'] as const
export type PublicFileKind = (typeof PUBLIC_FILE_KINDS)[number]

export function isPublicFileKind(value: string): value is PublicFileKind {
  return (PUBLIC_FILE_KINDS as readonly string[]).includes(value)
}

export type PublicFile = {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly sizeBytes: number
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
      const icon = block.type === PAGE_TYPE ? pageIconOfFormat(block.format) : null
      pageId = block.id
      fileId = icon?.type === 'file' ? icon.file_id : null
    } else {
      const source = block.type === 'image' ? readImageSource(block.properties) : null
      pageId = await ownerPageOf(tx, block.ancestor_path)
      fileId = source?.kind === 'file' ? source.fileId : null
    }
    if (pageId === null || fileId === null) return null
    if (!(await openablePagesIn(tx, root.workspaceId, root.rootId, [pageId])).has(pageId)) return null

    const file = await tx.queryMaybe<{ storage_key: string; mime: string; size_bytes: string }>(
      `SELECT storage_key, mime, size_bytes FROM file WHERE id = $1 AND workspace_id = $2`,
      [fileId, root.workspaceId],
    )
    return file === null ? null : { file, robots: root.robots, aiCrawler: root.aiCrawler }
  })
  if (found === null) return null

  // 바이트는 스냅샷 밖에서 읽는다 — 파일은 id 로 불변이다(내용을 바꾸면 새 파일이다)
  const bytes = await fileStorage().read(found.file.storage_key)
  if (bytes === null) return null
  return { bytes, mime: found.file.mime, sizeBytes: Number(found.file.size_bytes), robots: found.robots, aiCrawler: found.aiCrawler }
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
