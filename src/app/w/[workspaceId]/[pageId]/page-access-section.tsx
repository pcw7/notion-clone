'use client'

/**
 * 데이터베이스 공유 패널의 "페이지 단위 접근" 절 (게시 · 공유 6f-2c · 6g-3b · F-06-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 행 단위 접근 규칙 ⑧⑨ · 06 F-06-10 *"DB Share 패널의 `Page-level access` 섹션"*
 *
 * 판정은 서버다(`permissions/access-rule.ts` · 판정은 `effective.ts` 의 `accessRuleEntries`) — 이 절은 규칙을 읽고 부르기만 한다.
 *
 *   · 이 데이터베이스가 **소유한** data source 마다 "만든 사람" 줄 하나, 그 아래 살아 있는 사람 속성마다 줄 하나("담당에 든 사람" · ⑨),
 *     각각 레벨(없음 · 읽기 · 댓글 · 편집 · 전체 권한). "없음" 은 지운다. 붙인 소스는 원본의 패널에서 정한다(규칙은 소유한 쪽의 것).
 *   · 원천 속성이 휴지통인 규칙은 "휴지통" 줄 — 레벨은 고르지 못하고(서버가 휴지통의 속성으로는 두지 않는다) 지우기만.
 *   · 관리할 수 있는 사람만 고른다 — 보는 사람에게는 지금 레벨만 말한다.
 */

import { useCallback, useEffect, useState } from 'react'

import {
  NO_RULE,
  PAGE_ACCESS_HINT,
  RULE_LEVEL_OPTIONS,
  TRASHED_RULE_HINT,
  pageAccessFailureMessage,
  personRuleRowLabel,
  ruleLevelLabel,
  ruleRowLabel,
} from './page-access-messages'

type Rule = {
  id: string
  dataSourceId: string
  source: string
  propertyId: string | null
  propertyName: string | null
  propertyTrashed: boolean
  level: string
}
type PeopleProperty = { dataSourceId: string; propertyId: string; name: string }
type Source = { id: string; name: string; owned: boolean }
type Loaded = { rules: Rule[]; people: PeopleProperty[]; sources: Source[] }

/** 규칙 하나를 가리키는 열쇠 — 서버의 원천마다 하나(만든 사람은 속성이 없다). */
type RuleKey = { dataSourceId: string; source: 'created_by' | 'person_property'; propertyId: string | null }

async function readJson(url: string): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url)
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return res.ok ? { ok: true, body } : { ok: false, error: pageAccessFailureMessage(body.error) }
  } catch {
    return { ok: false, error: '연결에 실패했습니다.' }
  }
}

const keyBody = (key: RuleKey) => ({
  dataSourceId: key.dataSourceId,
  source: key.source,
  ...(key.propertyId === null ? {} : { propertyId: key.propertyId }),
})

