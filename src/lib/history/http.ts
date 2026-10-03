/**
 * 버전 명령의 거부 → HTTP 상태 (잔여 묶음 8d-1)
 *
 * 빠짐없는 switch 다 — 새 거부가 생기면 컴파일이 멈춘다(`database/http.ts` 의 `databaseFailureStatus` 와 같은 까닭).
 */

import type { VersionFailure } from './version.ts'
import type { RestoreFailure } from './restore.ts'

export function versionFailureStatus(reason: VersionFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'expired':
      // 있었지만 이제 없다 — F-11-02 *"410 + 이 버전은 더 이상 사용할 수 없습니다"*.
      return 410
  }
}

/** 복원의 거부 → HTTP 상태(8d-3). */
export function restoreFailureStatus(reason: RestoreFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'locked':
    case 'conflict':
      // 입력은 맞는데 지금 상태가 허락하지 않는다(잠금 · 깊이 상한).
      return 409
    case 'expired':
      return 410
  }
}
