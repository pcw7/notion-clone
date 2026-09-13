'use client'

/**
 * 내보내기 버튼 — F-09-14 (Markdown & CSV ZIP)
 *
 * 페이지 · 데이터베이스 화면과 워크스페이스 홈이 같은 버튼을 쓴다. `rootId` 가 없으면 워크스페이스 전체다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 누르면 요약부터 받고, 내려받기는 평범한 링크다
 * ──────────────────────────────────────────────────────────────────────
 *
 * - **링크인 이유**: `fetch` 로 받아 Blob 으로 저장하면 ZIP 전체가 브라우저 메모리에 오른다. 링크면
 *   브라우저가 받는 대로 디스크에 쓴다 — 서버도 흘려보낸다(`lib/export/download.ts`)
 * - **요약을 먼저 받는 이유**: 링크만 두면 거부(너무 큼 · 권한)가 다운로드 목록의 "실패"로만 보이고
 *   이유를 말할 자리가 없다. 요약 라우트는 내려받기와 **같은 준비**(`prepareExport`)를 돌리므로 여기서
 *   통과하면 링크도 통과한다 — 그 사이에 내용이 늘어 상한을 넘는 경우만 예외다
 * - 대가로 준비(스냅샷 읽기 · 조립)를 두 번 한다. 무엇이 몇 개 들어가는지 보고 누르게 하는 값이다
 */

import { useEffect, useState } from 'react'

type Counts = { pages: number; databases: number; rows: number; attachments: number }

type PanelState =
  | { kind: 'loading' }
  | { kind: 'ready'; counts: Counts; bytesAtMost: number }
  | { kind: 'error'; message: string }

/** 실패 문구는 여기 한 곳. 상태 코드는 `lib/export/http.ts` 가 정한다. */
function failureMessage(status: number): string {
  switch (status) {
    case 401:
      return '로그인이 만료됐습니다. 다시 로그인해 주세요.'
    case 403:
      return '워크스페이스 전체 내보내기는 소유자만 할 수 있습니다.'
    case 404:
      return '내보낼 페이지를 찾지 못했습니다.'
    case 422:
      return '한 번에 내려받기에는 너무 큽니다. 하위 페이지를 나눠서 내보내 주세요.'
    default:
      return '내보낼 내용을 준비하지 못했습니다.'
  }
}

function countsText(counts: Counts): string {
  const parts: readonly (readonly [string, number])[] = [
    ['페이지', counts.pages],
    ['데이터베이스', counts.databases],
    ['행', counts.rows],
    ['첨부', counts.attachments],
  ]
  return parts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(' · ')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

export function ExportButton({
  workspaceId,
  rootId = null,
  label = '내보내기',
  align = 'right',
}: {
  workspaceId: string
  /** 페이지 · 데이터베이스 id. 없으면 워크스페이스 전체(소유자만 — 서버가 다시 판정한다). */
  rootId?: string | null
  label?: string
  /** 패널을 버튼의 어느 끝에 맞출지. 화면 오른쪽 끝의 버튼이면 `right`. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<PanelState>({ kind: 'loading' })
  const [started, setStarted] = useState(false)

  const query = rootId === null ? '' : `?root=${encodeURIComponent(rootId)}`
  const downloadUrl = `/api/workspaces/${workspaceId}/export${query}`
  const summaryUrl = `/api/workspaces/${workspaceId}/export/summary${query}`

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(summaryUrl, { signal: controller.signal, cache: 'no-store' })
        if (!res.ok) {
          setPanel({ kind: 'error', message: failureMessage(res.status) })
          return
        }
        const data = (await res.json()) as { counts: Counts; bytesAtMost: number }
        setPanel({ kind: 'ready', counts: data.counts, bytesAtMost: data.bytesAtMost })
      } catch {
        // 닫아서 끊은 요청은 알릴 것이 없다.
        if (!controller.signal.aborted) setPanel({ kind: 'error', message: '연결에 실패했습니다.' })
      }
    }
    void load()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      controller.abort()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, summaryUrl])

  const toggle = (): void => {
    if (!open) {
      // 열 때마다 새로 센다 — 닫아 둔 사이에 페이지가 늘었을 수 있다.
      setPanel({ kind: 'loading' })
      setStarted(false)
    }
    setOpen(!open)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="export-button"
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="내보내기"
          data-testid="export-panel"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-10 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}
        >
          <p className="font-medium">Markdown &amp; CSV · ZIP</p>
          <p className="mt-1 text-xs text-neutral-500">
            하위 페이지 · 표 · 이미지까지 들어갑니다. 볼 수 없는 페이지는 빠지고, 빠진 것과 옮기지 못한 것은 ZIP
            안의 _export_report.json 에 적힙니다.
          </p>

          {panel.kind === 'loading' && <p className="mt-3 text-xs text-neutral-500">내보낼 내용을 세는 중…</p>}

          {panel.kind === 'error' && (
            <p role="alert" data-testid="export-error" className="mt-3 text-xs text-red-600">
              {panel.message}
            </p>
          )}

          {panel.kind === 'ready' && (
            <>
              <p data-testid="export-summary" className="mt-3 text-xs text-neutral-700 dark:text-neutral-300">
                {countsText(panel.counts)} · 최대 {formatBytes(panel.bytesAtMost)}
              </p>
              <a
                href={downloadUrl}
                download
                onClick={() => setStarted(true)}
                data-testid="export-download"
                className="mt-3 inline-block rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                내려받기
              </a>
              {started && (
                <p className="mt-2 text-xs text-neutral-500">
                  내려받기를 시작했습니다. 서버가 그 시점의 내용을 다시 읽어 보내므로 큰 범위는 시작까지 몇 초
                  걸립니다.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
