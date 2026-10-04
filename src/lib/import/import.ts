/**
 * 파일 가져오기 — 마크다운 · 평문 파일 · ZIP 을 페이지로 (잔여 묶음 8m-1 · 8m-2a · F-09-12)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 가져오기 ① ~ ⑧ · 09-api-integrations.md F-09-12
 *
 * 파일 하나가 페이지 하나다. 본문은 `markdown.ts` 가 만든 문서를 **본문 세션**(`openPageBody` — 서버 명령의 본문 쓰기 길 하나 · 복제와 같다)
 * 으로 쓴다.
 *
 *   · 낱 파일(`importFiles`) — `.md` · `.markdown` · `.txt` · 한 번에 스물 · 파일마다 요금제의 크기(`import.max_bytes`) · UTF-8 · **전부이거나
 *     아무것도**(파일 하나라도 거부되면 아무 페이지도 남지 않는다)
 *   · ZIP(`importZip` · 8m-2a) — ZIP 자체가 요금제의 크기 안 · 풀린 크기의 합은 그 열 배(그리고 500 MiB)까지 · 항목 천 · 페이지 오백. 폴더 계층이
 *     페이지 나무가 된다(`zip-tree.ts`). **부분 성공** — 항목 하나의 문제(안전하지 않은 경로 · 암호 · 깨짐 · 가져올 수 없는 형식 · 같은 이름 ·
 *     UTF-8 아님)는 그것만 건너뛰고 적는다. UTF-8 이 아닌 파일의 자리는 빈 페이지로 남긴다(그 아래 페이지들의 부모다). 구조의 거부(놓을 곳 ·
 *     깊이)는 전부를 되돌린다
 *   · 놓을 곳 — 페이지를 주면 그 아래(하위 페이지를 만들 수 있어야 한다), 안 주면 **내 개인 최상위**(게스트는 개인 페이지가 없다)
 *   · 제목 — 첫 블록이 `# 제목` 이면 그것, 아니면 파일 · 폴더 이름(확장자 · 노션 id 접미를 뗀다)
 *   · 옮기지 못한 것(표 · HTML · 로컬 이미지 …)은 세어 돌려준다 — 화면이 그렇게 말한다
 */

import type { SessionContext } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { openPageBody } from '../block/body-write.ts'
import { createPageIn, PageError, titleFromPlainText } from '../block/page.ts'
import type { Tx } from '../db/tx.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { asBlockId, isUuid } from '../ids.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { wrapUnknownTypes } from '../editor/document.ts'
import { importKindOf, stripNotionId, titleFromFileName } from './kinds.ts'
import { emptyImportLosses, markdownToDoc, textToDoc, type ImportLosses, type MarkdownImport } from './markdown.ts'
import { readZip, type ZipSkipReason } from './zip-read.ts'
import { buildZipTree, countNodes, type TreeIgnoreReason, type TreeNode } from './zip-tree.ts'

export { importKindOf, titleFromFileName } from './kinds.ts'

export const MAX_IMPORT_FILES = 20
/** ZIP 의 항목 수 상한(폴더 포함) — 노션은 1만에서 실패 · 부분 임포트. */
export const MAX_ZIP_ENTRIES = 1000
/** ZIP 한 번에 만드는 페이지 수 상한 — 한 트랜잭션이다. */
export const MAX_ZIP_PAGES = 500
/** 풀린 크기의 합 — ZIP 크기 상한의 이 배수(그리고 절대 상한). 폭탄을 막는다. */
const ZIP_EXPANSION = 10
const ZIP_ABSOLUTE_BYTES = 500 * 1024 * 1024

export type ImportFile = { readonly name: string; readonly bytes: Uint8Array }

