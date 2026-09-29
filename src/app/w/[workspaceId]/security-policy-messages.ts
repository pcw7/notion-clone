/**
 * 워크스페이스 정책의 문구 — 7g-2조각 (F-06-15 · DOM · DB 없음)
 *
 * 홈의 "정책" 절(`security-policy-form.tsx`)이 쓴다. 판정 · 저장은 서버가 한다(`lib/workspace/security-policy.ts`).
 */

/** 저장한 뒤 — 켰는지 껐는지, 그리고 대기 중이던 밖의 요청이 어떻게 되는지(끄면 목록에서 빠지고 다시 켜면 돌아온다). */
export function policySavedNotice(allowNonmemberRequests: boolean): string {
  return allowNonmemberRequests
    ? '저장했습니다 — 워크스페이스 밖의 사람도 접근을 요청할 수 있습니다.'
    : '저장했습니다 — 워크스페이스 밖의 사람은 요청할 수 없고, 대기 중이던 요청도 목록에서 빠집니다(다시 켜면 돌아옵니다).'
}
