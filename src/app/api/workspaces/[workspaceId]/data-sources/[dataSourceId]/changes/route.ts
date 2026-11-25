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
 *   event: ready     구독했다 — `{ dataSourceId, cursor }`. 화면이 서버에서 읽은 뒤 이 구독이 붙기 전에 이 표가 바뀌었으면 곧바로
 *                    `changed` 가 따른다(구독이 붙기 전의 틈 · #250). 판정은 주소의 `?after=`(서버 화면이 읽기 전에 받은 커서 · RT-1)가
 *                    있으면 변경 기록으로(`changedSinceCursor` — DB 의 xid 하나라 서버가 여럿이어도 · 다시 떠도 같다), 없으면 옛 길
 *                    `?since=`(읽기 전의 시각 ms · 이 프로세스의 기억 — `rowsChangedSince`)
 *   event: changed   그 표의 행 · 속성 · 뷰가 바뀌었다(250ms 모아서 한 번 — 일괄 편집이 신호를 여러 번 보내도 한 번 다시 읽는다) —
 *                    `{ dataSourceId, cursor }`
 *   event: personal  **이 사람의** 이 표 뷰 개인 필터 · 정렬이 바뀌었다(RT-3 · 0154) — `{ dataSourceId, viewId, origin }`. 이 연결의 사람에게만
 *                    간다(허브가 사람으로 가린다 · 남에게는 신호가 없다). `origin` 은 바꾼 탭 — 그 탭은 버린다. `ready` 에 `personal: true` 가
 *                    실리면 렌더 커서(`?after=`) 뒤로 이미 바뀌었다(구독이 붙기 전의 틈 — `personalChangedSince`)
 *
 *   cursor           변경 기록의 커서(정본 §3.7 [보강] X-5 의 단계 — 1단계 · RT-1). 뜻: "이것을 받은 **뒤에** 시작한 읽기는 이 커서 아래의
 *                    변경을 모두 본다". 처음부터 다시 읽는 화면(옛 화면 · reset)은 다시 읽기 전에 받은 커서부터 델타(`…/changes/delta`)를
 *                    이어 물으면 된다. 커서를 얻지 못하면(DB 가 잠깐 없다) 싣지 않는다 — 신호는 그대로 간다
 *   event: revoked   더 볼 수 없다 — 닫는다(다시 붙지 마라)
 *   event: reconnect 세션이 바뀌었다 — 닫는다(다시 붙으면 다시 확인한다)
 *   : ping           25초마다 — 중간 장치가 조용한 연결을 끊지 않게
 *
 * 표를 열 수 없으면 404 다(존재를 알리지 않는다). "만들기만"(6f-2b-2 — 자기가 열 수 있는 행만 본다)도 연다 — 알림은 "바뀌었다" 뿐이고,
 * 다시 읽는 길(`queryRows` 등)이 그 사람의 행 술어를 건다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { withReadTransaction } from '@/lib/db/tx'
import { rowsAccessForDataSource } from '@/lib/database/row-access'
import { rowsChangedSince, subscribeRows } from '@/lib/database/row-feed'
import { changedSinceCursor, currentChangeCursor, decodeChangeCursor, personalChangedSince, recentChangeCursor } from '@/lib/database/change-log'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/changes'>

/** 신호를 모으는 시간 — 04 *"뷰 단위 코얼레싱 + 디바운스(100~300ms)"*. */
const COALESCE_MS = 250
const HEARTBEAT_MS = 25_000

/** `?since=` — 0 이상의 정수(ms)만. 아니면 없는 것으로 본다(옛 화면 · 손으로 연 주소). */
function sinceOf(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('since')
  return raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : null
}

/** 커서를 얻지 못하면 싣지 않는다 — 신호가 커서보다 중요하다(머리말). */
const cursorOrNull = (cursor: Promise<string>): Promise<string | null> => cursor.catch(() => null)

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })
  const sessionCtx = session.ctx
  const since = sinceOf(request)
  const after = decodeChangeCursor(new URL(request.url).searchParams.get('after'))
  const canView = () => withReadTransaction(async (tx) => (await rowsAccessForDataSource(tx, sessionCtx, dataSourceId)) !== null)
  if (!(await canView())) return Response.json({ error: 'not_found' }, { status: 404 })

  const encoder = new TextEncoder()
  let stop: () => void = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let coalesce: ReturnType<typeof setTimeout> | null = null
      let unsubscribe: (() => void) | null = null
      // `ready` 를 보낸 뒤에 열린다 — 구독이 붙은 뒤 `ready` 를 보내기까지(틈 판정 · 커서) 온 신호의 `changed` 가 앞지르지 않게
      let openReadyGate: () => void = () => undefined
      const readyGate = new Promise<void>((resolve) => (openReadyGate = resolve))
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
              // 커서는 지금의 것(최근 것을 나눠 쓴다 — 오래된 커서도 안전하다 · `recentChangeCursor`). `ready` 보다 먼저 가지 않는다
              void Promise.all([readyGate, cursorOrNull(recentChangeCursor())]).then(([, cursor]) =>
                send('changed', { dataSourceId, ...(cursor === null ? {} : { cursor }) }),
              )
            }, COALESCE_MS)
          },
          onPersonal(viewId, origin) {
            // 내 개인 설정(RT-3) — 모으지 않는다(드물다 · 뷰마다 다르다). `ready` 보다 먼저 가지 않는다
            void readyGate.then(() => send('personal', { dataSourceId, viewId, origin }))
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
      // 화면이 읽은 뒤 · 이 구독이 붙기 전에 바뀌었나(머리말) — 구독을 붙인 **뒤에** 묻는다(그 뒤의 커밋은 위의 구독이 신호로 받는다).
      // 커서가 있으면 변경 기록으로, 없으면 옛 길(이 프로세스의 기억). 기록을 묻지 못하면 바뀐 것으로 친다(거짓 양성은 허용한다)
      const [missed, cursor, personal] = await Promise.all([
        after !== null
          ? changedSinceCursor(dataSourceId, after).catch(() => true)
          : Promise.resolve(since !== null && rowsChangedSince(dataSourceId, since)),
        cursorOrNull(currentChangeCursor()),
        // 내 개인 설정도 렌더 뒤로 바뀌었나(RT-3) — 커서가 있을 때만(옛 화면은 묻지 않는다) · 묻지 못하면 모른 척한다(다음 신호 · 델타가 메운다)
        after !== null ? personalChangedSince(dataSourceId, sessionCtx.userId, after).catch(() => false) : Promise.resolve(false),
      ])
      if (closed) return
      const withCursor = cursor === null ? {} : { cursor }
      send('ready', { dataSourceId, ...withCursor, ...(personal ? { personal: true } : {}) })
      if (missed) send('changed', { dataSourceId, ...withCursor })
      openReadyGate()
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
