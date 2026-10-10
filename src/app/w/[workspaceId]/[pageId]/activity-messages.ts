/**
 * Updates 패널의 글자 — 누가 · 무엇을 (히스토리 · 활동 4d-3 · F-11-04 · 순수)
 *
 * 서버가 준 항목(`notification/page-activity.ts`)을 한 줄로 만든다. 이름 · 제목은 서버가 이미 권한으로 걸렀다 — 여기는 말만 한다.
 */

import type { PageActivityType } from '@/lib/notification/page-activity'

export type ActivityActorView = { readonly name: string; readonly deleted: boolean } | null

/** 일을 한 사람 — 없으면 "시스템", 탈퇴했으면 "삭제된 사용자"(정본 §3.8 [보강] Updates 패널 ④). */
export function activityActorLabel(actor: ActivityActorView): string {
  if (actor === null) return '시스템'
  if (actor.deleted) return '삭제된 사용자'
  return actor.name || '이름 없음'
}

/** 한 일 — 옮기기는 볼 수 있는 목적지일 때만 그 제목을 말한다(정본 ⑤ — 서버가 거른 것만 온다). */
export function activityLine(item: { readonly type: PageActivityType; readonly movedTo: { readonly title: string } | null }): string {
  switch (item.type) {
    case 'page.created':
      return '이 페이지를 만들었습니다'
    case 'page.moved':
      return item.movedTo === null ? '이 페이지를 옮겼습니다' : `‘${item.movedTo.title || '제목 없음'}’ 아래로 옮겼습니다`
    case 'page.trashed':
      return '휴지통으로 보냈습니다'
    case 'block.updated':
      return '편집했습니다'
    case 'property.updated':
      return '속성을 고쳤습니다'
    case 'comment.created':
      return '코멘트를 남겼습니다'
  }
}

export const ACTIVITY_ERRORS: Record<string, string> = {
  not_found: '이 페이지를 찾을 수 없습니다.',
  invalid_cursor: '목록을 다시 열어 주세요.',
}
