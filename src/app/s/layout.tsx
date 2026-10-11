/**
 * /s — 사이트 주소의 틀 (게시 · 공유 6c-1 · F-13-08)
 *
 * 공개 화면(`/p`)과 같은 틀이다 — 같은 화면을 다른 주소로 연다(정본 §3.3 끝 [보강] 사이트 주소 ①). 앱의 틀(사이드바 · 세션)이 없다.
 */

import 'katex/dist/katex.min.css'
import '../editor.css'
import '../p/public.css'

export default function SiteLayout({ children }: LayoutProps<'/s'>) {
  return children
}
