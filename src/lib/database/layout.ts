/**
 * 행의 레이아웃 — 속성 묶음의 숨김 · 순서 (잔여 묶음 8f-2 · F-16-03 · F-16-07) · 제목 아래 고정 (3a-1 · F-16-02) · 페이지 설정 (3b-1 · F-16-09 · F-16-10)
 *   · 본문 모듈 · 상세 패널 (3c-1 · F-16-04 · F-16-05)
 *
 * 정본: 00-canonical-data-model.md §3.6 `page_layout` · `layout_tab` · `layout_module` · [보강] 행의 레이아웃(① ~ ⑦) · [보강] 고정 속성
 *       16-item-layout.md F-16-01(편집 모드 · 한 번에 적용) · F-16-02(Heading · pinned ≤ 15) · F-16-03(Property group) · F-16-12(영속화)
 *
 * **레이아웃 표를 쓰는 곳은 이 파일 하나다.**
 *
 *   · 머리는 lazy 다 — 없으면 기본(모두 보임 · 스키마 순서 · version '0'). 처음 벗어날 때 한 벌을 만든다(`ensureLayout`)
 *   · 숨김 = content 탭의 property 행 · `visible=false` · 그룹이 부모 · 순서 없음. **다시 보이면 행을 지운다** — 기본으로 돌아간 것은
 *     행이 없다(sparse). 그룹은 속성을 열거하지 않는다(M6) — 행이 없는 속성(새로 만든 것 포함)은 보인다
 *   · 순서 = `property.order_idx` — 적용이 스키마 순서를 다시 쓴다(`planOrder` — 옮긴 것만 · `schema_version` 도 오른다)
 *   · 고정 = content 탭의 property 행 · heading 영역 · 부모는 heading · **자기 순서**(heading 안의 순서는 스키마 순서가 아니다) · 보임.
 *     풀면 행을 지운다(속성 묶음으로 돌아간다). 소스마다 15개까지(M3 — `MAX_PINNED_PROPERTIES` · 0064 의 트리거가 마지막 그물). 한 속성은
 *     한 탭에 한 번이라 숨김과 겹치지 않는다. 속성을 지우면 고정이 풀린다(0064 의 트리거 — 되살려도 속성 묶음으로 돌아온다)
 *   · 페이지 설정 = 머리의 다섯 칸(백링크 · 인라인 코멘트 · 토론 · 속성 아이콘 · 전체 폭 — `page-settings.ts`). 머리가 없으면 기본값이고,
 *     기본에서 벗어나면 머리가 생긴다(다른 이탈과 같다). 준 칸만 바꾼다
 *   · 본문 모듈 = 부모 없는 property 행 · area `main` · 자기 순서 — 속성 묶음(그룹 모듈)과 한 줄에서 순서를 다툰다. 상세 패널 = area
 *     `panel` 의 같은 행(관계형은 못 놓는다 — M4 · `layout-modules.ts` · 0065). 내리면 행을 지운다(속성 묶음으로)
 *   · **한 속성은 한 자리다**(숨김 · 고정 · 본문 모듈 · 패널) — 적용이 받은 목록끼리 겹치면 거부하고, 받지 않은 목록은 지금 것에서 받은
 *     목록이 가져간 속성을 뺀다. 쓰기는 지우기를 모두 넣기보다 먼저 한다(`layout_module_prop_once`)
 *   · 저장은 전체 교체 한 번이다 — 편집 모드의 초안을 "모든 행에 적용"이 한꺼번에 보낸다. version 이 낙관적 잠금이고, 바뀐 것이
 *     없으면 아무것도 쓰지 않는다(version 도 그대로)
 *   · 누가 — 구조의 문(`lockSchema` — 주인 데이터베이스의 `edit_structure` · 데이터베이스 잠금 · 소스가 살아 있다)
 *
 * 숨김은 표시 규칙이다(16 R12) — 값 · 검색 · 필터 · API 는 그대로다. 행 페이지도 숨긴 속성을 펼쳐 채울 수 있다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, type Tx } from '../db/tx.ts'
import { firstOrderKey, orderKeysBetween } from '../block/order-key.ts'
import { planOrder } from './layout-order.ts'
import { bumpSchema, isSchemaFailure, lockSchema } from './property.ts'
import { MAX_PINNED_PROPERTIES } from './limits.ts'
import { canPlaceInPanel, GROUP_MODULE } from './layout-modules.ts'
import {
  DEFAULT_PAGE_SETTINGS,
  samePageSettings,
  type BacklinksMode,
  type InlineCommentMode,
  type PageSettings,
} from './page-settings.ts'

export type RecordLayout = {
  /** 낙관적 잠금 — 머리가 없으면 `'0'`. bigint 라 문자열이다. */
  readonly version: string
  /** 페이지 설정(3b-1) — 머리가 없으면 기본값. */
  readonly settings: PageSettings
  /** 숨긴 속성 — 살아 있는 것만 · 스키마 순서. */
  readonly hidden: readonly string[]
  /** 제목 아래에 고정한 속성(3a-1) — 살아 있는 것만 · heading 안의 순서. */
  readonly pinned: readonly string[]
  /** 본문 영역의 줄(3c-1) — 속성 id 와 속성 묶음(`GROUP_MODULE`) · 위에서 아래로. 머리가 없으면 속성 묶음 하나. */
  readonly main: readonly string[]
  /** 상세 패널의 속성(3c-1) — 위에서 아래로. */
  readonly panel: readonly string[]
}

