'use client'

/**
 * 공유 패널의 "웹에 게시" 절 (게시 · 공유 6a-3 · F-06-08 · F-17-11)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 ④⑤⑥ · [보강] 공개 화면 ⑥
 *
 * 판정은 서버다(`publish/public-link.ts`) — 이 절은 상태를 읽고 부르기만 한다.
 *
 *   · 게시하기 전에 무엇이 열리는지 말한다(이 페이지와 하위 페이지 · 로그인 없이)
 *   · 게시된 주소 · 복사 · 열기 · 검색 엔진 노출 · 주소 바꾸기(두 번 누른다 — 옛 주소는 곧바로 닫힌다) · 게시 취소
 *   · 위 페이지의 게시로 공개되어 있으면 그렇다고 말한다(하위는 함께 공개된다 · 볼 수 없는 위 페이지는 이름 없이)
 *   · 정책이 막으면 그렇다고 말하고 게시 단추를 세우지 않는다 — 취소는 언제나 된다
 *   · 게시를 바꿀 수 없는 사람에게는 게시되어 있다는 것만(주소는 서버가 주지 않는다)
 *   · AI 크롤러 칸은 없다 — robots.txt 가 링크마다 열 수 없다(정본 [보강] 공개 화면 ⑥)
 *   · 사이트 주소(6c-2 · 정본 [보강] 사이트 주소 ⑦) — 워크스페이스 주소가 있으면 슬러그 칸과 그 주소(복사 · 열기), 없으면 소유자가
 *     설정에서 정한다고만
 */

import { useCallback, useEffect, useState } from 'react'

import { SITE_DOMAIN_MISSING, siteUrlOf } from '../settings/site-messages'

import {
  EXPIRY_PLAN_NOTICE,
  MODERATED_NOTICE,
  PUBLISH_DATABASE_HINT,
  PUBLISH_HINT,
  ROTATE_WARNING,
  coveredMessage,
  endOfLocalDay,
  expiryDayRange,
  expiryLine,
  localDayOf,
  publicUrlOf,
  publishFailureMessage,
  publishPolicyNotice,
} from './publish-messages'

type PublishState = {
  published: boolean
  token: string | null
  robots: 'index' | 'noindex'
  policyAllows: boolean
  /** 운영자가 막았는가(6b-3b) — 정책 줄이 "운영 정책" 이라고 말한다. */
  publishingBlocked: boolean
  canManage: boolean
  coveredBy: { pageId: string | null; title: string | null } | null
  moderation: 'taken_down' | 'restricted' | null
  /** 사이트 주소의 슬러그(6c-1) — 바꿀 수 있는 사람에게만. */
  slug: string | null
  /** 워크스페이스의 사이트 주소(6c-1). */
  siteDomain: string | null
  /** 만료(10n-50) — 없으면 null. 지났으면 게시되어 있어도 열리지 않는다. */
  expiresAt: string | null
  /** 이 사람이 만료를 정할 수 있는가(요금제 · `manage_perm`) — 지우기는 무관하다. */
  expiryAllowed: boolean
}

