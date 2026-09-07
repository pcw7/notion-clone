/**
 * 브랜디드 ID 타입.
 *
 * 정본 스키마의 식별자는 대부분 uuid 이고, TypeScript 에서는 전부 그냥 `string` 이다.
 * `effective(userId, workspaceId)` 를 `effective(workspaceId, userId)` 로 잘못 부르면
 * 타입 검사를 통과하고 런타임에도 조용히 잘못된 답을 낸다. 권한 코드에서 이건 사고다.
 *
 * 브랜드를 붙여 서로 대입되지 않게 만든다. 런타임 표현은 여전히 string 이므로
 * 비용은 0이다.
 */

declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

export type UserId = Brand<string, 'UserId'>
export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type OrganizationId = Brand<string, 'OrganizationId'>
export type SessionId = Brand<string, 'SessionId'>
export type BlockId = Brand<string, 'BlockId'>
export type TeamspaceId = Brand<string, 'TeamspaceId'>
export type GroupId = Brand<string, 'GroupId'>
export type UserEmailId = Brand<string, 'UserEmailId'>

/** property.id 는 uuid 가 아니라 전역 유니크 text 다 — 정본 C-4/V-7. */
export type PropertyId = Brand<string, 'PropertyId'>

/** region.id 는 'us' 같은 짧은 text 다. */
export type RegionId = Brand<string, 'RegionId'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * 외부에서 들어온 문자열(URL 파라미터, 요청 본문, DB 로우)을 ID 로 승격한다.
 * 형식이 아니면 던진다 — 잘못된 값이 권한 판정까지 흘러가지 않게 입구에서 막는다.
 */
function uuidAs<T extends Brand<string, string>>(value: unknown, label: string): T {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new TypeError(`${label} 가 uuid 형식이 아닙니다: ${JSON.stringify(value)}`)
  }
  return value as T
}

export const asUserId = (v: unknown): UserId => uuidAs<UserId>(v, 'UserId')
export const asWorkspaceId = (v: unknown): WorkspaceId => uuidAs<WorkspaceId>(v, 'WorkspaceId')
export const asOrganizationId = (v: unknown): OrganizationId =>
  uuidAs<OrganizationId>(v, 'OrganizationId')
export const asSessionId = (v: unknown): SessionId => uuidAs<SessionId>(v, 'SessionId')
export const asBlockId = (v: unknown): BlockId => uuidAs<BlockId>(v, 'BlockId')
export const asTeamspaceId = (v: unknown): TeamspaceId => uuidAs<TeamspaceId>(v, 'TeamspaceId')
export const asGroupId = (v: unknown): GroupId => uuidAs<GroupId>(v, 'GroupId')
export const asUserEmailId = (v: unknown): UserEmailId => uuidAs<UserEmailId>(v, 'UserEmailId')

export function asRegionId(v: unknown): RegionId {
  if (typeof v !== 'string' || v.length === 0 || v.length > 32) {
    throw new TypeError(`RegionId 가 올바르지 않습니다: ${JSON.stringify(v)}`)
  }
  return v as RegionId
}

export function asPropertyId(v: unknown): PropertyId {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) {
    throw new TypeError(`PropertyId 가 올바르지 않습니다: ${JSON.stringify(v)}`)
  }
  return v as PropertyId
}
