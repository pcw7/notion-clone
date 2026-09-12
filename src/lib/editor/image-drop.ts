/**
 * 이미지 드래그 앤 드롭 · 붙여넣기 — F-01-15
 *
 * 정본 F-01-15 UI: *"드래그 앤 드롭 업로드, 붙여넣기 업로드"*,
 * 시나리오: *"파일 드래그 앤 드롭 → 타입에 따라 image/video/audio/pdf/file 블록 자동 선택."*
 * 우리는 image 만 P0 이므로 나머지 타입은 **받지 않고 이유를 말한다** — 조용히
 * 무시하면 사용자는 파일이 어디로 갔는지 모른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 놓을 자리는 새로 정하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 자리 규칙은 판결 ④ 하나다: **새 블록은 화면에서 바로 다음 줄에 나타나고,
 * 자식을 옮기지 않는다**(§7-4 최빈 버그). 펼쳐진 자식이 있으면 첫 자식,
 * 접혀 있으면 그 블록 뒤 — 분할 · `+` 버튼 · 붙여넣기와 같은 자리다.
 *
 * **블록 선택일 때는 `pasteBlocksCommand` 에 그대로 넘긴다** — 고른 블록을
 * 대체하는 일은 거기서 이미 옳게 한다.
 *
 * 다만 캐럿일 때는 그 커맨드를 쓰지 않는다. 이미지는 원자라 슬라이스의 양끝을
 * 열 수 없고, 닫힌 슬라이스를 `replaceSelection` 에 넘기면 ProseMirror 가
 * **문단을 캐럿 자리에서 쪼갠다.** 줄 맨 앞에 캐럿이 있으면 앞쪽 조각이 빈
 * 문단으로 남아 `· | [이미지] | A` 가 된다(테스트가 잡았다). 텍스트 붙여넣기는
 * 양끝을 열어 병합되므로 그 경로가 맞지만, 원자에는 맞지 않는다.
 *
 * 그래서 캐럿일 때는 **쪼개지 않고 넣는다**. 빈 문단 위에 놓았을 때만 그 문단을
 * 대체한다 — 사용자가 비워 둔 줄에 놓았는데 빈 줄이 하나 더 생기면 안 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 파일은 블록보다 먼저 큐에 넣는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 빈 이미지 블록을 먼저 만들고(사용자는 자리를 즉시 본다) 노드 뷰가 업로드를
 * 진행한다 — 진행률 UI 가 이미 거기 있기 때문이다(`image-view.ts`).
 *
 * 그런데 노드 뷰는 **dispatch 하는 그 순간 동기적으로** 만들어진다. 그래서
 * 큐에 넣는 것이 먼저다. 순서를 뒤집으면 노드 뷰가 큐를 볼 때 아직 비어 있고,
 * 방금 놓은 이미지가 영영 올라가지 않는다.
 */

import { TextSelection } from '@tiptap/pm/state'
import { Plugin, PluginKey, type Command } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { isAllowedMime } from '../file/limits.ts'
import { specOf } from '../block/types.ts'
import { containerFor, newBlockId } from './pm-adapter.ts'
import { blockTypeOf, containerAt } from './pm-blocks.ts'
import { isBlockSelection } from './block-selection.ts'
import type { CommandDeps } from './commands.ts'
import type { EditorBlock } from './document.ts'
import { pasteBlocksCommand, withFreshBlockIds } from './block-clipboard.ts'

export const imageDropPluginKey = new PluginKey('imageDrop')

/** 이미지만 이 자리에서 처리한다. 나머지는 몇 개였는지만 세어 알린다. */
export type FilePartition = { readonly images: File[]; readonly rejected: number }

/**
 * 드롭·붙여넣기로 들어온 파일을 가른다.
 *
 * MIME 이 비어 있는 파일은 받지 않는다 — 확장자로 추측해 올리면 서버가
 * `unsupported_type` 으로 되돌려 보내고, 사용자는 "왜 어떤 건 되고 어떤 건
 * 안 되는지" 알 수 없는 상태가 된다. 판단 기준은 `limits.ts` 한 곳이다.
 */
