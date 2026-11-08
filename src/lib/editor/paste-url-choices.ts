/**
 * 주소 붙여넣기 메뉴가 내놓는 항목 (EM-2 · 정본 §3.4 [보강 EM-2] ③)
 *
 * 순수다 — 메뉴 판(`paste-url-menu.tsx`)이 지연 로드와 함께 부른다. 임베드는 알려진 서비스면 그 이름을 함께 달고, 이 앱의 출처이거나 그릴
 * 수 없는 주소(`refused`)면 내놓지 않는다. 페이지 멘션은 이 앱의 출처의 `/w/<지금 워크스페이스>/<페이지 id>` 꼴일 때만이다 — 볼 수 있는지는
 * 멘션이 그릴 때 본다(멘션의 기존 규칙).
 */

import { embedPlanOf, ownHostsOf } from '../block/embed-source.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PasteUrlChoice = 'link' | 'bookmark' | 'embed' | 'mention'

export type PasteUrlOption = { readonly choice: PasteUrlChoice; readonly label: string }

/** 이 워크스페이스의 페이지 주소면 그 페이지 id, 아니면 null. 출처가 다르거나 `db/…` · 다른 워크스페이스면 null. */
export function internalPageIdOf(url: string, origin: string, workspaceId: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.origin.toLowerCase() !== new URL(origin).origin.toLowerCase()) return null
    const parts = parsed.pathname.split('/').filter((p) => p !== '')
    if (parts.length !== 3 || parts[0] !== 'w') return null
    if (parts[1].toLowerCase() !== workspaceId.toLowerCase()) return null
    return UUID.test(parts[2]) ? parts[2].toLowerCase() : null
  } catch {
    return null
  }
}

export function pasteUrlOptions(url: string, origin: string, workspaceId: string): PasteUrlOption[] {
  const options: PasteUrlOption[] = [
    { choice: 'link', label: '링크로 두기' },
    { choice: 'bookmark', label: '북마크' },
  ]
  const plan = embedPlanOf(url, ownHostsOf([origin]))
  if (plan.kind === 'known') options.push({ choice: 'embed', label: `임베드 · ${plan.label}` })
  else if (plan.kind === 'generic') options.push({ choice: 'embed', label: '임베드' })
  if (internalPageIdOf(url, origin, workspaceId) !== null) options.push({ choice: 'mention', label: '페이지 멘션' })
  return options
}