const DEFAULT_LAYOUT: RecordLayout = {
  version: '0',
  settings: DEFAULT_PAGE_SETTINGS,
  hidden: [],
  pinned: [],
  main: [GROUP_MODULE],
  panel: [],
}


export type LayoutFailure =
  | 'not_found'
  /** 볼 수는 있지만 구조를 고칠 수 없다(`edit_structure`). */
  | 'forbidden'
  /** 데이터베이스가 잠겼다(7f-2) — 레이아웃은 구조다. */
  | 'locked'
  /** 다른 사람이 먼저 적용했다 — 다시 읽고 다시 해야 한다(부분 병합 없음). `currentVersion` 이 함께 간다. */
  | 'layout_conflict'
  /** 제목을 숨기거나 고정하려 했다(제목은 행 페이지의 제목 칸이다) · 같은 속성을 숨기면서 고정했다. */
  | 'invalid_layout'
  /** 고정이 15개를 넘는다(M3). */
  | 'too_many_pinned'
  /** 상세 패널에 놓을 수 없는 유형이다(관계형 — M4). */
  | 'panel_type'

export type LayoutResult =
  | { readonly ok: true; readonly value: { readonly layout: RecordLayout; readonly changed: boolean } }
  | { readonly ok: false; readonly reason: LayoutFailure; readonly currentVersion?: string }

const fail = (reason: LayoutFailure, currentVersion?: string): LayoutResult =>
  currentVersion === undefined ? { ok: false, reason } : { ok: false, reason, currentVersion }

/**
 * 이 소스의 레이아웃. 권한은 묻지 않는다 — 부르는 쪽(행 페이지 · 적용)이 이미 물었다.
 *
 * 숨김은 content 탭의 property 행 중 `visible=false` 인 것이다. 지금은 그 행들이 모두 그룹 바로 아래이지만, 섹션(F-16-03 의 v2)이
 * 들어와도 "숨겼는가"의 질문은 같다 — 부모를 묻지 않는다. soft delete 된 속성의 행은 남되 여기서는 빠진다(되살리면 숨김도 돌아온다).
 */
