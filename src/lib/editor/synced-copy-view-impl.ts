/**
 * 동기화 블록 사본의 내용 · 다른 페이지 줄 — 지연 로드 (SB-2 · SB-3 · F-01-11 · 정본 [보강 SB-0] ⑦ ⑧ ⑨ ⑮ · ㉑ · SY7 · SY8)
 *
 * ⚠ 브라우저에서만 · 동기화 블록이 화면에 들 때 처음 불린다(`synced-block-view.ts`). 동기화 블록이 없는 페이지의 첫 번들에 싣지 않는다.
 *
 *   ① 해석(⑨) — `GET …/synced-blocks/{X}`. `missing` 은 두 번(1초 · 3초) 다시 묻고서야 그린다(방금 만든 원본의 행이 늦다)
 *   ② 붙기(⑧) — 같은 페이지면 이 편집기의 문서에, 다른 페이지면 원본 페이지마다 하나인 embed 연결(`synced-copy-pool.ts`)에. 첫 동기화 전에는
 *      "불러오는 중" 이다(빈 문서에서 X 를 못 찾았다고 "삭제됨" 을 그리지 않는다)
 *   ③ 묶기 — X 의 그룹에 중첩 편집기(`synced-copy-binding.ts`). **고칠 수 있는지는 SY7**(`synced-copy-edit.ts` — A 쪽은 서버가 정한 연결의 모드 ·
 *      B 쪽은 이 편집기의 편집 가능 · 제안 모드). 쓰기 길이 있는 묶기 ↔ 없는 묶기가 바뀌면 다시 만든다(B 가 읽기 전용이면 쓰지도 보내지도
 *      않는다) · 끊김처럼 잠깐이면 입력만 막는다. 그룹이 바뀌면(끌기 · 되돌리기) 다시 묶고, 못 찾으면 "삭제됨" 을 그리되 지켜본다(⑨ · ⑮)
 *   ④ 자리 넷(⑦) — 불러오는 중 · 권한 없음(+ 접근 요청 — X 로 보낸다 · 화면은 A 를 모른다) · 휴지통 · 삭제됨(+ "사본 지우기" — 이 페이지를
 *      고칠 수 있을 때). 연결이 닫히면(권한을 잃었다 — 5c) 다시 해석해 자리로 바꾼다
 *   ⑤ 다른 페이지 줄(㉑ · SB-3) — `GET …/synced-blocks/{X}/places`. 이 페이지를 뺀 곳이 있으면 "다른 N개 페이지에서 편집 중" · 누르면 목록 ·
 *      항목은 그 페이지의 그 블록으로 간다
 *
 * 중첩 편집기의 블록은 `data-block-id` 를 달지 않는다(`data-copy-block-id`) — 바깥 편집기의 손잡이 · 오버레이가 DOM 에서 블록을 찾을 때
 * 사본 안의 블록을 이 페이지의 블록으로 잘못 잡지 않게(같은 페이지의 사본이면 같은 id 가 바깥에도 있다).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import type * as Y from 'yjs'

import type { CollabSnapshot } from '../collab/collab-connection.ts'
import type { EditorDeps } from './create-editor.ts'
import type { NodeViewDeps } from './node-views.ts'
import type { CopyBinding, CopyNodeViews, MountedSyncedCopy, MountedSyncedPlaces, SyncedCopyHost } from './synced-block-view.ts'
import { copyEditState, type CopyEditState } from './synced-copy-edit.ts'
import { createEmbedPool, type EmbedLease, type EmbedPool } from './synced-copy-pool.ts'

type Resolution = { readonly state: 'ok'; readonly pageId: string } | { readonly state: 'no_access' | 'trashed' | 'missing' }
/** `elsewhere` — 맥락이 없는 편집기(미리보기 · 버전 보기)라 붙지 않는다. */
type CopyState = 'loading' | 'ok' | 'no_access' | 'trashed' | 'missing' | 'elsewhere'

/** `missing` 을 다시 묻는 간격(⑨). */
const MISSING_RETRY_MS = [1000, 3000]

/** 워크스페이스마다 하나 — 원본 페이지마다 연결 하나(⑧). */
const pools = new Map<string, EmbedPool>()