export type ImportFailure =
  /** 놓을 곳이 없다 — 없는 · 볼 수 없는 페이지 · 하위 페이지를 만들 수 없다 · 게스트의 개인 최상위. */
  | 'not_found'
  /** 파일이 없다(ZIP 이면 가져올 파일이 하나도 없다). */
  | 'no_files'
  /** 한 번에 받는 수 · ZIP 의 항목 · 페이지 수를 넘었다. */
  | 'too_many_files'
  /** 받지 않는 형식(확장자). */
  | 'unsupported_type'
  /** 요금제의 파일 크기 상한(ZIP 은 ZIP 자체 · 풀린 합)을 넘었다. */
  | 'too_large'
  /** UTF-8 이 아니다(낱 파일). */
  | 'invalid_encoding'
  /** ZIP 으로 읽을 수 없다(ZIP 이 아니다 · ZIP64 · 여러 조각). */
  | 'invalid_zip'
  /** 페이지 깊이 상한. */
  | 'too_deep'

export type ImportSkipReason = ZipSkipReason | TreeIgnoreReason | 'invalid_encoding'
export type ImportSkip = { readonly path: string; readonly reason: ImportSkipReason }

export type ImportedPage = { readonly id: string; readonly title: string; readonly source: string; readonly losses: ImportLosses }

export type ImportResult =
  | {
      readonly ok: true
      readonly value: {
        readonly pages: readonly ImportedPage[]
        readonly losses: ImportLosses
        /** 건너뛴 항목(ZIP 의 부분 성공) — 낱 파일 가져오기는 늘 빈 배열이다(전부이거나 아무것도). */
        readonly skipped: readonly ImportSkip[]
      }
    }
  | { readonly ok: false; readonly reason: ImportFailure; readonly file?: string; readonly limit?: number }

function addLosses(into: ImportLosses, from: ImportLosses): void {
  for (const key of Object.keys(into) as (keyof ImportLosses)[]) into[key] += from[key]
}

const fail = (reason: ImportFailure, extra: { file?: string; limit?: number } = {}) => ({ ok: false, reason, ...extra }) as const

/** UTF-8 로 읽어 문서로 — UTF-8 이 아니면 null. */
function parseFile(name: string, bytes: Uint8Array): MarkdownImport | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return importKindOf(name) === 'markdown' ? markdownToDoc(text) : textToDoc(text)
}

class PlacementError extends Error {
  readonly reason: 'not_found' | 'too_deep'
  constructor(reason: 'not_found' | 'too_deep') {
    super(reason)
    this.reason = reason
  }
}

/** 페이지 하나를 만들고 본문을 쓴다. 놓을 곳의 거부는 `PlacementError` 로 — 부르는 쪽이 전부를 되돌린다. */
async function createImportedPage(
  tx: Tx,
  ctx: SessionContext,
  parentId: string | null,
  title: string,
  parsed: MarkdownImport | null,
): Promise<string> {
  let page
  try {
    page = await createPageIn(tx, ctx, {
      title: titleFromPlainText(title),
      ...(parentId !== null ? { parentPageId: asBlockId(parentId) } : { privateTop: true }),
    })
  } catch (e) {
    if (e instanceof PageError && (e.code === 'parent_not_found' || e.code === 'not_found')) throw new PlacementError('not_found')
    if (e instanceof PageError && e.code === 'too_deep') throw new PlacementError('too_deep')
    throw e
  }
  if (parsed !== null && parsed.doc.blocks.length > 0) {
    const write = await openPageBody(tx, ctx, page.id)
    const next = docToPm(wrapUnknownTypes(parsed.doc))
    write.change((tr) => {
      tr.replaceWith(0, tr.doc.content.size, next.content)
    })
    const written = await write.finish()
    if (!written.ok) throw new Error(`가져온 본문의 투영이 거부됐다(${written.reason}): ${title}`)
  }
  return page.id
}

/** 놓을 곳의 거부를 결과로 — 던지면 `withCommandTransaction` 이 되돌린다. */
async function placing<T extends { readonly ok: boolean }>(run: () => Promise<T>): Promise<T | ReturnType<typeof fail>> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof PlacementError) return fail(e.reason)
    throw e
  }
}

