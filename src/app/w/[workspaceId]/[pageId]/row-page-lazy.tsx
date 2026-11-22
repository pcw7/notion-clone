'use client'

/**
 * 데이터베이스 행 페이지에만 서는 머리 부품의 지연 로드(BD-1) — 행 제목 · 속성 묶음 · 확인 배지.
 *
 * 페이지 화면은 보통 페이지와 행 페이지가 같은 경로라, 행에만 쓰는 이 부품들(표 API · 속성 편집기 · 확인 표시)이 보통 페이지의 첫 JS 에도
 * 들어갔다. `next/dynamic` 을 거치면 **서버 렌더는 그대로 하고**(ssr 기본값) 행 페이지에서는 그 청크를 서버가 미리 받게 알린다
 * (`<link rel=preload>` — 하이드레이션이 기다린다 · 화면이 비거나 밀리지 않는다). 보통 페이지는 그리지 않으므로 받지 않는다.
 */

import dynamic from 'next/dynamic'

export const RowTitle = dynamic(() => import('../db/[databaseId]/row-title').then((m) => m.RowTitle))
export const RowProperties = dynamic(() => import('./row-properties').then((m) => m.RowProperties))
export const VerificationBadge = dynamic(() => import('./verification-badge').then((m) => m.VerificationBadge))
