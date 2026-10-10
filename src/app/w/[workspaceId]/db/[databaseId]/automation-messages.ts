/**
 * DB automation 의 글자 — 트리거 · 액션 요약 · 꺼진 까닭 · 실행 기록 (자동화 5b-3a · 5b-3b · F-08-09 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] DB automation — 화면 ① ⓑ ⓓ · ② ⓔ
 *
 * 속성 이름 · 조건 칩은 부르는 쪽이 준다 — 패널은 그 표의 스키마와 보기의 필터 칩(`describeRule` — "수량 · 초과 · 5")으로 채운다.
 * 액션 · 단계의 까닭은 버튼과 같은 말로 쓴다.
 */

type TriggerLike =
  | { readonly type: 'page_added' }
  | { readonly type: 'property_edited'; readonly propertyId: string; readonly condition: object | null }

type StepLike = { readonly index: number; readonly type: string; readonly status: string; readonly reason?: string }

/** 받침이 있으면 '이', 없으면 '가' — 한글로 끝나지 않으면 '이(가)'. */
export function subjectParticle(word: string): string {
  const last = word.trimEnd().at(-1)
  if (last === undefined) return '이(가)'
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return '이(가)'
  return (code - 0xac00) % 28 === 0 ? '가' : '이'
}

/** 트리거 요약에 필요한 이름 — 속성 이름(사라졌으면 null) · 조건 칩. */
export type TriggerNames = {
  readonly property: (propertyId: string) => string | null
  readonly condition: (trigger: { readonly propertyId: string; readonly condition: object }) => string
}

/** 트리거 한 줄 — 여럿이면 "또는"(하나라도 맞으면 실행한다 · 정본 받기 · 실행 ⓓ). */
export function triggerSummary(triggers: readonly TriggerLike[], names: TriggerNames): string {
  if (triggers.length === 0) return '트리거가 없습니다'
  return triggers
    .map((trigger) => {
      if (trigger.type === 'page_added') return '새 항목이 추가되면'
      const name = names.property(trigger.propertyId) ?? '지워진 속성'
      const edited = `‘${name}’${subjectParticle(name)} 바뀌면`
      return trigger.condition === null ? edited : `${edited} (${names.condition({ propertyId: trigger.propertyId, condition: trigger.condition })})`
    })
    .join(' 또는 ')
}

const ACTION_NAME: Record<string, string> = {
  edit_property: '값 바꾸기',
  add_page_to: '다른 표에 항목 추가',
  send_webhook: '웹훅 보내기',
}

/** 액션 요약 — 종류마다 몇 개("값 바꾸기 · 다른 표에 항목 추가 2"). */
export function actionSummary(actions: readonly { readonly type: string }[]): string {
  if (actions.length === 0) return '할 일이 없습니다'
  const counts = new Map<string, number>()
  for (const action of actions) counts.set(action.type, (counts.get(action.type) ?? 0) + 1)
  return [...counts].map(([type, n]) => `${ACTION_NAME[type] ?? '알 수 없는 액션'}${n > 1 ? ` ${n}` : ''}`).join(' · ')
}

const DISABLED: Record<string, string> = {
  creator_left:
    '만든 사람이 워크스페이스를 떠나 꺼졌습니다. 자동화는 만든 사람의 권한으로 돌아서, 그 사람이 돌아오지 않으면 켜도 다시 꺼집니다 — 새로 만드세요.',
  trigger_broken: '트리거의 속성이 지워져 꺼졌습니다. 트리거를 고친 뒤 켜세요.',
  failures: '실행이 세 번 이어서 실패해 꺼졌습니다. 실행 기록에서 까닭을 보고 고친 뒤 켜세요.',
  webhook_failed: '웹훅을 네 번 보내지 못해 멈췄습니다. 받는 주소가 살아 있는지 확인한 뒤 켜세요.',
}

/** 꺼진 까닭 — 사람이 껐으면(까닭 없음) null. */
export function disabledMessage(reason: string | null): string | null {
  if (reason === null) return null
  return DISABLED[reason] ?? '꺼졌습니다.'
}

