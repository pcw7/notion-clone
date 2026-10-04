'use client'

/**
 * 행 페이지의 속성 묶음(8f-1 · 8f-2 · F-16-03) — 묶음(`RowPropertyGroup` — 표 · 숨긴 속성 · 레이아웃 편집)을 **지연 로드**한다.
 *
 * 페이지 화면은 모든 페이지가 쓴다. 서버 컴포넌트가 표를 곧바로 import 하면 그 청크(100KB 남짓)가 **행이 아닌 페이지의 진입
 * 스크립트에도** 들어가 하이드레이션이 늦어진다 — 실제로 그 사이에 누른 "복제"가 아무 일도 하지 않았다(8f-1 의 e2e 가 찾았다).
 * 클라이언트 컴포넌트 안의 `next/dynamic` 은 따로 나뉜 청크라 행 페이지가 이 컴포넌트를 그릴 때만 받는다(서버 렌더는 그대로 한다).
 */

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'

import type { RowPropertyGroup as Group } from './row-property-group'

const RowPropertyGroup = dynamic(() => import('./row-property-group').then((m) => m.RowPropertyGroup))

export function RowProperties(props: ComponentProps<typeof Group>) {
  return <RowPropertyGroup {...props} />
}
