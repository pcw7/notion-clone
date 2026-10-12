/**
 * /f — 공개 폼의 틀 (인접 제품 7a-2b · F-13-02)
 *
 * 공개 화면(`/p`)과 같은 글꼴 · 색 — 같은 공개 CSS 를 쓴다. 앱의 틀(사이드바 · 세션)이 없다.
 */

import '../p/public.css'

export default function FormLayout({ children }: LayoutProps<'/f'>) {
  return children
}
