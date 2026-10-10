/**
 * /p/[token]/[pageId] — 게시 루트 아래 공개 하위 페이지의 화면 (게시 · 공유 6a-2a · F-06-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ① — 같은 토큰 아래 id 로 연다(토큰마다 열 수 있는 범위가 다르다).
 */

import type { Metadata } from 'next'

import { PublicPage, publicMetadata } from '../../public-page'

export async function generateMetadata({ params }: PageProps<'/p/[token]/[pageId]'>): Promise<Metadata> {
  const { token, pageId } = await params
  return publicMetadata(token, pageId)
}

export default async function PublicSubPage({ params }: PageProps<'/p/[token]/[pageId]'>) {
  const { token, pageId } = await params
  return <PublicPage token={token} pageId={pageId} />
}
