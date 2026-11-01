'use client'

/**
 * 페이지 커버 — 배너 · 추가 · 바꾸기 · 지우기 (34번 트랙 PC-1 · F-02-06 · 정본 §3.4 [보강 PC-1] ⑤)
 *
 * 노션과 같은 흐름이다(F-02-06 시나리오):
 *   · 커버가 없으면 머리에 마우스를 올릴 때 "아이콘 추가" 옆에 **"커버 추가"** — 누르면 내장 커버 하나를 **무작위로 곧바로** 단다
 *     (고르개를 열지 않는다 — 노션의 Add cover)
 *   · 커버가 있으면 상단 바 아래 **전체 폭 배너** — 마우스를 올리면 "커버 바꾸기"(고르개 — 내장 · 링크 탭 · 지우기)
 *   · 고칠 수 없으면(권한 · 잠금) 배너만 보인다 — 버튼이 없다. 서버도 거부한다(`setPageCover`)
 *
 * 배너(본문 칸 밖)와 "커버 추가"(머리 안 — 아이콘 칸의 줄)는 자리가 떨어져 있어 상태를 공급자(`PageCoverProvider`)가 쥔다. 아이콘 칸은
 * 커버가 있으면 배너 아래 끝에 걸친다(`useHasPageCover`).
 *
 * 저장은 고를 때마다 곧바로(`PATCH` 의 `cover`) — 화면은 먼저 바꾸고, 거부되면 마지막으로 저장된 값으로 되돌리고 까닭을 말한다(아이콘과
 * 같다). 다른 곳에서 바뀌어 서버 렌더가 새 값을 주면 따라간다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import {
  COVER_FALLBACK_BACKGROUND,
  COVER_GALLERY,
  coverBackground,
  pageCoverKey,
  parsePageCoverInput,
  randomGalleryCover,
  samePageCover,
  type PageCover,
} from '@/lib/block/page-cover'
import { imageContentPath } from '@/lib/block/image'
import { ALLOWED_IMAGE_MIME } from '@/lib/file/limits'
import { uploadImageFile } from '@/lib/file/upload-client'

const MESSAGES: Record<string, string> = {
  locked: '잠긴 페이지입니다 — 잠금을 풀어야 커버를 바꿀 수 있습니다.',
  forbidden: '이 페이지를 고칠 권한이 없습니다.',
  invalid_cover: '커버는 내장 커버 · http(s) 이미지 주소 · 이 워크스페이스에 올린 이미지여야 합니다.',
}

type CoverState = {
  readonly workspaceId: string
  readonly cover: PageCover | null
  readonly readOnly: boolean
  readonly error: string | null
  save(next: PageCover | null): Promise<void>
}

const CoverContext = createContext<CoverState | null>(null)

export function PageCoverProvider({
  workspaceId,
  pageId,
  initialCover,
  readOnly,
  children,
}: {
  workspaceId: string
  pageId: string
  initialCover: PageCover | null
  /** 고칠 수 없다 — 볼 수만 있거나 잠긴 페이지. */
  readOnly: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const [cover, setCover] = useState<PageCover | null>(initialCover)
  const [error, setError] = useState<string | null>(null)
  /** 마지막으로 서버에 반영된 값. */
  const saved = useRef<PageCover | null>(initialCover)

  // 다른 곳에서 바뀌어 서버 렌더가 새 값을 주면 따라간다(저장된 값이 달라졌을 때만 — 아이콘과 같은 규칙).
  useEffect(() => {
    if (!samePageCover(initialCover, saved.current)) {
      saved.current = initialCover
      setCover(initialCover)
    }
  }, [initialCover])

  const save = useCallback(
    async (next: PageCover | null): Promise<void> => {
      if (readOnly) return
      setError(null)
      setCover(next)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cover: next }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: unknown }
          setError(MESSAGES[String(data.error)] ?? '커버를 저장하지 못했습니다.')
          setCover(saved.current)
          return
        }
        saved.current = next
        router.refresh()
      } catch {
        setError('연결에 실패했습니다.')
        setCover(saved.current)
      }
    },
    [pageId, readOnly, router, workspaceId],
  )

  const value = useMemo<CoverState>(() => ({ workspaceId, cover, readOnly, error, save }), [workspaceId, cover, readOnly, error, save])
  return <CoverContext.Provider value={value}>{children}</CoverContext.Provider>
}