export async function importFiles(
  ctx: SessionContext,
  files: readonly ImportFile[],
  target: { readonly parentPageId?: string | null } = {},
): Promise<ImportResult> {
  const parentId = target.parentPageId ?? null
  if (parentId !== null && !isUuid(parentId)) return fail('not_found')
  if (files.length === 0) return fail('no_files')
  if (files.length > MAX_IMPORT_FILES) return fail('too_many_files', { limit: MAX_IMPORT_FILES })
  for (const file of files) {
    const kind = importKindOf(file.name)
    // ZIP 은 홀로 와야 한다(`importZip`) — 낱 파일 사이에 섞인 ZIP 은 받지 않는다.
    if (kind === null || kind === 'zip') return fail('unsupported_type', { file: file.name })
  }

  return withCommandTransaction((tx) =>
    placing(async () => {
      const limit = await entitlement(ctx.workspaceId, 'import.max_bytes', tx)
      const parsed: { file: ImportFile; result: MarkdownImport }[] = []
      for (const file of files) {
        if (limit !== null && file.bytes.byteLength > limit) return fail('too_large', { file: file.name, limit })
        const result = parseFile(file.name, file.bytes)
        if (result === null) return fail('invalid_encoding', { file: file.name })
        parsed.push({ file, result })
      }
      const pages: ImportedPage[] = []
      const losses = emptyImportLosses()
      for (const { file, result } of parsed) {
        const title = result.title ?? titleFromFileName(file.name)
        const id = await createImportedPage(tx, ctx, parentId, title, result)
        addLosses(losses, result.losses)
        pages.push({ id, title, source: file.name, losses: result.losses })
      }
      return { ok: true, value: { pages, losses, skipped: [] } } as const
    }),
  )
}

/** ZIP 하나 — 폴더 계층이 페이지 나무가 된다(8m-2a). 항목 하나의 문제는 건너뛰고 적는다(부분 성공). */
export async function importZip(
  ctx: SessionContext,
  zip: ImportFile,
  target: { readonly parentPageId?: string | null } = {},
): Promise<ImportResult> {
  const parentId = target.parentPageId ?? null
  if (parentId !== null && !isUuid(parentId)) return fail('not_found')

  return withCommandTransaction((tx) =>
    placing(async () => {
      const limit = await entitlement(ctx.workspaceId, 'import.max_bytes', tx)
      if (limit !== null && zip.bytes.byteLength > limit) return fail('too_large', { file: zip.name, limit })
      const read = readZip(zip.bytes, {
        maxEntries: MAX_ZIP_ENTRIES,
        maxTotalBytes: limit === null ? ZIP_ABSOLUTE_BYTES : Math.min(ZIP_ABSOLUTE_BYTES, limit * ZIP_EXPANSION),
      })
      if (!read.ok) {
        if (read.reason === 'too_many_entries') return fail('too_many_files', { file: zip.name, limit: MAX_ZIP_ENTRIES })
        if (read.reason === 'too_large') return fail('too_large', { file: zip.name, ...(limit === null ? {} : { limit }) })
        return fail('invalid_zip', { file: zip.name })
      }
      const tree = buildZipTree(read.entries)
      const total = countNodes(tree.roots)
      if (total === 0) return fail('no_files', { file: zip.name })
      if (total > MAX_ZIP_PAGES) return fail('too_many_files', { file: zip.name, limit: MAX_ZIP_PAGES })

      const skipped: ImportSkip[] = [...read.skipped, ...tree.ignored]
      const pages: ImportedPage[] = []
      const losses = emptyImportLosses()
      const walk = async (nodes: readonly TreeNode[], parent: string | null): Promise<void> => {
        for (const node of nodes) {
          let parsed: MarkdownImport | null = null
          if (node.file !== null) {
            parsed = parseFile(node.file.path, node.file.bytes)
            if (parsed === null) skipped.push({ path: node.file.path, reason: 'invalid_encoding' })
          }
          const title = parsed?.title ?? (node.file !== null ? titleFromFileName(node.file.path) : stripNotionId(node.name).trim() || '가져온 페이지')
          const id = await createImportedPage(tx, ctx, parent, title, parsed)
          const pageLosses = parsed?.losses ?? emptyImportLosses()
          addLosses(losses, pageLosses)
          pages.push({ id, title, source: node.file?.path ?? `${node.key}/`, losses: pageLosses })
          await walk(node.children, id)
        }
      }
      await walk(tree.roots, parentId)
      return { ok: true, value: { pages, losses, skipped } } as const
    }),
  )
}