function poolFor(host: SyncedCopyHost): EmbedPool {
  const key = `${host.collabUrl}|${host.workspaceId}`
  let pool = pools.get(key)
  if (pool === undefined) {
    // 연결은 편집기가 연다(`openCollabConnection({ embed: true })` — 이 청크가 연결 모듈을 가져오지 않는다)
    pool = createEmbedPool({ open: (pageId, onChange) => host.openEmbed(pageId, onChange) })
    pools.set(key, pool)
  }
  return pool
}

async function resolveCopy(workspaceId: string, originalId: string): Promise<Resolution | null> {
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}/synced-blocks/${originalId}`, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as Resolution) : null
  } catch {
    return null
  }
}

/** 중첩 편집기의 컨테이너 — `data-block-id` 대신 `data-copy-block-id`(머리말). */
function copyContainerView(node: PmNode): NodeView {
  const dom = document.createElement('div')
  dom.className = 'blk-container'
  dom.dataset.copyBlockId = String(node.attrs.blockId ?? '')
  return { dom, contentDOM: dom }
}

/** 수식 입력창은 바깥 편집기의 것이다 — 사본에서는 열지 않는다(키도 없다 · `copyKeyHandler`). */
const nothing = (): void => undefined

/**
 * 사본의 deps(⑧ⓕ) — 바깥 편집기의 것에서 바깥의 창(블록 메뉴 · 링크 · AI · 수식 입력창)과 presence · 경로 · 사본 맥락을 뺀다. 그 창은 바깥
 * 편집기의 선택 · 좌표에 매였다. 사본 안에 동기화 블록은 없다(SY5) — 생겨도(수선 전) 붙지 않는다.
 */
function copyDeps(outer: EditorDeps, redraw: () => void): EditorDeps {
  return {
    ...outer,
    openBlockMenu: undefined,
    promptLink: undefined,
    openAi: undefined,
    openAiEdit: undefined,
    aiHint: undefined,
    openEquation: nothing,
    openInlineEquation: nothing,
    onLocalPresence: undefined,
    breadcrumbTrail: undefined,
    syncedCopyHost: undefined,
    // 토글 접힘 — 바깥과 같은 기억(블록 id)이고 중첩 편집기를 다시 그린다
    toggleCollapsed: (id) => {
      outer.toggleCollapsed(id)
      redraw()
    },
  }
}

const PLACE_TEXT: Readonly<Record<Exclude<CopyState, 'ok'>, string>> = {
  loading: '동기화된 내용을 불러오는 중…',
  no_access: '원본을 볼 권한이 없습니다.',
  trashed: '원본 페이지가 휴지통에 있습니다.',
  missing: '원본이 삭제되었습니다.',
  elsewhere: '동기화 블록의 사본입니다 — 내용은 페이지에서 볼 수 있습니다.',
}

export function mountSyncedCopy(
  body: HTMLElement,
  args: {
    readonly originalId: string | null
    readonly outer: EditorView
    /** 노드 뷰가 만들어질 때의 맥락 — 없으면 붙지 않는다(`elsewhere`). */
    readonly host: SyncedCopyHost | null
    /** 중첩 편집기의 노드 뷰(바깥 편집기와 같은 것 · 사본의 deps 로). */
    readonly nodeViews: (deps: NodeViewDeps) => CopyNodeViews
    /** "사본 지우기" — 이 사본의 블록을 지운다(되돌릴 수 있다). */
    readonly removeCopy: () => void
    /** 사본 안의 블록 선택에서 Esc — 바깥 편집기에서 이 사본 블록을 고른다(⑧ⓖ). */
    readonly leave: () => void
  },
): MountedSyncedCopy {
  const { originalId, outer, host, nodeViews, removeCopy, leave } = args
  // 묶기 · 편집기 클래스는 협업 편집기가 준 것이다 — 이 청크는 ProseMirror · Yjs 를 값으로 가져오지 않는다(`synced-block-view.ts` `CopyBinding`).
  // 맥락이 없으면(미리보기) 붙지 않으므로 쓰이지 않는다
  const binding: CopyBinding | null = host?.binding ?? null

  const place = body.querySelector<HTMLElement>('.blk-synced-place') ?? body.appendChild(document.createElement('div'))
  place.className = 'blk-synced-place'
  const nestedMount = document.createElement('div')
  nestedMount.className = 'blk-synced-copy-body'
  body.append(nestedMount)

  let visible = false
  let destroyed = false
  /** 해석 · 붙기의 차례 — 다시 해석하면 옛 콜백을 버린다. */
  let generation = 0
  let resolving = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let lease: EmbedLease | null = null
  let watchedDoc: Y.Doc | null = null
  let stopWatch: (() => void) | null = null
  let nested: EditorView | null = null
  let nestedGroup: Y.XmlElement | null = null
  /** 지금 묶은 그룹 — 편집 조건이 바뀌면 이것으로 다시 묶는다. */
  let currentGroup: Y.XmlElement | null = null
  /** 지금 묶기가 쓰는가(`read_only` 가 아니다) · 지금 입력을 받는가. */
  let nestedWrites = false
  let nestedEditable = false
  /** 붙은 곳 — 같은 페이지 · embed 연결의 마지막 스냅숏(SY7 의 A 쪽). */
  let attachment: 'same' | CollabSnapshot | null = null

  // ── 자리 ──────────────────────────────────────────────────────────

  const button = (text: string, onClick: (self: HTMLButtonElement) => void): HTMLButtonElement => {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = text
    el.addEventListener('mousedown', (event) => event.preventDefault())
    el.addEventListener('click', () => onClick(el))
    return el
  }

  const requestAccess = async (self: HTMLButtonElement): Promise<void> => {
    if (host === null || originalId === null) return
    self.disabled = true
    try {
      const res = await fetch(`/api/workspaces/${host.workspaceId}/synced-blocks/${originalId}/access-requests`, { method: 'POST' })
      if (res.status === 409) {
        // 그 사이 볼 수 있게 됐다 — 다시 해석한다
        restart()
        return
      }
      self.replaceWith(document.createTextNode(res.ok ? '요청을 보냈습니다.' : '요청하지 못했습니다.'))
    } catch {
      self.replaceWith(document.createTextNode('요청하지 못했습니다.'))
    }
  }

  const render = (state: CopyState): void => {
    body.dataset.copyState = state
    if (state === 'ok') {
      place.replaceChildren()
      return
    }
    const text = document.createElement('span')
    text.textContent = PLACE_TEXT[state]
    const parts: Node[] = [text]
    if (state === 'no_access' && host !== null && originalId !== null) parts.push(button('접근 요청', (self) => void requestAccess(self)))
    if (state === 'missing' && host?.editable() === true && outer.editable) parts.push(button('사본 지우기', removeCopy))
    place.replaceChildren(...parts)
  }

  // ── 묶기 ──────────────────────────────────────────────────────────

  /** SY7 — 지금 이 사본을 고칠 수 있는가(`synced-copy-edit.ts`). */
  const editState = (): CopyEditState =>
    host === null ? 'read_only' : copyEditState({ outerEditable: host.editable(), outerSuggesting: host.suggesting(), attachment })

  const teardownNested = (): void => {
    nested?.destroy()
    nested = null
    nestedGroup = null
    nestedMount.replaceChildren()
    delete body.dataset.copyEditable
  }

  const bindNested = (group: Y.XmlElement): void => {
    currentGroup = group
    const outerDeps = host?.editorDeps() ?? null
    if (binding === null || outerDeps === null) return
    const state = editState()
    const writes = state !== 'read_only'
    const editable = state === 'editable'
    if (nested !== null && nestedGroup === group && nestedWrites === writes) {
      // 같은 묶기 — 입력만 열고 닫는다(잠깐 끊김 · 다시 붙음에 기록 · 캐럿을 잃지 않게)
      if (nestedEditable !== editable) {
        nestedEditable = editable
        nested.setProps({ editable: () => editable })
        body.dataset.copyEditable = String(editable)
      }
      return
    }
    teardownNested()
    const deps = copyDeps(outerDeps, () => {
      if (nested !== null && !nested.isDestroyed) nested.dispatch(nested.state.tr)
    })
    nested = new binding.EditorView(nestedMount, {
      // 쓰기 길이 없는 묶기는 B 가 읽기 전용인 동안 아무것도 쓰지 않는다 — 보낼 것도 없다(SY7 · ⑧ [SB-3 고침])
      state: binding.createCopyEditorState(group, { readOnly: !writes, deps }),
      editable: () => editable,
      ...(writes ? { handleKeyDown: binding.copyKeyHandler(deps, leave) } : {}),
      nodeViews: { ...nodeViews(deps), blockContainer: (node) => copyContainerView(node) },
      attributes: {
        class: 'blk-editor blk-synced-nested',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': writes ? '동기화된 내용' : '동기화된 내용(읽기 전용)',
        'aria-readonly': String(!writes),
      },
    })
    nestedGroup = group
    nestedWrites = writes
    nestedEditable = editable
    body.dataset.copyEditable = String(editable)
    render('ok')
  }

  /** 편집 조건이 바뀌었을 수 있다 — 묶은 그룹이 있으면 다시 본다. */
  const refresh = (): void => {
    if (!destroyed && currentGroup !== null && nested !== null) bindNested(currentGroup)
  }
  const unsubscribe = host?.subscribe(refresh) ?? null

  const unwatch = (): void => {
    stopWatch?.()
    stopWatch = null
    watchedDoc = null
    currentGroup = null
  }

  const watch = (doc: Y.Doc): void => {
    if (watchedDoc === doc || originalId === null || binding === null) return
    unwatch()
    watchedDoc = doc
    // 묶은 그룹이 떨어지면 다시 찾는다 · 못 찾으면 "삭제됨" 을 그리고 지켜본다(같은 id 로 돌아오면 다시 묶는다)
    stopWatch = binding.watchSyncedGroup(doc, originalId, (group) => {
      if (group !== null) bindNested(group)
      else {
        currentGroup = null
        teardownNested()
        render('missing')
      }
    })
  }

  const onSnapshot = (snapshot: CollabSnapshot | null, mine: number): void => {
    if (destroyed || mine !== generation) return
    attachment = snapshot
    if (snapshot === null) {
      // 상한으로 끊겼다 — 다시 보이면 새로 연다
      unwatch()
      teardownNested()
      render('loading')
      return
    }
    if (snapshot.closed !== null) {
      // 권한을 잃었다(5c — `not_found`) · 로그인이 풀렸다 — 연결을 놓고 다시 해석해 자리로 바꾼다
      restart()
      return
    }
    if (!snapshot.synced) {
      render('loading')
      return
    }
    watch(snapshot.doc)
    // 같은 문서의 스냅숏(모드 · 끊김 · 다시 붙음) — 편집 조건만 다시 본다
    refresh()
  }

  // ── 해석 ──────────────────────────────────────────────────────────

  const release = (): void => {
    lease?.release()
    lease = null
    attachment = null
    unwatch()
    teardownNested()
  }

  const apply = (resolution: Resolution, mine: number): void => {
    if (resolution.state !== 'ok') {
      render(resolution.state)
      return
    }
    if (host === null) return
    if (resolution.pageId === host.pageId) {
      // 같은 페이지의 사본 — 새 연결 없이 이 편집기의 문서에(⑧ · 편집기가 문서를 바꾸면 노드 뷰째 다시 만들어진다)
      attachment = 'same'
      if (host.doc === null) render('loading')
      else watch(host.doc)
      return
    }
    lease = poolFor(host).acquire(resolution.pageId, (snapshot) => onSnapshot(snapshot, mine))
    lease.setVisible(visible)
  }

  const start = async (): Promise<void> => {
    if (originalId === null) {
      render('missing')
      return
    }
    if (host === null) {
      render('elsewhere')
      return
    }
    if (resolving) return
    resolving = true
    const mine = ++generation
    render('loading')
    try {
      for (let attempt = 0; ; attempt += 1) {
        const resolution = await resolveCopy(host.workspaceId, originalId)
        if (destroyed || mine !== generation) return
        // 못 물었다(연결 · 서버) — "불러오는 중" 으로 두고 다시 보일 때 다시 묻는다
        if (resolution === null) return
        if (resolution.state === 'missing' && attempt < MISSING_RETRY_MS.length) {
          await new Promise<void>((resolve) => (retryTimer = setTimeout(resolve, MISSING_RETRY_MS[attempt])))
          retryTimer = null
          if (destroyed || mine !== generation) return
          continue
        }
        apply(resolution, mine)
        return
      }
    } finally {
      if (mine === generation) resolving = false
    }
  }

  /** 처음부터 다시 — 연결을 놓고 다시 해석한다. */
  const restart = (): void => {
    generation += 1
    resolving = false
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    release()
    void start()
  }

  let started = false
  return {
    setVisible(now) {
      visible = now
      lease?.setVisible(now)
      if (!now) return
      // 처음 보였다 · 못 물었던 해석을 다시 — 붙어 있거나 자리를 그렸으면 그대로
      if (!started || (body.dataset.copyState === 'loading' && lease === null && watchedDoc === null && !resolving)) {
        started = true
        void start()
      }
    },
    // 사본의 내용(중첩 편집기의 키 · 선택 · 끌기 · 되돌리기) · 자리의 단추는 바깥 편집기가 받지 않는다(⑧ⓖ)
    stopEvent: (event) => event.target instanceof Node && body.contains(event.target),
    destroy() {
      destroyed = true
      generation += 1
      if (retryTimer !== null) clearTimeout(retryTimer)
      unsubscribe?.()
      release()
    },
  }
}

// ── 다른 페이지 줄 (㉑ · SB-3) ──────────────────────────────────────────

type Place = { readonly pageId: string; readonly title: string; readonly blockId: string; readonly original: boolean }

async function loadPlaces(workspaceId: string, originalId: string): Promise<Place[] | null> {
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}/synced-blocks/${originalId}/places`, { cache: 'no-store' })
    return res.ok ? (((await res.json()) as { places?: Place[] }).places ?? []) : null
  } catch {
    return null
  }
}

