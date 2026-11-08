/**
 * 인박스의 리마인더 · 담당 줄 — 히스토리 · 활동 4c-3 (F-11-10) · 게시 · 공유 6h (F-11-08) · DOM · DB 없음
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑨ ⓓ — 울린 날짜 속성의 **지금** 이름을 말한다(서버가 속성에서 읽어 준다 —
 * 복제하지 않는다). 속성이 없어졌으면 "리마인더"만. [보강] 담당 알림 ⑤ — 같은 태도로 회원님을 넣은 사람 속성의 지금 이름.
 */

/** 리마인더 알림의 한 줄. 리마인더가 아니면(서버가 null 을 준다) null. */
export function reminderInboxLine(reminder: { readonly propertyName: string | null } | null): string | null {
  if (reminder === null) return null
  return reminder.propertyName === null ? '리마인더가 울렸습니다.' : `"${reminder.propertyName}" 날짜의 리마인더가 울렸습니다.`
}

/** 담당 알림의 한 줄(6h). 담당이 아니면(서버가 null 을 준다) null. 속성이 없어졌으면 "사람 속성". */
export function assignmentInboxLine(assignment: { readonly propertyName: string | null } | null): string | null {
  if (assignment === null) return null
  return assignment.propertyName === null
    ? '사람 속성에 회원님을 추가했습니다.'
    : `"${assignment.propertyName}"에 회원님을 추가했습니다.`
}

/** 알림 보내기 알림의 머리(AN-2 · 정본 [보강 AN-2] ②) — DB 자동화면 "자동화", 버튼이면 "버튼". */
export function automationInboxLabel(automation: { readonly via: 'automation' | 'button' }): string {
  return automation.via === 'button' ? '버튼' : '자동화'
}

/**
 * 알림 보내기 알림의 한 줄(AN-1 · AN-2) — "보낸 이: 메시지". 메시지는 값 슬롯이 이미 채워진 글이다. 보낸 이를 모르면(게스트가 본다 · 떠났다)
 * 메시지만, 메시지가 비면 "알림" 만.
 */
export function automationInboxLine(automation: { readonly message: string; readonly senderName?: string | null }): string {
  const text = automation.message === '' ? '알림' : automation.message
  return automation.senderName ? `${automation.senderName}: ${text}` : text
}

/** 검증 만료 알림의 글(VF-3) — 행 제목은 줄 머리의 링크가 보인다. */
export function verificationInboxLine(kind: string): string | null {
  return kind === 'verification_expired' ? '검증이 만료되었습니다.' : null
}