export async function readRecordLayout(tx: Tx, dataSourceId: string): Promise<RecordLayout> {
  const head = await tx.queryMaybe<{
    version: string
    backlinks_mode: BacklinksMode
    inline_comment_mode: InlineCommentMode
    show_discussions: boolean
    show_property_icons: boolean
    full_width: boolean
  }>(
    `SELECT version::text AS version, backlinks_mode, inline_comment_mode, show_discussions, show_property_icons, full_width
       FROM page_layout WHERE data_source_id = $1`,
    [dataSourceId],
  )
  if (head === null) return DEFAULT_LAYOUT
  const settings: PageSettings = {
    backlinks: head.backlinks_mode,
    inlineComments: head.inline_comment_mode,
    showDiscussions: head.show_discussions,
    showPropertyIcons: head.show_property_icons,
    fullWidth: head.full_width,
  }
  const pinned = await tx.query<{ property_id: string }>(
    `SELECT m.property_id
       FROM layout_module m
       JOIN layout_tab t ON t.id = m.tab_id AND t.kind = 'content'
       JOIN property p ON p.id = m.property_id AND p.deleted_at IS NULL
      WHERE m.data_source_id = $1 AND m.kind = 'property' AND m.area = 'heading'
      ORDER BY m.order_idx, m.id`,
    [dataSourceId],
  )
  const rows = await tx.query<{ property_id: string }>(
    `SELECT m.property_id
       FROM layout_module m
       JOIN layout_tab t ON t.id = m.tab_id AND t.kind = 'content'
       JOIN property p ON p.id = m.property_id AND p.deleted_at IS NULL
      WHERE m.data_source_id = $1 AND m.kind = 'property' AND m.visible = false
      ORDER BY p.order_idx, p.id`,
    [dataSourceId],
  )
  // 본문 줄 · 패널(3c-1) — 부모 없는 모듈. 지운 속성의 모듈은 빠진다(되살리면 돌아온다 — 숨김과 같다).
  const modules = await tx.query<{ kind: string; area: string; property_id: string | null }>(
    `SELECT m.kind, m.area, m.property_id
       FROM layout_module m
       JOIN layout_tab t ON t.id = m.tab_id AND t.kind = 'content'
       LEFT JOIN property p ON p.id = m.property_id
      WHERE m.data_source_id = $1 AND m.parent_module_id IS NULL AND m.area IN ('main', 'panel')
        AND (m.kind = 'property_group' OR (m.kind = 'property' AND p.deleted_at IS NULL))
      ORDER BY m.order_idx, m.id`,
    [dataSourceId],
  )
  const keyOf = (m: { kind: string; property_id: string | null }) => (m.kind === 'property_group' ? GROUP_MODULE : m.property_id!)
  return {
    version: head.version,
    settings,
    hidden: rows.map((r) => r.property_id),
    pinned: pinned.map((r) => r.property_id),
    main: modules.filter((m) => m.area === 'main').map(keyOf),
    panel: modules.filter((m) => m.area === 'panel').map(keyOf),
  }
}

/**
 * 편집 모드의 초안을 한 번에 적용한다(16 F-16-01 *"Apply to all pages"*).
 *
 * @param input.expectedVersion 초안을 시작할 때 읽은 버전(머리가 없었으면 `'0'`).
 * @param input.order 속성 묶음의 속성들 — 원하는 순서. 일부여도 된다(받지 않은 속성은 제자리 · `planOrder`).
 * @param input.hidden 숨길 속성 — 여기 없는 속성은 보인다. 그사이 지워진 속성은 건너뛴다.
 * @param input.pinned 제목 아래에 고정할 속성 — 원하는 순서(3a-1). 주지 않으면 그대로다(단 숨기는 속성은 고정이 풀린다). 그사이 지워진
 *   속성은 건너뛴다. 15개를 넘으면 `too_many_pinned` · 제목이나 숨기는 속성이 있으면 `invalid_layout`.
 * @param input.settings 페이지 설정 — 준 칸만 바꾼다(3b-1). 검사는 부르는 쪽이 했다(`parsePageSettings`).
 * @param input.main 본문 영역의 줄 — 속성 id 와 속성 묶음(`GROUP_MODULE`, 꼭 하나)의 순서(3c-1). 주지 않으면 그대로다.
 * @param input.panel 상세 패널의 속성 — 순서(3c-1). 주지 않으면 그대로다. 관계형이 있으면 `panel_type`.
 */