/**
 * "다른 N개 페이지에서 편집 중"(㉑) — 이 페이지를 뺀 곳(원본 · 사본의 페이지 · 볼 수 있는 것만 — 서버가 거른다)이 있으면 단추를 세운다. 누르면
 * 다시 묻고 목록을 펼친다. 항목은 그 페이지의 그 블록으로 간다(`#블록` — 편집기가 그 블록을 보인다).
 */
export function mountSyncedPlaces(
  el: HTMLElement,
  args: { readonly workspaceId: string; readonly pageId: string; readonly originalId: string; readonly navigate: (href: string) => void },
): MountedSyncedPlaces {
  const { workspaceId, pageId, originalId, navigate } = args
  let destroyed = false
  let others: Place[] = []
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'blk-synced-places-toggle'
  toggle.hidden = true
  toggle.setAttribute('aria-haspopup', 'menu')
  toggle.setAttribute('aria-expanded', 'false')
  const list = document.createElement('div')
  list.className = 'blk-synced-places-list'
  list.setAttribute('role', 'menu')
  list.hidden = true
  el.replaceChildren(toggle, list)

  const apply = (places: Place[]): void => {
    // 페이지마다 한 줄 — 이 페이지는 뺀다(같은 페이지의 다른 사본은 여기서 보인다)
    others = places.filter((place, i) => place.pageId !== pageId && places.findIndex((p) => p.pageId === place.pageId) === i)
    toggle.hidden = others.length === 0
    toggle.textContent = `다른 ${others.length}개 페이지에서 편집 중`
  }

  const close = (): void => {
    list.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onAway, true)
    document.removeEventListener('keydown', onKey, true)
  }
  const onAway = (event: Event): void => {
    if (!(event.target instanceof Node) || !el.contains(event.target)) close()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
    toggle.focus()
  }

  const open = (): void => {
    list.replaceChildren(
      ...others.map((place) => {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'blk-synced-places-item'
        item.setAttribute('role', 'menuitem')
        const title = document.createElement('span')
        title.textContent = place.title || '제목 없음'
        item.append(title)
        if (place.original) {
          const tag = document.createElement('span')
          tag.className = 'blk-synced-places-tag'
          tag.textContent = '원본'
          item.append(tag)
        }
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => {
          close()
          navigate(`/w/${workspaceId}/${place.pageId}#${place.blockId}`)
        })
        return item
      }),
    )
    list.hidden = others.length === 0
    toggle.setAttribute('aria-expanded', String(!list.hidden))
    if (list.hidden) return
    document.addEventListener('pointerdown', onAway, true)
    document.addEventListener('keydown', onKey, true)
  }

  toggle.addEventListener('mousedown', (event) => event.preventDefault())
  toggle.addEventListener('click', () => {
    if (!list.hidden) {
      close()
      return
    }
    // 누를 때 다시 묻는다 — 그 사이 사본이 생기거나 권한이 바뀌었을 수 있다
    void loadPlaces(workspaceId, originalId).then((places) => {
      if (destroyed) return
      if (places !== null) apply(places)
      open()
    })
  })

  void loadPlaces(workspaceId, originalId).then((places) => {
    if (!destroyed && places !== null) apply(places)
  })

  return {
    destroy() {
      destroyed = true
      close()
    },
  }
}
