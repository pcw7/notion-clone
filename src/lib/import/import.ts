/**
 * 파일 가져오기 — 마크다운 · 평문 파일을 페이지로 (잔여 묶음 8m-1 · F-09-12)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 가져오기 ① ~ ⑤ · 09-api-integrations.md F-09-12
 *
 * 파일 하나가 페이지 하나다. 본문은 `markdown.ts` 가 만든 문서를 **본문 세션**(`openPageBody` — 서버 명령의 본문 쓰기 길 하나 · 복제와 같다)
 * 으로 쓴다.
 *
 *   · 받는 파일 — `.md` · `.markdown` · `.txt`(대소문자 무관). 한 번에 스물까지. UTF-8 이 아니면 거부
 *   · 크기 — 파일마다 요금제의 상한(`import.max_bytes` — Free 5 MiB · 유료 50 MiB)
 *   · 놓을 곳 — 페이지를 주면 그 아래(하위 페이지를 만들 수 있어야 한다), 안 주면 **내 개인 최상위**(게스트는 개인 페이지가 없다 — 페이지를
 *     줘야 한다)
 *   · 제목 — 첫 블록이 `# 제목` 이면 그것, 아니면 파일 이름(확장자를 뺀다)
 *   · **전부이거나 아무것도** — 한 트랜잭션. 파일 하나라도 거부되면 아무 페이지도 남지 않는다(ZIP 의 부분 성공은 8m-2)
 *   · 옮기지 못한 것(표 · HTML · 로컬 이미지 …)은 세어 돌려준다 — 화면이 그렇게 말한다
 */

import type { SessionContext } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { openPageBody } from '../block/body-write.ts'
import { createPageIn, PageError, titleFromPlainText } from '../block/page.ts'
import { withCommandTransaction } from '../db/tx.ts'
import { asBlockId, isUuid } from '../ids.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { wrapUnknownTypes } from '../editor/document.ts'
import { emptyImportLosses, markdownToDoc, textToDoc, type ImportLosses, type MarkdownImport } from './markdown.ts'

export const MAX_IMPORT_FILES = 20

const KINDS = { md: 'markdown', markdown: 'markdown', txt: 'text' } as const
type FileKind = (typeof KINDS)[keyof typeof KINDS]

export type ImportFile = { readonly name: string; readonly bytes: Uint8Array }

export type ImportFailure =
  /** 놓을 곳이 없다 — 없는 · 볼 수 없는 페이지 · 하위 페이지를 만들 수 없다 · 게스트의 개인 최상위. */
  | 'not_found'
  /** 파일이 없다. */
  | 'no_files'
  /** 한 번에 받는 수를 넘었다. */
  | 'too_many_files'
  /** 받지 않는 형식(확장자). */
  | 'unsupported_type'
  /** 요금제의 파일 크기 상한을 넘었다. */
  | 'too_large'
  /** UTF-8 이 아니다. */
  | 'invalid_encoding'
  /** 페이지 깊이 상한. */
  | 'too_deep'

export type ImportedPage = { readonly id: string; readonly title: string; readonly source: string; readonly losses: ImportLosses }

export type ImportResult =
  | { readonly ok: true; readonly value: { readonly pages: readonly ImportedPage[]; readonly losses: ImportLosses } }
  | { readonly ok: false; readonly reason: ImportFailure; readonly file?: string; readonly limit?: number }

export function importKindOf(name: string): FileKind | null {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase()
  return ext !== undefined && Object.hasOwn(KINDS, ext) ? KINDS[ext as keyof typeof KINDS] : null
}

/** 파일 이름에서 제목 — 경로와 확장자를 뺀다. 비면 "가져온 페이지". */
export function titleFromFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const stem = base.replace(/\.[^.]+$/, '').trim()
  return stem === '' ? '가져온 페이지' : stem
}

function addLosses(into: ImportLosses, from: ImportLosses): void {
  for (const key of Object.keys(into) as (keyof ImportLosses)[]) into[key] += from[key]
}

const fail = (reason: ImportFailure, extra: { file?: string; limit?: number } = {}) => ({ ok: false, reason, ...extra }) as const

export async function importFiles(
  ctx: SessionContext,
  files: readonly ImportFile[],
  target: { readonly parentPageId?: string | null } = {},
): Promise<ImportResult> {
  const parentId = target.parentPageId ?? null
  if (parentId !== null && !isUuid(parentId)) return fail('not_found')
  if (files.length === 0) return fail('no_files')
  if (files.length > MAX_IMPORT_FILES) return fail('too_many_files', { limit: MAX_IMPORT_FILES })
  const parsed: { file: ImportFile; result: MarkdownImport }[] = []
  for (const file of files) {
    const kind = importKindOf(file.name)
    if (kind === null) return fail('unsupported_type', { file: file.name })
  }

  return withCommandTransaction(async (tx) => {
    const limit = await entitlement(ctx.workspaceId, 'import.max_bytes', tx)
    for (const file of files) {
      if (limit !== null && file.bytes.byteLength > limit) return fail('too_large', { file: file.name, limit })
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
      } catch {
        return fail('invalid_encoding', { file: file.name })
      }
      parsed.push({ file, result: importKindOf(file.name) === 'markdown' ? markdownToDoc(text) : textToDoc(text) })
    }

    const pages: ImportedPage[] = []
    const losses = emptyImportLosses()
    for (const { file, result } of parsed) {
      const title = result.title ?? titleFromFileName(file.name)
      let page
      try {
        page = await createPageIn(tx, ctx, {
          title: titleFromPlainText(title),
          ...(parentId !== null ? { parentPageId: asBlockId(parentId) } : { privateTop: true }),
        })
      } catch (e) {
        if (e instanceof PageError && (e.code === 'parent_not_found' || e.code === 'not_found')) return fail('not_found')
        if (e instanceof PageError && e.code === 'too_deep') return fail('too_deep')
        throw e
      }
      if (result.doc.blocks.length > 0) {
        const write = await openPageBody(tx, ctx, page.id)
        const next = docToPm(wrapUnknownTypes(result.doc))
        write.change((tr) => {
          tr.replaceWith(0, tr.doc.content.size, next.content)
        })
        const written = await write.finish()
        if (!written.ok) throw new Error(`가져온 본문의 투영이 거부됐다(${written.reason}): ${file.name}`)
      }
      addLosses(losses, result.losses)
      pages.push({ id: page.id, title, source: file.name, losses: result.losses })
    }
    return { ok: true, value: { pages, losses } } as const
  })
}
