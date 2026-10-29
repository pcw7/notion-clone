/**
 * 데이터베이스 화면의 경로 줄 — 워크스페이스 · (그 데이터베이스가 놓인 페이지들 — I-4c) · 이 데이터베이스 (서버 부품)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ⑥(I-4c) · 줄은 `databaseTrail`(block/breadcrumb.ts)이 만든다. 모양은 전의 줄 그대로다
 * (링크는 밑줄 · 지금 것은 옅은 글자) — 최상위 데이터베이스는 전과 같은 두 칸이다.
 */

import { Fragment } from 'react'

import Link from '@/app/link'
import type { BreadcrumbTrail } from '@/lib/block/breadcrumb'
import { PageIconView } from '../../page-icon-view'

export function DatabaseTrailNav({ trail }: { trail: BreadcrumbTrail }) {
  return (
    <nav aria-label="상위 경로" className="flex flex-wrap items-center gap-1 text-sm text-neutral-500">
      {trail.map((item, i) => (
        <Fragment key={`${item.kind}:${item.id}`}>
          {i > 0 && <span aria-hidden>/</span>}
          {item.href === null ? (
            <span className="text-neutral-400">
              <PageIconView icon={item.icon} className="mr-1" />
              {item.label}
            </span>
          ) : (
            <Link href={item.href} className="hover:underline underline-offset-4">
              {item.icon !== null && <PageIconView icon={item.icon} className="mr-1" />}
              {item.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
