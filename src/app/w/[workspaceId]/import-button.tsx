'use client'

/**
 * 사이드바의 "가져오기" 단추(BD-2 — `import-dialog.tsx` 에서 떼어 냈다). 창은 누른 뒤에야 받는다 · 단추에 올리거나 포커스하면 미리 받는다.
 */

import dynamic from 'next/dynamic'
import { useCallback, useState } from 'react'
import { Import } from 'lucide-react'

import { SIDEBAR_ICON, SIDEBAR_ICON_STROKE, SIDEBAR_ROW } from './sidebar-style'

const ImportDialog = dynamic(() => import('./import-dialog').then((m) => m.ImportDialog))
const prefetchDialog = (): void => {
  void import('./import-dialog').catch(() => undefined)
}

export function ImportButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button
        type="button"
        data-testid="sidebar-import"
        onClick={() => setOpen(true)}
        onPointerEnter={prefetchDialog}
        onFocus={prefetchDialog}
        className={SIDEBAR_ROW}
      >
        <Import aria-hidden className={SIDEBAR_ICON} strokeWidth={SIDEBAR_ICON_STROKE} />
        <span>가져오기</span>
      </button>

      {open && <ImportDialog workspaceId={workspaceId} onClose={close} />}
    </>
  )
}
