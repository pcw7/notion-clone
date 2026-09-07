#!/usr/bin/env node
/**
 * docker compose 래퍼.
 *
 *   node scripts/dc.mjs up -d --wait
 *   node scripts/dc.mjs ps
 *
 * Windows 에서는 WSL(Ubuntu) 안의 Docker Engine 으로 넘긴다.
 *
 * 왜 Windows 의 docker CLI 를 직접 쓰지 않는가:
 * Rancher Desktop 1.24.0 + WSL 2.7.13 조합에서 Win32 socket proxy 가
 * 크래시-재시작 루프를 돌아 docker 명령이 기동 40~50초 후 죽는다
 * ("timed out dialing Hyper-V socket"). 컨테이너와 포트 포워딩은 멀쩡하므로
 * Windows↔WSL 제어 브리지만 우회하면 된다. 자세한 경위는 CLAUDE.md.
 *
 * Linux / macOS 에서는 docker 를 그대로 호출한다.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const WSL_DISTRO = process.env.WSL_DISTRO ?? 'Ubuntu'

/** C:\a\b  ->  /mnt/c/a/b */
function toWslPath(winPath) {
  const abs = resolve(winPath)
  const m = abs.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!m) throw new Error(`WSL 경로로 변환할 수 없습니다: ${abs}`)
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

/** 쉘에 넘길 인자를 작은따옴표로 감싼다. */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('사용법: node scripts/dc.mjs <docker compose 인자...>')
  process.exit(2)
}

let result

if (process.platform === 'win32') {
  const cwd = toWslPath(process.cwd())
  const inner = `cd ${shQuote(cwd)} && docker compose ${args.map(shQuote).join(' ')}`

  result = spawnSync('wsl', ['-d', WSL_DISTRO, '-e', 'bash', '-lc', inner], { stdio: 'inherit' })

  if (result.error) {
    console.error(`\nWSL 실행 실패: ${result.error.message}`)
    console.error(`배포판 "${WSL_DISTRO}" 이 있는지 확인하세요:  wsl --list --verbose`)
    process.exit(1)
  }
} else {
  result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit' })
  if (result.error) {
    console.error(`\ndocker 실행 실패: ${result.error.message}`)
    process.exit(1)
  }
}

process.exit(result.status ?? 1)
