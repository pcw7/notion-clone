'use client'

/**
 * 오프라인 편집기 — 받아 둔 페이지 하나를 서버 없이 열고 고친다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ③)
 *
 * 껍데기(`/offline`)가 지연 로드하는 청크다 — 내려받을 때 앱이 껍데기 안에서 한 번 받아 둔다(`lib/offline/offline-warm.ts`). 그래서
 * 네트워크 없이도 이 파일과 그것이 부르는 것은 워커의 캐시에서 온다.
 *
 *   - **로컬 Y.Doc 에 묶는다** — 받은 상태 + 보존본(`lib/offline/offline-doc.ts`). 바인딩은 페이지 화면과 같다
 *     (`createCollabEditorState` — 같은 스키마 파사드 · 같은 편집 플러그인 · y-prosemirror 의 되돌리기). 협업 연결 · API 는 없다
 *   - **친 편집은 보존본에** — 다시 연결되어 앱을 열면 뒤에서 그 페이지의 연결을 열어 보내고(OF-3 · `lib/offline/offline-sync.ts`), 연결된 채
 *     그 페이지를 열어도 보낸다. 서버의 확인 답을 받은 뒤 지운다(6c · 6d). 사본도 친 것을 담는다
 *   - **네트워크가 필요한 것은 하지 않는다** — 노드 뷰의 의존성은 버전 미리보기의 것(`readOnlyEditorDeps` — 누르기 · 올리기 · 옮겨 가기는
 *     아무것도 하지 않는다)에 오프라인의 말을 얹었다. 임베드 · 버튼 · 데이터베이스는 그리기만 하고(누를 수 없다 · 표는 그리지 않는다),
 *     슬래시 · 멘션 · 이모지의 고르개는 페이지 화면의 것이라 여기엔 없다. 공유 · 권한 · 코멘트도 없다
 *   - 제목 · 아이콘 · 커버는 받은 그대로 보인다(고치지 않는다 — 제목은 본문 밖의 명령이다)
 */

import { useEffect, useRef, useState } from 'react'

import { COVER_FALLBACK_BACKGROUND, galleryEntry, type PageCover } from '@/lib/block/page-cover'
import { createCollabEditorState } from '@/lib/collab/collab-editor'
import { openPendingEditStore, pendingEditKey } from '@/lib/collab/pending-store'
import { BODY_FRAGMENT } from '@/lib/collab/ydoc'
import { createEditor, type EditorDeps } from '@/lib/editor/create-editor'
import { readOnlyEditorDeps } from '@/lib/editor/read-only-deps'
import { openOfflineDoc, trackOfflineEdits } from '@/lib/offline/offline-doc'
import { openOfflineStore, type OfflinePageRecord } from '@/lib/offline/offline-store'

/**
 * 다시 붙기 · 로그아웃의 일(OF-3) — 일하는 틀(`#sync`)이 **이 청크와 같은 `import()`** 로 받는다. 따로 지연 로드하면 새 청크 묶음이
 * 페이지 화면이 이미 싣는 모듈(협업 연결 · yjs)을 함께 써 그 화면의 첫 청크가 잘게 쪼개졌다(+3.5KB · `lib/offline/offline-sync-frame.ts`).
 * 이 청크는 그것들을 이미 싣는다.
 */
export { handleSyncRequest } from '@/lib/offline/offline-sync'

const OFFLINE_UPLOAD = '오프라인에서는 올릴 수 없습니다.'

/** 노드 뷰의 의존성 — 버전 미리보기의 것에 오프라인의 말을 얹는다. 이름 · 아이콘 맵은 없다(받지 않았다 — 모르는 것으로 그린다). */
function offlineEditorDeps(workspaceId: string): EditorDeps {
  return {
    ...readOnlyEditorDeps(workspaceId, { users: {}, pages: {}, pageIcons: {} }),
    pressButtonBlock: async () => ({ text: '오프라인에서는 누를 수 없습니다.', tone: 'warn' }),
    uploadImage: async () => ({ ok: false, message: OFFLINE_UPLOAD }),
    uploadFile: async () => ({ ok: false, message: OFFLINE_UPLOAD }),
    uploadVideo: async () => ({ ok: false, message: OFFLINE_UPLOAD }),
  }
}

