/**
 * 설정 화면 — 설정 정보구조 8g-1조각 (F-17-12)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 정보구조
 *       17-ops-governance.md F-17-12 *"좌측 네비가 3개 그룹으로 나뉜다: 내 계정 / 이 워크스페이스 / 조직(해당 시)"* · *"각 항목 행은
 *       [라벨 / 설명 / 컨트롤 / 상태 배지]"*
 *
 * 화면의 모든 것이 레지스트리에서 나온다 — 왼쪽 내비(`visibleSettingGroups` — 보이는 항목이 있는 절만), 오른쪽 항목(`readSettings` —
 * 보이는 것만 · 값 · 고칠 수 있는가), 읽기 전용의 안내(`editorsNote`). 이 파일에 항목의 이름이나 역할 판정을 적지 않는다.
 * 지금은 내 계정 · 워크스페이스 두 묶음이다(조직은 조직 기능이 생길 때 — 정본 ③). 절은 `?s=` 로 고른다.
 */

import Link from 'next/link'

import { requirePageSession } from '@/lib/auth/page-session'
import { editorsNote, settingDefinition, visibleSettingGroups } from '@/lib/settings/registry'
import { readSettings } from '@/lib/settings/settings'
import { SettingRow } from './setting-row'

export default async function SettingsPage({ params, searchParams }: PageProps<'/w/[workspaceId]/settings'>) {
  const { workspaceId } = await params
  const ctx = await requirePageSession(workspaceId)
  const { s } = await searchParams

  const groups = visibleSettingGroups(ctx.role)
  const sections = groups.flatMap((group) => group.sections)
  // 계정의 절은 누구에게나 보이므로 첫 절이 늘 있다. 모르거나 볼 수 없는 절이면 첫 절이다.
  const current = sections.find((section) => section.id === s) ?? sections[0]!
  const items = (await readSettings(ctx)).filter((item) => item.section === current.id)

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl gap-10 px-6 py-12">
      <nav aria-label="설정" data-testid="settings-nav" className="flex w-44 flex-none flex-col gap-5">
        {groups.map((group) => (
          <section key={group.scope} aria-label={group.label} className="flex flex-col gap-1">
            <h2 className="px-2 text-xs font-medium text-neutral-400">{group.label}</h2>
            <ul className="flex flex-col gap-0.5">
              {group.sections.map((section) => (
                <li key={section.id}>
                  <Link
                    href={`/w/${workspaceId}/settings?s=${section.id}`}
                    data-testid="settings-nav-link"
                    data-section={section.id}
                    aria-current={section.id === current.id ? 'page' : undefined}
                    className={`block rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      section.id === current.id ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : 'text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <section aria-labelledby="settings-title" className="flex min-w-0 flex-1 flex-col">
        <h1 id="settings-title" data-testid="settings-title" className="border-b border-neutral-200 pb-3 text-lg font-semibold dark:border-neutral-800">
          {current.label}
        </h1>
        {items.map((item) => {
          const definition = settingDefinition(item.key)
          return (
            <SettingRow
              key={item.key}
              workspaceId={workspaceId}
              settingKey={item.key}
              label={item.label}
              description={item.description}
              control={item.control}
              value={item.value}
              editable={item.editable}
              readOnlyNote={definition === null ? null : editorsNote(definition)}
            />
          )
        })}
      </section>
    </main>
  )
}
