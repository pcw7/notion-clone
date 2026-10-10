/**
 * 엔타이틀먼트 — 이 워크스페이스의 요금제가 무엇을 허락하는가 (잔여 묶음 8k-1 · F-13-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 `plan_entitlement` · 불변식 PE1 · [보강] 엔타이틀먼트
 *       13-adjacent-products.md F-13-18 *"`entitlement(workspace_id, 'charts.max')` 하나의 조회 함수로 통일 … 모든 한도 검사는 서버의 생성
 *       트랜잭션 안에서"*
 *
 * **요금제 분기는 여기 하나다**(PE1) — 부르는 쪽은 요금제 이름을 모른다. 묻는 것은 키 하나이고 받는 것은 그 키의 값이다.
 *
 *   · 키는 닫힌 목록(`ENTITLEMENTS`) — 오타가 컴파일에서 걸린다. 키를 더하면 시드(마이그레이션)와 이 목록을 함께 고친다
 *   · 값의 모양은 종류가 정한다 — boolean 은 참거짓 · limit · duration 은 0 이상의 정수 또는 null(**무제한**) · credit 은 객체
 *   · **줄이 없으면 던진다** — 모든 요금제가 모든 키를 갖는 것은 시드와 검사가 지킨다. 없는 줄을 조용히 기본값으로 메우면 요금제 표와
 *     코드가 다른 말을 하게 된다
 *   · 한도 검사는 그 쓰기의 트랜잭션 안에서 묻는다(`db` 에 트랜잭션을 넘긴다) — 요금제가 그 사이에 바뀌어도 한 시점의 값으로 판정한다
 *   · 네 축(켜고 끄기 · 개수 · 기간 · 크레딧)은 강제 지점이 다르다(13 *"하나의 `hasFeature()` 헬퍼로 통합하려 하면 실패한다"*) — 여기는 값을
 *     줄 뿐이고, 거는 것은 각 기능의 명령이다
 */

import { query } from '../db/pool.ts'
import type { Tx } from '../db/tx.ts'

/** 키 → 종류. 시드(0047 ~)와 같아야 한다 — `entitlement.db.test.ts` 가 맞춘다. */
export const ENTITLEMENTS = {
  /** 버전 보존 일수(F-11-01) — Free 7 · Plus 30 · Business 90 · Enterprise 무제한. */
  'history.days': 'duration',
  /** 게스트 수(F-06-09 · 8k-2) — Free 10 · 나머지 무제한. 활성 게스트 + 받아들이지 않은 게스트 초대의 이메일을 센다. */
  'guests.max': 'limit',
  /** private teamspace 를 만들거나 바꿀 수 있는가(F-06-04 · 8k-2) — Business · Enterprise. */
  'teamspace.private': 'boolean',
  /** 가져오기의 파일 크기 상한(F-09-12 · 8m-1) — Free 5 MiB · 유료 50 MiB(바이트). */
  'import.max_bytes': 'limit',
  /** 휴지통 보관 기간(`workspace.trash_days`)을 바꿀 수 있는가(F-11-06 · 4b-3) — Enterprise 만. */
  'trash.custom_retention': 'boolean',
  /** 자동화의 `send_webhook` 액션(F-08-13 · 5c-1) — Free 만 false(08 *"유료 플랜 전용"*). 저장할 때 막고 실행 때 다시 묻는다. */
  'automation.webhook': 'boolean',
  /** 감사 로그를 읽을 수 있는가(F-11-12 · 6d-2) — Enterprise 만. 쌓는 것은 요금제와 무관하다. */
  'audit.log': 'boolean',
} as const

export type EntitlementKey = keyof typeof ENTITLEMENTS
export type EntitlementKind = (typeof ENTITLEMENTS)[EntitlementKey]
/** 켜고 끄는 키 — 설정의 요금제 게이트 칸이 받는다(정본 §3.1 [보강] 설정 정보구조 ⑦). */
export type BooleanEntitlementKey = { [K in EntitlementKey]: (typeof ENTITLEMENTS)[K] extends 'boolean' ? K : never }[EntitlementKey]

type ValueOfKind = {
  readonly boolean: boolean
  /** null = 무제한. */
  readonly limit: number | null
  /** 일수 · null = 무제한. */
  readonly duration: number | null
  readonly credit: Readonly<Record<string, unknown>>
}
export type EntitlementValue<K extends EntitlementKey> = ValueOfKind[(typeof ENTITLEMENTS)[K]]

type Reader = Pick<Tx, 'query'>
const pool: Reader = { query }

/** 줄의 값을 그 종류의 모양으로 읽는다 — 모양이 틀리면 던진다(표의 CHECK 이 막지만 종류를 바꿔 쓴 키는 여기서 걸린다). */
function readValue(kind: EntitlementKind | string, expected: string, value: unknown, key: string): unknown {
  if (kind !== expected) throw new Error(`엔타이틀먼트 ${key} 의 종류가 ${kind} 다 — 코드는 ${expected} 로 안다`)
  switch (kind) {
    case 'boolean':
      if (typeof value === 'boolean') return value
      break
    case 'limit':
    case 'duration':
      if (value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)) return value
      break
    case 'credit':
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value
      break
  }
  throw new Error(`엔타이틀먼트 ${key} 의 값이 ${kind} 의 모양이 아니다`)
}

/** 이 워크스페이스의 요금제에서 그 키의 값. 쓰기의 한도를 볼 때는 그 트랜잭션을 `db` 로 넘긴다. */
export async function entitlement<K extends EntitlementKey>(workspaceId: string, key: K, db: Reader = pool): Promise<EntitlementValue<K>> {
  const rows = await db.query<{ kind: string; value: unknown }>(
    `SELECT e.kind, e.value
       FROM workspace w
       JOIN plan p ON p.code = w.plan_code
       JOIN plan_entitlement e ON e.plan_id = p.id AND e.key = $2
      WHERE w.id = $1`,
    [workspaceId, key],
  )
  const row = rows[0]
  if (row === undefined) throw new Error(`엔타이틀먼트 ${key} 가 워크스페이스 ${workspaceId} 의 요금제에 없다`)
  return readValue(row.kind, ENTITLEMENTS[key], row.value, key) as EntitlementValue<K>
}