/** 커버의 바탕 — 내장 커버는 그 색 · 그림 커버는 네트워크가 없어 회색 판. */
function coverBackground(cover: PageCover): string {
  return cover.type === 'gallery' ? (galleryEntry(cover.gallery)?.background ?? COVER_FALLBACK_BACKGROUND) : COVER_FALLBACK_BACKGROUND
}

type Phase = { readonly kind: 'opening' } | { readonly kind: 'ready'; readonly durable: boolean } | { readonly kind: 'failed' }

export function OfflineEditor({ record, onClose }: { record: OfflinePageRecord; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' })

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    let disposed = false
    let cleanup: (() => void) | null = null
    void (async () => {
      const pendingStore = await openPendingEditStore()
      const key = pendingEditKey(record.userId, record.pageId)
      const pending = await pendingStore.read(key)
      const offlineStore = await openOfflineStore()
      if (disposed) {
        offlineStore?.close()
        return
      }
      const doc = openOfflineDoc(record.state, pending)
      const tracker = trackOfflineEdits(doc, pending, async (merged, state) => {
        await pendingStore.write(key, merged)
        await offlineStore?.updateState(record.userId, record.pageId, state)
      })
      const collab = createCollabEditorState(doc.getXmlFragment(BODY_FRAGMENT), offlineEditorDeps(record.workspaceId))
      const view = createEditor({ mount, state: collab.state, editable: () => true, deps: collab.deps, onTransaction: () => undefined })
      cleanup = () => {
        view.destroy()
        // 밀린 쓰기를 마친 뒤에 문서 · 저장소를 내린다 — 마지막 편집이 남는다
        void tracker.stop().then(() => {
          doc.destroy()
          offlineStore?.close()
        })
      }
      setPhase({ kind: 'ready', durable: pendingStore.durable })
    })().catch((error: unknown) => {
      console.warn('[offline] 편집기를 열지 못했다:', error)
      if (!disposed) setPhase({ kind: 'failed' })
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [record])

  return (
    <div data-testid="offline-editor" data-page-id={record.pageId} className="fixed inset-0 z-10 overflow-y-auto bg-[var(--background)]">
      <div className="sticky top-0 z-20 flex min-h-11 items-center justify-between gap-2 bg-[var(--background)] px-3 py-1 text-sm">
        <button
          type="button"
          data-testid="offline-editor-close"
          onClick={onClose}
          className="rounded-md px-1.5 py-0.5 hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-white/5"
        >
          ← 내려받은 페이지
        </button>
        <span className="text-xs text-neutral-500">오프라인</span>
      </div>
      {record.cover !== null && <div aria-hidden className="h-[30vh] max-h-72 w-full" style={{ background: coverBackground(record.cover) }} />}
      <div className="mx-auto max-w-[720px] px-6 pb-32 pt-10 md:px-0">
        {record.icon?.type === 'emoji' && (
          <div aria-hidden className="mb-2 text-6xl leading-none">
            {record.icon.emoji}
          </div>
        )}
        <h1 data-testid="offline-editor-title" className="mb-2 text-4xl font-bold leading-tight">
          {record.title || '제목 없음'}
        </h1>
        <p role="status" data-testid="offline-editor-status" className="mb-6 text-xs text-neutral-500">
          {phase.kind === 'opening' && '여는 중…'}
          {phase.kind === 'failed' && '이 페이지를 열지 못했습니다.'}
          {phase.kind === 'ready' &&
            (phase.durable
              ? '고친 내용은 이 기기에 저장됩니다 — 다시 연결되어 앱을 열면 보냅니다.'
              : '이 브라우저에서는 고친 내용을 저장할 수 없습니다 — 탭을 닫으면 사라집니다.')}
        </p>
        <div className="relative -ml-16 pl-16">
          <div ref={mountRef} />
        </div>
      </div>
    </div>
  )
}
