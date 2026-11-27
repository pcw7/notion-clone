/**
 * 사본에서 고칠 수 있는가 — SY7 의 화면 쪽 (SB-3 · F-01-11 · 정본 [보강 SB-0] ⑦ ⑧ [SB-3 고침] · SY7)
 *
 * 고치기 = **A 의 연결이 `edit`**(`edit_content` · 잠기지 않음 — 서버가 정해 embed 연결을 쓸 수 있게 받았다: 스냅숏의 `readOnly === false`)
 * **AND B 의 편집기가 편집 중**(편집 가능 · 제안 모드 아님). 같은 페이지의 사본은 B 의 연결이 곧 A 의 연결이다(B 의 편집 가능이 그것을 담았다).
 *
 *   read_only  쓰기 길이 없는 묶기(`synced-copy-binding.ts` — B 가 읽기 전용 · 제안 모드 · A 를 보기만 · 잠긴 A · 아직 모른다). 아무것도 쓰지
 *              않으므로 보낼 것도 없다
 *   paused     쓰는 묶기이되 지금은 입력을 받지 않는다 — 끊겼다 · 첫 동기화 전 · 다시 여는 중 · 닫혔다(보존본이 없다 — 붙지 않은 동안 고치지
 *              않는다). 묶기를 다시 만들지 않는다(잠깐 끊길 때마다 기록 · 캐럿을 잃지 않게)
 *   editable   고친다
 *
 * DOM · 값 가져오기가 없다 — 지연 청크에 들고 단위 검사가 표로 돌린다(`synced-copy-edit.test.ts`).
 */

import type { CollabSnapshot } from '../collab/collab-connection.ts'

export type CopyEditState = 'read_only' | 'paused' | 'editable'

export type CopyEditInput = {
  /** B 의 편집기가 지금 편집 가능한가(권한 · 잠금 · 연결). */
  readonly outerEditable: boolean
  /** B 의 편집기가 제안 모드인가(SG-1). */
  readonly outerSuggesting: boolean
  /** 붙은 곳 — `same` 이면 B 의 문서(같은 페이지의 사본), 아니면 embed 연결의 스냅숏(없으면 아직 안 붙었다). */
  readonly attachment: 'same' | Pick<CollabSnapshot, 'readOnly' | 'online' | 'synced' | 'reopening' | 'closed'> | null
}

export function copyEditState(input: CopyEditInput): CopyEditState {
  if (!input.outerEditable || input.outerSuggesting) return 'read_only'
  const at = input.attachment
  if (at === 'same') return 'editable'
  // 서버가 A 쪽을 정했다 — 모르면(인증 전 · 다시 여는 중) 쓰지 않는다
  if (at === null || at.readOnly !== false) return 'read_only'
  return at.online && at.synced && !at.reopening && at.closed === null ? 'editable' : 'paused'
}
