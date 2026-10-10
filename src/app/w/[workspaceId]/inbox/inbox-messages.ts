/**
 * 인박스의 리마인더 줄 — 히스토리 · 활동 4c-3 (F-11-10 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑨ ⓓ — 울린 날짜 속성의 **지금** 이름을 말한다(서버가 속성에서 읽어 준다 —
 * 복제하지 않는다). 속성이 없어졌으면 "리마인더"만.
 */

/** 리마인더 알림의 한 줄. 리마인더가 아니면(서버가 null 을 준다) null. */
export function reminderInboxLine(reminder: { readonly propertyName: string | null } | null): string | null {
  if (reminder === null) return null
  return reminder.propertyName === null ? '리마인더가 울렸습니다.' : `"${reminder.propertyName}" 날짜의 리마인더가 울렸습니다.`
}
