/**
 * 이모지 고르개 — 페이지 아이콘 (잔여 묶음 8c-1 · F-02-05)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 부르는 쪽(`page-icon-control.tsx`)이 클라이언트 그래프이고, 함수 props 는 경계를 넘지 못한다.
 *
 * 모양은 코드 언어 목록(`code-language-menu.tsx`)과 같은 검색형 콤보박스다 — **입력칸이 포커스를 지키고** 고를 항목은
 * `aria-activedescendant` 로 가리킨다. 이모지는 1,900개에 가까워 항목마다 탭 순서에 세울 수 없다. 목록은 격자로 펼친다:
 *   ← → 한 칸 · ↑ ↓ 한 줄(`COLUMNS` 칸 — 그룹의 경계에서는 줄이 어긋날 수 있다) · Enter 고르기 · Esc 닫고 아이콘으로 돌아가기.
 *   **한글 조합 중에는 손대지 않는다**(조합을 끝내는 Enter 가 고르기가 되지 않게).
 * Tab 은 막지 않는다 — 입력칸 · 무작위 · 제거를 차례로 지나고, 고르개 밖으로 나가면 닫는다. 바깥을 누르면 닫는다.
 *
 * 데이터는 열 때 지연 로드한다(`emoji-catalog-loader.ts`). 검색은 한국어 이름 · 태그(`searchEmoji`) — 빈 검색어면 그룹별 목록.
 *
 * **"이미지" 탭**(8c-4 · `onPickImage` 를 받을 때만) — 노션의 Upload 탭과 같다. 파일을 올리면(이미지 블록과 같은 업로드 길 ·
 * `uploadImageFile`) 그 파일 id 를, 주소를 넣으면 그 주소를 아이콘으로 넘긴다. 주소의 규칙은 서버와 같은 함수다
 * (`parsePageIconInput` — http · https · 공백 없음 · 2048자). 파일 대화상자가 열리며 창의 포커스가 나가도 고르개는 닫히지 않는다
 * (아래 `onBlur` 는 포커스가 고르개 **밖의 요소**로 갈 때만 닫는다 — 창 밖은 `relatedTarget` 이 없다).
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { searchEmoji, type EmojiCatalog, type EmojiEntry } from '@/lib/emoji/catalog'
import { parsePageIconInput, type ImageIcon } from '@/lib/block/page-icon'
import { ALLOWED_IMAGE_MIME } from '@/lib/file/limits'
import { uploadImageFile } from '@/lib/file/upload-client'
import { loadEmojiCatalog } from './emoji-catalog-loader'

/** 격자의 칸 수 — CSS 의 `grid-cols-10` 과 같은 값(↑ ↓ 가 한 줄을 건너뛴다). */
export const EMOJI_COLUMNS = 10

/** 목록의 한 덩어리 — `start` 는 그 첫 항목의 펼친 번호(활성 항목 · 항목 id 의 번호). */
type Section = { readonly id: string; readonly label: string; readonly entries: readonly EmojiEntry[]; readonly start: number }

export type EmojiPickerProps = {
  /** 지금 아이콘의 이모지 — 없거나 이미지면 null. 목록에서 표시한다. */
  current: string | null
  /** 지금 아이콘이 있다 — "제거"를 세운다(이미지 아이콘이면 `current` 는 null 이지만 지울 수 있다). */
  removable: boolean
  /** 이미지 아이콘을 고른다(8c-4 — 올린 파일 · 이미지 주소). 없으면 "이미지" 탭을 세우지 않는다. */
  onPickImage?: (icon: ImageIcon) => void
  /** 파일을 올릴 워크스페이스 — `onPickImage` 와 함께 준다. */
  workspaceId?: string
  onPick: (emoji: string) => void
  onRandom: () => void
  onRemove: () => void
  /** `restoreFocus`: 아이콘(트리거)으로 포커스를 돌려줄 것인가. */
  onClose: (restoreFocus: boolean) => void
  /** 이 고르개를 연 트리거인가 — 바깥 누르기가 건너뛴다(트리거의 click 이 닫는다). */
  isTrigger?: (target: EventTarget | null) => boolean
}

