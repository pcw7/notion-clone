/**
 * 수식 그래프 — 저장된 의존 간선을 읽어 순환 · 깊이를 본다 (DB 심화 2i-2조각 · F-03-12)
 *
 * 정본: 00-canonical-data-model.md §3.5 `property_dependency` · [보강] 수식 1단계
 *
 * 그래프를 바꾸는 명령이 셋이다 — 수식 만들기 · 식 고치기(`formula-property.ts`) · **지운 수식 되살리기**(`property.ts`). 셋이 같은 답을
 * 내야 하므로 읽기와 판정을 한 곳에 둔다(`property.ts` 가 `formula-property.ts` 를 부르면 서로를 부르는 고리가 된다).
 *
 * 그래프는 간선 표가 정본이다 — 지금 읽히지 않는 수식(지운 속성을 읽는다)도 간선은 남아 있다. 지운 수식은 그래프에 없다(잎이다).
 * 그래서 되살리기가 그래프를 바꾼다: 지운 동안 다른 수식이 이 수식을 거쳐 돌아오는 길을 만들 수 있다(B 가 지워진 사이 A → C → B,
 * 그 뒤 B → A 인 B 를 되살리면 고리).
 */

import type { Tx } from '../db/tx.ts'
import { checkFormulaGraph } from './formula-schema.ts'

/** 표의 수식 그래프 — 살아 있는 수식마다 저장된 의존. */
export async function readFormulaGraph(tx: Tx, dataSourceId: string): Promise<Map<string, string[]>> {
  const rows = await tx.query<{ id: string; source: string | null }>(
    `SELECT p.id, pd.source_property_id AS source
       FROM property p
       LEFT JOIN property_dependency pd ON pd.dependent_property_id = p.id
      WHERE p.data_source_id = $1 AND p.deleted_at IS NULL AND p.type = 'formula'`,
    [dataSourceId],
  )
  const graph = new Map<string, string[]>()
  for (const r of rows) {
    const deps = graph.get(r.id) ?? []
    if (r.source !== null) deps.push(r.source)
    graph.set(r.id, deps)
  }
  return graph
}

/**
 * 표의 수식 그래프를 본다 — `replace` 는 저장된 간선 대신 쓸 것(만들 수식 · 고칠 수식). 순환이면 `formula_cycle`, 깊이가 넘치면
 * `formula_too_deep`, 괜찮으면 null.
 */
export async function formulaGraphProblem(
  tx: Tx,
  dataSourceId: string,
  replace?: { readonly id: string; readonly dependsOn: readonly string[] },
): Promise<'formula_cycle' | 'formula_too_deep' | null> {
  const graph = await readFormulaGraph(tx, dataSourceId)
  if (replace !== undefined) graph.set(replace.id, [...replace.dependsOn])
  const result = checkFormulaGraph(graph)
  if (result.ok) return null
  return 'cycle' in result ? 'formula_cycle' : 'formula_too_deep'
}