export function PublishSection({
  workspaceId,
  pageId,
  kind = 'page',
}: {
  workspaceId: string
  pageId: string
  /** 데이터베이스(6a-2c-2)면 무엇이 열리는지의 말이 다르다 — 첫 뷰의 표와 그 행. */
  kind?: 'page' | 'database'
}) {
  const url = `/api/workspaces/${workspaceId}/pages/${pageId}/publish`
  const [state, setState] = useState<PublishState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)

  useEffect(() => {
    let alive = true
    void fetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (PublishState & { error?: string }) | null
        if (!alive) return
        if (!res.ok || body === null) setError(publishFailureMessage(body?.error))
        else setState(body)
      })
      .catch(() => alive && setError('연결에 실패했습니다.'))
    return () => {
      alive = false
    }
  }, [url])

  const call = useCallback(
    async (method: 'PUT' | 'DELETE' | 'PATCH', body?: Record<string, unknown>, done?: string) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const res = await fetch(url, {
          method,
          ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        })
        const data = (await res.json().catch(() => null)) as (PublishState & { error?: string }) | null
        if (!res.ok || data === null) {
          setError(publishFailureMessage(data?.error))
          return
        }
        setState(data)
        if (done) setNotice(done)
      } catch {
        setError('연결에 실패했습니다.')
      } finally {
        setBusy(false)
        setConfirmRotate(false)
      }
    },
    [url],
  )

  const copy = async (address: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address)
      setNotice('주소를 복사했습니다.')
    } catch {
      setNotice('주소를 고른 뒤 직접 복사하세요.')
    }
  }

  if (state === null) {
    return error === null ? null : (
      <p role="alert" className="mt-3 text-xs text-red-600">
        {error}
      </p>
    )
  }
  // 바꿀 수 없고 공개된 것도 없으면 이 절은 서지 않는다
  if (!state.canManage && !state.published && state.coveredBy === null && state.moderation === null) return null

  const address = state.token !== null && typeof window !== 'undefined' ? publicUrlOf(window.location.origin, state.token) : null

  return (
    <section data-testid="publish-section" className="mt-3 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
      <h3 className="mb-1 font-medium">웹에 게시</h3>

      {state.coveredBy !== null && (
        <p data-testid="publish-covered" className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
          {coveredMessage(state.coveredBy.title)}
          {state.coveredBy.pageId !== null && (
            <>
              {' '}
              <a href={`/w/${workspaceId}/${state.coveredBy.pageId}`} className="underline underline-offset-2">
                그 페이지로
              </a>
            </>
          )}
        </p>
      )}

      {state.moderation !== null && (
        <p data-testid="publish-moderated" className="mb-2 text-xs text-red-700 dark:text-red-400">
          {MODERATED_NOTICE}
        </p>
      )}

      {!state.policyAllows && (
        <p data-testid="publish-policy-off" data-blocked={state.publishingBlocked} className="mb-2 text-xs text-amber-700 dark:text-amber-400">
          {publishPolicyNotice(state.publishingBlocked)}
        </p>
      )}

      {state.published && !state.canManage && (
        <p data-testid="publish-published" className="text-xs text-neutral-600 dark:text-neutral-400">
          이 페이지는 웹에 게시되어 있습니다.
        </p>
      )}

      {state.published && state.canManage && address !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <input
              readOnly
              aria-label="공개 주소"
              data-testid="publish-url"
              value={address}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              data-testid="publish-copy"
              onClick={() => void copy(address)}
              className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              복사
            </button>
            <a
              href={address}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="publish-open"
              className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              열기
            </a>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              data-testid="publish-index"
              checked={state.robots === 'index'}
              disabled={busy}
              onChange={(e) => void call('PATCH', { robots: e.target.checked ? 'index' : 'noindex' })}
            />
            검색 엔진에 노출(기본은 노출하지 않음)
          </label>
          <SiteAddress
            // 서버의 슬러그가 바뀌면 초안을 새로 세운다(효과 안의 setState 없이)
            key={state.slug ?? ''}
            domain={state.siteDomain}
            slug={state.slug}
            busy={busy}
            onSave={(slug) => void call('PATCH', { slug }, slug === null ? '슬러그를 지웠습니다. 사이트 주소로는 열리지 않습니다.' : '슬러그를 저장했습니다.')}
            onCopy={(address) => void copy(address)}
          />
          <LinkExpiry
            // 서버의 만료가 바뀌면 초안을 새로 세운다(효과 안의 setState 없이)
            key={state.expiresAt ?? ''}
            expiresAt={state.expiresAt}
            allowed={state.expiryAllowed}
            busy={busy}
            onSave={(expiresAt, done) => void call('PATCH', { expiresAt }, done)}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {confirmRotate ? (
              <span data-testid="publish-rotate-confirm" className="flex items-center gap-1">
                <span className="text-amber-700 dark:text-amber-400">{ROTATE_WARNING}</span>
                <button
                  type="button"
                  data-testid="publish-rotate-yes"
                  disabled={busy}
                  onClick={() => void call('PATCH', { rotateToken: true }, '주소를 바꿨습니다. 예전 주소로는 열리지 않습니다.')}
                  className="rounded border border-amber-400 px-2 py-0.5 hover:bg-amber-50 dark:hover:bg-amber-950"
                >
                  바꾸기
                </button>
                <button type="button" data-testid="publish-rotate-no" onClick={() => setConfirmRotate(false)} className="px-1 underline">
                  그대로 두기
                </button>
              </span>
            ) : (
              <button
                type="button"
                data-testid="publish-rotate"
                disabled={busy}
                onClick={() => setConfirmRotate(true)}
                className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                주소 바꾸기
              </button>
            )}
            <button
              type="button"
              data-testid="publish-unpublish"
              disabled={busy}
              onClick={() => void call('DELETE', undefined, '게시를 취소했습니다. 그 주소로는 열리지 않습니다.')}
              className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              게시 취소
            </button>
          </div>
        </div>
      )}

      {!state.published && state.canManage && state.policyAllows && state.moderation === null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-neutral-600 dark:text-neutral-400" data-testid="publish-hint">
            {kind === 'database' ? PUBLISH_DATABASE_HINT : PUBLISH_HINT}
          </p>
          <button
            type="button"
            data-testid="publish-publish"
            disabled={busy}
            onClick={() => void call('PUT', undefined, '웹에 게시했습니다.')}
            className="self-start rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            웹에 게시
          </button>
        </div>
      )}

      {error && (
        <p role="alert" data-testid="publish-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="publish-notice" className="mt-2 text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </section>
  )
}

