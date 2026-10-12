'use client'

/**
 * 커스텀 이모지 패널 — 설정 → 워크스페이스 → 이모지 (인접 제품 7c-2b · F-13-16)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ⑥
 *
 * 목록(그림 · `:이름:` · 이름 순) · 올리기 · 이름 바꾸기 · 지우기. 판정은 모두 서버다(`/emoji` 라우트 · `emoji/custom-emoji.ts`) — 화면은
 * 단추를 세울지만 정한다(`canCreate` · 줄마다 `canManage`).
 *
 * 올리기는 두 번의 요청이다(파일 → 이모지). 그래서 **파일을 올리기 전에** 같은 규칙으로 거른다 — 그림을 고르면 형식 · 크기를 보고
 * (`emojiFileProblem`), 이름은 파일 이름에서 제안하고(`suggestEmojiName`) 저장할 때 모양을 본다(`emojiNameOrProblem`). 그래도 서버가
 * 거부하면(같은 이름 · 개수) 그 말을 보인다 — 올린 파일은 참조 0 으로 남아 GC 의 몫이다(정본 ⑥).
 *
 * 지우기는 한 번 더 묻는다 — 되돌릴 수 없고 쓰인 아이콘이 기본 글리프로 바뀐다.
 *
 * 이름 칸의 Enter 는 keydown 에서 받는다(다른 입력칸들과 같다 — 제목 · 이미지 주소) · 한글 조합을 끝내는 Enter 는 조합의 것이다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { customEmojiImagePath } from '@/lib/block/page-icon'
import type { CustomEmoji } from '@/lib/emoji/custom-emoji'
import { suggestEmojiName } from '@/lib/emoji/custom-emoji-rules'
import { ALLOWED_IMAGE_MIME } from '@/lib/file/limits'
import { uploadImageFile } from '@/lib/file/upload-client'
import {
  EMOJI_DELETE_CONFIRM,
  EMOJI_NAME_HINT,
  EMOJI_OWNERS_ONLY_NOTE,
  EMOJI_PANEL_NOTE,
  emojiFailureMessage,
  emojiFileProblem,
  emojiNameOrProblem,
} from './emoji-messages'

const FIELD =
  'min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700'
const BUTTON =
  'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

type Draft = { readonly file: File; readonly preview: string; readonly name: string }

const byName = (a: CustomEmoji, b: CustomEmoji): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** 한글 조합 중의 키는 조합의 것이다(229 는 조합 중에 오는 keyCode) — 조합을 끝내는 Enter 가 저장이 되지 않게. */
const isComposing = (e: KeyboardEvent<HTMLInputElement>): boolean => e.nativeEvent.isComposing || e.keyCode === 229

