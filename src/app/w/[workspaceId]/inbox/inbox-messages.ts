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
