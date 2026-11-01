'use client'

/**
 * 상단 바의 접속자 줄(AW-1 · F-05-03) — 지금 이 페이지에 있는 다른 사람들의 아바타. 다섯을 넘으면 "+N" 으로 접는다(인원 상한이 없다 —
 * F-05-03). 누르면 그 사람이 있는 블록으로 간다(자리가 없으면 — 페이지만 보고 있으면 — 단추가 아니라 표시만).
 */

import { presenceInitial, type PresencePeer } from '@/lib/collab/presence'

/** 펼쳐 보이는 아바타의 수. */
export const PRESENCE_VISIBLE = 5

export function PresenceStack({ peers, onJump }: { peers: readonly PresencePeer[]; onJump: (peer: PresencePeer) => void }) {
  if (peers.length === 0) return null
  const shown = peers.slice(0, PRESENCE_VISIBLE)
  const hidden = peers.length - shown.length
  return (
    <div className="flex items-center -space-x-1.5 pr-1" role="group" aria-label={`지금 이 페이지에 ${peers.length}명`} data-testid="presence-stack">
      {shown.map((peer) => (
        <button
          key={peer.userId}
          type="button"
          data-testid="presence-avatar"
          data-user-id={peer.userId}
          data-block-id={peer.blockId ?? undefined}
          title={peer.blockId === null ? `${peer.name} — 이 페이지를 보고 있다` : `${peer.name} — 누르면 그 자리로`}
          aria-label={peer.blockId === null ? `${peer.name}(이 페이지를 보고 있다)` : `${peer.name}이 있는 자리로 가기`}
          disabled={peer.blockId === null}
          onClick={() => onJump(peer)}
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white disabled:cursor-default dark:border-neutral-900"
          style={{ backgroundColor: peer.color }}
        >
          {presenceInitial(peer.name)}
        </button>
      ))}
      {hidden > 0 && (
        <span
          data-testid="presence-more"
          title={peers.slice(PRESENCE_VISIBLE).map((p) => p.name).join(', ')}
          className="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-neutral-200 px-1 text-[11px] font-semibold text-neutral-700 dark:border-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
        >
          +{hidden}
        </span>
      )}
    </div>
  )
}
