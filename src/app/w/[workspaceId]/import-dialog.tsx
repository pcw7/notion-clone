'use client'

/**
 * 가져오기 — 사이드바의 "가져오기"가 여는 창 (잔여 묶음 8m-1 · F-09-12)
 *
 * 정본: 09-api-integrations.md F-09-12 *"좌측 사이드바 하단의 Import 클릭 … 파일 다중 선택 … 완료 시 임포트된 페이지로 이동하는 링크와, 실패 항목
 *       리포트 제공"*
 *
 * 마크다운 · 텍스트 파일을 여럿, 또는 ZIP 하나를 고르면 내 개인 페이지로 가져온다(판정 · 쓰기는 서버 — `importFiles` · `importZip`). 끝나면
 * 가져온 페이지의 링크와 **옮기지 못한 것**(표 · HTML · 로컬 이미지 …), ZIP 이면 **건너뛴 항목과 이유**를 말한다. 낱 파일이 거부되면 무엇이
 * 왜인지 말하고 아무 페이지도 남지 않는다(전부이거나 아무것도).
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { IMPORT_ACCEPT, importFailureMessage, importedNotice, lossesSummary, skipReasonLabel, skippedNotice } from './import-messages'

type Skip = { readonly path: string; readonly reason: string }
type Done = { readonly pages: readonly { id: string; title: string }[]; readonly losses: string; readonly skipped: readonly Skip[] }

/** 건너뛴 항목은 앞의 열까지만 펼친다 — 나머지는 수로. */
const SHOWN_SKIPS = 10

export function ImportButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const reset = () => {
    setFiles([])
    setError(null)
    setDone(null)
  }

  const submit = async () => {
    if (busy || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const res = await fetch(`/api/workspaces/${workspaceId}/import`, { method: 'POST', body: form })
      const data = (await res.json().catch(() => null)) as
        | { pages?: { id: string; title: string }[]; losses?: Record<string, number>; skipped?: Skip[]; error?: unknown; file?: unknown; limit?: unknown }
        | null
      if (!res.ok || !data?.pages) {
        setError(importFailureMessage(data?.error, data?.file, data?.limit))
        return
      }
      setDone({ pages: data.pages, losses: lossesSummary(data.losses), skipped: data.skipped ?? [] })
      setFiles([])
      router.refresh()
    } catch {
      setError('연결에 실패했습니다. 가져오지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="sidebar-import"
        onClick={() => {
          reset()
          setOpen(true)
        }}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span aria-hidden>⤓</span>
        <span>가져오기</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-24" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div
            ref={boxRef}
            role="dialog"
            aria-label="가져오기"
            data-testid="import-dialog"
            className="flex w-96 flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
          >
            <h2 className="text-sm font-medium">가져오기</h2>
            <p className="text-xs text-neutral-500">
              마크다운(.md)과 텍스트(.txt) 파일, 또는 ZIP 하나를 내 개인 페이지로 가져옵니다. 파일 하나가 페이지 하나이고, ZIP 의 폴더는 페이지의 계층이
              됩니다.
            </p>
            <input
              type="file"
              multiple
              accept={IMPORT_ACCEPT}
              data-testid="import-files"
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []))
                setError(null)
                setDone(null)
              }}
              className="text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="import-submit"
                disabled={busy || files.length === 0}
                onClick={() => void submit()}
                className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {busy ? '가져오는 중…' : files.length > 1 ? `${files.length}개 가져오기` : '가져오기'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
              >
                닫기
              </button>
            </div>
            {error !== null && (
              <p role="alert" data-testid="import-error" className="text-xs text-red-600">
                {error}
              </p>
            )}
            {done !== null && (
              <div role="status" data-testid="import-done" className="flex flex-col gap-1 text-xs">
                <p>{importedNotice(done.pages.length)}</p>
                <ul className="flex flex-col gap-0.5">
                  {done.pages.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/w/${workspaceId}/${p.id}`}
                        data-testid="import-page-link"
                        data-page-id={p.id}
                        onClick={() => setOpen(false)}
                        className="underline underline-offset-2"
                      >
                        {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
                {done.losses !== '' && (
                  <p data-testid="import-losses" className="text-amber-700 dark:text-amber-400">
                    {done.losses}
                  </p>
                )}
                {done.skipped.length > 0 && (
                  <div data-testid="import-skipped" className="text-amber-700 dark:text-amber-400">
                    <p>{skippedNotice(done.skipped.length)}</p>
                    <ul className="ml-3 list-disc">
                      {done.skipped.slice(0, SHOWN_SKIPS).map((s) => (
                        <li key={s.path} data-testid="import-skipped-item" data-reason={s.reason} className="break-all">
                          {s.path} — {skipReasonLabel(s.reason)}
                        </li>
                      ))}
                    </ul>
                    {done.skipped.length > SHOWN_SKIPS && <p>… 그 밖에 {done.skipped.length - SHOWN_SKIPS}개</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
