/**
 * 알림 메시지의 토큰 글 ↔ 칩 조각 — 알림 편집 칸(`notify-editor.tsx`)이 쓴다 (자동화 AN-2 · F-08-07)
 *
 * 서버 `src/lib/automation/actions.ts` 의 `NOTIFY_SLOT` 과 **같은 모양**이어야 한다 — 그 파일은 서버 쪽 import 가 딸려 와 화면에서 가져오지
 * 않으므로 여기 한 벌을 두고, `notify-message.test.ts` 가 두 정규식의 원문이 같은지 본다. 처음 옮겨 적을 때 `\s` 의 역슬래시가 빠져
 * `[^{}s]` 가 되었고, 속성 id 에 소문자 s 가 든 슬롯만 칩이 되지 않았다(id 가 무작위라 e2e 가 흔들리는 것처럼 보였다).
 */

export const MAX_NOTIFY_USERS = 20
export const MAX_NOTIFY_MESSAGE = 500
export const NOTIFY_SLOT = /\{\{row:([^{}\s]{1,64})\}\}/g

/** 토큰 글 → [글, 슬롯, 글, 슬롯, 글] 조각(짝수 칸이 글 · 홀수 칸이 속성 id). */
export function splitNotifyMessage(message: string): string[] {
  const parts: string[] = []
  let last = 0
  for (const m of message.matchAll(new RegExp(NOTIFY_SLOT.source, 'g'))) {
    parts.push(message.slice(last, m.index), m[1]!)
    last = m.index + m[0].length
  }
  parts.push(message.slice(last))
  return parts
}

/** 조각 → 토큰 글. */
export const joinNotifyMessage = (parts: readonly string[]): string => parts.map((s, i) => (i % 2 === 1 ? `{{row:${s}}}` : s)).join('')