export function PageAccessSection({
  workspaceId,
  databaseId,
  canManage,
}: {
  workspaceId: string
  databaseId: string
  /** 공유를 바꿀 수 있는가(`manage_perm` — 공유 패널의 상태가 이미 안다). 아니면 레벨만 읽는다. */
  canManage: boolean
}) {
  const rulesUrl = `/api/workspaces/${workspaceId}/databases/${databaseId}/access-rules`
  const sourcesUrl = `/api/workspaces/${workspaceId}/databases/${databaseId}/data-sources`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const read = useCallback(async (): Promise<Loaded | string> => {
    const [rules, sources] = await Promise.all([readJson(rulesUrl), readJson(sourcesUrl)])
    if (!rules.ok) return rules.error
    if (!sources.ok) return sources.error
    return {
      rules: rules.body.rules as Rule[],
      people: (rules.body.peopleProperties as PeopleProperty[] | undefined) ?? [],
      sources: sources.body.dataSources as Source[],
    }
  }, [rulesUrl, sourcesUrl])

  // 상태는 응답이 온 뒤에만 바꾼다(효과 안의 동기 setState 는 렌더를 연쇄시킨다 — 공유 패널과 같은 규칙)
  useEffect(() => {
    let cancelled = false
    void read().then((got) => {
      if (cancelled) return
      if (typeof got === 'string') setError(got)
      else setLoaded(got)
    })
    return () => {
      cancelled = true
    }
  }, [read])

  const change = async (key: RuleKey, level: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(rulesUrl, {
        method: level === NO_RULE ? 'DELETE' : 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(level === NO_RULE ? keyBody(key) : { ...keyBody(key), level }),
      })
      if (!res.ok) setError(pageAccessFailureMessage(((await res.json().catch(() => ({}))) as { error?: unknown }).error))
    } catch {
      setError('연결에 실패했습니다.')
    }
    // 실패해도 다시 읽는다 — 서버가 갖고 있는 것을 보인다(오류는 지우지 않는다 · 공유 패널의 `load` 와 같다)
    const got = await read()
    if (typeof got !== 'string') setLoaded(got)
    setBusy(false)
  }

  const owned = loaded?.sources.filter((source) => source.owned) ?? []
  const levelOf = (key: RuleKey): string =>
    loaded?.rules.find((r) => r.dataSourceId === key.dataSourceId && r.source === key.source && r.propertyId === key.propertyId)?.level ??
    NO_RULE

  return (
    <section data-testid="page-access-section" className="mt-3 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
      <p className="mb-1 font-medium">페이지 단위 접근</p>
      <p className="mb-2 text-xs text-neutral-500">{PAGE_ACCESS_HINT}</p>
      {loaded === null && error === null && <p className="text-xs text-neutral-400">불러오는 중…</p>}
      {owned.length > 0 && (
        <ul className="flex flex-col gap-1">
          {owned.flatMap((source) => {
            const prefix = owned.length > 1 ? source.name : null
            const byCreator: RuleKey = { dataSourceId: source.id, source: 'created_by', propertyId: null }
            const people = loaded?.people.filter((p) => p.dataSourceId === source.id) ?? []
            const trashed = loaded?.rules.filter((r) => r.dataSourceId === source.id && r.source === 'person_property' && r.propertyTrashed) ?? []
            return [
              <RuleLine
                key={`${source.id}:created_by`}
                label={ruleRowLabel(prefix)}
                kind="created_by"
                level={levelOf(byCreator)}
                canManage={canManage}
                busy={busy}
                onChange={(level) => void change(byCreator, level)}
              />,
              ...people.map((p) => {
                const key: RuleKey = { dataSourceId: source.id, source: 'person_property', propertyId: p.propertyId }
                return (
                  <RuleLine
                    key={`${source.id}:${p.propertyId}`}
                    label={personRuleRowLabel(prefix, p.name)}
                    kind="person_property"
                    level={levelOf(key)}
                    canManage={canManage}
                    busy={busy}
                    onChange={(level) => void change(key, level)}
                  />
                )
              }),
              ...trashed.map((rule) => {
                const label = personRuleRowLabel(prefix, rule.propertyName ?? '지운 속성')
                return (
                  <li key={rule.id} data-testid="page-access-rule-trashed" className="flex items-center justify-between gap-2 text-neutral-400">
                    <span className="line-through">{label}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span>{TRASHED_RULE_HINT}</span>
                      {canManage && (
                        <button
                          type="button"
                          data-testid="page-access-remove"
                          aria-label={`${label} 규칙 지우기`}
                          disabled={busy}
                          onClick={() => void change({ dataSourceId: source.id, source: 'person_property', propertyId: rule.propertyId }, NO_RULE)}
                          className="rounded px-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        >
                          지우기
                        </button>
                      )}
                    </span>
                  </li>
                )
              }),
            ]
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}

/** 규칙 줄 하나 — 관리하는 사람에게는 레벨 고르개, 보는 사람에게는 레벨 이름. */
function RuleLine({
  label,
  kind,
  level,
  canManage,
  busy,
  onChange,
}: {
  label: string
  kind: RuleKey['source']
  level: string
  canManage: boolean
  busy: boolean
  onChange: (level: string) => void
}) {
  return (
    <li data-testid="page-access-rule" data-kind={kind} className="flex items-center justify-between gap-2">
      <span>{label}</span>
      {canManage ? (
        <select
          aria-label={`${label}에게 줄 권한`}
          data-testid="page-access-level"
          value={level}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
        >
          {RULE_LEVEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <span data-testid="page-access-level-text" className="text-xs text-neutral-500">
          {ruleLevelLabel(level)}
        </span>
      )}
    </li>
  )
}
