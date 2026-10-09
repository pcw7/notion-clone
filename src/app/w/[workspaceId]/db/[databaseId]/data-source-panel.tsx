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
 *
 * 휴지통으로(8e-3a · 노션 *"select ••• to Move to Trash"*) — 소스가 둘 이상일 때만 선다(마지막 소스는 서버도 `last_source` 로 막는다).
 * 그 소스의 항목이 함께 가므로 창 안에서 한 번 더 묻는다. 지금 보고 있는 소스를 보냈으면 데이터베이스의 첫 뷰로 옮긴다(그 탭이
 * 사라졌다). 되살리기는 사이드바의 휴지통이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 다른 데이터베이스 연결 (2l-3 · F-04-13)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 볼 수 있는 데이터베이스의 소스를 골라 붙인다(이 데이터베이스의 것 · 이미 붙은 것은 고르개에 없다) — 붙이면 그 소스를 보는 표 뷰가
 * 생기고 그 탭으로 옮긴다. 붙인 소스는 원본의 이름에 "연결됨"을 달고, 이름을 여기서 고치지 않는다(원본의 것이다) · "원본"으로 원본
 * 데이터베이스에 간다 · 휴지통 대신 **떼기**다(원본은 그대로 — 이 소스를 보는 뷰만 사라진다). 원본을 볼 수 없게 된 소스는 이름 대신
 * "접근 권한 없음"이고 떼기만 남는다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import * as api from './table-api'
import type { DatabaseListItem } from '@/lib/database/database'

const UNTITLED = '제목 없음'

export type DataSourceEntry = {
  readonly id: string
  /** 원본을 볼 수 없는 붙인 소스면 빈 글이다(`readable`). */
  readonly name: string
  /** 그 소스를 보는 첫 뷰(탭 순서) — 소스마다 적어도 하나다(`deleteView` 가 마지막 뷰를 막는다). */
  readonly firstViewId: string | null
  /** 이 데이터베이스의 것이다. 거짓이면 다른 데이터베이스의 것을 붙였다(2l-3). */
  readonly owned: boolean
  /** 원본을 볼 수 있다 — 소유한 소스는 늘 참이다. */
  readonly readable: boolean
  /** 원본 데이터베이스 — 볼 수 없으면 null. */
  readonly ownerDatabaseId: string | null
}

/** 원본을 볼 수 없는 붙인 소스의 자리 글. */
const NO_ACCESS_LABEL = '접근 권한 없음'

