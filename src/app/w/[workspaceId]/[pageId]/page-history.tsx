'use client'

/**
 * 페이지 기록 — 머리의 "기록" 단추와 기록 창 (잔여 묶음 8d-2 · F-11-01)
 *
 * 노션의 Page history 와 같은 모양이다(F-11-01 시나리오): 왼쪽은 고른 버전의 본문(읽기 전용 미리보기), 오른쪽은 버전 목록(최신순 · 시각 ·
 * 고친 사람). 처음 열면 가장 최근 버전을 보여 준다. Esc · 닫기 · 바깥 누르기로 닫고 포커스를 "기록" 단추로 돌려준다(검색 창과 같은 관례).
 *
 * 단추는 **고칠 수 있는 사람에게만** 선다(`canViewPageHistory` — F-11-01 *"Can view / Can comment 에게는 항목 자체를 숨긴다"*). 서버가
 * 다시 묻는다(403). 목록을 여는 것이 곧 버전 판정이다 — 마지막 편집 뒤 2분이 지났으면 그 세션의 버전이 이때 선다(`history/version.ts`).
 * 되돌리기(복원)는 다음 조각(8d-3)이다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { VersionSummary } from '@/lib/history/version'
import type { EditorDoc } from '@/lib/editor/document'
import type { PreviewLabels } from '@/lib/editor/read-only-deps'
import { formatEditors, formatVersionTime } from '@/lib/history/format'
import { VersionPreview } from './version-preview'

const MESSAGES: Record<string, string> = {
  forbidden: '이 페이지를 고칠 수 있는 사람만 기록을 볼 수 있습니다.',
  not_found: '찾을 수 없습니다.',
  expired: '이 버전은 보관 기간이 지나 더 이상 볼 수 없습니다.',
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
        setSelected(list[0]?.id ?? null)
      },
      () => {
        if (alive) setListError('연결에 실패했습니다.')
      },
    )
    return () => {
      alive = false
    }
  }, [base])

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
              <p data-testid="version-preview-caption" className="mb-6 text-xs text-neutral-500">
                {shown !== null ? `${formatVersionTime(shown.createdAt)}의 본문 — 읽기 전용` : '읽기 전용'}
              </p>
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
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      data-testid="page-history-item"
                      data-version-id={v.id}
                      aria-current={v.id === selected ? 'true' : undefined}
                      onClick={() => {
                        setPreviewError(null)
                        setSelected(v.id)
                      }}
                      className={`w-full rounded px-3 py-2 text-left ${
                        v.id === selected ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <span className="block text-sm">{formatVersionTime(v.createdAt)}</span>
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