export async function applyRecordLayout(
  ctx: SessionContext,
  dataSourceId: string,
  input: {
    readonly expectedVersion: string
    readonly order: readonly string[]
    readonly hidden: readonly string[]
    readonly pinned?: readonly string[]
    readonly settings?: Partial<PageSettings>
    readonly main?: readonly string[]
    readonly panel?: readonly string[]
  },
): Promise<LayoutResult> {
  return withCommandTransaction(async (tx) => {
    // 구조의 문 — 소스 행을 FOR UPDATE 로 잠근다. 같은 소스의 적용 둘이 여기서 줄을 서므로 버전을 읽고 쓰는 사이에 끼어들 수 없다.
    const ds = await lockSchema(tx, ctx, dataSourceId)
    if (isSchemaFailure(ds)) {
      return fail(!ds.ok && (ds.reason === 'forbidden' || ds.reason === 'locked') ? ds.reason : 'not_found')
    }

    const current = await readRecordLayout(tx, dataSourceId)
    if (current.version !== input.expectedVersion) return fail('layout_conflict', current.version)

    const properties = await tx.query<{ id: string; type: string; order_idx: string }>(
      `SELECT id, type::text AS type, order_idx FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL
        ORDER BY order_idx, id`,
      [dataSourceId],
    )
    const live = new Map(properties.map((p) => [p.id, p]))
    const liveOf = (ids: readonly string[]) => [...new Set(ids)].filter((id) => live.has(id))

    // 자리 — 한 속성은 한 자리다(머리말). 받은 목록끼리 겹치거나 제목이 끼면 거부한다. 그사이 지워진 속성은 건너뛴다.
    const hidden = liveOf(input.hidden)
    const pinnedInput = input.pinned === undefined ? null : liveOf(input.pinned)
    const mainInput = input.main === undefined ? null : [...new Set(input.main)].filter((id) => id === GROUP_MODULE || live.has(id))
    const panelInput = input.panel === undefined ? null : liveOf(input.panel)
    if (mainInput !== null && !mainInput.includes(GROUP_MODULE)) return fail('invalid_layout')
    const claimed = new Set<string>()
    for (const list of [hidden, pinnedInput, mainInput, panelInput]) {
      for (const id of list ?? []) {
        if (id === GROUP_MODULE) continue
        if (live.get(id)?.type === 'title' || claimed.has(id)) return fail('invalid_layout')
        claimed.add(id)
      }
    }
    if (pinnedInput !== null && pinnedInput.length > MAX_PINNED_PROPERTIES) return fail('too_many_pinned')
    if (panelInput !== null && panelInput.some((id) => !canPlaceInPanel(live.get(id)!.type))) return fail('panel_type')
    // 받지 않은 목록 — 지금 것에서 다른 목록이 가져간 속성을 뺀다
    const others = (own: readonly string[] | null) => new Set([...claimed].filter((id) => !(own ?? []).includes(id)))
    const takenFromPinned = others(pinnedInput)
    const takenFromMain = others(mainInput)
    const takenFromPanel = others(panelInput)
    const pinned = pinnedInput ?? current.pinned.filter((id) => !takenFromPinned.has(id))
    const main = mainInput ?? current.main.filter((id) => id === GROUP_MODULE || !takenFromMain.has(id))
    const panel = panelInput ?? current.panel.filter((id) => !takenFromPanel.has(id))
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])
    const pinChanged = !same(pinned, current.pinned)
    const mainChanged = !same(main, current.main)
    const panelChanged = !same(panel, current.panel)

    const settings: PageSettings = { ...current.settings, ...input.settings }
    const settingsChanged = !samePageSettings(settings, current.settings)
    const wanted = new Set(hidden)
    const now = new Set(current.hidden)
    const hide = [...wanted].filter((id) => !now.has(id))
    const show = [...now].filter((id) => !wanted.has(id))
    const moves = planOrder(
      properties.map((p) => ({ id: p.id, key: p.order_idx })),
      input.order,
    )
    if (
      hide.length === 0 && show.length === 0 && moves.length === 0 &&
      !pinChanged && !mainChanged && !panelChanged && !settingsChanged
    ) {
      return { ok: true, value: { layout: current, changed: false } } as const
    }

    const { created, tabId, headingId, groupId } = await ensureLayout(tx, dataSourceId, ctx.userId)

    // ── 지우기 — 넣기보다 먼저(한 속성은 한 탭에 한 번이다 — 자리를 옮기는 속성의 옛 행이 먼저 빠져야 한다) ──
    // 고정 · 본문 모듈 · 패널은 바뀌면 통째로 다시 쓴다 — 열 몇 개의 순서라 옮긴 것만 고르는 수고가 값어치가 없다.
    if (pinChanged) {
      await tx.query(`DELETE FROM layout_module WHERE tab_id = $1 AND kind = 'property' AND area = 'heading'`, [tabId])
    }
    // 영역마다 따로 — 바뀐 영역의 지금 보이는 모듈만 지운다. 지운 속성의 모듈은 남아 되살리면 돌아온다(숨김과 같다). 한 영역만
    // 바뀌었는데 둘을 다 지우면 다른 영역이 사라진다(⑩ 의 검사가 잡았다).
    const removeModules = async (area: 'main' | 'panel', ids: readonly string[]) => {
      await tx.query(
        `DELETE FROM layout_module
          WHERE tab_id = $1 AND kind = 'property' AND parent_module_id IS NULL AND area = $2 AND property_id = ANY($3::text[])`,
        [tabId, area, ids.filter((id) => id !== GROUP_MODULE)],
      )
    }
    if (mainChanged) await removeModules('main', current.main)
    if (panelChanged) await removeModules('panel', current.panel)
    if (show.length > 0) {
      await tx.query(
        `DELETE FROM layout_module
          WHERE tab_id = $1 AND kind = 'property' AND NOT visible AND property_id = ANY($2::text[])`,
        [tabId, show],
      )
    }

    // ── 넣기 ──
    if (hide.length > 0) {
      await tx.query(
        `INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, parent_module_id, property_id, visible)
         SELECT x.id, g.data_source_id, g.tab_id, 'property', g.area, g.id, x.property_id, false
           FROM unnest($2::uuid[], $3::text[]) AS x(id, property_id), layout_module g
          WHERE g.id = $1`,
        [groupId, hide.map(() => randomUUID()), hide],
      )
    }
    if (pinChanged && pinned.length > 0) {
      const keys = orderKeysBetween(null, null, pinned.length)
      await tx.query(
        `INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, parent_module_id, property_id, visible, order_idx)
         SELECT x.id, h.data_source_id, h.tab_id, 'property', 'heading', h.id, x.property_id, true, x.key
           FROM unnest($2::uuid[], $3::text[], $4::text[]) AS x(id, property_id, key), layout_module h
          WHERE h.id = $1`,
        [headingId, pinned.map(() => randomUUID()), pinned, keys],
      )
    }
    if (mainChanged) {
      // 본문 줄 — 속성 묶음도 이 줄의 한 자리다(순서 키를 새로 받는다)
      const keys = orderKeysBetween(null, null, main.length)
      await tx.query(`UPDATE layout_module SET order_idx = $2 WHERE id = $1`, [groupId, keys[main.indexOf(GROUP_MODULE)]])
      const modules = main.flatMap((id, i) => (id === GROUP_MODULE ? [] : [{ id, key: keys[i]! }]))
      await insertModules(tx, tabId, dataSourceId, 'main', modules)
    }
    if (panelChanged) {
      const keys = orderKeysBetween(null, null, panel.length)
      await insertModules(tx, tabId, dataSourceId, 'panel', panel.map((id, i) => ({ id, key: keys[i]! })))
    }
    if (moves.length > 0) {
      await tx.query(
        `UPDATE property p SET order_idx = x.key, updated_at = now()
           FROM unnest($2::text[], $3::text[]) AS x(id, key)
          WHERE p.id = x.id AND p.data_source_id = $1`,
        [dataSourceId, moves.map((m) => m.id), moves.map((m) => m.key)],
      )
      // 스키마 순서를 고쳤다 — 스키마를 들고 있는 화면의 낙관적 잠금이 이것을 알아야 한다.
      await bumpSchema(tx, dataSourceId)
    }
    if (settingsChanged) {
      await tx.query(
        `UPDATE page_layout
            SET backlinks_mode = $2, inline_comment_mode = $3, show_discussions = $4, show_property_icons = $5, full_width = $6
          WHERE data_source_id = $1`,
        [dataSourceId, settings.backlinks, settings.inlineComments, settings.showDiscussions, settings.showPropertyIcons, settings.fullWidth],
      )
    }
    // 방금 만든 머리는 이미 첫 버전(1)이다.
    if (!created) {
      await tx.query(
        `UPDATE page_layout SET version = version + 1, updated_at = now(), updated_by = $2 WHERE data_source_id = $1`,
        [dataSourceId, ctx.userId],
      )
    }
    return { ok: true, value: { layout: await readRecordLayout(tx, dataSourceId), changed: true } } as const
  })
}

