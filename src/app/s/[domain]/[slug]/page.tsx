/**
 * /s/[domain]/[slug] — 사이트 주소로 연 게시 루트 (게시 · 공유 6c-1 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 ①② — 주소 → 그 링크의 토큰 → 토큰과 같은 판정 · 같은 화면.
 */

import type { Metadata } from 'next'

import { SitePage, siteMetadata } from '../../../p/public-page'

export async function generateMetadata({ params }: PageProps<'/s/[domain]/[slug]'>): Promise<Metadata> {
  const { domain, slug } = await params
  return siteMetadata(domain, slug)
}

export default async function SiteRootPage({ params }: PageProps<'/s/[domain]/[slug]'>) {
  const { domain, slug } = await params
  return <SitePage domain={domain} slug={slug} />
}
