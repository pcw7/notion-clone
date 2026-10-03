'use client'

/**
 * 페이지 기록 — 머리의 "기록" 단추와 기록 창 (잔여 묶음 8d-2 · F-11-01)
 *
 * 노션의 Page history 와 같은 모양이다(F-11-01 시나리오): 왼쪽은 고른 버전의 본문(읽기 전용 미리보기), 오른쪽은 버전 목록(최신순 · 시각 ·
 * 고친 사람). 처음 열면 가장 최근 버전을 보여 준다. Esc · 닫기 · 바깥 누르기로 닫고 포커스를 "기록" 단추로 돌려준다(검색 창과 같은 관례).
 *
 * 단추는 **고칠 수 있는 사람에게만** 선다(`canViewPageHistory` — F-11-01 *"Can view / Can comment 에게는 항목 자체를 숨긴다"*). 서버가
 * 다시 묻는다(403). 목록을 여는 것이 곧 버전 판정이다 — 마지막 편집 뒤 2분이 지났으면 그 세션의 버전이 이때 선다(`history/version.ts`).
 *
 * **되돌리기**(8d-3 · F-11-02) — 되돌릴 수 있을 때만(목록의 `canRestore` — 고칠 수 있고 잠기지 않았다) 미리보기 머리에 "이 버전으로
 * 되돌리기"가 선다. 누르면 창 안에서 한 번 더 묻는다(빈 버전이면 지금 본문이 모두 지워진다고 · 하위 페이지는 그대로라고). 되돌리면 목록을
 * 다시 읽고 되돌린 버전을 고른다 — 되돌리기 전의 상태도 목록에 있어 그것을 다시 되돌리면 취소다(정본 [보강] 복원 ⑦). 열린 본문 편집기는
 * 협업 서버가 퍼뜨린 update 로 따라온다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { VersionSummary } from '@/lib/history/version'
import type { EditorDoc } from '@/lib/editor/document'
import type { PreviewLabels } from '@/lib/editor/read-only-deps'
import { formatEditors, formatVersionReason, formatVersionTime } from '@/lib/history/format'
import { VersionPreview } from './version-preview'

const MESSAGES: Record<string, string> = {
  forbidden: '이 페이지를 고칠 수 있는 사람만 기록을 볼 수 있습니다.',
  not_found: '찾을 수 없습니다.',
  expired: '이 버전은 보관 기간이 지나 더 이상 볼 수 없습니다.',
}

const RESTORE_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  forbidden: '이 페이지를 고칠 수 있는 사람만 되돌릴 수 있습니다.',
  locked: '잠긴 페이지입니다 — 잠금을 풀어야 되돌릴 수 있습니다.',
  conflict: '이 버전은 지금 되돌릴 수 없습니다 — 하위 페이지가 깊이 상한을 넘는 자리에 있습니다.',
}

type Preview = { readonly id: string; readonly doc: EditorDoc; readonly labels: PreviewLabels }

export function PageHistoryButton({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="page-history-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        기록
      </button>
      {open && <PageHistoryDialog workspaceId={workspaceId} pageId={pageId} onClose={close} />}
    </>
  )
}

async function getJson(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url)
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

function PageHistoryDialog({ workspaceId, pageId, onClose }: { workspaceId: string; pageId: string; onClose: () => void }) {
  const base = `/api/workspaces/${workspaceId}/pages/${pageId}/versions`
  const [versions, setVersions] = useState<readonly VersionSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [canRestore, setCanRestore] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 목록을 다시 읽는 열쇠 — 되돌린 뒤에 올린다. 되돌린 버전은 언제나 가장 최근이라 다시 읽은 목록의 맨 위를 고르면 그것이다. */
  const [reloadKey, setReloadKey] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // 목록 — 여는 것이 곧 버전 판정이다(머리말).
  useEffect(() => {
    let alive = true
    getJson(base).then(
      ({ status, body }) => {
        if (!alive) return
        if (status !== 200) {
          setListError(MESSAGES[String(body.error)] ?? '기록을 불러오지 못했습니다.')
          return
        }
        const list = (body.versions ?? []) as VersionSummary[]
        setVersions(list)
        setCanRestore(body.canRestore === true)
        setSelected(list[0]?.id ?? null)
      },
      () => {
        if (alive) setListError('연결에 실패했습니다.')
      },
    )
    return () => {
      alive = false
    }
  }, [base, reloadKey])

  // 고른 버전의 본문.
  useEffect(() => {
    if (selected === null) return
    let alive = true
    getJson(`${base}/${selected}`).then(
      ({ status, body }) => {
        if (!alive) return
        if (status !== 200) {
          setPreview(null)
          setPreviewError(MESSAGES[String(body.error)] ?? '이 버전을 불러오지 못했습니다.')
          return
        }
        setPreviewError(null)
        setPreview({
          id: selected,
          doc: body.doc as EditorDoc,
          labels: {
            users: (body.users ?? {}) as PreviewLabels['users'],
            pages: (body.pages ?? {}) as PreviewLabels['pages'],
            pageIcons: (body.pageIcons ?? {}) as PreviewLabels['pageIcons'],
          },
        })
      },
      () => {
        if (alive) setPreviewError('연결에 실패했습니다.')
      },
    )
    return () => {
      alive = false
    }
  }, [base, selected])

  // 열리면 닫기 단추에, 목록이 오면 고른 버전에 포커스 — 키보드 사용자가 창 안에서 시작한다.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  useEffect(() => {
    if (versions === null || versions.length === 0) return
    // 목록이 처음 왔을 때만 — 고를 때마다 옮기지 않는다(누른 단추에 이미 있다).
    listRef.current?.querySelector<HTMLButtonElement>('button[aria-current="true"]')?.focus()
  }, [versions])

  // Esc 로 닫는다 — 창 밖(본문 편집기)의 키 처리보다 먼저.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const shown = versions?.find((v) => v.id === preview?.id) ?? null

  const restore = async (): Promise<void> => {
    if (preview === null) return
    setRestoring(true)
    setNotice(null)
    try {
      const res = await fetch(`${base}/${preview.id}/restore`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: unknown; noop?: unknown }
      setConfirming(false)
      if (!res.ok) {
        setNotice(RESTORE_MESSAGES[String(body.error)] ?? '되돌리지 못했습니다.')
        return
      }
      if (body.noop === true) {
        setNotice('지금 본문과 같습니다 — 바꾼 것이 없습니다.')
        return
      }
      setNotice('되돌렸습니다. 되돌리기 전의 본문도 목록에 남아 있어 다시 돌아갈 수 있습니다.')
      setReloadKey((k) => k + 1)
    } catch {
      setNotice('연결에 실패했습니다.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      // 배경을 누르면 닫는다 — 키보드 사용자에게는 Esc 가 같은 일을 한다.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="페이지 기록"
        data-testid="page-history"
        className="flex h-[85vh] w-[min(72rem,94vw)] overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-neutral-900"
      >
        <section aria-label="버전 미리보기" className="min-w-0 flex-1 overflow-auto px-10 py-8">
          {previewError !== null ? (
            <p role="alert" className="text-sm text-red-600">
              {previewError}
            </p>
          ) : preview !== null ? (
            <>
              <div className="mb-6 flex items-start justify-between gap-4">
                <p data-testid="version-preview-caption" className="text-xs text-neutral-500">
                  {shown !== null ? `${formatVersionTime(shown.createdAt)}의 본문 — 읽기 전용` : '읽기 전용'}
                </p>
                {canRestore && !confirming && (
                  <button
                    type="button"
                    data-testid="version-restore"
                    disabled={restoring}
                    onClick={() => {
                      setNotice(null)
                      setConfirming(true)
                    }}
                    className="flex-none rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    이 버전으로 되돌리기
                  </button>
                )}
              </div>
              {confirming && (
                <div
                  role="group"
                  aria-label="되돌리기 확인"
                  data-testid="version-restore-ask"
                  className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
                >
                  <p>이 버전으로 되돌릴까요? 지금 본문은 기록에 남아, 되돌린 뒤에도 다시 돌아올 수 있습니다. 제목과 하위 페이지는 그대로 둡니다.</p>
                  {preview.doc.blocks.length === 0 && (
                    <p data-testid="version-restore-empty" className="mt-1 font-medium text-red-700 dark:text-red-400">
                      이 버전은 비어 있습니다 — 되돌리면 지금 본문이 모두 지워집니다.
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      data-testid="version-restore-confirm"
                      autoFocus
                      disabled={restoring}
                      onClick={() => void restore()}
                      className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      {restoring ? '되돌리는 중…' : '되돌리기'}
                    </button>
                    <button
                      type="button"
                      data-testid="version-restore-cancel"
                      onClick={() => setConfirming(false)}
                      className="rounded-md px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}
              {notice !== null && (
                <p role="status" data-testid="version-restore-notice" className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
                  {notice}
                </p>
              )}
              <VersionPreview key={preview.id} workspaceId={workspaceId} doc={preview.doc} labels={preview.labels} />
            </>
          ) : versions !== null && versions.length === 0 ? null : (
            <p className="text-sm text-neutral-400">불러오는 중…</p>
          )}
        </section>

        <aside className="flex w-72 flex-none flex-col border-l border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-medium">페이지 기록</h2>
            <button
              ref={closeRef}
              type="button"
              data-testid="page-history-close"
              aria-label="기록 닫기"
              onClick={onClose}
              className="rounded px-2 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ✕
            </button>
          </div>
          {listError !== null && (
            <p role="alert" className="px-4 text-sm text-red-600">
              {listError}
            </p>
          )}
          {versions === null && listError === null && <p className="px-4 text-sm text-neutral-400">불러오는 중…</p>}
          {versions !== null && versions.length === 0 && (
            <p data-testid="page-history-empty" className="px-4 text-sm text-neutral-500">
              아직 기록된 버전이 없습니다. 고친 뒤 2분이 지나면 그때의 본문이 남습니다.
            </p>
          )}
          {versions !== null && versions.length > 0 && (
            <ul ref={listRef} aria-label="버전" className="min-h-0 flex-1 overflow-auto px-2 pb-3">
              {versions.map((v) => {
                const editors = formatEditors(v.editors)
                const reason = formatVersionReason(v, versions)
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      data-testid="page-history-item"
                      data-version-id={v.id}
                      aria-current={v.id === selected ? 'true' : undefined}
                      onClick={() => {
                        setPreviewError(null)
                        setConfirming(false)
                        setSelected(v.id)
                      }}
                      className={`w-full rounded px-3 py-2 text-left ${
                        v.id === selected ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <span className="block text-sm">{formatVersionTime(v.createdAt)}</span>
                      {reason !== null && (
                        <span data-testid="page-history-reason" className="block truncate text-xs text-amber-700 dark:text-amber-400">
                          {reason}
                        </span>
                      )}
                      {editors !== '' && <span className="block truncate text-xs text-neutral-500">{editors}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
