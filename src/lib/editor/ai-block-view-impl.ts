/**
 * AI 블록의 머리 줄 — 종류 · 지시 · 바뀜 표시 · 생성 · 멈추기 · 미리보기 (AI-5 · F-10-04 · 지연 로드 · 브라우저)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑩ · 10-ai-features.md F-10-04
 *
 *   · 만들기는 늘 사람이 누를 때다 — "생성"(처음) · "다시 생성"(뒤) · "페이지가 바뀌었습니다 · 업데이트"(바뀜 표시). 서버가 결과를 본문에 쓰고
 *     (출처 `ai`) 협업으로 모두에게 온다. 흐르는 동안 글은 이 블록 안의 **미리보기**에만 있다(문서 밖 · 다른 사람에게 보이지 않는다)
 *   · 바뀜(stale) — 편집기가 지금 문서의 원문(제안 마크 밖 · AI 블록을 모두 뺀 것)으로 서버와 **같은 함수**(`ai/block-source.ts`)의 해시를 짓고
 *     `sourceHash` 와 견준다. 문서 · 맥락이 바뀌면(편집기의 알림) 조금 기다렸다 다시 센다(문서마다 한 번 — `WeakMap`)
 *   · 고친 결과 — 자식의 지금 글의 해시가 `resultHash` 와 다르면 다시 만들기 전에 "직접 고친 내용이 사라집니다" 를 묻는다
 *   · 만들 수 없으면(템플릿 · AI 꺼짐 · 공급자 없음 · 게스트 · 고칠 수 없음 · 제안 모드 · 한도) 단추를 끄고 까닭을 말한다(판정은 서버가 다시 한다)
 *   · 흐름은 블록 id 마다 하나 — 노드 뷰가 다시 만들어져도(협업 갱신) 같은 흐름에 다시 붙는다
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

import { AI_ASK_DISABLED, AI_ASK_FORBIDDEN, AI_ASK_UNAVAILABLE, askFailureMessage, clockText, streamAi, type AskFailure } from '../ai/ask-client.ts'
import { aiResultText, aiSourceText, aiTextHash, findBlockIn, readAiBlock, type AiBlockProps } from '../ai/block-source.ts'
import { AI_BLOCK_INSTRUCTION_MAX, type AiBlockKind } from '../block/ai-block.ts'
import type { AiBlockHost, AiBlockViewDeps, MountedAiBlock } from './ai-block-view.ts'
import type { EditorDoc } from './document.ts'
import { pmToDoc } from './pm-adapter.ts'
import { originalOf } from './suggestion-original.ts'

const KIND_LABEL: Readonly<Record<AiBlockKind, string>> = { summary: 'AI 요약', action_items: 'AI 할 일', custom: 'AI 블록' }

/** 문서 → 원문(제안 마크 밖)과 그 해시 — 문서마다 한 번. */
const docCache = new WeakMap<PmNode, { readonly doc: EditorDoc; readonly sourceHash: string }>()
function readDoc(pm: PmNode): { readonly doc: EditorDoc; readonly sourceHash: string } {
  let hit = docCache.get(pm)
  if (hit === undefined) {
    const doc = pmToDoc(originalOf(pm).doc)
    hit = { doc, sourceHash: aiTextHash(aiSourceText(doc)) }
    docCache.set(pm, hit)
  }
  return hit
}

// ── 흐름 — 블록 id 마다 하나 ──────────────────────────────────────────

type Generation = {
  phase: 'streaming' | 'applying' | 'stopped' | 'error'
  text: string
  failure: AskFailure | null
  readonly controller: AbortController
  /** 시작할 때의 `generatedAt` — 바뀌면 결과가 문서에 왔다. */
  readonly before: string | null
  timer: ReturnType<typeof setTimeout> | null
}
const generations = new Map<string, Generation>()
const watchers = new Map<string, Set<() => void>>()
const notify = (id: string) => {
  for (const fn of watchers.get(id) ?? []) fn()
}
const endGeneration = (id: string, gen: Generation) => {
  if (gen.timer !== null) clearTimeout(gen.timer)
  if (generations.get(id) === gen) generations.delete(id)
  notify(id)
}

/** 한도에 닿은 워크스페이스 — 풀리는 시각까지 단추를 끈다(체험은 이 화면 동안). */
const limitLocks = new Map<string, { readonly message: string; readonly until: number }>()

