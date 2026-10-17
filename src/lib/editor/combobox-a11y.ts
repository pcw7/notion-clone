/**
 * 편집기 위의 목록 메뉴를 화면 읽기 프로그램에 잇는다 — 슬래시 · 멘션 · 이모지 (플랫폼 잔여 10d-3 · F-12-13)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 편집기 메뉴의 접근성
 *       12-platform-ux.md F-12-13 *"슬래시 메뉴/멘션 팝업은 role="listbox" + aria-activedescendant + aria-expanded 로 조합 위젯 패턴을
 *       따라야 하며, 포커스를 입력에서 빼앗으면 안 된다"*
 *
 * 메뉴가 열려도 포커스는 편집기에 남는다(키는 편집기가 받는다). 그래서 **편집기 루트**가 목록과 지금 항목을 가리켜야 화면 읽기 프로그램이
 * ↑↓ 로 바뀌는 항목을 읽는다. 루트의 role 은 `textbox`(여러 줄)라 ARIA 1.2 가 그것에 허락하는 셋을 단다 — `aria-autocomplete="list"` ·
 * `aria-controls`(목록) · `aria-activedescendant`(지금 항목). `aria-expanded` 는 textbox 의 속성이 아니라 달지 않는다.
 *
 * 루트의 속성은 ProseMirror 가 쥔다(직접 달면 다시 그리며 지운다 — `collapse-plugin.ts` 머리말과 같은 까닭). 플러그인의 `attributes` 로
 * 단다 — 무엇을 가리킬지는 화면이 메타 트랜잭션으로 알린다(지금 항목의 번호는 화면의 상태다).
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

/** 메뉴 하나의 지금 모양 — 열렸는가 · 지금 항목 · 항목 수. */
export type MenuShape = { readonly open: boolean; readonly index: number; readonly count: number }

/** 편집기 루트가 가리킬 것 — 목록의 id · 지금 항목의 id(항목이 없으면 null). */
export type ComboboxTarget = { readonly listboxId: string; readonly activeId: string | null }

/** 메뉴의 목록 · 항목 id — 화면이 같은 이름을 단다. */
export const MENU_IDS = {
  slash: { listbox: 'blk-slash-menu', option: (i: number) => `blk-slash-option-${i}` },
  mention: { listbox: 'blk-mention-menu', option: (i: number) => `blk-mention-option-${i}` },
  emoji: { listbox: 'blk-emoji-menu', option: (i: number) => `blk-emoji-option-${i}` },
} as const

/**
 * 열린 메뉴가 가리킬 것 — 하나만 열린다(여는 쪽이 다른 메뉴를 닫는다). 그래도 둘이면 슬래시 · 멘션 · 이모지 차례. 지금 항목은 항목 수 안으로
 * 접는다(목록이 줄어든 순간). 항목이 없으면 목록만 가리킨다.
 */
export function comboboxTarget(menus: { readonly slash: MenuShape; readonly mention: MenuShape; readonly emoji: MenuShape }): ComboboxTarget | null {
  for (const key of ['slash', 'mention', 'emoji'] as const) {
    const menu = menus[key]
    if (!menu.open) continue
    const ids = MENU_IDS[key]
    const active = menu.count === 0 ? null : ids.option(Math.min(Math.max(menu.index, 0), menu.count - 1))
    return { listboxId: ids.listbox, activeId: active }
  }
  return null
}

/** 편집기 루트의 속성 — 열렸으면 셋(항목이 없으면 둘), 닫혔으면 없다. */
export function comboboxAttributes(target: ComboboxTarget | null): Record<string, string> {
  if (target === null) return {}
  return {
    'aria-autocomplete': 'list',
    'aria-controls': target.listboxId,
    ...(target.activeId === null ? {} : { 'aria-activedescendant': target.activeId }),
  }
}

export const comboboxKey = new PluginKey<ComboboxTarget | null>('comboboxA11y')

export function comboboxPlugin(): Plugin<ComboboxTarget | null> {
  return new Plugin<ComboboxTarget | null>({
    key: comboboxKey,
    state: {
      init: () => null,
      apply: (tr, prev) => {
        const meta = tr.getMeta(comboboxKey) as ComboboxTarget | null | undefined
        return meta === undefined ? prev : meta
      },
    },
    props: {
      attributes: (state) => comboboxAttributes(comboboxKey.getState(state) ?? null),
    },
  })
}

export function comboboxStateOf(state: EditorState): ComboboxTarget | null {
  return comboboxKey.getState(state) ?? null
}

/** 화면이 알린다 — 같은 값이면 부르는 쪽이 보내지 않는다(`sameTarget`). */
export function setComboboxTarget(tr: Transaction, target: ComboboxTarget | null): Transaction {
  return tr.setMeta(comboboxKey, target)
}

export function sameTarget(a: ComboboxTarget | null, b: ComboboxTarget | null): boolean {
  if (a === null || b === null) return a === b
  return a.listboxId === b.listboxId && a.activeId === b.activeId
}
