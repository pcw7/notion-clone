'use client'

/**
 * Home 의 섹션 하나 — 플랫폼 잔여 10c-1 (F-07-19)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] Home ③
 *
 * 처음 `HOME_SECTION_LIMIT` 개만 보이고 "모두 보기 (N)" 로 편다(`visibleItems`). 사이드바와 같은 `aria-label` 을 쓰지 않는다 — 머리말로 이름을
 * 단다(`aria-labelledby`) · 사이드바의 섹션을 찾는 셀렉터와 겹치지 않게.
 */

import Link from '@/app/link'
import { useId, useState } from 'react'

import { HOME_SECTION_LIMIT, homeItemHref, visibleItems, type HomeSection as Section } from '@/lib/nav/home-sections'
import { PageIconView } from './page-icon-view'

const UNTITLED = '제목 없음'

export function HomeSection({ workspaceId, section }: { workspaceId: string; section: Section }) {
  const [expanded, setExpanded] = useState(false)
  const headingId = useId()
  const { shown, hidden } = visibleItems(section.items, expanded)
  return (
    <section aria-labelledby={headingId} data-testid="home-section" data-key={section.key} className="flex flex-col gap-2">
      <h2 id={headingId} className="flex items-center gap-1 text-sm font-medium text-neutral-500">
        {section.kind === 'teamspace' && <span aria-hidden>👥</span>}
        {section.title}
        <span className="text-xs text-neutral-400">{section.items.length}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((item) => (
          <li key={item.id}>
            <Link
              href={homeItemHref(workspaceId, item)}
              data-testid="home-item"
              data-page-id={item.id}
              className="flex items-center gap-2 truncate rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <PageIconView icon={item.icon} fallback />
              <span className="truncate">{item.title || UNTITLED}</span>
            </Link>
          </li>
        ))}
      </ul>
      {(hidden > 0 || (expanded && section.items.length > HOME_SECTION_LIMIT)) && (
        <button
          type="button"
          data-testid="home-section-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="self-start text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          {expanded ? '접기' : `모두 보기 (${section.items.length})`}
        </button>
      )}
    </section>
  )
}
