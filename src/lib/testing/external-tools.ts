/**
 * 테스트가 쓰는 외부 도구 — 우리가 짜지 않은 구현으로 산출물을 읽어 본다.
 *
 * ZIP · CSV 를 **우리가 짠 읽기 코드로만** 검사하면, 쓰기와 읽기가 같은 오해를 공유해도
 * 검사가 초록이다(Markdown 직렬화기를 micromark 로 렌더해 본 것과 같은 이유, HANDOFF §3.3-60).
 *
 * CI(ubuntu)에는 python3 가 기본으로 있다. 그래서 **CI 에서는 없으면 실패**한다 —
 * DB 테스트의 `REQUIRE_DB` 와 같은 이유다: 조용히 건너뛰기만 하는 검사는 썩는다.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type RunResult = {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** 명령 하나. 없는 명령이면 `status` 가 null 이다(던지지 않는다). */
export function run(command: string, args: readonly string[]): RunResult {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    // Windows 콘솔 기본 인코딩(CP949)으로 한글 파일 이름을 찍다가 죽지 않게 한다.
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

let python: string | null | undefined

/** 쓸 수 있는 파이썬 명령. Windows 의 `python3` 는 스토어로 보내는 껍데기일 수 있어 실제로 import 해 본다. */
export function findPython(): string | null {
  if (python !== undefined) return python
  python = null
  for (const candidate of ['python3', 'python']) {
    if (run(candidate, ['-c', 'import zipfile, csv, json, hashlib']).status === 0) {
      python = candidate
      break
    }
  }
  return python
}

/** libarchive 의 tar. GNU tar 는 ZIP 을 읽지 못한다. */
export function hasBsdtar(): boolean {
  const result = run('tar', ['--version'])
  return result.status === 0 && result.stdout.includes('bsdtar')
}

export function hasUnzip(): boolean {
  return run('unzip', ['-v']).status === 0
}

/**
 * 도구가 없을 때 테스트가 건너뛸 이유. **CI 면 던진다.**
 *
 * @param requiredInCi CI 이미지에 기본으로 있는 도구만 true 로 둔다(python3). bsdtar 는 ubuntu 에 없다.
 */
export function unavailable(tool: string, requiredInCi: boolean): string {
  const reason = `${tool} 을(를) 찾지 못해 외부 구현 검사를 건너뛴다`
  if (requiredInCi && process.env.CI) throw new Error(`CI 에서는 ${tool} 이(가) 있어야 한다 — ${reason}`)
  return reason
}

/**
 * 파이썬 스크립트를 돌려 표준출력의 JSON 을 읽는다.
 *
 * 스크립트는 파일로 넘긴다 — 여러 줄 스크립트를 인자로 넘기면 플랫폼마다 따옴표 처리가 다르다.
 */
export function runPythonJson(pythonCommand: string, script: string, args: readonly string[]): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'py-'))
  try {
    const file = join(dir, 'script.py')
    writeFileSync(file, script, 'utf8')
    const result = run(pythonCommand, [file, ...args])
    if (result.status !== 0) {
      throw new Error(`파이썬이 실패했다(${result.status}): ${result.stderr}`)
    }
    return JSON.parse(result.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