/** 결과가 문서에 오기를 기다리는 최대 시간 — 지나면 미리보기를 접는다(협업으로 곧 온다). */
const APPLY_WAIT_MS = 6000
/** 문서가 바뀐 뒤 바뀜 표시를 다시 세기까지. */
const RECOMPUTE_MS = 250

function disabledReason(host: AiBlockHost | null, props: AiBlockProps): string | null {
  if (host === null) return '여기서는 AI 블록을 만들 수 없습니다.'
  if (host.template) return '템플릿에서는 만들지 않습니다 — 이 템플릿으로 만든 페이지에서 만드세요.'
  if (host.ai.state === 'unavailable') return AI_ASK_UNAVAILABLE
  if (host.ai.state === 'forbidden') return AI_ASK_FORBIDDEN
  if (!host.editable) return '이 페이지를 고칠 수 있는 사람만 만들 수 있습니다.'
  if (host.suggesting) return '제안 모드에서는 만들 수 없습니다.'
  if (host.ai.state === 'disabled') return AI_ASK_DISABLED
  const lock = limitLocks.get(host.workspaceId)
  if (lock !== undefined) {
    if (lock.until > Date.now()) return lock.message
    limitLocks.delete(host.workspaceId)
  }
  if (props.kind === 'custom' && props.instruction.trim() === '') return '지시를 먼저 쓰세요.'
  return null
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(className: string, text: string, testId: string): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  b.dataset.testid = testId
  return b
}

/** 노드 뷰는 내용 노드만 받는다 — 위로 올라가 컨테이너의 id 를 찾는다. */
function containerIdOf(view: EditorView, getPos: () => number | undefined): string {
  const pos = getPos()
  if (pos === undefined) return ''
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'blockContainer') return String(node.attrs.blockId ?? '')
  }
  return ''
}

