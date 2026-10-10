/**
 * 물리 삭제 — `purged_at` + 30일이 지난 휴지통 묶음의 행을 지운다 (히스토리 · 활동 4b-2 · F-11-06)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 물리 삭제 · 상태 전이표의 마지막 행 · 정본 상수 `PURGED_HARD_DELETE_DAYS` ·
 *       §3.10 [보강] 공용 스케줄러(세 번째 소비자)
 *       11-history-notifications.md F-11-06 *"permanently deleted … retained for 30 days before they become inaccessible to all users"*
 *
 * 공용 스케줄러가 부른다(`trash_hard_delete` — 세션 없는 시스템 주체). 한 판에 `TRASH_HARD_DELETE_BATCH` 묶음:
 *
 *   · 묶음 — 자동 비우기(`trash-purge.ts`)와 같다. 루트를 `SKIP LOCKED` 로 잠그고 쥔 쪽이 있으면 건너뛴다. 묶음의 페이지가 **모두**
 *     `purged` 이고 `purged_at` 이 30일 지났을 때만 지운다
 *   · **다른 묶음의 자손이 남아 있으면 기다린다** — 따로 먼저 버린 하위 페이지(조상 경로에 묶음의 페이지가 있다) · 루트가 소스면 그
 *     소스 아래 다른 묶음의 행. 먼저 지우면 남은 페이지의 권한 스코프 ACL 이 사라져 아무도 휴지통에서 보지 못하고, 소스의 `page`
 *     확장이 CASCADE 로 사라져 남은 행이 돌아갈 자리를 잃는다. **후보를 고를 때 거른다**(`DELETABLE_ROOTS`) — 기다리는 묶음이 한
 *     판을 차지하면 뒤의 묶음이 영영 지워지지 않는다. 잠근 뒤 같은 질의를 그 루트 하나로 한 번 더 묻는다
 *   · 지우는 것 — 묶음의 페이지 · 각 페이지의 본문 블록(문서 범위 — 재귀는 페이지에서 멈춘다) · 루트가 소스면 그 소스. FK 가 없는
 *     다섯(`acl_entry` · `doc_update` · `doc_snapshot` · `page_version` · `reaction`)은 직접, 나머지는 CASCADE 가 지운다
 *   · 참조를 내린다 — 본문 이미지(`countFileReferences` — 본문 프로젝터와 같은 셈) · 파일 아이콘 · 버전(S5 — `versionFileReferences`).
 *     버전의 바이트는 트랜잭션 **바깥에서** 먼저 읽어 센다(버전 GC 와 같다 — `purged` 페이지의 버전은 더 생기지 않는다). 커밋한
 *     **뒤에** 바이트를 저장소에서 지운다 — 실패하면 고아로 남는다(저장소 고아 쓸기는 파일 GC 와 함께)
 */

import * as Y from 'yjs'

import { withTransaction } from '../db/tx.ts'
import { query } from '../db/pool.ts'
import { fileStorage } from '../file/storage.ts'
import { versionFileReferences } from '../history/record.ts'
import { countFileReferences } from './image.ts'
import { iconFileId, pageIconOfFormat } from './page-icon.ts'

/** 정본 상수 — 영구 삭제(`purged`) 뒤 물리 삭제까지(사용자 · API 에 보이지 않는 GC 지연). */
export const PURGED_HARD_DELETE_DAYS = 30
/** 한 판에 지우는 묶음 수 — 꽉 차면 스케줄러가 곧 다시 부른다. */
export const TRASH_HARD_DELETE_BATCH = 50

export type TrashHardDeleteResult = {
  /** 지운 묶음 수. */
  readonly units: number
  /** 루트를 다른 쪽이 쥐고 있었거나, 잠그고 보니 지울 수 없게 된 묶음 수 — 다음 판에 다시 본다. */
  readonly skipped: number
  /** 지운 페이지(행 · 템플릿 포함) 수. */
  readonly pages: number
  /** 지운 본문 블록 수. */
  readonly blocks: number
  /** 지운 data source 수. */
  readonly sources: number
  /** 지운 버전 수. */
  readonly versions: number
  /** 바이트가 없어 참조를 내리지 못하고 지운 버전 수. */
  readonly missingBytes: number
  /** 한 판이 꽉 찼다 — 더 남았을 수 있다. */
  readonly more: boolean
}

