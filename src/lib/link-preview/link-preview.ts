/**
 * 북마크의 메타 — 가져오기 · 캐시 (32번 트랙 F-4a · 정본 §3.4 [보강 F-4])
 *
 * 같은 주소의 메타는 워크스페이스를 넘는 공개 정보라 전역 캐시(`link_preview` · 0122) 하나에 둔다. 열쇠는 정규화한 주소(해시를 뗀 `href`)의
 * sha256. 가져오는 길은 `getHtml` 하나다(SSRF 방어 · 리다이렉트 hop 마다 다시 검사 · `net/outbound.ts`).
 *
 *   · 살아 있는 캐시가 있으면 그것 — 가져오지 않는다(ok 7일 · failed 1일 · skipped 30일).
 *   · http 주소는 가져오지 않는다(`skipped` — 바깥 요청은 https 만) · 막힌 모양(사설 · 안쪽 이름 · 포트 · 사용자 정보)은 `failed`.
 *   · 실제로 가져올 때만 사람마다 속도 제한(분에 30 — 넘으면 캐시 없이 `rate_limited`) · 같은 주소의 동시 요청은 프로세스 안에서 하나.
 *
 * 묻는 사람의 권한은 보지 않는다 — 주소는 그 사람이 블록에 적은(적을) 것이고, 메타는 바깥의 공개 정보다. `SessionContext` 는 속도 제한의 열쇠다.
 */

import { createHash } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { bookmarkCacheUrl } from '../block/bookmark-block.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { checkOutboundUrl, getHtml, type HtmlResult } from '../net/outbound.ts'
import { consume, type RateLimitRule } from '../rate-limit.ts'
import { parsePreview } from './parse.ts'

export type LinkPreviewStatus = 'ok' | 'failed' | 'skipped'

export type LinkPreview = {
  readonly status: LinkPreviewStatus
  readonly title: string | null
  readonly description: string | null
  readonly imageUrl: string | null
  readonly siteName: string | null
}

/** 살아 있는 기간(초) — 가져온 것 7일 · 못 가져온 것 1일(음성 캐시) · 건너뛴 것 30일(http 는 바뀌지 않는다). */
export const LINK_PREVIEW_TTL_SECONDS: Readonly<Record<LinkPreviewStatus, number>> = { ok: 7 * 86400, failed: 86400, skipped: 30 * 86400 }

/** 실제로 가져올 때만 거는 속도 제한 — 사람마다 분에 30. */
export const LINK_PREVIEW_RATE: RateLimitRule = { limit: 30, windowSeconds: 60 }

const EMPTY = { title: null, description: null, imageUrl: null, siteName: null } as const

/** 캐시의 열쇠가 되는 주소 — 북마크로 받는 주소가 아니면 null · 해시(`#…`)는 뗀다(같은 문서다). */
export function normalizePreviewUrl(url: string): string | null {
  // 화면(편집기 · 공개)도 같은 열쇠로 찾는다 — 순수 모듈의 것 하나(F-4b)
  return bookmarkCacheUrl(url)
}

export function previewKey(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex')
}

type Row = { status: LinkPreviewStatus; title: string | null; description: string | null; image_url: string | null; site_name: string | null }

const toPreview = (row: Row): LinkPreview => ({
  status: row.status,
  title: row.title,
  description: row.description,
  imageUrl: row.image_url,
  siteName: row.site_name,
})

/** 살아 있는 캐시만 읽는다(가져오지 않는다) — 공개 화면 · 내보내기(F-4b)가 쓴다. 키는 정규화한 주소. */
export async function readLinkPreviews(urls: readonly string[], now: Date = new Date()): Promise<Map<string, LinkPreview>> {
  const wanted = new Map<string, string>()
  for (const url of urls) {
    const normalized = normalizePreviewUrl(url)
    if (normalized !== null) wanted.set(previewKey(normalized), normalized)
  }
  if (wanted.size === 0) return new Map()
  const rows = await withReadTransaction((tx) =>
    tx.query<Row & { url_hash: string }>(
      `SELECT url_hash, status, title, description, image_url, site_name FROM link_preview WHERE url_hash = ANY($1::text[]) AND expires_at > $2`,
      [[...wanted.keys()], now],
    ),
  )
  return new Map(rows.map((row) => [wanted.get(row.url_hash) as string, toPreview(row)]))
}

async function store(normalized: string, preview: LinkPreview, now: Date): Promise<void> {
  const expires = new Date(now.getTime() + LINK_PREVIEW_TTL_SECONDS[preview.status] * 1000)
  await withTransaction((tx) =>
    tx.query(
      `INSERT INTO link_preview (url_hash, url, status, title, description, image_url, site_name, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (url_hash) DO UPDATE SET url = EXCLUDED.url, status = EXCLUDED.status, title = EXCLUDED.title,
         description = EXCLUDED.description, image_url = EXCLUDED.image_url, site_name = EXCLUDED.site_name,
         fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
      [previewKey(normalized), normalized, preview.status, preview.title, preview.description, preview.imageUrl, preview.siteName, now, expires],
    ),
  )
}

export type EnsureOptions = {
  /** 가져오는 함수를 바꿔 끼운다(검사만) — 기본은 `getHtml`. */
  readonly fetcher?: (url: string) => Promise<HtmlResult>
  readonly now?: Date
  readonly rate?: RateLimitRule
}

export type EnsureResult =
  | { readonly ok: true; readonly preview: LinkPreview; readonly cached: boolean }
  | { readonly ok: false; readonly reason: 'invalid_url' | 'rate_limited' }

/** 같은 주소의 동시 요청은 하나 — 프로세스 안(F-09-18 *"url_hash 기준 single-flight"*). */
const INFLIGHT = new Map<string, Promise<EnsureResult>>()

/** 메타를 준다 — 살아 있는 캐시가 있으면 그것, 아니면 가져와 적는다(머리말). */
export async function ensureLinkPreview(ctx: SessionContext, url: string, options: EnsureOptions = {}): Promise<EnsureResult> {
  const normalized = normalizePreviewUrl(url)
  if (normalized === null) return { ok: false, reason: 'invalid_url' }
  const now = options.now ?? new Date()
  const cached = (await readLinkPreviews([normalized], now)).get(normalized)
  if (cached !== undefined) return { ok: true, preview: cached, cached: true }
  const key = previewKey(normalized)
  const running = INFLIGHT.get(key)
  if (running !== undefined) return running
  const work = (async (): Promise<EnsureResult> => {
    const shape = checkOutboundUrl(normalized)
    if (!shape.ok) {
      // http 는 건너뛴다 · 막힌 모양은 실패 — 둘 다 가져오지 않으니 속도 제한에 세지 않는다
      const preview: LinkPreview = { status: shape.problem === 'not_https' ? 'skipped' : 'failed', ...EMPTY }
      await store(normalized, preview, now)
      return { ok: true, preview, cached: false }
    }
    if (!(await consume('link-preview:user', ctx.userId, options.rate ?? LINK_PREVIEW_RATE)).allowed) return { ok: false, reason: 'rate_limited' }
    const fetched = await (options.fetcher ?? ((u: string) => getHtml(u)))(normalized)
    const preview: LinkPreview = fetched.ok ? { status: 'ok', ...parsePreview(fetched.html, fetched.finalUrl) } : { status: 'failed', ...EMPTY }
    await store(normalized, preview, now)
    return { ok: true, preview, cached: false }
  })().finally(() => INFLIGHT.delete(key))
  INFLIGHT.set(key, work)
  return work
}
