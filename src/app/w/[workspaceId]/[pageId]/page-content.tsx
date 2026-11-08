/**
 * 페이지 화면의 본문 — 편집기를 즉시 싣는다(주 내용). 피크는 `peek-page-content.tsx`(지연 · BX-1).
 */

import type { ComponentProps } from 'react'
import { PageContentBase } from './page-content-base'
import { BodyEditor } from './body-editor'

export type { PageFrame } from './page-content-base'

export function PageContent(props: Omit<ComponentProps<typeof PageContentBase>, 'Editor'>) {
  return <PageContentBase Editor={BodyEditor} {...props} />
}
