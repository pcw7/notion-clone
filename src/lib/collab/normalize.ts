/**
 * 본문 트리 정규화 — 동시 편집이 만든 구조 위반을 결정론적으로 고친다 (F-05-01)
 *
 * 정본: 05-collaboration-sync.md F-05-01 엣지 케이스 · 판결 X-1
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 필요한가 — Yjs 는 트리 제약을 모른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 따로 보면 스키마에 맞는 편집 두 개가, 합치면 스키마(`schema.ts`)를 어긴다. Y.Doc 에는 그 위반이
 * 그대로 쌓인다. `ydoc.ts` 의 읽기가 Y 요소를 **검사하지 않고** ProseMirror 노드로 옮겨 이 함수에 넘긴다 —
 * y-prosemirror 의 변환은 `createChecked` 로 만들다 던지면 그 Y 요소를 지우므로 쓰지 않는다(`ydoc.ts`
 * 머리말). 고치지 않고 `pmToDoc` 에 넣으면 내용 노드 자리에서 그룹을 읽는다.
 *
 *   동시 편집                                   합친 결과                  고치는 법
 *   ─────────────────────────────────────────  ────────────────────────  ─────────────────────────────
 *   둘이 같은 블록의 타입을 바꾼다               내용 노드 둘              Y 순서의 첫째만 남긴다 ①
 *   둘이 한 그룹의 남은 자식을 하나씩 지운다     빈 그룹                   그룹을 뗀다
 *   둘이 같은 블록 밑으로 처음 들여쓴다          그룹 둘                   순서대로 합친다
 *   둘이 순서를 바꾼다(y-prosemirror 는 옮기지   같은 blockId 둘           문서 순서의 첫째가 갖고
 *     않고 요소를 고쳐 쓴다 — attr 이 LWW)                                 나머지는 결정론적 새 id ②
 *   토글을 제목으로 바꾸는 동안 자식을 넣는다    자식을 못 갖는 타입에 자식  자식을 바로 뒤 형제로 올린다
 *   둘이 빈 페이지를 동시에 처음 채운다          루트 그룹 둘              합친다
 *
 *   ① 타입은 병합할 수 없다(F-05-01 시나리오 4: "한쪽 값만 남는다"). 어느 쪽이 남는지는 Yjs 의
 *      동시 삽입 순서(client id)가 정한다 — "늦게 한 쪽이 이긴다"가 아니다
 *   ② 새 id 는 무작위가 아니다. 무작위면 프로젝터가 읽을 때마다 새 `block` 행을 만든다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 세 가지 성질
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - **전체 함수** — 어떤 입력에도 던지지 않고 스키마에 맞는 문서를 낸다
 *   - **결정론** — 같은 문서면 같은 결과. 수렴한 두 참여자는 같은 문서를 본다
 *   - **가능하면 잃지 않는다** — 버리는 것은 타입 충돌에서 진 내용 노드와 스키마 자리에 올 수 없는
 *     노드(그룹 자리의 글자 같은 것)뿐이다. 자식은 올리지 버리지 않는다
 */

import type { Node as PmNode } from '@tiptap/pm/model'

import { MAX_TREE_DEPTH, PAGE_TYPE, specOf, type BlockType } from '../block/types.ts'
import { isUuid } from '../ids.ts'
import { blockSchema, PAGE_REF_NODE } from '../editor/schema.ts'

