/**
 * /s/[domain]/[slug]/[pageId] — 사이트 주소 아래 공개 하위 페이지 (게시 · 공유 6c-1 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 ① — 같은 사이트 주소 아래 id 로 연다(토큰 주소의 `/p/{token}/{pageId}` 와 같다).
 */

import type { Metadata } from 'next'

import { windowQueryOf } from '@/lib/publish/public-window'

import { SitePage, siteMetadata } from '../../../../p/public-page'

export async function generateMetadata({ params, searchParams }: PageProps<'/s/[domain]/[slug]/[pageId]'>): Promise<Metadata> {
  const { domain, slug, pageId } = await params
  return siteMetadata(domain, slug, pageId, windowQueryOf(await searchParams))
}

export default async function SiteSubPage({ params, searchParams }: PageProps<'/s/[domain]/[slug]/[pageId]'>) {
  const { domain, slug, pageId } = await params
  return <SitePage domain={domain} slug={slug} pageId={pageId} win={windowQueryOf(await searchParams)} />
}