const RUN_STATUS: Record<string, string> = { success: '성공', partial: '일부 건너뜀', failed: '실패', running: '도는 중', queued: '기다리는 중' }

export function runStatusLabel(status: string): string {
  return RUN_STATUS[status] ?? status
}

const STEP_STATUS: Record<string, string> = { done: '완료', skipped: '건너뜀', failed: '실패' }
const STEP_REASON: Record<string, string> = {
  forbidden: '권한 없음',
  not_found: '대상을 찾을 수 없음',
  locked: '잠겨 있음',
  unknown_property: '고칠 속성이 사라짐',
  readonly_property: '고칠 수 없는 속성',
  invalid_value: '값이 속성에 맞지 않음',
  unknown_template: '템플릿이 사라짐',
  plan: '요금제가 허락하지 않음',
}

/** 단계 한 줄 — "1. 값 바꾸기 — 건너뜀(권한 없음)". */
export function stepLine(step: StepLike): string {
  const what = ACTION_NAME[step.type] ?? '알 수 없는 액션'
  const status = STEP_STATUS[step.status] ?? step.status
  const why = step.reason === undefined ? '' : `(${STEP_REASON[step.reason] ?? step.reason})`
  return `${step.index + 1}. ${what} — ${status}${why}`
}

const TRIGGER_PROBLEM: Record<string, string> = {
  invalid: '트리거의 모양이 맞지 않습니다.',
  unsupported_trigger: '아직 쓸 수 없는 트리거입니다.',
  no_triggers: '트리거를 하나 이상 넣으세요.',
  too_many_triggers: '트리거는 5개까지입니다.',
  unknown_property: '없는 속성이거나 트리거로 쓸 수 없는 속성입니다.',
  invalid_condition: '조건이 그 속성에 맞지 않습니다.',
}

/**
 * 저장 거절 — 이름 · 상한 · 몇 번째 트리거의 무엇(정본 화면 ② ⓔ). 액션의 거절(`invalid_action`)은 버튼과 같은 말이라 여기서 다루지 않는다
 * (null — 부르는 쪽이 버튼의 글을 쓴다). 모르는 까닭도 null.
 */
export function automationProblemMessage(error: string | undefined, problem: string | undefined, index: number | undefined): string | null {
  if (error === 'invalid_name') return '이름은 1~100자로 넣으세요.'
  if (error === 'too_many') return '한 표의 자동화는 50개까지입니다.'
  if (error !== 'invalid_trigger') return null
  const text = TRIGGER_PROBLEM[problem ?? ''] ?? '트리거를 저장하지 못했습니다.'
  return index === undefined ? text : `${index + 1}번째 트리거: ${text}`
}

const DELIVERY: Record<string, string> = { pending: '보낼 차례', sent: '보냄', failed: '실패', dropped: '버림' }

/** 웹훅 배달의 상태 — "보냄" · "실패(HTTP 500)" · …(5c-3b · 정본 ⑮). */
export function deliveryLabel(state: { readonly status: string; readonly lastStatus: number | null }): string {
  const label = DELIVERY[state.status] ?? state.status
  return state.status === 'failed' && state.lastStatus !== null ? `${label}(HTTP ${state.lastStatus})` : label
}

/**
 * 트리거된 항목 — 제목(빈 글이면 "제목 없음") · 볼 수 없음(null) · 지워짐(키 없음 · 행이 물리 삭제돼 id 가 없다). 정본 화면 ⓓ — relation 의
 * 제목 맵과 같은 셋. 링크는 제목이 있을 때만.
 */
export function runRowLabel(pageId: string | null, titles: Readonly<Record<string, string | null>>): { readonly text: string; readonly linkable: boolean } {
  if (pageId === null || !Object.hasOwn(titles, pageId)) return { text: '지워진 항목', linkable: false }
  const title = titles[pageId]
  if (title === null) return { text: '볼 수 없는 항목', linkable: false }
  return { text: title === '' ? '제목 없음' : title, linkable: true }
}
