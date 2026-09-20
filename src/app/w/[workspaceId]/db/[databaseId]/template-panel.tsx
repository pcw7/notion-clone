'use client'

/**
 * 템플릿 패널 — 템플릿 6c-3조각 (F-08-02)
 *
 * 정본: 08-templates-automation.md F-08-02
 *   *"DB 우측 상단 `New` 버튼의 드롭다운 화살표 클릭 → `+ New template` → 열린 템플릿 페이지에서 …"*
 *   *"템플릿 항목 hover 시 `•••`(Edit / Duplicate / Delete / Set as default / Repeat)"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 `New ▾` 가 아니라 도구줄인가 — 이번 조각에서는
 * ──────────────────────────────────────────────────────────────────────
 *
 * 08 은 템플릿을 **고르는** 자리(`New ▾`)와 **관리하는** 자리(그 안의 `•••`)를 한 드롭다운에 겹쳐 둔다. 이 조각이
 * 세우는 것은 뒤쪽 — 템플릿을 만들고 · 열어 채우고 · 버리는 길이다. 앞쪽(고르면 그 상태로 행이 생긴다)은 다음
 * 조각이고, 그때 이 목록을 `New ▾` 가 함께 쓴다.
 *
 * 순서를 이렇게 잡은 이유는 **빈 템플릿은 쓸모가 없어서**다. 고르는 길을 먼저 만들면 고를 것이 없거나(만들 수 없다)
 * 이름만 있는 템플릿뿐이다. 채우는 화면이 먼저 서야 목록이 의미를 갖는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 목록은 열 때 받는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 서버 렌더가 함께 내려주지 않는다 — 템플릿은 표를 여는 사람 대부분이 한 번도 열지 않는 목록이고, 열 때 한 번
 * 받으면 그 뒤의 만들기 · 지우기가 곧바로 반영된다. 닫았다 열면 다시 받는다(남이 만든 것이 보인다).
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import * as api from './table-api'

const UNTITLED = '제목 없음'

export function TemplatePanel(props: {
  workspaceId: string
  databaseId: string
  dataSourceId: string
  /** 템플릿을 만들고 버릴 수 있는가(`edit_structure`). 목록은 볼 수만 있어도 읽는다. */
  canEdit: boolean
}) {
  const { workspaceId, databaseId, dataSourceId, canEdit } = props
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<api.TemplateJson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // 열 때마다 받는다(머리말). effect 가 아니라 **누른 자리**에서 받는다 — effect 안의 동기 setState 는 연쇄
  // 렌더를 만들고, 여는 것은 사용자의 한 동작이라 그 자리에서 시작하는 편이 읽기도 쉽다.
  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setTemplates(null)
    setError(null)
    const listed = await api.listTemplates(workspaceId, dataSourceId)
    if (listed.ok) setTemplates(listed.value)
    else setError(listed.message)
  }

  // 바깥을 누르면 닫는다. 패널 안의 링크는 이동하므로 닫히는 것이 자연스럽다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const add = async () => {
    setBusy(true)
    setError(null)
    const made = await api.createTemplate(workspaceId, dataSourceId, '새 템플릿')
    setBusy(false)
    if (!made.ok) {
      setError(made.message)
      return
    }
    // 만든 뒤 목록에 붙인다 — 곧바로 "열기"로 채우러 갈 수 있게. 다시 묻지 않는다.
    setTemplates((current) => [...(current ?? []), made.value])
  }

  const remove = async (template: api.TemplateJson) => {
    setBusy(true)
    setError(null)
    const removed = await api.deleteTemplate(workspaceId, template.id)
    setBusy(false)
    if (!removed.ok) {
      setError(removed.message)
      return
    }
    setTemplates((current) => (current ?? []).filter((t) => t.id !== template.id))
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        data-testid="db-templates-button"
        aria-expanded={open}
        onClick={() => void toggle()}
        className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        템플릿
      </button>

      {open && (
        <div
          data-testid="db-templates-panel"
          className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-2 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          <p className="px-2 py-1 text-xs text-neutral-500">
            템플릿은 표에 보이지 않습니다. 새 항목을 만들 때 골라 씁니다.
          </p>

          {templates === null && !error && <p className="px-2 py-2 text-neutral-400">불러오는 중…</p>}

          {templates !== null && templates.length === 0 && (
            <p className="px-2 py-2 text-neutral-400" data-testid="db-templates-empty">
              아직 템플릿이 없습니다.
            </p>
          )}

          {templates !== null && templates.length > 0 && (
            <ul className="flex flex-col" data-testid="db-templates-list">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-1 rounded px-1 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <Link
                    href={`/w/${workspaceId}/db/${databaseId}/templates/${t.id}`}
                    data-testid="db-template-open"
                    data-template-id={t.id}
                    className="min-w-0 flex-1 truncate px-1 py-1.5 hover:underline underline-offset-4"
                  >
                    {t.title || UNTITLED}
                  </Link>
                  {canEdit && (
                    <button
                      type="button"
                      data-testid="db-template-delete"
                      data-template-id={t.id}
                      disabled={busy}
                      onClick={() => void remove(t)}
                      className="flex-none rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-neutral-800"
                      aria-label={`${t.title || UNTITLED} 템플릿 지우기`}
                    >
                      버리기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <button
              type="button"
              data-testid="db-template-new"
              disabled={busy}
              onClick={() => void add()}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              + 새 템플릿
            </button>
          )}

          {error && (
            <p role="alert" data-testid="db-templates-error" className="px-2 py-1 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