export function EmojiPicker({
  current,
  removable,
  onPickImage,
  workspaceId,
  onPick,
  onRandom,
  onRemove,
  onClose,
  isTrigger,
}: EmojiPickerProps) {
  const [tab, setTab] = useState<'emoji' | 'image'>('emoji')
  const [catalog, setCatalog] = useState<EmojiCatalog | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-option-${i}`

  useEffect(() => {
    let alive = true
    loadEmojiCatalog().then(
      (loaded) => {
        if (alive) setCatalog(loaded)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  // 빈 검색어면 그룹별 목록, 아니면 검색 결과 한 덩어리. 활성 항목은 펼친 순서의 번호다.
  const sections = useMemo<Section[]>(() => {
    if (catalog === null) return []
    const parts =
      query.trim() === ''
        ? catalog.groups.map((g) => ({ id: `g${g.id}`, label: g.label, entries: g.entries }))
        : [{ id: 'search', label: '검색 결과', entries: searchEmoji(catalog, query) }]
    let start = 0
    return parts.map((part) => {
      const section = { ...part, start }
      start += part.entries.length
      return section
    })
  }, [catalog, query])
  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections])

  // 활성 항목이 보이게 한다.
  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: 'nearest' })
    // optionId 는 listId 로만 정해진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 바깥을 누르면 닫는다 — 이 고르개를 연 트리거는 건너뛴다(트리거의 click 이 닫는다).
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node) || isTrigger?.(event.target)) return
      onClose(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose, isTrigger])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    // 한글 조합 중의 Enter · 화살표는 조합의 것이다(229 는 조합 중에 오는 keyCode).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const last = flat.length - 1
    const move = (delta: number): void => {
      event.preventDefault()
      if (last < 0) return
      setActive((i) => Math.min(last, Math.max(0, i + delta)))
    }
    if (event.key === 'ArrowRight') move(1)
    else if (event.key === 'ArrowLeft') move(-1)
    else if (event.key === 'ArrowDown') move(EMOJI_COLUMNS)
    else if (event.key === 'ArrowUp') move(-EMOJI_COLUMNS)
    else if (event.key === 'Enter') {
      event.preventDefault()
      const entry = flat[active]
      if (entry) onPick(entry.emoji)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // window 의 Esc 리스너(코멘트 패널 같은 것)가 함께 돌지 않게.
      event.stopPropagation()
      onClose(true)
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="아이콘"
      data-testid="emoji-picker"
      // 목록의 빈 자리 · 항목을 눌러도 검색칸이 포커스를 지킨다 — 잃으면 키가 죽는다(코드 언어 목록과 같은 까닭). 버튼 · 입력칸
      // (검색칸 · 이미지 주소)은 받는다.
      onMouseDown={(e) => {
        if (!(e.target instanceof Element && e.target.closest('button, input'))) e.preventDefault()
      }}
      // 포커스가 고르개 밖으로 나가면(Tab) 닫는다. 바깥을 누른 것은 위의 pointerdown 이 먼저 닫는다.
      onBlur={(e) => {
        const next = e.relatedTarget
        if (next instanceof Node && !e.currentTarget.contains(next) && !isTrigger?.(next)) onClose(false)
      }}
      onKeyDown={(e) => {
        // 버튼(무작위 · 제거)에 포커스가 있을 때의 Esc.
        if (e.key === 'Escape' && e.target !== inputRef.current) {
          e.preventDefault()
          e.stopPropagation()
          onClose(true)
        }
      }}
      className="absolute left-0 top-full z-30 mt-2 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div className="flex items-center justify-between px-1">
        {onPickImage === undefined ? (
          <span className="text-sm font-medium">이모지</span>
        ) : (
          <div role="tablist" aria-label="아이콘 종류" className="flex gap-1">
            {(
              [
                ['emoji', '이모지'],
                ['image', '이미지'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                data-testid={`icon-tab-${key}`}
                onClick={() => setTab(key)}
                className={`rounded px-2 py-0.5 text-sm ${
                  tab === key ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {removable && (
          <button
            type="button"
            data-testid="page-icon-remove"
            onClick={onRemove}
            className="rounded px-2 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            제거
          </button>
        )}
      </div>
      {tab === 'image' && onPickImage !== undefined && workspaceId !== undefined ? (
        <ImagePanel workspaceId={workspaceId} onPickImage={onPickImage} />
      ) : (
        <>
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              data-testid="emoji-search"
              role="combobox"
              aria-label="이모지 검색"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                // 검색어가 바뀌면 맨 앞 후보로.
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="이모지 검색"
              className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <button
              type="button"
              data-testid="emoji-random"
              aria-label="무작위 이모지"
              title="무작위"
              disabled={catalog === null}
              onClick={onRandom}
              className="flex-none rounded px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
            >
              🎲
            </button>
          </div>

          <div ref={listRef} id={listId} role="listbox" aria-label="이모지" className="max-h-72 overflow-auto">
            {catalog === null && !failed && <p className="px-1 py-2 text-sm text-neutral-500">이모지를 불러오는 중…</p>}
            {failed && (
              <p role="alert" className="flex items-center gap-2 px-1 py-2 text-sm text-red-600">
                이모지 목록을 불러오지 못했습니다.
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false)
                    setAttempt((n) => n + 1)
                  }}
                  className="underline underline-offset-2"
                >
                  다시 시도
                </button>
              </p>
            )}
            {catalog !== null && flat.length === 0 && <p className="px-1 py-2 text-sm text-neutral-500">맞는 이모지가 없습니다</p>}
            {sections.map((section) =>
              section.entries.length === 0 ? null : (
                <div key={section.id} role="group" aria-labelledby={`${listId}-${section.id}`}>
                  <div id={`${listId}-${section.id}`} className="px-1 pb-1 pt-2 text-xs text-neutral-500">
                    {section.label}
                  </div>
                  <div className="grid grid-cols-10">
                    {section.entries.map((entry, n) => {
                      const i = section.start + n
                      return (
                        <div
                          key={entry.emoji}
                          id={optionId(i)}
                          role="option"
                          aria-selected={i === active}
                          aria-label={entry.label}
                          title={entry.label}
                          data-emoji={entry.emoji}
                          data-current={entry.emoji === current ? '' : undefined}
                          onClick={() => onPick(entry.emoji)}
                          // 포인터가 실제로 움직였을 때만 — 키보드로 옮긴 활성 항목을 보이려고 목록이 굴러가면 가만히 있는 포인터 밑으로 다른
                          // 항목이 들어와 경계 이벤트가 오고, 그것이 키보드의 자리를 되돌린다(코드 언어 목록의 8a-2 리뷰와 같다).
                          onMouseMove={() => {
                            if (active !== i) setActive(i)
                          }}
                          className={`flex h-8 cursor-pointer items-center justify-center rounded text-xl ${
                            i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                          } ${entry.emoji === current ? 'ring-1 ring-neutral-400' : ''}`}
                        >
                          {entry.emoji}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * "이미지" 탭 — 파일 올리기 · 이미지 주소. 올리는 동안 고르개가 닫혀도(바깥을 눌렀다) 끝난 응답을 넘기지 않는다 — 닫은 사람이 고른
 * 것이 아니다.
 */
function ImagePanel({ workspaceId, onPickImage }: { workspaceId: string; onPickImage: (icon: ImageIcon) => void }) {
  const [uploading, setUploading] = useState(false)
  const [link, setLink] = useState('')
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
    onPickImage({ type: 'file', file_id: outcome.fileId })
  }

  const submitLink = (): void => {
    // 서버와 같은 함수로 거른다 — http · https · 공백 없음 · 길이.
    const parsed = parsePageIconInput({ type: 'external', url: link })
    if (parsed === null || parsed === undefined || parsed.type !== 'external') {
      setError('http:// 나 https:// 로 시작하는 이미지 주소를 넣어 주세요.')
      return
    }
    onPickImage(parsed)
  }

  return (
    <div role="tabpanel" aria-label="이미지" data-testid="icon-image-panel" className="flex flex-col gap-3 px-1 py-2">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-testid="icon-upload"
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
          data-testid="icon-upload-input"
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
        <p className="text-xs text-neutral-500">PNG · JPEG · GIF · WebP, 5MB 까지. 정사각형이 잘 맞습니다.</p>
      </div>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          submitLink()
        }}
      >
        <input
          data-testid="icon-link-input"
          aria-label="이미지 주소"
          placeholder="https:// 이미지 주소"
          value={link}
          onChange={(e) => {
            setLink(e.target.value)
            setError(null)
          }}
          // Enter 는 keydown 에서 받는다(다른 입력칸들과 같다 — 제목 · 이름) · 한글 조합을 끝내는 Enter 는 조합의 것이다.
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') {
              e.preventDefault()
              submitLink()
            }
          }}
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          data-testid="icon-link-submit"
          className="flex-none rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          넣기
        </button>
      </form>
      {error !== null && (
        <p role="alert" data-testid="icon-image-error" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
