/**
 * 워크스페이스 초대 메일.
 *
 * 로그인 코드(auth/mailer.ts)와 **큐를 분리**한다. 정본 F-14-02 가 요구한
 * 원칙이 여기에도 적용된다 — 초대 메일이 밀려도 로그인은 막히면 안 되고,
 * 그 반대도 마찬가지다.
 *
 * 지금은 개발용 콘솔 출력만 있다. 실제 발송기는 배포 준비 시점에 붙인다.
 */

export type WorkspaceInviteMail = {
  readonly to: string
  readonly token: string
  readonly workspaceName: string | null
  readonly appUrl: string
}

function transport(): 'console' | 'none' {
  const t = process.env.MAIL_TRANSPORT
  if (t === 'console') return 'console'
  if (t) throw new Error(`알 수 없는 MAIL_TRANSPORT: ${t} (현재 지원: console)`)
  return process.env.NODE_ENV === 'production' ? 'none' : 'console'
}

export function inviteUrl(appUrl: string, token: string): string {
  return new URL(`/invite/${encodeURIComponent(token)}`, appUrl).toString()
}

/** @returns 개발 transport 일 때만 수락 링크. 운영에서는 반환하지 않는다. */
export async function sendWorkspaceInvite(
  mail: WorkspaceInviteMail,
): Promise<string | undefined> {
  const url = inviteUrl(mail.appUrl, mail.token)

  switch (transport()) {
    case 'console':
      console.info(
        [
          '',
          '  ┌─────────────────────────────────────────────',
          '  │  워크스페이스 초대 (개발 전용 — 메일 발송 안 함)',
          `  │  받는 사람 : ${mail.to}`,
          `  │  워크스페이스: ${mail.workspaceName ?? '(이름 미조회)'}`,
          `  │  수락 링크 : ${url}`,
          '  └─────────────────────────────────────────────',
          '',
        ].join('\n'),
      )
      return url
    case 'none':
      // 조용히 성공한 척하면 초대받은 사람은 영원히 메일을 기다린다.
      throw new Error(
        '메일 발송기가 설정되지 않았습니다. 운영 환경에서는 MAIL_TRANSPORT 를 반드시 지정하세요.',
      )
  }
}
