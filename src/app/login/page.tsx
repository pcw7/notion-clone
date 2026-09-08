'use client'

/**
 * 로그인 · 가입 화면 — F-14-01 / F-14-02
 *
 * **로그인과 가입을 구분하지 않는다.** 문구도 흐름도 같다. 구분하는 순간
 * 계정 존재 여부가 화면에 드러난다(F-14-01 시나리오 2).
 *
 * 코드 입력은 6칸 분할이다:
 *   - 붙여넣기 시 자동 분배
 *   - 6자리가 차면 자동 제출
 *   - autocomplete="one-time-code" 로 iOS/Android 자동 채움
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60

type Step = 'email' | 'code'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const inputsRef = useRef<Array<HTMLInputElement | null>>([])
  const submittedFor = useRef<string>('')

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function requestCode(resend = false) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (res.status === 429) {
        setError(`요청이 너무 잦습니다. ${data.retryAfterSeconds}초 후 다시 시도해주세요.`)
        return
      }
      if (!res.ok) {
        setError('이메일 주소를 확인해주세요.')
        return
      }

      setStep('code')
      setCooldown(RESEND_COOLDOWN_SECONDS)
      setDigits(Array(CODE_LENGTH).fill(''))
      submittedFor.current = ''

      // 개발 환경에서만 내려온다. 메일함을 열지 않고 테스트할 수 있게.
      setNotice(
        data.devCode
          ? `개발 모드 — 코드: ${data.devCode}`
          : resend
            ? '코드를 다시 보냈습니다.'
            : null,
      )
      if (data.devCode) {
        setDigits(String(data.devCode).split(''))
      }
      setTimeout(() => inputsRef.current[0]?.focus(), 0)
    } catch {
      setError('연결에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  const submitCode = useCallback(
    async (code: string) => {
      if (submittedFor.current === code) return
      submittedFor.current = code

      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/auth/verify-code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, code }),
        })
        const data = await res.json()

        if (res.ok) {
          router.push('/')
          router.refresh()
          return
        }

        // 만료와 오입력에 다른 안내를 준다 — 같으면 무한 재시도하게 된다.
        setError(
          data.error === 'expired'
            ? '코드가 만료되었습니다. 다시 받아주세요.'
            : data.error === 'too_many_attempts'
              ? '시도 횟수를 초과했습니다. 코드를 다시 받아주세요.'
              : '코드가 올바르지 않습니다.',
        )
        setDigits(Array(CODE_LENGTH).fill(''))
        submittedFor.current = ''
        inputsRef.current[0]?.focus()
      } catch {
        setError('연결에 실패했습니다.')
        submittedFor.current = ''
      } finally {
        setBusy(false)
      }
    },
    [email, router],
  )

  /**
   * 6자리가 채워지면 자동 제출한다.
   *
   * `useEffect` 로 digits 를 감시하지 않는다 — effect 안에서 setState 를 부르는
   * 패턴이라 `react-hooks/set-state-in-effect` 에 걸리고, 실제로도 렌더 사이클과
   * 얽혀 이중 제출이 나기 쉽다. 입력이 일어난 그 자리에서 판단한다.
   */
  function commit(next: string[]) {
    setDigits(next)
    const code = next.join('')
    if (code.length === CODE_LENGTH && /^\d{6}$/.test(code) && !busy) {
      void submitCode(code)
    }
  }

  function setDigitAt(index: number, value: string) {
    const next = [...digits]
    next[index] = value
    commit(next)
  }

  function handleDigitChange(index: number, raw: string) {
    const only = raw.replace(/\D/g, '')
    if (only.length === 0) {
      setDigitAt(index, '')
      return
    }
    // 여러 자리가 한 번에 들어오면(붙여넣기·자동채움) 뒤 칸으로 분배한다
    if (only.length > 1) {
      const next = [...digits]
      for (let i = 0; i < only.length && index + i < CODE_LENGTH; i++) {
        next[index + i] = only[i]
      }
      commit(next)
      const last = Math.min(index + only.length, CODE_LENGTH - 1)
      inputsRef.current[last]?.focus()
      return
    }
    setDigitAt(index, only)
    if (index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus()
  }

  function handleDigitKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && digits[index] === '' && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) inputsRef.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">notion-clone</h1>
      <p className="mt-2 text-sm text-neutral-500">
        {step === 'email'
          ? '이메일로 계속하기'
          : `${email} 으로 6자리 코드를 보냈습니다.`}
      </p>

      {step === 'email' ? (
        <form
          className="mt-8 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void requestCode()
          }}
        >
          <label htmlFor="email" className="text-sm font-medium">
            이메일
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
          />
          <button
            type="submit"
            disabled={busy || email.trim().length === 0}
            className="mt-2 rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? '보내는 중…' : '계속하기'}
          </button>
        </form>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          <div className="flex justify-between gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el
                }}
                inputMode="numeric"
                // 첫 칸에만 붙이면 iOS/Android 가 6자리를 한 번에 채워준다
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={CODE_LENGTH}
                value={d}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleDigitKeyDown(i, e)}
                aria-label={`코드 ${i + 1}번째 자리`}
                className="h-14 w-12 rounded-md border border-neutral-300 text-center text-xl outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
              />
            ))}
          </div>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setError(null)
                setNotice(null)
              }}
              className="text-neutral-500 underline underline-offset-4"
            >
              이메일 변경
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || busy}
              onClick={() => void requestCode(true)}
              className="text-neutral-500 underline underline-offset-4 disabled:no-underline disabled:opacity-40"
            >
              {cooldown > 0 ? `재발송 (${cooldown}초)` : '코드 재발송'}
            </button>
          </div>

          <p className="text-xs text-neutral-400">
            메일이 보이지 않으면 스팸함을 확인해주세요.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && <p className="mt-4 text-sm text-neutral-500">{notice}</p>}
    </main>
  )
}