export function mountAiBlock(dom: HTMLElement, node: PmNode, view: EditorView, getPos: () => number | undefined, deps: AiBlockViewDeps): MountedAiBlock {
  let current = node
  let props = readAiBlock(node.attrs.props)
  const id = containerIdOf(view, getPos)
  let stale = false
  let edited = false
  let confirming = false
  let editing = false
  let gone = false

  const head = el('div', 'ai-block-head')
  const label = el('span', 'ai-block-label')
  const instruction = button('ai-block-instruction', '', 'ai-block-instruction')
  const status = el('span', 'ai-block-status')
  const staleButton = button('ai-block-stale', '페이지가 바뀌었습니다 · 업데이트', 'ai-block-stale')
  const actions = el('span', 'ai-block-actions')
  const editButton = button('ai-block-button', '지시 고치기', 'ai-block-edit-instruction')
  const generateButton = button('ai-block-button ai-block-primary', '생성', 'ai-block-generate')
  const stopButton = button('ai-block-button', '멈추기', 'ai-block-stop')
  actions.append(editButton, stopButton, generateButton)
  head.append(el('span', 'ai-block-icon', '✦'), label, instruction, status, staleButton, actions)

  const editor = el('div', 'ai-block-editor')
  const textarea = el('textarea', 'ai-block-textarea')
  textarea.maxLength = AI_BLOCK_INSTRUCTION_MAX
  textarea.rows = 2
  textarea.placeholder = '이 페이지로 무엇을 쓸까요? 예: 결정된 것만 세 줄로'
  textarea.dataset.testid = 'ai-block-instruction-input'
  textarea.setAttribute('aria-label', 'AI 블록의 지시')
  const counter = el('span', 'ai-block-counter')
  const saveButton = button('ai-block-button ai-block-primary', '저장', 'ai-block-instruction-save')
  const cancelButton = button('ai-block-button', '취소', 'ai-block-instruction-cancel')
  const editorRow = el('div', 'ai-block-editor-row')
  editorRow.append(counter, cancelButton, saveButton)
  editor.append(textarea, editorRow)

  const confirm = el('div', 'ai-block-confirm')
  confirm.dataset.testid = 'ai-block-confirm'
  confirm.setAttribute('role', 'alertdialog')
  const confirmYes = button('ai-block-button ai-block-danger', '다시 생성', 'ai-block-confirm-yes')
  const confirmNo = button('ai-block-button', '취소', 'ai-block-confirm-no')
  confirm.append(el('span', 'ai-block-confirm-text', '직접 고친 내용이 사라집니다. 다시 생성할까요?'), confirmNo, confirmYes)

  const note = el('div', 'ai-block-note')
  note.dataset.testid = 'ai-block-note'
  note.setAttribute('aria-live', 'polite')
  const preview = el('div', 'ai-block-preview')
  preview.dataset.testid = 'ai-block-preview'
  dom.replaceChildren(head, editor, confirm, note, preview)

  const host = (): AiBlockHost | null => deps.aiBlockHost?.() ?? null

  const recompute = () => {
    const { doc, sourceHash } = readDoc(view.state.doc)
    stale = props.sourceHash !== null && sourceHash !== props.sourceHash
    const me = findBlockIn(doc.blocks, id)
    edited = props.resultHash !== null && me !== null && aiTextHash(aiResultText(me.children ?? [])) !== props.resultHash
  }

  const render = () => {
    if (gone) return
    const h = host()
    const gen = generations.get(id) ?? null
    const busy = gen !== null && (gen.phase === 'streaming' || gen.phase === 'applying')
    const reason = disabledReason(h, props)
    const canEdit = h !== null && h.editable && !h.suggesting && !h.template
    dom.dataset.aiKind = props.kind
    dom.dataset.state = gen?.phase ?? (stale ? 'stale' : props.generatedAt === null ? 'empty' : 'idle')

    label.textContent = KIND_LABEL[props.kind]
    instruction.hidden = props.kind !== 'custom' || props.instruction === '' || editing
    instruction.textContent = props.instruction
    instruction.title = canEdit ? '지시 고치기' : props.instruction
    instruction.disabled = !canEdit || busy
    status.textContent = props.generatedAt === null ? '' : `${clockText(props.generatedAt, new Date())} 생성`
    staleButton.hidden = !stale || busy || props.generatedAt === null
    staleButton.disabled = reason !== null
    staleButton.title = reason ?? '지금 페이지로 다시 만듭니다'

    editButton.hidden = props.kind !== 'custom' || !canEdit || busy || editing || props.instruction === ''
    generateButton.textContent = props.generatedAt === null ? '생성' : '다시 생성'
    generateButton.hidden = busy
    generateButton.disabled = reason !== null
    generateButton.title = reason ?? ''
    stopButton.hidden = gen?.phase !== 'streaming'

    // 직접 지시 — 비었으면(고칠 수 있을 때) 입력칸을 바로 연다
    const showEditor = props.kind === 'custom' && canEdit && !busy && (editing || props.instruction === '')
    editor.hidden = !showEditor
    counter.textContent = `${textarea.value.length} / ${AI_BLOCK_INSTRUCTION_MAX}`
    saveButton.disabled = textarea.value.trim() === ''
    cancelButton.hidden = props.instruction === ''
    confirm.hidden = !confirming || busy

    const failure = gen?.phase === 'error' && gen.failure !== null ? askFailureMessage(gen.failure) : null
    note.dataset.tone = failure !== null ? 'error' : 'muted'
    note.textContent =
      failure ?? (gen?.phase === 'stopped' ? '멈췄습니다 — 결과를 바꾸지 않았습니다.' : reason !== null && !(showEditor && props.instruction === '') ? reason : '')
    note.hidden = note.textContent === ''
    preview.hidden = !busy
    preview.textContent = gen === null ? '' : gen.text === '' ? (gen.phase === 'streaming' ? '만드는 중…' : '') : gen.text
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (gone) return
      recompute()
      render()
    }, RECOMPUTE_MS)
  }

  const generate = async (confirmed: boolean) => {
    const h = host()
    const running = generations.get(id)
    if (h === null || id === '' || disabledReason(h, props) !== null || running?.phase === 'streaming' || running?.phase === 'applying') return
    recompute()
    if (!confirmed && edited) {
      confirming = true
      render()
      confirmYes.focus()
      return
    }
    confirming = false
    if (running !== undefined) endGeneration(id, running)
    const gen: Generation = { phase: 'streaming', text: '', failure: null, controller: new AbortController(), before: props.generatedAt, timer: null }
    generations.set(id, gen)
    notify(id)
    const outcome = await streamAi(h.workspaceId, { pageId: h.pageId, blockId: id }, gen.controller.signal, (text) => {
      gen.text += text
      notify(id)
    }, fetch, 'block')
    if (generations.get(id) !== gen) return
    if (outcome.kind === 'done') {
      // 결과는 협업으로 온다 — 서버가 쓴 뒤 `done` 을 보내므로 갱신이 먼저 왔을 수 있다(그러면 바로 접는다). 아니면 `generatedAt` 이 바뀔 때
      // 접는다(update) · 늦으면 시간이 지나 접는다
      if (props.generatedAt !== gen.before) {
        endGeneration(id, gen)
        return
      }
      gen.phase = 'applying'
      gen.timer = setTimeout(() => endGeneration(id, gen), APPLY_WAIT_MS)
    } else if (outcome.kind === 'aborted') {
      gen.phase = 'stopped'
    } else {
      gen.phase = 'error'
      gen.failure = outcome.failure
      if (outcome.failure.kind === 'limit') {
        const until = outcome.failure.resetsAt === null ? Number.POSITIVE_INFINITY : Date.parse(outcome.failure.resetsAt)
        limitLocks.set(h.workspaceId, { message: askFailureMessage(outcome.failure), until: Number.isNaN(until) ? Number.POSITIVE_INFINITY : until })
      }
    }
    notify(id)
  }

  const openEditor = () => {
    editing = true
    textarea.value = props.instruction
    render()
    textarea.focus()
  }
  const saveInstruction = () => {
    const value = textarea.value.trim().slice(0, AI_BLOCK_INSTRUCTION_MAX)
    const pos = getPos()
    if (value === '' || pos === undefined || !view.editable) return
    editing = false
    if (value !== props.instruction) {
      const attrs = current.attrs as { props: Record<string, unknown>; format: Record<string, unknown> }
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...attrs, props: { ...attrs.props, instruction: value } }))
    }
    render()
    view.focus()
  }

  generateButton.addEventListener('click', () => void generate(false))
  staleButton.addEventListener('click', () => void generate(false))
  confirmYes.addEventListener('click', () => void generate(true))
  confirmNo.addEventListener('click', () => {
    confirming = false
    render()
  })
  stopButton.addEventListener('click', () => generations.get(id)?.controller.abort())
  instruction.addEventListener('click', openEditor)
  editButton.addEventListener('click', openEditor)
  saveButton.addEventListener('click', saveInstruction)
  cancelButton.addEventListener('click', () => {
    editing = false
    render()
  })
  textarea.addEventListener('input', render)
  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      saveInstruction()
    } else if (event.key === 'Escape' && props.instruction !== '') {
      event.preventDefault()
      editing = false
      render()
      view.focus()
    }
  })

  const watch = () => render()
  const set = watchers.get(id) ?? new Set<() => void>()
  watchers.set(id, set)
  set.add(watch)
  const unsubscribe = deps.subscribeAiBlock?.(schedule) ?? (() => {})

  // 결과가 오며 노드 뷰가 새로 만들어졌으면(협업 갱신) 여기서 흐름을 닫는다
  const pending = generations.get(id)
  if ((pending?.phase === 'applying' || pending?.phase === 'streaming') && props.generatedAt !== pending.before) endGeneration(id, pending)
  recompute()
  render()
  if (deps.takeAiBlockFocus?.(id) === true && !editor.hidden) textarea.focus()

  return {
    update(updated) {
      current = updated
      const next = readAiBlock(updated.attrs.props)
      const changed = next.generatedAt !== props.generatedAt || next.sourceHash !== props.sourceHash || next.resultHash !== props.resultHash
      props = next
      // 결과가 문서에 왔다 — 흐르는 중이어도(갱신이 `done` 보다 먼저 온다) 접는다
      const gen = generations.get(id)
      if ((gen?.phase === 'applying' || gen?.phase === 'streaming') && props.generatedAt !== gen.before) endGeneration(id, gen)
      if (changed) recompute()
      render()
    },
    stopEvent(event) {
      const target = event.target
      return target instanceof Element && target.closest('button, textarea, input') !== null && dom.contains(target)
    },
    destroy() {
      gone = true
      if (timer !== null) clearTimeout(timer)
      unsubscribe()
      set.delete(watch)
      if (set.size === 0 && watchers.get(id) === set) watchers.delete(id)
    },
  }
}
