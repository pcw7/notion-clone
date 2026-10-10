'use client'

/**
 * 버튼 설정 — 열 머리 메뉴 안의 편집기 (자동화 5a-3 · 5a-4 · F-03-15 · F-08-07)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥ ⑨ ⑩ ⑪
 *
 * 액션을 고치는 부품은 DB automation 편집기와 함께 쓴다(`action-editor.tsx` — 값 바꾸기 · 다른 표에 행 추가 · 웹훅 · 모르는 액션은 남긴다).
 * 이 파일은 버튼의 액션을 읽고 저장한다. 메뉴는 구조를 고칠 수 있는 사람에게만 선다(표가 정한다 · 서버가 다시 묻는다).
 *
 * 꺼진 버튼(웹훅이 네 번 실패해 멈췄다 — 정본 [보강] 자동화 엔진 ⑬ ⑮)이면 까닭을 적고 **다시 켜기**를 둔다 — 버튼에는 실행 기록 화면이
 * 없으므로 여기가 알아보는 자리다.
 */

import { useEffect, useState } from 'react'

import * as api from './table-api'
import { ActionListEditor, toAction, toDraft, type ActionDraft } from './action-editor'
import { buttonDisabledMessage } from './button-messages'

export function ButtonEditForm({
  workspaceId,
  dataSourceId,
  propertyId,
  onSaved,
  onCancel,
}: {
  workspaceId: string
  dataSourceId: string
  propertyId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [drafts, setDrafts] = useState<readonly ActionDraft[] | null>(null)
  /** 꺼졌으면 그 까닭(사람이 껐으면 null) — 켜져 있으면 undefined. */
  const [off, setOff] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void api.readButtonActions(workspaceId, dataSourceId, propertyId).then((read) => {
      if (!alive) return
      if (!read.ok) {
        setError(read.message)
        return
      }
      setDrafts(read.value.actions.map(toDraft))
      setOff(read.value.enabled ? undefined : read.value.disabledReason)
    })
    return () => {
      alive = false
    }
  }, [workspaceId, dataSourceId, propertyId])

  const save = async () => {
    if (drafts === null) return
    setBusy(true)
    setError(null)
    const saved = await api.saveButtonActions(workspaceId, dataSourceId, propertyId, drafts.map(toAction))
    setBusy(false)
    if (saved.ok) onSaved()
    else setError(saved.message)
  }

  const enable = async () => {
    setBusy(true)
    setError(null)
    const turned = await api.setButtonEnabled(workspaceId, dataSourceId, propertyId, true)
    setBusy(false)
    if (turned.ok) setOff(undefined)
    else setError(turned.message)
  }

  if (drafts === null) {
    return (
      <div className="p-3 text-xs text-neutral-500" data-testid="db-button-editor">
        {error ?? '읽는 중…'}
      </div>
    )
  }

  return (
    <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto p-3 text-xs" data-testid="db-button-editor">
      {off !== undefined && (
        <div role="note" data-testid="db-button-disabled" className="flex items-center gap-2 rounded bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="min-w-0 flex-1">{buttonDisabledMessage(off)}</span>
          <button
            type="button"
            data-testid="db-button-enable"
            disabled={busy}
            onClick={() => void enable()}
            className="shrink-0 rounded border border-amber-400 px-2 py-0.5 hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900"
          >
            다시 켜기
          </button>
        </div>
      )}
      <p className="font-semibold">버튼을 누르면</p>
      <ActionListEditor
        workspaceId={workspaceId}
        dataSourceId={dataSourceId}
        drafts={drafts}
        onChange={setDrafts}
        editLabel="이 행의 값 바꾸기"
        rowLabel="누른 행"
        testIdPrefix="db-button"
      />
      {error !== null && (
        <p role="alert" data-testid="db-button-editor-error" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          취소
        </button>
        <button
          type="button"
          data-testid="db-button-save"
          disabled={busy}
          onClick={() => void save()}
          className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          저장
        </button>
      </div>
    </div>
  )
}
