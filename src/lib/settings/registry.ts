/**
 * 설정 레지스트리 — 설정 정보구조 8g-1조각 (F-17-12, DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 정보구조 ① ~ ⑥
 *       17-ops-governance.md F-17-12 *"모든 설정 항목이 어느 계층에 속하고 누가 바꿀 수 있으며 … 코드가 아닌 데이터로 선언하고, 설정
 *       화면·권한 검사·감사 이벤트를 그 선언에서 생성한다"* · 클론 대안 *"TS 상수 객체 1개로 시작해도 좋다"*
 *
 * **설정 항목의 선언은 여기 하나다.** 설정 화면의 내비 · 항목 · 컨트롤, 누가 보고 누가 고치는가, 값의 검사가 전부 이 표에서 나온다.
 * 값을 읽고 쓰는 자리는 키마다 `settings.ts` 가 하나씩 갖는다(값은 그 설정이 이미 사는 칸에 — 정본 ②). 새 설정은 여기에 한 줄,
 * `settings.ts` 에 자리 하나 — 타입이 짝을 본다(`SettingKey`).
 *
 *   · 범위 — 정본의 넷(device · account · workspace · organization) 중 지금 쓰는 것은 account · workspace 둘이다(③)
 *   · 묶음 · 절 — 설정 화면의 왼쪽 내비. 범위마다 묶음 하나, 그 안에 절
 *   · 누가 — 워크스페이스 **역할 이름**으로 묻는다(④ — 설정은 노드가 아니라 권한 레벨이 아니다). 보이지 않으면 화면에 없고 쓰기는
 *     거부된다. 보이지만 고칠 수 없으면 읽기 전용으로 선다. 고치는 사람은 늘 보는 사람 안에 있다(검사가 본다)
 *
 * 플랜 게이트(F-13-18)는 정의의 `requires` — boolean 엔타이틀먼트 키다(⑦ · 4b-3). 그 키가 거짓인 워크스페이스에서 항목은 보이되 읽기
 * 전용이고, 쓰기는 `plan_required` 다(판정은 `settings.ts` — 이 모듈은 DB 를 보지 않는다). 감사 이벤트(F-11-12) · 조직 잠금(F-17-13)은
 * 그 표가 생길 때 정의의 칸으로 더한다(⑥).
 *
 * 값 하나로 그릴 수 없는 관리 화면(사람 · 내보내기)은 이 표의 항목이 아니라 절 안의 **패널**이다(`panels.ts` · 8g-2) — 절은 여기에
 * 선언하고, 패널이 선 절도 내비에 선다(`visibleSettingGroups` 의 둘째 인자).
 */

import type { WorkspaceRole } from '../auth/session-context.ts'
import type { BooleanEntitlementKey } from '../billing/entitlement.ts'

/** 지금 쓰는 범위 — `device`(12 의 테마 · 고대비)와 `organization`(조직 기능)은 그것이 생길 때 더한다(정본 ③). */
export type SettingScope = 'account' | 'workspace'

export type SettingControl =
  /** 한 줄 글자 — 앞뒤 공백을 떼고 연속 공백을 하나로 접은 뒤 1 ~ `maxLength` 자. */
  | { readonly kind: 'text'; readonly maxLength: number }
  /** 켜고 끄기. */
  | { readonly kind: 'toggle' }
  /** 몇 가지 중 하나 고르기(8h) — 값은 `options` 의 `value` 중 하나. */
  | { readonly kind: 'choice'; readonly options: readonly { readonly value: string; readonly label: string }[] }
  /** 정수 하나(4b-3 · 정본 ⑧) — `min` ~ `max` · 화면은 값 뒤에 `unit` 을 붙인다. */
  | { readonly kind: 'number'; readonly min: number; readonly max: number; readonly unit: string }

/** 테마 — `system` 은 OS 를 따른다(기본 · 정본 [보강] 설정 값 표 · 테마 ③). 루트 레이아웃 · 단축키가 이 값을 쓴다. */
export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
export const DEFAULT_THEME: Theme = 'system'
export const isTheme = (value: unknown): value is Theme => typeof value === 'string' && (THEMES as readonly string[]).includes(value)
const THEME_LABEL: Readonly<Record<Theme, string>> = { system: '시스템 설정 따르기', light: '밝게', dark: '어둡게' }

/**
 * 단축키(Ctrl/Cmd + Shift + L)가 고를 테마 — **지금 보이는 것의 반대**다(정본 [보강] 설정 값 표 · 테마 ④). `system` 이면 OS 가 고른 것의
 * 반대다. 결과는 늘 밝게 · 어둡게 중 하나 — 단축키로 `system` 에 돌아가지 않는다(설정 화면에서 고른다).
 */