/** 아이콘 칸이 배너에 걸칠지 — 커버가 있으면 참. 공급자가 없으면(데이터베이스 머리) 거짓. */
export function useHasPageCover(): boolean {
  return (useContext(CoverContext)?.cover ?? null) !== null
}

function CoverError({ error }: { error: string | null }) {
  if (error === null) return null
  return (
    <p role="alert" className="text-sm text-red-600">
      {error}
    </p>
  )
}

/** 머리의 "커버 추가" — 아이콘 칸의 줄에 선다(`PageIconControl` 의 `actions`). 커버가 있거나 고칠 수 없으면 없다. */
export function PageCoverAddButton() {
  const state = useContext(CoverContext)
  if (state === null || state.readOnly || state.cover !== null) return null
  return (
    <>
      <button
        type="button"
        data-testid="page-cover-add"
        onClick={() => void state.save(randomGalleryCover())}
        className="rounded px-1.5 py-0.5 text-sm text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:opacity-100 group-hover/header:opacity-100 touch:opacity-100 dark:hover:bg-neutral-800"
      >
        ▭ 커버 추가
      </button>
      <CoverError error={state.error} />
    </>
  )
}

/** 상단 바 아래의 배너 — 커버가 있을 때만. 페이지는 전체 폭 · 피크는 패널 폭의 낮은 판. */
export function PageCoverBanner({ frame }: { frame: 'page' | 'peek' }) {
  const state = useContext(CoverContext)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  const isTrigger = useCallback((target: EventTarget | null) => target instanceof Node && !!triggerRef.current?.contains(target), [])
  if (state === null || state.cover === null) return null
  const { cover } = state

  return (
    <div className="relative w-full shrink-0">
      <div
        data-testid="page-cover"
        data-page-cover={pageCoverKey(cover)}
        role="img"
        aria-label="페이지 커버"
        className={`group/cover relative w-full overflow-hidden ${frame === 'page' ? 'h-[30vh] max-h-[280px] min-h-[120px]' : 'h-[120px] rounded-md'}`}
        style={{ background: cover.type === 'gallery' ? coverBackground(cover) : COVER_FALLBACK_BACKGROUND }}
      >
        {cover.type === 'external' && <CoverImage key={cover.url} src={cover.url} />}
        {/* 올린 이미지(PC-2) — 세션으로 인증되는 워크스페이스의 파일 경로(이미지 블록 · 아이콘과 같다 · 주소는 파생값) */}
        {cover.type === 'file' && <CoverImage key={cover.file_id} src={imageContentPath(state.workspaceId, cover.file_id)} />}
        {!state.readOnly && (
          <div className="absolute bottom-3 right-4 flex gap-1 opacity-0 focus-within:opacity-100 group-hover/cover:opacity-100 touch:opacity-100">
            <button
              ref={triggerRef}
              type="button"
              data-testid="page-cover-change"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="rounded bg-white/90 px-2 py-1 text-xs text-neutral-700 shadow-sm hover:bg-white dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              커버 바꾸기
            </button>
          </div>
        )}
      </div>
      {open && !state.readOnly && (
        <CoverPicker
          workspaceId={state.workspaceId}
          current={cover}
          onPick={(next) => {
            close(true)
            void state.save(next)
          }}
          onRemove={() => {
            setOpen(false)
            void state.save(null)
          }}
          onClose={close}
          isTrigger={isTrigger}
        />
      )}
      <div className={frame === 'page' ? 'px-6' : ''}>
        <CoverError error={state.error} />
      </div>
    </div>
  )
}

/** 외부 이미지 — 가로 꽉 · 잘라 채움 · referrer 를 보내지 않는다(아이콘과 같다) · 못 불러오면 회색 판(배너의 바탕). */
function CoverImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  // 외부 주소를 그대로 그린다 — next/image 의 최적화 서버를 거치지 않는다(임의의 호스트 · 아이콘과 같다).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
}

