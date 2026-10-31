/**
 * 붙인 뷰의 화면 권한 — 동작마다 (N-2 · F-04-13 · 정본 §3.6 [보강] 다중 data source ⑫ [N-2])
 *
 * 다른 데이터베이스의 소스를 붙인 뷰(2l-3)에서 화면이 여는 동작은 서버가 묻는 쪽을 그대로 따른다:
 *
 *   원본(소스의 주인 데이터베이스)   칸 · 행 만들기 · 속성 · 옵션 · 템플릿            → `access`
 *   그릇(뷰의 데이터베이스)          뷰 안의 차례(`row_position`) · 열 집계 · 그룹 숨기기 · 기본 템플릿 → `viewAccess`
 *   둘 다                            보드의 카드 끌기 · 옮기기 메뉴(칸 + 자리) · 칼럼 메뉴(속성 + 뷰 설정)
 *
 * 전에는 둘의 교집합 하나로 열어서(§3.2-139 ①) 그릇은 볼 수만 있고 원본은 고칠 수 있는 사람에게 칸이 닫혔다 — 서버는 허락하는데
 * 화면이 과소 표시했다(§7). 도구줄 · 탭 · 소스 창 · 이름은 뷰 · 그릇의 것이라 이 모듈을 거치지 않는다(`page.tsx` 의 `access`).
 *
 * 순수 모듈이다 — 화면(클라이언트)이 함께 읽으므로 DB 모듈을 들이지 않는다.
 */

import type { DatabaseAccess } from './database.ts'

/** 뷰 안의 일에 쓰는 그릇의 권한 — 차례(`canEditContent`) · 뷰 설정(`canEditStructure`). */
export type ViewAccess = {
  readonly canEditContent: boolean
  readonly canEditStructure: boolean
}

/** 원본을 볼 수 없는 사람 — 모든 것이 닫힌다(그 뷰는 "접근 권한 없음"이다 · 2l-3). */
export const NO_DATABASE_ACCESS: DatabaseAccess = {
  canViewAllRows: false,
  canEditContent: false,
  canCreateRows: false,
  canEditStructure: false,
}

/**
 * 붙인 뷰의 두 권한을 가른다.
 *
 * - `original === null` — 소유한 소스의 뷰. 둘 다 그릇(= 원본)의 것이다.
 * - `original === 'hidden'` — 원본을 볼 수 없다. 내용은 모두 닫히고 뷰 안의 일도 닫는다(열리지 않는 뷰다).
 * - 아니면 내용은 원본의 것, 뷰 안의 일은 그릇의 것이다.
 */
export function splitLinkedAccess(
  container: DatabaseAccess,
  original: DatabaseAccess | 'hidden' | null,
): { readonly access: DatabaseAccess; readonly viewAccess: ViewAccess } {
  if (original === null) return { access: container, viewAccess: viewAccessOf(container) }
  if (original === 'hidden') return { access: NO_DATABASE_ACCESS, viewAccess: viewAccessOf(NO_DATABASE_ACCESS) }
  return { access: original, viewAccess: viewAccessOf(container) }
}

/** 데이터베이스 권한에서 뷰 안의 일에 쓰는 둘만. */
export function viewAccessOf(access: DatabaseAccess): ViewAccess {
  return { canEditContent: access.canEditContent, canEditStructure: access.canEditStructure }
}
