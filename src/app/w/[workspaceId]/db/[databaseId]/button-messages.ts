/**
 * 버튼 속성의 글자 — 실행 결과 한 줄 · 편집기 거절의 까닭 (자동화 5a-3 · 5c-3a · F-03-15 · F-08-13 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ④ ⑩ ⑭
 *
 * 액션의 거절(`buttonActionProblemMessage`)은 DB automation 편집기도 쓴다 — 같은 액션 · 같은 검사다.
 */

export type ButtonTone = 'ok' | 'warn' | 'error'

type RunLike = { readonly status: string; readonly steps: readonly { readonly status: string; readonly reason?: string }[] }

const FAILED_REASON: Record<string, string> = {
  unknown_property: '고칠 속성이 사라졌습니다',
  readonly_property: '고칠 수 없는 속성입니다',
  invalid_value: '값이 그 속성에 맞지 않습니다',
  unknown_template: '템플릿이 사라졌습니다',
}

const REFUSED: Record<string, string> = {
  forbidden: '이 표의 값을 고칠 권한이 없습니다.',
  not_found: '버튼을 찾을 수 없습니다.',
  disabled: '꺼진 버튼입니다.',
  invalid_key: '다시 눌러 주세요.',
}

/** 누른 결과 한 줄 — 실행 기록이 있으면 그 상태로, 없으면(거절) 서버의 까닭으로. */
export function buttonRunMessage(run: RunLike | null, error?: string): { readonly text: string; readonly tone: ButtonTone } {
  if (run === null) return { text: REFUSED[error ?? ''] ?? '실행하지 못했습니다.', tone: 'error' }
  if (run.status === 'success') {
    return run.steps.length === 0 ? { text: '할 일이 없습니다 — "버튼 설정"에서 액션을 더하세요.', tone: 'warn' } : { text: '완료', tone: 'ok' }
  }
  if (run.status === 'partial') {
    const skipped = run.steps.filter((s) => s.status === 'skipped').length
    return { text: `일부를 건너뛰었습니다 — ${skipped}개(권한 · 잠금)`, tone: 'warn' }
  }
  const failed = run.steps.find((s) => s.status === 'failed')
  const why = failed?.reason === undefined ? undefined : FAILED_REASON[failed.reason]
  return { text: `실행하지 못했습니다${why === undefined ? '' : ` — ${why}`}. 아무것도 바뀌지 않았습니다.`, tone: 'error' }
}

const PROBLEM: Record<string, string> = {
  invalid: '액션의 모양이 맞지 않습니다.',
  unsupported_action: '아직 실행할 수 없는 액션입니다.',
  too_many_actions: '액션은 20개까지입니다.',
  too_many_cells: '한 액션의 값은 50개까지입니다.',
  empty_cells: '바꿀 값을 하나 이상 넣으세요.',
  unknown_property: '없는 속성이거나 값을 넣을 수 없는 속성입니다.',
  readonly_property: '읽기 전용 속성입니다.',
  invalid_value: '값이 그 속성에 맞지 않습니다.',
  unknown_data_source: '볼 수 없는 표입니다.',
  unknown_template: '그 표의 템플릿이 아닙니다.',
  invalid_url: '받는 주소는 https 로 시작하는 바깥 주소여야 합니다.',
  invalid_header: '헤더가 맞지 않습니다 — 이름은 영문 · 숫자 · 하이픈, 정해진 이름(Host · Content-Type …)은 못 쓰고, 값은 1,024자 · 10개까지입니다.',
  too_many_webhooks: '웹훅은 다섯 개까지입니다.',
  unknown_ref: '받는 주소와 헤더 값을 넣으세요 — 그대로 둘 저장된 값이 없습니다.',
  plan_required: '이 요금제에서는 웹훅을 보낼 수 없습니다.',
}

/** 버튼 설정의 거절 — 몇 번째 액션의 무엇이 틀렸나. */
export function buttonActionProblemMessage(problem: string | undefined, index: number | undefined): string {
  const text = PROBLEM[problem ?? ''] ?? '버튼을 저장하지 못했습니다.'
  return index === undefined ? text : `${index + 1}번째 액션: ${text}`
}
