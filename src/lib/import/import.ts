/**
 * 파일 가져오기 — 마크다운 · 평문 파일 · ZIP 을 페이지로 (잔여 묶음 8m-1 · 8m-2a · 8m-2b · F-09-12)
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
 *   · ZIP 안의 링크 · 이미지(8m-2b) — 다른 페이지의 `.md` 링크는 멘션, 한 줄짜리 링크 문단이 직속 하위를 가리키면 그 참조 블록(언급되지 않은
 *     하위는 끝에 선다 — 하위마다 참조가 **정확히 하나**), 본문이 이미지로 쓰는 파일은 올린 파일(같은 트랜잭션 · 바이트의 머리로 형식을 가린다 ·
 *     되돌려지면 저장한 객체를 지운다). 쓰이지 않은 파일 · 받지 않는 형식 · 너무 큰 이미지는 건너뛴 것으로 적는다
 *   · 놓을 곳 — 페이지를 주면 그 아래(하위 페이지를 만들 수 있어야 한다), 안 주면 **내 개인 최상위**(게스트는 개인 페이지가 없다)
 *   · 제목 — 첫 블록이 `# 제목` 이면 그것, 아니면 파일 · 폴더 이름(확장자 · 노션 id 접미를 뗀다)
 *   · 옮기지 못한 것(표 · HTML · 로컬 이미지 …)은 세어 돌려준다 — 화면이 그렇게 말한다
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { openPageBody } from '../block/body-write.ts'
import { createPageIn, PageError, titleFromPlainText } from '../block/page.ts'
import type { Tx } from '../db/tx.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { asBlockId, isUuid } from '../ids.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { wrapUnknownTypes, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { collisionKey } from '../export/zip.ts'
import { discardStoredObjects, storeFileIn } from '../file/file.ts'
import { MAX_FILENAME_BYTES, sniffImageMime, validateUpload, type AllowedMime } from '../file/limits.ts'
import { importKindOf, stripNotionId, titleFromFileName } from './kinds.ts'
import { emptyImportLosses, markdownToDoc, textToDoc, type ImportLinks, type ImportLosses, type MarkdownImport } from './markdown.ts'
import { resolveZipHref } from './zip-links.ts'
import { readZip, type ZipEntry, type ZipSkipReason } from './zip-read.ts'
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

export type ImportSkipReason =
  | ZipSkipReason
  | TreeIgnoreReason
  | 'invalid_encoding'
  /** 페이지도 받는 이미지(PNG · JPEG · GIF · WEBP — 바이트로 가린다)도 아니다. */
  | 'unsupported_type'
  /** 이미지가 파일 하나의 상한(`MAX_UPLOAD_BYTES`)을 넘는다. */
  | 'image_too_large'
  /** 받는 이미지지만 어느 본문도 쓰지 않는다. */
  | 'unreferenced'
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

/** UTF-8 로 읽어 문서로 — UTF-8 이 아니면 null. `links` 는 ZIP 안의 상대 주소를 푼다(마크다운만). */
function parseFile(name: string, bytes: Uint8Array, links: ImportLinks | null = null): MarkdownImport | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return importKindOf(name) === 'markdown' ? markdownToDoc(text, links) : textToDoc(text)
}

class PlacementError extends Error {
  readonly reason: 'not_found' | 'too_deep'
  constructor(reason: 'not_found' | 'too_deep') {
    super(reason)
    this.reason = reason
  }
}

/** 페이지 하나를 놓는다(본문 없이). 놓을 곳의 거부는 `PlacementError` 로 — 부르는 쪽이 전부를 되돌린다. */
async function placePage(tx: Tx, ctx: SessionContext, parentId: string | null, title: string, id?: string): Promise<string> {
  try {
    const page = await createPageIn(tx, ctx, {
      title: titleFromPlainText(title),
      ...(id !== undefined ? { id: asBlockId(id) } : {}),
      ...(parentId !== null ? { parentPageId: asBlockId(parentId) } : { privateTop: true }),
    })
    return page.id
  } catch (e) {
    if (e instanceof PageError && (e.code === 'parent_not_found' || e.code === 'not_found')) throw new PlacementError('not_found')
    if (e instanceof PageError && e.code === 'too_deep') throw new PlacementError('too_deep')
    throw e
  }
}

