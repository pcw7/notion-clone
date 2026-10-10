/**
 * 페이지 활동의 허용 목록 — Updates 패널(4d-3)과 페이지 웹훅(4e-2)이 함께 쓴다
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] Updates 패널 ② · [보강] 페이지 웹훅 ⑤
 *
 * 이 파일은 아무것도 부르지 않는다 — `recordActivity`(활동 기록의 중심)가 웹훅으로 보낼지 고를 때 이 목록을 읽는데, 무거운 모듈을 끌고
 * 오면 활동 · 페이지 모듈과 순환한다.
 */

import type { ActivityType } from './activity.ts'

/** 보이는 · 보내는 종류(허용 목록). `suggestion.*` 은 제안 편집이 생길 때 더한다. */
export const PAGE_ACTIVITY_TYPES = [
  'page.created',
  'page.moved',
  'page.trashed',
  'block.updated',
  'property.updated',
  'comment.created',
] as const satisfies readonly ActivityType[]
export type PageActivityType = (typeof PAGE_ACTIVITY_TYPES)[number]

const SET: ReadonlySet<string> = new Set(PAGE_ACTIVITY_TYPES)
export const isPageActivityType = (type: string): type is PageActivityType => SET.has(type)
