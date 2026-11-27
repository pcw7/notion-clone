/**
 * 동기화 블록 사본의 중첩 묶기 — 원본 페이지 A 의 Y.Doc 안에서 원본 X 의 자식 그룹에 편집기를 묶는다 (SB-2 · SB-3 · F-01-11 · 정본 [보강 SB-0] ① ⑧ ⑨ ⑮ · ㉮)
 *
 * DOM 이 없다 — 단위 검사(`synced-copy-binding.test.ts`)가 헤드리스로 돌린다. 화면은 `synced-copy-view-impl.ts`(지연 로드)이고, 이 모듈은
 * 첫 번들에 있어 노드 뷰가 그 구현에 넘긴다(`synced-block-view.ts` `CopyBinding` — 지연 청크가 ProseMirror · Yjs 를 값으로 가져오지 않게).
 *
 *   · 스키마(⑧ⓕ) — `blockSchema` 의 노드 · 마크 **타입 그대로**이고 최상위만 `blockGroup` 인 파사드다. y-prosemirror 는 묶은 Y 타입의 자식들을
 *     최상위 노드의 내용으로 열고(`type.toArray()`) 쓸 때도 그 타입 아래만 고친다(`updateYFragment`) — X 의 그룹(`Y.XmlElement`,
 *     `Y.XmlFragment` 의 하위 클래스)의 자식은 `blockContainer` 들이라 `blockGroup` 이 최상위면 모양이 맞는다. 이름도 같아야 한다
 *     (`updateYFragment` 는 Y 요소의 이름과 최상위 노드의 이름이 다르면 던진다). 따로 지은 `Schema` 면 편집 규칙의 타입 견주기가 어긋난다(SB-2 의
 *     이음매). 변환에는 관대한 파사드를 넘긴다(`collab-schema.ts`).
 *   · 읽기 전용(SB-2) — 바인딩의 편집기 → Y.Doc 쓰기 길은 플러그인 뷰의 `update` 하나다. 읽기 전용 묶기는 그 길을 **떼어 낸다**
 *     (첫 그리기 · Y 관찰은 남는다) — 같은 페이지의 사본은 B 의 연결로 나가는 문서에 묶이므로 보내지 않기만으로는 모자라다. 로컬
 *     트랜잭션도 거른다(화면이 Y.Doc 과 어긋나지 않게). **B 가 읽기 전용이면 화면이 이 묶기를 고른다**(SY7 · ⑧ [SB-3 고침]).
 *   · 고칠 수 있는 묶기(SB-3 · ⑧ⓔ) — 쓰기를 **이 사본의 origin** 으로 한다(플러그인 상태의 `doc.transact` 하나를 바꾼 파사드 — 바인딩의 안쪽
 *     쓰기는 그 트랜잭션에 합류한다). 되돌리기는 이 사본의 `Y.UndoManager`(범위 = X 의 그룹 · 추적 = 그 origin 만)라 바깥 편집기(바인딩의
 *     origin `ySyncPluginKey`) · 다른 사본의 편집을 되돌리지 않고, 바깥의 되돌리기도 이 사본의 편집을 되돌리지 않는다.
 *   · 다시 묶기(⑮) — 원본을 페이지 안에서 끌면 y-prosemirror 가 지우고 다시 넣어 Y 요소가 바뀐다 · 잘라냄 · 되돌리기도. 묶은 그룹이
 *     지워지면 X 를 id 로 다시 찾는다(`watchSyncedGroup`). 못 찾으면 null 을 알리고 관찰을 이어 간다(⑨ — 같은 id 로 돌아오면 다시 묶는다).
 */

import type * as Y from 'yjs'
import type { Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, type PluginSpec } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { SYNCED_BLOCK_TYPE, isSyncedCopyProps } from '../block/synced-block.ts'
// y-prosemirror 는 협업 편집기 모듈을 거쳐 받는다 — 가져오는 모듈이 늘면 첫 번들의 합치기가 풀린다(`collab-editor.ts`)
import { ySyncPlugin, ySyncPluginKey, yUndoPlugin } from '../collab/collab-editor.ts'
import { tolerantSchema } from '../collab/collab-schema.ts'
import { BODY_FRAGMENT } from '../collab/ydoc.ts'
import { isBlockSelection } from './block-selection.ts'
import { copyDrawingPlugins, copyEditingPlugins, cursorPlugins, editorKeyHandler, type EditorDeps } from './create-editor.ts'
import type { EditorKeymapDeps } from './keymap.ts'
import { blockSchema } from './schema.ts'

let schemas: { readonly copy: Schema; readonly collab: Schema } | null = null

/**
 * 사본의 중첩 편집기 스키마 — 최상위가 X 의 자식 그룹이다(머리말). 노드 · 마크 타입은 `blockSchema` 의 것이다(파사드 — 캐시 · 파서도 같다).
 * `collab` 은 바인딩이 변환에 쓰는 것(던지면 Y 요소를 지우는 변환을 막는다 · `collab-schema.ts`).
 */
