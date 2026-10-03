'use client'

/**
 * 데이터 소스 창 — 잔여 묶음 8e-2 (F-04-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 다중 data source · 04-database-views.md F-04-23
 *   노션: *"Click the slider icon at the top of the database → Manage data sources → Add data source"*
 *
 * 이 데이터베이스의 소스 목록 · 더하기 · 이름 바꾸기 · 그 소스의 뷰로 가기. 고칠 수 있는 사람(`edit_structure` · 잠기지 않음)에게만
 * 선다(F-04-01 — 비활성 표시보다 미노출). 판정은 라우트가 다시 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 하나뿐일 때는 이름을 고치지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 소스가 하나면 화면 어디에도 소스 이름이 나오지 않고, 둘째를 더하는 순간 첫째가 데이터베이스의 지금 이름을 받는다(8e-1 · 정본 ③). 그
 * 사이에 고친 이름은 덮인다 — 그래서 하나일 때는 데이터베이스 이름을 글자로만 보여 준다(고치는 칸을 세우면 사라질 이름을 받는다).
 *
 * 더하면 새 소스의 뷰(함께 태어난 표)로 옮긴다 — 노션: *"When you create a data source, a new view will automatically be created and
 * attached to it."* 이름 바꾸기는 서버 렌더를 다시 받는다(탭 위의 소스 이름 · 관계형의 반대쪽 이름 기본값이 따라온다).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import * as api from './table-api'

const UNTITLED = '제목 없음'

export type DataSourceEntry = {
  readonly id: string
  readonly name: string
  /** 그 소스를 보는 첫 뷰(탭 순서) — 소스마다 적어도 하나다(`deleteView` 가 마지막 뷰를 막는다). */
  readonly firstViewId: string | null
}

export function DataSourcePanel(props: {
  workspaceId: string
  databaseId: string
  databaseName: string
  sources: readonly DataSourceEntry[]
  /** 지금 보는 뷰의 소스. */
  currentSourceId: string
}) {
  const { workspaceId, databaseId, databaseName, sources, currentSourceId } = props
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const single = sources.length === 1

  // 바깥을 누르면 닫는다(템플릿 창과 같다).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = () => {
    setError(null)
    setOpen((was) => !was)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      setOpen(false)
    }
  }

  const add = async () => {
    setBusy(true)
    setError(null)
    const added = await api.addDataSource(workspaceId, databaseId)
    setBusy(false)
    if (!added.ok) {
      setError(added.message)
      return
    }
    setOpen(false)
    router.push(`/w/${workspaceId}/db/${databaseId}?v=${added.value.viewId}`)
  }

  const rename = async (source: DataSourceEntry, name: string): Promise<boolean> => {
    setError(null)
    const renamed = await api.renameDataSource(workspaceId, source.id, name)
    if (!renamed.ok) {
      setError(renamed.message)
      return false
    }
    router.refresh()
    return true
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        data-testid="db-sources-button"
        aria-expanded={open}
        onClick={toggle}
        className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        데이터 소스{single ? '' : ` ${sources.length}`}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="데이터 소스"
          data-testid="db-sources-panel"
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-2 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          <p className="px-2 py-1 text-xs text-neutral-500">
            데이터 소스마다 속성과 항목이 따로입니다. 뷰는 그중 하나를 봅니다.
          </p>

          <ul className="flex flex-col" data-testid="db-sources-list">
            {sources.map((source) => (
              <li
                key={source.id}
                data-testid="db-source-item"
                data-source-id={source.id}
                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                {single ? (
                  <span className="min-w-0 flex-1 truncate px-1 py-1" data-testid="db-source-label">
                    {databaseName || UNTITLED}
                  </span>
                ) : (
                  // 이름이 바뀌면(서버 렌더) 칸을 새로 세운다 — 입력 중이던 옛 값이 남지 않게.
                  <SourceNameField key={`${source.id}:${source.name}`} source={source} onCommit={rename} />
                )}
                {source.id === currentSourceId ? (
                  <span className="shrink-0 px-1 text-xs text-neutral-400" data-testid="db-source-current">
                    보는 중
                  </span>
                ) : (
                  source.firstViewId !== null && (
                    <Link
                      href={`/w/${workspaceId}/db/${databaseId}?v=${source.firstViewId}`}
                      data-testid="db-source-open"
                      onClick={() => setOpen(false)}
                      className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    >
                      열기
                    </Link>
                  )
                )}
              </li>
            ))}
          </ul>

          <button
            type="button"
            data-testid="db-source-add"
            disabled={busy}
            onClick={() => void add()}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            + 데이터 소스 추가
          </button>
          {busy && <p className="px-2 text-xs text-neutral-400">만드는 중…</p>}

          {error && (
            <p role="alert" data-testid="db-sources-error" className="px-2 py-1 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** 소스 이름 칸 — Enter · 포커스를 잃으면 저장, Esc 는 되돌린다. 비우면 저장하지 않고 되돌린다(이름은 비울 수 없다). */
function SourceNameField({
  source,
  onCommit,
}: {
  source: DataSourceEntry
  onCommit: (source: DataSourceEntry, name: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(source.name)
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    const next = draft.replace(/\s+/g, ' ').trim()
    if (next === '' || next === source.name) {
      setDraft(source.name)
      return
    }
    setSaving(true)
    const ok = await onCommit(source, next)
    setSaving(false)
    if (!ok) setDraft(source.name)
  }

  return (
    <input
      value={draft}
      disabled={saving}
      aria-label={`${source.name} 이름`}
      data-testid="db-source-name-input"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          // 창을 닫는 Esc 보다 먼저 — 고치던 이름만 되돌린다.
          e.stopPropagation()
          setDraft(source.name)
        }
      }}
      className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800"
    />
  )
}
