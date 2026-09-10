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

import { spawn, spawnSync } from 'node:child_process'
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

// ── WSL 세션 유지 ─────────────────────────────────────────────────────
//
// **왜 필요한가**
//
// WSL2 는 **살아 있는 WSL 세션이 하나도 없으면 유틸리티 VM 을 내린다.**
// `docker compose up` 은 명령이 끝나면 세션도 닫히므로, 1~2분 뒤 VM 이 내려가고
// Postgres·Valkey 가 같이 멈춘다. 그러면 앱은 `ECONNREFUSED 127.0.0.1:5432`
// 를 맞는다 (이 오류는 `message` 가 비어 있고 `code` 에만 정보가 있다).
//
// 헷갈리기 쉬운 점: `docker compose ps` 로 상태를 물어보는 **그 명령이 VM 을
// 되살린다.** 그래서 확인해 보면 늘 "방금 뜬" 컨테이너가 보이고, 정작 사용자가
// 앱을 열 때는 죽어 있다. 이 프로젝트에서 실제로 이 착시에 여러 번 걸렸다.
//
// **왜 .wslconfig 가 아닌가**
//
// `vmIdleTimeout=-1` 은 WSL 2.7.13 에서 동작하지 않는 것을 확인했다
// (`[wsl2]`·`[experimental]` 양쪽 다 시도). 그건 타임아웃 값을 바꾸려는
// 접근이고, 여기서는 **타임아웃 조건 자체("세션이 없다")를 성립하지 않게** 한다.
//
// **끄고 싶으면** `WSL_KEEPALIVE=0`.

const KEEPALIVE_MARKER = 'notion-clone-wsl-keepalive'

/**
 * `pgrep`/`pkill` 이 자기 자신을 잡지 않게 하는 관용구.
 *
 * `[n]otion-…` 은 정규식으로는 `notion-…` 과 같지만, 이 명령의 커맨드라인에
 * 들어가는 문자열은 `[n]otion-…` 이라 패턴과 일치하지 않는다. 이게 없으면
 * 탐지 명령이 항상 "실행 중"이라고 답하고, 종료 명령은 자기를 죽인다.
 */
const KEEPALIVE_PATTERN = `[${KEEPALIVE_MARKER[0]}]${KEEPALIVE_MARKER.slice(1)}`

const keepaliveEnabled = () => process.platform === 'win32' && process.env.WSL_KEEPALIVE !== '0'

/** WSL 안에서 짧은 명령 하나를 돌린다. 출력은 버린다. */
function wslQuiet(inner) {
  return spawnSync('wsl', ['-d', WSL_DISTRO, '-e', 'bash', '-lc', inner], { stdio: 'ignore' })
}

function keepaliveRunning() {
  return wslQuiet(`pgrep -f ${shQuote(KEEPALIVE_PATTERN)} >/dev/null`).status === 0
}

/**
 * 세션 유지 프로세스를 띄운다. 이미 있으면 아무것도 하지 않는다.
 *
 * `detached` + `unref()` 로 이 스크립트가 끝나도 살아남는다. 하는 일은
 * `sleep` 루프뿐이라 CPU 를 쓰지 않는다 — 목적은 **세션의 존재 자체**다.
 * 마커는 커맨드라인의 주석으로 넣는다(`# notion-clone-wsl-keepalive`).
 * 주석도 argv 의 일부라 `pgrep -f` 로 찾을 수 있다.
 */
function ensureKeepalive() {
  if (keepaliveRunning()) return

  const inner = `while :; do sleep 300; done  # ${KEEPALIVE_MARKER}`
  const child = spawn('wsl', ['-d', WSL_DISTRO, '-e', 'bash', '-lc', inner], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()

  console.log(
    'WSL 세션 유지 프로세스를 띄웠습니다 — 유휴 상태에서 DB 가 내려가지 않습니다.\n' +
      '  정리: npm run db:down   ·   끄기: WSL_KEEPALIVE=0',
  )
}

function stopKeepalive() {
  if (process.platform !== 'win32') return
  // 없으면 pkill 이 1 을 돌려주는데 그건 오류가 아니다.
  wslQuiet(`pkill -f ${shQuote(KEEPALIVE_PATTERN)} || true`)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('사용법: node scripts/dc.mjs <docker compose 인자...>')
  process.exit(2)
}

/** `up` / `down` 판정. `-d`, `--wait` 같은 플래그가 앞에 오지는 않는다. */
const subcommand = args.find((a) => !a.startsWith('-'))

let result

if (process.platform === 'win32') {
  const cwd = toWslPath(process.cwd())
  const inner = `cd ${shQuote(cwd)} && docker compose ${args.map(shQuote).join(' ')}`

  // 컨테이너를 띄우기 **전에** 세션을 잡는다. 나중에 잡으면 그 사이에
  // VM 이 내려갈 수 있고, 그러면 방금 띄운 컨테이너가 같이 죽는다.
  if (subcommand === 'up' && keepaliveEnabled()) ensureKeepalive()

  result = spawnSync('wsl', ['-d', WSL_DISTRO, '-e', 'bash', '-lc', inner], { stdio: 'inherit' })

  if (result.error) {
    console.error(`\nWSL 실행 실패: ${result.error.message}`)
    console.error(`배포판 "${WSL_DISTRO}" 이 있는지 확인하세요:  wsl --list --verbose`)
    process.exit(1)
  }

  // `down` 이 끝난 **뒤에** 정리한다. 먼저 죽이면 VM 이 내려가서
  // down 명령 자체가 WSL 을 다시 깨워야 한다.
  if (subcommand === 'down') stopKeepalive()
} else {
  result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit' })
  if (result.error) {
    console.error(`\ndocker 실행 실패: ${result.error.message}`)
    process.exit(1)
  }
}

process.exit(result.status ?? 1)
