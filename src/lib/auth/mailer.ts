/**
 * 트랜잭션 메일 발송기.
 *
 * 정본 F-14-02 의존 기능:
 *   "트랜잭션 메일 발송 인프라(11 F-11-11의 이메일 채널과 **동일한 발송기를 쓰되
 *    큐를 분리**해야 한다 — 알림 폭주가 로그인 코드를 지연시키면 로그인 불가
 *    장애가 된다)."
 *
 * 그래서 이 모듈은 처음부터 **로그인 코드 전용 경로**로 만든다. 나중에 알림
 * 메일이 생겨도 같은 큐에 태우지 않는다.
 *
 * 지금은 개발용 콘솔 출력만 있다. 정본 F-14-02 의 "클론 시 현실적 대안":
 *   "개발 환경에서는 메일 발송 대신 코드를 서버 로그에 출력하는 스위치를 두는
 *    것이 실용적이다."
 *
 * 실제 발송기(SMTP/API)는 배포 준비 시점에 붙인다. 그때도 이 함수의 시그니처는
 * 바뀌지 않아야 한다.
 */

export type LoginCodeMail = {
  readonly to: string
  readonly code: string
  readonly challengeId: string
}

/** MAIL_TRANSPORT=console 이면 콘솔에 출력하고 코드를 돌려준다(개발 전용). */
function transport(): 'console' | 'none' {
  const t = process.env.MAIL_TRANSPORT
  if (t === 'console') return 'console'
  if (t) {
    throw new Error(`알 수 없는 MAIL_TRANSPORT: ${t} (현재 지원: console)`)
  }
  // 기본값은 개발 편의를 위해 console. 운영에서는 반드시 실제 발송기를 붙인다.
  return process.env.NODE_ENV === 'production' ? 'none' : 'console'
}

/**
 * 로그인 코드를 보낸다.
 *
 * @returns 개발 transport 일 때만 코드 원문. 운영에서는 절대 반환하지 않는다.
 */
export async function sendLoginCode(mail: LoginCodeMail): Promise<string | undefined> {
  switch (transport()) {
    case 'console': {
      // 개발 환경에서 메일함을 열지 않고 로그인할 수 있게 한다.
      console.info(
        [
          '',
          '  ┌─────────────────────────────────────────────',
          '  │  로그인 코드 (개발 전용 — 메일 발송 안 함)',
          `  │  받는 사람 : ${mail.to}`,
          `  │  코드      : ${mail.code}`,
          `  │  challenge : ${mail.challengeId}`,
          '  └─────────────────────────────────────────────',
          '',
        ].join('\n'),
      )
      return mail.code
    }
    case 'none': {
      // 운영인데 발송기가 없다. 조용히 성공한 척하면 사용자는 영원히 코드를
      // 기다린다. 크게 실패시켜서 배포 전에 잡히게 한다.
      throw new Error(
        '메일 발송기가 설정되지 않았습니다. 운영 환경에서는 MAIL_TRANSPORT 를 반드시 지정하세요.',
      )
    }
  }
}
