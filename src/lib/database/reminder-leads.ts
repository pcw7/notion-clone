/**
 * 리마인더의 리드 — 서버(검사)와 화면(메뉴 · 이름표)이 함께 쓰는 목록과 말 (히스토리 · 활동 4c-1 · 4c-3 · F-11-10 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑥ · ⑨
 *
 *   · 리드는 날짜 값의 모양마다 다르다 — 날짜만이면 그날 · 하루 · 이틀 · 일주일 전(모두 오전 9시 — 날짜만의 시각은 그날 09:00 이다),
 *     시각이 있으면 그 시각 · 5 · 10 · 15 · 30분 · 1 · 2시간 · 하루 전. 반복은 없다
 *   · 서버는 이 목록으로 거부하고(`invalid_lead`), 화면은 이 목록만 메뉴에 세운다 — 두 벌이면 화면이 고를 수 있는 것을 서버가 거부한다
 */

/** 날짜만인 값 — 그날 · 하루 · 이틀 · 일주일 전(모두 09:00). */
export const DATE_ONLY_LEADS = [0, 1440, 2880, 10080] as const
/** 시각이 있는 값 — 그 시각 · 5 · 10 · 15 · 30분 · 1 · 2시간 · 하루 전. */
export const DATE_TIME_LEADS = [0, 5, 10, 15, 30, 60, 120, 1440] as const

/** 날짜만인 값인가 — 시각이 있으면 `T` 가 붙는다(셀의 ISO 규칙 · `property-types.ts`). */
export const isDateOnlyStart = (start: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(start)

/** 그 값에 고를 수 있는 리드. */
export const leadsFor = (start: string): readonly number[] => (isDateOnlyStart(start) ? DATE_ONLY_LEADS : DATE_TIME_LEADS)

const DAY_LABEL: Readonly<Record<number, string>> = { 0: '그날', 1440: '하루 전', 2880: '이틀 전', 10080: '일주일 전' }

/** 리드를 사람의 말로 — 날짜만이면 "하루 전 오전 9시", 시각이면 "30분 전". 목록 밖이면 분으로 말한다. */
export function leadLabel(leadMinutes: number, dateOnly: boolean): string {
  if (dateOnly) {
    const day = DAY_LABEL[leadMinutes]
    return day === undefined ? `${leadMinutes}분 전` : `${day} 오전 9시`
  }
  if (leadMinutes === 0) return '그 시각'
  if (leadMinutes % 1440 === 0) return leadMinutes === 1440 ? '하루 전' : `${leadMinutes / 1440}일 전`
  if (leadMinutes % 60 === 0) return `${leadMinutes / 60}시간 전`
  return `${leadMinutes}분 전`
}