export function copySchemas(): { readonly copy: Schema; readonly collab: Schema } {
  if (schemas === null) {
    const copy = Object.create(blockSchema, { topNodeType: { value: blockSchema.nodes.blockGroup } }) as Schema
    schemas = { copy, collab: tolerantSchema(copy) }
  }
  return schemas
}

const CONTAINER = 'blockContainer'
const GROUP = 'blockGroup'

/**
 * Y 요소인가 — 글자(`Y.XmlText` — `nodeName` 이 없다) · 훅이 아니다. yjs 를 값으로 가져오지 않으려고 모양으로 가린다(가져오는 모듈이 늘면
 * 첫 번들의 합치기가 풀린다 — `collab-editor.ts`).
 */
const isElement = (value: unknown): value is Y.XmlElement =>
  typeof (value as { nodeName?: unknown } | null)?.nodeName === 'string' && typeof (value as { getAttribute?: unknown }).getAttribute === 'function'

/** 이 컨테이너가 원본 X 인가 — 첫 자식이 사본이 아닌 동기화 블록이고 둘째가 그룹이다. 그 그룹을 돌려준다. */
function originalGroupOf(container: Y.XmlElement): Y.XmlElement | null {
  const head = container.get(0)
  const group = container.get(1)
  if (!isElement(head) || head.nodeName !== SYNCED_BLOCK_TYPE || isSyncedCopyProps(head.getAttribute('props'))) return null
  return isElement(group) && group.nodeName === GROUP ? group : null
}

/** 원본 X 의 자식 그룹 — 본문 전체에서 id 로 찾는다. 없거나(지웠다 · 잘라냈다) 원본이 아니면 null. */
export function findSyncedGroup(ydoc: Y.Doc, originalId: string): Y.XmlElement | null {
  const walk = (parent: Y.XmlFragment): Y.XmlElement | null => {
    for (const child of parent.toArray()) {
      if (!isElement(child)) continue
      if (child.nodeName === CONTAINER && child.getAttribute('blockId') === originalId) {
        const group = originalGroupOf(child)
        if (group !== null) return group
      }
      // 글자(Y.XmlText)는 건너뛴다 — 블록은 요소 안에만 있다
      const found = walk(child)
      if (found !== null) return found
    }
    return null
  }
  return walk(ydoc.getXmlFragment(BODY_FRAGMENT))
}

/** 묶은 그룹이 아직 문서에 있는가 — 그 자신이나 조상이 지워졌으면 아니다. */
function attached(type: { readonly _item: Y.Item | null }): boolean {
  for (let item = type._item; item !== null; item = (item.parent as unknown as { readonly _item: Y.Item | null })._item) {
    if (item.deleted) return false
  }
  return true
}

/**
 * X 의 그룹을 지켜본다 — 처음 하나를 곧바로 알리고, 그 뒤로는 묶은 그룹이 문서에서 떨어지거나(끌기 · 잘라냄 · 지움) 없던 X 가 생기면
 * 알린다. 트랜잭션마다 묶은 그룹이 붙어 있는지만 본다(조상 몇 개) — 못 찾는 동안에만 본문을 훑는다. 해제 함수를 돌려준다.
 */
export function watchSyncedGroup(ydoc: Y.Doc, originalId: string, onChange: (group: Y.XmlElement | null) => void): () => void {
  let current = findSyncedGroup(ydoc, originalId)
  onChange(current)
  const check = (): void => {
    if (current !== null && attached(current)) return
    const next = findSyncedGroup(ydoc, originalId)
    if (next === current) return
    current = next
    onChange(current)
  }
  ydoc.on('afterTransaction', check)
  return () => ydoc.off('afterTransaction', check)
}

/**
 * 읽기 전용 동기 플러그인 — `ySyncPlugin` 과 같은 키 · 상태이고 플러그인 뷰의 `update`(편집기 → Y.Doc 쓰기)만 뗐다(머리말). 첫 그리기
 * (`_forceRerender`)와 Y 관찰(`_typeChanged`)은 바인딩이 그대로 한다.
 */
export function readOnlySyncPlugin(group: Y.XmlFragment): Plugin {
  const full = ySyncPlugin(group) as Plugin
  const spec = full.spec as PluginSpec<unknown>
  return new Plugin({
    ...spec,
    view: (view) => {
      const inner = spec.view!(view)
      return { destroy: () => inner.destroy?.() }
    },
  })
}

/**
 * 고칠 수 있는 동기 플러그인(SB-3 · ⑧ⓔ) — 쓰기를 `origin` 의 Y 트랜잭션으로 한다. 플러그인 뷰의 쓰기는 상태의 `doc.transact(…, ySyncPluginKey)`
 * 한 곳이고(y-prosemirror 1.3.7), 바인딩의 안쪽 쓰기(`_prosemirrorChanged` · `updateYFragment`)는 그 트랜잭션에 합류한다 — 그 하나만 바꾼
 * 파사드를 상태에 둔다. 관찰(`_typeChanged`)은 바인딩의 잠금(mux) 안에서 그대로 끝난다(바깥에서 트랜잭션을 감싸면 잠금 밖에서 관찰이 돌아
 * 자기 편집을 다시 그린다).
 */