/** 본문을 통째로 쓴다. 참조 블록이 깊이 상한을 넘으면(토글 안의 하위) `PlacementError('too_deep')`. */
async function writeBody(tx: Tx, ctx: SessionContext, pageId: string, doc: EditorDoc, title: string): Promise<void> {
  const write = await openPageBody(tx, ctx, pageId)
  const next = docToPm(wrapUnknownTypes(doc))
  write.change((tr) => {
    tr.replaceWith(0, tr.doc.content.size, next.content)
  })
  const written = await write.finish()
  if (!written.ok && written.reason === 'page_ref_too_deep') throw new PlacementError('too_deep')
  if (!written.ok) throw new Error(`가져온 본문의 투영이 거부됐다(${written.reason}): ${title}`)
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
        const id = await placePage(tx, ctx, parentId, title)
        if (result.doc.blocks.length > 0) await writeBody(tx, ctx, id, result.doc, title)
        addLosses(losses, result.losses)
        pages.push({ id, title, source: file.name, losses: result.losses })
      }
      return { ok: true, value: { pages, losses, skipped: [] } } as const
    }),
  )
}

/** ZIP 안의 파일 하나 — 이미지로 받을 수 있는가(바이트로 가린다), 그리고 본문이 쓰면 그 파일의 id. */
type ZipAsset = {
  readonly entry: ZipEntry
  readonly check: { readonly ok: true; readonly mime: AllowedMime } | { readonly ok: false; readonly reason: 'unsupported_type' | 'image_too_large' }
  fileId: string | null
}

function checkImage(entry: ZipEntry): ZipAsset['check'] {
  const mime = sniffImageMime(entry.bytes)
  if (mime === null) return { ok: false, reason: 'unsupported_type' }
  const rejection = validateUpload({ mime, size: entry.bytes.byteLength, originalName: null })
  if (rejection === null) return { ok: true, mime }
  return { ok: false, reason: rejection === 'too_large' ? 'image_too_large' : 'unsupported_type' }
}

/** 이미지의 원래 이름 — 경로의 마지막 조각. 표의 상한(900 바이트)을 넘으면 이름 없이 둔다. */
function assetName(path: string): string | null {
  const name = path.split('/').pop() ?? ''
  return name !== '' && Buffer.byteLength(name, 'utf8') <= MAX_FILENAME_BYTES ? name : null
}

const pageRef = (id: string): EditorBlock => ({ id, type: 'page', title: [] })

/**
 * ZIP 하나 — 폴더 계층이 페이지 나무가 된다(8m-2a). 항목 하나의 문제는 건너뛰고 적는다(부분 성공).
 *
 * 본문의 링크가 다른 페이지를 가리키므로(8m-2b) 순서가 있다 — ① 모든 페이지의 id 를 먼저 정한다 ② 파일마다 한 번 읽어 링크 · 이미지를 그 id 로
 * 옮긴다 ③ 위에서부터 페이지를 놓는다(하위가 부모 본문 끝에 참조로 선다) ④ 본문이 쓰는 이미지를 저장한다 ⑤ 본문을 통째로 쓴다 — 참조 블록이
 * 가리키는 하위가 이미 있다. 되돌려지면(거부 · 오류) 저장한 객체를 지운다.
 */
export async function importZip(
  ctx: SessionContext,
  zip: ImportFile,
  target: { readonly parentPageId?: string | null } = {},
): Promise<ImportResult> {
  const parentId = target.parentPageId ?? null
  if (parentId !== null && !isUuid(parentId)) return fail('not_found')

  const stored: string[] = []
  try {
    const result = await withCommandTransaction((tx) => placing(() => importZipIn(tx, ctx, zip, parentId, stored)))
    if (!result.ok) await discardStoredObjects(stored)
    return result
  } catch (e) {
    await discardStoredObjects(stored)
    throw e
  }
}