/**
 * 지울 수 있는 묶음의 루트 — 때가 됐고 기다리지 않는 것만, 오래된 것부터(머리말). `$1` 기준 시각(지금 − 30일) · `$2` 개수 ·
 * `$3` 워크스페이스(없으면 전부) · `$4` 그 루트 하나만(없으면 전부). 후보를 고를 때와 잠근 뒤 확인할 때 **같은 질의**를 쓴다 — 두 벌이면
 * 갈라진다.
 *
 * 기다리는 까닭 셋 — ⓐ 묶음에 아직 때가 되지 않은 페이지가 있다 ⓑ 다른 묶음의 자손이 남았다(조상 경로에 묶음의 페이지가 있는
 * 페이지) ⓒ 루트가 소스인데 그 소스 아래 다른 묶음의 행이 남았다. ⓑ 는 휴지통 · purged 에 있는 페이지의 조상 경로를 **한 번
 * 펼쳐 해시로 맞춘다** — 루트마다 상관 하위 질의(`EXISTS … ancestor_path @> ARRAY[m.id]`)로 물으면 플래너가 "곧 하나 찾는다"며
 * 순차 탐색을 고르고, 자손이 없는 흔한 경우에 블록 표 전체를 루트 수만큼 훑는다(개발 DB 30만 행 · 루트 1,200개에서 3분을 넘겼다).
 * 살아 있는 페이지는 묶음의 페이지 아래에 있을 수 없다 — 버릴 때 살아 있는 자손은 모두 그 묶음에 들고, 되살리면 B4 가 최상위로
 * 옮겨 조상 경로가 바뀐다. 그래서 휴지통 · purged 의 페이지만 펼친다.
 */
const DELETABLE_ROOTS = `
  WITH due AS (
    SELECT root, min(at) AS at
      FROM (
        SELECT b.trash_root_id AS root, b.purged_at AS at
          FROM block b
         WHERE b.lifecycle = 'purged' AND b.purged_at <= $1 AND b.trash_root_id IS NOT NULL
           AND ($3::uuid[] IS NULL OR b.workspace_id = ANY($3::uuid[]))
        UNION ALL
        SELECT ds.id, ds.purged_at
          FROM data_source ds JOIN block d ON d.id = ds.owner_database_id   -- 데이터베이스는 블록의 1:1 확장이다(X-2)
         WHERE ds.lifecycle = 'purged' AND ds.purged_at <= $1
           AND ($3::uuid[] IS NULL OR d.workspace_id = ANY($3::uuid[]))
      ) candidates
     WHERE $4::uuid IS NULL OR root = $4::uuid
     GROUP BY root
  ),
  members AS (
    SELECT m.id, m.trash_root_id AS root, m.lifecycle, m.purged_at FROM block m JOIN due ON due.root = m.trash_root_id
  ),
  held AS (
    SELECT o.trash_root_id AS unit, a.ancestor
      FROM block o CROSS JOIN LATERAL unnest(o.ancestor_path) AS a(ancestor)
     WHERE o.trash_root_id IS NOT NULL AND o.type = 'page'
       AND ($3::uuid[] IS NULL OR o.workspace_id = ANY($3::uuid[]))
  ),
  waiting AS (
    SELECT root FROM members WHERE NOT (lifecycle = 'purged' AND purged_at <= $1)
    UNION
    SELECT m.root FROM members m JOIN held h ON h.ancestor = m.id WHERE h.unit <> m.root
    UNION
    SELECT due.root FROM due JOIN block o ON o.parent_id = due.root AND o.parent_type = 'data_source'
     WHERE o.trash_root_id IS DISTINCT FROM due.root
  )
  SELECT root FROM due
   WHERE NOT EXISTS (SELECT 1 FROM waiting w WHERE w.root = due.root)
   ORDER BY at, root
   LIMIT $2`

