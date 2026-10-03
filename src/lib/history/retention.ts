/**
 * 버전의 보관 기간 — 요금제마다 (잔여 묶음 8d-1 · F-11-01 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.7 [보강] 버전 기록 ④ · `page_version.expires_at`(*"생성 시점 플랜으로 고정. 조회 시 재계산 금지"*)
 *       11-history-notifications.md F-11-01 *"플랜 차이는 보관 기간뿐 — Free 7일 / Plus 30일 / Business 90일 / Enterprise Any number of days"*
 *
 * 값을 코드에 두는 것은 임시다 — 엔타이틀먼트 표(`plan_entitlement` · 필수 키 `history.days`)가 아직 스키마에 없다(8k). 그 표가 들어오면
 * 이 함수 하나가 `entitlement(workspace_id, 'history.days')` 를 묻는다(불변식 PE1 — 요금제 분기를 코드에 흩뿌리지 않는다 · 파일 크기
 * 상한 `file/limits.ts` 와 같은 처지).
 */

/** 요금제 → 보관 일수. 무제한(Enterprise)은 null. */
const HISTORY_DAYS: Readonly<Record<string, number | null>> = {
  free: 7,
  plus: 30,
  business: 90,
  enterprise: null,
}

/** 이 요금제의 버전 보관 일수 — 무제한이면 null. 모르는 요금제는 가장 짧은 값(Free)이다 — 길게 잡아 약속하지 않은 보관을 하지 않는다. */
export function versionRetentionDays(planCode: string): number | null {
  return Object.hasOwn(HISTORY_DAYS, planCode) ? HISTORY_DAYS[planCode] : HISTORY_DAYS.free
}
