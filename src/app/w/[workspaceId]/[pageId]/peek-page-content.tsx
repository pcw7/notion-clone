/**
 * 데이터베이스 화면의 행 피크가 쓰는 본문 — 편집기를 지연 로드한다(BX-1). 페이지 화면은 `page-content.tsx` 의 `PageContent`(즉시).
 */

import type { ComponentProps } from 'react'
import { PageContentBase } from './page-content-base'
import { LazyBodyEditor } from './body-editor-lazy'

export function PeekPageContent(props: Omit<ComponentProps<typeof PageContentBase>, 'Editor'>) {
  return <PageContentBase Editor={LazyBodyEditor} {...props} />
}
