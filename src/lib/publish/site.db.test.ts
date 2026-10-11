/**
 * 사이트 주소 — 게시 · 공유 6c-1조각 (F-13-08 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.3 끝 [보강] 사이트 주소).
 *
 *   ① ★ 워크스페이스 주소 — 소유자만 · 모양 · 앱이 쓰는 이름 · 다른 워크스페이스가 쓰면 taken · 바꾸기 · 지우기 · 감사 로그(바뀌었을 때만)
 *   ② ★ 슬러그 — 게시 설정의 한 칸 · 소문자로 받는다 · 모양이 틀리면 invalid_slug · 워크스페이스 안에서 하나(slug_taken — 다른
 *      워크스페이스는 같은 슬러그를 쓴다) · 게시된 링크에만 · 게시를 바꿀 수 없는 사람에게는 보이지 않는다 · 비우면 지운다
 *   ③ ★ 사이트 주소로 연다 — 토큰과 같은 판정 · 화면 안의 링크는 사이트 주소(기준 경로) · 하위 페이지 · 해제 · 슬러그 지우기 · 주소
 *      바꾸기 · 정책이 막으면 닫힌다 · 다른 워크스페이스의 같은 슬러그로 새지 않는다 · 토큰 주소는 그대로 산다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { publishPage, readPublishState, unpublishPage, updatePublicLink } from './public-link.ts'
import { readPublicPage, readSitePage } from './public-read.ts'
import { readSiteDomain, setSiteDomain } from './site.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
/** 주소는 모두에게 하나다 — 검사마다 다른 이름을 쓴다. */
const uniqueName = (base: string): string => `${base}-${Date.now().toString(36)}-${(seq += 1)}`

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

async function team() {
  const ws = await createBareWorkspace('사이트')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  // 소유자의 개인 페이지 — 동료에게 따로 주는 레벨만 갖게(워크스페이스 최상위는 모두가 관리한다)
  const page = await createPage(boss.ctx, { title: titleFromPlainText('회사 소개'), privateTop: true })
  const sub = await createPage(boss.ctx, { title: titleFromPlainText('연혁'), parentPageId: page.id as BlockId })
  return { ws, boss, mate, page: page.id, sub: sub.id }
}

const settingAudits = (ws: string) =>
  query<{ value_before: unknown; value_after: unknown }>(
    `SELECT value_before, value_after FROM audit_event
      WHERE workspace_id = $1 AND event_type = 'workspace.setting_changed' AND setting_key = 'site.domain'
      ORDER BY occurred_at, id`,
    [ws],
  )

// ── ① 워크스페이스 주소 ───────────────────────────────────────────────

describe('① ★ 워크스페이스 주소', () => {
  test('소유자만 · 모양 · 앱이 쓰는 이름 · 다른 워크스페이스 · 바꾸기 · 지우기 · 감사 로그', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await team()
    const name = uniqueName('acme')
    assert.equal(await readSiteDomain(boss.ctx), null)
    assert.deepEqual(await setSiteDomain(mate.ctx, name), { ok: false, reason: 'forbidden' }, '멤버는 정하지 못한다')
    for (const bad of ['ab', 'Has_Underscore', '-front', 'back-', 'x'.repeat(41), 42]) {
      assert.deepEqual(await setSiteDomain(boss.ctx, bad), { ok: false, reason: 'invalid_name' }, String(bad))
    }
    assert.deepEqual(await setSiteDomain(boss.ctx, 'www'), { ok: false, reason: 'reserved' })

    assert.deepEqual(await setSiteDomain(boss.ctx, `  ${name.toUpperCase()} `), { ok: true, value: { name } }, '소문자로 받는다')
    assert.equal(await readSiteDomain(mate.ctx), name, '누구나 읽는다')
    assert.deepEqual(await setSiteDomain(boss.ctx, name), { ok: true, value: { name } }, '같은 이름 — 바뀐 것이 없다')

    const other = await createBareWorkspace('남의 사이트')
    const otherBoss = await joinAs(other, await createUser('남의 대표'), 'owner')
    assert.deepEqual(await setSiteDomain(otherBoss.ctx, name), { ok: false, reason: 'taken' }, '주소는 모두에게 하나')

    const renamed = uniqueName('acme-new')
    unwrap(await setSiteDomain(boss.ctx, renamed))
    unwrap(await setSiteDomain(boss.ctx, null))
    assert.equal(await readSiteDomain(boss.ctx), null)
    assert.deepEqual(
      (await settingAudits(ws)).map((r) => [r.value_before, r.value_after]),
      [[null, name], [name, renamed], [renamed, null]],
      '바뀌었을 때만 · 앞뒤 값',
    )
  })
})

// ── ② 슬러그 ──────────────────────────────────────────────────────────

