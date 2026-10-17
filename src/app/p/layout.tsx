/**
 * /p — 공개 화면의 틀 (게시 · 공유 6a-2a · F-06-08)
 *
 * 앱의 틀(사이드바 · 세션)이 없다 — 루트 레이아웃 아래 글만 선다. 색 팔레트(`[data-color]`)는 편집기 CSS 의 것을 그대로 쓰고, 수식은
 * KaTeX 의 CSS 를 쓴다.
 *
 * 편집기 CSS 는 여기서 다시 import 하지 않는다 — 루트 레이아웃의 `globals.css` 가 싣는다. 따로 컴파일되면 우리 변형(`dark` · `contrast-high`)을
 * 모른다(10d-5 · 정본 §3.1 [보강] 설정 값 표 · 테마 ⑧).
 */

import 'katex/dist/katex.min.css'
import './public.css'

export default function PublicLayout({ children }: LayoutProps<'/p'>) {
  return children
}