export function partitionImageFiles(files: ArrayLike<File> | null | undefined): FilePartition {
  const images: File[] = []
  let rejected = 0
  for (let i = 0; i < (files?.length ?? 0); i += 1) {
    const file = files![i]
    if (isAllowedMime(file.type)) images.push(file)
    else rejected += 1
  }
  return { images, rejected }
}

export function rejectionNotice(count: number): string {
  return `${count}개는 넣지 않았습니다 — 지금은 PNG · JPEG · GIF · WEBP 이미지만 넣을 수 있습니다.`
}

/** 아직 아무것도 가리키지 않는 이미지 블록. */
export function emptyImageBlock(id: string): EditorBlock {
  return { id, type: 'image', title: [], properties: {}, format: {}, children: [] }
}

/**
 * 빈 이미지 블록 `ids.length` 개를 지금 위치에 넣는다.
 *
 * id 를 **밖에서 받는다.** 만들어진 블록의 id 를 알아야 그 블록에 올릴 파일을
 * 짝지을 수 있는데, 커맨드가 끝난 뒤에 문서를 뒤져 찾으면 같은 모양의 빈
 * 이미지 블록이 이미 있을 때 엉뚱한 것을 고른다.
 */
export function insertImageBlocksCommand(ids: readonly string[], deps: CommandDeps): Command {
  if (ids.length === 0) return () => false

  return (state, dispatch) => {
    const blocks = ids.map(emptyImageBlock)

    // 블록 선택을 대체하는 일은 붙여넣기와 완전히 같다.
    if (isBlockSelection(state.selection)) {
      let next = 0
      // `pasteBlocksCommand` 는 언제나 새 id 를 찍는다(붙여넣기의 규칙). 우리는
      // 이미 정해 둔 id 를 순서대로 돌려준다.
      return pasteBlocksCommand(blocks, { ...deps, newId: () => ids[next++] ?? newBlockId() })(
        state,
        dispatch,
      )
    }

    const info = containerAt(state.selection.$from)
    if (info === null) return false

    const containers = withFreshBlockIds(blocks, (() => {
      let next = 0
      return () => ids[next++] ?? newBlockId()
    })()).map(containerFor)

    const tr = state.tr
    if (isEmptyTextBlock(info)) {
      // 비워 둔 줄에 놓았다. 그 줄을 대체한다 — 빈 줄이 하나 더 생기지 않게.
      tr.replaceWith(info.pos, info.pos + info.node.nodeSize, containers)
    } else {
      const at =
        info.groupPos !== null && info.groupNode?.childCount && !deps.isCollapsed(info.id)
          ? info.groupPos + 1
          : info.pos + info.node.nodeSize
      tr.insert(at, containers)
    }

    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/** 텍스트를 담는 타입인데 내용도 자식도 없는 줄. 사용자가 비워 둔 자리다. */
function isEmptyTextBlock(info: ReturnType<typeof containerAt> & object): boolean {
  const type = blockTypeOf(info.contentNode)
  return (
    specOf(type).hasRichText &&
    info.contentNode.content.size === 0 &&
    (info.groupNode?.childCount ?? 0) === 0
  )
}

// ── 올릴 파일 큐 ──────────────────────────────────────────────────────

/**
 * 아직 노드 뷰가 가져가지 않은 파일.
 *
 * `WeakMap<EditorView, …>` 다 — 에디터마다 따로이고 에디터가 사라지면 같이
 * 사라진다. 모듈 전역 `Map` 으로 두면 탭을 오갈 때 이전 에디터의 큐가 남는다.
 */
const QUEUED = new WeakMap<EditorView, Map<string, File>>()

export function queueUpload(view: EditorView, blockId: string, file: File): void {
  const map = QUEUED.get(view) ?? new Map<string, File>()
  map.set(blockId, file)
  QUEUED.set(view, map)
}

/** 한 번만 가져간다. 두 번 올리는 일이 없어야 한다. */
export function takeQueuedUpload(view: EditorView, blockId: string): File | null {
  const map = QUEUED.get(view)
  const file = map?.get(blockId) ?? null
  if (file !== null) map!.delete(blockId)
  return file
}

// ── 실행 ──────────────────────────────────────────────────────────────

/**
 * 파일들을 이미지 블록으로 만든다. 넣을 자리는 현재 선택이다.
 *
 * @returns 하나라도 처리했으면 true — 이벤트를 우리가 먹었다는 뜻이다.
 */
export function insertImageFiles(view: EditorView, files: FilePartition, deps: CommandDeps): boolean {
  if (files.rejected > 0) deps.onRefused?.(rejectionNotice(files.rejected))
  if (files.images.length === 0) return files.rejected > 0

  const ids = files.images.map(() => (deps.newId ?? newBlockId)())
  // ⚠ 큐가 먼저다(머리말).
  ids.forEach((id, i) => queueUpload(view, id, files.images[i]))

  const ok = insertImageBlocksCommand(ids, deps)(view.state, view.dispatch.bind(view))
  if (!ok) for (const id of ids) takeQueuedUpload(view, id)
  return ok
}

/**
 * 드롭 좌표를 캐럿으로 바꾼다.
 *
 * 좌표가 문서 밖이면(여백에 놓았다) 문서 끝으로 둔다 — 거부하는 것보다 낫다.
 * 사용자는 "여기쯤"에 놓은 것이고, 아무 일도 일어나지 않으면 파일이 사라진
 * 것처럼 보인다.
 */
export function placeCaretAtDrop(view: EditorView, clientX: number, clientY: number): void {
  const at = view.posAtCoords({ left: clientX, top: clientY })
  const pos = at?.pos ?? view.state.doc.content.size
  const $pos = view.state.doc.resolve(Math.min(Math.max(pos, 0), view.state.doc.content.size))
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
}

/**
 * 드롭·붙여넣기 플러그인.
 *
 * **클립보드 플러그인보다 앞에 둔다.** 스크린샷을 붙이면 `clipboardData` 에
 * 파일과 함께 `text/html`(이미지 태그)이 같이 실려 오는 경우가 있어서, 뒤에
 * 두면 HTML 경로가 먼저 먹고 빈 문단이 들어간다.
 */
export function imageDropPlugin(deps: CommandDeps): Plugin {
  return new Plugin({
    key: imageDropPluginKey,
    props: {
      handleDrop: (view, event, _slice, moved) => {
        // 에디터 안에서 블록을 끌어다 놓은 것이다. 그건 블록 핸들의 일이다.
        if (moved) return false
        const files = partitionImageFiles((event as DragEvent).dataTransfer?.files)
        if (files.images.length === 0 && files.rejected === 0) return false

        event.preventDefault()
        placeCaretAtDrop(view, (event as DragEvent).clientX, (event as DragEvent).clientY)
        return insertImageFiles(view, files, deps)
      },

      handlePaste: (view, event) => {
        const files = partitionImageFiles((event as ClipboardEvent).clipboardData?.files)
        // 파일이 하나도 없으면 평범한 붙여넣기다. 클립보드 플러그인에게 넘긴다.
        if (files.images.length === 0) return false
        event.preventDefault()
        return insertImageFiles(view, files, deps)
      },

      handleDOMEvents: {
        /**
         * 파일을 끌고 들어왔을 때 `dragover` 를 막지 않으면 **브라우저가 그 파일을
         * 열어 버린다** — 페이지를 떠나는 것이라 편집 중이던 화면이 사라진다.
         */
        dragover: (_view, event) => {
          const dt = (event as DragEvent).dataTransfer
          if (dt && [...dt.types].includes('Files')) event.preventDefault()
          return false
        },
      },
    },
  })
}
