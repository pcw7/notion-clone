/**
 * URL · 이메일 · 전화 칸의 링크 — 그릴 때만 건다 (PT-2 · 정본 §3.5 [보강 PT-1] ⑥ · 순수)
 *
 * 적는 것은 너그럽게(길이만 본다), 거는 것은 엄격하게 한다: 링크로 걸 수 없는 글은 `null` 을 돌려주고, 그리는 쪽은 글로 그린다.
 * 표 · 행 페이지 · 카드 · 공개 화면이 이 한 곳을 쓴다 — 거르는 규칙이 두 군데에 있으면 어긋난다.
 */

import type { ContactType } from './property-types.ts'

/** 링크를 걸 수 있는 글이면 `href`, 아니면 null. */
export function contactHref(type: ContactType, raw: string): string | null {
  const text = raw.trim()
  if (text === '') return null
  switch (type) {
    case 'url':
      return urlHref(text)
    case 'email':
      return EMAIL.test(text) ? `mailto:${text}` : null
    case 'phone_number': {
      const digits = text.replace(/\D/g, '')
      // 숫자가 하나도 없으면 걸 곳이 없다 — `+` 는 맨 앞에서만 남긴다
      return digits === '' ? null : `tel:${text.startsWith('+') ? '+' : ''}${digits}`
    }
  }
}

/** http(s) 만 건다 — `javascript:` · `data:` · `ftp:` 같은 것은 글로 둔다. 공백이 낀 글도 건지 않는다. */
function urlHref(text: string): string | null {
  if (/\s/.test(text) || !/^https?:\/\//i.test(text)) return null
  try {
    const u = new URL(text)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '' ? text : null
  } catch {
    return null
  }
}

// `로컬@도메인.최상위` 꼴 — 공백 · 따옴표 · 괄호 · `mailto:` 의 질의가 될 글자(`?` `#` `%` `&`)가 없다
const EMAIL = /^[^\s@<>"',;:()[\]\\?#%&]+@[^\s@<>"',;:()[\]\\?#%&.]+(?:\.[^\s@<>"',;:()[\]\\?#%&.]+)+$/

/** 링크 속성 — 새 탭으로 열린다(`http(s)` 만 새 탭이 뜻이 있다). 공개 화면은 `nofollow ugc` 도 붙인다. */
export function contactLinkProps(type: ContactType, href: string, isPublic = false): { href: string; target?: '_blank'; rel?: string } {
  if (type !== 'url') return { href }
  return { href, target: '_blank', rel: isPublic ? 'noopener noreferrer nofollow ugc' : 'noopener noreferrer' }
}

/** 열기 단추의 이름(접근성). */
export const CONTACT_OPEN_LABEL: Readonly<Record<ContactType, string>> = {
  url: '링크 열기',
  email: '메일 보내기',
  phone_number: '전화 걸기',
}
