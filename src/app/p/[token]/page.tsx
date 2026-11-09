/**
 * /p/[token] — 게시 루트의 공개 화면 (게시 · 공유 6a-2a · F-06-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ①
 */

import type { Metadata } from 'next'

import { windowQueryOf } from '@/lib/publish/public-window'

import { PublicPage, publicMetadata } from '../public-page'

export async function generateMetadata({ params, searchParams }: PageProps<'/p/[token]'>): Promise<Metadata> {
  const { token } = await params
  return publicMetadata(token, undefined, windowQueryOf(await searchParams))
}

export default async function PublicRootPage({ params, searchParams }: PageProps<'/p/[token]'>) {
  const { token } = await params
  return <PublicPage token={token} win={windowQueryOf(await searchParams)} />
}