export type NormalizeFix =
  /** 루트에 그룹이 없다. */
  | 'root_group_missing'
  /** 그룹이 둘 이상이다(루트 또는 한 컨테이너 안). */
  | 'groups_merged'
  /** 그룹 안에 그룹이 바로 들어 있다. */
  | 'nested_group_flattened'
  /** 컨테이너 없이 내용 노드가 그룹 자리에 있다 — 새 컨테이너로 감쌌다. */
  | 'content_wrapped'
  /** 그룹 자리에 올 수 없는 노드(글자 · 인라인)를 버렸다. */
  | 'stray_dropped'
  /** 컨테이너에 내용 노드가 없다 — 그 자식을 그 자리로 올렸다. */
  | 'empty_container_lifted'
  /** 컨테이너에 내용 노드가 둘 이상이다 — 첫째만 남겼다. */
  | 'type_conflict_resolved'
  /** 자식이 하나도 남지 않은 그룹을 뗐다. */
  | 'empty_group_removed'
  /** 자식을 못 갖는 타입(또는 깊이 상한)의 자식을 뒤 형제로 올렸다. */
  | 'children_lifted'
  /** 텍스트 블록 안의 블록 노드 · 원자 블록 안의 자식을 버렸다. */
  | 'invalid_content_dropped'
  /** `props` · `format` 이 객체가 아니어서 빈 객체로 바꿨다. */
  | 'invalid_attrs_reset'
  /** blockId 가 비었거나 uuid 가 아니다 — 새 id. */
  | 'blank_id'
  /** blockId 가 문서에 두 번 이상 나온다 — 첫째 뒤의 것은 새 id. */
  | 'duplicate_id'
  /** 남은 블록이 없다 — 빈 문단 하나를 넣었다(`ydoc.ts` 머리말). */
  | 'empty_root_filled'

export type NormalizeResult = {
  /** 스키마에 맞는 문서. 고칠 것이 없었어도 새로 조립한 노드다 — 입력과는 `eq` 로 비교한다. */
  readonly doc: PmNode
  /** 고친 것. 비었으면 입력이 이미 올발랐다. 같은 종류가 여러 번 나올 수 있다. */
  readonly fixes: readonly NormalizeFix[]
}

export type NormalizeOptions = {
  /**
   * 새 id 의 씨앗 — 페이지 id 를 넣는다. 빈 id 는 **위치**로 새 id 를 만드는데 위치는 페이지마다
   * 겹친다. 씨앗이 없으면 두 페이지의 같은 자리 블록이 같은 id(= 같은 `block` 행)를 받는다.
   */
  readonly seed: string
}

const { doc: DOC, blockGroup: GROUP, blockContainer: CONTAINER, paragraph: PARAGRAPH } = blockSchema.nodes

function childrenOf(node: PmNode): PmNode[] {
  const out: PmNode[] = []
  node.forEach((child) => out.push(child))
  return out
}

function isBlockContent(node: PmNode): boolean {
  return (node.type.spec.group ?? '').split(' ').includes('blockContent')
}

function isPlainObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 내용 노드가 자식 블록을 가질 수 있는가. 하위 페이지 참조 밑은 그 페이지의 문서라 안 된다. */
function canNest(content: PmNode): boolean {
  if (content.type.name === PAGE_REF_NODE) return false
  return specOf(content.type.name as BlockType).canHaveChildren && content.type.name !== PAGE_TYPE
}