describe('② ★ 슬러그', () => {
  test('게시 설정의 한 칸 · 소문자 · 모양 · 워크스페이스 안에서 하나 · 게시된 링크에만 · 관리하는 사람에게만 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate, page, sub } = await team()
    assert.deepEqual(await updatePublicLink(boss.ctx, page, { slug: 'about' }), { ok: false, reason: 'not_published' }, '게시된 링크에만')
    unwrap(await publishPage(boss.ctx, page))
    unwrap(await setSiteDomain(boss.ctx, uniqueName('slugs')))

    const set = unwrap(await updatePublicLink(boss.ctx, page, { slug: ' About-Us ' }))
    assert.equal(set.slug, 'about-us', '소문자로 받는다')
    assert.equal(set.siteDomain, await readSiteDomain(boss.ctx))
    for (const bad of ['about us', '-about', 'about--us', 'a'.repeat(61), '회사']) {
      assert.deepEqual(await updatePublicLink(boss.ctx, page, { slug: bad }), { ok: false, reason: 'invalid_slug' }, bad)
    }
    assert.deepEqual(await updatePublicLink(boss.ctx, page, { slug: 7 }), { ok: false, reason: 'invalid_input' })

    assert.deepEqual(await updatePublicLink(boss.ctx, sub, { slug: 'about-us' }), { ok: false, reason: 'not_published' }, '게시 여부를 먼저 말한다')
    unwrap(await publishPage(boss.ctx, sub))
    assert.deepEqual(await updatePublicLink(boss.ctx, sub, { slug: 'about-us' }), { ok: false, reason: 'slug_taken' }, '워크스페이스 안에서 하나')
    const other = await createBareWorkspace('남의 슬러그')
    const otherBoss = await joinAs(other, await createUser('남의 대표'), 'owner')
    const otherPage = await createPage(otherBoss.ctx, { title: titleFromPlainText('남의 소개') })
    unwrap(await publishPage(otherBoss.ctx, otherPage.id))
    assert.equal(unwrap(await updatePublicLink(otherBoss.ctx, otherPage.id, { slug: 'about-us' })).slug, 'about-us', '다른 워크스페이스는 쓴다')

    assert.ok((await grantAccess(boss.ctx, page as BlockId, { type: 'user', id: mate.userId }, 'edit')).ok)
    assert.equal(unwrap(await readPublishState(mate.ctx, page)).slug, null, '게시를 바꿀 수 없는 사람에게는 보이지 않는다(토큰과 같다)')

    assert.equal(unwrap(await updatePublicLink(boss.ctx, page, { slug: '' })).slug, null, '비우면 지운다')
    const audits = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_event WHERE workspace_id = $1 AND event_type = 'page.publish_changed' AND metadata ? 'slug'
        ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(audits.map((a) => a.metadata.slug), ['about-us', null], '감사 로그에 슬러그')
  })
})

// ── ③ 사이트 주소로 연다 ───────────────────────────────────────────────

describe('③ ★ 사이트 주소로 연다', () => {
  test('토큰과 같은 판정 · 기준 경로 · 하위 · 해제 · 지우기 · 주소 바꾸기 · 정책 · 다른 워크스페이스로 새지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, page, sub } = await team()
    const token = unwrap(await publishPage(boss.ctx, page)).token!
    const domain = uniqueName('open')
    unwrap(await setSiteDomain(boss.ctx, domain))
    unwrap(await updatePublicLink(boss.ctx, page, { slug: 'about' }))

    const root = await readSitePage(domain, 'about')
    assert.ok(root.ok, JSON.stringify(root))
    assert.equal(root.value.target.pageId, page)
    assert.equal(root.value.base, `/s/${domain}/about`, '화면 안의 링크는 사이트 주소')
    assert.ok(root.value.pages.has(sub), '하위 페이지 참조가 열린다')
    const child = await readSitePage(domain, 'about', sub)
    assert.ok(child.ok && child.value.target.pageId === sub && child.value.base === `/s/${domain}/about`, '하위 페이지')
    const viaToken = await readPublicPage(token)
    assert.ok(viaToken.ok && viaToken.value.base === `/p/${token}`, '토큰 주소는 그대로 산다')

    for (const [d, s] of [[domain, 'nope'], ['no-such-site', 'about'], [domain.toUpperCase(), 'about'], [domain, 'About']]) {
      assert.deepEqual(await readSitePage(d, s), { ok: false, reason: 'not_found' }, `${d}/${s}`)
    }

    // 다른 워크스페이스의 같은 슬러그는 그쪽 주소로만
    const other = await createBareWorkspace('남의 사이트')
    const otherBoss = await joinAs(other, await createUser('남의 대표'), 'owner')
    const otherPage = await createPage(otherBoss.ctx, { title: titleFromPlainText('남의 소개') })
    unwrap(await publishPage(otherBoss.ctx, otherPage.id))
    unwrap(await updatePublicLink(otherBoss.ctx, otherPage.id, { slug: 'about' }))
    const mine = await readSitePage(domain, 'about')
    assert.ok(mine.ok && mine.value.target.pageId === page, '같은 슬러그라도 내 주소는 내 페이지')

    unwrap(await unpublishPage(boss.ctx, page))
    assert.deepEqual(await readSitePage(domain, 'about'), { ok: false, reason: 'not_found' }, '해제하면 닫힌다')
    unwrap(await publishPage(boss.ctx, page))
    assert.ok((await readSitePage(domain, 'about')).ok, '다시 게시하면 다시 열린다(슬러그는 남는다)')

    const renamed = uniqueName('open-new')
    unwrap(await setSiteDomain(boss.ctx, renamed))
    assert.deepEqual(await readSitePage(domain, 'about'), { ok: false, reason: 'not_found' }, '옛 주소는 곧바로 닫힌다')
    assert.ok((await readSitePage(renamed, 'about')).ok)

    assert.deepEqual(await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', false), { ok: true, value: false })
    assert.deepEqual(await readSitePage(renamed, 'about'), { ok: false, reason: 'not_found' }, '정책이 막으면 닫힌다(토큰과 같은 판정)')
    unwrap(await updateSetting(boss.ctx, 'workspace.allow_publish_sites_and_forms', true))

    unwrap(await updatePublicLink(boss.ctx, page, { slug: null }))
    assert.deepEqual(await readSitePage(renamed, 'about'), { ok: false, reason: 'not_found' }, '슬러그를 지우면 닫힌다')
    assert.ok((await readPublicPage(token)).ok, '토큰 주소는 산다')
  })
})