export function toggledTheme(current: Theme, osPrefersDark: boolean): Exclude<Theme, 'system'> {
  const showing = current === 'system' ? (osPrefersDark ? 'dark' : 'light') : current
  return showing === 'dark' ? 'light' : 'dark'
}

export type SettingValue = string | boolean | number

/** 누가 — 모두(게스트 포함)이거나 역할 목록. */
export type Audience = 'everyone' | readonly WorkspaceRole[]

/** 게스트를 뺀 모든 역할 — 워크스페이스 범위를 보는 사람(정본 ④). */
const MEMBERS = ['owner', 'membership_admin', 'member', 'restricted_member'] as const satisfies readonly WorkspaceRole[]
const OWNER = ['owner'] as const satisfies readonly WorkspaceRole[]

/** 설정 화면의 왼쪽 내비 — 범위마다 묶음 하나 · 그 안의 절. 항목이 하나도 보이지 않는 절 · 묶음은 서지 않는다. */
export const SETTING_GROUPS = [
  {
    scope: 'account',
    label: '내 계정',
    sections: [
      { id: 'account.profile', label: '프로필' },
      { id: 'account.preferences', label: '환경설정' },
      { id: 'account.security', label: '보안' },
    ],
  },
  {
    scope: 'workspace',
    label: '워크스페이스',
    sections: [
      { id: 'workspace.general', label: '일반' },
      { id: 'workspace.people', label: '사람' },
      { id: 'workspace.security', label: '보안' },
      // 요금제(8k-3) — 지금 요금제 · 한도와 쓴 양 · 비교. 소유자 · 멤버 관리자에게만(패널 하나로 선다).
      { id: 'workspace.plan', label: '요금제' },
    ],
  },
] as const satisfies readonly {
  readonly scope: SettingScope
  readonly label: string
  readonly sections: readonly { readonly id: string; readonly label: string }[]
}[]

export type SettingSectionId = (typeof SETTING_GROUPS)[number]['sections'][number]['id']

export type SettingDefinition = {
  readonly key: string
  readonly scope: SettingScope
  readonly section: SettingSectionId
  readonly label: string
  readonly description: string
  readonly control: SettingControl
  /** 이 항목이 화면에 서는 사람. */
  readonly viewers: Audience
  /** 고칠 수 있는 사람 — `viewers` 안에 있어야 한다. */
  readonly editors: Audience
  /** 요금제 게이트(정본 ⑦) — 이 키가 거짓인 워크스페이스에서는 보이되 고칠 수 없다(`plan_required`). 없으면 모든 요금제. */
  readonly requires?: BooleanEntitlementKey
}

/** 모든 설정 — 화면의 순서이기도 하다. */
export const SETTINGS = [
  {
    key: 'account.name',
    scope: 'account',
    section: 'account.profile',
    label: '이름',
    description: '다른 사람에게 보이는 이름입니다. 멤버 목록 · 코멘트 · 멘션 · 공유 목록에 나오고, 모든 워크스페이스에서 같습니다.',
    control: { kind: 'text', maxLength: 100 },
    viewers: 'everyone',
    editors: 'everyone',
  },
  {
    key: 'account.theme',
    scope: 'account',
    section: 'account.preferences',
    label: '테마',
    description: '모든 워크스페이스에서 같습니다. 어디서든 Ctrl/Cmd + Shift + L 로 밝게와 어둡게를 바꿀 수 있습니다.',
    control: { kind: 'choice', options: THEMES.map((value) => ({ value, label: THEME_LABEL[value] })) },
    viewers: 'everyone',
    editors: 'everyone',
  },
  {
    key: 'workspace.name',
    scope: 'workspace',
    section: 'workspace.general',
    label: '워크스페이스 이름',
    description: '사이드바 맨 위와 워크스페이스 목록에 나옵니다.',
    control: { kind: 'text', maxLength: 100 },
    viewers: MEMBERS,
    editors: OWNER,
  },
  {
    key: 'workspace.allow_nonmember_page_access_request',
    scope: 'workspace',
    section: 'workspace.security',
    label: '워크스페이스 밖의 사람의 접근 요청',
    description:
      '가입했지만 이 워크스페이스의 멤버가 아닌 사람이 페이지 주소에서 접근을 요청할 수 있습니다. 끄면 그 주소는 없는 페이지로 보이고, ' +
      '대기 중이던 요청도 목록에서 빠집니다(다시 켜면 돌아옵니다).',
    control: { kind: 'toggle' },
    viewers: OWNER,
    editors: OWNER,
  },
  {
    key: 'workspace.trash_days',
    scope: 'workspace',
    section: 'workspace.security',
    label: '휴지통 보관 기간',
    description:
      '휴지통에 넣은 페이지가 이 기간이 지나면 영구 삭제됩니다. 바꾼 기간은 지금부터 버리는 것에 적용됩니다 — 이미 휴지통에 있는 것은 ' +
      '버릴 때의 기간을 따릅니다.',
    control: { kind: 'number', min: 1, max: 3650, unit: '일' },
    viewers: OWNER,
    editors: OWNER,
    requires: 'trash.custom_retention',
  },
] as const satisfies readonly SettingDefinition[]

