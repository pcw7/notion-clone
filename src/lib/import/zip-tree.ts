/**
 * ZIP 의 폴더 → 페이지 나무 — 잔여 묶음 8m-2a (F-09-12 · 순수)
 *
 * 정본: 09-api-integrations.md F-09-12 *"ZIP 안의 폴더 계층을 페이지 트리로 복원할 때, 같은 이름의 `foo.md` 와 `foo/` 디렉터리가 공존하는 노션식
 *       export 구조를 정확히 이해해야 한다(폴더가 그 md 페이지의 자식들). 이 규칙을 놓치면 계층이 평평해진다"* · §3.4 [보강] 가져오기 ⑦
 *
 * 우리 내보내기(`export/names.ts` — `이름.md` + 폴더 `이름`)와 노션 내보내기(`이름 <32hex>.md` + 폴더 `이름 <32hex>`)가 같은 규칙이다.
 *
 *   · 가져올 수 있는 파일(`.md` · `.markdown` · `.txt`) 하나가 페이지 하나 — 열쇠는 확장자를 뗀 경로(`회의록/하위`)
 *   · 폴더 `X` 의 주인은 같은 자리의 `X.md` — 있으면 그 페이지가 폴더 안 페이지들의 부모다. **없으면 폴더만의 페이지**(제목은 폴더 이름)를
 *     만들어 계층을 지킨다(평평해지지 않게)
 *   · 이름은 대소문자 · 정규화(NFC)를 무시하고 맞춘다 — 풀리는 파일 시스템이 그렇게 보고, 내보내기의 겹침 규칙(`collisionKey`)과 같다
 *   · 같은 열쇠의 둘째 파일(`a.md` 와 `a.txt`)은 건너뛰고 적는다(`duplicate`) · 가져올 수 없는 파일(이미지 · PDF …)도 적는다
 *     (`unsupported_type` — 이미지는 8m-2b)
 *   · 순서는 ZIP 에 처음 나온 순서(내보내기는 본문의 순서로 쓴다)
 */

import { collisionKey } from '../export/zip.ts'
import { importKindOf } from './kinds.ts'
import type { ZipEntry } from './zip-read.ts'

export type TreeNode = {
  /** 확장자를 뗀 경로 — `회의록/하위`. */
  readonly key: string
  /** 마지막 조각(확장자 없음) — 폴더만의 페이지 · 제목 없는 파일의 제목. */
  readonly name: string
  /** 페이지가 될 파일 — 없으면 폴더만의 페이지. */
  file: ZipEntry | null
  readonly children: TreeNode[]
}

export type TreeIgnoreReason = 'unsupported_type' | 'duplicate'
export type ZipTree = { readonly roots: readonly TreeNode[]; readonly ignored: readonly { path: string; reason: TreeIgnoreReason }[] }

export function buildZipTree(entries: readonly ZipEntry[]): ZipTree {
  const roots: TreeNode[] = []
  const byKey = new Map<string, TreeNode>()
  const ignored: { path: string; reason: TreeIgnoreReason }[] = []

  /** 이 열쇠의 마디 — 없으면 만들고(조상까지) 부모에 단다. */
  const ensure = (key: string): TreeNode => {
    const found = byKey.get(collisionKey(key))
    if (found !== undefined) return found
    const cut = key.lastIndexOf('/')
    const node: TreeNode = { key, name: key.slice(cut + 1), file: null, children: [] }
    byKey.set(collisionKey(key), node)
    if (cut === -1) roots.push(node)
    else ensure(key.slice(0, cut)).children.push(node)
    return node
  }

  for (const entry of entries) {
    const kind = importKindOf(entry.path)
    if (kind === null || kind === 'zip') {
      ignored.push({ path: entry.path, reason: 'unsupported_type' })
      continue
    }
    const key = entry.path.replace(/\.[^./]+$/, '')
    const node = ensure(key)
    if (node.file !== null) {
      ignored.push({ path: entry.path, reason: 'duplicate' })
      continue
    }
    node.file = entry
  }
  return { roots, ignored }
}

/** 나무의 마디 수. */
export function countNodes(nodes: readonly TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0)
}