export function EmojiPanel({ workspaceId, initial, canCreate }: { workspaceId: string; initial: CustomEmoji[]; canCreate: boolean }) {
  const [list, setList] = useState<CustomEmoji[]>(initial)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly name: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 미리보기 주소는 그 초안이 내려갈 때 놓는다(이름만 바뀌면 같은 주소다).
  const preview = draft?.preview ?? null
  useEffect(() => {
    if (preview === null) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const say = (next: { error?: string | null; notice?: string | null }) => {
    setError(next.error ?? null)
    setNotice(next.notice ?? null)
  }

  const pick = (file: File) => {
    const problem = emojiFileProblem(file)
    if (problem !== null) {
      say({ error: problem })
      return
    }
    say({})
    setDraft({ file, preview: URL.createObjectURL(file), name: suggestEmojiName(file.name) })
  }

  const create = async () => {
    if (draft === null) return
    const checked = emojiNameOrProblem(draft.name)
    if ('problem' in checked) {
      say({ error: checked.problem })
      return
    }
    setBusy(true)
    say({})
    try {
      const uploaded = await uploadImageFile(workspaceId, draft.file)
      if (!uploaded.ok) {
        say({ error: uploaded.message })
        return
      }
      const res = await fetch(`/api/workspaces/${workspaceId}/emoji`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: checked.name, fileId: uploaded.fileId }),
      })
      const body = (await res.json().catch(() => null)) as { emoji?: CustomEmoji; error?: string } | null
      if (!res.ok || body?.emoji === undefined) {
        say({ error: emojiFailureMessage(body?.error, 'create') })
        return
      }
      const made = body.emoji
      setList((prev) => [...prev, made].sort(byName))
      setDraft(null)
      say({ notice: `:${made.name}: 을 추가했습니다.` })
    } catch {
      say({ error: '연결에 실패했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    if (renaming === null) return
    const checked = emojiNameOrProblem(renaming.name)
    if ('problem' in checked) {
      say({ error: checked.problem })
      return
    }
    setBusy(true)
    say({})
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/emoji/${renaming.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: checked.name }),
      })
      const body = (await res.json().catch(() => null)) as { emoji?: CustomEmoji; error?: string } | null
      if (!res.ok || body?.emoji === undefined) {
        say({ error: emojiFailureMessage(body?.error, 'manage') })
        return
      }
      const updated = body.emoji
      setList((prev) => prev.map((e) => (e.id === updated.id ? updated : e)).sort(byName))
      setRenaming(null)
      say({ notice: `이름을 :${updated.name}: 로 바꿨습니다.` })
    } catch {
      say({ error: '연결에 실패했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (emoji: CustomEmoji) => {
    setBusy(true)
    say({})
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/emoji/${emoji.id}`, { method: 'DELETE' })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      // 이미 지운 것이면(404) 목록에서도 뺀다 — 다른 사람이 먼저 지웠다.
      if (!res.ok && body?.error !== 'not_found') {
        say({ error: emojiFailureMessage(body?.error, 'manage') })
        return
      }
      setList((prev) => prev.filter((e) => e.id !== emoji.id))
      setConfirming(null)
      say({ notice: `:${emoji.name}: 을 지웠습니다.` })
    } catch {
      say({ error: '연결에 실패했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="emoji-panel" className="mt-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">커스텀 이모지 {list.length}개</h2>
        {canCreate && draft === null && (
          <button type="button" data-testid="emoji-add" disabled={busy} onClick={() => fileRef.current?.click()} className={BUTTON}>
            이모지 추가
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">{EMOJI_PANEL_NOTE}</p>
      {!canCreate && (
        <p data-testid="emoji-owners-only" className="text-xs text-neutral-500">
          {EMOJI_OWNERS_ONLY_NOTE}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED_IMAGE_MIME.join(',')}
        data-testid="emoji-file-input"
        tabIndex={-1}
        aria-hidden
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // 같은 파일을 다시 고를 수 있게 비운다(같은 값이면 change 가 오지 않는다).
          e.target.value = ''
          if (file !== undefined) pick(file)
        }}
      />

      {draft !== null && (
        <form
          data-testid="emoji-draft"
          className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 고른 파일의 미리보기(blob 주소) */}
          <img src={draft.preview} alt="" className="h-8 w-8 flex-none rounded object-contain" />
          <span className="text-sm text-neutral-400">:</span>
          <input
            aria-label="이모지 이름"
            data-testid="emoji-name-input"
            value={draft.name}
            disabled={busy}
            autoFocus
            autoComplete="off"
            title={EMOJI_NAME_HINT}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => {
              if (isComposing(e)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                void create()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(null)
              }
            }}
            className={FIELD}
          />
          <span className="text-sm text-neutral-400">:</span>
          <button type="submit" data-testid="emoji-save" disabled={busy} className={BUTTON}>
            {busy ? '올리는 중…' : '추가'}
          </button>
          <button type="button" data-testid="emoji-cancel" disabled={busy} onClick={() => setDraft(null)} className={BUTTON}>
            취소
          </button>
        </form>
      )}

      {list.length === 0 ? (
        <p data-testid="emoji-empty" className="text-sm text-neutral-500">
          아직 커스텀 이모지가 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {list.map((emoji) => (
            <li key={emoji.id} data-testid="emoji-row" data-emoji-id={emoji.id} data-name={emoji.name} className="flex items-center gap-3 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- 세션으로 인증되는 우리 경로(아이콘 · 이미지 블록과 같다) */}
              <img src={customEmojiImagePath(workspaceId, emoji.id)} alt="" className="h-6 w-6 flex-none object-contain" />
              {renaming?.id === emoji.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void rename()
                  }}
                >
                  <input
                    aria-label={`:${emoji.name}: 의 새 이름`}
                    data-testid="emoji-rename-input"
                    value={renaming.name}
                    disabled={busy}
                    autoFocus
                    autoComplete="off"
                    title={EMOJI_NAME_HINT}
                    onChange={(e) => setRenaming({ id: emoji.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (isComposing(e)) return
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void rename()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setRenaming(null)
                      }
                    }}
                    className={FIELD}
                  />
                  <button type="submit" data-testid="emoji-rename-save" disabled={busy} className={BUTTON}>
                    저장
                  </button>
                  <button type="button" disabled={busy} onClick={() => setRenaming(null)} className={BUTTON}>
                    취소
                  </button>
                </form>
              ) : confirming === emoji.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1 text-xs text-red-600">{EMOJI_DELETE_CONFIRM}</span>
                  <button type="button" data-testid="emoji-delete-confirm" disabled={busy} onClick={() => void remove(emoji)} className={BUTTON}>
                    지우기
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={BUTTON}>
                    취소
                  </button>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm" data-testid="emoji-name">
                    :{emoji.name}:
                  </span>
                  {emoji.canManage && (
                    <>
                      <button
                        type="button"
                        data-testid="emoji-rename"
                        disabled={busy}
                        onClick={() => {
                          say({})
                          setConfirming(null)
                          setRenaming({ id: emoji.id, name: emoji.name })
                        }}
                        className={BUTTON}
                      >
                        이름 바꾸기
                      </button>
                      <button
                        type="button"
                        data-testid="emoji-delete"
                        disabled={busy}
                        onClick={() => {
                          say({})
                          setRenaming(null)
                          setConfirming(emoji.id)
                        }}
                        className={BUTTON}
                      >
                        지우기
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p role="alert" data-testid="emoji-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" data-testid="emoji-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
    </section>
  )
}