function copySyncPlugin(group: Y.XmlFragment, origin: object): Plugin {
  const full = ySyncPlugin(group) as Plugin
  const spec = full.spec as PluginSpec<Record<string, unknown>>
  const doc = group.doc!
  const writer = Object.create(doc, { transact: { value: <T>(f: (tr: Y.Transaction) => T) => doc.transact(f, origin) } }) as Y.Doc
  const state = spec.state!
  return new Plugin({ ...spec, state: { ...state, init: (config, instance) => ({ ...state.init(config, instance), doc: writer }) } })
}

/** 사본의 되돌리기(⑧ⓔ) — 범위는 묶은 그룹(`yUndoPlugin` 이 동기 상태의 타입으로 짓는다) · 추적은 이 사본의 origin 만. */
function copyUndoPlugin(origin: object): Plugin {
  const full = yUndoPlugin({ trackedOrigins: [origin] }) as Plugin
  const spec = full.spec as PluginSpec<{ undoManager: Y.UndoManager }>
  const state = spec.state!
  return new Plugin({
    ...spec,
    state: {
      ...state,
      init: (config, instance) => {
        const value = state.init(config, instance)
        // `yUndoPlugin` 은 바인딩의 origin 을 늘 더한다 — 그것은 바깥 편집기(같은 페이지면 원본을 바깥에서 고친 것)다
        value.undoManager.trackedOrigins.delete(ySyncPluginKey)
        return value
      },
    },
  })
}

/** 바인딩이 Y.Doc 에서 옮긴 트랜잭션인가 — 관찰(`_typeChanged`)은 키 표지를, 첫 그리기(`_forceRerender`)는 기록 끄기 표지만 단다. */
export function isBindingTransaction(tr: { getMeta(key: unknown): unknown }): boolean {
  return tr.getMeta(ySyncPluginKey) !== undefined || tr.getMeta('addToHistory') === false
}

/** 로컬 편집을 거른다 — 읽기 전용 사본의 화면이 Y.Doc 과 어긋나지 않게. 선택은 막지 않는다(글을 골라 복사할 수 있다). */
export function readOnlyGuardPlugin(): Plugin {
  return new Plugin({ filterTransaction: (tr) => !tr.docChanged || isBindingTransaction(tr) })
}

/**
 * 사본의 중첩 편집기 상태 — X 의 그룹에 묶는다. 읽기 전용이면 쓰기 길을 뗀 바인딩 + 로컬 편집 거르기(SB-2), 고칠 수 있으면 이 사본의
 * origin 으로 쓰는 바인딩 + 그 origin 만 되돌리는 기록(SB-3). `deps` 가 있으면 그리기 플러그인(읽기 전용) · 편집 플러그인(고칠 수 있을 때 —
 * `create-editor.ts` `copyEditingPlugins`)을 단다 — 없으면 묶기만(검사).
 *
 * 상태에 `doc` 을 넘기지 않는다 — 넘기면 `state.schema` 가 파사드가 아니게 된다(`collab-schema.ts` "쓰는 법").
 */
export function createCopyEditorState(
  group: Y.XmlElement,
  options: { readonly readOnly: boolean; readonly deps?: EditorDeps; readonly plugins?: readonly Plugin[] },
): EditorState {
  const { deps } = options
  const extra = options.plugins ?? []
  const schema = copySchemas().collab
  if (options.readOnly) {
    return EditorState.create({ schema, plugins: [readOnlySyncPlugin(group), readOnlyGuardPlugin(), ...(deps ? copyDrawingPlugins(deps) : []), ...extra] })
  }
  // 편집기마다 하나 — 같은 X 의 사본 둘이 서로의 편집을 되돌리지 않는다
  const origin = {}
  return EditorState.create({
    schema,
    plugins: [copySyncPlugin(group, origin), ...(deps ? copyEditingPlugins(deps) : []), copyUndoPlugin(origin), ...(deps ? cursorPlugins() : []), ...extra],
  })
}

/**
 * 고칠 수 있는 사본의 키(⑧ⓖ) — 바깥 편집기와 같은 키맵이되 바깥의 창을 여는 키(블록 메뉴 · 링크 · AI · 수식 입력창)는 없다. 사본 안의 블록
 * 선택에서 Esc 는 바깥으로 나간다(`leave` — 바깥 편집기에서 사본 블록을 고른다). 글자 선택의 Esc 는 키맵대로 블록 선택이 된다.
 */
export function copyKeyHandler(deps: EditorKeymapDeps, leave: () => void): (view: EditorView, event: KeyboardEvent) => boolean {
  const keys = editorKeyHandler({
    ...deps,
    openBlockMenu: undefined,
    promptLink: undefined,
    openAi: undefined,
    openAiEdit: undefined,
    openEquation: undefined,
    openInlineEquation: undefined,
  })
  return (view, event) => {
    if (event.key === 'Escape' && !event.isComposing && isBlockSelection(view.state.selection)) {
      leave()
      return true
    }
    return keys(view, event)
  }
}
