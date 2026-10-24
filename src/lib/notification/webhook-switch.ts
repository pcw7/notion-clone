/**
 * 워크스페이스의 웹훅 스위치 — 소유자가 바깥으로 보내는 웹훅을 전부 끈다 (§7 정리 10n-70 · F-08-13 · F-11-19)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ⑩ · DB automation ⑫ · HANDOFF §3.2-303
 *
 * 08 F-08-13 *"Enterprise 소유자는 Settings > Connections 에서 전면 비활성화 가능"*. 설정 `workspace.allow_webhooks`(`setting_value` 의 한 줄 —
 * 행이 없으면 켜짐)이 거짓이면 이 워크스페이스에서 바깥으로 나가는 웹훅이 **모두** 선다 — 페이지 웹훅(4e)과 자동화 · 버튼의 `send_webhook`(5c).
 *
 *   ① **새로 걸 수 없다** — 페이지 웹훅 걸기(`webhooks_disabled`) · `send_webhook` 이 든 액션 저장(같은 까닭).
 *   ② **걸린 것도 보내지 않는다** — 쌓지 않고(페이지 웹훅의 묶음 · 자동화의 배달), 이미 쌓인 것은 보낼 때 버린다(`webhooks_disabled`).
 *      다시 켜도 꺼진 동안의 활동을 몰아 보내지 않는다(멈춘 웹훅과 같은 규칙 — 정본 페이지 웹훅 ⑦).
 *   ③ 걸린 웹훅 · 액션 정의는 그대로 둔다 — 다시 켜면 그 뒤의 활동부터 다시 보낸다. 멈추기 · 지우기는 꺼져 있어도 된다.
 *
 * 판정은 읽을 때마다 DB 에 묻는다(캐시하지 않는다) — 끈 순간부터 막혀야 하는 안전 스위치다.
 */

import type { Tx } from '../db/tx.ts'

/** 설정 키 — 레지스트리(`settings/registry.ts`)와 저장(`settings/settings.ts`)이 같은 이름을 쓴다. */
export const WEBHOOKS_SETTING_KEY = 'workspace.allow_webhooks'

/**
 * 꺼져 있으면 참인 SQL 식 — `workspaceExpr` 은 워크스페이스 id 를 가리키는 식(`w.workspace_id` 처럼). 쌓는 쿼리가 같은 문장 안에서 거른다.
 * 행이 없거나 참이면 켜짐이다(기본값 — 정본 [보강] 설정 값 표 ②).
 */
export function webhooksOffSql(workspaceExpr: string): string {
  return `EXISTS (SELECT 1 FROM setting_value sv WHERE sv.scope = 'workspace' AND sv.workspace_id = ${workspaceExpr}
            AND sv.key = '${WEBHOOKS_SETTING_KEY}' AND sv.value = 'false'::jsonb)`
}

type Runner = Pick<Tx, 'query'>

/** 이 워크스페이스에서 웹훅이 나가도 되는가 — 트랜잭션 안이면 그 `tx`, 아니면 풀(`query`)을 넘긴다. */
export async function webhooksAllowedIn(run: Runner, workspaceId: string): Promise<boolean> {
  const rows = await run.query<{ off: boolean }>(`SELECT ${webhooksOffSql('$1::uuid')} AS off`, [workspaceId])
  return rows[0]?.off !== true
}