export function normalizeBody(input: PmNode, options: NormalizeOptions): NormalizeResult {
  const fixes: NormalizeFix[] = []
  /** 이미 누군가 가진 id — 진짜 id 와 새로 만든 id 모두. */
  const claimed = new Set<string>()
  const occurrences = new Map<string, number>()

  const newId = (seed: string): string => {
    let id = derivedBlockId(`${options.seed}|${seed}`)
    for (let i = 1; claimed.has(id); i += 1) id = derivedBlockId(`${options.seed}|${seed}|${i}`)
    claimed.add(id)
    return id
  }

  // 전위 순회 순서로 부른다 — "문서 순서의 첫째가 id 를 갖는다"가 이 호출 순서다.
  const claimId = (raw: unknown, path: string): string => {
    const id = typeof raw === 'string' && isUuid(raw) ? raw : ''
    if (id === '') {
      fixes.push('blank_id')
      return newId(`blank:${path}`)
    }
    const seen = occurrences.get(id) ?? 0
    occurrences.set(id, seen + 1)
    if (seen === 0 && !claimed.has(id)) {
      claimed.add(id)
      return id
    }
    fixes.push('duplicate_id')
    return newId(`${id}:${seen}`)
  }

  const cleanContent = (content: PmNode): PmNode => {
    let changed = false
    const attrs: Record<string, unknown> = { ...content.attrs }
    for (const key of ['props', 'format']) {
      if (key in attrs && !isPlainObject(attrs[key])) {
        attrs[key] = {}
        changed = true
        fixes.push('invalid_attrs_reset')
      }
    }
    const inline: PmNode[] = []
    if (content.type.isTextblock) {
      content.forEach((child) => {
        if (child.isInline) inline.push(child)
        else {
          changed = true
          fixes.push('invalid_content_dropped')
        }
      })
    } else if (content.childCount > 0) {
      changed = true
      fixes.push('invalid_content_dropped')
    }
    return changed ? content.type.create(attrs, inline, content.marks) : content
  }

  /** 그룹 자리에 온 노드들 → 올바른 컨테이너들. */
  const containersOf = (nodes: readonly PmNode[], path: string, depth: number): PmNode[] => {
    const out: PmNode[] = []
    nodes.forEach((node, i) => {
      const here = `${path}.${i}`
      if (node.type === CONTAINER) {
        out.push(...containerOf(node, here, depth))
      } else if (node.type === GROUP) {
        fixes.push('nested_group_flattened')
        out.push(...containersOf(childrenOf(node), here, depth))
      } else if (isBlockContent(node)) {
        fixes.push('content_wrapped')
        out.push(CONTAINER.create({ blockId: newId(`wrap:${here}`) }, [cleanContent(node)]))
      } else {
        fixes.push('stray_dropped')
      }
    })
    return out
  }

  /** 컨테이너 하나 → 0개(내용이 없어 자식을 올림) · 1개 · 여러 개(자식을 뒤 형제로 올림). */
  const containerOf = (node: PmNode, path: string, depth: number): PmNode[] => {
    const contents: PmNode[] = []
    const inner: PmNode[] = []
    let groups = 0
    node.forEach((child) => {
      if (isBlockContent(child)) contents.push(child)
      else if (child.type === GROUP) {
        groups += 1
        inner.push(...childrenOf(child))
      } else inner.push(child)
    })
    if (groups > 1) fixes.push('groups_merged')

    if (contents.length === 0) {
      fixes.push('empty_container_lifted')
      return containersOf(inner, path, depth)
    }
    if (contents.length > 1) fixes.push('type_conflict_resolved')

    const content = cleanContent(contents[0])
    const blockId = claimId(node.attrs.blockId, path)
    const nestable = canNest(content) && depth < MAX_TREE_DEPTH
    const children = containersOf(inner, path, nestable ? depth + 1 : depth)
    if (groups > 0 && children.length === 0) fixes.push('empty_group_removed')

    if (children.length === 0) return [CONTAINER.create({ blockId }, [content])]
    if (nestable) return [CONTAINER.create({ blockId }, [content, GROUP.create(null, children)])]
    fixes.push('children_lifted')
    return [CONTAINER.create({ blockId }, [content]), ...children]
  }

  const top: PmNode[] = []
  let rootGroups = 0
  input.forEach((child) => {
    if (child.type === GROUP) {
      rootGroups += 1
      top.push(...childrenOf(child))
    } else top.push(child)
  })
  if (rootGroups === 0) fixes.push('root_group_missing')
  else if (rootGroups > 1) fixes.push('groups_merged')

  let containers = containersOf(top, 'r', 1)
  if (containers.length === 0) {
    fixes.push('empty_root_filled')
    containers = [CONTAINER.create({ blockId: newId('fill') }, [PARAGRAPH.create({ props: {}, format: {} })])]
  }

  return { doc: DOC.create(null, [GROUP.create(null, containers)]), fixes }
}

// ── 결정론적 id ───────────────────────────────────────────────────────

/**
 * 씨앗 문자열 → uuid 모양의 id. 같은 씨앗이면 같은 id 다.
 *
 * 암호학적 해시가 아니다. 필요한 것은 "우연히 겹치지 않는다"뿐이고, 브라우저 에디터도 같은 함수를
 * **동기로** 불러야 한다(Web Crypto 는 비동기다). cyrb53(퍼블릭 도메인, bryc) 을 씨앗 셋으로 돌려
 * 이어 붙인다.
 */
export function derivedBlockId(seed: string): string {
  const hex = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map((s) => cyrb53(seed, s).toString(16).padStart(14, '0')).join('')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
