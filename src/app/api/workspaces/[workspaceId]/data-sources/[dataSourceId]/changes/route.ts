/**
 * 표가 바뀌었다는 알림 — GET `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/changes` (SSE · 2k-1조각 · F-04-24)
 *
 * 정본: 00-canonical-data-model.md §3.7 런타임 구독 레지스트리("구독 시점 권한검사 + 권한 회수 시 서버 강제 unsubscribe") ·
 *       판결 X-5 · [보강] X-5 의 단계(0단계 — post-image 를 유예한다) / 04-database-views.md F-04-24 *"'변경 있음, 재조회하라' 형태의 얇은 알림"*
 *
 * 보고 있는 뷰가 이것을 연다(`EventSource`). 무엇이 바뀌었는지는 보내지 않는다 — **"바뀌었다"만** 보내고 받는 쪽이 다시 읽는다(다시
 * 읽는 길이 권한 · 필터를 본다). 그래서 이 연결로는 볼 수 없는 것이 새지 않는다 — 새는 것은 "그 표가 바뀌었다"는 사실 하나이고, 그것도
 * 그 표를 볼 수 있는 사람에게만 간다.
 *
 *   event: ready     구독했다
 *   event: changed   그 표의 행 · 속성 · 뷰가 바뀌었다(250ms 모아서 한 번 — 일괄 편집이 신호를 여러 번 보내도 한 번 다시 읽는다)
 *   event: revoked   더 볼 수 없다 — 닫는다(다시 붙지 마라)
 *   event: reconnect 세션이 바뀌었다 — 닫는다(다시 붙으면 다시 확인한다)
 *   : ping           25초마다 — 중간 장치가 조용한 연결을 끊지 않게
 *
 * 표를 볼 수 없으면 404 다(존재를 알리지 않는다).
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { withReadTransaction } from '@/lib/db/tx'
import { canViewDataSource } from '@/lib/database/relation'
import { subscribeRows } from '@/lib/database/row-feed'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/changes'>

/** 신호를 모으는 시간 — 04 *"뷰 단위 코얼레싱 + 디바운스(100~300ms)"*. */
const COALESCE_MS = 250
const HEARTBEAT_MS = 25_000

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })
  const sessionCtx = session.ctx
  const canView = () => withReadTransaction((tx) => canViewDataSource(tx, sessionCtx, dataSourceId))
  if (!(await canView())) return Response.json({ error: 'not_found' }, { status: 404 })

  const encoder = new TextEncoder()
  let stop: () => void = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let coalesce: ReturnType<typeof setTimeout> | null = null
      let unsubscribe: (() => void) | null = null
      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)
      const close = () => {
        if (closed) return
        closed = true
        if (coalesce !== null) clearTimeout(coalesce)
        clearInterval(heartbeat)
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          // 이미 닫혔다(받는 쪽이 끊었다)
        }
      }
      stop = close
      request.signal.addEventListener('abort', close)

      try {
        unsubscribe = await subscribeRows({
          dataSourceId,
          workspaceId: sessionCtx.workspaceId,
          userId: sessionCtx.userId,
          onChanged() {
            if (coalesce !== null) return
            coalesce = setTimeout(() => {
              coalesce = null
              send('changed', { dataSourceId })
            }, COALESCE_MS)
          },
          onAccess() {
            // 권한이 바뀌었을 수 있다 — 다시 본다. 잃었으면 닫는다(정본 §3.7 "권한 회수 시 서버 강제 unsubscribe").
            void canView().then(
              (still) => {
                if (!still) {
                  send('revoked', {})
                  close()
                }
              },
              () => undefined,
            )
          },
          onSession() {
            // 세션이 바뀌었다 — 이 연결이 붙을 때 확인한 세션이 끝났을 수 있다. 닫고 다시 붙게 한다(붙을 때 다시 확인한다).
            send('reconnect', {})
            close()
          },
        })
      } catch {
        // 신호에 붙지 못했다 — 알림 없이 열어 두면 화면이 "실시간"이라고 믿는다. 닫아서 받는 쪽이 다시 붙게 한다.
        send('reconnect', {})
        close()
        return
      }
      if (closed) {
        unsubscribe()
        return
      }
      send('ready', { dataSourceId })
    },
    cancel() {
      stop()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
