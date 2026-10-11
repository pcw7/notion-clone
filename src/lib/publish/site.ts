/**
 * 사이트 주소 — 워크스페이스의 주소 · 페이지의 슬러그 (게시 · 공유 6c-1 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 ①~⑥ · 마이그레이션 0093
 *       13 F-13-08 *"URL slug 를 편집한다(최대 60자, 영문/숫자/하이픈)"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 사이트 주소는 덧붙는 이름이다 — 판정은 토큰의 것
 * ──────────────────────────────────────────────────────────────────────
 *
 * `/s/{주소}/{슬러그}` 는 그 워크스페이스에서 그 슬러그를 가진 **게시된** 링크의 토큰을 찾을 뿐이다. 그 뒤는 토큰 주소와 같은 판정 ·
 * 같은 읽기다(`readPublicPage` — 만료 · 정책 · 휴지통 · 모더레이션 · 사슬). 그래서 이 파일에는 공개 판정이 없다.
 *
 * 워크스페이스 주소는 소유자만 정한다(설정 — 감사 로그 `workspace.setting_changed` · 키 `site.domain`). 슬러그는 게시 설정의 한 칸이다
 * (`public-link.ts` 의 `updatePublicLink`).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { recordForContextIn } from '../audit/audit.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'

/** 워크스페이스 주소의 모양 — 0093 의 CHECK 과 같다(3~40자 · 소문자 · 숫자 · 하이픈 — 끝은 아니다). */
export const SITE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
/** 슬러그의 모양 — 0093 의 CHECK 과 같다(소문자 · 숫자 · 하이픈으로 이은 낱말 · 60자). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_SLUG_LENGTH = 60

/** 앱 · 운영이 쓰는 이름 — 사이트 주소로 받지 않는다(정본 ③). 운영에서 하위 주소가 되면 이 이름들이 겹친다. */
export const RESERVED_SITE_NAMES: ReadonlySet<string> = new Set([
  'www', 'api', 'app', 'admin', 'help', 'status', 'mail', 'email', 'static', 'assets', 'cdn', 'docs', 'blog', 'support',
  'login', 'logout', 'signup', 'auth', 'account', 'settings', 'billing', 'security', 'abuse', 'report', 'site', 'sites',
])

/** 슬러그를 받는 모양으로 — 앞뒤 공백을 걷고 소문자로(정본 ④ — 대소문자를 가르지 않는다). 받을 수 없으면 null. */
export function normalizeSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase()
  return SLUG_PATTERN.test(slug) && slug.length <= MAX_SLUG_LENGTH ? slug : null
}

/** 사이트 주소의 경로 — 화면 안의 링크 · 게시 패널이 함께 쓴다. */
export const siteBasePath = (domain: string, slug: string): string => `/s/${domain}/${slug}`

/** 이 워크스페이스의 사이트 주소(하위 주소) — 없으면 null. */
export async function readSiteDomainIn(tx: Tx, workspaceId: string): Promise<string | null> {
  const row = await tx.queryMaybe<{ name: string }>(
    `SELECT name FROM site_domain WHERE workspace_id = $1 AND kind = 'subdomain'`,
    [workspaceId],
  )
  return row?.name ?? null
}

/** 사이트 주소를 읽는다 — 이 워크스페이스의 누구나(게시 패널이 주소를 보인다). */
export async function readSiteDomain(ctx: SessionContext): Promise<string | null> {
  return withReadTransaction((tx) => readSiteDomainIn(tx, ctx.workspaceId))
}

export type SiteDomainFailure =
  /** 소유자가 아니다. */
  | 'forbidden'
  /** 모양이 틀렸다(3~40자 · 소문자 · 숫자 · 하이픈). */
  | 'invalid_name'
  /** 앱이 쓰는 이름이다. */
  | 'reserved'
  /** 다른 워크스페이스가 쓴다. */
  | 'taken'