type Swept =
  | 'skipped'
  | { readonly pages: number; readonly blocks: number; readonly sources: number; readonly stateRefs: readonly string[]; readonly missingBytes: number }

/**
 * @param options.batch 한 판에 지우는 묶음 수
 * @param options.workspaces 이 워크스페이스들만 — 검사가 다른 검사의 휴지통을 건드리지 않게(워커는 주지 않는다)
 */
export async function runTrashHardDelete(
  now: Date,
  options: { readonly batch?: number; readonly workspaces?: readonly string[] } = {},
): Promise<TrashHardDeleteResult> {
  const batch = options.batch ?? TRASH_HARD_DELETE_BATCH
  const cutoff = new Date(now.getTime() - PURGED_HARD_DELETE_DAYS * 86_400_000)
  // 지울 때가 된 묶음의 루트들 — 기다리는 묶음은 빼고, 오래된 것부터
  const roots = await query<{ root: string }>(DELETABLE_ROOTS, [cutoff, batch, options.workspaces ?? null, null])

  let units = 0
  let skipped = 0
  let pages = 0
  let blocks = 0
  let sources = 0
  let versions = 0
  let missingBytes = 0
  for (const { root } of roots) {
    // 버전이 담은 참조 — 바깥에서 먼저 읽어 센다. 바이트가 없으면 셀 수 없다(null)
    const held = await query<{ id: string; page_id: string; state_ref: string }>(
      `SELECT v.id, v.page_id, v.state_ref FROM page_version v JOIN block b ON b.id = v.page_id
        WHERE b.trash_root_id = $1 AND b.lifecycle = 'purged'`,
      [root],
    )
    const versionRefs = new Map<string, Map<string, number> | null>()
    for (const version of held) {
      const bytes = await fileStorage().read(version.state_ref)
      if (bytes === null) {
        versionRefs.set(version.id, null)
        continue
      }
      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, bytes)
      versionRefs.set(version.id, versionFileReferences(ydoc, version.page_id))
    }

    const swept = await withTransaction(async (tx): Promise<Swept> => {
      // 루트를 먼저 잠근다 — 소스면 소스 행, 아니면 루트 페이지 행. 쥔 쪽이 있으면 건너뛴다(머리말)
      const { isSource } = await tx.queryOne<{ isSource: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM data_source WHERE id = $1) AS "isSource"`,
        [root],
      )
      const source = isSource
        ? await tx.queryMaybe<{ due: boolean }>(
            `SELECT lifecycle = 'purged' AND purged_at <= $2 AS due FROM data_source WHERE id = $1 FOR UPDATE SKIP LOCKED`,
            [root, cutoff],
          )
        : null
      const locked = isSource
        ? source !== null
        : (await tx.queryMaybe<{ id: string }>(`SELECT id FROM block WHERE id = $1 FOR UPDATE SKIP LOCKED`, [root])) !== null
      if (!locked) return 'skipped'

      // 잠근 뒤 한 번 더 — 그사이 바뀌었으면 다음 판에(후보와 같은 질의를 이 루트 하나로)
      const still = await tx.queryMaybe<{ root: string }>(DELETABLE_ROOTS, [cutoff, 1, null, root])
      if (still === null || source?.due === false) return 'skipped'
      const members = await tx.query<{ id: string; workspace_id: string; format: unknown }>(
        `SELECT id, workspace_id, format FROM block WHERE trash_root_id = $1`,
        [root],
      )
      const ids = members.map((m) => m.id)

      // 본문 블록 — 재귀는 페이지에서 멈춘다(본문 프로젝터의 문서 범위와 같다 · `save-page-body.ts`)
      const content = await tx.query<{ id: string; properties: Record<string, unknown> | null }>(
        `WITH RECURSIVE scope AS (
             SELECT id, properties FROM block WHERE parent_id = ANY($1::uuid[]) AND type <> 'page'
           UNION ALL
             SELECT c.id, c.properties FROM block c JOIN scope s ON c.parent_id = s.id WHERE c.type <> 'page'
         )
         SELECT id, properties FROM scope`,
        [ids],
      )

      // 참조 — 본문 이미지 · 파일 아이콘(지금) · 버전(바깥에서 센 것)
      const references = countFileReferences(content)
      for (const member of members) {
        const fileId = iconFileId(pageIconOfFormat(member.format))
        if (fileId !== null) references.set(fileId, (references.get(fileId) ?? 0) + 1)
      }

      // FK 가 없는 다섯을 직접 지운다
      await tx.query(
        `DELETE FROM reaction
          WHERE (target_kind = 'discussion' AND target_id IN (SELECT id FROM discussion WHERE page_id = ANY($1::uuid[])))
             OR (target_kind = 'comment' AND target_id IN (
                   SELECT c.id FROM comment c JOIN discussion d ON d.id = c.discussion_id WHERE d.page_id = ANY($1::uuid[])))`,
        [ids],
      )
      await tx.query(`DELETE FROM acl_entry WHERE node_id = ANY($1::uuid[])`, [ids])
      await tx.query(`DELETE FROM doc_update WHERE page_id = ANY($1::uuid[])`, [ids])
      await tx.query(`DELETE FROM doc_snapshot WHERE page_id = ANY($1::uuid[])`, [ids])
      const gone = await tx.query<{ id: string; state_ref: string }>(
        `DELETE FROM page_version WHERE page_id = ANY($1::uuid[]) RETURNING id, state_ref`,
        [ids],
      )
      let missing = 0
      const stateRefs: string[] = []
      for (const version of gone) {
        const counted = versionRefs.get(version.id)
        // 바깥에서 세지 못했다(바이트가 없다) — 행은 지우고 센다(버전 GC 와 같다)
        if (counted === undefined || counted === null) {
          missing += 1
          continue
        }
        stateRefs.push(version.state_ref)
        for (const [fileId, count] of counted) references.set(fileId, (references.get(fileId) ?? 0) + count)
      }

      // 내린다 — 워크스페이스로 한정 · 바닥은 0(본문 프로젝터와 같다)
      const workspaceId = members[0]?.workspace_id
      if (workspaceId !== undefined) {
        for (const [fileId, count] of references) {
          await tx.query(`UPDATE file SET ref_count = GREATEST(ref_count - $3, 0) WHERE id = $1 AND workspace_id = $2`, [
            fileId,
            workspaceId,
            count,
          ])
        }
      }

      // 행 — 본문 블록 · 페이지 · 소스. 나머지는 CASCADE 가
      if (content.length > 0) await tx.query(`DELETE FROM block WHERE id = ANY($1::uuid[])`, [content.map((c) => c.id)])
      if (ids.length > 0) await tx.query(`DELETE FROM block WHERE id = ANY($1::uuid[])`, [ids])
      if (isSource) await tx.query(`DELETE FROM data_source WHERE id = $1`, [root])
      return { pages: ids.length, blocks: content.length, sources: isSource ? 1 : 0, stateRefs, missingBytes: missing }
    })

    if (swept === 'skipped') {
      skipped += 1
      continue
    }
    units += 1
    pages += swept.pages
    blocks += swept.blocks
    sources += swept.sources
    versions += swept.stateRefs.length + swept.missingBytes
    missingBytes += swept.missingBytes
    if (swept.missingBytes > 0) {
      console.warn(`[trash-hard-delete] 바이트가 없어 파일 참조를 내리지 못하고 지운 버전 ${swept.missingBytes}개 (묶음 ${root})`)
    }
    // 커밋한 뒤에 — 실패하면 고아로 남는다(머리말)
    for (const stateRef of swept.stateRefs) {
      await fileStorage()
        .remove(stateRef)
        .catch((e: unknown) => console.warn(`[trash-hard-delete] 바이트를 지우지 못했다(고아): ${stateRef} — ${String(e)}`))
    }
  }
  return { units, skipped, pages, blocks, sources, versions, missingBytes, more: roots.length === batch }
}