/**
 * 사이트 주소 칸(6c-2) — 워크스페이스 주소가 없으면 안내만. 있으면 슬러그 칸(저장 · 비우기)과, 슬러그가 있으면 그 주소(복사 · 열기).
 * 판정(모양 · 하나뿐)은 서버다 — 실패는 절의 오류 줄이 말한다.
 */
function SiteAddress({
  domain,
  slug,
  busy,
  onSave,
  onCopy,
}: {
  domain: string | null
  slug: string | null
  busy: boolean
  onSave: (slug: string | null) => void
  onCopy: (address: string) => void
}) {
  const [draft, setDraft] = useState(slug ?? '')
  if (domain === null) {
    return (
      <p data-testid="publish-site-missing" className="text-xs text-neutral-500">
        {SITE_DOMAIN_MISSING}
      </p>
    )
  }
  const address = slug !== null && typeof window !== 'undefined' ? siteUrlOf(window.location.origin, domain, slug) : null
  return (
    <div data-testid="publish-site" className="flex flex-col gap-1 text-xs">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(draft.trim() === '' ? null : draft)
        }}
      >
        <span className="shrink-0 text-neutral-500">/s/{domain}/</span>
        <input
          aria-label="사이트 슬러그"
          data-testid="publish-slug"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="예: about-us"
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          data-testid="publish-slug-save"
          disabled={busy || draft.trim().toLowerCase() === (slug ?? '')}
          className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          저장
        </button>
      </form>
      {address !== null && (
        <div className="flex items-center gap-1">
          <input
            readOnly
            aria-label="사이트 주소"
            data-testid="publish-site-url"
            value={address}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            data-testid="publish-site-copy"
            onClick={() => onCopy(address)}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            복사
          </button>
          <a
            href={address}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="publish-site-open"
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            열기
          </a>
        </div>
      )}
    </div>
  )
}

/**
 * 공개 링크의 만료(10n-50 · 정본 [정정] 웹 게시 ⑬) — 날짜를 고르면 그날의 끝까지 열린다. 요금제가 허락하지 않으면 날짜 칸이 막히고 까닭이 선다 ·
 * 지우기("만료 없애기")는 요금제와 무관하다. 지난 만료는 "만료되었습니다" — 새로 정하거나 없애면 같은 주소로 다시 열린다.
 */
function LinkExpiry({
  expiresAt,
  allowed,
  busy,
  onSave,
}: {
  expiresAt: string | null
  allowed: boolean
  busy: boolean
  onSave: (expiresAt: string | null, done: string) => void
}) {
  // 처음 그릴 때의 시각 — 범위와 "지났다" 를 그 시각으로 잰다(렌더마다 시계를 읽지 않는다)
  const [now] = useState(() => Date.now())
  const [day, setDay] = useState(expiresAt === null ? '' : localDayOf(expiresAt))
  const range = expiryDayRange(new Date(now))
  const expired = expiresAt !== null && Date.parse(expiresAt) <= now
  const chosen = endOfLocalDay(day)
  return (
    <div data-testid="publish-expiry" className="flex flex-col gap-1 text-xs">
      <span data-testid="publish-expiry-state" data-expired={expired || undefined} className={expired ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-600 dark:text-neutral-400'}>
        {expiryLine(expiresAt, now)}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <input
          type="date"
          aria-label="만료일"
          data-testid="publish-expiry-day"
          value={day}
          min={range.min}
          max={range.max}
          disabled={busy || !allowed}
          onChange={(e) => setDay(e.target.value)}
          className="rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          data-testid="publish-expiry-save"
          disabled={busy || !allowed || chosen === null}
          onClick={() => chosen !== null && onSave(chosen, `${day} 까지 열립니다.`)}
          className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          만료 정하기
        </button>
        {expiresAt !== null && (
          <button
            type="button"
            data-testid="publish-expiry-clear"
            disabled={busy}
            onClick={() => onSave(null, '만료를 없앴습니다 — 해제할 때까지 열립니다.')}
            className="rounded px-2 py-0.5 underline disabled:opacity-50"
          >
            만료 없애기
          </button>
        )}
      </div>
      {!allowed && (
        <p data-testid="publish-expiry-plan" className="text-neutral-500">
          {EXPIRY_PLAN_NOTICE}
        </p>
      )}
    </div>
  )
}
