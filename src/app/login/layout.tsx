/**
 * /login — 로그인 화면의 틀. 화면(`page.tsx`)이 클라이언트 컴포넌트라 제목은 여기서 준다(10d-7a · F-12-13).
 */

import type { Metadata } from 'next'

import { SCREEN_TITLES } from '@/lib/nav/screen-title'

export const metadata: Metadata = { title: SCREEN_TITLES.login }

export default function LoginLayout({ children }: LayoutProps<'/login'>) {
  return children
}
