'use client'

/**
 * 버전 하나의 읽기 전용 미리보기 — 기록 화면의 왼쪽 (잔여 묶음 8d-2 · F-11-01)
 *
 * 협업 없는 문서 상태(`createDocumentState`)를 `editable: false` 로 연 편집기다 — 본문과 같은 노드 뷰가 그린다(코드 블록 · 목차 · 이미지 ·
 * 하위 페이지 · 멘션이 지금 본문과 같은 모습). 의존성은 `editor/read-only-deps.ts` — 이름 · 아이콘은 미리보기 API 가 준 맵(지금의 권한으로
 * 거른 것), 바꾸는 일 · 옮겨 가는 일은 아무것도 하지 않는다. 글자를 골라 복사할 수는 있다(F-11-01 *"원하는 블록만 선택 후 복사 → 현재 버전에
 * 붙여넣기"* — 클립보드는 편집 플러그인의 것 그대로다).
 *
 * 편집기는 버전이 바뀔 때마다 새로 만든다 — 문서 하나를 다른 문서로 바꾸는 트랜잭션보다 단순하고, 미리보기는 고칠 상태가 없다.
 */

import { useEffect, useRef } from 'react'

import { createDocumentState, createEditor } from '@/lib/editor/create-editor'
import { readOnlyEditorDeps, type PreviewLabels } from '@/lib/editor/read-only-deps'
import type { EditorDoc } from '@/lib/editor/document'

export function VersionPreview({ workspaceId, doc, labels }: { workspaceId: string; doc: EditorDoc; labels: PreviewLabels }) {
  const mountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    const deps = readOnlyEditorDeps(workspaceId, labels)
    const view = createEditor({ mount, state: createDocumentState(doc, deps), editable: () => false, deps, onTransaction: () => undefined })
    // 본문 편집기와 같은 역할 이름을 쓰면 화면 읽는 이가 둘을 가르지 못한다.
    view.dom.setAttribute('aria-label', '버전 미리보기')
    view.dom.setAttribute('aria-readonly', 'true')
    return () => view.destroy()
  }, [workspaceId, doc, labels])

  return <div ref={mountRef} data-testid="version-preview" />
}