export type SiteDomainResult =
  | { readonly ok: true; readonly value: { readonly name: string | null } }
  | { readonly ok: false; readonly reason: SiteDomainFailure }

export function siteDomainFailureStatus(reason: SiteDomainFailure): number {
  switch (reason) {
    case 'forbidden':
      return 403
    case 'invalid_name':
    case 'reserved':
      return 400
    case 'taken':
      return 409
  }
}

/**
 * 사이트 주소를 정한다 — `null` · 빈 글자면 지운다(사이트 주소가 모두 닫힌다 · 토큰 주소는 산다). 바꾸면 옛 주소는 곧바로 닫힌다
 * (넘겨주는 길은 없다 — v1). 바뀌었을 때만 감사 로그.
 */
export async function setSiteDomain(ctx: SessionContext, raw: unknown): Promise<SiteDomainResult> {
  if (ctx.role !== 'owner') return { ok: false, reason: 'forbidden' }
  if (raw !== null && typeof raw !== 'string') return { ok: false, reason: 'invalid_name' }
  const name = raw === null || raw.trim() === '' ? null : raw.trim().toLowerCase()
  if (name !== null && !SITE_NAME_PATTERN.test(name)) return { ok: false, reason: 'invalid_name' }
  if (name !== null && RESERVED_SITE_NAMES.has(name)) return { ok: false, reason: 'reserved' }

  return withCommandTransaction(async (tx): Promise<SiteDomainResult> => {
    // 워크스페이스의 주소를 줄 세운다 — 두 요청이 함께 "없다" 를 읽고 둘 다 넣지 않게
    await tx.query(`SELECT 1 FROM workspace WHERE id = $1 FOR UPDATE`, [ctx.workspaceId])
    const before = await readSiteDomainIn(tx, ctx.workspaceId)
    if (before === name) return { ok: true, value: { name } }
    if (name !== null) {
      const other = await tx.queryMaybe<{ workspace_id: string }>(`SELECT workspace_id FROM site_domain WHERE name = $1`, [name])
      if (other !== null && other.workspace_id !== ctx.workspaceId) return { ok: false, reason: 'taken' }
    }

    if (name === null) {
      await tx.query(`DELETE FROM site_domain WHERE workspace_id = $1 AND kind = 'subdomain'`, [ctx.workspaceId])
    } else if (before === null) {
      await tx.query(`INSERT INTO site_domain (id, workspace_id, kind, name, created_by) VALUES ($1, $2, 'subdomain', $3, $4)`, [
        randomUUID(),
        ctx.workspaceId,
        name,
        ctx.userId,
      ])
    } else {
      await tx.query(`UPDATE site_domain SET name = $2 WHERE workspace_id = $1 AND kind = 'subdomain'`, [ctx.workspaceId, name])
    }
    await recordForContextIn(tx, ctx, 'workspace.setting_changed', {
      target: { type: 'setting', id: 'site.domain' },
      setting: { key: 'site.domain', before, after: name },
    })
    return { ok: true, value: { name } }
  })
}

/**
 * 사이트 주소 → 그 링크의 토큰. 세션이 없다(공개 경로). 주소 · 슬러그의 모양이 틀렸거나, 없거나, 게시가 해제됐으면 null — 이유를
 * 말하지 않는다(정본 ② — 토큰과 같다). 열 수 있는지는 토큰의 판정이 본다.
 */
export async function resolveSiteTokenIn(tx: Tx, domain: string, slug: string): Promise<string | null> {
  if (!SITE_NAME_PATTERN.test(domain) || !SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) return null
  const row = await tx.queryMaybe<{ token: string }>(
    `SELECT l.token
       FROM site_domain d
       JOIN public_link l ON l.workspace_id = d.workspace_id AND l.slug = $2
      WHERE d.name = $1 AND l.enabled AND l.token IS NOT NULL`,
    [domain, slug],
  )
  return row?.token ?? null
}
