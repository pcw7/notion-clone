/**
 * 설정 화면의 문구 — 설정 정보구조 8g-1조각 (F-17-12 · DOM · DB 없음)
 *
 * 서버의 거부 코드(`settings/settings.ts` `SettingFailure`)를 사람의 말로 바꾸는 곳이 여기 하나다. 항목의 이름 · 설명은 레지스트리에
 * 있다(`settings/registry.ts`).
 */

import type { SettingControl } from '@/lib/settings/registry'

export const SETTING_SAVED = '저장했습니다.'

export const SETTING_OFFLINE = '연결에 실패했습니다. 바뀐 내용이 저장되지 않았습니다.'

/** 저장이 거부됐을 때 — 글자 칸이면 몇 자까지인지 함께 말한다. */
export function settingFailureMessage(reason: unknown, control: SettingControl): string {
  switch (reason) {
    case 'forbidden':
      return '이 설정을 바꿀 권한이 없습니다.'
    case 'invalid_value':
      return control.kind === 'text' ? `비워 둘 수 없고, ${control.maxLength}자까지 적을 수 있습니다.` : '값을 확인하세요.'
    case 'not_found':
      return '없는 설정입니다. 새로고침하세요.'
  }
  return '저장하지 못했습니다.'
}
