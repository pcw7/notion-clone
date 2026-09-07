/**
 * 레벨 · capability 모델.
 *
 * 정본: docs/research/00-canonical-data-model.md §3.3 level_capability, §3.11 MAX_BY_CAP
 *
 * **규칙 A2: level 은 전순서가 아니다.**
 * `create` 는 `view` 를 포함하지 않는다(폼 제출처럼 "내용은 못 보면서 추가만" 하는 경우).
 * 따라서 레벨을 정수로 매겨 MAX 를 취하면 안 된다. 그 순간 `create` 만 가진 사용자가
 * `view` 를 얻거나, `view` 를 가진 사용자가 `create` 를 잃는다.
 *
 * 이 모듈은 레벨 비교 함수를 **의도적으로 제공하지 않는다.** 두 레벨 중 무엇이 큰지
 * 묻는 질문 자체가 잘못됐다. 물어야 할 것은 "이 capability 를 갖는가" 뿐이다.
 *
 * 권한 판정의 진실은 `CapSet` 이다. `Level` 은 화면에 보여주기 위한 라벨일 뿐이며,
 * 판정에 다시 집어넣으면 안 된다 — `displayLevel()` 주석 참조.
 */

export const CAPABILITIES = [
  'view',
  'comment',
  'edit_content',
  'create_child',
  'edit_structure',
  'share',
  'manage_perm',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export const LEVELS = ['view', 'comment', 'edit_content', 'create', 'edit', 'full_access'] as const
export type Level = (typeof LEVELS)[number]

export const TARGET_KINDS = ['page', 'database', 'teamspace', 'form_submitter'] as const
export type TargetKind = (typeof TARGET_KINDS)[number]

/** capability 비트마스크. 0 = 아무 권한 없음(정본의 level 'none' 에 해당). */
export type CapSet = number & { readonly __capSet?: never }

export const NO_CAPABILITIES = 0 as CapSet

const BIT: Record<Capability, number> = {
  view: 1 << 0,
  comment: 1 << 1,
  edit_content: 1 << 2,
  create_child: 1 << 3,
  edit_structure: 1 << 4,
  share: 1 << 5,
  manage_perm: 1 << 6,
}

/**
 * 정본 §3.3 의 표를 그대로 옮긴 것. DB 의 level_capability 와 **같은 내용**이어야 한다.
 * 두 곳이 어긋나면 levels.db.test.ts 가 실패한다.
 *
 * teamspace / form_submitter 는 정본 문서에 행이 정의되어 있지 않다.
 * 추측해서 채우지 않는다 — 필요해지면 정본 문서를 먼저 고친다.
 */
const MATRIX: Partial<Record<TargetKind, Partial<Record<Level, readonly Capability[]>>>> = {
  page: {
    full_access: ['view', 'comment', 'edit_content', 'create_child', 'edit_structure', 'share', 'manage_perm'],
    edit: ['view', 'comment', 'edit_content', 'create_child', 'edit_structure'],
    comment: ['view', 'comment'],
    view: ['view'],
  },
  database: {
    full_access: ['view', 'comment', 'edit_content', 'create_child', 'edit_structure', 'share', 'manage_perm'],
    edit: ['view', 'comment', 'edit_content', 'create_child', 'edit_structure'],
    edit_content: ['view', 'comment', 'edit_content', 'create_child'],
    // view 가 없다. 이 한 줄이 이 모듈 전체의 존재 이유다.
    create: ['create_child'],
    comment: ['view', 'comment'],
    view: ['view'],
  },
}

function maskOf(caps: readonly Capability[]): CapSet {
  let m = 0
  for (const c of caps) m |= BIT[c]
  return m as CapSet
}

/** 이 (대상 종류, 레벨) 조합이 정본에 정의되어 있는가. */
export function isDefinedLevel(targetKind: TargetKind, level: Level): boolean {
  return MATRIX[targetKind]?.[level] !== undefined
}

/**
 * 하나의 grant 가 주는 capability 집합.
 * 정본에 정의되지 않은 조합이면 던진다 — 조용히 0 을 돌려주면
 * "권한이 없다"와 "정의가 없다"가 구분되지 않는다.
 */
export function capabilitiesOf(targetKind: TargetKind, level: Level): CapSet {
  const caps = MATRIX[targetKind]?.[level]
  if (caps === undefined) {
    throw new Error(
      `level_capability 에 (${targetKind}, ${level}) 행이 없습니다. ` +
        `정본 문서(00-canonical-data-model.md §3.3)에 정의를 먼저 추가하세요.`,
    )
  }
  return maskOf(caps)
}

export type Grant = { readonly targetKind: TargetKind; readonly level: Level }

/**
 * MAX_BY_CAP — capability 비트마스크 OR.
 *
 * 정본 §3.11: "capability 비트마스크 OR 후 가장 가까운 표시용 레벨로 환원.
 * **단순 정수 MAX 금지**(규칙 A2)."
 *
 * 반환값은 판정에 쓰는 진실이다. 레벨로 되돌리지 말고 이대로 `can()` 에 넣는다.
 */
export function maxByCap(grants: readonly Grant[]): CapSet {
  let m = 0
  for (const g of grants) m |= capabilitiesOf(g.targetKind, g.level)
  return m as CapSet
}

/** capability 합집합. 이미 CapSet 인 값들을 합칠 때. */
export function unionCaps(...sets: readonly CapSet[]): CapSet {
  let m = 0
  for (const s of sets) m |= s
  return m as CapSet
}

/** 권한 판정의 유일한 물음. */
export function can(caps: CapSet, capability: Capability): boolean {
  return (caps & BIT[capability]) !== 0
}

/** 디버깅·감사 로그용. 판정에 쓰지 말 것. */
export function capabilityList(caps: CapSet): Capability[] {
  return CAPABILITIES.filter((c) => (caps & BIT[c]) !== 0)
}

/**
 * **화면 표시 전용.** 판정에 다시 넣지 마라.
 *
 * capability 집합은 어떤 레벨과도 정확히 일치하지 않을 수 있다.
 * 예: `create`(create_child) 와 `view`(view) 를 동시에 받으면 {view, create_child} 인데
 * 이 집합을 가진 레벨은 없다.
 *
 * 그래서 **capability 집합의 부분집합인 레벨 중 가장 많은 것**을 고른다.
 * 올림(가장 가까운 상위 레벨)을 하면 사용자가 실제로 갖지 않은 권한을
 * 가진 것처럼 보여주게 되고, 그 라벨이 다시 판정에 쓰이면 권한 상승이 된다.
 * 내려서 표시하는 것은 안전하지만 과소 표시일 수 있다 — 그래서 표시 전용이다.
 *
 * 어떤 레벨도 부분집합이 아니면 null(= 표시할 레벨 없음).
 */
export function displayLevel(targetKind: TargetKind, caps: CapSet): Level | null {
  let best: Level | null = null
  let bestCount = -1
  for (const level of LEVELS) {
    if (!isDefinedLevel(targetKind, level)) continue
    const m = capabilitiesOf(targetKind, level)
    // 부분집합인가: m 의 모든 비트가 caps 에 있는가
    if ((m & ~caps) !== 0) continue
    const count = capabilityList(m).length
    if (count > bestCount) {
      best = level
      bestCount = count
    }
  }
  return best
}
