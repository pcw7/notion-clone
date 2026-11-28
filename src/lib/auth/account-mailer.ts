/**
 * 계정 알림 메일 — 주소를 더했다 · 뺐다 · 대표를 바꿨다 · 이미 다른 계정의 주소다 (AC-1 · F-14-07 · F-14-15) · 새 기기에서 로그인했다 (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ③ ⑧ ⑭ [AC-3]
 *
 * 로그인 코드(`mailer.ts`)와 **큐를 분리**한다 — 알림이 밀려도 로그인 코드는 늦지 않아야 한다(F-14-02 의 원칙 · 초대 메일과 같은 자리).
 * 유료 발송기에 기대지 않는다. 지금은 개발용 콘솔뿐이다(실제 발송기는 배포 준비 때 — 이 함수의 모양은 그대로).
 *
 * 알림은 **명령을 되돌리지 않는다** — 보내지 못하면 로그에 남기고 넘어간다(이미 일어난 일을 알리는 것이다). 코드 메일과 다르다.
 * 시험은 진짜 메일을 보내지 않는다 — 콘솔 transport 가 보낸 것을 이 프로세스 안의 작은 보낸편지함(`consoleOutbox`)에도 남긴다.
 * 콘솔 문구에 "코드"를 쓰지 않는다(e2e 가 `코드 :` 로 로그인 코드를 읽는다).
 */

export type AccountNoticeKind =
  /** 별칭을 더했다 — 대표 주소로 */
  | 'email_added'
  /** 별칭을 뺐다 — 대표 주소로 */
  | 'email_removed'
  /** 대표를 바꿨다 — **옛** 대표 주소로 */
  | 'email_primary_changed'
  /** 다른 계정의 주소를 더하려 했다 — 그 주소로(그 메일함의 주인만 안다 · 열거 방지) */
  | 'email_taken'
  /** 처음 보는 기기에서 로그인했다 — 대표 주소로(AC-3 · "내가 아니에요" 링크) */
  | 'new_device_login'

export type AccountNotice =
  | {
      readonly to: string
      readonly kind: Exclude<AccountNoticeKind, 'new_device_login'>
      /** 알림이 말하는 주소(더한 · 뺀 · 새 대표 · 더하려던 주소). */
      readonly address: string
    }
  | {
      readonly to: string
      readonly kind: 'new_device_login'
      /** 기기 이름("Chrome · Windows" — `deviceLabel`). */
      readonly device: string
      /** 대략 위치(`placeLabel` — 가린 IP) — 모르면 null. 온전한 IP 를 싣지 않는다. */
      readonly place: string | null
      /** 로그인한 때(ISO). */
      readonly at: string
      /** "내가 아니에요" 화면의 주소 — 서명을 만들지 못했으면 null(알림은 그래도 간다). */
      readonly reportUrl: string | null
    }

/** 알림 메일의 시각 — 받는 사람의 시간대를 모르므로 UTC 로 적는다. */
const noticeTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

/** 알림의 본문 — 화면과 같은 말투 · 개발 콘솔이 그대로 찍는다. */
export function accountNoticeText(notice: AccountNotice): string {
  switch (notice.kind) {
    case 'new_device_login':
      return [
        `처음 보는 기기에서 계정에 로그인했습니다 — ${notice.device}${notice.place === null ? '' : ` · ${notice.place}`} · ${noticeTime(notice.at)}.`,
        '본인이라면 아무것도 하지 않아도 됩니다.',
        notice.reportUrl === null
          ? '본인이 아니면 바로 로그인해 설정 → 보안에서 다른 모든 기기에서 로그아웃하고 비밀번호를 바꾸세요.'
          : `본인이 아니면 이 링크에서 모든 기기를 로그아웃시키고 비밀번호를 바꾸세요(7일 · 한 번) — 내가 아니에요 : ${notice.reportUrl}`,
      ].join(' ')
    case 'email_added':
      return `계정에 새 이메일 주소 ${notice.address} 를 더했습니다. 본인이 한 일이 아니면 바로 로그인해 그 주소를 빼고 비밀번호를 바꾸세요.`
    case 'email_removed':
      return `계정에서 이메일 주소 ${notice.address} 를 뺐습니다. 이제 그 주소로는 이 계정에 들어올 수 없습니다.`
    case 'email_primary_changed':
      return `계정의 대표 이메일 주소가 ${notice.address} 로 바뀌었습니다. 본인이 한 일이 아니면 바로 로그인해 대표 주소를 되돌리세요.`
    case 'email_taken':
      return `누군가 이 주소(${notice.address})를 다른 계정에 더하려 했습니다. 이 주소는 이미 계정에 연결되어 있어 더하지 않았습니다. 본인이 한 일이 아니면 무시해도 됩니다.`
  }
}

function transport(): 'console' | 'none' {
  const t = process.env.MAIL_TRANSPORT
  if (t === 'console') return 'console'
  if (t) throw new Error(`알 수 없는 MAIL_TRANSPORT: ${t} (현재 지원: console)`)
  return process.env.NODE_ENV === 'production' ? 'none' : 'console'
}

const OUTBOX_LIMIT = 100
const outbox: AccountNotice[] = []

/** 콘솔 transport 가 이 프로세스에서 보낸 알림(최근 100개) — 시험이 읽는다. 운영 transport 는 남기지 않는다. */
export function consoleOutbox(): readonly AccountNotice[] {
  return outbox
}

/** 알림을 보낸다. 실패해도 던지지 않는다 — 명령은 이미 끝났다(정본 ⑧). */
export async function sendAccountNotice(notice: AccountNotice): Promise<void> {
  try {
    switch (transport()) {
      case 'console':
        console.info(
          [
            '',
            '  ┌─────────────────────────────────────────────',
            '  │  계정 알림 (개발 전용 — 메일 발송 안 함)',
            `  │  받는 사람 : ${notice.to}`,
            `  │  종류      : ${notice.kind}`,
            `  │  내용      : ${accountNoticeText(notice)}`,
            '  └─────────────────────────────────────────────',
            '',
          ].join('\n'),
        )
        outbox.push(notice)
        if (outbox.length > OUTBOX_LIMIT) outbox.splice(0, outbox.length - OUTBOX_LIMIT)
        return
      case 'none':
        throw new Error('메일 발송기가 설정되지 않았습니다. 운영 환경에서는 MAIL_TRANSPORT 를 반드시 지정하세요.')
    }
  } catch (e) {
    console.error('[account-mailer] 계정 알림을 보내지 못했다:', notice.kind, (e as Error).message)
  }
}