function CoverPicker({
  workspaceId,
  current,
  onPick,
  onRemove,
  onClose,
  isTrigger,
}: {
  workspaceId: string
  current: PageCover
  onPick(next: PageCover): void
  onRemove(): void
  onClose(restoreFocus: boolean): void
  isTrigger(target: EventTarget | null): boolean
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [tab, setTab] = useState<'gallery' | 'upload' | 'link'>(current.type === 'external' ? 'link' : current.type === 'file' ? 'upload' : 'gallery')
  const [url, setUrl] = useState(current.type === 'external' ? current.url : '')
  const [urlError, setUrlError] = useState<string | null>(null)

  // 바깥을 누르면 닫는다 — 이 고르개를 연 트리거는 건너뛴다(트리거의 click 이 닫는다).
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node) || isTrigger(event.target)) return
      onClose(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose, isTrigger])

  const submitUrl = (): void => {
    const parsed = parsePageCoverInput({ type: 'external', url })
    if (parsed === undefined || parsed === null) {
      setUrlError('http:// 나 https:// 로 시작하는 이미지 주소를 넣어 주세요.')
      return
    }
    onPick(parsed)
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="커버"
      data-testid="page-cover-picker"
      onBlur={(e) => {
        const next = e.relatedTarget
        if (next instanceof Node && !e.currentTarget.contains(next) && !isTrigger(next)) onClose(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose(true)
        }
      }}
      className="absolute right-4 top-full z-30 mt-2 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-2 popover-surface p-2"
    >
      <div className="flex items-center justify-between px-1">
        <div role="tablist" aria-label="커버 종류" className="flex gap-1">
          {(
            [
              ['gallery', '내장'],
              ['upload', '올리기'],
              ['link', '링크'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`page-cover-tab-${key}`}
              onClick={() => setTab(key)}
              className={`rounded px-2 py-1 text-sm ${tab === key ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="page-cover-remove"
          onClick={onRemove}
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          지우기
        </button>
      </div>
      {tab === 'gallery' ? (
        <div role="group" aria-label="내장 커버" className="grid grid-cols-4 gap-2 p-1">
          {COVER_GALLERY.map((entry) => {
            const selected = current.type === 'gallery' && current.gallery === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                data-testid="page-cover-gallery"
                data-gallery={entry.id}
                aria-label={entry.label}
                aria-pressed={selected}
                title={entry.label}
                onClick={() => onPick({ type: 'gallery', gallery: entry.id })}
                className={`h-14 rounded ${selected ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:opacity-80'}`}
                style={{ background: entry.background }}
              />
            )
          })}
        </div>
      ) : tab === 'upload' ? (
        <UploadPanel workspaceId={workspaceId} onPick={onPick} />
      ) : (
        <form
          className="flex flex-col gap-2 p-1"
          onSubmit={(e) => {
            e.preventDefault()
            submitUrl()
          }}
        >
          <input
            type="url"
            data-testid="page-cover-url"
            aria-label="이미지 주소"
            placeholder="https://… 이미지 주소"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setUrlError(null)
            }}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          />
          {urlError !== null && (
            <p role="alert" className="text-xs text-red-600">
              {urlError}
            </p>
          )}
          <button
            type="submit"
            data-testid="page-cover-url-submit"
            className="self-end rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            커버로
          </button>
        </form>
      )}
    </div>
  )
}

/**
 * "올리기" 탭(PC-2) — 파일을 올리고 그 파일 id 를 커버로 넘긴다(아이콘의 이미지 탭과 같은 `uploadImageFile`). 올리는 동안 고르개가 닫혀도
 * (바깥을 눌렀다) 끝난 응답을 넘기지 않는다 — 닫은 사람이 고른 것이 아니다.
 */
function UploadPanel({ workspaceId, onPick }: { workspaceId: string; onPick(next: PageCover): void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const upload = async (file: File): Promise<void> => {
    setError(null)
    setUploading(true)
    const outcome = await uploadImageFile(workspaceId, file)
    if (!alive.current) return
    setUploading(false)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    onPick({ type: 'file', file_id: outcome.fileId })
  }

  return (
    <div role="tabpanel" aria-label="올리기" data-testid="page-cover-upload-panel" className="flex flex-col gap-1 p-1">
      <button
        type="button"
        data-testid="page-cover-upload"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {uploading ? '올리는 중…' : '파일 올리기'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED_IMAGE_MIME.join(',')}
        data-testid="page-cover-upload-input"
        tabIndex={-1}
        aria-hidden
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // 같은 파일을 다시 고를 수 있게 비운다(같은 값이면 change 가 오지 않는다).
          e.target.value = ''
          if (file !== undefined) void upload(file)
        }}
      />
      <p className="text-xs text-neutral-500">PNG · JPEG · GIF · WebP, 5MB 까지. 가로로 넓은 그림(1500px 이상)이 잘 맞습니다.</p>
      {error !== null && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
