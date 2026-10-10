/**
 * 공개 화면 — 루트(`/p/{token}`)와 하위(`/p/{token}/{pageId}`)가 함께 쓴다 (게시 · 공유 6a-2a · F-06-08 · F-17-11)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 · [정정] 웹 게시 ③
 *
 * 판정과 읽기는 `readPublicPage` 하나다(세션 없음). 메타데이터와 화면이 같은 요청에서 두 번 읽지 않게 `cache` 로 묶는다.
 *   · 열 수 없으면 404 — 이유를 말하지 않는다
 *   · 만료면 안내 화면(색인 제외)
 *   · 색인은 링크의 설정을 따르고(기본 noindex) · AI 크롤러를 막으면 `noai, noimageai` · 주소가 자격이므로 referrer 를 보내지 않는다
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache, type ReactNode } from 'react'

import { readPublicPage, type PublicRead } from '@/lib/publish/public-read'
import { Blocks, RichText, Trail, UNTITLED, publicFileHref, titleText } from './public-blocks'

export const loadPublicPage = cache((token: string, pageId?: string): Promise<PublicRead> => readPublicPage(token, pageId))

/** 메타 robots 의 값 — 링크의 설정(정본 [보강] 공개 화면 ⑥). */
export function robotsOf(read: PublicRead): string {
  if (!read.ok) return 'noindex, nofollow'
  const base = read.value.target.robots === 'index' ? 'index, follow' : 'noindex, nofollow'
  return read.value.target.aiCrawler === 'deny' ? `${base}, noai, noimageai` : base
}

export async function publicMetadata(token: string, pageId?: string): Promise<Metadata> {
  const read = await loadPublicPage(token, pageId)
  return {
    title: read.ok ? titleText(read.value.title) : read.reason === 'expired' ? '만료된 링크' : '없는 페이지',
    robots: robotsOf(read),
    referrer: 'no-referrer',
  }
}

export async function PublicPage({ token, pageId }: { token: string; pageId?: string }): Promise<ReactNode> {
  const read = await loadPublicPage(token, pageId)
  if (!read.ok) {
    if (read.reason === 'expired') {
      return (
        <main className="pub-page" data-testid="public-expired">
          <h1 className="pub-title">만료된 링크입니다</h1>
          <p className="pub-note">이 페이지의 공개 링크가 만료되었습니다. 페이지를 공유한 사람에게 새 링크를 요청하세요.</p>
        </main>
      )
    }
    notFound()
  }
  const view = read.value
  const untitled = titleText(view.title) === UNTITLED
  return (
    <main className="pub-page" data-testid="public-page" data-page-id={view.target.pageId}>
      {view.target.chain.length > 1 && (
        <nav className="pub-trail" aria-label="이동 경로" data-testid="public-trail">
          <Trail view={view} />
        </nav>
      )}
      {view.icon?.type === 'emoji' && <div className="pub-icon" aria-hidden="true">{view.icon.emoji}</div>}
      {view.icon !== null && view.icon.type !== 'emoji' && (
        // eslint-disable-next-line @next/next/no-img-element -- 공개 화면은 최적화 경로를 거치지 않는다(바깥 주소 · 토큰 경로)
        <img
          className="pub-icon-image"
          data-testid="public-icon-image"
          alt=""
          referrerPolicy="no-referrer"
          src={view.icon.type === 'file' ? publicFileHref(view, view.target.pageId, 'icon') : view.icon.url}
        />
      )}
      <h1 className="pub-title" data-testid="public-title">
        {untitled ? UNTITLED : <RichText runs={view.title} view={view} />}
      </h1>
      <article className="pub-body" data-testid="public-body">
        <Blocks blocks={view.doc.blocks} view={view} />
      </article>
      {/* 신고(6b-1b · F-17-08) — 공개 화면에만 있다(앱 안에는 없다 · 17) */}
      <footer className="pub-footer">
        <a
          href={view.target.pageId === view.target.rootId ? `/p/${token}/report` : `/p/${token}/report?page=${view.target.pageId}`}
          rel="nofollow"
          data-testid="public-report-link"
        >
          이 페이지 신고
        </a>
      </footer>
    </main>
  )
}