/** 부모 없는 property 모듈(본문 · 패널)을 넣는다 — 보임 · 자기 순서(0065 ①). */
async function insertModules(
  tx: Tx,
  tabId: string,
  dataSourceId: string,
  area: 'main' | 'panel',
  modules: readonly { readonly id: string; readonly key: string }[],
): Promise<void> {
  if (modules.length === 0) return
  await tx.query(
    `INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, parent_module_id, property_id, visible, order_idx)
     SELECT x.id, $2, $1, 'property', $3, NULL, x.property_id, true, x.key
       FROM unnest($4::uuid[], $5::text[], $6::text[]) AS x(id, property_id, key)`,
    [tabId, dataSourceId, area, modules.map(() => randomUUID()), modules.map((m) => m.id), modules.map((m) => m.key)],
  )
}

/**
 * 머리 · content 탭 · heading · 그룹을 한 벌로 만든다 — 이미 있으면 그것을 준다(정본 [보강] ②). T1 · M1 · M2 의 "적어도 1개"를
 * 지키는 곳이 여기 하나다("1개 이하"는 부분 UNIQUE). 소스 행이 잠긴 뒤에 부른다(`applyRecordLayout`) — 둘이 동시에 만들 수 없다.
 */
async function ensureLayout(
  tx: Tx,
  dataSourceId: string,
  userId: string,
): Promise<{ readonly created: boolean; readonly tabId: string; readonly headingId: string; readonly groupId: string }> {
  const found = await tx.queryMaybe<{ tab_id: string; heading_id: string; group_id: string }>(
    `SELECT t.id AS tab_id, h.id AS heading_id, g.id AS group_id
       FROM layout_tab t
       JOIN layout_module h ON h.tab_id = t.id AND h.kind = 'heading'
       JOIN layout_module g ON g.tab_id = t.id AND g.kind = 'property_group'
      WHERE t.data_source_id = $1 AND t.kind = 'content'`,
    [dataSourceId],
  )
  if (found !== null) return { created: false, tabId: found.tab_id, headingId: found.heading_id, groupId: found.group_id }

  const tabId = randomUUID()
  const headingId = randomUUID()
  const groupId = randomUUID()
  const first = firstOrderKey()
  await tx.query(`INSERT INTO page_layout (data_source_id, updated_by) VALUES ($1, $2)`, [dataSourceId, userId])
  await tx.query(`INSERT INTO layout_tab (id, data_source_id, kind, order_idx) VALUES ($1, $2, 'content', $3)`, [
    tabId,
    dataSourceId,
    first,
  ])
  // heading 은 heading 영역 · 그룹은 본문 영역의 첫 자리(영역마다 순서가 따로다).
  await tx.query(
    `INSERT INTO layout_module (id, data_source_id, tab_id, kind, area, order_idx)
     VALUES ($1, $3, $4, 'heading', 'heading', $5), ($2, $3, $4, 'property_group', 'main', $5)`,
    [headingId, groupId, dataSourceId, tabId, first],
  )
  return { created: true, tabId, headingId, groupId }
}
