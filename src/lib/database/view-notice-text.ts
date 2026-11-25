/**
 * 지운 속성의 조건을 뺀 알림의 문구 (DB 실시간 동기화 RT-3조각 · F-05-16)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] ③ — 05 F-05-16 *"그 조건만 drop 하고 배너 표시"*
 *
 * 화면 문구는 한 곳에서 만든다(단위 검사가 본다). 무엇을 뺐나(필터 · 정렬) · 어느 층인가(나만 보는 것 · 이 뷰) · 왜(삭제 · 유형 바뀜).
 * 남은 조건은 그대로라는 것을 함께 말한다 — 뷰 전체가 풀린 것으로 오해하지 않게.
 */

import type { ViewFilterNotice } from './view.ts'

/** 알림을 보이는 날 — 보관 정리(⑬)가 이보다 오래된 것을 지운다. 새로 들어온 사람이 오래전 일을 보지 않게. */
export const VIEW_NOTICE_DAYS = 30

type NoticeLike = Pick<ViewFilterNotice, 'propertyName' | 'reason' | 'filters' | 'sorts' | 'personal'>

export function viewNoticeText(notice: NoticeLike): string {
  const what = notice.filters > 0 && notice.sorts > 0 ? '필터 · 정렬' : notice.filters > 0 ? '필터' : '정렬'
  const where = notice.personal ? `나만 보는 ${what}` : `이 뷰의 ${what}`
  const why = notice.reason === 'type_changed' ? '유형이 바뀐' : '삭제된'
  return `${where}에서 ${why} 속성 '${notice.propertyName}'의 조건을 뺐습니다. 나머지 조건은 그대로입니다.`
}