async function importZipIn(tx: Tx, ctx: SessionContext, zip: ImportFile, parentId: string | null, stored: string[]): Promise<ImportResult> {
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

  // ① id 를 먼저 정한다 — 위에서부터(부모가 자식보다 먼저 놓인다).
  const order: { node: TreeNode; id: string; parentId: string | null }[] = []
  const idOf = new Map<TreeNode, string>()
  const pageByKey = new Map<string, string>()
  const assign = (nodes: readonly TreeNode[], parent: string | null): void => {
    for (const node of nodes) {
      const id = randomUUID()
      idOf.set(node, id)
      pageByKey.set(collisionKey(node.key), id)
      order.push({ node, id, parentId: parent })
      assign(node.children, id)
    }
  }
  assign(tree.roots, parentId)

  const assets = new Map<string, ZipAsset>()
  for (const entry of tree.assets) {
    const key = collisionKey(entry.path)
    if (assets.has(key)) skipped.push({ path: entry.path, reason: 'duplicate' })
    else assets.set(key, { entry, check: checkImage(entry), fileId: null })
  }

  // ② 파일마다 한 번 읽는다 — 상대 주소는 그 파일의 폴더에서 출발한다.
  const linksFrom = (from: string, children: ReadonlySet<string>): ImportLinks => ({
    page: (href) => {
      const path = resolveZipHref(from, href)
      const kind = path === null ? null : importKindOf(path)
      if (path === null || (kind !== 'markdown' && kind !== 'text')) return null
      const id = pageByKey.get(collisionKey(path.replace(/\.[^./]+$/, '')))
      return id === undefined ? null : { id, child: children.has(id) }
    },
    image: (href) => {
      const path = resolveZipHref(from, href)
      const asset = path === null ? undefined : assets.get(collisionKey(path))
      if (asset === undefined || !asset.check.ok) return null
      asset.fileId ??= randomUUID()
      return asset.fileId
    },
  })
  const plans = order.map(({ node, id, parentId: parent }) => {
    let parsed: MarkdownImport | null = null
    if (node.file !== null) {
      const children = new Set(node.children.map((c) => idOf.get(c)!))
      parsed = parseFile(node.file.path, node.file.bytes, linksFrom(node.file.path, children))
      if (parsed === null) skipped.push({ path: node.file.path, reason: 'invalid_encoding' })
    }
    const title = parsed?.title ?? (node.file !== null ? titleFromFileName(node.file.path) : stripNotionId(node.name).trim() || '가져온 페이지')
    return { node, id, parentId: parent, title, parsed }
  })
  for (const asset of assets.values()) {
    if (asset.fileId === null) skipped.push({ path: asset.entry.path, reason: asset.check.ok ? 'unreferenced' : asset.check.reason })
  }

  // ③ 위에서부터 놓는다 — 하위는 부모 본문(아직 비었다)의 끝에 참조로 선다.
  for (const plan of plans) await placePage(tx, ctx, plan.parentId, plan.title, plan.id)

  // ④ 본문이 쓰는 이미지 — 같은 트랜잭션의 파일 행(ref_count 는 ⑤ 의 투영이 올린다).
  for (const asset of assets.values()) {
    if (asset.fileId === null || !asset.check.ok) continue
    await storeFileIn(tx, ctx, { id: asset.fileId, bytes: asset.entry.bytes, mime: asset.check.mime, originalName: assetName(asset.entry.path) }, stored)
  }

  // ⑤ 본문 — 본문이 세운 참조 다음에, 언급되지 않은 하위를 ZIP 의 순서로 끝에 둔다(하위마다 참조가 정확히 하나 — 빠지면 투영이 휴지통으로 보낸다).
  const pages: ImportedPage[] = []
  const losses = emptyImportLosses()
  for (const plan of plans) {
    if (plan.parsed !== null && plan.parsed.doc.blocks.length > 0) {
      const placed = new Set(plan.parsed.pageRefs)
      const rest = plan.node.children.map((c) => idOf.get(c)!).filter((id) => !placed.has(id))
      await writeBody(tx, ctx, plan.id, { blocks: [...plan.parsed.doc.blocks, ...rest.map(pageRef)] }, plan.title)
    }
    const pageLosses = plan.parsed?.losses ?? emptyImportLosses()
    addLosses(losses, pageLosses)
    pages.push({ id: plan.id, title: plan.title, source: plan.node.file?.path ?? `${plan.node.key}/`, losses: pageLosses })
  }
  return { ok: true, value: { pages, losses, skipped } }
}