export type SettingKey = (typeof SETTINGS)[number]['key']

type DefinitionOf<K extends SettingKey> = Extract<(typeof SETTINGS)[number], { readonly key: K }>
/** 키의 값 모양 — 컨트롤이 정한다(고르기는 그 선택지의 값 중 하나). */
export type SettingValueOf<K extends SettingKey> = DefinitionOf<K>['control'] extends { readonly kind: 'toggle' }
  ? boolean
  : DefinitionOf<K>['control'] extends { readonly kind: 'number' }
    ? number
    : DefinitionOf<K>['control'] extends { readonly kind: 'choice'; readonly options: readonly (infer O)[] }
      ? O extends { readonly value: infer V } ? V : never
      : string

const reaches = (audience: Audience, role: WorkspaceRole): boolean => audience === 'everyone' || audience.includes(role)

export const canSeeSetting = (definition: SettingDefinition, role: WorkspaceRole): boolean => reaches(definition.viewers, role)

/** 고칠 수 있는가 — 보이지 않는 것은 고칠 수 없다. */
export const canEditSetting = (definition: SettingDefinition, role: WorkspaceRole): boolean =>
  canSeeSetting(definition, role) && reaches(definition.editors, role)

/** 이 설정을 고치는 데 필요한 엔타이틀먼트 — 없으면 null(모든 요금제). */
export const requiredEntitlement = (definition: SettingDefinition): BooleanEntitlementKey | null => definition.requires ?? null

/** 키 → 정의. 모르는 키면 null — 라우트가 주소에서 받는 값이라 문자열로 묻는다. */
export function settingDefinition(key: string): (typeof SETTINGS)[number] | null {
  return SETTINGS.find((d) => d.key === key) ?? null
}

/** 받은 값을 이 설정의 값으로 — 컨트롤의 규칙에 맞지 않으면 null. */
export function normalizeSettingValue(definition: SettingDefinition, raw: unknown): SettingValue | null {
  const control = definition.control
  if (control.kind === 'toggle') return typeof raw === 'boolean' ? raw : null
  if (control.kind === 'number') {
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= control.min && raw <= control.max ? raw : null
  }
  if (typeof raw !== 'string') return null
  if (control.kind === 'choice') return control.options.some((option) => option.value === raw) ? raw : null
  const text = raw.trim().replace(/\s+/g, ' ')
  return text.length === 0 || text.length > control.maxLength ? null : text
}

/**
 * 이 역할에게 서는 내비 — 보이는 항목이나 보이는 패널이 하나라도 있는 절만, 절이 하나라도 있는 묶음만.
 *
 * @param panelSections 이 사람에게 보이는 패널의 절(`panels.ts` `visiblePanels`). 패널의 판정은 그 기능의 것이라 여기서 다시 짓지 않는다.
 */
export function visibleSettingGroups(role: WorkspaceRole, panelSections: readonly string[] = []) {
  return SETTING_GROUPS.map((group) => ({
    scope: group.scope,
    label: group.label,
    sections: group.sections.filter(
      (section) => panelSections.includes(section.id) || SETTINGS.some((d) => d.section === section.id && canSeeSetting(d, role)),
    ),
  })).filter((group) => group.sections.length > 0)
}

const ROLE_LABEL: Readonly<Record<WorkspaceRole, string>> = {
  owner: '소유자',
  membership_admin: '멤버 관리자',
  member: '멤버',
  restricted_member: '제한된 멤버',
  guest: '게스트',
}

/** 역할의 이름 — 화면 표시 전용(스위처 · 설정의 "누가 고치는가"). 모르는 값은 그대로. */
export const roleLabel = (role: string): string => ROLE_LABEL[role as WorkspaceRole] ?? role

/** 읽기 전용으로 설 때 누가 고칠 수 있는지 — "소유자만 바꿀 수 있습니다". 모두가 고칠 수 있으면 null. */
export function editorsNote(definition: SettingDefinition): string | null {
  if (definition.editors === 'everyone') return null
  return `${definition.editors.map((role) => ROLE_LABEL[role]).join(' · ')}만 바꿀 수 있습니다.`
}