/** 연결 고르개의 한 줄 — 데이터베이스 이름(소스가 여럿이면 " · 소스 이름"). */
const candidateLabel = (item: DatabaseListItem) => `${item.name || UNTITLED}${item.sourceName === null ? '' : ` · ${item.sourceName}`}`

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
  /** 휴지통으로 보낼지 묻는 중인 소스. */
  const [asking, setAsking] = useState<string | null>(null)
  /** 뗄지 묻는 중인 붙인 소스(2l-3). */
  const [detaching, setDetaching] = useState<string | null>(null)
  /** 연결 고르개의 후보 — null 이면 닫혀 있다(2l-3). */
  const [candidates, setCandidates] = useState<DatabaseListItem[] | null>(null)
  const [target, setTarget] = useState('')
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
    setAsking(null)
    setDetaching(null)
    setCandidates(null)
    setOpen((was) => !was)
  }

  const trash = async (source: DataSourceEntry) => {
    setBusy(true)
    setError(null)
    const trashed = await api.trashDataSource(workspaceId, source.id)
    setBusy(false)
    if (!trashed.ok) {
      setError(trashed.message)
      return
    }
    setAsking(null)
    setOpen(false)
    // 보고 있던 소스면 그 탭이 사라졌다 — 데이터베이스의 첫 뷰로. 아니면 같은 자리에서 다시 받는다(사이드바의 휴지통도 따라온다).
    if (source.id === currentSourceId) router.push(`/w/${workspaceId}/db/${databaseId}`)
    else router.refresh()
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

  /** 고르개를 연다 — 볼 수 있는 데이터베이스의 소스 중 이 데이터베이스의 것 · 이미 붙은 것을 뺀다. */
  const openLink = async () => {
    setError(null)
    setAsking(null)
    setDetaching(null)
    setBusy(true)
    const listed = await api.listDatabases(workspaceId)
    setBusy(false)
    if (!listed.ok) {
      setError(listed.message)
      return
    }
    const attached = new Set(sources.map((s) => s.id))
    const choices = listed.value.filter((item) => item.id !== databaseId && !attached.has(item.dataSourceId))
    setCandidates(choices)
    setTarget(choices[0]?.dataSourceId ?? '')
  }

  const link = async () => {
    if (target === '') return
    setBusy(true)
    setError(null)
    const linked = await api.attachLinkedSource(workspaceId, databaseId, target)
    setBusy(false)
    if (!linked.ok) {
      setError(linked.message)
      return
    }
    setCandidates(null)
    setOpen(false)
    router.push(`/w/${workspaceId}/db/${databaseId}?v=${linked.value.viewId}`)
  }

  const detach = async (source: DataSourceEntry) => {
    setBusy(true)
    setError(null)
    const detached = await api.detachLinkedSource(workspaceId, databaseId, source.id)
    setBusy(false)
    if (!detached.ok) {
      setError(detached.message)
      return
    }
    setDetaching(null)
    setOpen(false)
    // 보고 있던 소스면 그 탭이 사라졌다 — 데이터베이스의 첫 뷰로(휴지통과 같다).
    if (source.id === currentSourceId) router.push(`/w/${workspaceId}/db/${databaseId}`)
    else router.refresh()
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
                {!source.owned ? (
                  // 붙인 소스 — 이름은 원본의 것이라 여기서 고치지 않는다(2l-3)
                  <span
                    className={`min-w-0 flex-1 truncate px-1 py-1 ${source.readable ? '' : 'text-neutral-400'}`}
                    data-testid="db-source-label"
                  >
                    {source.readable ? source.name : NO_ACCESS_LABEL}
                  </span>
                ) : single ? (
                  <span className="min-w-0 flex-1 truncate px-1 py-1" data-testid="db-source-label">
                    {databaseName || UNTITLED}
                  </span>
                ) : (
                  // 이름이 바뀌면(서버 렌더) 칸을 새로 세운다 — 입력 중이던 옛 값이 남지 않게.
                  <SourceNameField key={`${source.id}:${source.name}`} source={source} onCommit={rename} />
                )}
                {!source.owned && (
                  <span className="shrink-0 px-1 text-xs text-neutral-400" data-testid="db-source-linked" title="다른 데이터베이스의 소스">
                    ↗ 연결됨
                  </span>
                )}
                {!source.owned && source.ownerDatabaseId !== null && (
                  <Link
                    href={`/w/${workspaceId}/db/${source.ownerDatabaseId}`}
                    data-testid="db-source-original"
                    onClick={() => setOpen(false)}
                    className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    원본
                  </Link>
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
                {!source.owned ? (
                  <button
                    type="button"
                    aria-label={`${source.readable ? source.name : NO_ACCESS_LABEL} 떼기`}
                    data-testid="db-source-detach"
                    disabled={busy}
                    onClick={() => {
                      setAsking(null)
                      setDetaching(source.id)
                    }}
                    className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    떼기
                  </button>
                ) : !single && (
                  <button
                    type="button"
                    aria-label={`${source.name} 휴지통으로`}
                    data-testid="db-source-trash"
                    disabled={busy}
                    onClick={() => {
                      setDetaching(null)
                      setAsking(source.id)
                    }}
                    className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-neutral-800"
                  >
                    휴지통
                  </button>
                )}
              </li>
            ))}
          </ul>

          {asking !== null && (
            <AskTrash
              source={sources.find((s) => s.id === asking) ?? null}
              busy={busy}
              onConfirm={(source) => void trash(source)}
              onCancel={() => setAsking(null)}
            />
          )}
          {detaching !== null && (
            <AskDetach
              source={sources.find((s) => s.id === detaching) ?? null}
              busy={busy}
              onConfirm={(source) => void detach(source)}
              onCancel={() => setDetaching(null)}
            />
          )}


          <button
            type="button"
            data-testid="db-source-add"
            disabled={busy}
            onClick={() => void add()}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            + 데이터 소스 추가
          </button>
          <button
            type="button"
            data-testid="db-source-link"
            disabled={busy}
            aria-expanded={candidates !== null}
            onClick={() => (candidates === null ? void openLink() : setCandidates(null))}
            className="w-full rounded px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            + 다른 데이터베이스 연결
          </button>
          {candidates !== null && (
            <LinkPicker
              candidates={candidates}
              target={target}
              busy={busy}
              onTarget={setTarget}
              onConfirm={() => void link()}
              onCancel={() => setCandidates(null)}
            />
          )}
          {busy && <p className="px-2 text-xs text-neutral-400">처리하는 중…</p>}

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

/** 휴지통으로 보낼지 창 안에서 한 번 더 묻는다 — 그 소스의 항목이 함께 간다(되살리기는 사이드바의 휴지통). */
function AskTrash({
  source,
  busy,
  onConfirm,
  onCancel,
}: {
  source: DataSourceEntry | null
  busy: boolean
  onConfirm: (source: DataSourceEntry) => void
  onCancel: () => void
}) {
  if (source === null) return null
  return (
    <div
      role="group"
      aria-label="데이터 소스를 휴지통으로"
      data-testid="db-source-trash-ask"
      className="mt-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p>
        <strong>{source.name}</strong>을(를) 휴지통으로 보냅니다. 이 소스의 항목 · 템플릿과 이 소스를 보는 뷰도 함께 사라지고, 휴지통에서
        되살릴 수 있습니다.
      </p>
      <div className="mt-2 flex gap-1">
        <button
          type="button"
          data-testid="db-source-trash-confirm"
          disabled={busy}
          // 묻는 상자가 열리면 곧바로 Enter 로 확정할 수 있게(되돌릴 수 있는 일이다).
          autoFocus
          onClick={() => onConfirm(source)}
          className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-40"
        >
          휴지통으로
        </button>
        <button
          type="button"
          data-testid="db-source-trash-cancel"
          onClick={onCancel}
          className="rounded px-2 py-1 hover:bg-red-100 dark:hover:bg-red-900"
        >
          취소
        </button>
      </div>
    </div>
  )
}

/** 붙인 소스를 뗄지 창 안에서 한 번 더 묻는다 — 이 소스를 보는 뷰(필터 · 정렬 · 컬럼)가 사라진다. 원본은 그대로다. */
function AskDetach({
  source,
  busy,
  onConfirm,
  onCancel,
}: {
  source: DataSourceEntry | null
  busy: boolean
  onConfirm: (source: DataSourceEntry) => void
  onCancel: () => void
}) {
  if (source === null) return null
  return (
    <div
      role="group"
      aria-label="연결된 데이터 소스 떼기"
      data-testid="db-source-detach-ask"
      className="mt-1 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
    >
      <p>
        <strong>{source.readable ? source.name : NO_ACCESS_LABEL}</strong>을(를) 이 데이터베이스에서 뗍니다. 이 소스를 보는 뷰가 함께
        사라집니다. 원본 데이터베이스와 그 항목은 그대로입니다.
      </p>
      <div className="mt-2 flex gap-1">
        <button
          type="button"
          data-testid="db-source-detach-confirm"
          disabled={busy}
          autoFocus
          onClick={() => onConfirm(source)}
          className="rounded bg-neutral-800 px-2 py-1 text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
        >
          떼기
        </button>
        <button
          type="button"
          data-testid="db-source-detach-cancel"
          onClick={onCancel}
          className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          취소
        </button>
      </div>
    </div>
  )
}

/** 붙일 소스를 고른다 — 볼 수 있는 데이터베이스의 소스(서버가 원본의 권한을 다시 본다). */
function LinkPicker({
  candidates,
  target,
  busy,
  onTarget,
  onConfirm,
  onCancel,
}: {
  candidates: readonly DatabaseListItem[]
  target: string
  busy: boolean
  onTarget: (dataSourceId: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="group"
      aria-label="다른 데이터베이스 연결"
      data-testid="db-source-link-picker"
      className="mt-1 rounded border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
    >
      {candidates.length === 0 ? (
        <p data-testid="db-source-link-empty">연결할 수 있는 데이터베이스가 없습니다.</p>
      ) : (
        <>
          <p>다른 데이터베이스의 소스를 이 데이터베이스에 붙입니다. 항목과 속성은 원본의 것이고, 뷰는 이 데이터베이스의 것입니다.</p>
          <select
            aria-label="연결할 데이터 소스"
            data-testid="db-source-link-select"
            value={target}
            onChange={(e) => onTarget(e.target.value)}
            className="mt-2 w-full rounded border border-neutral-200 bg-white px-1 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-950"
          >
            {candidates.map((item) => (
              <option key={item.dataSourceId} value={item.dataSourceId}>
                {candidateLabel(item)}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="mt-2 flex gap-1">
        {candidates.length > 0 && (
          <button
            type="button"
            data-testid="db-source-link-confirm"
            disabled={busy || target === ''}
            onClick={onConfirm}
            className="rounded bg-neutral-800 px-2 py-1 text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
          >
            연결
          </button>
        )}
        <button
          type="button"
          data-testid="db-source-link-cancel"
          onClick={onCancel}
          className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          취소
        </button>
      </div>
    </div>
  )
}
