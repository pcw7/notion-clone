'use client'

/**
 * 파일 칸 편집기 — 파일과 미디어 속성 PT-4 (F-03-04)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 PT-1] ⑧
 *
 * 올리기(파일 고르기 · 끌어 놓기)와 빼기(×). 올린 파일은 파일 블록과 같은 길(`uploadFileOf` — kind `file`)로 올라가고, 칸에 든 파일은
 * 장부(`file.ref_count`)에 센다(DB 트리거 · 0139). 고르는 순간마다 저장한다(사람 칸과 같다 — 초안이 없다). 닫는 것은 표다(Esc · 칸 밖).
 *
 * 올리는 동안 다른 곳에서 칸이 바뀔 수 있으므로 **끝난 때의 최신 목록**에 더한다(`latest`).
 */

import { useEffect, useRef, useState, type DragEvent } from 'react'

import { fileDisplayName } from '@/lib/database/file-chip'
import { MAX_FILES_PER_CELL, type FileRef } from '@/lib/database/property-types'
import { uploadFileOf } from '@/lib/file/upload-client'
import { AnchoredLayer } from '../../anchored-layer'

export function FilesEditor({
  workspaceId,
  current,
  align = 'left',
  onChange,
}: {
  workspaceId: string
  /** 칸에 든 파일(순서대로). */
  current: readonly FileRef[]
  align?: 'left' | 'right'
  onChange: (next: readonly FileRef[]) => void
}) {
  const latest = useRef(current)
  // 렌더 중에 ref 를 쓰지 않는다 — 칸이 바뀐 뒤(효과)에 최신 목록을 맞춘다
  useEffect(() => {
    latest.current = current
  }, [current])
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  const upload = async (picked: readonly File[]) => {
    setMessage(null)
    for (const file of picked) {
      if (latest.current.length >= MAX_FILES_PER_CELL) {
        setMessage(`파일은 ${MAX_FILES_PER_CELL}개까지 넣을 수 있습니다.`)
        return
      }
      setBusy((n) => n + 1)
      const outcome = await uploadFileOf(workspaceId, file, {}, 'file')
      setBusy((n) => n - 1)
      if (!outcome.ok) {
        setMessage(outcome.message)
        continue
      }
      // 끝난 때의 최신 목록에 더한다 — 올리는 사이 다른 쪽이 칸을 바꿨을 수 있다
      if (latest.current.length >= MAX_FILES_PER_CELL || latest.current.some((f) => f.id === outcome.fileId)) continue
      const next = [...latest.current, { id: outcome.fileId, name: fileDisplayName(file.name) }]
      latest.current = next
      onChange(next)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    void upload([...event.dataTransfer.files])
  }

  return (
    <AnchoredLayer align={align === 'right' ? 'end' : 'start'}>
      <div
        data-testid="db-files-editor"
        data-over={over || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`w-72 popover-surface p-1 ${over ? 'outline-2 outline-blue-500' : ''}`}
      >
        {current.length > 0 && (
          <ul aria-label="칸에 든 파일" className="mb-1 flex flex-col gap-0.5 px-1 pt-1" data-testid="db-files-current">
            {current.map((file) => (
              <li key={file.id} className="flex items-center gap-1 rounded bg-neutral-100 pl-1.5 text-xs dark:bg-neutral-800">
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`${file.name} 빼기`}
                  data-testid="db-files-remove"
                  onClick={() => onChange(latest.current.filter((f) => f.id !== file.id))}
                  className="rounded px-1.5 py-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          tabIndex={-1}
          aria-label="파일 고르기"
          data-testid="db-files-input"
          className="hidden"
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])]
            e.target.value = ''
            void upload(picked)
          }}
        />
        <button
          type="button"
          data-testid="db-files-add"
          disabled={current.length >= MAX_FILES_PER_CELL}
          onClick={() => inputRef.current?.click()}
          className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
        >
          파일 올리기
        </button>
        <p className="px-2 pb-1 text-[11px] text-neutral-400">여기에 파일을 끌어 놓을 수도 있습니다.</p>
        {busy > 0 && (
          <p role="status" data-testid="db-files-busy" className="px-2 pb-1 text-xs text-neutral-500">
            올리는 중…
          </p>
        )}
        {message !== null && (
          <p role="alert" data-testid="db-files-message" className="px-2 pb-1 text-xs text-red-600">
            {message}
          </p>
        )}
      </div>
    </AnchoredLayer>
  )
}
