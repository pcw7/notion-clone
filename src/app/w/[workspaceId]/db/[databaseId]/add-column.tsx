'use client'

/**
 * 속성(컬럼) 추가 — F-03-02 · F-03-10(관계형)
 *
 * 표 머리 오른쪽 끝의 `+`. 이름과 유형을 받아 맨 뒤에 붙인다(`addProperty` 가 맨 뒤에
 * 붙이는 것과 같은 자리). `title` 은 고를 수 없다 — 표마다 정확히 하나다(불변식 P1).
 *
 * 이 버튼은 `edit_structure` 가 있을 때만 그려진다(표가 정한다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 관계형은 다른 명령이다 (relation 5b-2조각)
 * ──────────────────────────────────────────────────────────────────────
 *
 * relation 은 셀 타입이 아니고(`APP_PROPERTY_TYPES` 머리말) 만드는 데 **대상 표**가 필요하다 — 그래서 `onAdd` 가 아니라
 * `onAddRelation` 으로 나간다(`POST …/relations`). 유형에서 "관계형"을 고르면 세 가지가 더 보인다:
 *
 *   연결할 데이터베이스   볼 수 있는 표만(`GET …/databases`). "관계형"을 **고를 때** 읽는다 — 폼을 열 때마다 읽지 않는다.
 *   반대쪽에도 표시       양방향. 대상 표에 역방향 속성이 **따로** 생긴다 — 그 이름을 받는다. 대상 표의 `edit_structure` 가
 *                         없으면 서버가 거부하고(`forbidden`) **아무것도 만들지 않는다**(HANDOFF §3.2-31).
 *   하나만 연결           `limit: 'one'`. 고르면 있던 연결이 그것으로 바뀐다.
 *
 * 같은 표를 고르고 "반대쪽에도 표시"를 끄면 속성 하나가 양쪽으로 동작한다(자기 짝) — 서버가 정한다. 이 폼은 그 네 모양을
 * 따로 설명하지 않는다: 고른 대로 보내고, 생긴 컬럼을 그린다.
 */

import { useEffect, useRef, useState } from 'react'

import { MVP_PROPERTY_TYPES, type MvpPropertyType } from '@/lib/database/property-types'
import type { DatabaseListItem } from '@/lib/database/database'
import * as api from './table-api'
import { TYPE_ICON, TYPE_LABEL } from './cell-view'

type AddableType = Exclude<MvpPropertyType, 'title'> | 'relation'

const ADDABLE_TYPES: readonly AddableType[] = [
  ...MVP_PROPERTY_TYPES.filter((t): t is Exclude<MvpPropertyType, 'title'> => t !== 'title'),
  'relation',
]

const FIELD =
  'rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:text-neutral-100'

export function AddColumn({
  workspaceId,
  dataSourceId,
  tableName,
  onAdd,
  onAddRelation,
}: {
  workspaceId: string
  /** 이 표. 대상 목록에서 "이 표"를 짚어 주는 데만 쓴다. */
  dataSourceId: string
  /** 역방향 속성 이름의 기본값 — 대상 표에서 보면 그 칸은 "이 표의 행들"이다. */
  tableName: string
  /** 실패하면 사람이 읽을 이유를, 성공하면 `null` 을 돌려준다. */
  onAdd: (name: string, type: MvpPropertyType) => Promise<string | null>
  onAddRelation: (input: api.AddRelationInput) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<AddableType>('rich_text')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // 관계형
  const [databases, setDatabases] = useState<readonly DatabaseListItem[] | null>(null)
  const [target, setTarget] = useState('')
  const [twoWay, setTwoWay] = useState(false)
  const [inverseName, setInverseName] = useState(tableName)
  const [limitOne, setLimitOne] = useState(false)

  useEffect(() => {
    if (open) nameRef.current?.focus()
  }, [open])

  const close = () => {
    setOpen(false)
    setName('')
    setType('rich_text')
    setError(null)
    setTarget('')
    setTwoWay(false)
    setInverseName(tableName)
    setLimitOne(false)
  }

  const pickType = async (next: AddableType) => {
    setType(next)
    setError(null)
    if (next !== 'relation' || databases !== null) return
    const result = await api.listDatabases(workspaceId)
    if (!result.ok) {
      setError(result.message)
      setDatabases([])
      return
    }
    setDatabases(result.value)
  }

  // 고르지 않았으면 첫 표다 — `<select>` 가 그렇게 보이므로 보내는 값도 그래야 한다.
  const targetId = target !== '' ? target : (databases?.[0]?.dataSourceId ?? '')
  const isRelation = type === 'relation'
  const incomplete =
    name.trim() === '' || (isRelation && (targetId === '' || (twoWay && inverseName.trim() === '')))

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="db-add-column"
        aria-label="속성 추가"
        aria-expanded={open}
        title="속성 추가"
        onClick={() => (open ? close() : setOpen(true))}
        className="w-full rounded px-2 text-base text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        +
      </button>

      {open && (
        <form
          role="dialog"
          aria-label="속성 추가"
          data-testid="db-add-column-form"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              close()
            }
          }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (incomplete || busy) return
            setBusy(true)
            const failure =
              type === 'relation'
                ? await onAddRelation({
                    name,
                    targetDataSourceId: targetId,
                    ...(twoWay ? { twoWay: { name: inverseName } } : {}),
                    ...(limitOne ? { limit: 'one' as const } : {}),
                  })
                : await onAdd(name, type)
            setBusy(false)
            if (failure === null) close()
            else setError(failure)
          }}
          className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 text-left font-normal shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="속성 이름"
            aria-label="속성 이름"
            maxLength={200}
            className={FIELD}
          />
          <select
            value={type}
            onChange={(e) => void pickType(e.target.value as AddableType)}
            aria-label="속성 유형"
            className={FIELD}
          >
            {ADDABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_ICON[t]} {TYPE_LABEL[t]}
              </option>
            ))}
          </select>

          {isRelation && (
            <>
              <select
                value={targetId}
                onChange={(e) => setTarget(e.target.value)}
                disabled={databases === null || databases.length === 0}
                aria-label="연결할 데이터베이스"
                data-testid="db-relation-target"
                className={FIELD}
              >
                {databases === null && <option value="">불러오는 중…</option>}
                {databases !== null && databases.length === 0 && <option value="">연결할 데이터베이스가 없습니다</option>}
                {(databases ?? []).map((d) => (
                  <option key={d.dataSourceId} value={d.dataSourceId}>
                    {d.name}
                    {d.dataSourceId === dataSourceId ? ' (이 표)' : ''}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={twoWay}
                  onChange={(e) => setTwoWay(e.target.checked)}
                  data-testid="db-relation-twoway"
                />
                반대쪽에도 표시
              </label>
              {twoWay && (
                <input
                  value={inverseName}
                  onChange={(e) => setInverseName(e.target.value)}
                  placeholder="반대쪽 속성 이름"
                  aria-label="반대쪽 속성 이름"
                  data-testid="db-relation-inverse-name"
                  maxLength={200}
                  className={FIELD}
                />
              )}

              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={limitOne}
                  onChange={(e) => setLimitOne(e.target.checked)}
                  data-testid="db-relation-limit-one"
                />
                하나만 연결
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={busy || incomplete}
            className="self-end rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-900 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100"
          >
            {busy ? '추가하는 중…' : '추가'}
          </button>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
