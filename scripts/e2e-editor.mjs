#!/usr/bin/env node
/**
 * 에디터 실제 브라우저 검증 — `npm run e2e`
 *
 * 헤드리스 테스트(`node --test`)는 ProseMirror 의 모델·커맨드·계획을 검증하지만
 * **브라우저가 하는 일은 못 본다** — DOM 이 없고 MutationObserver 도 없다.
 * 이 스크립트가 없던 동안 브라우저에서만 드러나는 버그 넷이 헤드리스 테스트를
 * 전부 통과한 채 들어가 있었다(#30, 이 스크립트의 첫 실행에서 잡았다):
 *
 *   - 토글을 접어도 자식이 숨겨지지 않았다(W4 부터)
 *   - 접힌 토글을 블록 선택하면 선택이 풀렸다(#27)
 *   - 블록을 다른 블록의 첫 자식으로 옮기면 저장이 UNIQUE 위반으로 실패했다
 *   - Tab 이 하위 페이지 참조 밑으로 들여써서 저장이 거부됐다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 의존성이 없다
 * ──────────────────────────────────────────────────────────────────────
 *
 * Playwright 같은 도구를 넣지 않는다. 이미 깔려 있는 Chromium 계열 브라우저
 * (Edge·Chrome)를 헤드리스로 띄우고, Node 에 내장된 `WebSocket` 으로 Chrome
 * DevTools Protocol 을 직접 부른다. 포인터·키 이벤트는 `Input.dispatch*` 로 보내므로
 * 브라우저 입장에서는 **진짜 입력**이다 — `setPointerCapture` 도 동작한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰는 법
 * ──────────────────────────────────────────────────────────────────────
 *
 *   npm run db:up        # DB 가 떠 있어야 한다
 *   npm run build        # 프로덕션 빌드를 검증한다(HANDOFF §6 — next dev 는 믿지 않는다)
 *   npm run e2e
 *
 * 서버는 이 스크립트가 직접 띄운다 — 앱(기본 3100)과 **협업 서버**(기본 3101)를 함께. 본문 편집은 협업 서버를 거쳐
 * 로그에 쌓이므로(CRDT 6d), 협업 서버가 없으면 편집이 저장되지 않는다. 앱에는 `COLLAB_URL` 로 알려 준다 —
 * `NEXT_PUBLIC_*` 는 빌드할 때 값이 박혀 검사 전용 포트를 쓸 수 없다.
 * 로그인 코드는 콘솔 메일러(`MAIL_TRANSPORT=console`)가 찍은 것을 서버 출력에서
 * 읽는다. 매 실행마다 새 계정·워크스페이스를 만든다.
 *
 * 환경 변수: `E2E_BROWSER`(브라우저 실행 파일 경로), `E2E_PORT`(서버 포트),
 * `E2E_HEADFUL=1`(창을 띄워서 본다).
 *
 * CI 에서는 돌리지 않는다(아직). 러너에 브라우저가 있어도, 이 검증이 안정적으로
 * 초록인지 로컬에서 먼저 쌓아 본 뒤에 넣는다 — 깜빡이는 CI 는 없는 CI 보다 나쁘다.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** `.env` 를 아주 단순하게 읽는다(`migrate.mjs` · `collab-server.mjs` 와 같다). 이미 있는 환경 변수가 이긴다. */
function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}
for (const [key, value] of Object.entries(loadEnv())) process.env[key] ??= value

const { textRun, pageMentionRun, userMentionRun, mentionTarget } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
// 본문 준비 · 확인은 **서버 명령 경로**로 한다(CRDT 6e). 본문 저장 API(PUT)는 걷어냈다 — 편집은 협업 서버로만 간다.
const { resolveSessionContext } = await import(new URL('../src/lib/auth/session-context.ts', import.meta.url).href)
const { savePageBody, loadPageBody } = await import(new URL('../src/lib/block/save-page-body.ts', import.meta.url).href)
const { closePool } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
// 알림은 자기 글에는 오지 않는다 — 인박스를 보려면 동료가 하나 필요하다(코멘트 4조각).
const { createUser, joinAs, visitAsOutsider } = await import(new URL('../src/lib/testing/db-fixtures.ts', import.meta.url).href)
const { createDiscussion } = await import(new URL('../src/lib/comment/discussion.ts', import.meta.url).href)

const PORT = Number(process.env.E2E_PORT ?? 3100)
const COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? 3101)
// 페이지 웹훅의 받는 서버(4e-3) — 앱이 이 host:port 로만 바깥 요청의 검사를 비켜 간다(`OUTBOUND_ALLOW_HOSTS` · net/outbound.ts)
const HOOK_PORT = Number(process.env.E2E_HOOK_PORT ?? 3102)
const BASE = `http://localhost:${PORT}`
const COLLAB_URL = `ws://localhost:${COLLAB_PORT}`
const HEADFUL = process.env.E2E_HEADFUL === '1'

// 응답의 본문은 늘 끝까지 읽는다 — 상태만 보고 버린 화면 응답은 서버의 스트리밍 도중에 연결을 닫을 수 있다(§3.3-276 ⑤). 그런 검사가
// 옛 절에 수십 곳이라 하나씩 `.text()` 를 붙이지 않고 여기서 한 번 — 사본(clone)을 끝까지 읽으면 원래 응답의 본문은 그대로 읽을 수
// 있다. 스트리밍으로 읽는 검사는 이것을 거치면 막힌다 — `rawFetch` 를 쓴다(표 변경 알림 2k-1 의 SSE). 전체 판의 "서버에서 오류"는 이것이 아니라 브라우저가 refresh 도중에 떠난
// 것이었다 — 그것은 `connect` 의 inflight 가 막는다(§3.3-278 ⑥). 이것은 해가 없어 남긴다.
const rawFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  const res = await rawFetch(...args)
  if (res.body !== null) await res.clone().arrayBuffer().catch(() => null)
  return res
}

// ── 결과 ──────────────────────────────────────────────────────────────

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  o' : '  X'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}
/**
 * 골라 돌리기(E2E_ONLY) — 쉼표로 나눈 조각을 **게이트 제목**에 부분 일치시킨다(대소문자 무시).
 *
 *   E2E_ONLY="7c-7" npm run e2e            # 그 절과 늘 도는 것(로그인 · 시드 · [전체])만
 *   E2E_ONLY="보관,개인 페이지" npm run e2e   # 여러 절
 *
 * 반복 루프(개발 · 반사실 빌드)용이다 — **머지 전 마지막 판은 필터 없이 전체를 돌린다**(문서에 적는 숫자도 전체
 * 판의 것이다 · HANDOFF §4). 데이터베이스 안쪽 절들은 우산 게이트('데이터베이스 표 …') 하나로 묶여 있어 그
 * 제목으로 켠다. 게이트 안의 section() 은 제목만 찍는다 — 필터는 sectionIf 가 달린 게이트에만 있다.
 *
 * ⚠ 골라 돌릴 절은 **자기 데이터를 스스로 만들어야** 한다(7a 이후 절들이 그렇다). 앞 절이 만든 것에 기대는 절을
 * 홀로 켜면 깨진다 — 그런 절은 기대는 절과 함께 켠다.
 */
const E2E_ONLY = (process.env.E2E_ONLY ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s !== '')
let gatesRun = 0
let gatesSkipped = 0
// 지금 도는 절 — 서버가 오류(⨯)를 찍은 순간의 절을 함께 적는다(전체 판의 "서버에서 오류"가 어느 절에서 났는지 · §3.3-278 ⑥).
let currentSection = '(준비)'
function sectionIf(title) {
  const on = E2E_ONLY.length === 0 || E2E_ONLY.some((q) => title.toLowerCase().includes(q))
  if (on) {
    gatesRun += 1
    currentSection = title
    console.log(`\n[${title}]`)
  } else {
    gatesSkipped += 1
    console.log(`\n[${title}] — 건너뜀 (E2E_ONLY)`)
  }
  return on
}

function section(title) {
  currentSection = title
  console.log(`\n[${title}]`)
}

// ── 브라우저 찾기 ─────────────────────────────────────────────────────

function findBrowser() {
  if (process.env.E2E_BROWSER) return process.env.E2E_BROWSER
  const env = process.env
  const candidates =
    process.platform === 'win32'
      ? [
          join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap(
            (name) => (env.PATH ?? '').split(delimiter).map((dir) => join(dir, name)),
          )
  return candidates.find((path) => path && existsSync(path)) ?? null
}

// ── 서버 ──────────────────────────────────────────────────────────────

let serverOutput = ''
/** 서버가 찍은 오류(⨯)마다 그때 돌던 절. */
const serverErrorSections = []

function startServer() {
  if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    throw new Error('프로덕션 빌드가 없다. `npm run build` 를 먼저 돌려라.')
  }
  const server = spawn(
    process.execPath,
    [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)],
    {
      cwd: ROOT,
      env: { ...process.env, MAIL_TRANSPORT: 'console', COLLAB_URL, OUTBOUND_ALLOW_HOSTS: `127.0.0.1:${HOOK_PORT}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const collect = (chunk) => {
    const text = chunk.toString('utf8')
    serverOutput += text
    for (const line of text.split('\n')) {
      if (line.includes('⨯')) serverErrorSections.push(`[${currentSection} · 마지막 검사: ${results.at(-1)?.name ?? '-'}] ${line.trim()}`)
    }
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)
  return server
}

/**
 * 협업 서버(F-05-02) — 본문 편집이 여기를 거쳐 로그에 쌓인다.
 *
 * 오프라인 절은 이 프로세스를 **내렸다 올려서** 끊김을 만든다. `Network.setBlockedURLs` 로는 이미 열린 웹소켓이 끊기지
 * 않고, 네트워크를 통째로 끊으면 페이지 자체가 로드되지 않아 새로고침 시나리오를 볼 수 없다.
 */
function startCollabServer() {
  const collab = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(ROOT, 'scripts', 'collab-server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, COLLAB_PORT: String(COLLAB_PORT), NEXT_PUBLIC_APP_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (chunk) => {
    serverOutput += chunk.toString('utf8')
  }
  collab.stdout.on('data', collect)
  collab.stderr.on('data', collect)
  return collab
}

/** 협업 서버가 받을 준비가 됐는가 — 웹소켓이 열리는지로 본다. */
async function waitForCollab() {
  for (let i = 0; i < 150; i += 1) {
    const opened = await new Promise((resolve) => {
      const socket = new WebSocket(COLLAB_URL)
      socket.onopen = () => {
        socket.close()
        resolve(true)
      }
      socket.onerror = () => resolve(false)
    })
    if (opened) return
    await sleep(200)
  }
  throw new Error(`협업 서버가 ${COLLAB_URL} 에서 뜨지 않았다\n${serverOutput.slice(-2000)}`)
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      await fetch(BASE)
      return
    } catch {
      await sleep(200)
    }
  }
  throw new Error(`서버가 ${BASE} 에서 뜨지 않았다\n${serverOutput}`)
}

/** 콘솔 메일러가 찍은 로그인 코드. */
async function loginCodeFor(email) {
  for (let i = 0; i < 100; i += 1) {
    const at = serverOutput.lastIndexOf(email)
    const code = at >= 0 ? serverOutput.slice(at).match(/코드\s*:\s*(\d{6})/)?.[1] : undefined
    if (code) return code
    await sleep(100)
  }
  throw new Error('서버 출력에서 로그인 코드를 찾지 못했다')
}

/** 콘솔 메일러가 찍은 초대 메일의 수락 링크(7g-1) — 운영 모드의 응답에는 개발 링크가 없다. 없으면 null. */
async function inviteLinkFor(email) {
  for (let i = 0; i < 50; i += 1) {
    const at = serverOutput.lastIndexOf(`받는 사람 : ${email}`)
    const link = at >= 0 ? serverOutput.slice(at).match(/수락 링크\s*:\s*(\S+)/)?.[1] : undefined
    if (link) return link
    await sleep(100)
  }
  return null
}

// ── CDP ───────────────────────────────────────────────────────────────

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const pageErrors = []
  // 진행 중인 fetch · XHR(Network 이벤트) — 화면을 옮기기 전(`Page.navigate`)에 끝나기를 기다린다. 저장 뒤의 `router.refresh()` 가 아직
  // 스트리밍 중인데 검사가 곧바로 다른 주소로 가면 서버는 그 렌더를 "The destination stream closed early" 로 끊고 ⨯ 를 찍는다 —
  // 페이지가 쌓여 레이아웃이 느린 전체 판에서만 났다(§3.3-278 ⑥). 사용자는 결과가 그려진 것을 보고 떠나므로 기다리는 쪽이 사용자에 가깝다.
  const inflight = new Set()
  // 열린 SSE(표 변경 알림 · 2k-2) — 이게 열려 있으면 다른 곳의 쓰기가 **조금 뒤에** 이 페이지의 다시 읽기(때로 `router.refresh()`)를
  // 시작한다. 진행 중인 요청만 기다리면 그 뒤에 시작될 것을 놓친다 — 떠나기 전에 요청이 잠시 조용할 때까지 기다린다(아래 `send`).
  const eventStreams = new Set()
  // 붙잡힌 요청(`Fetch.enable` 의 패턴에 걸린 것) — 검사가 놓아 줄 때까지 서버에 닿지 않는다(표 변경 알림의 구독 전 틈 · #250)
  const paused = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Network.requestWillBeSent') {
      if (msg.params.type === 'Fetch' || msg.params.type === 'XHR') inflight.add(msg.params.requestId)
      if (msg.params.type === 'EventSource') eventStreams.add(msg.params.requestId)
    } else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
      inflight.delete(msg.params.requestId)
      eventStreams.delete(msg.params.requestId)
    } else if (msg.method === 'Fetch.requestPaused') {
      paused.push(msg.params.requestId)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      pageErrors.push(d?.exception?.description ?? d?.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  const rawSend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  const send = async (method, params = {}) => {
    // 새로고침도 떠나는 것이다 — 보드의 "+ 카드" 뒤 곧바로 `Page.reload` 하던 검사가 알림이 시작한 `router.refresh()` 를 끊어 ⨯ 를 찍었다
    // (전체 판 #237 · 4c-1). 기다림을 `Page.navigate` 에만 걸어 두었었다.
    if (method === 'Page.navigate' || method === 'Page.reload') {
      for (let waited = 0; inflight.size > 0 && waited < 3000; waited += 50) await sleep(50)
      // 표 변경 알림이 열려 있으면 — 방금의 쓰기가 일으킬 다시 읽기가 시작될 틈(서버가 250ms 모은다)까지 조용하기를 기다린다
      if (eventStreams.size > 0) {
        for (let round = 0; round < 4; round += 1) {
          await sleep(600)
          if (inflight.size === 0) break
          for (let waited = 0; inflight.size > 0 && waited < 3000; waited += 50) await sleep(50)
        }
      }
      inflight.clear()
      eventStreams.clear()
    }
    return rawSend(method, params)
  }
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  // 브라우저가 죽으면 소켓이 닫히고 대기 중인 요청의 응답은 영영 오지 않는다.
  // 그대로 두면 스크립트가 **실패하지 않고 매달린다** — 실제로 10분 넘게 조용히
  // 멈춰 있었다. 닫히는 순간 대기 중인 요청을 전부 실패시켜 어디서 죽었는지 남긴다.
  ws.onclose = () => {
    for (const settle of pending.values()) settle({ error: { message: '브라우저와의 연결이 끊겼다(브라우저가 종료됐다)' } })
    pending.clear()
  }
  /** 붙잡힌 요청을 모두 놓아 준다 — 놓은 수. */
  const releasePaused = async () => {
    const ids = paused.splice(0)
    for (const requestId of ids) await rawSend('Fetch.continueRequest', { requestId }).catch(() => undefined)
    return ids.length
  }
  return { ws, send, opened, pageErrors, releasePaused, pausedCount: () => paused.length }
}

async function launchBrowser(executable) {
  const profile = mkdtempSync(join(tmpdir(), 'nc-e2e-'))
  const browser = spawn(
    executable,
    [
      ...(HEADFUL ? [] : ['--headless=new']),
      // 포트 0: 브라우저가 빈 포트를 골라 프로필 폴더의 DevToolsActivePort 에 적는다.
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let port = null
  for (let i = 0; i < 150 && port === null; i += 1) {
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0])
    if (port === null) await sleep(100)
  }
  if (port === null) throw new Error('브라우저의 DevTools 포트를 알아내지 못했다')

  let target = null
  for (let i = 0; i < 100 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page') ?? null
    } catch {
      /* 아직 안 떴다 */
    }
    if (target === null) await sleep(100)
  }
  if (target === null) throw new Error('브라우저 페이지에 붙지 못했다')

  return { browser, profile, port, url: target.webSocketDebuggerUrl }
}

// ── 본문 ──────────────────────────────────────────────────────────────

async function main() {
  const executable = findBrowser()
  if (!executable) {
    throw new Error('Chromium 계열 브라우저(Edge·Chrome)를 찾지 못했다. E2E_BROWSER 로 경로를 지정하라.')
  }
  console.log(`브라우저: ${executable}`)
  console.log(`서버: ${BASE}`)

  const server = startServer()
  let collab = startCollabServer()
  let browser = null
  let profile = null
  let cdp = null
  const tabs = []

  /** 협업 서버를 내린다 — 끊김을 만드는 유일한 길(위 `startCollabServer`). */
  const stopCollab = async () => {
    if (collab === null) return
    const exited = new Promise((resolve) => collab.on('exit', resolve))
    collab.kill()
    collab = null
    await exited
  }
  const restartCollab = async () => {
    if (collab !== null) return
    collab = startCollabServer()
    await waitForCollab()
  }

  try {
    await waitForServer()
    await waitForCollab()

    // ── API 로 준비: 로그인 → 워크스페이스 → 페이지 → 본문 ──
    const json = { 'content-type': 'application/json', origin: BASE }
    const email = `e2e+${Date.now()}@example.com`
    let res = await fetch(`${BASE}/api/auth/request-code`, { method: 'POST', headers: json, body: JSON.stringify({ email }) })
    if (!res.ok) throw new Error(`request-code ${res.status} — DB 가 떠 있나? (npm run db:up)\n${serverOutput.slice(-2000)}`)
    const code = await loginCodeFor(email)
    res = await fetch(`${BASE}/api/auth/verify-code`, { method: 'POST', headers: json, body: JSON.stringify({ email, code }) })
    if (!res.ok) throw new Error(`verify-code ${res.status}`)
    const session = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('nc_session='))
      ?.split(';')[0]
      .slice('nc_session='.length)
    if (!session) throw new Error('세션 쿠키가 없다')
    const authed = { ...json, cookie: `nc_session=${session}` }

    res = await fetch(`${BASE}/api/workspaces`, { method: 'POST', headers: authed, body: JSON.stringify({ name: 'E2E' }) })
    const { workspaceId } = await res.json()
    // 주 워크스페이스는 Business 다(8k-2) — 여러 절이 private teamspace 를 만들고 게스트를 들인다(Free 의 게이트 밖에서 그 기능을 본다).
    // 게이트 자체는 "요금제 게이트" 절이 자기 Free 워크스페이스에서 본다. 요금제는 명령으로만 바꾼다(8k-1).
    const { setWorkspacePlan } = await import(new URL('../src/lib/billing/plan.ts', import.meta.url).href)
    await setWorkspacePlan(workspaceId, 'business')

    // 본문을 준비하고 확인하는 길 — 명령 경로를 그대로 부른다(앱과 같은 DB).
    const resolved = await resolveSessionContext(session, workspaceId)
    if (!resolved.ok) throw new Error(`세션을 해석하지 못했다: ${resolved.reason}`)
    const ctx = resolved.context
    const saveBody = async (page, doc, options = {}) => {
      const result = await savePageBody(ctx, page, doc, options)
      if (!result.ok) throw new Error(`본문 준비 실패(${result.reason}): ${JSON.stringify(result)}`)
      return result
    }
    const readBody = async (page) => {
      const body = await loadPageBody(ctx, page)
      if (!body) throw new Error(`본문을 읽지 못했다: ${page}`)
      return body
    }
    res = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })
    const pageId = (await res.json()).page.id

    const ids = { A: randomUUID(), B: randomUUID(), C: randomUUID(), T: randomUUID(), t1: randomUUID(), D: randomUUID() }
    const nameOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]))
    const block = (id, type, text, children = []) => ({ id, type, title: [textRun(text)], properties: {}, format: {}, children })
    const doc = {
      blocks: [
        block(ids.A, 'paragraph', 'A'),
        block(ids.B, 'paragraph', 'B'),
        block(ids.C, 'paragraph', 'C'),
        block(ids.T, 'toggle', 'T', [block(ids.t1, 'paragraph', 't1')]),
        block(ids.D, 'paragraph', 'D'),
      ],
    }
    await saveBody(pageId, doc)

    /** 서버에 저장된 구조를 `A | A > a1` 꼴로. */
    const savedShape = async () => {
      const body = await readBody(pageId)
      const out = []
      const walk = (blocks, prefix) => {
        for (const b of blocks) {
          const n = b.title?.[0]?.text?.content ?? '·'
          out.push(prefix + n)
          if (b.children?.length) walk(b.children, `${prefix}${n} > `)
        }
      }
      walk(body.doc.blocks, '')
      return out.join(' | ')
    }
    /** 자동 저장(디바운스 1초)이 끝나기를 기다린다. */
    const settledShape = async (expected) => {
      let shape = ''
      for (let i = 0; i < 40; i += 1) {
        shape = await savedShape()
        if (shape === expected) return shape
        await sleep(150)
      }
      return shape
    }

    // ── 브라우저 ──
    const launched = await launchBrowser(executable)
    browser = launched.browser
    profile = launched.profile
    const devtoolsPort = launched.port
    cdp = connect(launched.url)
    await cdp.opened
    const { send, pageErrors, releasePaused, pausedCount } = cdp

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
      return r.result.value
    }
    const waitFor = async (expression, ms = 5000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await evaluate(expression)) return true
        await sleep(40)
      }
      return false
    }
    const move = (x, y, pressed = false) =>
      send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: pressed ? 'left' : 'none', buttons: pressed ? 1 : 0 })
    const press = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    const release = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    const click = async (x, y) => {
      await move(x, y)
      await press(x, y)
      await release(x, y)
    }
    const KEYS = {
      Escape: [27, 'Escape'],
      Enter: [13, 'Enter'],
      ArrowDown: [40, 'ArrowDown'],
      ArrowRight: [39, 'ArrowRight'],
      End: [35, 'End'],
      '/': [191, 'Slash'],
      c: [67, 'KeyC'],
      v: [86, 'KeyV'],
      // 되돌리기 — 협업 편집기에서는 내 편집만 되돌린다(F-05-15).
      z: [90, 'KeyZ'],
      // W7 검색 오버레이 — `Mod+K` · `Mod+P` 로 열고 ↑↓ 로 고른다.
      k: [75, 'KeyK'],
      p: [80, 'KeyP'],
      ArrowUp: [38, 'ArrowUp'],
      Backspace: [8, 'Backspace'],
      // W8-b 표 그리드 — 칸 이동 · 비우기.
      ArrowLeft: [37, 'ArrowLeft'],
      Tab: [9, 'Tab'],
      Delete: [46, 'Delete'],
      // 인라인 수식(Phase 2 1b) — `Mod+Shift+E`.
      e: [69, 'KeyE'],
      // 마지막 색 다시 쓰기(Phase 2 1e-1) — `Mod+Shift+H`.
      h: [72, 'KeyH'],
    }
    const SHIFT = 8
    // `Mod` 는 Mac 에서 Cmd(4), 그 외 Ctrl(2). 헤드리스 브라우저의 플랫폼을 따른다.
    const MOD = process.platform === 'darwin' ? 4 : 2
    const key = async (name, modifiers = 0) => {
      const [vk, code] = KEYS[name]
      const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    }

    const rect = (selector) =>
      evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)})
        if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    /** 블록 자신의 줄(자식 제외). */
    const line = (id) => rect(`[data-block-id="${id}"] > *:first-child`)
    const order = () =>
      evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')]
        .map((c) => c.firstElementChild.textContent.replace(/[▾▸]/g, '').trim())`)
    const selected = async () =>
      (await evaluate(`[...document.querySelectorAll('.blk-selected')].map((e) => e.getAttribute('data-block-id'))`)).map(
        (id) => nameOf[id] ?? id,
      )
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    /** 이 블록의 핸들을 잡아 (tx, ty) 로 끈다. 놓지 않으면 드래그 중 상태로 돌아온다. */
    const drag = async (id, tx, ty, { drop = true } = {}) => {
      const l = await line(id)
      await move(l.x + 30, l.y + l.h / 2)
      await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
      const g = await rect('.blk-gutter-grip')
      const gx = g.x + g.w / 2
      const gy = g.y + g.h / 2
      await move(gx, gy)
      await press(gx, gy)
      for (let i = 1; i <= 10; i += 1) {
        await move(gx + ((tx - gx) * i) / 10, gy + ((ty - gy) * i) / 10, true)
        await sleep(16)
      }
      if (drop) {
        await release(tx, ty)
        await sleep(80)
      }
    }

    /**
     * 같은 브라우저에 탭을 하나 더 연다 — 두 사람이 같은 페이지를 보는 장면(F-05-01).
     *
     * 쿠키는 프로필 전체가 공유하므로 로그인은 그대로다. 돌려주는 것은 그 탭의 `evaluate` · `waitFor` · 입력이다.
     */
    const openTab = async (url) => {
      const { targetId } = await send('Target.createTarget', { url })
      let info = null
      for (let i = 0; i < 100 && info === null; i += 1) {
        const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()
        info = list.find((t) => t.id === targetId && t.webSocketDebuggerUrl) ?? null
        if (info === null) await sleep(100)
      }
      if (info === null) throw new Error('두 번째 탭에 붙지 못했다')
      const tab = connect(info.webSocketDebuggerUrl)
      await tab.opened
      tabs.push(tab)
      await tab.send('Runtime.enable')
      await tab.send('Page.enable')
      const evaluateIn = async (expression) => {
        const r = await tab.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
        if (r.exceptionDetails) throw new Error(`evaluate(tab): ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
        return r.result.value
      }
      const waitForIn = async (expression, ms = 10000) => {
        const end = Date.now() + ms
        while (Date.now() < end) {
          if (await evaluateIn(expression)) return true
          await sleep(40)
        }
        return false
      }
      return {
        send: tab.send,
        evaluate: evaluateIn,
        waitFor: waitForIn,
        /**
         * 이 탭의 본문 첫 블록 **끝**에 캐럿을 두고 친다.
         *
         * 두 탭이 같은 자리에 치면 글자가 서로 사이에 끼어 든다(CRDT 로서는 맞는 결과다 — 둘 다 남는다). 검사가 보려는 것은
         * "서로 지우지 않는가"이므로 자리를 갈라 친다.
         */
        async typeInBody(text) {
          const box = await evaluateIn(`(() => { const e = document.querySelector('.blk-editor'); const r = e.getBoundingClientRect()
            return { x: r.x + 40, y: r.y + 10 } })()`)
          await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 })
          await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 })
          const end = { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 }
          // ★ 캐럿이 블록 끝에 설 때까지 End 를 누른다. 부하가 있으면 클릭의 선택 동기화가 End 보다 늦게 와서 캐럿을 클릭 자리(글
          //   가운데)로 되돌린다 — 바로 치면 글 가운데에 들어간다("첫째 둘째 탭 탭" · HANDOFF §3.3-327 ④). 사람은 그 틈에 치지 못한다.
          const caretAtEnd = `(() => {
            const s = getSelection()
            if (!s || !s.isCollapsed || !s.focusNode) return false
            const block = (s.focusNode.nodeType === 3 ? s.focusNode.parentElement : s.focusNode)?.closest('.blk')
            if (!block) return false
            const rest = document.createRange()
            rest.setStart(s.focusNode, s.focusOffset)
            rest.setEnd(block, block.childNodes.length)
            return rest.toString().length === 0
          })()`
          for (let i = 0; i < 20; i += 1) {
            await tab.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...end })
            await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', ...end })
            await sleep(50)
            if (await evaluateIn(caretAtEnd)) break
          }
          await tab.send('Input.insertText', { text })
        },
      }
    }

    /**
     * 보존본(IndexedDB) — 서버가 확인하지 않은 편집(`collab/pending-store.ts`).
     *
     * 값은 Yjs update 바이트다. 글자는 그 안에 UTF-8 로 들어 있어 디코딩해 찾는다 — 무엇이 남아 있는지 보려면 그걸로 충분하다.
     */
    const PENDING_ROWS = `(async () => {
      try {
        const db = await new Promise((ok, no) => { const r = indexedDB.open('notion-clone-collab', 1); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
        if (!db.objectStoreNames.contains('pending-edits')) return []
        const rows = await new Promise((ok) => { const r = db.transaction('pending-edits').objectStore('pending-edits').getAll(); r.onsuccess = () => ok(r.result) })
        return rows.map((row) => new TextDecoder().decode(new Uint8Array(row.update)))
      } catch { return [] }
    })()`
    const PENDING_EMPTY = `(async () => (await ${PENDING_ROWS}).length === 0)()`

    await send('Page.enable')
    await send('Runtime.enable')
    // 진행 중인 요청을 세려면 처음부터 받는다(`connect` 의 inflight). 오프라인 절이 다시 켜도 아무 일이 없다.
    await send('Network.enable')
    // 헤드리스는 창에 포커스가 없어서 클립보드 API 가 거부된다. 포커스를 흉내내고 권한을 준다.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
    await send('Network.setCookie', { name: 'nc_session', value: session, domain: 'localhost', path: '/', httpOnly: true })
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })

    // ── 여러 절이 함께 쓰는 도우미 — 게이트(절) 안에 두면 블록 스코프에 갇혀 뒤 절이 못 본다(E2E_ONLY · #127) ──
    /**
     * 볼 수 없는 페이지를 연 답 — 7e-1 부터 404 가 아니라 **접근 요청 화면**이다(이 워크스페이스의 사람이 연 살아 있는 페이지 ·
     * F-06-15). 그 화면에 제목이 없는지도 본다 — 존재만 알린다(정본 §3.3 [보강] 접근 요청 ②).
     */
    const shownNoAccess = async (res, title = null) => {
      if (res.status !== 200) return false
      const html = await res.text()
      return html.includes('data-testid="no-access"') && (title === null || !html.includes(title))
    }
    const typeText = async (text) => {
      await send('Input.insertText', { text })
      await sleep(60)
    }
    const clickText = async (text, selector = 'button') => {
      const box = await evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().includes(${JSON.stringify(text)}))
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      if (!box) return false
      await click(box.x, box.y)
      await sleep(150)
      return true
    }
    const panelText = () => evaluate(`document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '(패널 없음)'`)
    /** 화면에 있는 요소를 셀렉터로 누른다 — aria-label 로 고른다. */
    const clickSelector = async (sel) => {
      const box = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)})
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      if (!box) return false
      await click(box.x, box.y)
      await sleep(120)
      return true
    }
    // 잠금 버튼은 누를 때의 글자대로 잠그거나 푼다(PUT · DELETE — 둘 다 멱등). 붙기 전의 클릭은 사라지므로 될 때까지 다시 누르되,
    // **글자가 바라는 쪽일 때만** 누른다 — 앞선 클릭의 새로고침이 늦게 와 글자가 막 바뀐 뒤에 누르면 거꾸로 돌린다(1c-2 의 전체 e2e
    // 에서 겪었다 — "잠김"이 선 채로 서버는 풀려 있었다).
    const pressLockToggle = async (label, done) => {
      for (let i = 0; i < 10; i += 1) {
        const box = await evaluate(`(() => {
          const el = document.querySelector('[data-testid="page-lock-toggle"]')
          if (!el || el.disabled || el.textContent !== ${JSON.stringify(label)}) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (box) await click(box.x, box.y)
        if (await waitFor(done, 1500)) return true
      }
      return false
    }
    /**
     * 옮길 자리를 누른 뒤 — 미리보기가 한 번 더 물으면(볼 수 있는 사람이 바뀐다 · 7c-13) "옮기기"를 누른다. 묻지 않으면(곧바로
     * 옮겼거나 거부됐으면) 아무것도 하지 않는다. 뿌리를 바꾸는 이동을 누르는 절은 모두 이것을 거친다.
     */
    const confirmMoveIfAsked = async () => {
      await waitFor(`!!document.querySelector('[data-testid="move-preview-confirm"]')
        || !!document.querySelector('[data-testid="move-error"]')
        || !document.querySelector('[data-testid="move-picker"]')`, 10000)
      if (await evaluate(`!!document.querySelector('[data-testid="move-preview-confirm"]')`)) {
        await clickSelector('[data-testid="move-preview-confirm"]')
      }
    }

    // ── 에디터 코어(로드 ~ 두 탭) — 상태를 공유하는 흩어진 절들이라 통째로 게이트다(안의 section 은 제목만 찍는다) ──
    if (sectionIf('에디터 코어 — 로드 · 핸들 · 드래그 · 키보드 이동 · 접힘 · 블록 메뉴 · 복사 · 붙여넣기 · + 버튼 · 이미지 · 오프라인 보존 · 두 탭 동시 편집 (F-01-* · F-05-*)')) {
    section('로드')
    check('에디터가 뜬다', await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length === 6`, 15000))
    check('처음 순서', same(await order(), ['A', 'B', 'C', 'T', 't1', 'D']), JSON.stringify(await order()))

    section('핸들 (F-01-08)')
    const a = await line(ids.A)
    await move(a.x + 30, a.y + a.h / 2)
    check('hover 하면 핸들이 나타난다', await waitFor(`!!document.querySelector('.blk-gutter')`))
    const grip = await rect('.blk-gutter-grip')
    check('핸들은 그 줄 왼쪽 여백에 있다', !!grip && Math.abs(grip.y - a.y) < 8 && grip.x + grip.w <= a.x, JSON.stringify({ grip, a }))
    check('핸들은 편집기 DOM 바깥에 그려진다', await evaluate(`!document.querySelector('.blk-gutter').closest('.blk-editor')`))
    const t1 = await line(ids.t1)
    await move(t1.x + 10, t1.y + t1.h / 2)
    await sleep(60)
    const grip2 = await rect('.blk-gutter-grip')
    check('들여쓴 줄에서는 그 줄의 블록을 잡는다(부모가 아니라)', !!grip2 && Math.abs(grip2.y - t1.y) < 8 && grip2.x > grip.x, JSON.stringify({ grip2, t1 }))

    section('드래그')
    const c = await line(ids.C)
    await drag(ids.A, c.x + 5, c.y + c.h * 0.75, { drop: false })
    check('끄는 동안 파란 가이드가 보인다', await evaluate(`!!document.querySelector('.blk-drop-guide')`))
    check('끄는 동안 흐림 표시는 편집기 DOM 이 아니라 프레임에', await evaluate(`(() => { const f = document.querySelector('[data-dragging="true"]'); return !!f && !f.closest('.blk-editor') })()`))
    check('끄는 블록이 블록 선택으로 하이라이트된다', same(await selected(), ['A']), JSON.stringify(await selected()))
    const guide = await rect('.blk-drop-guide')
    check('가이드는 C 줄 아래 경계에', !!guide && Math.abs(guide.y + 1 - (c.y + c.h)) < 4, JSON.stringify({ guide, c }))
    await release(c.x + 5, c.y + c.h * 0.75)
    await sleep(80)
    check('놓으면 옮겨진다 — B C A T t1 D', same(await order(), ['B', 'C', 'A', 'T', 't1', 'D']), JSON.stringify(await order()))
    check('옮긴 블록이 선택돼 있다', same(await selected(), ['A']), JSON.stringify(await selected()))
    check('흐림 표시가 치워진다', !(await evaluate(`!!document.querySelector('[data-dragging]')`)))
    check('자동 저장 — 서버에도 반영된다', (await settledShape('B | C | A | T | T > t1 | D')) === 'B | C | A | T | T > t1 | D', await savedShape())

    const d = await line(ids.D)
    await drag(ids.B, d.x + 40, d.y + d.h * 0.75)
    check(
      '들여 놓으면 자식이 된다 — 부모만 바뀌는 이동도 저장된다(프로젝터 UNIQUE)',
      (await settledShape('C | A | T | T > t1 | D | D > B')) === 'C | A | T | T > t1 | D | D > B',
      await savedShape(),
    )

    const cNow = await line(ids.C)
    await drag(ids.C, cNow.x + 5, cNow.y + cNow.h * 0.3, { drop: false })
    const selfGuide = await rect('.blk-drop-guide')
    check('자기 줄 한가운데에는 드롭 존이 없다', !selfGuide || selfGuide.y + 1 <= cNow.y + 1 || selfGuide.y + 1 >= cNow.y + cNow.h - 1, JSON.stringify({ selfGuide, cNow }))
    await key('Escape')
    await sleep(60)
    check('Esc 로 드래그를 취소한다', !(await evaluate(`!!document.querySelector('.blk-drop-guide')`)))
    await release(cNow.x + 5, cNow.y + cNow.h * 0.3)
    await sleep(60)
    check('취소하면 그대로다', same(await order(), ['C', 'A', 'T', 't1', 'D', 'B']), JSON.stringify(await order()))

    section('핸들 클릭 · 키보드 이동 (F-01-09 · F-01-08)')
    const aNow = await line(ids.A)
    await move(aNow.x + 30, aNow.y + aNow.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const g = await rect('.blk-gutter-grip')
    await click(g.x + g.w / 2, g.y + g.h / 2)
    await sleep(60)
    check('핸들을 누르면 그 블록이 선택된다', same(await selected(), ['A']), JSON.stringify(await selected()))
    check('핸들을 누르면 블록 메뉴가 열리고 포커스가 메뉴로 간다', await evaluate(`!!document.activeElement?.closest('[role="menu"]')`))
    await key('Escape')
    await sleep(60)
    check('Esc 로 메뉴를 닫으면 포커스가 에디터로 돌아온다', await evaluate(`document.activeElement === document.querySelector('.blk-editor')`))
    check('메뉴를 닫아도 블록 선택은 그대로다', same(await selected(), ['A']), JSON.stringify(await selected()))
    await key('ArrowDown', MOD | SHIFT)
    await sleep(60)
    check('Mod+Shift+↓ — 토글을 통째로 건너뛴다(안으로 들어가지 않는다)', same(await order(), ['C', 'T', 't1', 'A', 'D', 'B']), JSON.stringify(await order()))
    check('옮긴 뒤에도 블록 선택이 유지된다', same(await selected(), ['A']), JSON.stringify(await selected()))

    section('접힘 (F-01-13)')
    const arrowState = () =>
      evaluate(`(() => { const c = document.querySelector('[data-block-id="${ids.T}"]'); const a = c.querySelector('.blk-toggle-arrow')
        const child = document.querySelector('[data-block-id="${ids.t1}"]')
        return { collapsed: c.getAttribute('data-collapsed'), glyph: a.textContent, expanded: a.getAttribute('aria-expanded'),
                 childVisible: child.getBoundingClientRect().height > 0 } })()`)
    const arrow = await rect(`[data-block-id="${ids.T}"] .blk-toggle-arrow`)
    await click(arrow.x + arrow.w / 2, arrow.y + arrow.h / 2)
    await sleep(80)
    let s = await arrowState()
    check('화살표를 누르면 자식이 **실제로 숨는다**', s.collapsed === 'true' && !s.childVisible, JSON.stringify(s))
    check('화살표는 ▸, aria-expanded=false', s.glyph === '▸' && s.expanded === 'false', JSON.stringify(s))

    const tText = await rect(`[data-block-id="${ids.T}"] .blk-text`)
    await click(tText.x + 4, tText.y + tText.h / 2)
    await sleep(60)
    await key('Escape')
    await sleep(250)
    check('접힌 토글에서 Esc → 그 토글이 블록 선택된다', same(await selected(), ['T']), JSON.stringify(await selected()))
    await key('ArrowDown', SHIFT)
    await sleep(250)
    check('Shift+↓ 로 늘려도 선택이 풀리지 않는다', same(await selected(), ['T', 'A']), JSON.stringify(await selected()))

    // 접힌 토글 안으로 끌어 놓으면 펼친다. **프로그램이** 펼칠 때 화살표가 따라오는가 —
    // 화살표를 직접 누를 때만 방향이 맞던 것을 이 검사가 잡는다.
    const tLine = await line(ids.T)
    await drag(ids.C, tLine.x + 60, tLine.y + tLine.h * 0.75)
    s = await arrowState()
    check('접힌 토글 안에 놓으면 펼쳐진다', s.collapsed === null && s.childVisible, JSON.stringify(s))
    check('프로그램이 펼쳐도 화살표가 따라온다 — ▾, aria-expanded=true', s.glyph === '▾' && s.expanded === 'true', JSON.stringify(s))
    check(
      '서버에도 T 의 첫 자식으로 저장된다',
      (await settledShape('T | T > C | T > t1 | A | D | D > B')) === 'T | T > C | T > t1 | A | D | D > B',
      await savedShape(),
    )

    section('블록 메뉴 (F-01-08 · F-12-01 · F-12-13)')
    // 지금 문서: T > C, T > t1, A, D > B. A 를 대상으로 한다.
    const menuOpen = () => evaluate(`!!document.querySelector('[role="menu"][aria-label="블록 메뉴"]')`)
    const typeOf = (id) => evaluate(`document.querySelector('[data-block-id="${id}"] > [data-block-type]')?.getAttribute('data-block-type') ?? null`)
    const aText = await rect(`[data-block-id="${ids.A}"] > *:first-child`)
    await click(aText.x + aText.w / 2, aText.y + aText.h / 2)
    await sleep(60)
    await key('/', MOD)
    await sleep(80)
    check('Mod+/ — 편집 모드에서도 그 블록을 선택하고 메뉴를 연다', (await menuOpen()) && same(await selected(), ['A']), JSON.stringify(await selected()))
    check('처음 포커스는 첫 켜진 항목(변환)', (await evaluate(`document.activeElement?.textContent`))?.startsWith('변환'))

    await key('Enter')
    await sleep(40)
    check('Enter 로 하위 메뉴가 열리고 첫 켜진 항목에 선다 — 이미 텍스트라 "텍스트"는 건너뛴다', (await evaluate(`document.activeElement?.textContent`))?.startsWith('제목 1'), await evaluate(`document.activeElement?.textContent`))
    await key('Enter')
    await sleep(80)
    check('변환 — A 가 제목 1 이 된다', (await typeOf(ids.A)) === 'heading_1', await typeOf(ids.A))
    check('실행하면 메뉴가 닫히고 에디터로 포커스가 온다', !(await menuOpen()) && (await evaluate(`document.activeElement === document.querySelector('.blk-editor')`)))

    await key('/', MOD)
    await sleep(60)
    await key('ArrowDown')
    await key('ArrowRight')
    await key('End')
    await sleep(40)
    check('색 하위 메뉴의 끝은 "빨강 배경"', (await evaluate(`document.activeElement?.textContent`))?.includes('빨강 배경'), await evaluate(`document.activeElement?.textContent`))
    await key('Enter')
    await sleep(80)
    check('색 — 블록 색(format.block_color)이 칠해진다', (await evaluate(`document.querySelector('[data-block-id="${ids.A}"] > [data-block-type]')?.getAttribute('data-color')`)) === 'red_background')

    await key('/', MOD)
    await sleep(60)
    await key('ArrowDown')
    await key('ArrowDown')
    await key('ArrowDown')
    await key('Enter')
    await sleep(150)
    const notice = await evaluate(`[...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' ')`)
    check('블록 링크 복사 — 안내가 뜬다', notice.includes('블록 링크를 복사했습니다'), notice)
    const copied = await evaluate(`navigator.clipboard.readText()`)
    check('클립보드에 /w/{ws}/{page}#{blockId} 가 들어간다', copied.endsWith(`/w/${workspaceId}/${pageId}#${ids.A}`), copied)

    await key('/', MOD)
    await sleep(60)
    await key('ArrowDown')
    await key('ArrowDown')
    await key('Enter')
    await sleep(100)
    const countA = async () => (await order()).filter((t) => t === 'A').length
    check('복제 — A 가 둘이 된다', (await countA()) === 2, JSON.stringify(await order()))
    await key('/', MOD)
    await sleep(60)
    await key('End')
    await key('Enter')
    await sleep(100)
    check('삭제 — 복제본이 지워져 A 가 다시 하나다(복제 뒤 선택이 복제본으로 옮겨 있다)', (await countA()) === 1, JSON.stringify(await order()))

    const aLine2 = await line(ids.A)
    await move(aLine2.x + 30, aLine2.y + aLine2.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const g2 = await rect('.blk-gutter-grip')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g2.x + g2.w / 2, y: g2.y + g2.h / 2, button: 'right', buttons: 2, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g2.x + g2.w / 2, y: g2.y + g2.h / 2, button: 'right', buttons: 0, clickCount: 1 })
    await sleep(80)
    check('핸들 우클릭으로도 열린다(정본 F-12-01) — 드래그는 시작하지 않는다', (await menuOpen()) && !(await evaluate(`!!document.querySelector('[data-dragging]')`)))
    // 메뉴는 A 의 핸들 아래로 펼쳐져 바로 아래 줄들을 덮는다. "바깥"은 A 위의 T 로 잡는다.
    const dText = await rect(`[data-block-id="${ids.D}"] > *:first-child`)
    const underD = await evaluate(`document.elementFromPoint(${dText.x + 10}, ${dText.y + dText.h / 2})?.closest('[role="menu"]') ? '메뉴' : '본문'`)
    const tOutside = await rect(`[data-block-id="${ids.T}"] .blk-text`)
    await click(tOutside.x + 4, tOutside.y + tOutside.h / 2)
    await sleep(80)
    const outside = { menu: await menuOpen(), selected: await selected(), underD }
    check('바깥을 누르면 닫힌다 — 누른 곳으로 캐럿이 간다', !outside.menu && outside.selected.length === 0, JSON.stringify(outside))

    // 링크로 들어오면 그 블록이 선택된 채로 열린다(복사하는 쪽과 받는 쪽).
    await send('Page.navigate', { url: copied })
    await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length > 0`, 15000)
    const aSelected = `[...document.querySelectorAll('.blk-selected')].some((e) => e.getAttribute('data-block-id') === '${ids.A}')`
    // 같은 페이지라 해시만 바뀐다(hashchange 경로).
    check('블록 링크로 가면 그 블록이 선택된다 — 같은 페이지(hashchange)', await waitFor(aSelected, 3000), JSON.stringify(await selected()))
    await send('Page.reload')
    await sleep(300)
    await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length > 0`, 15000)
    check('블록 링크로 처음 열어도 그 블록이 선택된다 — 새로고침(마운트 경로)', await waitFor(aSelected, 3000), JSON.stringify(await selected()))

    section('복사 · 붙여넣기 (F-01-10)')
    // 지금 문서: T > C, T > t1, A(제목1·빨강배경), D > B.
    const blocksMime = 'application/x-notion-clone-blocks+json'

    // ① 블록을 고르고, 먼저 **무엇을 싣는지** 본다(합성 이벤트).
    //    그다음 진짜 Ctrl+C / Ctrl+V 로 시스템 클립보드를 오간다 — 커스텀 MIME 이
    //    실제로 살아남는지는 그렇게만 알 수 있다.
    //    ⚠ execCommand('copy') 는 쓰지 않는다. 블록 선택은 캐럿이 없어 DOM 선택이
    //    접혀 있고, 그러면 복사 이벤트 자체가 일어나지 않는다(그래서 직전에 복사해 둔
    //    것이 그대로 붙었다).
    const copyLine = await line(ids.T)
    await move(copyLine.x + 30, copyLine.y + copyLine.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const tGrip = await rect('.blk-gutter-grip')
    await click(tGrip.x + tGrip.w / 2, tGrip.y + tGrip.h / 2)
    await key('Escape')
    await sleep(60)
    check('복사할 블록을 고른다(T · 자식 둘)', same(await selected(), ['T']), JSON.stringify(await selected()))

    const payload = await evaluate(`(() => {
      const dt = new DataTransfer()
      const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })
      document.querySelector('.blk-editor').dispatchEvent(ev)
      return { json: dt.getData('${blocksMime}'), text: dt.getData('text/plain'), html: dt.getData('text/html') }
    })()`)
    check('세 벌을 싣는다 — JSON · 평문 · HTML (정본의 3종)', !!payload.json && !!payload.text && !!payload.html, JSON.stringify(payload).slice(0, 300))
    check('평문은 마크다운에 가깝다', payload.text.includes('- '), payload.text)
    check('HTML 은 toDOM 형태다', payload.html.includes('data-block-type'), payload.html.slice(0, 200))
    check('JSON 에 자식까지 들어 있다', (payload.json.match(/"type"/g) ?? []).length >= 3, payload.json.slice(0, 200))

    await key('c', MOD)
    await sleep(120)

    const dLine = await line(ids.D)
    await click(dLine.x + 20, dLine.y + dLine.h / 2)
    await sleep(60)
    await key('v', MOD)
    await sleep(200)
    const afterPaste = await order()
    check('★ 진짜 클립보드로 붙는다 — 중첩까지 (T · C · t1 이 한 벌 더)', afterPaste.filter((t) => t === 'C').length === 2 && afterPaste.filter((t) => t === 't1').length === 2, JSON.stringify(afterPaste))
    check('붙은 블록은 새 id 를 받는다', await evaluate(`(() => { const ids = [...document.querySelectorAll('.blk-editor [data-block-id]')].map((e) => e.getAttribute('data-block-id')); return new Set(ids).size === ids.length })()`))
    // D 는 자식(B)이 있으므로 텍스트를 쪼개지 않고 **첫 자식 자리**에 들어간다
    // (자식이 뒤 블록으로 딸려가는 것을 막는다 — §7-4 최빈 버그).
    const pastedShape = 'T | T > C | T > t1 | A | D | D > T | D > T > C | D > T > t1 | D > B'
    const savedAfterPaste = await settledShape(pastedShape)
    check('붙여넣은 것이 서버에 저장된다 — 자식(B)은 그대로', savedAfterPaste === pastedShape, savedAfterPaste)

    // ② 하위 페이지는 복사되지 않는다 — 안내가 뜬다.
    const subpage = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ parentPageId: pageId }) })).json()
    // 참조 노드는 제목을 싣지 않는다 — 화면은 서버가 권한으로 거른 제목 맵에서 읽는다(HANDOFF §3.2-22). 만든 뒤 이름을 바꿔
    // 맵에서 온 이름인지 본다(노드에 남은 옛 제목이 아니라).
    const subTitle = `참조 제목 ${Date.now()}`
    await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${subpage.page.id}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ title: subTitle }) })
    await send('Page.reload')
    await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length > 0`, 15000)
    check('★ 하위 페이지 참조는 서버가 준 제목(이름을 바꾼 뒤의 것)을 그린다',
      await waitFor(`[...document.querySelectorAll('.blk-editor .blk-page-link')].some((e) => e.textContent === ${JSON.stringify(subTitle)} && !e.disabled)`, 5000))
    const subLine = await line(subpage.page.id)
    await move(subLine.x + 30, subLine.y + subLine.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter-grip')`)
    const subGrip = await rect('.blk-gutter-grip')
    // 핸들이 늦게 뜨면 null — 그대로 읽으면 스크립트가 통째로 죽어 뒤의 절이 모두 사라진다(8b-2 의 전체 판에서 한 번). 검사로 떨어뜨린다.
    check('전제 — 하위 페이지 줄에 핸들이 떴다', subGrip !== null)
    if (subGrip) await click(subGrip.x + subGrip.w / 2, subGrip.y + subGrip.h / 2)
    await key('Escape')
    await sleep(60)
    const subPayload = await evaluate(`(() => {
      const dt = new DataTransfer()
      document.querySelector('.blk-editor').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
      return dt.getData('${blocksMime}')
    })()`)
    check('하위 페이지는 JSON 에 실리지 않는다', subPayload === '' || !subPayload.includes('"page"'), subPayload.slice(0, 200))
    check('복사되지 않았다고 알려준다', await waitFor(`[...document.querySelectorAll('[role="status"]'), ...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('하위 페이지는 복사되지 않았습니다'))`, 2000))

    section('+ 버튼 (F-01-08 · F-01-04)')
    const dNow = await line(ids.D)
    await move(dNow.x + 30, dNow.y + dNow.h / 2)
    await waitFor(`!!document.querySelector('.blk-gutter')`)
    const plus = await rect('.blk-gutter-button')
    await click(plus.x + plus.w / 2, plus.y + plus.h / 2)
    await sleep(120)
    const afterPlus = await order()
    check('D 바로 아랫줄에 "/" 블록이 생긴다', afterPlus[afterPlus.indexOf('D') + 1] === '/', JSON.stringify(afterPlus))
    check('슬래시 메뉴가 열린다', await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 2000))

    section('이미지 (F-01-15)')
    // 앞 절의 `+` 가 만든 "/" 블록이 서버 로그에 쌓이기 전에 아래에서 본문을 덧붙이면(PUT), 그 저장이 "/" 블록을 모른 채
    // 문서를 맞춰 버린다. 서버가 받은 것을 먼저 보고 덧붙인다 — 본문 행은 투영 창(1s)만큼 늦으므로 기다린다.
    let slashOnServer = false
    for (let i = 0; i < 60 && !slashOnServer; i += 1) {
      slashOnServer = (await savedShape()).split(' | ').some((part) => part.endsWith('/'))
      if (!slashOnServer) await sleep(150)
    }
    check('앞 절의 "/" 블록이 서버에 저장됐다 — 서버 본문을 덧붙이기 전에', slashOnServer, await savedShape())
    check('앞 절의 편집을 서버가 확인해 보존본이 비워졌다', await waitFor(PENDING_EMPTY, 15000))
    // 빈 이미지 블록 둘을 문서 끝에 붙인다 — 하나는 URL, 하나는 업로드용.
    // 문서를 통째로 바꾸지 않고 **덧붙인다**: 위에서 만든 하위 페이지가 빠지면
    // 저장이 거부된다(낡은 탭이 하위 페이지를 지우는 것을 막는 규칙).
    const imgUrlId = randomUUID()
    const imgFileId = randomUUID()
    const emptyImage = (id) => ({ id, type: 'image', title: [], properties: {}, format: {}, children: [] })
    const currentDoc = (await readBody(pageId)).doc
    await saveBody(pageId, { blocks: [...currentDoc.blocks, emptyImage(imgUrlId), emptyImage(imgFileId)] })
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
    await waitFor(`!!document.querySelector('[data-block-id="${imgFileId}"] .blk-image-pick')`, 15000)

    /** 서버에 저장된 이 블록의 `properties.source`. */
    const savedSource = async (id) => {
      const body = await readBody(pageId)
      let found = null
      const walk = (blocks) => {
        for (const b of blocks) {
          if (b.id === id) found = b.properties?.source ?? null
          if (b.children?.length) walk(b.children)
        }
      }
      walk(body.doc.blocks)
      return found
    }
    const settledSource = async (id, predicate) => {
      let source = null
      for (let i = 0; i < 40; i += 1) {
        source = await savedSource(id)
        if (predicate(source)) return source
        await sleep(150)
      }
      return source
    }

    check('빈 이미지 블록은 업로드 버튼과 주소 입력을 보여준다 — 정본 "빈 값" 엣지 케이스',
      await evaluate(`!!document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-pick') && !!document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-url-input')`))

    // ① javascript: 는 화면에서 먼저 막힌다(저장 경로도 막지만, 여기서 알려준다).
    await evaluate(`(() => {
      const i = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-url-input')
      i.value = 'javascript:alert(1)'
      i.closest('form').requestSubmit()
    })()`)
    await sleep(120)
    const refused = await evaluate(`(() => {
      const fig = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image')
      return { state: fig.dataset.state, alert: fig.querySelector('[role="alert"]')?.textContent ?? '' }
    })()`)
    check('★ javascript: 주소는 거부하고 이유를 말한다', refused.state === 'empty' && refused.alert.includes('http'), JSON.stringify(refused))

    // ② 외부 URL — 불러오지 못하는 주소로 폴백까지 본다.
    await evaluate(`(() => {
      const i = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-url-input')
      i.value = 'https://invalid.example/없는이미지.png'
      i.closest('form').requestSubmit()
    })()`)
    check('외부 주소를 넣으면 이미지 블록이 된다', await waitFor(`document.querySelector('[data-block-id="${imgUrlId}"] .blk-image').dataset.state === 'ready'`, 3000))
    check('★ 못 불러오면 깨진 이미지 대신 "불러올 수 없음" + 원본 링크 (정본 엣지 케이스)',
      await waitFor(`(() => {
        const e = document.querySelector('[data-block-id="${imgUrlId}"] .blk-image-error')
        return !!e && !!e.querySelector('a.blk-image-origin')
      })()`, 5000))
    const urlSource = await settledSource(imgUrlId, (s) => s?.type === 'external')
    check('외부 주소는 그대로 저장된다', urlSource?.type === 'external' && urlSource.url.startsWith('https://'), JSON.stringify(urlSource))

    // ③ 업로드 — 진짜 파일을 고르고, 진짜 multipart 로 올라가, 진짜로 그려지는지.
    const pngPath = join(profile, 'e2e.png')
    writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    await send('DOM.enable')
    const domRoot = (await send('DOM.getDocument', { depth: -1 })).root.nodeId
    const inputNode = (await send('DOM.querySelector', { nodeId: domRoot, selector: `[data-block-id="${imgFileId}"] .blk-image-file` })).nodeId
    check('업로드 입력은 허용 타입만 받는다', (await evaluate(`document.querySelector('[data-block-id="${imgFileId}"] .blk-image-file').accept`)).includes('image/png'))
    await send('DOM.setFileInputFiles', { files: [pngPath], nodeId: inputNode })

    check('★ 파일을 고르면 올라가고 그 자리에 그려진다',
      await waitFor(`!!document.querySelector('[data-block-id="${imgFileId}"] img')`, 10000))
    const loaded = await waitFor(`(() => { const i = document.querySelector('[data-block-id="${imgFileId}"] img'); return !!i && i.complete && i.naturalWidth > 0 })()`, 10000)
    check('★ 올린 이미지가 실제로 디코드된다 — 스토리지→라우트→브라우저 전 경로', loaded,
      await evaluate(`document.querySelector('[data-block-id="${imgFileId}"] img')?.src ?? '(img 없음)'`))
    check('주소는 우리 content 라우트다 — 서명 URL 을 저장하지 않는다(FS2)',
      await evaluate(`document.querySelector('[data-block-id="${imgFileId}"] img').getAttribute('src').startsWith('/api/workspaces/${workspaceId}/files/')`))

    const fileSource = await settledSource(imgFileId, (s) => s?.type === 'file')
    check('★ 저장되는 것은 file_id 다 — 주소가 아니다', fileSource?.type === 'file' && typeof fileSource.file_id === 'string' && !JSON.stringify(fileSource).includes('/api/'), JSON.stringify(fileSource))

    // ④ 블록을 지우면 이미지도 같이 사라진다(참조 카운트는 DB 테스트가 본다).
    await send('Page.reload')
    await waitFor(`!!document.querySelector('[data-block-id="${imgFileId}"] img')`, 15000)
    check('새로고침해도 그대로 보인다 — 문서에서 다시 읽어 그린다', true)

    section('이미지 드롭 · 붙여넣기 (F-01-15)')
    // PNG 한 장을 브라우저 안에서 만든다. 여기부터는 **진짜 File 객체**가 돈다 —
    // DataTransfer 에 담아 drop · paste 이벤트로 흘려 넣으면 우리 플러그인이
    // 실제로 받는 것과 같은 값이다.
    const makeFile = (name, type, b64) => `(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
      return new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })
    })()`
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

    const countImages = () => evaluate(`document.querySelectorAll('.blk-editor .blk-image').length`)
    const before = await countImages()

    // ① 붙여넣기 — 스크린샷을 붙이는 그 경로다(clipboardData.files).
    const pasteTarget = await line(ids.A)
    await click(pasteTarget.x + 20, pasteTarget.y + pasteTarget.h / 2)
    await sleep(60)
    // 이미 그려져 있는 이미지가 있으므로(앞 절) **새로 생긴 블록만** 본다.
    const idsBeforePaste = await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((e) => e.getAttribute('data-block-id'))`)
    const newImageSelector = (known) => `[...document.querySelectorAll('.blk-editor [data-block-id]')]
      .filter((c) => !${JSON.stringify(known)}.includes(c.getAttribute('data-block-id')))
      .find((c) => c.querySelector('.blk-image'))`
    await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(${makeFile('붙인이미지.png', 'image/png', PNG_B64)})
      document.querySelector('.blk-editor').dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      )
    })()`)
    check('★ 이미지를 붙여넣으면 이미지 블록이 생긴다', await waitFor(`document.querySelectorAll('.blk-editor .blk-image').length === ${before + 1}`, 5000))
    check('★ 붙인 이미지가 올라가 그려진다 — 빈 블록으로 남지 않는다',
      await waitFor(`(() => {
        const box = ${newImageSelector(idsBeforePaste)}
        const img = box?.querySelector('.blk-image img')
        return !!img && img.complete && img.naturalWidth > 0 && img.getAttribute('src').includes('/files/')
      })()`, 15000),
      await evaluate(`(${newImageSelector(idsBeforePaste)})?.querySelector('.blk-image')?.dataset.state ?? '(블록 없음)'`))

    // ② 드롭 — 이미지가 아닌 파일은 받지 않되 이유를 말한다.
    const dropLine = await line(ids.A)
    const dropAt = { x: dropLine.x + 20, y: dropLine.y + dropLine.h / 2 }
    const beforeReject = await countImages()
    await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['hello'], '메모.txt', { type: 'text/plain' }))
      document.querySelector('.blk-editor').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${dropAt.x}, clientY: ${dropAt.y} }),
      )
    })()`)
    check('★ 이미지가 아닌 파일은 조용히 버리지 않고 이유를 말한다',
      await waitFor(`[...document.querySelectorAll('[role="status"]'), ...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('이미지만'))`, 3000))
    check('거부한 파일은 블록을 만들지 않는다', (await countImages()) === beforeReject, `${await countImages()} vs ${beforeReject}`)

    // ③ 드롭 — 놓은 줄 바로 다음에 들어간다.
    const beforeDrop = await countImages()
    await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(${makeFile('놓은이미지.png', 'image/png', PNG_B64)})
      document.querySelector('.blk-editor').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${dropAt.x}, clientY: ${dropAt.y} }),
      )
    })()`)
    check('★ 끌어다 놓으면 그 자리에 이미지 블록이 생긴다', await waitFor(`document.querySelectorAll('.blk-editor .blk-image').length === ${beforeDrop + 1}`, 5000))
    const dropped = await evaluate(`(() => {
      const containers = [...document.querySelectorAll('.blk-editor [data-block-id]')]
      const at = containers.findIndex((c) => c.getAttribute('data-block-id') === '${ids.A}')
      return { next: containers[at + 1]?.querySelector('.blk-image') ? '이미지' : containers[at + 1]?.firstElementChild?.getAttribute('data-block-type') ?? '없음' }
    })()`)
    check('놓은 줄 바로 다음에 들어간다 — 그 줄을 쪼개지 않는다', dropped.next === '이미지', JSON.stringify(dropped))

    // ④ 에디터를 빗나간 드롭은 삼킨다 — 안 그러면 브라우저가 그 파일을 열고
    //    편집하던 페이지를 떠난다.
    const strayPrevented = await evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }))
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      document.body.appendChild(document.createElement('div')).dispatchEvent(ev)
      return ev.defaultPrevented
    })()`)
    check('★ 에디터 밖에 놓아도 브라우저가 파일을 열지 않는다 — 페이지를 떠나지 않게', strayPrevented)

    // ⑤ 올라간 것이 서버에 file_id 로 저장된다.
    const droppedSaved = await (async () => {
      let last = []
      for (let i = 0; i < 40; i += 1) {
        const body = await readBody(pageId)
        const found = []
        const walk = (blocks) => {
          for (const b of blocks) {
            if (b.type === 'image' && b.properties?.source?.type === 'file') found.push(b.properties.source.file_id)
            if (b.children?.length) walk(b.children)
          }
        }
        walk(body.doc.blocks)
        if (found.length >= 3) return found
        last = found
        await sleep(150)
      }
      // 실패해도 **무엇이 저장돼 있었는지** 보여준다 — 빈 배열만 찍으면 원인을
      // 알 수 없다(반사실 실험에서 실제로 헷갈렸다).
      return last
    })()
    check('★ 올린 · 붙인 · 놓은 이미지가 모두 file_id 로 저장된다', droppedSaved.length >= 3, JSON.stringify(droppedSaved))

    section('오프라인 편집 보존 · 오류 UX (F-05-04 · F-12-16)')
    // 지금까지의 검사가 전부 "연결이 살아 있을 때"였다. 이 절은 **끊긴 동안 친 글이 살아남는가**를 본다 — 이 기능이
    // 존재하는 이유다.
    // ⚠ 끊김은 **협업 서버를 내려서** 만든다. `Network.setBlockedURLs` 는 이미 열린 웹소켓을 끊지 못하고,
    //    네트워크를 통째로 끊으면 페이지 자체가 로드되지 않아 새로고침 시나리오를 볼 수 없다.
    await send('Network.enable')

    // 새 페이지에서 한다 — 앞 절들이 만든 상태와 섞이지 않게.
    const syncPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
    /** 서버가 가진 본문 — 행은 투영 창(1s)만큼 늦다. */
    const savedText = async () => {
      const body = await readBody(syncPage)
      return body.doc.blocks.map((b) => b.title?.[0]?.text?.content ?? '').join(' | ')
    }
    const savedHas = async (text, ms = 15000) => {
      const end = Date.now() + ms
      for (;;) {
        if ((await savedText()).includes(text)) return true
        if (Date.now() > end) return false
        await sleep(200)
      }
    }

    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${syncPage}` })
    await waitFor(`!!document.querySelector('.blk-editor [data-block-id]')`, 15000)
    await click((await rect('.blk-editor')).x + 40, (await rect('.blk-editor')).y + 10)
    await typeText('온라인에서 친 글')
    check('평상시 저장은 조용하다 — "저장됨"을 띄우지 않는다',
      !(await evaluate(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('저장'))`)))
    check('온라인에서 친 글이 서버에 쌓인다', await savedHas('온라인에서 친 글'))
    check('확인된 편집은 보존본에 남지 않는다', await waitFor(PENDING_EMPTY, 10000))

    // ① 협업 서버를 내리고 계속 친다.
    await stopCollab()
    await typeText(' + 끊긴 뒤에 친 글')
    check('★ 3초 넘게 서버가 확인하지 않으면 "동기화 중"이라고 말한다',
      await waitFor(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('동기화 중'))`, 15000))
    check('★ 끊기면 배너로 알리고, 계속 편집할 수 있다고 말한다',
      await waitFor(`[...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('오프라인'))`, 20000))
    check('편집을 막지 않는다 — 입력을 막으면 사용자가 내용을 잃는다',
      await evaluate(`document.querySelector('.blk-editor').contentEditable !== 'false'`))
    check('끊긴 동안 친 글은 아직 서버에 없다', !(await savedText()).includes('끊긴 뒤에 친 글'), await savedText())
    check('★ 끊긴 동안 친 글이 IndexedDB 보존본에 남는다',
      await waitFor(`(async () => (await ${PENDING_ROWS}).some((u) => u.includes('끊긴 뒤에 친 글')))()`, 10000))

    // ② 끊긴 채로 탭을 다시 연다. 보존본이 IndexedDB 에 있어야 살아남는다.
    await send('Page.reload')
    await waitFor(`!!document.querySelector('.blk-editor [data-block-id]')`, 20000)
    check('★ 끊긴 채 새로고침해도 친 글이 화면에 돌아온다 — 보존본을 서버 본문 위에 되살린다',
      await waitFor(`document.querySelector('.blk-editor').textContent.includes('끊긴 뒤에 친 글')`, 15000),
      await evaluate(`document.querySelector('.blk-editor').textContent`))

    // ③ 서버가 돌아온다. 브라우저가 알리면 기다리지 않고 곧바로 다시 붙는다.
    await restartCollab()
    await evaluate(`window.dispatchEvent(new Event('online'))`)
    check('★ 서버가 돌아오면 끊긴 동안 친 글이 쌓인다', await savedHas('끊긴 뒤에 친 글', 30000), await savedText())
    check('보존본이 비워진다 — 확인된 것을 남기지 않는다', await waitFor(PENDING_EMPTY, 15000))
    check('"동기화 중" 표시가 사라진다',
      await waitFor(`![...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('동기화 중'))`, 10000))
    check('오프라인 배너가 사라진다',
      await waitFor(`![...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('오프라인'))`, 10000))

    // ④ 서버가 받을 수 없는 편집(한 번에 보내기 한도 초과) — 버리고 다시 열고, 버린 내용을 보여 준다.
    const hugeEditor = await rect('.blk-editor')
    await click(hugeEditor.x + 40, hugeEditor.y + 10)
    // 한 번에 보낼 수 있는 update 상한(1MiB)을 **확실히** 넘긴다 — 아슬아슬하면 통과해 버려 이 절이 아무것도 보지 않는다.
    await send('Input.insertText', { text: '넘치는 글'.repeat(200000) })
    check('★ 서버가 받지 못한 편집은 버리고 다시 열며, 그 사실을 말해 준다',
      await waitFor(`[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('받지 못한'))`, 20000),
      await evaluate(`[...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(' / ')`))
    check('★ 버린 편집은 화면에서도 사라진다 — 서버 본문으로 다시 열었다',
      await waitFor(`!document.querySelector('.blk-editor').textContent.includes('넘치는 글')`, 15000))

    // ⚠ 좌표를 읽기 전에 **보이는 곳으로 올린다.** 큰 문단을 넣은 뒤라 화면이 캐럿을 따라 내려가 있을 수 있고,
    //    그 상태의 rect 는 음수라 클릭이 아무 데도 닿지 않는다(실제로 겪었다).
    const seeButton = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('저장하지 못한 내용'))
      if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    check('★ "저장하지 못한 내용 보기"가 있다 — 조용히 버리면 데이터 손실 신고가 된다', !!seeButton)
    if (seeButton) {
      await click(seeButton.x, seeButton.y)
      check('★ 버린 내용을 실제로 보여준다 — 복사해 갈 수 있다',
        await waitFor(`(() => {
          const t = document.querySelector('textarea[aria-label="저장하지 못한 내용"]')
          return !!t && t.value.includes('넘치는 글')
        })()`, 5000),
        await evaluate(`(() => {
          const t = document.querySelector('textarea[aria-label="저장하지 못한 내용"]')
          return t ? '길이 ' + t.value.length + ' / 앞 ' + JSON.stringify(t.value.slice(0, 40)) : '(textarea 없음)'
        })()`))
    }

    section('두 탭 동시 편집 (F-05-01 · F-05-15)')
    {
      // 같은 페이지를 탭 둘에서 연다 — 한쪽이 친 글이 다른 쪽에 오고, 같은 문단을 함께 쳐도 서로 지우지 않는다.
      const sharedPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
      const sharedUrl = `${BASE}/w/${workspaceId}/${sharedPage}`
      await send('Page.navigate', { url: sharedUrl })
      await waitFor(`!!document.querySelector('.blk-editor')`, 15000)
      const other = await openTab(sharedUrl)
      check('둘째 탭이 같은 페이지를 연다', await other.waitFor(`!!document.querySelector('.blk-editor')`, 20000))

      const box = await rect('.blk-editor')
      await click(box.x + 40, box.y + 10)
      await send('Input.insertText', { text: '첫째 탭' })
      check('★ 한 탭에서 친 글이 다른 탭에 나타난다',
        await other.waitFor(`document.querySelector('.blk-editor').textContent.includes('첫째 탭')`, 20000),
        await other.evaluate(`document.querySelector('.blk-editor').textContent`))

      await other.typeInBody('둘째 탭 ')
      check('★ 반대 방향도 온다 — 그리고 같은 문단이 서로를 지우지 않는다',
        await waitFor(`(() => { const t = document.querySelector('.blk-editor').textContent
          return t.includes('첫째 탭') && t.includes('둘째 탭') })()`, 20000),
        await evaluate(`document.querySelector('.blk-editor').textContent`))

      // 되돌리기는 내 편집만(F-05-15) — 첫째 탭의 Mod+Z 가 둘째 탭이 친 글을 지우면 안 된다.
      await click(box.x + 40, box.y + 10)
      await key('z', MOD)
      check('★ 되돌리기는 내가 친 것만 되돌린다 — 다른 탭이 친 글은 남는다',
        await waitFor(`(() => { const t = document.querySelector('.blk-editor').textContent
          return !t.includes('첫째 탭') && t.includes('둘째 탭') })()`, 10000),
        await evaluate(`document.querySelector('.blk-editor').textContent`))
      check('그 되돌리기가 다른 탭에도 간다',
        await other.waitFor(`!document.querySelector('.blk-editor').textContent.includes('첫째 탭')`, 20000),
        await other.evaluate(`document.querySelector('.blk-editor').textContent`))
    }

    }
    if (sectionIf('공유 패널 (F-06-05)')) {
    // 새 페이지 + 하위 페이지에서 본다 — 상속 표시와 "따로 관리하기"가 핵심이다.
    const shareParent = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
    const shareChild = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ parentPageId: shareParent }) })).json()).page.id



    // ① 루트 페이지 — 모두에게 전체 권한이 직접 부여돼 있다.
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${shareParent}` })
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
    check('공유 버튼이 있다', await clickText('공유'))
    check('★ 루트 페이지는 "모든 멤버"에게 부여돼 있다',
      await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes('워크스페이스 모든 멤버')`, 5000),
      await panelText())
    check('루트에서는 상속 표시가 없다', !(await panelText()).includes('상위에서 상속됨'))

    // ② 하위 페이지 — 같은 주체가 "상속됨"으로 보인다.
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${shareChild}` })
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
    await clickText('공유')
    check('★ 하위 페이지에서는 "상위에서 상속됨"으로 표시된다',
      await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes('상위에서 상속됨')`, 5000),
      await panelText())
    check('상위 설정을 따르고 있다고 말해 준다', (await panelText()).includes('상위 페이지의 공유 설정을 따르고'))

    // ③ ★ "따로 관리하기" — 끊는 순간 상속분이 복사돼야 한다(불변식 P1).
    check('"따로 관리하기"를 누른다', await clickText('따로 관리하기'))
    // 끊은 뒤의 모습을 기다린다 — '따로 관리' 만 보면 누르기 전부터 있는 버튼("따로 관리하기")에 맞아 기다리지 않는다(부하에서 다시
    // 그리기 전에 읽었다 · Phase 2 1a 의 전체 판).
    await waitFor(`(() => {
      const text = document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? ''
      return text.includes('따로 관리되고 있습니다') && !text.includes('상위에서 상속됨')
    })()`, 10000)
    const afterRestrict = await panelText()
    check('★ 끊어도 접근이 사라지지 않는다 — 상속분이 이 페이지로 복사됐다 (P1)',
      afterRestrict.includes('워크스페이스 모든 멤버') && !afterRestrict.includes('상위에서 상속됨'),
      afterRestrict)
    check('끊었다는 것을 말로 알려준다', afterRestrict.includes('따로 관리되고 있습니다'))
    check('서버에도 반영됐다 — 이제 이 노드가 직접 갖고 있다', await (async () => {
      const data = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${shareChild}/access`, { headers: authed })).json()
      return data.entries.some((e) => e.principalType === 'workspace_everyone' && !e.inherited)
    })())

    // ④ 마지막 관리자를 지우려 하면 막고 이유를 말한다.
    check('"제거"를 누른다', await clickText('제거'))
    check('★ 관리할 사람이 아무도 안 남는 제거는 막는다',
      await waitFor(`[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes('관리할 수 있는 사람'))`, 5000),
      await panelText())
    check('막힌 뒤에도 권한은 그대로다', (await panelText()).includes('워크스페이스 모든 멤버'))

    }
    if (sectionIf('그룹 — 라우트 · 공유 패널 (7a · F-06-03)')) {
      // 그룹은 권한의 주체다. 라우트로 만들고 넣고, 공유 패널에서 그룹 행이 **그룹으로** 다뤄지는지 본다 — 사용자가 아니면
      // 모든 멤버로 읽던 옛 규칙이 남아 있으면 그룹 행의 레벨 바꾸기 · 제거가 모든 멤버의 행을 건드린다.
      const groupMate = await joinAs(workspaceId, await createUser('그룹 동료'), 'member')
      const asGroupMate = { ...json, cookie: `nc_session=${groupMate.token}` }
      const groupsUrl = `${BASE}/api/workspaces/${workspaceId}/groups`
      const postJson = (url, headers, body) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })

      const firstName = `디자인팀 ${Date.now()}`
      const madeRes = await postJson(groupsUrl, authed, { name: firstName })
      const made = await madeRes.json()
      check('owner 가 그룹을 만든다 (201)', madeRes.status === 201 && made.group?.name === firstName, JSON.stringify(made))
      const firstGroup = made.group.id
      check('같은 이름(대소문자 무시)은 409 duplicate_name',
        (await postJson(groupsUrl, authed, { name: firstName.toUpperCase() })).status === 409)
      check('member 는 그룹을 못 만든다 (403)', (await postJson(groupsUrl, asGroupMate, { name: `몰래 ${Date.now()}` })).status === 403)

      const addRes = await postJson(`${groupsUrl}/${firstGroup}/members`, authed, { userId: groupMate.userId })
      check('owner 가 동료를 그룹에 넣는다', addRes.status === 200, await addRes.text())
      const seenByMate = await (await fetch(groupsUrl, { headers: asGroupMate })).json()
      check('member 도 그룹 목록을 본다 — 인원이 1이다',
        seenByMate.groups?.some((g) => g.id === firstGroup && g.memberCount === 1), JSON.stringify(seenByMate))

      // 소유자만 보는 페이지를 그룹에 준다.
      const groupPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
      const accessUrl = `${BASE}/api/workspaces/${workspaceId}/pages/${groupPage}/access`
      const ownerId = ctx.userId
      for (const body of [
        { action: 'grant', principal: { type: 'user', id: ownerId }, level: 'full_access' },
        { action: 'revoke', principal: { type: 'workspace_everyone' } },
      ]) {
        await postJson(accessUrl, authed, body)
      }
      check('전제: 그룹에 주기 전에는 동료가 못 본다 (404)', (await fetch(accessUrl, { headers: asGroupMate })).status === 404)
      const grantRes = await postJson(accessUrl, authed, { action: 'grant', principal: { type: 'group', id: firstGroup }, level: 'view' })
      check('그룹에 읽기를 준다', grantRes.status === 200, await grantRes.text())
      check('★ 동료는 그룹으로 그 페이지를 본다', (await fetch(accessUrl, { headers: asGroupMate })).status === 200)

      // 공유 패널 — 그룹 행이 이름으로 보인다.
      const firstLabel = `그룹 · ${firstName} (1명)`
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${groupPage}` })
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
      await clickText('공유')
      check('★ 공유 패널이 그룹을 이름과 인원으로 보여 준다',
        await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes(${JSON.stringify(firstLabel)})`, 5000),
        await panelText())

      // 그룹 행의 레벨 바꾸기 — 그 그룹의 레벨이 바뀌고 모든 멤버의 행은 생기지 않는다.
      const serverEntries = async () => (await (await fetch(accessUrl, { headers: authed })).json()).entries
      const chooseIn = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(s, ${JSON.stringify(value)})
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      check('그룹 행의 권한을 "편집"으로 바꾼다', await chooseIn(`select[aria-label=${JSON.stringify(`${firstLabel} 권한`)}]`, 'edit'))
      const afterLevel = await (async () => {
        for (let i = 0; i < 40; i += 1) {
          const entries = await serverEntries()
          if (entries.some((e) => e.principalType === 'group' && e.level === 'edit')) return entries
          await sleep(100)
        }
        return serverEntries()
      })()
      check('★ 그룹 행의 레벨을 바꾸면 그 그룹이 바뀐다 — 모든 멤버에게 새로 주지 않는다',
        afterLevel.some((e) => e.principalType === 'group' && e.principalId === firstGroup && e.level === 'edit') &&
          !afterLevel.some((e) => e.principalType === 'workspace_everyone'),
        JSON.stringify(afterLevel))

      // 추가 고르개 — 사람과 그룹이 한 목록이다. 두 번째 그룹을 골라 넣는다.
      const secondName = `운영팀 ${Date.now()}`
      const second = (await (await postJson(groupsUrl, authed, { name: secondName })).json()).group.id
      await clickText('공유') // 닫고
      await clickText('공유') // 다시 열어 새 그룹 목록을 받는다
      await waitFor(`!!document.querySelector('select[aria-label="추가할 사람"] option[value="group:${second}"]')`, 5000)
      check('추가 고르개에 그룹이 있다 — 사람과 한 목록',
        await evaluate(`!!document.querySelector('select[aria-label="추가할 사람"] optgroup[label="그룹"] option[value="group:${second}"]')`))
      await chooseIn('select[aria-label="추가할 사람"]', `group:${second}`)
      await chooseIn('select[aria-label="줄 권한"]', 'view')
      check('"추가"를 누른다', await clickText('추가', '[role="dialog"][aria-label="공유 설정"] button'))
      const secondLabel = `그룹 · ${secondName} (0명)`
      check('★ 고른 그룹이 그룹 주체로 추가된다',
        await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes(${JSON.stringify(secondLabel)})`, 5000) &&
          (await serverEntries()).some((e) => e.principalType === 'group' && e.principalId === second && e.level === 'view'),
        await panelText())

      // 그룹 행의 "제거" — 그 그룹만 지운다.
      const removeBox = await evaluate(`(() => {
        const li = [...document.querySelectorAll('[role="dialog"][aria-label="공유 설정"] li')].find((l) => l.textContent.includes(${JSON.stringify(secondLabel)}))
        const btn = li && [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === '제거')
        if (!btn) return null
        const r = btn.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      if (removeBox) await click(removeBox.x, removeBox.y)
      const afterRemove = await (async () => {
        for (let i = 0; i < 40; i += 1) {
          const entries = await serverEntries()
          if (!entries.some((e) => e.principalId === second)) return entries
          await sleep(100)
        }
        return serverEntries()
      })()
      check('★ 그룹 행의 "제거"는 그 그룹만 지운다',
        removeBox !== null &&
          !afterRemove.some((e) => e.principalId === second) &&
          afterRemove.some((e) => e.principalId === firstGroup) &&
          afterRemove.some((e) => e.principalType === 'user' && e.principalId === ownerId),
        JSON.stringify(afterRemove))
      // 패널의 조작은 끝에 `router.refresh()` 를 부르고 그 응답은 스트림이다. 서버의 행은 이미 바뀌었어도 새로고침은 아직
      // 흐르는 중일 수 있다 — 그 사이 다음 절이 페이지를 옮기면 서버가 "destination stream closed early" 를 남겨 아래
      // "서버에서 오류가 나지 않았다"가 실패했다(한 번 · 원인은 이것으로 보인다). 흐름이 끝나게 둔다.
      await sleep(1500)

      // 그룹을 지우면 그 그룹의 부여가 사라진다.
      const delRes = await fetch(`${groupsUrl}/${firstGroup}`, { method: 'DELETE', headers: authed })
      const deleted = await delRes.json()
      check('그룹을 지운다 — 부여를 거둔 페이지 수를 돌려준다', delRes.status === 200 && deleted.nodes === 1, JSON.stringify(deleted))
      check('★ 지운 그룹으로 보던 동료는 이제 못 본다 (404)', (await fetch(accessUrl, { headers: asGroupMate })).status === 404)
      check('지운 그룹에는 줄 수 없다 (400)',
        (await postJson(accessUrl, authed, { action: 'grant', principal: { type: 'group', id: firstGroup }, level: 'view' })).status === 400)
    }

    if (sectionIf('그룹 화면 (7b · F-06-03)')) {
      // 설정의 사람 절의 "그룹" 패널(8g-2 — 전에는 홈의 절). 넣을 후보(멤버 · 게스트)는 서버 렌더가 싣으므로 화면을 열기 전에 만든다.
      const screenMate = await joinAs(workspaceId, await createUser('화면 동료'), 'member')
      const screenGuest = await joinAs(workspaceId, await createUser('화면 손님'), 'guest')
      const groupsUrl = `${BASE}/api/workspaces/${workspaceId}/groups`
      const serverGroups = async () => (await (await fetch(groupsUrl, { headers: authed })).json()).groups
      const row = (id) => `[data-testid="group-row"][data-group-id="${id}"]`
      const panelMessage = () => evaluate(`document.querySelector('[data-testid="group-panel"] [role="alert"], [data-testid="group-panel"] [role="status"]')?.textContent ?? ''`)
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }
      const typeInto = async (sel, text) => {
        await clickOnSel(sel)
        await evaluate(`document.querySelector(${JSON.stringify(sel)})?.select()`)
        await send('Input.insertText', { text })
      }
      const chooseValue = (sel, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(sel)})
        if (!s) return false
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)})
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.people` })
      await waitFor(`!!document.querySelector('[data-testid="group-panel"]')`, 15000)
      check('설정의 사람 절에 그룹 패널이 있고 소유자에게는 만들기 칸이 있다(8g-2 — 홈에서 옮겼다)',
        await evaluate(`!!document.querySelector('[data-testid="group-create-name"]')`))

      // ① 만들기
      const planName = `기획팀 ${Date.now()}`
      await typeInto('[data-testid="group-create-name"]', planName)
      await clickOnSel('[data-testid="group-create"]')
      check('★ 만든 그룹이 목록에 선다 — 0명',
        await waitFor(`[...document.querySelectorAll('[data-testid="group-row"]')].some((r) => r.querySelector('[data-testid="group-name"]')?.textContent === ${JSON.stringify(planName)} && r.querySelector('[data-testid="group-count"]')?.textContent === '0명')`, 5000))
      const plan = (await serverGroups()).find((g) => g.name === planName)
      check('서버에도 그 그룹이 있다', plan !== undefined)

      await typeInto('[data-testid="group-create-name"]', planName.toLowerCase())
      await clickOnSel('[data-testid="group-create"]')
      check('같은 이름이면 말한다',
        await waitFor(`(document.querySelector('[data-testid="group-error"]')?.textContent ?? '') === '같은 이름의 그룹이 이미 있습니다.'`, 5000),
        await panelMessage())

      // ② 펼쳐서 넣기
      await clickOnSel(`${row(plan.id)} [data-testid="group-toggle"]`)
      await waitFor(`!!document.querySelector('${row(plan.id)} [data-testid="group-member-add"]')`, 5000)
      const options = await evaluate(`[...document.querySelectorAll('${row(plan.id)} [data-testid="group-member-add"] option')].map((o) => o.value)`)
      check('★ 게스트는 넣을 사람 고르개에 없다 — 멤버는 있다',
        options.includes(screenMate.userId) && !options.includes(screenGuest.userId), JSON.stringify(options))
      await chooseValue(`${row(plan.id)} [data-testid="group-member-add"]`, screenMate.userId)
      await clickOnSel(`${row(plan.id)} [data-testid="group-member-add-button"]`)
      check('★ 넣은 사람이 그룹에 서고 인원이 1이 된다',
        await waitFor(`!!document.querySelector('${row(plan.id)} [data-testid="group-member"][data-user-id="${screenMate.userId}"]') && document.querySelector('${row(plan.id)} [data-testid="group-count"]')?.textContent === '1명'`, 5000))
      check('넣은 사람은 고르개에서 빠진다',
        !(await evaluate(`[...document.querySelectorAll('${row(plan.id)} [data-testid="group-member-add"] option')].some((o) => o.value === ${JSON.stringify(screenMate.userId)})`)))

      // ③ 이름 바꾸기
      const renamedName = `${planName} (새 이름)`
      await clickOnSel(`${row(plan.id)} [data-testid="group-rename"]`)
      await waitFor(`!!document.querySelector('${row(plan.id)} [data-testid="group-rename-input"]')`, 3000)
      await typeInto(`${row(plan.id)} [data-testid="group-rename-input"]`, renamedName)
      await clickOnSel(`${row(plan.id)} [data-testid="group-rename-save"]`)
      check('★ 이름을 바꾸면 목록과 서버가 함께 바뀐다',
        (await waitFor(`document.querySelector('${row(plan.id)} [data-testid="group-name"]')?.textContent === ${JSON.stringify(renamedName)}`, 5000)) &&
          (await serverGroups()).some((g) => g.id === plan.id && g.name === renamedName))

      // ④ 빼기
      await clickOnSel(`${row(plan.id)} [data-testid="group-member"][data-user-id="${screenMate.userId}"] [data-testid="group-member-remove"]`)
      check('빼면 그룹에서 사라지고 인원이 0이 된다',
        await waitFor(`!document.querySelector('${row(plan.id)} [data-testid="group-member"]') && document.querySelector('${row(plan.id)} [data-testid="group-count"]')?.textContent === '0명'`, 5000))

      // ⑤ 지우기 — 두 번 누른다
      await clickOnSel(`${row(plan.id)} [data-testid="group-delete"]`)
      check('지우기는 한 번 더 묻는다 — 공유가 함께 사라진다고 말한다',
        (await evaluate(`!!document.querySelector('${row(plan.id)} [data-testid="group-delete-confirm"]')`)) &&
          (await evaluate(`document.querySelector('${row(plan.id)}')?.textContent ?? ''`)).includes('공유도 함께 사라집니다'))
      check('아직 서버에는 그대로다', (await serverGroups()).some((g) => g.id === plan.id))
      await clickOnSel(`${row(plan.id)} [data-testid="group-delete-confirm"]`)
      check('★ 두 번째에 지워진다 — 목록에서도 서버에서도',
        (await waitFor(`!document.querySelector('${row(plan.id)}')`, 5000)) && !(await serverGroups()).some((g) => g.id === plan.id))
      check('지웠다고 말한다', (await panelMessage()).includes('그룹을 지웠습니다'), await panelMessage())

      // ⑥ 지우면 관리자가 남지 않는 페이지가 생기면 — 거부하고 몇 페이지인지 말한다
      const keeperName = `관리자 그룹 ${Date.now()}`
      const keeper = (await (await fetch(groupsUrl, { method: 'POST', headers: authed, body: JSON.stringify({ name: keeperName }) })).json()).group.id
      await fetch(`${groupsUrl}/${keeper}/members`, { method: 'POST', headers: authed, body: JSON.stringify({ userId: ctx.userId }) })
      const kept = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
      const keptAccess = `${BASE}/api/workspaces/${workspaceId}/pages/${kept}/access`
      for (const body of [
        { action: 'restrict' },
        { action: 'grant', principal: { type: 'group', id: keeper }, level: 'full_access' },
        { action: 'revoke', principal: { type: 'workspace_everyone' } },
      ]) {
        await fetch(keptAccess, { method: 'POST', headers: authed, body: JSON.stringify(body) })
      }
      const keptEntries = (await (await fetch(keptAccess, { headers: authed })).json()).entries
      check('전제: 그 페이지를 관리하는 것은 그룹 하나다',
        keptEntries.length === 1 && keptEntries[0].principalType === 'group', JSON.stringify(keptEntries))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.people` })
      await waitFor(`!!document.querySelector('${row(keeper)}')`, 15000)
      await clickOnSel(`${row(keeper)} [data-testid="group-delete"]`)
      await clickOnSel(`${row(keeper)} [data-testid="group-delete-confirm"]`)
      check('★ 관리자가 남지 않는 페이지가 생기는 지우기는 거부되고 그 수를 말한다',
        await waitFor(`(document.querySelector('[data-testid="group-error"]')?.textContent ?? '').includes('아무도 남지 않는 페이지 1개')`, 5000),
        await panelMessage())
      check('거부됐으니 그룹은 그대로다', (await evaluate(`!!document.querySelector('${row(keeper)}')`)) && (await serverGroups()).some((g) => g.id === keeper))

      // ⑦ 누가 무엇을 보는가 — 서버 렌더를 그 사람의 세션으로 받는다
      // 게스트가 사람 절을 주소로 열면 볼 수 있는 첫 절(내 계정)이 선다 — 그룹 패널이 없어야 한다.
      const homeAs = async (actor) =>
        (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.people`, { headers: { cookie: `nc_session=${actor.token}` } })).text()
      const asMember = await homeAs(screenMate)
      check('★ 멤버는 그룹을 보지만 만들기 · 지우기 버튼은 없다',
        asMember.includes('data-testid="group-panel"') && asMember.includes(keeperName) &&
          !asMember.includes('data-testid="group-create-name"') && !asMember.includes('data-testid="group-delete"'))
      const asGuest = await homeAs(screenGuest)
      check('★ 게스트에게는 그룹 절이 없다', !asGuest.includes('data-testid="group-panel"') && !asGuest.includes(keeperName))
    }

    if (sectionIf('teamspace — 라우트 · 공유 패널 (7c-1 · F-06-04)')) {
      // 화면(사이드바 섹션 · 설정)은 다음 절(7c-2)이 본다. 여기서는 라우트로 만들고, teamspace 의 페이지가 실제 화면에서 열리고
      // 공유 패널이 teamspace 노드의 부여를 "상위에서 상속됨"으로 그리는지 본다.
      const teamMate = await joinAs(workspaceId, await createUser('팀 동료'), 'member')
      const teamGuest = await joinAs(workspaceId, await createUser('팀 손님'), 'guest')
      const asTeamMate = { ...json, cookie: `nc_session=${teamMate.token}` }
      const asTeamGuest = { ...json, cookie: `nc_session=${teamGuest.token}` }
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const postJ = (url, headers, body) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })

      const teamName = `제품팀 ${Date.now()}`
      const madeRes = await postJ(tsUrl, authed, { name: teamName })
      const made = await madeRes.json()
      check('teamspace 를 만든다 (201) — 만든 사람이 owner', madeRes.status === 201 && made.teamspace?.role === 'owner', JSON.stringify(made))
      const team = made.teamspace.id
      check('게스트는 teamspace 를 못 만든다 (403)', (await postJ(tsUrl, asTeamGuest, { name: '몰래' })).status === 403)

      const pageRes = await postJ(`${BASE}/api/workspaces/${workspaceId}/pages`, authed, { teamspaceId: team, title: '로드맵' })
      const teamPage = (await pageRes.json()).page
      check('teamspace 의 최상위에 페이지를 만든다', pageRes.status === 200 && teamPage?.teamspaceId === team, JSON.stringify(teamPage))
      const teamAccess = `${BASE}/api/workspaces/${workspaceId}/pages/${teamPage.id}/access`
      check('★ teamspace 멤버가 아닌 워크스페이스 멤버는 그 페이지를 못 본다 (404)',
        (await fetch(teamAccess, { headers: asTeamMate })).status === 404)
      check('멤버가 아니면 페이지를 둘 수도 없다 (404)',
        (await postJ(`${BASE}/api/workspaces/${workspaceId}/pages`, asTeamMate, { teamspaceId: team })).status === 404)

      const addRes = await postJ(`${tsUrl}/${team}/members`, authed, { principal: { type: 'user', id: teamMate.userId } })
      check('동료를 멤버로 넣는다', addRes.status === 200, await addRes.text())
      check('★ 멤버가 되면 본다 — 최상위 목록에도 선다',
        (await fetch(teamAccess, { headers: asTeamMate })).status === 200 &&
          (await (await fetch(`${tsUrl}/${team}/pages`, { headers: asTeamMate })).json()).pages.some((p) => p.id === teamPage.id))
      const mine = (await (await fetch(tsUrl, { headers: asTeamMate })).json()).teamspaces
      check('동료의 teamspace 목록에 member 로 선다', mine.some((s) => s.id === team && s.role === 'member'), JSON.stringify(mine))
      check('게스트는 멤버로 넣을 수 없다 (400)',
        (await postJ(`${tsUrl}/${team}/members`, authed, { principal: { type: 'user', id: teamGuest.userId } })).status === 400)

      // 화면 — 페이지가 열리고, 공유 패널이 teamspace 의 부여를 이름으로 그린다.
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${teamPage.id}` })
      await waitFor(`!!document.querySelector('.blk-editor')`, 15000)
      check('teamspace 의 페이지가 화면에서 열린다', await evaluate(`!!document.querySelector('.blk-editor')`))
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
      await clickText('공유')
      const teamLabel = `teamspace · ${teamName} 멤버`
      check('★ 공유 패널이 teamspace 의 부여를 이름으로 · "상위에서 상속됨"으로 그린다',
        await waitFor(`[...document.querySelectorAll('[role="dialog"][aria-label="공유 설정"] li')].some((li) => li.textContent.includes(${JSON.stringify(teamLabel)}) && li.textContent.includes('상위에서 상속됨'))`, 5000),
        await panelText())
      await clickText('공유')

      // 역할 · 빼기
      const memberUrl = (userId) => `${tsUrl}/${team}/members/user/${userId}`
      check('마지막 owner 는 나갈 수 없다 (409)',
        (await fetch(memberUrl(ctx.userId), { method: 'DELETE', headers: authed })).status === 409)
      check('멤버는 역할을 못 바꾼다 (403)',
        (await fetch(memberUrl(teamMate.userId), { method: 'PATCH', headers: asTeamMate, body: JSON.stringify({ role: 'owner' }) })).status === 403)
      check('동료가 스스로 나간다', (await fetch(memberUrl(teamMate.userId), { method: 'DELETE', headers: asTeamMate })).status === 200)
      check('★ 나가면 곧바로 못 본다 (404)', (await fetch(teamAccess, { headers: asTeamMate })).status === 404)
    }

    if (sectionIf('teamspace 화면 (7c-2 · F-06-04)')) {
      // 사이드바의 Teamspaces 섹션 · 만들기 폼 · teamspace 화면(멤버 · 역할 · 나가기) · breadcrumb. 넣을 후보는 서버 렌더가
      // 싣으므로 화면을 열기 전에 만든다.
      const uiMate = await joinAs(workspaceId, await createUser('화면 팀원'), 'member')
      const uiGuest = await joinAs(workspaceId, await createUser('화면 팀 손님'), 'guest')
      const uiOutsider = await joinAs(workspaceId, await createUser('화면 바깥 사람'), 'member')
      const uiGroup = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/groups`, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: `디자인 그룹 ${Date.now()}` }),
      })).json()).group
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const pageAs = (actor, path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${actor.token}` } })
      const tsMessage = () => evaluate(`document.querySelector('[data-testid="teamspace-error"]')?.textContent ?? ''`)
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }
      const typeInto = async (sel, text) => {
        await clickOnSel(sel)
        await evaluate(`document.querySelector(${JSON.stringify(sel)})?.select()`)
        await send('Input.insertText', { text })
      }
      const chooseValue = (sel, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(sel)})
        if (!s) return false
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)})
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)

      // ① 만들기 — 사이드바 머리의 +
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="sidebar-teamspaces"]')`, 15000)
      check('사이드바에 Teamspaces 섹션과 만들기 버튼이 있고 · 나머지는 "워크스페이스 페이지" 머리 아래다',
        await evaluate(`!!document.querySelector('[data-testid="teamspace-create-open"]') && document.querySelector('section[aria-label="워크스페이스 페이지"] h2')?.textContent === '워크스페이스 페이지'`))
      const designName = `디자인팀 ${Date.now()}`
      await clickOnSel('[data-testid="teamspace-create-open"]')
      await waitFor(`!!document.querySelector('[data-testid="teamspace-create-name"]')`, 5000)
      await typeInto('[data-testid="teamspace-create-name"]', designName)
      await clickOnSel('[data-testid="teamspace-create"]')
      check('★ 만들면 그 teamspace 화면으로 옮겨 가고 사이드바에 선다 — 만든 사람은 소유자',
        await waitFor(`location.pathname.includes('/teamspaces/')
          && document.querySelector('[data-testid="teamspace-name"]')?.textContent === ${JSON.stringify(designName)}
          && [...document.querySelectorAll('[data-testid="sidebar-teamspace-link"]')].some((a) => a.textContent === ${JSON.stringify(designName)})
          && document.querySelector('[data-testid="teamspace-my-role"]')?.textContent === '소유자'`, 15000),
        await evaluate('location.pathname'))
      const design = await evaluate(`location.pathname.split('/teamspaces/')[1]`)
      const tsRow = `[data-testid="sidebar-teamspace"][data-teamspace-id="${design}"]`
      check('사이드바의 그 teamspace 줄이 강조되고 · 페이지가 없다고 말한다',
        await evaluate(`document.querySelector('${tsRow} [data-testid="sidebar-teamspace-link"]')?.getAttribute('aria-current') === 'page'
          && document.querySelector('${tsRow}').textContent.includes('페이지 없음')`))

      // ② 페이지 — 사이드바의 teamspace +
      await clickOnSel(`${tsRow} [data-testid="sidebar-teamspace-add"]`)
      check('★ teamspace 의 + 로 새 페이지 — 그 페이지로 옮겨 가고 사이드바의 그 teamspace 아래에 선다',
        await waitFor(`!location.pathname.includes('/teamspaces/') && !!document.querySelector('.blk-editor')
          && !!document.querySelector('${tsRow} a[href="' + location.pathname + '"]')`, 15000),
        await evaluate('location.pathname'))
      const designPage = await evaluate(`location.pathname.split('/').pop()`)
      check('"워크스페이스 페이지" 에는 없다 — 서버도 그 teamspace 의 최상위로 안다',
        !(await evaluate(`!!document.querySelector('section[aria-label="워크스페이스 페이지"] a[href$="/${designPage}"]')`)) &&
          (await (await fetch(`${tsUrl}/${design}/pages`, { headers: authed })).json()).pages.some((p) => p.id === designPage))
      check('★ breadcrumb 에 teamspace 이름이 서고 그 화면으로 간다',
        await waitFor(`document.querySelector('[data-testid="breadcrumb-teamspace"]')?.textContent === ${JSON.stringify(designName)}
          && document.querySelector('[data-testid="breadcrumb-teamspace"]').getAttribute('href') === '/w/${workspaceId}/teamspaces/${design}'`, 5000))

      // ③ 멤버 — teamspace 화면
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${design}` })
      await waitFor(`!!document.querySelector('[data-testid="teamspace-add-choice"]')`, 15000)
      check('teamspace 화면의 페이지 목록에 그 페이지가 선다',
        await evaluate(`!!document.querySelector('[data-testid="teamspace-pages"] a[href$="/${designPage}"]')`))
      const choices = await evaluate(`[...document.querySelectorAll('[data-testid="teamspace-add-choice"] option')].map((o) => o.value)`)
      check('★ 고르개에 사람과 그룹이 있고 · 게스트와 이미 멤버인 나는 없다',
        choices.includes(`user:${uiMate.userId}`) && choices.includes(`group:${uiGroup.id}`) &&
          !choices.includes(`user:${uiGuest.userId}`) && !choices.includes(`user:${ctx.userId}`), JSON.stringify(choices))
      const memberRow = (type, id) => `[data-testid="teamspace-member"][data-principal="${type}:${id}"]`
      const roleOf = (type, id) => evaluate(`document.querySelector('${memberRow(type, id)} [data-testid="teamspace-member-role"]')?.value ?? null`)
      await chooseValue('[data-testid="teamspace-add-choice"]', `user:${uiMate.userId}`)
      await clickOnSel('[data-testid="teamspace-add"]')
      check('★ 넣은 사람이 멤버로 선다 · 고르개에서 빠진다',
        await waitFor(`document.querySelector('${memberRow('user', uiMate.userId)} [data-testid="teamspace-member-role"]')?.value === 'member'
          && ![...document.querySelectorAll('[data-testid="teamspace-add-choice"] option')].some((o) => o.value === 'user:${uiMate.userId}')`, 5000),
        await tsMessage())
      check('넣은 사람은 곧바로 그 페이지를 본다',
        (await pageAs(uiMate, `/api/workspaces/${workspaceId}/pages/${designPage}/access`)).status === 200)

      // ④ 역할 — 마지막 소유자 · 올리기 · 그룹 · 빼기 · 스스로 내려놓기
      await chooseValue(`${memberRow('user', ctx.userId)} [data-testid="teamspace-member-role"]`, 'member')
      check('★ 마지막 소유자는 내려갈 수 없다 — 까닭을 말하고 역할은 그대로다',
        await waitFor(`(document.querySelector('[data-testid="teamspace-error"]')?.textContent ?? '').includes('마지막 소유자')`, 5000)
          && (await roleOf('user', ctx.userId)) === 'owner',
        await tsMessage())
      await chooseValue(`${memberRow('user', uiMate.userId)} [data-testid="teamspace-member-role"]`, 'owner')
      check('역할을 소유자로 올린다 — 서버에도',
        (await waitFor(`document.querySelector('${memberRow('user', uiMate.userId)} [data-testid="teamspace-member-role"]')?.value === 'owner'`, 5000)) &&
          (await (await fetch(`${tsUrl}/${design}`, { headers: authed })).json()).members.some((m) => m.principal.id === uiMate.userId && m.role === 'owner'))
      await chooseValue('[data-testid="teamspace-add-choice"]', `group:${uiGroup.id}`)
      await clickOnSel('[data-testid="teamspace-add"]')
      check('그룹도 넣는다 — "그룹 · 이름" 으로 선다',
        await waitFor(`document.querySelector('${memberRow('group', uiGroup.id)}')?.textContent.includes(${JSON.stringify(`그룹 · ${uiGroup.name}`)})`, 5000),
        await tsMessage())
      await clickOnSel(`${memberRow('group', uiGroup.id)} [data-testid="teamspace-member-remove"]`)
      check('소유자는 다른 멤버를 뺀다', await waitFor(`!document.querySelector('${memberRow('group', uiGroup.id)}')`, 5000))
      await chooseValue(`${memberRow('user', ctx.userId)} [data-testid="teamspace-member-role"]`, 'member')
      check('★ 스스로 소유자를 내려놓으면 그 자리에서 바뀐다 — 역할 고르개 · 빼기 · 소유자로 넣기가 사라진다',
        await waitFor(`document.querySelector('[data-testid="teamspace-my-role"]')?.textContent === '멤버'
          && !document.querySelector('[data-testid="teamspace-member-role"]') && !document.querySelector('[data-testid="teamspace-member-remove"]')
          && !document.querySelector('[data-testid="teamspace-add-role"]') && !!document.querySelector('[data-testid="teamspace-add-choice"]')`, 5000),
        await tsMessage())

      // ⑤ 누가 무엇을 보는가 — 서버 렌더를 그 사람의 세션으로 받는다
      const mateHome = await (await pageAs(uiMate, `/w/${workspaceId}`)).text()
      check('★ 멤버의 사이드바에는 그 teamspace 와 페이지가 선다',
        mateHome.includes(`data-teamspace-id="${design}"`) && mateHome.includes(designPage))
      const outsiderHome = await (await pageAs(uiOutsider, `/w/${workspaceId}`)).text()
      check('★ 멤버가 아닌 사람의 사이드바에는 없다 — id 도 이름도 페이지도',
        outsiderHome.includes('data-testid="sidebar-teamspaces"') &&
          !outsiderHome.includes(design) && !outsiderHome.includes(designName) && !outsiderHome.includes(designPage))
      check('멤버가 아닌 사람에게 teamspace 화면은 404 다',
        (await pageAs(uiOutsider, `/w/${workspaceId}/teamspaces/${design}`)).status === 404)
      const guestHome = await (await pageAs(uiGuest, `/w/${workspaceId}`)).text()
      check('★ 게스트의 사이드바에는 Teamspaces 섹션이 없다',
        guestHome.includes('aria-label="페이지 트리"') && !guestHome.includes('data-testid="sidebar-teamspaces"'))
      // 멤버가 아닌 사람에게 그 페이지만 따로 공유하면 — 공유됨 섹션에 선다(7c-7).
      const shared = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${designPage}/access`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: uiOutsider.userId }, level: 'view' }),
      })
      const outsiderShared = await (await pageAs(uiOutsider, `/w/${workspaceId}`)).text()
      const outsiderPage = await pageAs(uiOutsider, `/w/${workspaceId}/${designPage}`)
      const outsiderPageHtml = await outsiderPage.text()
      check('★ 따로 공유받은 teamspace 페이지는 "공유됨" 에 선다(7c-7) — 사이드바에 그 teamspace 의 id 가 가지 않는다',
        shared.ok && outsiderShared.includes('data-testid="sidebar-shared"') && outsiderShared.includes(designPage) &&
          !outsiderShared.includes(design), `공유 ${shared.status}`)
      check('★ 그 페이지의 breadcrumb 에도 teamspace 가 없다 — 멤버가 아니다',
        outsiderPage.status === 200 && !outsiderPageHtml.includes('data-testid="breadcrumb-teamspace"') && !outsiderPageHtml.includes(designName),
        `페이지 ${outsiderPage.status}`)

      // ⑥ 나가기 — 두 번 누른다
      await clickOnSel(`${memberRow('user', ctx.userId)} [data-testid="teamspace-leave"]`)
      check('나가기는 한 번 더 묻는다 — 무엇을 잃는지 말한다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-leave-confirm"]')
          && document.querySelector('${memberRow('user', ctx.userId)}').textContent.includes('곧바로 못 봅니다')`, 5000))
      await clickOnSel('[data-testid="teamspace-leave-confirm"]')
      check('★ 나가면 홈으로 가고 사이드바에서 그 teamspace 가 사라진다',
        await waitFor(`location.pathname === '/w/${workspaceId}' && !!document.querySelector('[data-testid="sidebar-teamspaces"]')
          && !document.querySelector('${tsRow}')`, 15000),
        await evaluate('location.pathname'))
      check('나간 teamspace 의 화면은 404 다', (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${design}`, { headers: authed })).status === 404)
      // 나가기의 refresh 가 끝나기 전에 다음 절이 화면을 옮기면 서버가 "destination stream closed early" 를 남긴다(§6).
      await sleep(1500)
    }

    if (sectionIf('옮기기 — teamspace 로 · 밖으로 (7c-3 · F-06-20)')) {
      // 페이지의 "이동" 피커가 teamspace 최상위와 워크스페이스 최상위를 자리로 준다. 옮기면 누가 보는지가 바뀐다 — 워크스페이스
      // 최상위의 "모든 멤버" 상속 행을 거두고 teamspace 노드에서 물려받는다. 멤버가 아닌 동료의 접근으로 확인한다.
      const moveMate = await joinAs(workspaceId, await createUser('이동 동료'), 'member')
      const asMoveMate = { ...json, cookie: `nc_session=${moveMate.token}` }
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const moveName = `이동팀 ${Date.now()}`
      const moveTeam = (await (await fetch(tsUrl, { method: 'POST', headers: authed, body: JSON.stringify({ name: moveName }) })).json()).teamspace.id
      const docTitle = `옮길 문서 ${Date.now()}`
      const doc = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: docTitle }),
      })).json()).page.id
      const docAccess = `${BASE}/api/workspaces/${workspaceId}/pages/${doc}/access`
      const tsRow = `[data-testid="sidebar-teamspace"][data-teamspace-id="${moveTeam}"]`
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }
      const openPicker = async () => {
        await clickOnSel('[data-testid="move-open"]')
        return waitFor(`!!document.querySelector('[data-testid="move-picker"]')`, 5000)
      }
      check('전제: 워크스페이스 최상위 문서는 동료도 본다', (await fetch(docAccess, { headers: asMoveMate })).status === 200)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
      await waitFor(`!!document.querySelector('[data-testid="move-open"]')`, 15000)
      await openPicker()
      const option = `[data-testid="move-to-teamspace"][data-teamspace-id="${moveTeam}"]`
      check('★ 이동 피커에 teamspace 가 자리로 서고 · 누가 보게 되는지 말한다 · 이미 최상위라 "워크스페이스 최상위"는 없다',
        await evaluate(`(document.querySelector('${option}')?.textContent ?? '').includes(${JSON.stringify(`${moveName} 멤버가 봅니다`)})
          && !document.querySelector('[data-testid="move-to-workspace"]')`))
      await clickOnSel(option)
      await confirmMoveIfAsked()
      check('★ teamspace 로 옮기면 사이드바의 그 teamspace 아래에 서고 breadcrumb 에 이름이 선다',
        await waitFor(`!!document.querySelector('${tsRow} a[href$="/${doc}"]')
          && document.querySelector('[data-testid="breadcrumb-teamspace"]')?.textContent === ${JSON.stringify(moveName)}`, 15000),
        await evaluate(`document.querySelector('[data-testid="move-error"]')?.textContent ?? '(오류 없음)'`))
      check('서버도 그 teamspace 의 최상위로 안다',
        (await (await fetch(`${tsUrl}/${moveTeam}/pages`, { headers: authed })).json()).pages.some((pg) => pg.id === doc))
      check('★ 멤버가 아닌 동료는 이제 못 본다 (404) — 모두에게 준 상속 행을 거뒀다',
        (await fetch(docAccess, { headers: asMoveMate })).status === 404)

      await openPicker()
      check('옮긴 teamspace 는 "현재 위치" 로 서고 · "워크스페이스 최상위" 가 생긴다',
        await evaluate(`document.querySelector('${option}')?.disabled === true
          && (document.querySelector('${option}')?.textContent ?? '').includes('현재 위치')
          && !!document.querySelector('[data-testid="move-to-workspace"]')`))
      await clickOnSel('[data-testid="move-to-workspace"]')
      await confirmMoveIfAsked()
      check('★ 워크스페이스 최상위로 꺼내면 teamspace 에서 빠지고 동료가 다시 본다',
        (await waitFor(`!document.querySelector('${tsRow} a[href$="/${doc}"]')
          && !!document.querySelector('section[aria-label="워크스페이스 페이지"] a[href$="/${doc}"]')
          && !document.querySelector('[data-testid="breadcrumb-teamspace"]')`, 15000))
          && (await fetch(docAccess, { headers: asMoveMate })).status === 200)

      // 뿌리를 바꾸는 이동은 전체 권한이 있어야 한다 — 고치기만 받은 동료가 옮기려 하면 까닭과 함께 거부한다. 위 흐름과 따로
      // 새 페이지로 본다(위 흐름이 실패해도 이 검사가 따로 선다).
      await fetch(`${tsUrl}/${moveTeam}/members`, { method: 'POST', headers: authed, body: JSON.stringify({ principal: { type: 'user', id: moveMate.userId } }) })
      const locked = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `고치기만 준 문서 ${Date.now()}` }),
      })).json()).page.id
      const shareDoc = (body) =>
        fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${locked}/access`, { method: 'POST', headers: authed, body: JSON.stringify(body) })
      await shareDoc({ action: 'grant', principal: { type: 'user', id: ctx.userId }, level: 'full_access' })
      await shareDoc({ action: 'revoke', principal: { type: 'workspace_everyone' } })
      await shareDoc({ action: 'grant', principal: { type: 'user', id: moveMate.userId }, level: 'edit' })
      const denied = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${locked}/move`, {
        method: 'POST', headers: asMoveMate, body: JSON.stringify({ targetTeamspaceId: moveTeam }),
      })
      check('★ 고치기만 받은 사람이 teamspace 로 옮기면 403 needs_full_access',
        denied.status === 403 && (await denied.json()).error === 'needs_full_access', String(denied.status))
      // 마지막 이동의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('데이터베이스를 teamspace 에 (7c-4 · F-04-14 · F-06-04)')) {
      // 사이드바의 teamspace 줄에 "▦"(새 데이터베이스), teamspace 화면에 "+ 새 데이터베이스". 멤버만 보는지는 멤버가 아닌 동료의
      // 세션으로 표 화면을 받아 본다.
      const dbMate = await joinAs(workspaceId, await createUser('표 동료'), 'member')
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const dbTeamName = `표팀 ${Date.now()}`
      const dbTeam = (await (await fetch(tsUrl, { method: 'POST', headers: authed, body: JSON.stringify({ name: dbTeamName }) })).json()).teamspace.id
      const tsRow = `[data-testid="sidebar-teamspace"][data-teamspace-id="${dbTeam}"]`
      const dbPageAs = (actor, id) => fetch(`${BASE}/w/${workspaceId}/db/${id}`, { headers: { cookie: `nc_session=${actor.token}` } })
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('${tsRow} [data-testid="sidebar-teamspace-add-database"]')`, 15000)
      await clickOnSel(`${tsRow} [data-testid="sidebar-teamspace-add-database"]`)
      check('★ 사이드바의 teamspace ▦ 로 새 데이터베이스 — 표가 열리고 그 teamspace 아래에 선다',
        await waitFor(`location.pathname.includes('/db/') && !!document.querySelector('${tsRow} a[href="' + location.pathname + '"]')`, 15000),
        await evaluate('location.pathname'))
      const firstDb = await evaluate(`location.pathname.split('/db/')[1]?.split('/')[0] ?? ''`)
      check('★ 멤버가 아닌 동료는 그 표를 못 연다 (404) — 만든 사람은 연다',
        (await dbPageAs(dbMate, firstDb)).status === 404 && (await fetch(`${BASE}/w/${workspaceId}/db/${firstDb}`, { headers: authed })).status === 200)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${dbTeam}` })
      await waitFor(`!!document.querySelector('[data-testid="new-database"]')`, 15000)
      check('teamspace 화면의 데이터베이스 목록에 선다',
        await evaluate(`!!document.querySelector('[data-testid="teamspace-databases"] a[href$="/db/${firstDb}"]')`))
      await clickOnSel('[data-testid="new-database"]')
      check('teamspace 화면의 "+ 새 데이터베이스" 로도 만든다 — 그 teamspace 아래에 선다',
        await waitFor(`location.pathname.includes('/db/') && !location.pathname.includes(${JSON.stringify(firstDb)})
          && !!document.querySelector('${tsRow} a[href="' + location.pathname + '"]')`, 15000),
        await evaluate('location.pathname'))

      const denied = await fetch(`${BASE}/api/workspaces/${workspaceId}/databases`, {
        method: 'POST', headers: { ...json, cookie: `nc_session=${dbMate.token}` }, body: JSON.stringify({ teamspaceId: dbTeam }),
      })
      check('멤버가 아니면 그 teamspace 에 표를 못 둔다 (404)', denied.status === 404, String(denied.status))
      // 마지막 만들기의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('공개 범위 · 둘러보기 · 참여 (7c-5 · F-06-04)')) {
      // 만들기 폼의 공개 범위 · 사이드바의 ⌕ · 둘러보기 화면(참여 · 초대 필요 · private 는 없음) · 소유자만 보는 설정.
      // **내가 멤버가 아닌** open teamspace 가 있어야 참여를 눌러볼 수 있으므로 동료의 세션으로 셋을 만든다.
      const browseMate = await joinAs(workspaceId, await createUser('둘러보는 동료'), 'member')
      const mateHeaders = { ...json, cookie: `nc_session=${browseMate.token}` }
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const stamp = Date.now()
      const makeTeamspace = async (headers, name, visibility) =>
        (await (await fetch(tsUrl, { method: 'POST', headers, body: JSON.stringify({ name, visibility }) })).json()).teamspace.id
      const openName = `열린팀 ${stamp}`
      const closedName = `닫힌팀 ${stamp}`
      const secretName = `숨은팀 ${stamp}`
      const mateOpen = await makeTeamspace(mateHeaders, openName, 'open')
      const mateClosed = await makeTeamspace(mateHeaders, closedName, 'closed')
      const mateSecret = await makeTeamspace(mateHeaders, secretName, 'private')
      const row = (id) => `[data-testid="teamspace-browse-row"][data-teamspace-id="${id}"]`
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }
      const typeInto = async (sel, text) => {
        await clickOnSel(sel)
        await evaluate(`document.querySelector(${JSON.stringify(sel)})?.select()`)
        await send('Input.insertText', { text })
      }

      // ① 참여하기 전에는 그 teamspace 의 화면을 못 연다 — 열려 있다는 것이 들어와 있다는 뜻이 아니다.
      check('★ open teamspace 여도 참여하기 전에는 그 화면이 404 다',
        (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${mateOpen}`, { headers: authed })).status === 404)

      // ② 사이드바의 ⌕ → 둘러보기
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="teamspace-browse-open"]')`, 15000)
      await clickOnSel('[data-testid="teamspace-browse-open"]')
      check('★ 사이드바의 ⌕ 가 둘러보기 화면을 연다 — open 은 참여 · closed 는 초대 필요 · private 는 목록에 없다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-browse-page"]')
          && document.querySelector('${row(mateOpen)}')?.dataset.action === 'join'
          && !!document.querySelector('${row(mateOpen)} [data-testid="teamspace-join"]')
          && document.querySelector('${row(mateClosed)}')?.dataset.action === 'needs_invite'
          && !!document.querySelector('${row(mateClosed)} [data-testid="teamspace-needs-invite"]')
          && !document.querySelector('${row(mateSecret)}')`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-browse-list"]')?.textContent?.slice(0, 200) ?? location.pathname`))
      check('공개 범위 이름과 사람 수를 함께 말한다',
        await evaluate(`document.querySelector('${row(mateOpen)} [data-testid="teamspace-browse-visibility"]')?.textContent === '공개'
          && document.querySelector('${row(mateOpen)}').textContent.includes('멤버 1명')`))

      // ③ 참여
      await clickOnSel(`${row(mateOpen)} [data-testid="teamspace-join"]`)
      check('★ 참여를 누르면 그 줄이 "이미 멤버" 로 바뀌고 사이드바에 그 teamspace 가 선다',
        await waitFor(`document.querySelector('${row(mateOpen)}')?.dataset.action === 'member'
          && !!document.querySelector('${row(mateOpen)} [data-testid="teamspace-joined"]')
          && [...document.querySelectorAll('[data-testid="sidebar-teamspace-link"]')].some((a) => a.textContent === ${JSON.stringify(openName)})`, 15000),
        await evaluate(`document.querySelector('${row(mateOpen)}')?.dataset.action ?? '없음'`))
      check('★ 참여한 뒤에는 그 teamspace 화면이 열린다 — 닫힌 팀은 여전히 못 연다',
        (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${mateOpen}`, { headers: authed })).status === 200 &&
          (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${mateClosed}`, { headers: authed })).status === 404)

      // ④ 라우트의 거부
      const joinReq = (id) => fetch(`${tsUrl}/${id}/join`, { method: 'POST', headers: authed })
      const closedJoin = await joinReq(mateClosed)
      const secretJoin = await joinReq(mateSecret)
      check('참여 라우트 — closed 는 403 needs_invite · private 는 404',
        closedJoin.status === 403 && (await closedJoin.json()).error === 'needs_invite' && secretJoin.status === 404,
        `${closedJoin.status} · ${secretJoin.status}`)

      // ⑤ 만들기 폼의 공개 범위 — 7c-2 에서는 고르게 하지 않았다(§3.3-193 ⑦)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="teamspace-create-open"]')`, 15000)
      await clickOnSel('[data-testid="teamspace-create-open"]')
      await waitFor(`!!document.querySelector('[data-testid="teamspace-create-visibility"]')`, 5000)
      check('만들기 폼이 공개 범위 셋을 고르게 하고 기본은 초대(closed) 다',
        await evaluate(`document.querySelector('[data-testid="teamspace-visibility-closed"]')?.checked === true
          && !!document.querySelector('[data-testid="teamspace-visibility-open"]')
          && !!document.querySelector('[data-testid="teamspace-visibility-private"]')`))
      const myOpenName = `내가 만든 열린팀 ${stamp}`
      await typeInto('[data-testid="teamspace-create-name"]', myOpenName)
      await clickOnSel('[data-testid="teamspace-visibility-open"]')
      await clickOnSel('[data-testid="teamspace-create"]')
      check('공개로 만들면 그 teamspace 화면으로 옮겨 간다',
        await waitFor(`location.pathname.includes('/teamspaces/')
          && document.querySelector('[data-testid="teamspace-name"]')?.textContent === ${JSON.stringify(myOpenName)}`, 15000),
        await evaluate('location.pathname'))
      const myOpen = await evaluate(`location.pathname.split('/teamspaces/')[1]`)
      const mateSees = async () =>
        (await (await fetch(`${tsUrl}?scope=browse`, { headers: mateHeaders })).json()).teamspaces.find((t) => t.id === myOpen)
      // 공개 범위를 실제로 지키는 검사는 이것이다 — 위의 옮겨 가기는 범위를 싣지 않아도 통과한다(반사실 E3).
      check('★ 공개로 만든 teamspace 가 동료의 둘러보기에 참여할 수 있는 것으로 선다',
        (await mateSees())?.visibility === 'open' && (await mateSees())?.role === null,
        JSON.stringify(await mateSees()))

      // ⑥ 설정 — 소유자만
      await waitFor(`!!document.querySelector('[data-testid="teamspace-settings-save"]')`, 10000)
      const renamed = `이름 고친 팀 ${stamp}`
      await typeInto('[data-testid="teamspace-settings-name"]', renamed)
      await clickOnSel('[data-testid="teamspace-settings-visibility-private"]')
      await clickOnSel('[data-testid="teamspace-settings-save"]')
      check('★ 설정을 저장하면 그 자리에서 말하고 · 이름이 사이드바에도 바뀐다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-settings-saved"]')
          && [...document.querySelectorAll('[data-testid="sidebar-teamspace-link"]')].some((a) => a.textContent === ${JSON.stringify(renamed)})`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-settings-error"]')?.textContent ?? ''`))
      check('★ 비공개로 좁히면 동료의 둘러보기에서 사라진다', (await mateSees()) === undefined, JSON.stringify(await mateSees()))

      const mateEdit = await fetch(`${tsUrl}/${myOpen}`, { method: 'PATCH', headers: mateHeaders, body: JSON.stringify({ visibility: 'open' }) })
      check('멤버가 아니면 설정을 못 고친다 (404)', mateEdit.status === 404, String(mateEdit.status))
      // 저장의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('보관 · 복원 (7c-6 · F-06-04)')) {
      // teamspace 는 지워지지 않고 보관된다. 보관하면 **소유자까지** 못 보고, 되살릴 사람만 둘러보기 화면에서 그 존재를 본다.
      const archiveMate = await joinAs(workspaceId, await createUser('보관 동료'), 'member')
      const mateHeaders = { ...json, cookie: `nc_session=${archiveMate.token}` }
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const stamp = Date.now()
      const archiveName = `보관할팀 ${stamp}`
      const created = await (await fetch(tsUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: archiveName, visibility: 'closed' }),
      })).json()
      const doomed = created.teamspace.id
      await fetch(`${tsUrl}/${doomed}/members`, {
        method: 'POST', headers: authed, body: JSON.stringify({ principal: { type: 'user', id: archiveMate.userId } }),
      })
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }

      // ① 그 teamspace 에 페이지를 하나 두고, 보관 전에 둘 다 볼 수 있음을 확인한다(만들기는 라우트로 — 이 절이
      //    보려는 것은 보관이다).
      const doomedPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ teamspaceId: doomed }),
      })).json()).page.id
      const pageAs = (actor, path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${actor.token}` } })
      check('보관하기 전에는 소유자와 멤버가 그 페이지를 본다',
        (await fetch(`${BASE}/w/${workspaceId}/${doomedPage}`, { headers: authed })).status === 200 &&
          (await pageAs(archiveMate, `/w/${workspaceId}/${doomedPage}`)).status === 200)

      // ② 설정 절의 보관 — 두 번 누른다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${doomed}` })
      await waitFor(`!!document.querySelector('[data-testid="teamspace-archive"]')`, 15000)
      check('보관은 한 번에 되지 않는다 — 먼저 무엇이 일어나는지 말한다',
        await evaluate(`!document.querySelector('[data-testid="teamspace-archive-confirm"]')
          && document.querySelector('[data-testid="teamspace-settings"]').textContent.includes('지워지지 않고')`))
      await clickOnSel('[data-testid="teamspace-archive"]')
      check('한 번 누르면 확인 버튼이 선다', await waitFor(`!!document.querySelector('[data-testid="teamspace-archive-confirm"]')`, 5000))
      await clickOnSel('[data-testid="teamspace-archive-confirm"]')
      check('★ 보관하면 워크스페이스 홈으로 옮겨 가고 사이드바에서 그 teamspace 가 사라진다',
        await waitFor(`location.pathname === '/w/${workspaceId}'
          && ![...document.querySelectorAll('[data-testid="sidebar-teamspace-link"]')].some((a) => a.textContent === ${JSON.stringify(archiveName)})`, 15000),
        await evaluate('location.pathname'))
      check('★ 보관하면 소유자까지 그 페이지를 못 본다 — 멤버도 못 본다',
        (await fetch(`${BASE}/w/${workspaceId}/${doomedPage}`, { headers: authed })).status === 404 &&
          (await pageAs(archiveMate, `/w/${workspaceId}/${doomedPage}`)).status === 404)
      check('보관된 teamspace 의 화면도 소유자에게 404 다',
        (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${doomed}`, { headers: authed })).status === 404)

      // ③ 둘러보기 화면의 보관된 절 — 소유자만
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces` })
      const archivedRow = `[data-testid="teamspace-archived-row"][data-teamspace-id="${doomed}"]`
      check('★ 둘러보기 화면의 "보관된 teamspace" 에 서고 · 보관한 때를 말한다',
        await waitFor(`!!document.querySelector('${archivedRow} [data-testid="teamspace-restore"]')
          && document.querySelector('${archivedRow}').textContent.includes('오늘 보관')`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-archived-list"]')?.textContent?.slice(0, 160) ?? '목록 없음'`))
      const mateArchived = await (await fetch(`${tsUrl}?scope=archived`, { headers: mateHeaders })).json()
      check('소유자가 아닌 멤버에게는 보관된 목록이 비어 있다', !mateArchived.teamspaces.some((t) => t.id === doomed),
        JSON.stringify(mateArchived.teamspaces.map((t) => t.id)))
      const mateRestore = await fetch(`${tsUrl}/${doomed}/restore`, { method: 'POST', headers: mateHeaders })
      check('멤버는 되살리지 못한다 (403)', mateRestore.status === 403, String(mateRestore.status))

      // ④ 되살리기
      await clickOnSel(`${archivedRow} [data-testid="teamspace-restore"]`)
      check('★ 되살리면 그 줄이 목록에서 빠지고 사이드바에 teamspace 가 다시 선다',
        await waitFor(`!document.querySelector('${archivedRow}')
          && [...document.querySelectorAll('[data-testid="sidebar-teamspace-link"]')].some((a) => a.textContent === ${JSON.stringify(archiveName)})`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-archived-error"]')?.textContent ?? ''`))
      check('★ 되살리면 소유자와 멤버가 그 페이지를 다시 본다',
        (await fetch(`${BASE}/w/${workspaceId}/${doomedPage}`, { headers: authed })).status === 200 &&
          (await pageAs(archiveMate, `/w/${workspaceId}/${doomedPage}`)).status === 200)
      // 되살리기의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('개인 페이지 · 공유됨 섹션 (7c-7 · F-02-12 · F-07-16)')) {
      // 사이드바의 개인 페이지 섹션(+ 로 만들기 · 나만 본다) · 이동 피커의 "개인 페이지" · 공유됨 섹션(따로 공유받은 것).
      const privateMate = await joinAs(workspaceId, await createUser('개인 동료'), 'member')
      const mateHeaders = { ...json, cookie: `nc_session=${privateMate.token}` }
      const pageAs = (actor, path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${actor.token}` } })
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }

      // ① 새 개인 페이지 — 사이드바의 +
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="sidebar-private-add"]')`, 15000)
      check('사이드바에 개인 페이지 섹션이 있다 — 비어 있다고 말한다',
        await evaluate(`document.querySelector('[data-testid="sidebar-private"]')?.textContent.includes('나만 보는 페이지가 없습니다')
          ?? false`))
      await clickOnSel('[data-testid="sidebar-private-add"]')
      check('★ + 로 새 개인 페이지 — 편집기가 열리고 개인 페이지 섹션 아래에 선다',
        await waitFor(`!!document.querySelector('.blk-editor')
          && !!document.querySelector('[data-testid="sidebar-private"] a[href="' + location.pathname + '"]')`, 15000),
        await evaluate('location.pathname'))
      const myPrivate = await evaluate(`location.pathname.split('/').pop()`)
      check('★ 나만 본다 — 동료에게는 그 페이지가 접근 요청 화면이다(7e-1 전에는 404)',
        (await shownNoAccess(await pageAs(privateMate, `/w/${workspaceId}/${myPrivate}`))) &&
          (await fetch(`${BASE}/w/${workspaceId}/${myPrivate}`, { headers: authed })).status === 200)

      // ② 이동 피커 — 개인 → 워크스페이스 최상위 → 개인
      await waitFor(`!!document.querySelector('[data-testid="move-open"]')`, 10000)
      await clickOnSel('[data-testid="move-open"]')
      check('개인 페이지의 피커 — "개인 페이지"는 현재 위치고 "워크스페이스 최상위"가 선다',
        await waitFor(`!!document.querySelector('[data-testid="move-picker"]')
          && document.querySelector('[data-testid="move-to-private"]')?.disabled === true
          && !!document.querySelector('[data-testid="move-to-workspace"]')`, 5000))
      await clickOnSel('[data-testid="move-to-workspace"]')
      await confirmMoveIfAsked()
      check('★ 워크스페이스 최상위로 열면 동료가 보고 · 워크스페이스 페이지 섹션으로 옮겨 간다',
        await waitFor(`!document.querySelector('[data-testid="sidebar-private"] a[href="/w/${workspaceId}/${myPrivate}"]')
          && !!document.querySelector('section[aria-label="워크스페이스 페이지"] a[href="/w/${workspaceId}/${myPrivate}"]')`, 15000) &&
          (await pageAs(privateMate, `/w/${workspaceId}/${myPrivate}`)).status === 200)
      await clickOnSel('[data-testid="move-open"]')
      await waitFor(`!!document.querySelector('[data-testid="move-to-private"]')`, 5000)
      await clickOnSel('[data-testid="move-to-private"]')
      await confirmMoveIfAsked()
      check('★ 다시 개인 페이지로 — 동료는 곧바로 못 보고(접근 요청 화면) 섹션이 돌아온다',
        await waitFor(`!!document.querySelector('[data-testid="sidebar-private"] a[href="/w/${workspaceId}/${myPrivate}"]')`, 15000) &&
          (await shownNoAccess(await pageAs(privateMate, `/w/${workspaceId}/${myPrivate}`))))

      // ③ 공유됨 — 동료의 개인 페이지 하나를 따로 공유받는다
      const matePage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: mateHeaders, body: JSON.stringify({ privateTop: true, title: '동료의 개인 메모' }),
      })).json()).page
      check('전제 — 동료의 개인 페이지는 내 사이드바 어디에도 없다',
        await evaluate(`!document.querySelector('a[href="/w/${workspaceId}/${matePage.id}"]')`))
      const shareRes = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${matePage.id}/access`, {
        method: 'POST', headers: mateHeaders,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: ctx.userId }, level: 'edit' }),
      })
      check('동료가 자기 개인 페이지를 나에게 공유할 수 있다 (201/200)', shareRes.ok, String(shareRes.status))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      check('★ 공유받은 남의 개인 페이지는 "공유됨" 섹션에 선다',
        await waitFor(`!!document.querySelector('[data-testid="sidebar-shared"] a[href="/w/${workspaceId}/${matePage.id}"]')`, 15000),
        await evaluate(`document.querySelector('[data-testid="sidebar-shared"]')?.textContent ?? '섹션 없음'`))
      // 게스트에게는 개인 섹션이 없다.
      const guestNoPrivate = await joinAs(workspaceId, await createUser('개인 없는 손님'), 'guest')
      const guestHome = await (await pageAs(guestNoPrivate, `/w/${workspaceId}`)).text()
      check('게스트의 사이드바에는 개인 페이지 섹션이 없다', !guestHome.includes('sidebar-private'))
    }

    if (sectionIf('데이터베이스의 자리 — 개인 표 · 옮기기 (7c-8 · F-04-14 · F-06-20)')) {
      // 사이드바 개인 섹션의 ▦(개인 표) · 표 화면의 "이동"(워크스페이스 ↔ teamspace ↔ 개인). 이 절은 자기 데이터를
      // 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const placeMate = await joinAs(workspaceId, await createUser('표 자리 동료'), 'member')
      const dbPageAs = (actor, id) => fetch(`${BASE}/w/${workspaceId}/db/${id}`, { headers: { cookie: `nc_session=${actor.token}` } })
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const placeTeam = (await (await fetch(tsUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: `표자리팀 ${Date.now()}` }),
      })).json()).teamspace.id

      // ① 개인 표 — 사이드바 개인 섹션의 ▦
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="sidebar-private-add-database"]')`, 15000)
      await clickOnSel('[data-testid="sidebar-private-add-database"]')
      check('★ 개인 섹션의 ▦ 로 새 표 — 표가 열리고 개인 페이지 섹션 아래에 선다',
        await waitFor(`location.pathname.includes('/db/')
          && !!document.querySelector('[data-testid="sidebar-private"] a[href="' + location.pathname + '"]')`, 15000),
        await evaluate('location.pathname'))
      const privateDb = await evaluate(`location.pathname.split('/db/')[1]?.split('/')[0] ?? ''`)
      check('★ 개인 표는 나만 본다 — 동료에게는 404 다',
        (await dbPageAs(placeMate, privateDb)).status === 404 &&
          (await fetch(`${BASE}/w/${workspaceId}/db/${privateDb}`, { headers: authed })).status === 200)

      // ② 표 화면의 "이동" — 개인 → teamspace
      // 전체 판에서는 사이드바가 커서 하이드레이션이 늦다 — 버튼이 붙기 전에 눌리면 피커가 안 열린다(§6). 열릴 때까지 다시 누른다.
      const openPicker = async () => {
        for (let tries = 0; tries < 5; tries += 1) {
          await clickOnSel('[data-testid="move-open"]')
          if (await waitFor(`!!document.querySelector('[data-testid="move-picker"]')`, 3000)) return true
        }
        return false
      }
      await waitFor(`!!document.querySelector('[data-testid="move-open"]')`, 10000)
      check('표의 피커가 열린다', await openPicker())
      check('표의 피커 — 개인 페이지는 현재 위치 · 페이지 대상은 없다 · teamspace 가 선다',
        await waitFor(`document.querySelector('[data-testid="move-to-private"]')?.disabled === true
          && !document.querySelector('[data-testid="move-to-page"]')
          && !!document.querySelector('[data-testid="move-to-teamspace"][data-teamspace-id="${placeTeam}"]')`, 5000))
      await clickOnSel(`[data-testid="move-to-teamspace"][data-teamspace-id="${placeTeam}"]`)
      await confirmMoveIfAsked()
      check('★ teamspace 로 옮기면 사이드바의 그 teamspace 아래로 옮겨 간다',
        await waitFor(`!document.querySelector('[data-testid="sidebar-private"] a[href="/w/${workspaceId}/db/${privateDb}"]')
          && !!document.querySelector('[data-testid="sidebar-teamspace"][data-teamspace-id="${placeTeam}"] a[href="/w/${workspaceId}/db/${privateDb}"]')`, 15000))
      check('멤버가 아닌 동료는 여전히 못 연다 (404)', (await dbPageAs(placeMate, privateDb)).status === 404)

      // ③ 워크스페이스 최상위로 열기 — 이제 모두가 본다
      check('피커를 다시 연다', await openPicker())
      await waitFor(`!!document.querySelector('[data-testid="move-to-workspace"]')`, 5000)
      await clickOnSel('[data-testid="move-to-workspace"]')
      await confirmMoveIfAsked()
      check('★ 워크스페이스 최상위로 열면 동료가 열고 · 워크스페이스 페이지 섹션에 선다',
        await waitFor(`!!document.querySelector('section[aria-label="워크스페이스 페이지"] a[href="/w/${workspaceId}/db/${privateDb}"]')`, 15000) &&
          (await dbPageAs(placeMate, privateDb)).status === 200)

      // ④ 라우트의 거부 — 페이지 밑으로는 못 간다
      const hostPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: '표를 받을 페이지' }),
      })).json()).page.id
      const intoPage = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${privateDb}/move`, {
        method: 'POST', headers: authed, body: JSON.stringify({ targetParentId: hostPage }),
      })
      check('표를 페이지 밑으로 옮기면 400 invalid_target 이다',
        intoPage.status === 400 && (await intoPage.json()).error === 'invalid_target', String(intoPage.status))
      // 이동의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('공개 팀 공간의 열람 (7c-9 · F-06-04)')) {
      // open teamspace 는 참여 전에도 **읽는다**(view) — 링크 · 검색으로 닿고, 사이드바에는 서지 않고, 고치지는 못한다.
      // 좁히면(closed) 참여 안 한 사람이 잃는다. 이 절은 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const openMate = await joinAs(workspaceId, await createUser('열람 동료'), 'member')
      const openGuest = await joinAs(workspaceId, await createUser('열람 손님'), 'guest')
      const mateHeaders = { ...json, cookie: `nc_session=${openMate.token}` }
      const pageAs = (actor, path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${actor.token}` } })
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const stamp = Date.now()
      const openTeam = (await (await fetch(tsUrl, {
        method: 'POST', headers: mateHeaders, body: JSON.stringify({ name: `열람팀 ${stamp}`, visibility: 'open' }),
      })).json()).teamspace.id
      const marker = `열람표지${stamp}`
      const openPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: mateHeaders, body: JSON.stringify({ teamspaceId: openTeam, title: marker }),
      })).json()).page.id

      // ① 참여하지 않은 나(브라우저 세션)도 링크로 연다 — 사이드바에는 없다
      check('★ 참여하지 않아도 open teamspace 의 페이지를 링크로 연다',
        (await fetch(`${BASE}/w/${workspaceId}/${openPage}`, { headers: authed })).status === 200)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
      // 트리 섹션만 본다 — 위에서 링크로 열었으니 "최근" 섹션에는 서는 것이 옳다(방문 기록).
      check('★ 그러나 사이드바의 트리 섹션에는 서지 않는다 — 모두의 사이드바가 남의 팀 문서로 덮이지 않게',
        await evaluate(`![...document.querySelectorAll('nav[aria-label="페이지 트리"] section')]
          .filter((sec) => !['최근', '즐겨찾기'].includes(sec.getAttribute('aria-label')))
          .some((sec) => sec.querySelector('a[href="/w/${workspaceId}/${openPage}"]'))`))
      const found = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(marker)}`, { headers: authed })).json()
      check('검색으로는 찾힌다 — 읽을 수 있는 곳이 됐다', found.results?.some((r) => r.pageId === openPage) ?? false,
        JSON.stringify(found.results?.map((r) => r.pageId) ?? found))
      check('게스트는 못 연다 (접근 요청 화면) — workspace_everyone 에 들지 않는다',
        await shownNoAccess(await pageAs(openGuest, `/w/${workspaceId}/${openPage}`)))

      // ② 좁히면 참여 안 한 사람이 잃는다
      const narrow = await fetch(`${tsUrl}/${openTeam}`, { method: 'PATCH', headers: mateHeaders, body: JSON.stringify({ visibility: 'closed' }) })
      check('★ closed 로 좁히면 참여하지 않은 나는 못 연다 (접근 요청 화면)',
        narrow.ok && (await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${openPage}`, { headers: authed }))), String(narrow.status))
      const reopen = await fetch(`${tsUrl}/${openTeam}`, { method: 'PATCH', headers: mateHeaders, body: JSON.stringify({ visibility: 'open' }) })
      check('다시 열면 다시 연다',
        reopen.ok && (await fetch(`${BASE}/w/${workspaceId}/${openPage}`, { headers: authed })).status === 200)
    }

    if (sectionIf('고아 teamspace — 막고 되살린다 (7c-10 · F-06-04)')) {
      // 그룹 삭제가 teamspace 의 마지막 owner 를 없애면 거부하고, 워크스페이스 owner(브라우저 세션)는 모든 teamspace 를 보고
      // 소유자로 들어가 고아를 되살린다. 이 절은 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const orphanMaker = await joinAs(workspaceId, await createUser('고아 만들 사람'), 'member')
      const makerHeaders = { ...json, cookie: `nc_session=${orphanMaker.token}` }
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const groupsUrl = `${BASE}/api/workspaces/${workspaceId}/groups`
      const stamp = Date.now()
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }

      // ① 막기 — 그룹이 마지막 owner 면 그 그룹을 지우지 못한다
      const ownedBy = (await (await fetch(tsUrl, {
        method: 'POST', headers: makerHeaders, body: JSON.stringify({ name: `그룹소유팀 ${stamp}`, visibility: 'private' }),
      })).json()).teamspace.id
      const ownerGroup = (await (await fetch(groupsUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: `소유그룹 ${stamp}` }),
      })).json()).group.id
      await fetch(`${tsUrl}/${ownedBy}/members`, {
        method: 'POST', headers: makerHeaders, body: JSON.stringify({ principal: { type: 'group', id: ownerGroup }, role: 'owner' }),
      })
      const leave = await fetch(`${tsUrl}/${ownedBy}/members/user/${orphanMaker.userId}`, { method: 'DELETE', headers: makerHeaders })
      const delGroup = await fetch(`${groupsUrl}/${ownerGroup}`, { method: 'DELETE', headers: authed })
      const delBody = await delGroup.json().catch(() => ({}))
      check('★ 그룹이 teamspace 의 마지막 소유자면 그 그룹을 지우지 못한다 (409 last_teamspace_owner · 몇 개인지)',
        leave.ok && delGroup.status === 409 && delBody.error === 'last_teamspace_owner' && delBody.nodes === 1,
        `나가기 ${leave.status} · 지우기 ${delGroup.status} ${JSON.stringify(delBody)}`)

      // ② 되살리기 — 워크스페이스 owner 의 관리 절
      const orphanTeam = (await (await fetch(tsUrl, {
        method: 'POST', headers: makerHeaders, body: JSON.stringify({ name: `고아팀 ${stamp}`, visibility: 'private' }),
      })).json()).teamspace.id
      const orphanPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: makerHeaders, body: JSON.stringify({ teamspaceId: orphanTeam, title: '고아의 문서' }),
      })).json()).page.id
      // 유일한 소유자가 워크스페이스를 떠난다 — 그 명령은 아직 없어 행으로 만든다(DB 검사 ⑮ 와 같다).
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      await dbQuery(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, orphanMaker.userId])
      check('전제 — 비공개 고아 teamspace 의 페이지를 워크스페이스 owner 도 못 연다 (접근 요청 화면)',
        await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${orphanPage}`, { headers: authed })))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces` })
      const adminRow = `[data-testid="teamspace-admin-row"][data-teamspace-id="${orphanTeam}"]`
      check('★ 둘러보기 화면의 "모든 teamspace" 에 비공개 고아가 서고 · 소유자가 없다고 경고한다',
        await waitFor(`document.querySelector('${adminRow}')?.dataset.orphan === 'true'
          && !!document.querySelector('${adminRow} [data-testid="teamspace-admin-orphan"]')`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-admin"]')?.textContent?.slice(0, 160) ?? '관리 절 없음'`))
      await clickOnSel(`${adminRow} [data-testid="teamspace-claim"]`)
      check('★ 소유자로 들어가면 그 줄이 "소유자" 가 되고 · 사이드바의 Teamspaces 에 선다',
        await waitFor(`!!document.querySelector('${adminRow} [data-testid="teamspace-admin-owned"]')
          && document.querySelector('${adminRow}')?.dataset.orphan === 'false'
          && !!document.querySelector('[data-testid="sidebar-teamspace"][data-teamspace-id="${orphanTeam}"]')`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-admin-error"]')?.textContent ?? ''`))
      check('★ 들어간 뒤에는 그 페이지를 연다',
        (await fetch(`${BASE}/w/${workspaceId}/${orphanPage}`, { headers: authed })).status === 200)

      // ③ 다른 역할에게는 관리 절이 없다
      const plainMate = await joinAs(workspaceId, await createUser('관리 없는 멤버'), 'member')
      const plainHtml = await (await fetch(`${BASE}/w/${workspaceId}/teamspaces`, { headers: { cookie: `nc_session=${plainMate.token}` } })).text()
      const plainClaim = await fetch(`${tsUrl}/${orphanTeam}/claim`, {
        method: 'POST', headers: { ...json, cookie: `nc_session=${plainMate.token}` },
      })
      check('일반 멤버에게는 관리 절이 없고 들어가기는 404 다',
        !plainHtml.includes('teamspace-admin') && plainClaim.status === 404, String(plainClaim.status))
      // 들어가기의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('기본 teamspace (7c-11 · F-06-04)')) {
      // 워크스페이스 owner(브라우저 세션)가 자기 teamspace 를 기본으로 켠다 → 기존 멤버가 들어오고, 초대를 받아들인 사람도
      // 들어온다. 이 절은 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 켜면 이 워크스페이스의 사람 전원이 그 멤버가
      // 되므로 끝에 끈다(들어온 사람은 남지만, 뒤 절이 새로 만드는 사람은 들어오지 않는다).
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const stamp = Date.now()
      const cookieOf = (actor) => ({ cookie: `nc_session=${actor.token}` })
      const clickOnSel = async (sel) => {
        const box = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(sel)})
          if (!el || el.disabled) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(120)
        return true
      }

      const team = (await (await fetch(tsUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: `전사 ${stamp}`, visibility: 'closed' }),
      })).json()).teamspace.id
      const teamPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ teamspaceId: team, title: '전사 공지' }),
      })).json()).page.id
      const staffName = `기본 전 직원 ${stamp}`
      const staff = await joinAs(workspaceId, await createUser(staffName), 'member')
      check('전제 — 켜기 전에는 closed 라 멤버가 아닌 직원이 그 페이지를 못 연다 (접근 요청 화면)',
        await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${teamPage}`, { headers: cookieOf(staff) })))

      // ① 문 — 워크스페이스 owner 가 아닌 teamspace owner 는 켜지 못하고, 버튼도 받지 않는다
      const lead = await joinAs(workspaceId, await createUser('기본 못 켜는 팀장'), 'member')
      const leadTeam = (await (await fetch(tsUrl, {
        method: 'POST', headers: { ...json, ...cookieOf(lead) }, body: JSON.stringify({ name: `팀장의 팀 ${stamp}` }),
      })).json()).teamspace.id
      const leadPut = await fetch(`${tsUrl}/${leadTeam}/default`, { method: 'PUT', headers: { ...json, ...cookieOf(lead) } })
      const leadHtml = await (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${leadTeam}`, { headers: cookieOf(lead) })).text()
      check('워크스페이스 owner 가 아닌 teamspace 소유자는 켜지 못하고 (403) · 설정 절에 기본 버튼이 없다',
        leadPut.status === 403 && leadHtml.includes('teamspace-settings') && !leadHtml.includes('teamspace-default-on'),
        String(leadPut.status))

      // ② 화면 — 켠다(두 번 누른다)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${team}` })
      const DEFAULT = '[data-testid="teamspace-default"]'
      await waitFor(`document.querySelector('${DEFAULT}')?.dataset.default === 'false'`, 15000)
      // 멤버 **줄**에서 찾는다 — 절 전체의 글에는 "넣기" 고르개의 후보(아직 멤버가 아닌 사람)도 들어 있어, 켜기 전에도
      // 직원의 이름이 보인다(처음 쓴 검사가 그래서 `key` 를 빼도 통과했다 — 반사실 E1).
      const staffRow = `[...document.querySelectorAll('[data-testid="teamspace-member"]')].some((li) => li.textContent.includes(${JSON.stringify(staffName)}))`
      check('전제 — 켜기 전에는 직원이 멤버 줄에 없다', (await evaluate(staffRow)) === false)
      await clickOnSel('[data-testid="teamspace-default-on"]')
      check('한 번 누르면 무엇이 일어나는지 말하고 묻는다 — 아직 켜지지 않았다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-default-confirm"]')
          && document.querySelector('${DEFAULT}')?.dataset.default === 'false'`, 5000))
      await clickOnSel('[data-testid="teamspace-default-confirm"]')
      check('★ 확인하면 켜지고 몇 명이 들어왔는지 말한다 · 보관 버튼 대신 까닭이 선다',
        await waitFor(`document.querySelector('${DEFAULT}')?.dataset.default === 'true'
          && (document.querySelector('[data-testid="teamspace-default-note"]')?.textContent ?? '').includes('명이 들어왔습니다')
          && !!document.querySelector('[data-testid="teamspace-archive-blocked"]')
          && !document.querySelector('[data-testid="teamspace-archive"]')`, 15000),
        await evaluate(`document.querySelector('${DEFAULT}')?.textContent ?? '기본 절 없음'`))
      check('★ 멤버 절이 새로 들어온 사람을 받는다 — 직원의 이름이 선다',
        await waitFor(staffRow, 15000))
      check('★ 직원이 그 페이지를 연다',
        (await fetch(`${BASE}/w/${workspaceId}/${teamPage}`, { headers: cookieOf(staff) })).status === 200)

      // ③ 이후 가입자 — 진짜 수락 라우트로 들어온다
      const { createEmailInvite } = await import(new URL('../src/lib/workspace/invite.ts', import.meta.url).href)
      const { createSession } = await import(new URL('../src/lib/auth/session.ts', import.meta.url).href)
      const { withTransaction } = await import(new URL('../src/lib/db/tx.ts', import.meta.url).href)
      const arrival = await createUser('기본 뒤 가입자')
      const invited = await createEmailInvite({
        workspaceId, inviterUserId: ctx.userId, inviterRole: 'owner', email: arrival.email, role: 'member',
      })
      const arrivalSession = await withTransaction((tx) => createSession(tx, {
        userId: arrival.userId, authMethod: 'login_code', mfaSatisfied: false, ip: null, userAgent: 'e2e',
      }))
      const accepted = await fetch(`${BASE}/api/invites/accept`, {
        method: 'POST', headers: { ...json, cookie: `nc_session=${arrivalSession.token}` }, body: JSON.stringify({ token: invited.token }),
      })
      check('★ 초대를 받아들인 사람은 기본 teamspace 에 들어와 그 화면을 연다',
        accepted.ok && (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${team}`, {
          headers: { cookie: `nc_session=${arrivalSession.token}` },
        })).status === 200, String(accepted.status))

      // ④ 목록의 표시 · 보관의 거부
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces` })
      check('둘러보기와 관리 절이 "기본" 을 단다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-browse-row"][data-teamspace-id="${team}"] [data-testid="teamspace-browse-default"]')
          && !!document.querySelector('[data-testid="teamspace-admin-row"][data-teamspace-id="${team}"] [data-testid="teamspace-admin-default"]')`, 15000))
      const archiveRes = await fetch(`${tsUrl}/${team}/archive`, { method: 'POST', headers: authed })
      check('★ 기본 teamspace 는 보관하지 못한다 (409 default_teamspace)',
        archiveRes.status === 409 && (await archiveRes.json()).error === 'default_teamspace', String(archiveRes.status))

      // ⑤ 끈다 — 한 번 · 보관 버튼이 돌아오고 · 들어온 사람은 남는다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${team}` })
      await waitFor(`document.querySelector('${DEFAULT}')?.dataset.default === 'true'`, 15000)
      await clickOnSel('[data-testid="teamspace-default-off"]')
      check('해제하면 보관 버튼이 돌아온다',
        await waitFor(`document.querySelector('${DEFAULT}')?.dataset.default === 'false'
          && !!document.querySelector('[data-testid="teamspace-archive"]')`, 15000))
      check('해제해도 들어온 직원은 그 페이지를 연다',
        (await fetch(`${BASE}/w/${workspaceId}/${teamPage}`, { headers: cookieOf(staff) })).status === 200)
      // 해제의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('멤버 기본 권한 (7c-12 · F-06-04)')) {
      // 소유자(브라우저 세션)가 설정 절에서 멤버 기본 권한을 "읽기"로 낮춘다 → 멤버는 여전히 보지만 최상위에 만들지 못하고,
      // 사이드바의 `+` · teamspace 화면의 만들기가 사라진다. 끝에 전체 권한으로 되돌린다. 이 절은 자기 데이터를 스스로 만든다.
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const stamp = Date.now()
      const team = (await (await fetch(tsUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: `읽기팀 ${stamp}`, visibility: 'closed' }),
      })).json()).teamspace.id
      const teamPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ teamspaceId: team, title: '읽기팀 공지' }),
      })).json()).page.id
      const reader = await joinAs(workspaceId, await createUser('읽기 멤버'), 'member')
      const readerCookie = { cookie: `nc_session=${reader.token}` }
      await fetch(`${tsUrl}/${team}/members`, {
        method: 'POST', headers: authed, body: JSON.stringify({ principal: { type: 'user', id: reader.userId }, role: 'member' }),
      })
      // 이 멤버는 이 teamspace 하나에만 속한다 — 사이드바의 teamspace `+` 가 있다면 이 teamspace 의 것이다.
      const readerHtml = async () =>
        (await (await fetch(`${BASE}/w/${workspaceId}/teamspaces/${team}`, { headers: readerCookie })).text())
      const before = await readerHtml()
      check('전제 — 전체 권한일 때 멤버에게 사이드바의 + 와 teamspace 화면의 만들기가 있다',
        before.includes('sidebar-teamspace-add') && before.includes('data-testid="teamspace-create"'))

      // ① 화면 — 고르개와 한 줄 설명, 저장
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${team}` })
      const LEVEL = '[data-testid="teamspace-settings-member-level"]'
      await waitFor(`document.querySelector('${LEVEL}')?.value === 'full_access'`, 15000)
      // 서버 렌더가 먼저 서고 React 가 나중에 붙는다 — 붙기 전에 보낸 change 는 사라지므로 설명 줄이 바뀔 때까지 다시 보낸다.
      const hintSaysView = `(document.querySelector('[data-testid="teamspace-settings-member-level-hint"]')?.textContent ?? '').includes('읽기만')`
      let chose = false
      for (let i = 0; i < 20 && !chose; i += 1) {
        await evaluate(`(() => {
          const s = document.querySelector('${LEVEL}')
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'view')
          s.dispatchEvent(new Event('change', { bubbles: true }))
        })()`)
        chose = await waitFor(hintSaysView, 500)
      }
      check('읽기를 고르면 그 자리에서 멤버가 무엇을 하게 되는지 말한다', chose)
      await clickSelector('[data-testid="teamspace-settings-save"]')
      check('★ 저장한다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-settings-saved"]')`, 15000),
        await evaluate(`document.querySelector('[data-testid="teamspace-settings-error"]')?.textContent ?? ''`))

      // ② 멤버에게 일어난 일
      const after = await readerHtml()
      check('★ 멤버는 여전히 그 페이지를 연다',
        (await fetch(`${BASE}/w/${workspaceId}/${teamPage}`, { headers: readerCookie })).status === 200)
      const sneak = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: { ...json, ...readerCookie }, body: JSON.stringify({ teamspaceId: team, title: '몰래' }),
      })
      check('★ 멤버는 최상위에 페이지를 두지 못한다 (404)', sneak.status === 404, String(sneak.status))
      check('★ 멤버에게 사이드바의 teamspace + 가 사라진다', !after.includes('sidebar-teamspace-add'))
      check('★ 멤버에게 teamspace 화면의 만들기가 사라진다', !after.includes('data-testid="teamspace-create"'))
      check('소유자에게는 만들기가 그대로다',
        await waitFor(`!!document.querySelector('[data-testid="teamspace-create"]')`, 15000))

      // ③ 되돌린다 — 넷 밖의 값은 400
      const bad = await fetch(`${tsUrl}/${team}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ memberLevel: 'edit_content' }) })
      check('넷 밖의 값은 거부한다 (400 invalid_level)', bad.status === 400 && (await bad.json()).error === 'invalid_level')
      const back = await fetch(`${tsUrl}/${team}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ memberLevel: 'full_access' }) })
      check('전체 권한으로 되돌리면 멤버의 + 가 돌아온다',
        back.ok && (await readerHtml()).includes('sidebar-teamspace-add'))
      // 저장의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('이동 전 영향 미리보기 (7c-13 · F-06-20)')) {
      // 소유자(브라우저 세션)가 teamspace 의 페이지를 개인으로 옮기려 한다 → 미리보기가 누가 못 보게 되는지와, 따로 공유된 하위
      // 페이지가 여전히 열려 있다는 것을 말하고 한 번 더 묻는다. 볼 수 있는 사람이 그대로인 이동은 묻지 않는다. 자기 데이터를
      // 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const stamp = Date.now()
      const mateName = `미리보기 동료 ${stamp}`
      const mate = await joinAs(workspaceId, await createUser(mateName), 'member')
      const outsider = await joinAs(workspaceId, await createUser(`하위 손님 ${stamp}`), 'restricted_member')
      const cookieOf = (actor) => ({ cookie: `nc_session=${actor.token}` })
      const team = (await (await fetch(tsUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ name: `미리보기팀 ${stamp}`, visibility: 'closed' }),
      })).json()).teamspace.id
      await fetch(`${tsUrl}/${team}/members`, {
        method: 'POST', headers: authed, body: JSON.stringify({ principal: { type: 'user', id: mate.userId }, role: 'member' }),
      })
      const doc = (await (await fetch(pagesUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ teamspaceId: team, title: '옮길 팀 문서' }),
      })).json()).page.id
      const child = (await (await fetch(pagesUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ parentPageId: doc, title: '따로 공유한 하위' }),
      })).json()).page.id
      await fetch(`${pagesUrl}/${child}/access`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: outsider.userId }, level: 'view' }),
      })
      const openPicker = async () => {
        for (let i = 0; i < 5; i += 1) {
          await clickSelector('[data-testid="move-open"]')
          if (await waitFor(`!!document.querySelector('[data-testid="move-picker"]')`, 3000)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
      await waitFor(`!!document.querySelector('[data-testid="move-open"]')`, 15000)
      await openPicker()
      await waitFor(`!!document.querySelector('[data-testid="move-to-private"]')`, 5000)
      await clickSelector('[data-testid="move-to-private"]')
      const loseLine = `document.querySelector('[data-testid="move-preview-lose"]')?.textContent ?? ''`
      check('★ 볼 수 있는 사람이 바뀌면 옮기기 전에 묻는다 — 누가 못 보게 되는지 이름으로',
        await waitFor(`(${loseLine}).includes(${JSON.stringify(mateName)})`, 10000),
        await evaluate(`document.querySelector('[data-testid="move-preview"]')?.textContent ?? document.querySelector('[data-testid="move-error"]')?.textContent ?? '미리보기 없음'`))
      check('★ 따로 공유된 하위 페이지는 옮겨도 여전히 열려 있다고 말한다',
        await evaluate(`(document.querySelector('[data-testid="move-preview-below"]')?.textContent ?? '').includes('하위 페이지 1개')`))
      check('묻는 동안에는 아직 옮기지 않았다 — 동료가 연다',
        (await fetch(`${BASE}/w/${workspaceId}/${doc}`, { headers: cookieOf(mate) })).status === 200)

      await clickSelector('[data-testid="move-preview-cancel"]')
      check('"다른 곳 고르기" 는 목록으로 돌아간다',
        await waitFor(`!document.querySelector('[data-testid="move-preview"]') && !!document.querySelector('[data-testid="move-to-private"]')`, 5000))

      await clickSelector('[data-testid="move-to-private"]')
      await waitFor(`!!document.querySelector('[data-testid="move-preview-confirm"]')`, 10000)
      await clickSelector('[data-testid="move-preview-confirm"]')
      check('★ 확인하면 옮긴다 — 동료는 못 보고 · 하위의 손님은 미리보기가 말한 대로 여전히 본다',
        (await waitFor(`!document.querySelector('[data-testid="move-picker"]')`, 15000))
          && (await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${doc}`, { headers: cookieOf(mate) })))
          && (await fetch(`${BASE}/w/${workspaceId}/${child}`, { headers: cookieOf(outsider) })).status === 200)

      // 볼 수 있는 사람이 그대로인 이동은 묻지 않는다 — 워크스페이스 최상위의 한 페이지를 다른 최상위 페이지 밑으로.
      const lone = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `혼자 옮길 문서 ${stamp}` }) })).json()).page.id
      const home = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `받을 문서 ${stamp}` }) })).json()).page.id
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${lone}` })
      await waitFor(`!!document.querySelector('[data-testid="move-open"]')`, 15000)
      await openPicker()
      const homeOption = `[data-testid="move-to-page"][data-page-id="${home}"]`
      await waitFor(`!!document.querySelector('${homeOption}')`, 5000)
      await clickSelector(homeOption)
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const settled = await waitFor(`!document.querySelector('[data-testid="move-picker"]') || !!document.querySelector('[data-testid="move-preview"]')`, 15000)
      check('볼 수 있는 사람이 그대로인 이동은 묻지 않고 곧바로 옮긴다',
        settled && !(await evaluate(`!!document.querySelector('[data-testid="move-preview"]')`))
          && (await dbQuery(`SELECT parent_id FROM block WHERE id = $1`, [lone]))[0]?.parent_id === home)
      // 옮기기의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('teamspace 아이콘 (7c-14 · F-06-04)')) {
      // 만들 때 아이콘을 고르고, 설정에서 바꾸고 지운다 — 머리 · 사이드바 · 둘러보기가 함께 바뀐다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const typeInto = async (sel, text) => {
        await clickSelector(sel)
        await evaluate(`document.querySelector(${JSON.stringify(sel)})?.select()`)
        await send('Input.insertText', { text })
      }
      /** 아이콘 칸을 누른다 — 눌렸다고(aria-pressed) 할 때까지. 서버 렌더 뒤 React 가 붙기 전의 클릭은 사라진다(§6). */
      const pick = async (scope, icon) => {
        const sel = icon === null
          ? `${scope} [data-testid="teamspace-icon-none"]`
          : `${scope} [data-testid="teamspace-icon-choice"][data-icon="${icon}"]`
        for (let i = 0; i < 10; i += 1) {
          await clickSelector(sel)
          if (await waitFor(`document.querySelector(${JSON.stringify(sel)})?.getAttribute('aria-pressed') === 'true'`, 500)) return true
        }
        return false
      }
      const header = `document.querySelector('[data-testid="teamspace-icon"]')?.textContent`
      const sidebarIcon = (id) =>
        `document.querySelector('[data-testid="sidebar-teamspace"][data-teamspace-id="${id}"] [data-testid="sidebar-teamspace-icon"]')?.textContent`

      // ① 만들 때 고른다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="teamspace-create-open"]')`, 15000)
      await clickSelector('[data-testid="teamspace-create-open"]')
      await waitFor(`!!document.querySelector('[data-testid="teamspace-create-name"]')`, 5000)
      await typeInto('[data-testid="teamspace-create-name"]', `아이콘팀 ${stamp}`)
      check('만들기 폼에 아이콘 고르개가 있고 · 고르면 눌린다', await pick('[data-testid="teamspace-create-form"]', '🚀'))
      await clickSelector('[data-testid="teamspace-create"]')
      await waitFor(`location.pathname.includes('/teamspaces/')`, 15000)
      const team = await evaluate(`location.pathname.split('/teamspaces/')[1]`)
      check('★ 만들 때 고른 아이콘이 teamspace 화면 머리와 사이드바 줄에 선다',
        await waitFor(`${header} === '🚀' && ${sidebarIcon(team)} === '🚀'`, 15000),
        await evaluate(`JSON.stringify([${header}, ${sidebarIcon(team)}])`))

      // ② 설정에서 바꾼다
      const SETTINGS = '[data-testid="teamspace-settings"]'
      await waitFor(`!!document.querySelector('${SETTINGS} [data-testid="teamspace-icon-picker"]')`, 15000)
      check('설정의 고르개가 지금 아이콘을 눌린 채로 보인다',
        await evaluate(`document.querySelector('${SETTINGS} [data-testid="teamspace-icon-choice"][data-icon="🚀"]')?.getAttribute('aria-pressed') === 'true'`))
      await pick(SETTINGS, '🌱')
      await clickSelector('[data-testid="teamspace-settings-save"]')
      check('★ 설정에서 바꾸면 머리와 사이드바가 함께 바뀐다',
        await waitFor(`${header} === '🌱' && ${sidebarIcon(team)} === '🌱'`, 15000),
        await evaluate(`JSON.stringify([${header}, ${sidebarIcon(team)}])`))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces` })
      check('둘러보기의 줄에도 선다',
        await waitFor(`document.querySelector('[data-testid="teamspace-browse-row"][data-teamspace-id="${team}"] [data-testid="teamspace-browse-icon"]')?.textContent === '🌱'`, 15000))

      // ③ 지운다 — 기본 표시로 돌아간다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${team}` })
      await waitFor(`!!document.querySelector('${SETTINGS} [data-testid="teamspace-icon-none"]')`, 15000)
      await pick(SETTINGS, null)
      await clickSelector('[data-testid="teamspace-settings-save"]')
      check('아이콘을 지우면 기본 표시(▣)로 돌아간다',
        await waitFor(`${header} === '▣' && ${sidebarIcon(team)} === '▣'`, 15000))

      const bad = await fetch(`${BASE}/api/workspaces/${workspaceId}/teamspaces/${team}`, {
        method: 'PATCH', headers: authed, body: JSON.stringify({ icon: '팀팀' }),
      })
      check('이모지 한 글자가 아니면 거부한다 (400 invalid_icon)', bad.status === 400 && (await bad.json()).error === 'invalid_icon')
      // 저장의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('게스트를 들인다 (7d-1 · F-06-09)')) {
      // 소유자(브라우저 세션)가 공유 패널에서 외부 사람의 이메일을 넣는다 → 게스트로 들어와 그 페이지만 본다. 이미 멤버인 사람은
      // 멤버로 공유되고, 계정이 없으면 먼저 가입하라고 말한다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const guestName = `바깥 손님 ${stamp}`
      const outsider = await createUser(guestName)
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `손님과 볼 문서 ${stamp}` }) })).json()).page.id
      const other = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `손님은 못 볼 문서 ${stamp}` }) })).json()).page.id
      const DIALOG = '[role="dialog"][aria-label="공유 설정"]'
      const EMAIL = `${DIALOG} input[aria-label="초대할 이메일"]`
      const invite = async (email) => {
        await clickSelector(EMAIL)
        await evaluate(`document.querySelector(${JSON.stringify(EMAIL)})?.select()`)
        await send('Input.insertText', { text: email })
        await clickSelector('[data-testid="share-invite-guest-submit"]')
      }
      const panelSays = (text) => waitFor(`(document.querySelector('${DIALOG}')?.textContent ?? '').includes(${JSON.stringify(text)})`, 10000)
      // 목록의 **줄**에서 찾는다 — 패널 전체의 글에는 "추가" 고르개의 <option> 도 들어 있다(§6).
      const rowSays = (text) => waitFor(`[...document.querySelectorAll('${DIALOG} li')].some((li) => li.textContent.includes(${JSON.stringify(text)}))`, 10000)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
      await clickText('공유')
      await waitFor(`!!document.querySelector(${JSON.stringify(EMAIL)})`, 10000)
      check('공유 패널에 "이메일로 초대" 줄이 있고 · 게스트에게 줄 권한은 편집까지다',
        await evaluate(`(() => {
          const s = document.querySelector('${DIALOG} select[aria-label="게스트에게 줄 권한"]')
          const values = s ? [...s.options].map((o) => o.value) : []
          return values.join(',') === 'view,comment,edit'
        })()`))

      await invite(outsider.email)
      check('★ 이메일로 초대하면 게스트로 들어왔다고 말하고 · 목록에 "게스트"로 선다',
        (await panelSays('게스트로 초대했습니다')) && (await rowSays(`${guestName} (${outsider.email}) · 게스트`)),
        await panelText())

      const { createSession } = await import(new URL('../src/lib/auth/session.ts', import.meta.url).href)
      const { withTransaction } = await import(new URL('../src/lib/db/tx.ts', import.meta.url).href)
      const guestSession = await withTransaction((tx) => createSession(tx, {
        userId: outsider.userId, authMethod: 'login_code', mfaSatisfied: false, ip: null, userAgent: 'e2e',
      }))
      const asGuest = (path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${guestSession.token}` } })
      check('★ 게스트는 그 페이지를 열고 · 공유받지 않은 페이지는 못 연다(접근 요청 화면 · 제목 없이)',
        (await asGuest(`/w/${workspaceId}/${doc}`)).status === 200
          && (await shownNoAccess(await asGuest(`/w/${workspaceId}/${other}`), `손님은 못 볼 문서 ${stamp}`)))

      // 이미 멤버인 사람은 멤버로 공유된다 · 계정이 없으면 가입하라고 말한다
      const memberName = `이메일로 받는 동료 ${stamp}`
      const mate = await joinAs(workspaceId, await createUser(memberName), 'member')
      await invite(mate.email)
      check('이미 멤버인 사람은 멤버로 공유했다고 말한다 — 게스트가 되지 않는다',
        (await panelSays('멤버로 공유했습니다')) && !(await evaluate(`[...document.querySelectorAll('${DIALOG} li')].some((li) => li.textContent.includes(${JSON.stringify(`${memberName} (${mate.email}) · 게스트`)}))`)))
      await invite(`nobody-${stamp}@example.com`) // ASCII — type="email" 칸은 한글 주소를 브라우저가 먼저 막는다
      check('계정이 없는 이메일에는 초대 메일을 보냈다고 말한다 (7g-1 전에는 "먼저 가입하라")', await panelSays('초대 메일을 보냈습니다'))

      // 게스트에게 전체 권한은 줄 수 없다 — 사람 고르개로 줘도
      const grantFull = await fetch(`${pagesUrl}/${doc}/access`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: outsider.userId }, level: 'full_access' }),
      })
      check('게스트에게 전체 권한을 주면 거부한다 (400 guest_level)',
        grantFull.status === 400 && (await grantFull.json()).error === 'guest_level', String(grantFull.status))
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(500)
    }

    if (sectionIf('게스트에게 새는 목록 · 공유 주체 (7d-2 · F-06-09)')) {
      // 게스트는 워크스페이스 멤버 목록을 받지 않는다 — 공유 패널 · 코멘트 · `@` · 홈 네 곳. 그리고 워크스페이스 밖의 사람에게는
      // 공유 API 로 줄 수 없다(게스트 초대가 유일한 길). 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const bystanderName = `목록에 없어야 할 동료 ${stamp}`
      const bystander = await joinAs(workspaceId, await createUser(bystanderName), 'member')
      const outsider = await createUser(`목록을 받지 않는 손님 ${stamp}`)
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `손님 목록 문서 ${stamp}` }) })).json()).page.id
      const invited = await fetch(`${pagesUrl}/${doc}/guests`, {
        method: 'POST', headers: authed, body: JSON.stringify({ email: outsider.email, level: 'comment' }),
      })
      await fetch(`${pagesUrl}/${doc}/discussions`, {
        method: 'POST', headers: authed, body: JSON.stringify({ action: 'open', richText: [textRun('손님도 보는 코멘트')] }),
      })
      const { createSession } = await import(new URL('../src/lib/auth/session.ts', import.meta.url).href)
      const { withTransaction } = await import(new URL('../src/lib/db/tx.ts', import.meta.url).href)
      const guestSession = await withTransaction((tx) => createSession(tx, {
        userId: outsider.userId, authMethod: 'login_code', mfaSatisfied: false, ip: null, userAgent: 'e2e',
      }))
      const asGuest = (path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${guestSession.token}` } })
      check('전제 — 손님이 게스트로 들어왔다', invited.ok, String(invited.status))

      const access = await (await asGuest(`/api/workspaces/${workspaceId}/pages/${doc}/access`)).json()
      const entryUsers = new Set((access.entries ?? []).filter((e) => e.principalType === 'user').map((e) => e.principalId))
      check('★ 공유 패널 — 게스트는 이 페이지의 행에 나오는 사람의 이름만 받는다(다른 멤버는 없다)',
        Array.isArray(access.members) && access.members.length > 0
          && access.members.every((m) => entryUsers.has(m.userId))
          && !access.members.some((m) => m.userId === bystander.userId),
        JSON.stringify(access.members?.map((m) => m.name)))

      const threads = await (await asGuest(`/api/workspaces/${workspaceId}/pages/${doc}/discussions`)).json()
      check('★ 코멘트 — 게스트는 스레드에 나오는 사람(쓴 사람)과 자기만 받는다',
        Array.isArray(threads.members) && threads.members.some((m) => m.userId === ctx.userId)
          && !threads.members.some((m) => m.userId === bystander.userId),
        JSON.stringify(threads.members?.map((m) => m.name)))

      const guestCandidates = await (await asGuest(`/api/workspaces/${workspaceId}/mention-candidates?q=`)).json()
      const ownerCandidates = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/mention-candidates?q=`, { headers: authed })).json()
      const users = (body) => (body.candidates ?? body.results ?? body).filter?.((c) => c.kind === 'user') ?? []
      check('★ `@` — 게스트는 사람 후보를 받지 않고 · 멤버는 받는다',
        users(guestCandidates).length === 0 && users(ownerCandidates).length > 0,
        `${JSON.stringify(guestCandidates).slice(0, 120)} · 멤버 ${users(ownerCandidates).length}`)

      const guestHome = await (await asGuest(`/w/${workspaceId}/settings?s=workspace.people`)).text()
      const ownerHome = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.people`, { headers: authed })).text()
      check('★ 설정의 사람 절 — 게스트에게는 멤버 목록이 없고 동료의 이름도 없다 · 멤버에게는 있다',
        !guestHome.includes('data-testid="workspace-members"') && !guestHome.includes(bystanderName)
          && ownerHome.includes('data-testid="workspace-members"'))

      const toStranger = await fetch(`${pagesUrl}/${doc}/access`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: (await createUser('밖의 사람')).userId }, level: 'view' }),
      })
      check('★ 공유 API 는 워크스페이스 밖의 사람에게 주지 않는다 (400 invalid_principal) — 밖의 사람은 이메일로 초대한다',
        toStranger.status === 400 && (await toStranger.json()).error === 'invalid_principal', String(toStranger.status))
    }

    if (sectionIf('게스트 관리 — 멤버로 올리기 · 빼기 (7d-3 · F-06-09)')) {
      // 소유자(브라우저 세션)가 설정의 사람 절 "게스트" 패널(8g-2 — 전에는 홈)에서 한 사람은 멤버로 올리고, 한 사람은 뺀다. 둘 다 두 번 누른다. 자기 데이터를
      // 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `게스트 관리 문서 ${stamp}` }) })).json()).page.id
      const riseName = `올라갈 손님 ${stamp}`
      const leaveName = `나갈 손님 ${stamp}`
      const rise = await createUser(riseName)
      const leave = await createUser(leaveName)
      for (const who of [rise, leave]) {
        await fetch(`${pagesUrl}/${doc}/guests`, { method: 'POST', headers: authed, body: JSON.stringify({ email: who.email, level: 'view' }) })
      }
      const { createSession } = await import(new URL('../src/lib/auth/session.ts', import.meta.url).href)
      const { withTransaction } = await import(new URL('../src/lib/db/tx.ts', import.meta.url).href)
      const leaveSession = await withTransaction((tx) => createSession(tx, {
        userId: leave.userId, authMethod: 'login_code', mfaSatisfied: false, ip: null, userAgent: 'e2e',
      }))
      const asLeaver = (path) => fetch(`${BASE}${path}`, { headers: { cookie: `nc_session=${leaveSession.token}` } })
      check('전제 — 나갈 손님은 그 페이지를 연다', (await asLeaver(`/w/${workspaceId}/${doc}`)).status === 200)

      const row = (id) => `[data-testid="guest-row"][data-user-id="${id}"]`
      /** 두 번 누르는 버튼 — 확인 줄이 뜰 때까지 첫 버튼을 다시 누른다(서버 렌더 뒤 붙기 전의 클릭은 사라진다 · §6). */
      const ask = async (id, first, confirm) => {
        for (let i = 0; i < 10; i += 1) {
          await clickSelector(`${row(id)} [data-testid="${first}"]`)
          if (await waitFor(`!!document.querySelector('${row(id)} [data-testid="${confirm}"]')`, 500)) return true
        }
        return false
      }

      // 멤버 절은 게스트도 싣는다(역할을 함께 적는다) — "멤버 절에 선다"가 아니라 **그 줄의 역할이 바뀐다**로 본다. 처음 쓴
      // 검사는 이름만 봐서 서버 렌더를 다시 받지 않아도 통과했다(반사실 E1).
      const memberRole = (name) => `([...document.querySelectorAll('[data-testid="workspace-members"] li')]
        .find((li) => li.textContent.includes(${JSON.stringify(name)}))?.textContent ?? '')`
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.people` })
      check('★ 설정의 사람 절 "게스트" 패널에 두 손님이 받은 페이지 수와 함께 선다',
        await waitFor(`(document.querySelector('${row(rise.userId)} [data-testid="guest-pages"]')?.textContent ?? '') === '페이지 1개'
          && !!document.querySelector('${row(leave.userId)}')`, 15000))

      check('전제 — 멤버 절의 그 줄은 아직 guest 다', (await evaluate(memberRole(riseName))).includes('guest'))
      check('멤버로 올리기는 한 번 더 묻는다 — 좌석을 쓴다고 말한다',
        (await ask(rise.userId, 'guest-promote', 'guest-promote-confirm'))
          && (await evaluate(`(document.querySelector('${row(rise.userId)}')?.textContent ?? '').includes('좌석')`)))
      await clickSelector(`${row(rise.userId)} [data-testid="guest-promote-confirm"]`)
      check('★ 확인하면 게스트 절에서 빠지고 · 멤버 절의 그 줄이 guest 에서 member 로 바뀐다',
        await waitFor(`!document.querySelector('${row(rise.userId)}')
          && (document.querySelector('[data-testid="guest-notice"]')?.textContent ?? '').includes('멤버로 올렸습니다')
          && ${memberRole(riseName)}.includes('member') && !${memberRole(riseName)}.includes('guest')`, 15000),
        await evaluate(`document.querySelector('[data-testid="guest-error"]')?.textContent ?? ''`))

      check('빼기는 한 번 더 묻는다 — 공유가 모두 걷힌다고 말한다',
        (await ask(leave.userId, 'guest-remove', 'guest-remove-confirm'))
          && (await evaluate(`(document.querySelector('${row(leave.userId)}')?.textContent ?? '').includes('모두 걷힙니다')`)))
      await clickSelector(`${row(leave.userId)} [data-testid="guest-remove-confirm"]`)
      // 뺀 손님은 워크스페이스 밖의 사람이다 — 그 주소에서는 요청 화면(제목 없이)을 보고 홈은 404 다(7g-2).
      check('★ 확인하면 빠지고 · 걷은 공유 수를 말하고 · 그 손님은 이제 그 페이지를 못 연다(밖의 사람의 요청 화면 · 홈은 404)',
        (await waitFor(`!document.querySelector('${row(leave.userId)}')
          && (document.querySelector('[data-testid="guest-notice"]')?.textContent ?? '').includes('공유 1건')`, 15000))
          && (await shownNoAccess(await asLeaver(`/w/${workspaceId}/${doc}`), `게스트 관리 문서 ${stamp}`))
          && (await asLeaver(`/w/${workspaceId}`)).status === 404)

      const mate = await joinAs(workspaceId, await createUser(`게스트를 못 보는 멤버 ${stamp}`), 'member')
      const mateHome = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.people`, { headers: { cookie: `nc_session=${mate.token}` } })).text()
      const mateList = await fetch(`${BASE}/api/workspaces/${workspaceId}/guests`, { headers: { cookie: `nc_session=${mate.token}` } })
      check('멤버에게는 게스트 패널이 없고 목록 API 는 403 이다',
        !mateHome.includes('data-testid="workspace-guests"') && mateList.status === 403, String(mateList.status))
      // 올리기 · 빼기의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('접근 요청 (7e-1 · F-06-15)')) {
      // 동료가(브라우저 세션을 동료로 바꾼다) 볼 수 없는 페이지를 열어 요청하고 → 소유자가 인박스의 그 줄을 눌러 공유 패널에서
      // 허락한다. 둘째 페이지는 무시한다 — 요청한 사람에게는 여전히 "요청했습니다"다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로
      // 홀로 돈다. 브라우저 세션은 끝에 반드시 소유자로 되돌린다(뒤 절이 소유자로 돈다).
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const askerName = `요청하는 동료 ${stamp}`
      const asker = await joinAs(workspaceId, await createUser(askerName), 'member')
      const asAsker = { ...json, cookie: `nc_session=${asker.token}` }
      const makePrivate = async (title) =>
        (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title, privateTop: true }) })).json()).page.id
      const secretTitle = `요청받을 문서 ${stamp}`
      const quietTitle = `무시할 문서 ${stamp}`
      const secret = await makePrivate(secretTitle)
      const quiet = await makePrivate(quietTitle)
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const REQ_ROW = '[data-testid="access-requests"] [data-testid="access-request-row"]'
      const noticeSays = (text) =>
        waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"] [role="status"]')?.textContent ?? '').includes(${JSON.stringify(text)})`, 10000)
      const clickUntilGone = async (button, row) => {
        for (let i = 0; i < 10; i += 1) {
          await clickSelector(button)
          if (await waitFor(`!document.querySelector('${row}')`, 1500)) return true
        }
        return false
      }

      try {
        // ① 요청하는 쪽
        await browseAs(asker.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${secret}` })
        check('★ 볼 수 없는 페이지를 열면 "권한이 없습니다"와 요청 버튼 — 제목은 없다',
          (await waitFor(`!!document.querySelector('[data-testid="access-request"]')`, 15000))
            && !(await evaluate(`document.body.innerText.includes(${JSON.stringify(secretTitle)})`)),
          await evaluate(`document.body.innerText.slice(0, 200)`))
        // 서버 렌더 뒤 React 가 붙기 전의 클릭은 사라진다(§6) — "요청했습니다"가 뜰 때까지 다시 누른다(두 번 가도 요청은 하나다).
        let sent = false
        for (let i = 0; i < 10 && !sent; i += 1) {
          await clickSelector('[data-testid="access-request"]')
          sent = await waitFor(`!!document.querySelector('[data-testid="access-requested"]')`, 800)
        }
        check('★ 누르면 "요청했습니다"로 바뀐다', sent)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${secret}` })
        check('다시 열어도 "요청했습니다"다 — 버튼이 없다',
          (await waitFor(`!!document.querySelector('[data-testid="access-requested"]')`, 15000))
            && !(await evaluate(`!!document.querySelector('[data-testid="access-request"]')`)))
        const again = await fetch(`${pagesUrl}/${secret}/access-requests`, { method: 'POST', headers: asAsker })
        check('다시 보내도 새 요청이 아니다 (sent: false)', again.ok && (await again.json()).sent === false, String(again.status))

        // ② 허락하는 쪽 — 인박스의 줄을 누르면 공유 패널이 열린 채로 온다
        await browseAs(session)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/inbox` })
        const inboxLine = `([...document.querySelectorAll('ul[aria-label="알림 목록"] li')].find((li) => li.textContent.includes(${JSON.stringify(secretTitle)}))?.textContent ?? '')`
        check('★ 소유자의 인박스에 "접근 요청" 줄 — 누가 요청했는지와 함께',
          await waitFor(`${inboxLine}.includes('접근 요청') && ${inboxLine}.includes(${JSON.stringify(`${askerName} 님이 접근을 요청했습니다`)})`, 15000),
          await evaluate(inboxLine))
        await clickSelector(`ul[aria-label="알림 목록"] a[href="/w/${workspaceId}/${secret}?share=1"]`)
        check('★ 그 줄을 누르면 공유 패널이 열린 채로 페이지가 열리고 요청 줄이 선다 · 줄 권한은 읽기부터',
          (await waitFor(`!!document.querySelector('${REQ_ROW}')`, 15000))
            && (await evaluate(`(document.querySelector('${REQ_ROW}')?.textContent ?? '').includes(${JSON.stringify(askerName)})
              && document.querySelector('${REQ_ROW} [data-testid="access-request-level"]')?.value === 'view'`)),
          await evaluate(`location.href`))

        let chose = false
        for (let i = 0; i < 10 && !chose; i += 1) {
          await evaluate(`(() => {
            const s = document.querySelector('${REQ_ROW} [data-testid="access-request-level"]')
            if (!s) return
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'edit')
            s.dispatchEvent(new Event('change', { bubbles: true }))
          })()`)
          chose = await waitFor(`document.querySelector('${REQ_ROW} [data-testid="access-request-level"]')?.value === 'edit'`, 500)
        }
        // 막 열린 페이지는 편집기가 붙으며 자리가 움직여 클릭이 빗나갈 수 있다 — 줄이 사라질 때까지 다시 누른다. 요청이 가는 동안
        // 버튼은 비활성이라(busy) 두 번 허락하지 않는다.
        await clickUntilGone(`${REQ_ROW} [data-testid="access-request-approve"]`, REQ_ROW)
        check('★ 편집으로 허락하면 요청 줄이 사라지고 · 준 권한을 말하고 · 공유 목록에 그 사람이 선다',
          chose && (await noticeSays(`${askerName} 님에게 편집 권한을 줬습니다`))
            && !(await evaluate(`!!document.querySelector('${REQ_ROW}')`))
            && (await waitFor(`[...document.querySelectorAll('[role="dialog"][aria-label="공유 설정"] li')].some((li) => li.textContent.includes(${JSON.stringify(askerName)}) && li.querySelector('select')?.value === 'edit')`, 10000)),
          `골랐나 ${chose} · ${await evaluate(`document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent?.slice(0, 300) ?? '(패널 없음)'`)}`)

        const opened = await fetch(`${BASE}/w/${workspaceId}/${secret}`, { headers: asAsker })
        check('★ 요청한 사람이 이제 그 페이지를 연다 — 제목과 함께',
          opened.status === 200 && (await opened.text()).includes(secretTitle), String(opened.status))
        const askerInbox = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: asAsker })).json()
        check('요청한 사람의 인박스에 "접근 허락"이 온다',
          (askerInbox.items ?? []).some((i) => i.pageId === secret && i.kind === 'access_granted'), JSON.stringify(askerInbox.items?.map((i) => i.kind)))
        const ownerInbox = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: authed })).json()
        check('소유자의 인박스 줄은 요청의 지금 상태(허락됨)를 읽는다',
          (ownerInbox.items ?? []).some((i) => i.pageId === secret && i.kind === 'access_requested' && i.access?.status === 'approved'))

        // ③ 무시 — 요청한 사람에게 알리지 않는다
        const quietAsk = await fetch(`${pagesUrl}/${quiet}/access-requests`, { method: 'POST', headers: asAsker })
        check('전제 — 둘째 페이지를 요청한다', quietAsk.ok && (await quietAsk.json()).sent === true, String(quietAsk.status))
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${quiet}?share=1` })
        await waitFor(`!!document.querySelector('${REQ_ROW}')`, 15000)
        await clickUntilGone(`${REQ_ROW} [data-testid="access-request-ignore"]`, REQ_ROW)
        check('★ 무시하면 요청 줄이 사라지고 · 요청한 사람에게 알리지 않는다고 말한다',
          (await noticeSays('알리지 않습니다')) && !(await evaluate(`!!document.querySelector('${REQ_ROW}')`)),
          await evaluate(`document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent?.slice(0, 300) ?? '(패널 없음)'`))
        const quietHtml = await (await fetch(`${BASE}/w/${workspaceId}/${quiet}`, { headers: asAsker })).text()
        const quietAgain = await fetch(`${pagesUrl}/${quiet}/access-requests`, { method: 'POST', headers: asAsker })
        const askerInboxAfter = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: asAsker })).json()
        check('★ 요청한 사람에게는 여전히 "요청했습니다"다 — 다시 보내도 새 요청이 아니고 · 인박스에 아무것도 없다',
          quietHtml.includes('data-testid="access-requested"') && !quietHtml.includes('data-testid="access-request"')
            && quietAgain.ok && (await quietAgain.json()).sent === false
            && !(askerInboxAfter.items ?? []).some((i) => i.pageId === quiet))
      } finally {
        await browseAs(session)
        // 소유자의 인박스에 남긴 요청 알림을 보관한다 — 뒤의 인박스 절은 안 읽은 알림 수를 센다(전체 판에서 배지가 1 이 아니라
        // 3 이 되어 떨어졌다). 절은 자기가 만든 것을 치운다.
        const mine = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: authed })).json()
        const ids = (mine.items ?? []).filter((i) => i.pageId === secret || i.pageId === quiet).flatMap((i) => i.notificationIds)
        if (ids.length > 0) {
          await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, {
            method: 'PATCH', headers: authed, body: JSON.stringify({ ids, read: true, archived: true }),
          })
        }
      }
      // 허락 · 무시의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('편집 권한 요청 (7e-2 · F-06-15)')) {
      // 읽기만 받은 동료가(브라우저 세션을 동료로 바꾼다) 공유 패널에서 편집 권한을 요청하고 → 소유자가 인박스의 그 줄로 공유 패널을
      // 열어 허락한다(기본 레벨은 요청한 편집). 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 브라우저 세션과 소유자의
      // 인박스는 끝에 되돌린다(뒤 절이 소유자로 돌고, 인박스 절은 안 읽은 수를 센다).
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const readerName = `읽기만 받은 동료 ${stamp}`
      const reader = await joinAs(workspaceId, await createUser(readerName), 'member')
      const asReader = { ...json, cookie: `nc_session=${reader.token}` }
      const docTitle = `고치고 싶은 문서 ${stamp}`
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: docTitle, privateTop: true }) })).json()).page.id
      const shared = await fetch(`${pagesUrl}/${doc}/access`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: reader.userId }, level: 'view' }),
      })
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const DIALOG = '[role="dialog"][aria-label="공유 설정"]'
      const REQ_ROW = '[data-testid="access-requests"] [data-testid="access-request-row"]'
      const accessAs = async (headers) => (await fetch(`${pagesUrl}/${doc}/access`, { headers })).json()

      try {
        check('전제 — 동료는 그 문서를 읽기로 받았다', shared.ok, String(shared.status))
        const ownerView = await accessAs(authed)
        check('고칠 수 있는 사람(소유자)에게는 편집 요청 줄이 오지 않는다', ownerView.editRequest === null, JSON.stringify(ownerView.editRequest))

        // ① 요청하는 쪽 — 공유 패널을 연다(서버 렌더 뒤 붙기 전의 클릭은 사라진다 — 패널이 뜰 때까지 다시 누른다 · §6)
        await browseAs(reader.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
        await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
        let opened = false
        for (let i = 0; i < 10 && !opened; i += 1) {
          await clickText('공유')
          opened = await waitFor(`!!document.querySelector('${DIALOG} [data-testid="edit-request-send"]')`, 1500)
        }
        check('★ 읽기만 받은 사람의 공유 패널에 "고칠 수 없습니다 · 편집 권한 요청"이 선다', opened,
          await evaluate(`document.querySelector('${DIALOG}')?.textContent?.slice(0, 200) ?? '(패널 없음)'`))
        await clickSelector(`${DIALOG} [data-testid="edit-request-send"]`)
        check('★ 누르면 "편집 권한을 요청했습니다"로 바뀐다',
          await waitFor(`(document.querySelector('${DIALOG} [data-testid="edit-requested"]')?.textContent ?? '').includes('편집 권한을 요청했습니다')`, 10000))
        const readerView = await accessAs(asReader)
        check('서버도 요청했다고 안다 — 다시 열어도 같다', readerView.editRequest?.requested === true, JSON.stringify(readerView.editRequest))

        // ② 허락하는 쪽 — 인박스의 줄에서 공유 패널로
        await browseAs(session)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/inbox` })
        const inboxLine = `([...document.querySelectorAll('ul[aria-label="알림 목록"] li')].find((li) => li.textContent.includes(${JSON.stringify(docTitle)}))?.textContent ?? '')`
        check('★ 소유자의 인박스에 "편집 권한을 요청했습니다" 줄',
          await waitFor(`${inboxLine}.includes(${JSON.stringify(`${readerName} 님이 편집 권한을 요청했습니다`)})`, 15000),
          await evaluate(inboxLine))
        await clickSelector(`ul[aria-label="알림 목록"] a[href="/w/${workspaceId}/${doc}?share=1"]`)
        check('★ 요청 줄이 "편집 요청"으로 서고 · 허락할 레벨은 요청한 편집이 기본이다',
          (await waitFor(`!!document.querySelector('${REQ_ROW}')`, 15000))
            && (await evaluate(`(document.querySelector('${REQ_ROW} [data-testid="access-request-kind"]')?.textContent ?? '') === '편집 요청'
              && document.querySelector('${REQ_ROW} [data-testid="access-request-level"]')?.value === 'edit'`)),
          await evaluate(`document.querySelector('${REQ_ROW}')?.textContent ?? '(줄 없음)'`))
        for (let i = 0; i < 10; i += 1) {
          await clickSelector(`${REQ_ROW} [data-testid="access-request-approve"]`)
          if (await waitFor(`!document.querySelector('${REQ_ROW}')`, 1500)) break
        }
        check('★ 허락하면 편집을 줬다고 말한다',
          await waitFor(`(document.querySelector('${DIALOG} [role="status"]')?.textContent ?? '').includes(${JSON.stringify(`${readerName} 님에게 편집 권한을 줬습니다`)})`, 10000))

        const after = await accessAs(asReader)
        const mine = (after.entries ?? []).find((e) => e.principalType === 'user' && e.principalId === reader.userId)
        check('★ 동료는 이제 편집 권한을 갖고 · 편집 요청 줄이 사라진다',
          mine?.level === 'edit' && after.editRequest === null, JSON.stringify({ level: mine?.level, editRequest: after.editRequest }))
      } finally {
        await browseAs(session)
        const inbox = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: authed })).json()
        const ids = (inbox.items ?? []).filter((i) => i.pageId === doc).flatMap((i) => i.notificationIds)
        if (ids.length > 0) {
          await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, {
            method: 'PATCH', headers: authed, body: JSON.stringify({ ids, read: true, archived: true }),
          })
        }
      }
      await sleep(1500)
    }

    if (sectionIf('페이지 잠금 (7f-1 · F-06-16)')) {
      // 소유자(브라우저)가 본문을 열어 둔 채로 편집자 동료가 잠근다 → 열린 편집기가 곧바로 읽기 전용이 된다(협업 신호). 다시 열면
      // "잠김" · 풀기 버튼 · 제목도 읽기 전용이고, 풀면 다시 고친다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const docTitle = `잠글 문서 ${stamp}`
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: docTitle, privateTop: true }) })).json()).page.id
      await saveBody(doc, { blocks: [block(randomUUID(), 'paragraph', '잠그기 전의 본문')] })
      const mate = await joinAs(workspaceId, await createUser(`잠그는 동료 ${stamp}`), 'member')
      const viewer = await joinAs(workspaceId, await createUser(`읽기만 하는 동료 ${stamp}`), 'member')
      for (const [who, level] of [[mate, 'edit'], [viewer, 'view']]) {
        await fetch(`${pagesUrl}/${doc}/access`, {
          method: 'POST', headers: authed,
          body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: who.userId }, level }),
        })
      }
      const as = (who) => ({ ...json, cookie: `nc_session=${who.token}` })
      const EDITABLE = `document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`
      const BANNER = `(document.querySelector('section[aria-label="본문"] > p[role="status"]')?.textContent ?? '')`
      const renameAs = (headers, title) => fetch(`${pagesUrl}/${doc}`, { method: 'PATCH', headers, body: JSON.stringify({ title }) })

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
      check('전제 — 소유자가 연 본문은 고칠 수 있고 "잠그기" 버튼이 있다',
        (await waitFor(EDITABLE, 15000)) && (await waitFor(`!!document.querySelector('[data-testid="page-lock-toggle"]')`, 5000)))

      const locked = await fetch(`${pagesUrl}/${doc}/lock`, { method: 'PUT', headers: as(mate) })
      check('편집자 동료가 잠근다 (PUT lock)', locked.ok && (await locked.json()).changed === true, String(locked.status))
      check('★ 열어 둔 편집기가 곧바로 읽기 전용이 된다 — 서버가 연결을 다시 연다(협업 신호)',
        await waitFor(`!(${EDITABLE}) && ${BANNER}.includes('읽기 전용')`, 15000),
        await evaluate(BANNER))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
      check('★ 다시 열면 "잠김" · "잠금 풀기" · 잠긴 페이지라는 말 · 제목도 읽기 전용',
        (await waitFor(`!!document.querySelector('[data-testid="page-locked"]')
          && (document.querySelector('[data-testid="page-lock-toggle"]')?.textContent ?? '') === '잠금 풀기'
          && ${BANNER}.includes('잠긴 페이지입니다')
          && document.querySelector('input[aria-label="페이지 제목"]')?.readOnly === true`, 15000))
          && !(await evaluate(EDITABLE)))
      const ownerRename = await renameAs(authed, '잠겼는데 바꾼 제목')
      check('잠긴 페이지의 제목은 소유자도 못 바꾼다 (409 locked)',
        ownerRename.status === 409 && (await ownerRename.json()).error === 'locked', String(ownerRename.status))

      const viewerHtml = await (await fetch(`${BASE}/w/${workspaceId}/${doc}`, { headers: as(viewer) })).text()
      check('읽기만 하는 사람은 "잠김"만 본다 — 풀기 버튼이 없다',
        viewerHtml.includes('data-testid="page-locked"') && !viewerHtml.includes('data-testid="page-lock-toggle"'))
      const viewerUnlock = await fetch(`${pagesUrl}/${doc}/lock`, { method: 'DELETE', headers: as(viewer) })
      check('읽기만 하는 사람은 풀지 못한다 (403)', viewerUnlock.status === 403, String(viewerUnlock.status))

      // 풀면 페이지를 다시 연다 — 서버 렌더 뒤 붙기 전의 클릭은 사라지므로 "잠김"이 사라질 때까지 다시 누른다(§6).
      const unlocked = await pressLockToggle('잠금 풀기', `!document.querySelector('[data-testid="page-locked"]')`)
      check('★ "잠금 풀기"를 누르면 다시 열려 곧바로 고칠 수 있다', unlocked && (await waitFor(EDITABLE, 15000)),
        await evaluate(BANNER))

      const relocked = await pressLockToggle('잠그기', `!!document.querySelector('[data-testid="page-locked"]')`)
      check('★ "잠그기"를 누르면 "잠김"이 서고 그 편집기도 읽기 전용이 된다', relocked && (await waitFor(`!(${EDITABLE})`, 15000)))

      // 풀어 둔 페이지에서 본다 — 잠긴 채면 권한이 아니라 잠금 때문에 거부될 수 있다.
      await fetch(`${pagesUrl}/${doc}/lock`, { method: 'DELETE', headers: authed })
      const readerRename = await renameAs(as(viewer), '읽기만 하는 사람이 바꾼 제목')
      check('★ 읽기만 받은 사람은 제목을 못 바꾼다 (403) — 7f-1 전에는 권한을 묻지 않았다',
        readerRename.status === 403, String(readerRename.status))
      await sleep(1500)
    }

    if (sectionIf('데이터베이스 잠금 (7f-2 · F-06-16)')) {
      // 소유자(브라우저)가 표를 잠그면 구조 화면(뷰 더하기 · 열 더하기)이 사라지고 구조 요청은 409 `locked` 다. 행과 값은 그대로
      // 고친다. 행 페이지를 잠그면 그 행의 셀만 막힌다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const api = async (method, path, body, headers = authed) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `잠글 표 ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const titleCell = (text) => ({ propertyId: titleProp, value: { type: 'title', title: [textRun(text)] } })
      const rowId = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell(`첫 행 ${stamp}`)] })).body.row.id
      const otherRowId = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell(`둘째 행 ${stamp}`)] })).body.row.id
      const STRUCTURE = `!!document.querySelector('[data-testid="db-view-add"]') && !!document.querySelector('[data-testid="db-add-column"]')`
      const NO_STRUCTURE = `!document.querySelector('[data-testid="db-view-add"]') && !document.querySelector('[data-testid="db-add-column"]')`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      check('전제 — 잠그기 전에는 뷰 더하기 · 열 더하기가 있고 "잠그기" 버튼이 있다',
        await waitFor(`${STRUCTURE} && (document.querySelector('[data-testid="page-lock-toggle"]')?.textContent ?? '') === '잠그기'`, 15000))

      const locked = await pressLockToggle('잠그기', `!!document.querySelector('[data-testid="page-locked"]')`)
      check('★ "잠그기"를 누르면 "잠김"이 서고 구조 화면(뷰 더하기 · 열 더하기)이 사라진다 — 행 더하기는 남는다',
        locked && (await waitFor(`${NO_STRUCTURE} && !!document.querySelector('[data-testid="db-add-row"]')`, 10000)))

      const addProp = await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '잠긴 뒤의 속성', type: 'number' })
      const addView = await api('POST', `/databases/${db.id}/views`, { name: '잠긴 뒤의 뷰' })
      const rename = await api('PATCH', `/databases/${db.id}`, { name: '잠긴 뒤의 이름' })
      check('★ 구조 요청은 409 locked 다 — 속성 · 뷰 · 이름',
        [addProp, addView, rename].every((r) => r.status === 409 && r.body?.error === 'locked'),
        JSON.stringify([addProp, addView, rename].map((r) => [r.status, r.body?.error])))
      const newRow = await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell('잠긴 표의 새 행')] })
      const edit = await api('PATCH', `/rows/${rowId}`, { cells: [titleCell('잠긴 표에서 고친 제목')] })
      check('★ 행과 값은 그대로 고친다 — 행 만들기(201) · 셀 고치기', newRow.status === 201 && edit.status === 200,
        JSON.stringify([newRow.status, edit.status]))

      const rowLock = await api('PUT', `/pages/${rowId}/lock`)
      const lockedCell = await api('PATCH', `/rows/${rowId}`, { cells: [titleCell('잠긴 행을 고친 제목')] })
      const otherCell = await api('PATCH', `/rows/${otherRowId}`, { cells: [titleCell('다른 행은 고친다')] })
      check('★ 행 페이지를 잠그면 그 행의 셀만 409 locked — 다른 행은 고친다',
        rowLock.status === 200 && lockedCell.status === 409 && lockedCell.body?.error === 'locked' && otherCell.status === 200,
        JSON.stringify([rowLock.status, lockedCell.status, otherCell.status]))

      const unlocked = await pressLockToggle('잠금 풀기', `!document.querySelector('[data-testid="page-locked"]')`)
      check('★ "잠금 풀기"를 누르면 구조 화면이 돌아온다', unlocked && (await waitFor(STRUCTURE, 10000)))
      const afterUnlock = await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '풀린 뒤의 속성', type: 'number' })
      check('풀린 뒤에는 속성을 더한다', afterUnlock.status === 200 || afterUnlock.status === 201, String(afterUnlock.status))
      await sleep(1500)
    }

    if (sectionIf('게스트의 대기 초대 (7g-1 · F-06-09)')) {
      // 소유자가 가입하지 않은 이메일을 페이지에 초대한다 → 대기 초대 · 메일(개발 링크). 그 사람이 진짜 로그인 흐름으로 가입하고
      // 브라우저로 링크를 열어 받아들이면 그 페이지로 간다 — 그 페이지만 본다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const docTitle = `가입 전에 초대한 문서 ${stamp}`
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: docTitle, privateTop: true }) })).json()).page.id
      const other = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `초대 안 한 문서 ${stamp}`, privateTop: true }) })).json()).page.id
      const email = `pending-${stamp}@example.com`
      const invited = await fetch(`${pagesUrl}/${doc}/guests`, { method: 'POST', headers: authed, body: JSON.stringify({ email, level: 'comment' }) })
      const body = await invited.json()
      const link = await inviteLinkFor(email)
      check('★ 계정이 없는 이메일을 초대하면 대기 초대가 된다 — 초대 메일이 나가고 토큰은 응답에 없다',
        invited.ok && body.as === 'pending' && typeof link === 'string' && body.token === undefined && !JSON.stringify(body).includes('/invite/'),
        `${JSON.stringify(body)} · ${link}`)
      const ownerHome = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.people`, { headers: authed })).text()
      check('사람 절의 대기 중인 초대에 "게스트 · 페이지 하나"로 선다 — 페이지 제목은 없다',
        ownerHome.includes(email) && ownerHome.includes('게스트 · 페이지 하나'))

      // 그 사람이 가입한다 — 진짜 로그인 흐름(코드 요청 → 콘솔 메일러의 코드 → 확인)
      const requested = await fetch(`${BASE}/api/auth/request-code`, { method: 'POST', headers: json, body: JSON.stringify({ email }) })
      const code = await loginCodeFor(email)
      const verified = await fetch(`${BASE}/api/auth/verify-code`, { method: 'POST', headers: json, body: JSON.stringify({ email, code }) })
      const newcomer = verified.headers.getSetCookie().find((c) => c.startsWith('nc_session='))?.split(';')[0].slice('nc_session='.length)
      check('전제 — 그 이메일로 가입했다', requested.ok && verified.ok && typeof newcomer === 'string', String(verified.status))

      try {
        await send('Network.setCookie', { name: 'nc_session', value: newcomer, domain: 'localhost', path: '/', httpOnly: true })
        // 메일의 링크는 앱의 공개 주소(`NEXT_PUBLIC_APP_URL` — .env 의 개발 서버)를 가리킨다. e2e 서버는 다른 포트라 경로만 옮긴다.
        await send('Page.navigate', { url: `${BASE}${new URL(link).pathname}` })
        check('★ 링크를 열면 "페이지 하나에 게스트로" 초대됐다고 말한다 — 페이지 제목은 없다',
          (await waitFor(`(document.querySelector('[data-testid="invite-summary"]')?.textContent ?? '').includes('페이지 하나에 게스트로')`, 15000))
            && !(await evaluate(`document.body.innerText.includes(${JSON.stringify(docTitle)})`)))
        let arrived = false
        for (let i = 0; i < 10 && !arrived; i += 1) {
          await clickText('초대 받아들이기')
          arrived = await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${doc}`)}`, 1500)
        }
        check('★ 받아들이면 그 페이지로 가고 제목이 보인다',
          arrived && (await waitFor(`(document.querySelector('input[aria-label="페이지 제목"]')?.value ?? '') === ${JSON.stringify(docTitle)}`, 15000)),
          await evaluate('location.pathname'))
        const asNewcomer = { cookie: `nc_session=${newcomer}` }
        check('★ 초대하지 않은 페이지는 못 연다(접근 요청 화면) — 게스트다',
          await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${other}`, { headers: asNewcomer })))
        const again = await fetch(`${BASE}/api/invites/accept`, {
          method: 'POST', headers: { ...json, cookie: `nc_session=${newcomer}` }, body: JSON.stringify({ token: decodeURIComponent(new URL(link).pathname.split('/').pop()) }),
        })
        check('같은 링크로 다시 받아들이지 못한다 (404)', again.status === 404, String(again.status))
      } finally {
        await send('Network.setCookie', { name: 'nc_session', value: session, domain: 'localhost', path: '/', httpOnly: true })
      }
      await sleep(1500)
    }

    if (sectionIf('워크스페이스 밖의 사람의 접근 요청 (7g-2 · F-06-15)')) {
      // 이 워크스페이스에 멤버십이 없는 사람이(브라우저 세션을 그 사람으로 바꾼다) 페이지 주소를 열어 요청하고 → 소유자가 공유 패널의
      // "워크스페이스 밖" 줄을 허락하면 게스트로 들어와 그 페이지를 연다. 소유자가 정책을 끄면 밖의 사람에게 그 주소는 없는 페이지다 —
      // 설정의 보안 절에서 다시 켠다(8g-1 — 정책은 설정이다). 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 브라우저 세션 · 정책 · 소유자의 인박스는
      // 끝에 되돌린다(뒤 절이 소유자로 돌고, 인박스 절은 안 읽은 수를 센다).
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const policyUrl = `${BASE}/api/workspaces/${workspaceId}/settings/workspace.allow_nonmember_page_access_request`
      const POLICY_CONTROL = '[data-testid="setting-row"][data-setting-key="workspace.allow_nonmember_page_access_request"] [data-testid="setting-control"]'
      const outsiderName = `밖의 사람 ${stamp}`
      const outside = await visitAsOutsider(workspaceId, await createUser(outsiderName))
      const asOutsider = { ...json, cookie: `nc_session=${outside.token}` }
      const makePrivate = async (title) =>
        (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title, privateTop: true }) })).json()).page.id
      const docTitle = `밖에서 요청받을 문서 ${stamp}`
      const shutTitle = `정책을 끈 뒤의 문서 ${stamp}`
      const doc = await makePrivate(docTitle)
      const shut = await makePrivate(shutTitle)
      const other = await makePrivate(`요청 안 한 문서 ${stamp}`)
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const REQ_ROW = '[data-testid="access-requests"] [data-testid="access-request-row"]'
      const noticeSays = (text) =>
        waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"] [role="status"]')?.textContent ?? '').includes(${JSON.stringify(text)})`, 10000)

      try {
        // ① 밖의 사람에게 이 워크스페이스는 페이지 주소 하나 말고는 없다
        const outsiderHome = await fetch(`${BASE}/w/${workspaceId}`, { headers: asOutsider })
        const outsiderInbox = await fetch(`${BASE}/w/${workspaceId}/inbox`, { headers: asOutsider })
        const outsiderApi = await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: asOutsider })
        check('★ 밖의 사람에게 홈 · 인박스 화면 · API 는 여전히 404 다',
          outsiderHome.status === 404 && outsiderInbox.status === 404 && outsiderApi.status === 404,
          `${outsiderHome.status} · ${outsiderInbox.status} · ${outsiderApi.status}`)
        const elsewhere = await fetch(`${BASE}/w/${randomUUID()}/${doc}`, { headers: asOutsider })
        const editAsk = await fetch(`${pagesUrl}/${doc}/access-requests`, { method: 'POST', headers: asOutsider, body: JSON.stringify({ kind: 'edit_access' }) })
        check('없는 워크스페이스 주소로 그 페이지를 열면 404 · 편집 권한 요청은 404 — 밖의 사람은 접근 요청 하나만',
          elsewhere.status === 404 && editAsk.status === 404, `${elsewhere.status} · ${editAsk.status}`)

        // ② 요청하는 쪽 — 브라우저
        await browseAs(outside.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}` })
        check('★ 밖의 사람이 페이지 주소를 열면 요청 화면 — 제목도 사이드바도 없이 · 허락되면 게스트로 본다고',
          (await waitFor(`!!document.querySelector('[data-testid="access-request"]')`, 15000))
            && (await evaluate(`document.body.innerText.includes('게스트로 이 페이지를 봅니다')
              && !document.body.innerText.includes(${JSON.stringify(docTitle)})
              && !document.querySelector('[aria-label="페이지 트리"]')`)),
          await evaluate(`document.body.innerText.slice(0, 200)`))
        let sent = false
        for (let i = 0; i < 10 && !sent; i += 1) {
          await clickSelector('[data-testid="access-request"]')
          sent = await waitFor(`!!document.querySelector('[data-testid="access-requested"]')`, 800)
        }
        check('★ 누르면 "요청했습니다" — 허락되면 이 주소에서 열린다고',
          sent && (await evaluate(`(document.querySelector('[data-testid="access-requested"]')?.textContent ?? '').includes('이 주소에서 페이지가 열립니다')`)))

        // ③ 허락하는 쪽 — 인박스 · 공유 패널
        await browseAs(session)
        const ownerInbox = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: authed })).json()
        check('소유자의 인박스에 밖의 사람의 요청이 이름과 함께 온다',
          (ownerInbox.items ?? []).some((i) => i.pageId === doc && i.kind === 'access_requested' && i.access?.requesterName === outsiderName),
          JSON.stringify((ownerInbox.items ?? []).filter((i) => i.pageId === doc).map((i) => i.access)))
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${doc}?share=1` })
        check('★ 공유 패널의 요청 줄에 "워크스페이스 밖"과 이메일 — 줄 권한에 전체 권한이 없다',
          (await waitFor(`(document.querySelector('${REQ_ROW} [data-testid="access-request-outsider"]')?.textContent ?? '').includes('워크스페이스 밖')`, 15000))
            && (await evaluate(`(document.querySelector('${REQ_ROW}')?.textContent ?? '').includes(${JSON.stringify(outsiderName)})
              && (document.querySelector('${REQ_ROW}')?.textContent ?? '').includes('@example.com')
              && ![...document.querySelectorAll('${REQ_ROW} [data-testid="access-request-level"] option')].some((o) => o.value === 'full_access')`)),
          await evaluate(`document.querySelector('${REQ_ROW}')?.textContent ?? '(줄 없음)'`))
        for (let i = 0; i < 10; i += 1) {
          await clickSelector(`${REQ_ROW} [data-testid="access-request-approve"]`)
          if (await waitFor(`!document.querySelector('${REQ_ROW}')`, 1500)) break
        }
        check('★ 허락하면 게스트로 들어왔다고 말하고 · 공유 목록에 게스트로 선다',
          (await noticeSays(`${outsiderName} 님이 게스트로 들어와 읽기 권한을 받았습니다`))
            && (await waitFor(`[...document.querySelectorAll('[role="dialog"][aria-label="공유 설정"] li')].some((li) => li.textContent.includes(${JSON.stringify(outsiderName)}) && li.textContent.includes('게스트'))`, 10000)),
          await evaluate(`document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent?.slice(0, 300) ?? '(패널 없음)'`))

        const opened = await fetch(`${BASE}/w/${workspaceId}/${doc}`, { headers: asOutsider })
        check('★ 요청한 사람이 이제 그 페이지를 연다 — 제목과 함께', opened.status === 200 && (await opened.text()).includes(docTitle), String(opened.status))
        const guests = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/guests`, { headers: authed })).json()
        check('게스트로 들어왔다 — 게스트 목록에 서고 · 받지 않은 페이지는 게스트의 요청 화면이다',
          (guests.guests ?? []).some((g) => g.userId === outside.userId)
            && (await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${other}`, { headers: asOutsider }))))

        // ④ 정책 — 끄면 밖의 사람에게 그 주소는 없는 페이지다 · 설정의 보안 절에서 다시 켠다
        const second = await visitAsOutsider(workspaceId, await createUser(`두 번째 밖의 사람 ${stamp}`))
        const asSecond = { ...json, cookie: `nc_session=${second.token}` }
        const off = await fetch(policyUrl, { method: 'PUT', headers: authed, body: JSON.stringify({ value: false }) })
        const shutPage = await fetch(`${BASE}/w/${workspaceId}/${shut}`, { headers: asSecond })
        const shutAsk = await fetch(`${pagesUrl}/${shut}/access-requests`, { method: 'POST', headers: asSecond })
        check('★ 소유자가 정책을 끄면 밖의 사람에게 그 주소는 없는 페이지다 — 화면도 요청도 404',
          off.ok && shutPage.status === 404 && shutAsk.status === 404, `${off.status} · ${shutPage.status} · ${shutAsk.status}`)

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.security` })
        check('설정의 보안 절 — 꺼져 있다고 보인다',
          await waitFor(`document.querySelector(${JSON.stringify(POLICY_CONTROL)})?.checked === false`, 15000))
        let saved = false
        for (let i = 0; i < 10 && !saved; i += 1) {
          await clickSelector(POLICY_CONTROL)
          saved = await waitFor(`(document.querySelector('[data-testid="setting-status"]')?.textContent ?? '').includes('저장했습니다')`, 1500)
        }
        check('★ 보안 절에서 다시 켜면 저장했다고 말하고 · 그 사람이 요청 화면을 본다 — 제목 없이',
          saved && (await evaluate(`document.querySelector(${JSON.stringify(POLICY_CONTROL)})?.checked === true`))
            && (await shownNoAccess(await fetch(`${BASE}/w/${workspaceId}/${shut}`, { headers: asSecond }), shutTitle)))

        const mate = await joinAs(workspaceId, await createUser(`정책을 못 고치는 멤버 ${stamp}`), 'member')
        const asMate = { ...json, cookie: `nc_session=${mate.token}` }
        const mateSettings = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.security`, { headers: asMate })).text()
        const mateSet = await fetch(policyUrl, { method: 'PUT', headers: asMate, body: JSON.stringify({ value: false }) })
        check('멤버에게는 정책이 보이지 않고(보안 절도 없다) 바꾸는 API 는 403 이다',
          mateSettings.includes('data-testid="settings-nav"') && !mateSettings.includes('data-setting-key="workspace.allow_nonmember_page_access_request"')
            && !mateSettings.includes('data-section="workspace.security"') && mateSet.status === 403, String(mateSet.status))
      } finally {
        await browseAs(session)
        await fetch(policyUrl, { method: 'PUT', headers: authed, body: JSON.stringify({ value: true }) })
        // 소유자의 인박스에 남긴 요청 알림을 보관한다 — 뒤의 인박스 절은 안 읽은 알림 수를 센다(7e-1 과 같다).
        const mine = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, { headers: authed })).json()
        const ids = (mine.items ?? []).filter((i) => i.pageId === doc || i.pageId === shut).flatMap((i) => i.notificationIds)
        if (ids.length > 0) {
          await fetch(`${BASE}/api/workspaces/${workspaceId}/inbox`, {
            method: 'PATCH', headers: authed, body: JSON.stringify({ ids, read: true, archived: true }),
          })
        }
      }
      // 허락 · 정책 저장의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('대기 초대 취소 (7g-3 · F-14-10)')) {
      // 소유자(브라우저 세션)가 멤버 초대와 게스트의 대기 초대를 보내고, 설정의 사람 절 "대기 중인 초대"(8g-2 — 전에는 홈)에서 게스트 초대를 취소한다 — 그 링크는
      // "유효하지 않은 초대"가 되고 멤버 초대의 링크는 그대로 열린다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 남은
      // 멤버 초대는 끝에 취소한다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const invitesUrl = `${BASE}/api/workspaces/${workspaceId}/invites`
      const memberEmail = `revoke-member-${stamp}@example.com`
      const guestEmail = `revoke-guest-${stamp}@example.com`
      const doc = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `취소할 초대의 문서 ${stamp}`, privateTop: true }) })).json()).page.id
      const memberSent = await fetch(invitesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ email: memberEmail, role: 'member' }) })
      const memberInviteId = memberSent.ok ? (await memberSent.json()).inviteId : null
      const guestSent = await fetch(`${pagesUrl}/${doc}/guests`, { method: 'POST', headers: authed, body: JSON.stringify({ email: guestEmail, level: 'view' }) })
      const memberLink = await inviteLinkFor(memberEmail)
      const guestLink = await inviteLinkFor(guestEmail)
      // 메일의 링크는 앱의 공개 주소를 가리킨다 — 경로만 떼어 e2e 서버에 붙인다(7g-1 · §6).
      const openLink = async (link) => (await fetch(`${BASE}${new URL(link).pathname}`)).text()
      check('전제 — 멤버 초대와 게스트의 대기 초대를 보냈다 · 두 링크 모두 유효하다',
        typeof memberInviteId === 'string' && guestSent.ok && typeof memberLink === 'string' && typeof guestLink === 'string'
          && !(await openLink(memberLink)).includes('유효하지 않은 초대입니다') && !(await openLink(guestLink)).includes('유효하지 않은 초대입니다'),
        `${memberSent.status} · ${guestSent.status} · ${memberLink} · ${guestLink}`)

      const ROW = '[data-testid="pending-invite-row"]'
      const rowOf = (email) => `[...document.querySelectorAll('${ROW}')].find((li) => li.textContent.includes(${JSON.stringify(email)}))`
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.people` })
      check('★ 사람 절의 대기 중인 초대에 두 줄이 취소 버튼과 함께 선다 — 게스트 초대는 "게스트 · 페이지 하나"',
        await waitFor(`!!${rowOf(memberEmail)}?.querySelector('[data-testid="pending-invite-revoke"]')
          && (${rowOf(guestEmail)}?.textContent ?? '').includes('게스트 · 페이지 하나')
          && !!${rowOf(guestEmail)}?.querySelector('[data-testid="pending-invite-revoke"]')`, 15000))
      const guestInviteId = await evaluate(`${rowOf(guestEmail)}?.dataset.inviteId ?? null`)
      // 서버 렌더 뒤 React 가 붙기 전의 클릭은 사라진다(§6) — 줄이 빠질 때까지 다시 누른다(두 번 가도 둘째는 404 로 줄만 뺀다).
      let gone = false
      for (let i = 0; i < 10 && !gone; i += 1) {
        await clickSelector(`${ROW}[data-invite-id="${guestInviteId}"] [data-testid="pending-invite-revoke"]`)
        gone = await waitFor(`!${rowOf(guestEmail)}`, 1500)
      }
      check('★ 게스트 초대를 취소하면 그 줄이 빠지고 · 보낸 링크가 이제 열리지 않는다고 말한다 · 멤버 초대는 남는다',
        gone && (await waitFor(`(document.querySelector('[data-testid="pending-invite-notice"]')?.textContent ?? '').includes(${JSON.stringify(`${guestEmail} 의 초대를 취소했습니다`)})`, 10000))
          && (await evaluate(`!!${rowOf(memberEmail)}`)),
        await evaluate(`document.querySelector('[data-testid="pending-invites"]')?.textContent ?? '(목록 없음)'`))
      check('★ 취소한 링크를 열면 "유효하지 않은 초대입니다" — 멤버 초대의 링크는 그대로 열린다',
        (await openLink(guestLink)).includes('유효하지 않은 초대입니다') && !(await openLink(memberLink)).includes('유효하지 않은 초대입니다'))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.people` })
      check('다시 열어도 취소한 초대는 없다 — 서버가 지운 것이다',
        (await waitFor(`!!${rowOf(memberEmail)}`, 15000)) && !(await evaluate(`!!${rowOf(guestEmail)}`)))

      // 목록은 서버 렌더가 정본이다 — 사람 절의 초대 폼으로 보낸 새 초대가 곧바로 목록에 선다(목록을 상태로 복사하면 서지 않는다).
      const formEmail = `revoke-form-${stamp}@example.com`
      let formRow = false
      for (let i = 0; i < 10 && !formRow; i += 1) {
        await clickSelector('[data-testid="invite-form"] input[type="email"]')
        await evaluate(`(() => {
          const el = document.querySelector('[data-testid="invite-form"] input[type="email"]')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(formEmail)})
          el.dispatchEvent(new Event('input', { bubbles: true }))
        })()`)
        await clickSelector('[data-testid="invite-form"] button[type="submit"]')
        formRow = await waitFor(`!!${rowOf(formEmail)}?.querySelector('[data-testid="pending-invite-revoke"]')`, 3000)
      }
      check('★ 사람 절의 초대 폼으로 보낸 새 초대가 곧바로 목록에 선다 — 취소 버튼과 함께', formRow,
        await evaluate(`document.querySelector('[data-testid="pending-invites"]')?.textContent ?? '(목록 없음)'`))
      const formInviteId = await evaluate(`${rowOf(formEmail)}?.dataset.inviteId ?? null`)
      if (formInviteId) await fetch(`${invitesUrl}/${formInviteId}`, { method: 'DELETE', headers: authed })

      const mate = await joinAs(workspaceId, await createUser(`초대를 못 다루는 멤버 ${stamp}`), 'member')
      const mateRevoke = await fetch(`${invitesUrl}/${memberInviteId}`, { method: 'DELETE', headers: { cookie: `nc_session=${mate.token}` } })
      const twice = await fetch(`${invitesUrl}/${guestInviteId}`, { method: 'DELETE', headers: authed })
      const mateHome = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.people`, { headers: { cookie: `nc_session=${mate.token}` } })).text()
      check('멤버는 취소하지 못하고(403) 목록도 없다 · 이미 취소한 초대는 404',
        mateRevoke.status === 403 && twice.status === 404 && !mateHome.includes('data-testid="pending-invites"'),
        `${mateRevoke.status} · ${twice.status}`)
      const cleanup = await fetch(`${invitesUrl}/${memberInviteId}`, { method: 'DELETE', headers: authed })
      check('API 로도 취소한다 — 취소한 주소를 돌려준다', cleanup.ok && (await cleanup.json()).email === memberEmail, String(cleanup.status))
      // 취소의 refresh 가 끝나기 전에 다음 절이 화면을 옮기지 않게 한다(§6).
      await sleep(1500)
    }

    if (sectionIf('코드 블록 (8a-1 · F-01-14)')) {
      // 새 페이지의 빈 줄에서 ``` 을 쳐 코드 블록을 만들고, Enter(줄바꿈) · Tab(들여쓰기 글자) · `/`(메뉴 없음)를 친 뒤 Mod+Enter 로
      // 빠져나와 문단을 쓴다. 서버에 저장된 본문(협업 서버 → 투영)이 코드 블록 하나 + 문단 하나인지 본다. 자기 데이터를 스스로
      // 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const codePage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `코드 블록 ${stamp}` }),
      })).json()).page.id
      const firstLine = randomUUID()
      const expected = 'if ok:\n\trun("# x") /P1\nP2'
      await saveBody(codePage, { blocks: [{ id: firstLine, type: 'paragraph', title: [], properties: {}, format: {}, children: [] }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${codePage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${firstLine}"] p')`, 15000)
      // 편집기가 붙기 전의 클릭은 캐럿을 두지 않는다 — 캐럿이 그 줄에 설 때까지 다시 누른다.
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${firstLine}"] p`)
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && !!window.getSelection()?.anchorNode && document.querySelector('[data-block-id="${firstLine}"]')?.contains(window.getSelection().anchorNode)`, 500)
      }
      check('전제 — 빈 줄에 캐럿이 섰다', focused)

      for (const ch of '```') await typeText(ch)
      check('★ 줄 머리에 ``` 을 치면 코드 블록이 된다', await waitFor(`!!document.querySelector('[data-block-id="${firstLine}"] pre.blk-code')`, 3000),
        await evaluate(`document.querySelector('[data-block-id="${firstLine}"]')?.innerHTML ?? '(없음)'`))

      await typeText('if ok:')
      await key('Enter')
      await key('Tab')
      await typeText('run("# x")')
      await typeText(' /')
      const slashOpened = await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 800)
      check('★ Enter 는 줄바꿈 · Tab 은 들여쓰기 글자 — 블록이 하나로 남고 · 코드 안의 / 는 메뉴를 열지 않는다',
        !slashOpened && (await evaluate(`document.querySelectorAll('.blk-editor [data-block-id]').length === 1
          && document.querySelector('[data-block-id="${firstLine}"] pre.blk-code')?.textContent === ${JSON.stringify(expected.slice(0, expected.indexOf('P1')))}`)),
        JSON.stringify(await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((c) => c.textContent)`)))

      // 코드 블록 안에 블록 묶음을 붙여넣으면 평문이다(F-01-14 · F-01-10) — 합성 붙여넣기 이벤트에 우리 블록 묶음과 그 평문을 싣는다.
      // 붙여넣기 처리가 블록 묶음을 풀면 문단 둘이 코드 블록 뒤에 선다.
      const pastedBlocks = ['P1', 'P2'].map((t) => ({ id: randomUUID(), type: 'paragraph', title: [textRun(t)], properties: {}, format: {}, children: [] }))
      await evaluate(`(() => {
        const dt = new DataTransfer()
        dt.setData('application/x-notion-clone-blocks+json', ${JSON.stringify(JSON.stringify({ version: 1, blocks: pastedBlocks }))})
        dt.setData('text/plain', ${JSON.stringify('P1\nP2')})
        document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      })()`)
      check('★ 코드 블록 안에 블록 묶음을 붙여넣으면 평문으로 들어간다 — 블록이 늘지 않는다',
        await waitFor(`document.querySelectorAll('.blk-editor [data-block-id]').length === 1
          && document.querySelector('[data-block-id="${firstLine}"] pre.blk-code')?.textContent === ${JSON.stringify(expected)}`, 3000),
        JSON.stringify(await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((c) => c.textContent)`)))

      await key('Enter', MOD)
      await typeText('after')
      check('★ Mod+Enter 는 코드 블록을 빠져나와 아래 문단에 쓴다',
        await waitFor(`(() => {
          const rows = [...document.querySelectorAll('.blk-editor [data-block-id]')]
          return rows.length === 2 && rows[1].querySelector('p')?.textContent === 'after'
        })()`, 3000),
        JSON.stringify(await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((c) => c.firstElementChild?.tagName + ':' + c.textContent)`)))

      // 서버 — 협업 서버가 받은 편집이 투영된 본문(행). 투영 창(1s)만큼 늦으니 기다린다.
      let saved = null
      for (let i = 0; i < 60; i += 1) {
        const blocks = (await readBody(codePage)).doc.blocks
        const text = (b) => (b?.title ?? []).map((r) => r.plain_text ?? r.text?.content ?? '').join('')
        saved = blocks.map((b) => [b.type, text(b)])
        if (JSON.stringify(saved) === JSON.stringify([['code', expected], ['paragraph', 'after']])) break
        await sleep(150)
      }
      check("★ 서버에 코드 블록(type='code') 하나 — 줄바꿈 · 탭 · 마크다운 글자가 그대로 — 와 문단이 저장됐다",
        JSON.stringify(saved) === JSON.stringify([['code', expected], ['paragraph', 'after']]), JSON.stringify(saved))

      // 다시 열어도 코드 블록으로 그린다(Y.Doc 의 `code_block` 을 읽는다).
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${codePage}` })
      check('다시 열어도 코드 블록이다 — 줄바꿈 · 탭 그대로',
        await waitFor(`document.querySelector('[data-block-id="${firstLine}"] pre.blk-code')?.textContent === ${JSON.stringify(expected)}`, 15000))
      await sleep(1500)
    }

    if (sectionIf('코드 블록 크롬 (8a-2 · F-01-14)')) {
      // 코드 블록의 버튼 줄(언어 · 줄바꿈 · 복사 · 캡션)과 편집기 밖의 두 오버레이(언어 목록 · 캡션 입력)를 진짜 키 · 마우스로 쓴다.
      // 방어 하나마다 그것만 떨어뜨리는 장면을 둔다(8a-2 설계 비평 — 반사실이 겨냥한 검사를 뒤집어야 한다). 읽기 전용은 열어 둔 채로
      // 잠가 만든다 — 편집 가능 여부만 바뀐다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const chromePage = (await (await fetch(pagesUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `코드 크롬 ${stamp}` }),
      })).json()).page.id
      // 멘션 후보가 둘 이상이게 — "코드"로 찾으면 이 페이지와 저 페이지가 나온다(멘션 메뉴의 ↓ 가 움직일 수 있게).
      await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `코드 멘션 대상 ${stamp}` }) })
      const cb = { top: randomUUID(), code: randomUUID(), empty: randomUUID(), fmt: randomUUID(), multi: randomUUID(), img: randomUUID(), todo: randomUUID(), bottom: randomUUID() }
      const CODE_TEXT = 'print(1)\nprint(2)'
      const MULTI_TEXT = 'yyyy zzzz'
      const MULTI_CAPTION = '첫 줄\n둘째 줄'
      const codeBlock = (id, text, properties = {}) => ({ id, type: 'code', title: text === '' ? [] : [textRun(text)], properties, format: {}, children: [] })
      await saveBody(chromePage, {
        blocks: [
          block(cb.top, 'paragraph', '맨 위 문단'),
          // 코드 블록이 화면에 올 때 맨 위 문단은 화면 밖이게 — 크롬 버튼이 화면을 옛 캐럿으로 튀게 하는지 본다.
          ...Array.from({ length: 30 }, (_, i) => block(randomUUID(), 'paragraph', `사이 ${i + 1}`)),
          codeBlock(cb.code, CODE_TEXT, { language: 'python' }),
          codeBlock(cb.empty, ''),
          codeBlock(cb.fmt, 'x', { caption: [textRun('굵은 캡션', { bold: true })] }),
          codeBlock(cb.multi, MULTI_TEXT, { caption: [textRun(MULTI_CAPTION, { italic: true })] }),
          // 빈 이미지 — 편집기 **안**의 진짜 입력칸(주소칸)이 있다(리스너 가드 장면).
          { id: cb.img, type: 'image', title: [], properties: {}, format: {}, children: [] },
          { ...block(cb.todo, 'to_do', '할 일'), properties: { checked: false } },
          block(cb.bottom, 'paragraph', '끝 문단'),
        ],
      })

      const CB = (id) => `[data-block-id="${id}"] .blk-code-block`
      const PART = (id, testid) => `${CB(id)} [data-testid="${testid}"]`
      const EDITABLE = `document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`
      const FOCUS_IN_EDITOR = `document.activeElement === document.querySelector('.blk-editor')`
      const LANG_MENU = '[data-testid="code-language-menu"]'
      const LANG_SEARCH = '[data-testid="code-language-search"]'
      const CAPTION_INPUT = '[data-testid="code-caption-input"]'
      const SLASH = '[role="listbox"][aria-label="블록 삽입"]'
      // 복사는 클립보드 대신 이것에 싣는다 — 이 PC 의 헤드리스 클립보드는 믿을 수 없다(§6). 페이지를 열 때마다 다시 단다.
      const STUB_CLIPBOARD = `(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t } })()`
      const codeText = (id) => evaluate(`document.querySelector('${CB(id)} pre.blk-code')?.textContent ?? null`)
      const blockCount = () => evaluate(`document.querySelectorAll('.blk-editor [data-block-id]').length`)

      /** 서버(투영된 행)의 그 블록. */
      const serverBlock = async (id) => {
        const find = (blocks) => {
          for (const b of blocks) {
            if (b.id === id) return b
            const inner = find(b.children ?? [])
            if (inner) return inner
          }
          return null
        }
        return find((await readBody(chromePage)).doc.blocks)
      }
      /** 서버의 그 블록이 조건을 맞출 때까지 — 투영 창(1s)만큼 늦다. */
      const settledBlock = async (id, pred, ms = 10000) => {
        const end = Date.now() + ms
        let last = null
        while (Date.now() < end) {
          last = await serverBlock(id)
          if (last !== null && pred(last)) return { ok: true, last }
          await sleep(150)
        }
        return { ok: false, last }
      }
      const captionOf = (b) => (b?.properties?.caption ?? []).map((r) => r.plain_text).join('')
      const { loadDocState } = await import(new URL('../src/lib/collab/doc-store.ts', import.meta.url).href)
      const { appendDocUpdate } = await import(new URL('../src/lib/block/body-write.ts', import.meta.url).href)
      const { peer, edit, findBlock, changesSince, contentElementOf } = await import(new URL('../src/lib/testing/collab-peers.ts', import.meta.url).href)
      let remoteClient = 9000
      /** 다른 참여자의 편집 — 쌓으면 협업 서버가 열린 편집기에 퍼뜨린다(커밋 신호). */
      const remoteEdit = async (change) => {
        const state = await loadDocState(ctx, chromePage)
        if (!state.ok) throw new Error('본문을 읽지 못했다')
        remoteClient += 1
        const client = peer(state.value.ydoc, remoteClient)
        change(client)
        const result = await appendDocUpdate(ctx, chromePage, changesSince(client, state.value.ydoc), { origin: 'editor' })
        if (!result.ok) throw new Error(`원격 편집을 받지 않았다: ${JSON.stringify(result)}`)
      }
      /**
       * 순서 표지 — 같은 편집기가 뒤이어 친 글자가 서버에 닿았으면 그 앞의 쓰기도 닿았다(한 연결 · 순서대로 쌓는다). "그대로다"를 고정된
       * 기다림 뒤에 보면 느린 쓰기가 기다림보다 늦게 와 헛통과한다(8a-2 리뷰).
       */
      let barrierCount = 0
      const barrier = async () => {
        barrierCount += 1
        const mark = `·${barrierCount}`
        if (!(await caretAtEnd(cb.bottom))) return false
        await typeText(mark)
        return (await settledBlock(cb.bottom, (b) => (b.title ?? []).map((r) => r.plain_text).join('').endsWith(mark))).ok
      }
      const serverCaption = async (id) => JSON.stringify((await serverBlock(id))?.properties?.caption ?? null)

      /** 코드 블록을 화면 가운데로 · 그 글자 위의 한 점. */
      const codePoint = (id, { scroll = true } = {}) => evaluate(`(() => {
        const pre = document.querySelector('${CB(id)} pre.blk-code')
        if (!pre) return null
        if (${scroll}) pre.scrollIntoView({ block: 'center' })
        const r = pre.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 12) }
      })()`)
      /**
       * 코드 블록에 마우스를 올리고(버튼 줄은 올렸을 때만 보이고 누를 수 있다) 그 버튼의 가운데를 누른다. 그 자리의 맨 위 요소가 그
       * 버튼일 때만 누른다 — 아니면 false. `scroll: false` 면 화면을 옮기지 않는다(스크롤 검사).
       */
      const clickChrome = async (id, testid, { scroll = true } = {}) => {
        const at = await codePoint(id, { scroll })
        if (!at) return false
        await move(at.x, at.y)
        const end = Date.now() + 2000
        let box = null
        while (box === null && Date.now() < end) {
          box = await evaluate(`(() => {
            const el = document.querySelector('${PART(id, testid)}')
            if (!el) return null
            const r = el.getBoundingClientRect()
            const x = r.x + r.width / 2, y = r.y + r.height / 2
            const top = document.elementFromPoint(x, y)
            return r.width > 0 && top !== null && (top === el || el.contains(top)) ? { x, y } : null
          })()`)
          if (box === null) await sleep(40)
        }
        if (box === null) return false
        await click(box.x, box.y)
        await sleep(150)
        return true
      }
      /** 코드 블록 글자의 offset 자리에 캐럿을 둔다 — DOM 선택을 옮기면 편집기가 selectionchange 로 따라온다. */
      const caretInCode = async (id, offset) => {
        await evaluate(`(() => {
          document.querySelector('.blk-editor').focus()
          const pre = document.querySelector('${CB(id)} pre.blk-code')
          const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
          let left = ${offset}
          let node
          while ((node = walker.nextNode())) {
            if (node.data.length >= left) { window.getSelection().collapse(node, left); return }
            left -= node.data.length
          }
          window.getSelection().collapse(pre, 0)
        })()`)
        await sleep(150)
      }
      /**
       * 그 문단의 끝에 캐럿을 둔다 — 캐럿이 그 블록에 섰는지 보고 아니면 다시 누른다. 창 크기 · 스크롤이 막 바뀐 뒤에는 잰 자리가 낡아
       * 클릭이 다른 블록(코드)에 떨어져, 이어 친 글자가 코드에 들어갔다(한 번 겪었다).
       */
      const caretAtEnd = async (id) => {
        for (let i = 0; i < 6; i += 1) {
          await clickSelector(`[data-block-id="${id}"] p`)
          await key('End')
          const inside = await evaluate(`(() => {
            const n = window.getSelection()?.anchorNode
            const el = n?.nodeType === 1 ? n : n?.parentElement
            return document.activeElement === document.querySelector('.blk-editor') && el?.closest('[data-block-id]')?.getAttribute('data-block-id') === '${id}'
          })()`)
          if (inside) return true
          await sleep(200)
        }
        return false
      }
      /** 캐럿이 그 코드 블록 글자의 몇째 자리인가 — 밖이면 -1. */
      const caretOffset = (id) => evaluate(`(() => {
        const pre = document.querySelector('${CB(id)} pre.blk-code')
        const sel = window.getSelection()
        if (!pre || !sel || sel.rangeCount === 0 || !pre.contains(sel.anchorNode)) return -1
        const range = document.createRange()
        range.setStart(pre, 0)
        range.setEnd(sel.anchorNode, sel.anchorOffset)
        return range.toString().length
      })()`)
      /** 한글 조합을 흉내낸다 — 조합 중인 글자 · 조합 중의 Enter(keyCode 229). */
      const composing = async (text) => {
        await send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
        await sleep(300)
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${chromePage}` })
      check('전제 — 코드 블록의 버튼 줄이 그려졌고 편집할 수 있다',
        await waitFor(`!!document.querySelector('${PART(cb.code, 'code-language')}') && ${EDITABLE}`, 15000))
      await evaluate(STUB_CLIPBOARD)

      // ① 모양 — 언어 이름 · 받은 캡션 · 빈 블록 · 숨은 버튼 줄은 누를 수 없다
      await codePoint(cb.code)
      await move(2, 2)
      await sleep(200)
      const shape = await evaluate(`(() => {
        const q = (s) => document.querySelector(s)
        const wrap = q('${PART(cb.code, 'code-wrap-toggle')}')
        const r = wrap.getBoundingClientRect()
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return {
          label: q('${PART(cb.code, 'code-language')}').textContent,
          pointer: getComputedStyle(q('${CB(cb.code)} .blk-code-bar')).pointerEvents,
          hitWrap: top === wrap || wrap.contains(top),
          fmtCaption: q('${PART(cb.fmt, 'code-caption')}').textContent,
          emptyCopyDisabled: q('${PART(cb.empty, 'code-copy')}').disabled,
        }
      })()`)
      check('★ 크롬 — 언어는 저장값의 이름(Python) · 받은 캡션이 보인다 · 빈 코드 블록의 복사는 꺼져 있다',
        shape.label === 'Python' && shape.fmtCaption === '굵은 캡션' && shape.emptyCopyDisabled === true, JSON.stringify(shape))
      check('★ 마우스를 올리기 전의 버튼 줄은 누를 수 없다 — 보이지 않는 버튼이 클릭 · 터치를 먹지 않는다(pointer-events)',
        shape.pointer === 'none' && shape.hitWrap === false, JSON.stringify(shape))

      // ② 언어 — 마우스로 열고 진짜 키로 고른다
      await caretInCode(cb.code, 6)
      check('전제 — 코드 블록의 6째 자리에 캐럿', (await caretOffset(cb.code)) === 6, String(await caretOffset(cb.code)))
      check('★ 언어 버튼을 누르면 편집기 밖에 검색 목록이 열리고 검색칸이 포커스를 갖는다',
        (await clickChrome(cb.code, 'code-language'))
          && (await waitFor(`!!document.querySelector('${LANG_MENU}') && document.activeElement === document.querySelector('${LANG_SEARCH}')`, 3000)))
      await typeText('x')
      await key('Backspace')
      await typeText('java')
      await key('ArrowDown')
      const active = await evaluate(`document.getElementById(document.querySelector('${LANG_SEARCH}')?.getAttribute('aria-activedescendant') ?? '')?.textContent ?? ''`)
      check('↓ 는 다음 후보로 — 검색어 java 의 둘째(JavaScript)', active.startsWith('JavaScript'), active)
      await key('Enter')
      const pickedJs = await settledBlock(cb.code, (b) => b.properties?.language === 'javascript')
      check('★ Enter 로 고르면 목록이 닫히고 라벨 · 서버의 언어가 바뀐다 — 저장값은 API 이름(javascript)',
        pickedJs.ok && (await waitFor(`!document.querySelector('${LANG_MENU}') && document.querySelector('${PART(cb.code, 'code-language')}')?.textContent === 'JavaScript'`, 3000)),
        JSON.stringify(pickedJs.last?.properties ?? null))
      check('★ 검색칸의 키(글자 · Backspace · ↓ · Enter)가 코드로 새지 않는다 — 코드 글자 · 블록 수 그대로',
        (await codeText(cb.code)) === CODE_TEXT && (await blockCount()) === 38, JSON.stringify([await codeText(cb.code), await blockCount()]))
      check('★ 닫으면 편집기로 포커스가 돌아오고 캐럿은 친 자리 그대로다(블록 끝으로 옮기지 않는다)',
        (await waitFor(FOCUS_IN_EDITOR, 2000)) && (await caretOffset(cb.code)) === 6, String(await caretOffset(cb.code)))

      // ③ 한글 조합 — 조합 중의 Enter 는 조합의 것이다(isComposing · 229)
      await clickChrome(cb.code, 'code-language')
      await waitFor(`document.activeElement === document.querySelector('${LANG_SEARCH}')`, 3000)
      await composing('ty')
      check('★ 조합 중의 Enter(229)는 고르지 않는다 — 목록이 열린 채', await evaluate(`!!document.querySelector('${LANG_MENU}')`))
      await send('Input.insertText', { text: 'ty' })
      await key('Enter')
      const pickedTs = await settledBlock(cb.code, (b) => b.properties?.language === 'typescript')
      check('★ 조합을 끝낸 뒤의 Enter 는 고른다 — ty → TypeScript', pickedTs.ok, JSON.stringify(pickedTs.last?.properties ?? null))

      // ④ Esc — 목록만 닫고 편집기로 · 블록 선택이 되지 않는다
      await caretInCode(cb.code, 6)
      await clickChrome(cb.code, 'code-language')
      await waitFor(`!!document.querySelector('${LANG_MENU}')`, 3000)
      await key('Escape')
      check('★ Esc 는 목록만 닫는다 — 편집기로 포커스 · 캐럿 그대로 · 블록 선택이 되지 않는다(편집기의 Esc 까지 가지 않는다)',
        (await waitFor(`!document.querySelector('${LANG_MENU}') && ${FOCUS_IN_EDITOR}`, 2000))
          && (await caretOffset(cb.code)) === 6 && (await selected()).length === 0,
        JSON.stringify({ caret: await caretOffset(cb.code), selected: await selected() }))

      // ④-2 목록 위에 포인터가 있어도 ↓ 가 되돌려지지 않는다 — 활성 항목을 보이려고 목록이 구르면 가만히 있는 포인터 밑으로 다른 항목이
      // 들어온다(경계 이벤트로 활성화하면 키보드의 자리를 되돌린다 · 8a-2 리뷰)
      const activeIndex = `[...document.querySelectorAll('${LANG_MENU} [role="option"]')].findIndex((o) => o.getAttribute('aria-selected') === 'true')`
      await clickChrome(cb.code, 'code-language')
      await waitFor(`!!document.querySelector('${LANG_MENU}')`, 3000)
      // 검색어를 치면 첫 후보로 돌아가 목록이 맨 위다 — 연 순간은 지금 언어(목록 아래쪽)가 보이게 굴러가 있다.
      await typeText('a')
      await waitFor(`${activeIndex} === 0`, 2000)
      const third = await evaluate(`(() => { const r = document.querySelectorAll('${LANG_MENU} [role="option"]')[2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      await move(third.x, third.y)
      await move(third.x + 1, third.y)
      await sleep(100)
      const startIndex = await evaluate(activeIndex)
      for (let i = 0; i < 10; i += 1) await key('ArrowDown')
      await sleep(150)
      const endIndex = await evaluate(activeIndex)
      check('★ 목록 위에 포인터가 있어도 ↓ 열 번은 열 칸이다(목록이 굴러도 포인터 밑 항목이 자리를 되돌리지 않는다)',
        startIndex === 2 && endIndex === 12, `${startIndex} → ${endIndex}`)
      // 빈 결과 줄 — 포커스를 받지 않는 자리를 눌러도 검색칸이 포커스를 지킨다(잃으면 키가 죽는다)
      await typeText('zzzz')
      await waitFor(`(document.querySelector('${LANG_MENU}')?.textContent ?? '').includes('맞는 언어가 없습니다')`, 2000)
      await clickSelector(`${LANG_MENU} ul li`)
      check('목록 안의 빈 결과 줄을 눌러도 검색칸이 포커스를 지킨다', await evaluate(`document.activeElement === document.querySelector('${LANG_SEARCH}')`),
        await evaluate(`document.activeElement?.tagName ?? ''`))
      // 트리거로 닫기 — 바깥 누르기가 먼저 닫고 click 이 다시 열면 트리거로는 닫을 수 없다
      await clickChrome(cb.code, 'code-language')
      await sleep(300)
      check('★ 열린 언어 목록은 그 언어 버튼을 다시 누르면 닫힌다(다시 열리지 않는다)',
        (await evaluate(`!document.querySelector('${LANG_MENU}')`)) && (await waitFor(FOCUS_IN_EDITOR, 2000)))

      // ④-3 편집 모드의 Tab — 들여쓸 수 없는 자리(첫 블록)의 Tab 이 포커스를 코드 블록의 복사 버튼으로 옮기지 않는다(복사 버튼은 읽기
      // 전용에서만 탭 순서에 선다 · 8a-2 리뷰)
      await clickSelector(`[data-block-id="${cb.top}"] p`)
      await waitFor(FOCUS_IN_EDITOR, 2000)
      await key('Tab')
      await sleep(150)
      check('★ 편집 모드 첫 블록의 Tab 은 포커스를 코드 블록의 복사 버튼으로 옮기지 않는다',
        await evaluate(`document.activeElement?.getAttribute('data-testid') !== 'code-copy'`),
        await evaluate(`document.activeElement?.outerHTML?.slice(0, 100) ?? ''`))
      await caretInCode(cb.code, 6)

      // ⑤ 키보드 경로 — Mod+/ → 코드 ▸ 언어 바꾸기… → Esc. 블록 메뉴가 고른 블록 선택은 그대로다
      await key('/', MOD)
      await waitFor(`!!document.querySelector('[role="menu"][aria-label="블록 메뉴"]')`, 3000)
      // 코드 블록은 색을 받지 않아 '색'이 꺼져 있다 — ↓ 는 꺼진 항목을 건너뛴다. '코드'에 설 때까지 누른다.
      let codeItem = ''
      for (let i = 0; i < 6 && !codeItem.startsWith('코드'); i += 1) {
        await key('ArrowDown')
        codeItem = await evaluate(`document.activeElement?.textContent ?? ''`)
      }
      await key('ArrowRight')
      await sleep(60)
      const firstChild = await evaluate(`document.activeElement?.textContent ?? ''`)
      const firstRole = await evaluate(`document.activeElement?.getAttribute('role') ?? ''`)
      check('블록 메뉴의 "코드" · 하위 메뉴의 첫 항목은 "언어 바꾸기…" — 고르는 항목(라디오)이 아니라 동작 항목(menuitem)이다',
        codeItem.startsWith('코드') && firstChild.startsWith('언어 바꾸기') && firstRole === 'menuitem', `${codeItem} · ${firstChild} · ${firstRole}`)
      await key('Enter')
      check('★ 블록 메뉴에서 언어 목록이 열린다 — 검색칸이 포커스를 갖는다',
        await waitFor(`!!document.querySelector('${LANG_MENU}') && document.activeElement === document.querySelector('${LANG_SEARCH}')`, 3000))
      await key('Escape')
      check('★ 닫으면 블록 선택이 그대로다 — 이어서 블록을 옮길 수 있다(블록 메뉴의 약속)',
        (await waitFor(`!document.querySelector('${LANG_MENU}')`, 2000)) && same(await selected(), [cb.code]), JSON.stringify(await selected()))
      await key('Escape')

      // ⑥ 줄바꿈 — 캐럿을 화면 밖(맨 위 문단)에 두고 코드 블록이 보이게 내려와 누른다. 화면이 옛 캐럿으로 튀지 않아야 한다
      // ProseMirror 가 그 자리를 자기 선택으로 받았는지는 글자를 쳐 보면 안다(친 뒤 지운다). 클릭만 하면 선택을 받기 전에 다음 단계로
      // 가는 때가 있어, 옛 선택(화면에 보이는 코드 블록) 쪽 "스크롤"은 화면을 움직이지 않아 반사실이 헛통과했다.
      await caretAtEnd(cb.top)
      await typeText('·')
      check('전제 — 캐럿이 맨 위 문단에 섰다(친 글자가 그 문단에 들어갔다)',
        await waitFor(`document.querySelector('[data-block-id="${cb.top}"] p')?.textContent === '맨 위 문단·'`, 2000),
        await evaluate(`document.querySelector('[data-block-id="${cb.top}"] p')?.textContent ?? ''`))
      await key('Backspace')
      const SCROLL = `(() => {
        let e = document.querySelector('.blk-editor')
        while (e && e !== document.body) {
          const s = getComputedStyle(e)
          if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return e.scrollTop
          e = e.parentElement
        }
        return document.scrollingElement.scrollTop
      })()`
      await codePoint(cb.code)
      await sleep(200)
      const topOnScreen = await evaluate(`(() => { const r = document.querySelector('[data-block-id="${cb.top}"]').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight })()`)
      check('전제 — 캐럿이 있는 맨 위 문단은 화면 밖이다', topOnScreen === false)
      const scrollBefore = await evaluate(SCROLL)
      const wrapClicked = await clickChrome(cb.code, 'code-wrap-toggle', { scroll: false })
      // 클릭이 처리된 뒤에 잰다 — 부하 아래에서는 클릭 처리가 늦어 재는 것이 먼저 오면 헛통과한다(반사실에서 한 번 겪었다).
      await waitFor(`document.querySelector('${PART(cb.code, 'code-wrap-toggle')}')?.getAttribute('aria-pressed') === 'true'`, 3000)
      const scrollAfter = await evaluate(SCROLL)
      const wrapped = await settledBlock(cb.code, (b) => b.format?.code_wrap === true)
      check('★ 줄바꿈을 켜면 코드가 접히고(white-space: pre-wrap) 서버에 code_wrap: true',
        wrapClicked && wrapped.ok && (await evaluate(`getComputedStyle(document.querySelector('${CB(cb.code)} pre.blk-code')).whiteSpace === 'pre-wrap'
          && document.querySelector('${PART(cb.code, 'code-wrap-toggle')}').getAttribute('aria-pressed') === 'true'`)),
        JSON.stringify(wrapped.last?.format ?? null))
      check('★ 크롬 버튼은 화면을 옛 캐럿(맨 위 문단)으로 튀게 하지 않는다', Math.abs(scrollAfter - scrollBefore) <= 1, `${scrollBefore} → ${scrollAfter}`)
      await clickChrome(cb.code, 'code-wrap-toggle', { scroll: false })
      const unwrapped = await settledBlock(cb.code, (b) => b.format?.code_wrap === undefined)
      check('다시 누르면 끈다 — 끈 상태는 키가 없다',
        unwrapped.ok && (await evaluate(`getComputedStyle(document.querySelector('${CB(cb.code)} pre.blk-code')).whiteSpace !== 'pre-wrap'`)),
        JSON.stringify(unwrapped.last?.format ?? null))

      // ⑥-2 버튼 줄의 틈 — 버튼 사이를 눌러도 편집기가 포커스를 받지 않는다(받으면 PM 이 들고 있던 옛 캐럿이 되살아나 이어 친 글자가
      // 화면 밖으로 간다 · 8a-2 리뷰)
      await evaluate(`document.querySelector('input[aria-label="페이지 제목"]').focus()`)
      const gapAt = await codePoint(cb.code)
      await move(gapAt.x, gapAt.y)
      await sleep(250)
      const gap = await evaluate(`(() => {
        const w = document.querySelector('${PART(cb.code, 'code-wrap-toggle')}').getBoundingClientRect()
        const c = document.querySelector('${PART(cb.code, 'code-copy')}').getBoundingClientRect()
        const x = (w.right + c.left) / 2, y = w.y + w.height / 2
        const top = document.elementFromPoint(x, y)
        return { x, y, onBar: !!top?.classList.contains('blk-code-bar') }
      })()`)
      await click(gap.x, gap.y)
      await sleep(150)
      check('★ 버튼 줄의 틈을 눌러도 편집기가 포커스를 가져가지 않는다(제목칸이 그대로)',
        gap.onBar && (await evaluate(`document.activeElement === document.querySelector('input[aria-label="페이지 제목"]')`)),
        JSON.stringify({ gap, active: await evaluate(`document.activeElement?.tagName ?? ''`) }))

      // ⑦ 복사 — 크롬의 글자가 바뀌어도(복사됨 → 복사) 노드 뷰를 다시 만들지 않는다(ignoreMutation)
      await evaluate(STUB_CLIPBOARD)
      await evaluate(`document.querySelector('${CB(cb.code)} pre.blk-code').__e2e = 1`)
      await clickChrome(cb.code, 'code-copy')
      check('★ 복사 — 문서의 코드 글자가 클립보드로 · 버튼이 "복사됨"을 보이고 읽어 준다',
        await waitFor(`window.__copied === ${JSON.stringify(CODE_TEXT)}
          && document.querySelector('${PART(cb.code, 'code-copy')}')?.textContent === '복사됨'
          && (document.querySelector('${CB(cb.code)} [role="status"]')?.textContent ?? '') === '코드를 복사했습니다.'`, 3000),
        JSON.stringify(await evaluate(`[window.__copied, document.querySelector('${PART(cb.code, 'code-copy')}')?.textContent]`)))
      check('★ "복사됨"이 "복사"로 돌아와도 노드 뷰가 다시 만들어지지 않는다(크롬의 변화는 문서가 아니다)',
        await waitFor(`document.querySelector('${PART(cb.code, 'code-copy')}')?.textContent === '복사' && document.querySelector('${CB(cb.code)} pre.blk-code')?.__e2e === 1`, 4000),
        JSON.stringify(await evaluate(`[document.querySelector('${PART(cb.code, 'code-copy')}')?.textContent, document.querySelector('${CB(cb.code)} pre.blk-code')?.__e2e]`)))

      // ⑧ 포커스된 크롬 버튼의 키는 편집기의 것이 아니다(stopEvent) — 캐럿을 코드에 두고 복사 버튼에 포커스한 뒤 Enter
      await caretInCode(cb.code, 3)
      await evaluate(`document.querySelector('${PART(cb.code, 'code-copy')}').focus()`)
      check('전제 — 복사 버튼이 포커스를 가졌다', await evaluate(`document.activeElement === document.querySelector('${PART(cb.code, 'code-copy')}')`))
      await key('Enter')
      await sleep(300)
      check('★ 포커스된 복사 버튼의 Enter 는 코드에 줄을 넣지 않는다(stopEvent)',
        (await codeText(cb.code)) === CODE_TEXT && (await blockCount()) === 38, JSON.stringify([await codeText(cb.code), await blockCount()]))

      // ⑨ 캡션 — 더하기 · 한글 조합 · Shift+Enter · 저장
      check('★ 캡션 버튼을 누르면 캡션 자리에 입력칸이 열리고 포커스를 갖는다',
        (await clickChrome(cb.code, 'code-caption-add'))
          && (await waitFor(`document.activeElement === document.querySelector('${CAPTION_INPUT}')`, 3000)))
      await composing('설명')
      check('★ 조합 중의 Enter(229)는 저장하지 않는다 — 입력칸이 열린 채', await evaluate(`!!document.querySelector('${CAPTION_INPUT}')`))
      await send('Input.insertText', { text: '설명' })
      await typeText(' 캡션')
      await key('Enter', SHIFT)
      await sleep(150)
      check('Shift+Enter 는 저장하지 않는다 — 줄바꿈 자리다', await evaluate(`!!document.querySelector('${CAPTION_INPUT}')`))
      await typeText('\n둘째 줄')
      await key('Enter')
      const captionText = '설명 캡션\n둘째 줄'
      const captioned = await settledBlock(cb.code, (b) => captionOf(b) === captionText)
      check('★ Enter 로 저장한다 — 여러 줄 캡션이 서버와 노드 뷰에 · 캡션 버튼은 숨는다',
        captioned.ok && (await waitFor(`document.querySelector('${PART(cb.code, 'code-caption')}')?.textContent === ${JSON.stringify(captionText)}
          && document.querySelector('${PART(cb.code, 'code-caption-add')}')?.hidden === true`, 3000)),
        JSON.stringify(captioned.last?.properties?.caption ?? null))

      // ⑩ 고친 것만 쓴다 — 받은 캡션(기울임 · 줄바꿈)을 열고 닫기만 · 고치다가 Esc
      const multiBefore = await serverCaption(cb.multi)
      await clickSelector(PART(cb.multi, 'code-caption'))
      check('받은 여러 줄 캡션을 열면 줄바꿈까지 그대로 입력칸에 선다',
        await waitFor(`document.querySelector('${CAPTION_INPUT}')?.value === ${JSON.stringify(MULTI_CAPTION)}`, 3000),
        JSON.stringify(await evaluate(`document.querySelector('${CAPTION_INPUT}')?.value ?? null`)))
      await clickSelector(`[data-block-id="${cb.bottom}"] p`)
      check('바깥(편집기)을 누르면 닫히고 편집기가 포커스를 갖는다',
        await waitFor(`!document.querySelector('${CAPTION_INPUT}') && ${FOCUS_IN_EDITOR}`, 2000))
      await clickSelector(PART(cb.multi, 'code-caption'))
      await waitFor(`document.activeElement === document.querySelector('${CAPTION_INPUT}')`, 3000)
      await typeText('바뀜')
      await key('Escape')
      check('Esc 는 저장하지 않고 닫는다 — 편집기로 포커스', await waitFor(`!document.querySelector('${CAPTION_INPUT}') && ${FOCUS_IN_EDITOR}`, 2000))
      // 크롬 버튼으로 닫아도 편집기가 포커스를 되찾는다 — 그 버튼은 mousedown 을 막아 포커스를 가져가지 않으므로, 입력칸이 사라지면
      // 포커스가 body 에 떨어져 친 글자가 갈 곳이 없다(8a-2 설계 비평)
      await clickSelector(PART(cb.multi, 'code-caption'))
      await waitFor(`document.activeElement === document.querySelector('${CAPTION_INPUT}')`, 3000)
      await clickChrome(cb.code, 'code-copy')
      check('★ 캡션 입력을 열어 둔 채 다른 블록의 크롬 버튼(복사)을 누르면 입력칸이 닫히고 편집기가 포커스를 되찾는다',
        await waitFor(`!document.querySelector('${CAPTION_INPUT}') && ${FOCUS_IN_EDITOR}`, 2000),
        await evaluate(`document.activeElement?.tagName ?? ''`))
      check('전제 — 순서 표지가 서버에 닿았다', await barrier())
      check('★ 열고 닫기만 · 고치다가 Esc — 받은 캡션(기울임 · 줄바꿈)이 서버에 그대로',
        (await serverCaption(cb.multi)) === multiBefore, `${multiBefore} → ${await serverCaption(cb.multi)}`)

      // 연 뒤에 다른 참여자가 캡션을 바꿨다 — 열고 닫기만 한 사람이 그것을 되돌리지 않는다(연 순간의 글자와 비교 · 정본 ⑤)
      await clickSelector(PART(cb.multi, 'code-caption'))
      await waitFor(`document.activeElement === document.querySelector('${CAPTION_INPUT}')`, 3000)
      await remoteEdit((client) => contentElementOf(client, cb.multi).setAttribute('props', { caption: [textRun('원격 캡션')] }))
      check('전제 — 다른 참여자가 바꾼 캡션이 열린 편집기에 닿았다',
        await waitFor(`document.querySelector('${PART(cb.multi, 'code-caption')}')?.textContent === '원격 캡션'`, 8000))
      await clickSelector(`[data-block-id="${cb.bottom}"] p`)
      await waitFor(`!document.querySelector('${CAPTION_INPUT}')`, 2000)
      check('전제 — 순서 표지가 서버에 닿았다(둘째)', await barrier())
      check('★ 연 뒤에 다른 참여자가 바꾼 캡션을 열고 닫기만 해서 되돌리지 않는다',
        captionOf(await serverBlock(cb.multi)) === '원격 캡션', captionOf(await serverBlock(cb.multi)))

      // ⑪ 서식이 있는 받은 캡션 — 고치면 평문이 된다고 먼저 말한다
      await clickSelector(PART(cb.fmt, 'code-caption'))
      check('★ 서식이 있는 받은 캡션을 열면 "평문이 된다"고 먼저 말한다 — 입력칸의 설명으로 이어진다',
        await waitFor(`(() => {
          const input = document.querySelector('${CAPTION_INPUT}')
          const note = document.querySelector('[data-testid="code-caption-formatted"]')
          return !!input && !!note && note.textContent.includes('평문이 됩니다') && input.getAttribute('aria-describedby') === note.id
        })()`, 3000))
      // 안의 포커스를 받지 않는 자리(안내문)를 눌러도 입력칸이 포커스를 지킨다 — 잃으면 blur 가 저장하고 닫았다
      await clickSelector('[data-testid="code-caption-formatted"]')
      check('캡션 입력 안의 안내문을 눌러도 닫히지 않고 입력칸이 포커스를 지킨다',
        await evaluate(`document.activeElement === document.querySelector('${CAPTION_INPUT}')`),
        await evaluate(`document.activeElement?.tagName ?? ''`))
      await key('Escape')

      // ⑫ 비우기
      await clickSelector(PART(cb.code, 'code-caption'))
      await waitFor(`document.activeElement === document.querySelector('${CAPTION_INPUT}')`, 3000)
      await evaluate(`document.querySelector('${CAPTION_INPUT}').select()`)
      await key('Backspace')
      await key('Enter')
      const cleared = await settledBlock(cb.code, (b) => !('caption' in (b.properties ?? {})))
      check('★ 비우고 저장하면 캡션 키가 지워지고 캡션 버튼이 돌아온다',
        cleared.ok && (await waitFor(`document.querySelector('${PART(cb.code, 'code-caption-add')}')?.hidden === false`, 3000)),
        JSON.stringify(cleared.last?.properties ?? null))

      // ⑬ 빈 코드 블록의 자리 표시 — 글자가 아니다
      const placeholder = await evaluate(`getComputedStyle(document.querySelector('${CB(cb.empty)} pre.blk-code'), '::before').content`)
      check('★ 빈 코드 블록에는 자리 표시 "코드"가 보인다 — pre 의 글자는 비었다',
        placeholder.includes('코드') && (await codeText(cb.empty)) === '', `${placeholder} · ${JSON.stringify(await codeText(cb.empty))}`)
      check('자리 표시는 화면 읽기 프로그램에 빈 대체 글자를 준다(`/ ""`) — 블록의 글자처럼 읽히지 않게', placeholder.includes('/'), placeholder)
      await caretInCode(cb.empty, 0)
      await typeText('z')
      check('치면 자리 표시가 사라지고 복사가 켜진다',
        await waitFor(`getComputedStyle(document.querySelector('${CB(cb.empty)} pre.blk-code'), '::before').content === 'none'
          && document.querySelector('${PART(cb.empty, 'code-copy')}').disabled === false`, 2000))

      // ⑭ 리스너 가드 — 슬래시 메뉴가 열린 채 편집기 밖 입력칸(검색)으로 간 키는 슬래시 메뉴의 것이 아니다. 코드 오버레이를 거치지
      // 않는 장면이라 "열 때 슬래시 메뉴를 닫는" 방어가 가리지 않는다
      check('전제 — 끝 문단 끝에 캐럿(슬래시)', await caretAtEnd(cb.bottom))
      await typeText(' /')
      check('전제 — 슬래시 메뉴가 열렸다', await waitFor(`!!document.querySelector('${SLASH}')`, 3000))
      const slashActive = `document.querySelector('${SLASH} [aria-selected="true"]')?.textContent ?? null`
      const slashBefore = await evaluate(slashActive)
      await key('k', MOD)
      check('전제 — 검색 입력칸이 포커스를 가졌다', await waitFor(`document.activeElement === document.querySelector('[data-testid="search-input"]')`, 3000))
      await key('ArrowDown')
      await sleep(150)
      const slashAfter = await evaluate(slashActive)
      // 고른 항목이 있어야 한다 — 메뉴가 닫혀 둘 다 null 이면 헛통과한다(가드가 없으면 검색을 닫는 Esc 도 슬래시 메뉴를 닫는다).
      check('★ 편집기 밖 입력칸의 ↓ 는 슬래시 메뉴를 움직이지 않는다(리스너 가드)',
        slashBefore !== null && slashAfter === slashBefore, `${slashBefore} → ${slashAfter}`)
      await key('Escape')
      await waitFor(`!document.querySelector('[data-testid="search-overlay"]')`, 3000)
      // 편집기 **안**의 입력칸(빈 이미지의 주소칸)도 다른 입력칸이다 — 키의 대상이 편집 호스트(view.dom) 자신일 때만 슬래시 메뉴의
      // 것이다. `view.dom.contains` 로 거르면 이 칸의 ↓ · Enter 를 가로채 다른 블록에 슬래시 명령을 실행한다(8a-2 설계 비평).
      check('전제 — 슬래시 메뉴가 열린 채 이미지 주소칸이 포커스를 가졌다',
        (await clickSelector(`[data-block-id="${cb.img}"] input.blk-image-url-input`))
          && (await waitFor(`!!document.querySelector('${SLASH}') && document.activeElement === document.querySelector('[data-block-id="${cb.img}"] input.blk-image-url-input')`, 2000)))
      const slashBeforeInner = await evaluate(slashActive)
      await key('ArrowDown')
      await sleep(150)
      const slashAfterInner = await evaluate(slashActive)
      check('★ 편집기 안 입력칸(이미지 주소)의 ↓ 도 슬래시 메뉴를 움직이지 않는다 — 대상이 편집 호스트일 때만',
        slashBeforeInner !== null && slashAfterInner === slashBeforeInner, `${slashBeforeInner} → ${slashAfterInner}`)
      // 메뉴 닫기 — 따로 본다: 슬래시 메뉴가 열린 채 언어 목록을 열면 슬래시 메뉴가 닫힌다(오버레이의 키를 가로채지 않게)
      check('전제 — 슬래시 메뉴가 아직 열려 있다', await waitFor(`!!document.querySelector('${SLASH}')`, 2000))
      await clickChrome(cb.code, 'code-language')
      check('★ 언어 목록을 열면 슬래시 메뉴가 닫힌다',
        await waitFor(`!!document.querySelector('${LANG_MENU}') && !document.querySelector('${SLASH}')`, 3000))

      // ⑮ 자리 — 창 폭이 바뀌면 오버레이가 블록을 따라간다
      const edges = `(() => {
        const m = document.querySelector('${LANG_MENU}')?.getBoundingClientRect()
        const b = document.querySelector('${CB(cb.code)}').getBoundingClientRect()
        return m ? { gap: Math.round(b.right - m.right), right: Math.round(b.right) } : null
      })()`
      const edgeBefore = await evaluate(edges)
      await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 900, deviceScaleFactor: 1, mobile: false })
      await waitFor(`(() => { const e = ${edges}; return e !== null && Math.abs(e.gap) <= 1 && e.right !== ${edgeBefore?.right ?? -1} })()`, 3000)
      const edgeAfter = await evaluate(edges)
      await send('Emulation.clearDeviceMetricsOverride')
      await sleep(400)
      check('★ 창 폭이 바뀌어 블록이 움직여도 언어 목록이 그 오른쪽 끝을 따라간다(자리를 다시 잰다)',
        edgeBefore !== null && edgeAfter !== null && Math.abs(edgeBefore.gap) <= 1 && Math.abs(edgeAfter.gap) <= 1 && edgeBefore.right !== edgeAfter.right,
        JSON.stringify([edgeBefore, edgeAfter]))
      await key('Escape')
      await waitFor(`!document.querySelector('${LANG_MENU}')`, 2000)

      // ⑮-2 멘션 메뉴도 같은 두 겹이다 — 리스너 가드(편집기 밖 입력칸의 ↓) · 오버레이를 열면 닫힌다
      const MENTION = '[role="listbox"][aria-label="멘션"]'
      const mentionActive = `[...document.querySelectorAll('${MENTION} [role="option"]')].findIndex((o) => o.getAttribute('aria-selected') === 'true')`
      check('전제 — 끝 문단 끝에 캐럿', await caretAtEnd(cb.bottom))
      for (const ch of ' @코드') await typeText(ch)
      check('전제 — 멘션 후보가 둘 이상 떴다', await waitFor(`document.querySelectorAll('${MENTION} [role="option"]').length >= 2`, 8000),
        await evaluate(`document.querySelector('${MENTION}')?.textContent ?? '(없음)'`))
      const mentionBefore = await evaluate(mentionActive)
      await key('k', MOD)
      await waitFor(`document.activeElement === document.querySelector('[data-testid="search-input"]')`, 3000)
      await key('ArrowDown')
      await sleep(150)
      const mentionAfter = await evaluate(mentionActive)
      check('★ 편집기 밖 입력칸의 ↓ 는 멘션 메뉴를 움직이지 않는다(리스너 가드)', mentionBefore >= 0 && mentionAfter === mentionBefore,
        `${mentionBefore} → ${mentionAfter}`)
      await key('Escape')
      await waitFor(`!document.querySelector('[data-testid="search-overlay"]')`, 3000)
      check('전제 — 멘션 메뉴가 아직 열려 있다', await waitFor(`!!document.querySelector('${MENTION}')`, 2000))
      await clickChrome(cb.code, 'code-language')
      check('★ 언어 목록을 열면 멘션 메뉴가 닫힌다', await waitFor(`!!document.querySelector('${LANG_MENU}') && !document.querySelector('${MENTION}')`, 3000))
      await key('Escape')
      await waitFor(`!document.querySelector('${LANG_MENU}')`, 2000)
      await sleep(1500)

      // ⑯ 읽기 전용 — 열어 둔 채로 잠근다. 모양은 루트 속성으로 CSS 가 가르고, 쓰는 버튼은 누르는 순간 묻는다
      const locked = await fetch(`${pagesUrl}/${chromePage}/lock`, { method: 'PUT', headers: authed })
      check('전제 — 잠갔고 열어 둔 편집기가 읽기 전용이 됐다', locked.ok && (await waitFor(`!(${EDITABLE})`, 15000)), String(locked.status))
      await evaluate(STUB_CLIPBOARD)
      // 마우스를 올려 둔 채로 본다 — 올리지 않으면 버튼 줄이 숨어 "없다"가 헛통과한다. 먼저 보여야 할 것이 보이는지(양성 대조).
      const roAt = await codePoint(cb.code)
      await move(roAt.x, roAt.y)
      await sleep(300)
      const ro = await evaluate(`(() => {
        const q = (t) => document.querySelector('${CB(cb.code)} [data-testid="' + t + '"]')
        const hit = (el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0) return false
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return top === el || el.contains(top)
        }
        return {
          label: q('code-language-label').textContent,
          labelHit: hit(q('code-language-label')),
          copyHit: hit(q('code-copy')),
          hidden: ['code-language', 'code-wrap-toggle', 'code-caption-add'].map((t) => getComputedStyle(q(t)).display),
        }
      })()`)
      check('★ 읽기 전용 — 언어는 글자(TypeScript)로 보이고 복사는 누를 수 있다', ro.label === 'TypeScript' && ro.labelHit && ro.copyHit, JSON.stringify(ro))
      check('★ 읽기 전용 — 언어 바꾸기 · 줄바꿈 · 캡션 버튼이 없다(display: none)', ro.hidden.every((d) => d === 'none'), JSON.stringify(ro.hidden))
      await clickChrome(cb.code, 'code-copy')
      check('★ 읽기 전용에서도 복사한다', await waitFor(`window.__copied === ${JSON.stringify(CODE_TEXT)}`, 3000), JSON.stringify(await evaluate('window.__copied')))

      // 키보드 — 제목에서 Tab 으로 복사 버튼에 닿는다(블록 메뉴가 열리지 않는 읽기 전용의 유일한 길)
      await move(2, 2)
      await evaluate(`document.querySelector('input[aria-label="페이지 제목"]').focus()`)
      let tabbed = false
      for (let i = 0; i < 20 && !tabbed; i += 1) {
        await key('Tab')
        tabbed = await evaluate(`document.activeElement === document.querySelector('${PART(cb.code, 'code-copy')}')`)
      }
      check('★ 읽기 전용 — Tab 으로 복사 버튼에 닿고, 포커스가 서면 버튼 줄이 보인다',
        tabbed && (await waitFor(`getComputedStyle(document.querySelector('${CB(cb.code)} .blk-code-bar')).opacity === '1'`, 2000)),
        await evaluate(`document.activeElement?.outerHTML?.slice(0, 120) ?? ''`))

      // 억지로 누르기 — 숨은 버튼 · 캡션 · 할 일 체크박스. 쓰면 서버가 거부하고 편집기가 본문을 버린다(배너) — 배너가 없어야 한다
      const formatBefore = JSON.stringify((await serverBlock(cb.code))?.format ?? {})
      await evaluate(`(() => {
        for (const t of ['code-wrap-toggle', 'code-caption-add', 'code-language']) document.querySelector('${CB(cb.code)} [data-testid="' + t + '"]').click()
        document.querySelector('${PART(cb.fmt, 'code-caption')}').click()
        document.querySelector('[data-block-id="${cb.todo}"] input.blk-checkbox').click()
        const url = document.querySelector('[data-block-id="${cb.img}"] input.blk-image-url-input')
        url.value = 'https://example.com/forced.png'
        url.form.requestSubmit()
      })()`)
      await sleep(3000)
      const forced = await evaluate(`({
        discarded: (document.body?.textContent ?? '').includes('서버가 받지 못한 편집'),
        overlay: !!document.querySelector('${LANG_MENU}') || !!document.querySelector('${CAPTION_INPUT}'),
        checked: document.querySelector('[data-block-id="${cb.todo}"] input.blk-checkbox').checked,
        wrap: document.querySelector('${CB(cb.code)}').dataset.wrap,
        image: !!document.querySelector('[data-block-id="${cb.img}"] img'),
        imageNotice: document.querySelector('[data-block-id="${cb.img}"] .blk-image-failure')?.textContent ?? '',
      })`)
      check('★ 읽기 전용 — 숨은 버튼 · 캡션 · 체크박스 · 이미지 주소를 억지로 눌러도 편집이 생기지 않는다(버려진 편집이 없다 · 체크 그대로)',
        !forced.discarded && !forced.overlay && forced.checked === false && forced.wrap === 'false' && !forced.image, JSON.stringify(forced))
      check('읽기 전용이라 넣지 못한 이미지는 그렇다고 말한다 — 조용히 멈춘 채 남지 않는다', forced.imageNotice.includes('읽기 전용이라'), forced.imageNotice)
      check('서버의 format 도 그대로', JSON.stringify((await serverBlock(cb.code))?.format ?? {}) === formatBefore)

      // 선택 — 코드와 캡션에 걸친 선택을 PM 이 놓치면 복사(읽기 전용에서도 PM 이 받는다)가 낡은 선택(맨 위 문단)을 싣는다
      await evaluate(`(() => {
        const r = document.createRange()
        r.selectNodeContents(document.querySelector('[data-block-id="${cb.top}"] p'))
        const s = window.getSelection()
        s.removeAllRanges()
        s.addRange(r)
      })()`)
      await sleep(300)
      await evaluate(`(() => {
        const caption = document.querySelector('${PART(cb.multi, 'code-caption')}').firstChild
        const code = document.querySelector('${CB(cb.multi)} pre.blk-code').firstChild
        window.getSelection().setBaseAndExtent(caption, 2, code, 4)
      })()`)
      await sleep(300)
      const copiedSel = await evaluate(`(() => {
        const dt = new DataTransfer()
        document.querySelector('.blk-editor').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
        return dt.getData('text/plain')
      })()`)
      check('★ 읽기 전용 — 캡션에서 코드로 걸친 선택을 복사하면 코드 조각이 나온다(선택 기록을 무시하지 않는다)',
        copiedSel !== '' && MULTI_TEXT.includes(copiedSel) && copiedSel !== '맨 위 문단', JSON.stringify(copiedSel))

      // 잠긴 채로 다시 연다 — 처음부터 읽기 전용인 노드 뷰도 같은 모양이다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${chromePage}` })
      await waitFor(`!!document.querySelector('${PART(cb.code, 'code-language-label')}') && !(${EDITABLE})`, 15000)
      const reAt = await codePoint(cb.code)
      await move(reAt.x, reAt.y)
      await sleep(300)
      check('잠긴 페이지를 다시 열어도 — 언어는 글자 · 줄바꿈 버튼은 없다',
        await evaluate(`document.querySelector('${PART(cb.code, 'code-language-label')}').textContent === 'TypeScript'
          && getComputedStyle(document.querySelector('${PART(cb.code, 'code-wrap-toggle')}')).display === 'none'`))

      // ⑰ 풀고 다시 연다 — 저장된 것이 그대로 그려진다
      await fetch(`${pagesUrl}/${chromePage}/lock`, { method: 'DELETE', headers: authed })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${chromePage}` })
      check('★ 다시 열면 저장된 언어(TypeScript) · 비운 캡션 · 받은 캡션 · 쳐 넣은 코드가 그대로 · 다시 고칠 수 있다',
        await waitFor(`${EDITABLE}
          && document.querySelector('${PART(cb.code, 'code-language')}')?.textContent === 'TypeScript'
          && document.querySelector('${PART(cb.code, 'code-caption')}')?.hidden === true
          && document.querySelector('${PART(cb.multi, 'code-caption')}')?.textContent === '원격 캡션'
          && document.querySelector('${CB(cb.empty)} pre.blk-code')?.textContent === 'z'`, 15000))

      // ⑱ 다른 참여자의 편집 — 위에 블록이 들어오면 언어 목록이 블록을 따라 내려가고, 그 블록이 사라지면 닫힌다(트랜잭션마다 다시 잰다)
      await clickChrome(cb.fmt, 'code-language')
      await waitFor(`!!document.querySelector('${LANG_MENU}')`, 3000)
      const menuToBlock = `(() => {
        const m = document.querySelector('${LANG_MENU}')?.getBoundingClientRect()
        const b = document.querySelector('${CB(cb.fmt)}')?.getBoundingClientRect()
        return m && b ? { gap: Math.round(m.top - b.top), top: Math.round(b.top) } : null
      })()`
      const before = await evaluate(menuToBlock)
      const insertedId = randomUUID()
      await remoteEdit((client) => edit(client, (tr, doc) => {
        const { pos } = findBlock(doc, cb.fmt)
        const schema = doc.type.schema
        tr.insert(pos, schema.nodes.blockContainer.create({ blockId: insertedId }, [
          schema.nodes.paragraph.create({ props: {}, format: {} }, schema.text('원격으로 들어온 문단')),
        ]))
      }))
      check('★ 다른 참여자가 위에 블록을 넣으면 열린 언어 목록이 블록을 따라 내려간다',
        before !== null && (await waitFor(`(() => { const now = ${menuToBlock}; return now !== null && now.top > ${before?.top ?? 0} && Math.abs(now.gap - ${before?.gap ?? 0}) <= 1 })()`, 8000)),
        JSON.stringify([before, await evaluate(menuToBlock)]))
      // 그 문단을 블록 아래로 옮긴다 — 편집기의 높이는 그대로라 크기 변화(ResizeObserver)가 아니라 트랜잭션이 다시 재야 따라간다.
      const moved = await evaluate(menuToBlock)
      await remoteEdit((client) => edit(client, (tr, doc) => {
        const { pos, node } = findBlock(doc, insertedId)
        tr.delete(pos, pos + node.nodeSize)
        const target = findBlock(tr.doc, cb.fmt)
        tr.insert(target.pos + target.node.nodeSize, node)
      }))
      check('★ 위의 블록이 아래로 옮겨 가면(편집기 높이는 그대로) 열린 언어 목록이 블록을 따라 올라간다 — 트랜잭션마다 다시 잰다',
        moved !== null && (await waitFor(`(() => { const now = ${menuToBlock}; return now !== null && now.top < ${moved?.top ?? 0} && Math.abs(now.gap - ${moved?.gap ?? 0}) <= 1 })()`, 8000)),
        JSON.stringify([moved, await evaluate(menuToBlock)]))
      await remoteEdit((client) => edit(client, (tr, doc) => {
        const { pos, node } = findBlock(doc, cb.fmt)
        tr.delete(pos, pos + node.nodeSize)
      }))
      check('★ 그 블록이 사라지면 열린 언어 목록이 닫힌다', await waitFor(`!document.querySelector('${LANG_MENU}')`, 8000))
      await sleep(1500)
    }

    if (sectionIf('코드 블록 강조 (8a-3 · F-01-14)')) {
      // 문법 강조는 데코레이션이다 — 화면의 span 을 보고, 글자 · 클립보드에는 섞이지 않는지 본다. 문법은 지연 로드라 처음 보는 언어를
      // 고르면 글자를 더 치지 않아도 들어온 뒤에 칠해야 한다. 1만 줄 붙여넣기는 보이는 줄만 칠한다(가상화). 자기 데이터를 스스로
      // 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const hlPage = (await (await fetch(pagesUrl, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `코드 강조 ${stamp}` }),
      })).json()).page.id
      const hb = { top: randomUUID(), py: randomUUID(), plain: randomUUID(), js: randomUUID(), big: randomUUID(), bottom: randomUUID() }
      const PY_TEXT = 'def f(x):\n    return "hi"  # c'
      const RUST_TEXT = 'fn main() { let x = 1; }'
      // 템플릿 문자열 안의 식 — 칠하는 CSS 의 순서(감싸는 범위 → 글자 범위)를 색으로 본다.
      const JS_TEXT = 'const s = `a${b + 1}`'
      const codeBlock = (id, text, properties = {}) => ({ id, type: 'code', title: text === '' ? [] : [textRun(text)], properties, format: {}, children: [] })
      await saveBody(hlPage, {
        blocks: [
          block(hb.top, 'paragraph', '맨 위'),
          codeBlock(hb.py, PY_TEXT, { language: 'python' }),
          codeBlock(hb.plain, RUST_TEXT),
          codeBlock(hb.js, JS_TEXT, { language: 'javascript' }),
          codeBlock(hb.big, '', { language: 'javascript' }),
          block(hb.bottom, 'paragraph', '끝'),
        ],
      })

      const CB = (id) => `[data-block-id="${id}"] .blk-code-block`
      const PRE = (id) => `${CB(id)} pre.blk-code`
      const HL = '[class*="hljs-"]'
      const LANG_MENU = '[data-testid="code-language-menu"]'
      const LANG_SEARCH = '[data-testid="code-language-search"]'
      /** 그 블록에 칠한 (글자, 클래스). */
      const paintedIn = (id) => evaluate(`[...document.querySelectorAll('${PRE(id)} ${HL}')].map((s) => [s.textContent, s.className])`)
      /** 그 블록에 그 글자 · 그 클래스의 span 이 있는가 — 식(문자열)이다. */
      const hasPaint = (id, text, cls) =>
        `[...document.querySelectorAll('${PRE(id)} ${HL}')].some((s) => s.textContent === ${JSON.stringify(text)} && s.classList.contains(${JSON.stringify(cls)}))`
      const codeText = (id) => evaluate(`document.querySelector('${PRE(id)}')?.textContent ?? null`)
      /** 코드 블록 글자의 offset 자리에 캐럿을 둔다 — DOM 선택을 옮기면 편집기가 selectionchange 로 따라온다. */
      const caretInCode = async (id, offset) => {
        await evaluate(`(() => {
          document.querySelector('.blk-editor').focus()
          const pre = document.querySelector('${PRE(id)}')
          const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
          let left = ${offset}
          let node
          let lastNode = null
          while ((node = walker.nextNode())) {
            lastNode = node
            if (node.data.length >= left) { window.getSelection().collapse(node, left); return }
            left -= node.data.length
          }
          if (lastNode) window.getSelection().collapse(lastNode, lastNode.data.length)
          else window.getSelection().collapse(pre, 0)
        })()`)
        await sleep(150)
      }
      /** 캐럿이 그 코드 블록 글자의 몇째 자리인가 — 밖이면 -1. */
      const caretOffset = (id) => evaluate(`(() => {
        const pre = document.querySelector('${PRE(id)}')
        const sel = window.getSelection()
        if (!pre || !sel || sel.rangeCount === 0 || !pre.contains(sel.anchorNode)) return -1
        const range = document.createRange()
        range.setStart(pre, 0)
        range.setEnd(sel.anchorNode, sel.anchorOffset)
        return range.toString().length
      })()`)
      /** 코드 블록에 마우스를 올리고 그 크롬 버튼을 누른다 — 그 자리의 맨 위 요소가 그 버튼일 때만. */
      const clickChrome = async (id, testid) => {
        const at = await evaluate(`(() => {
          const pre = document.querySelector('${PRE(id)}')
          if (!pre) return null
          pre.scrollIntoView({ block: 'center' })
          const r = pre.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 12) }
        })()`)
        if (!at) return false
        await move(at.x, at.y)
        const end = Date.now() + 2000
        let box = null
        while (box === null && Date.now() < end) {
          box = await evaluate(`(() => {
            const el = document.querySelector('${CB(id)} [data-testid="${testid}"]')
            if (!el) return null
            const r = el.getBoundingClientRect()
            const x = r.x + r.width / 2, y = r.y + r.height / 2
            const top = document.elementFromPoint(x, y)
            return r.width > 0 && top !== null && (top === el || el.contains(top)) ? { x, y } : null
          })()`)
          if (box === null) await sleep(40)
        }
        if (box === null) return false
        await click(box.x, box.y)
        await sleep(150)
        return true
      }
      const { loadDocState } = await import(new URL('../src/lib/collab/doc-store.ts', import.meta.url).href)
      const { appendDocUpdate } = await import(new URL('../src/lib/block/body-write.ts', import.meta.url).href)
      const { peer, edit, findBlock, changesSince } = await import(new URL('../src/lib/testing/collab-peers.ts', import.meta.url).href)
      let remoteClient = 9500
      /** 다른 참여자의 편집 — 쌓으면 협업 서버가 열린 편집기에 퍼뜨린다(커밋 신호). */
      const remoteEdit = async (change) => {
        const state = await loadDocState(ctx, hlPage)
        if (!state.ok) throw new Error('본문을 읽지 못했다')
        remoteClient += 1
        const client = peer(state.value.ydoc, remoteClient)
        change(client)
        const result = await appendDocUpdate(ctx, hlPage, changesSince(client, state.value.ydoc), { origin: 'editor' })
        if (!result.ok) throw new Error(`원격 편집을 받지 않았다: ${JSON.stringify(result)}`)
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${hlPage}` })
      check('전제 — 코드 블록이 그려졌고 편집할 수 있다',
        await waitFor(`!!document.querySelector('${PRE(hb.py)}') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000))

      // ① 열면 칠한다 — 문법은 지연 로드라 들어온 뒤에
      check('★ 언어가 python 인 코드 블록이 칠해진다 — 키워드 · 문자열 · 주석이 각자의 클래스',
        await waitFor(`${hasPaint(hb.py, 'def', 'hljs-keyword')} && ${hasPaint(hb.py, '"hi"', 'hljs-string')} && ${hasPaint(hb.py, '# c', 'hljs-comment')}`, 8000),
        JSON.stringify(await paintedIn(hb.py)))
      const colors = await evaluate(`(() => {
        const pre = document.querySelector('${PRE(hb.py)}')
        const kw = pre.querySelector('.hljs-keyword')
        const str = pre.querySelector('.hljs-string')
        return { pre: getComputedStyle(pre).color, kw: kw && getComputedStyle(kw).color, str: str && getComputedStyle(str).color }
      })()`)
      check('★ 색이 실제로 다르다 — 키워드 · 문자열 · 본문이 서로 다른 색(CSS 가 붙었다)',
        !!colors.kw && !!colors.str && colors.kw !== colors.pre && colors.str !== colors.pre && colors.kw !== colors.str, JSON.stringify(colors))
      check('★ 언어가 없는 코드 블록은 칠하지 않는다', (await paintedIn(hb.plain)).length === 0, JSON.stringify(await paintedIn(hb.plain)))
      check('칠해도 글자는 그대로다', (await codeText(hb.py)) === PY_TEXT, JSON.stringify(await codeText(hb.py)))

      // ② 처음 보는 언어를 고르면 — 문법을 불러온 뒤, 글자를 더 치지 않아도 칠한다(문법이 들어왔다는 메타)
      check('전제 — 언어 목록이 열리고 검색칸이 포커스를 가졌다',
        (await clickChrome(hb.plain, 'code-language')) && (await waitFor(`document.activeElement === document.querySelector('${LANG_SEARCH}')`, 3000)))
      await typeText('rust')
      await key('Enter')
      check('★ 처음 보는 언어(Rust)를 고르면 문법을 불러와 칠한다 — 글자를 더 치지 않아도',
        (await waitFor(`!document.querySelector('${LANG_MENU}')`, 3000))
          && (await waitFor(`${hasPaint(hb.plain, 'fn', 'hljs-keyword')} && ${hasPaint(hb.plain, '1', 'hljs-number')}`, 8000)),
        JSON.stringify(await paintedIn(hb.plain)))

      // ③ 복사는 글자만 — 클립보드 HTML 은 문서에서 만든다(화면의 span 이 아니다)
      await evaluate(`(() => {
        document.querySelector('.blk-editor').focus()
        const range = document.createRange()
        range.selectNodeContents(document.querySelector('${PRE(hb.py)}'))
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      })()`)
      await sleep(200)
      const copied = await evaluate(`(() => {
        const dt = new DataTransfer()
        document.querySelector('.blk-editor').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
        return { text: dt.getData('text/plain'), html: dt.getData('text/html') }
      })()`)
      check('★ 칠한 코드를 복사하면 글자만 — 클립보드의 HTML 에 강조 클래스가 없다',
        copied.text.includes('return "hi"') && copied.html.includes('return') && !copied.html.includes('hljs'), JSON.stringify(copied).slice(0, 400))

      // ④ 고치면 다시 칠한다 — 작은 블록은 곧바로
      await caretInCode(hb.js, JS_TEXT.length)
      check('전제 — js 블록 끝에 캐럿', (await caretOffset(hb.js)) === JS_TEXT.length, String(await caretOffset(hb.js)))
      await typeText(' + 42')
      check('★ 친 글자가 곧바로 칠해진다 — 숫자 42', await waitFor(hasPaint(hb.js, '42', 'hljs-number'), 3000), JSON.stringify(await paintedIn(hb.js)))
      // 글자 조각은 감싸는 범위의 클래스를 모두 진다 — 안쪽이 이기는 것은 editor.css 의 규칙 순서다.
      const nested = await evaluate(`(() => {
        const pre = document.querySelector('${PRE(hb.js)}')
        const color = (text) => {
          const span = [...pre.querySelectorAll('${HL}')].find((s) => s.textContent === text)
          return span ? getComputedStyle(span).color : null
        }
        return { pre: getComputedStyle(pre).color, string: color('\u0060a'), subst: color('\u0024{b + '), inner: color('1'), number: color('42') }
      })()`)
      check('★ 문자열 안의 식은 본문 색 · 그 안의 숫자는 숫자 색 — 안쪽 범위가 이긴다(CSS 의 순서)',
        nested.string !== null && nested.string !== nested.pre && nested.subst === nested.pre && nested.inner !== null && nested.inner === nested.number,
        JSON.stringify(nested))

      // ⑤ 한글 조합 — 조합하는 동안 그 글자 둘레의 DOM 을 다시 그리지 않고, 끝나면 칠한다
      await typeText(' // ')
      await waitFor(hasPaint(hb.js, '//', 'hljs-comment'), 3000)
      await send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
      await sleep(100)
      // 조합이 시작된 뒤의 코드 DOM 을 지켜본다 — 조합하는 글자는 브라우저가 텍스트 노드 안에서 바꾼다(characterData). 요소를 넣고 빼는
      // 변화(childList)는 PM 이 데코레이션을 다시 그린 것이다.
      await evaluate(`(() => {
        window.__composeNode = window.getSelection()?.anchorNode ?? null
        window.__composeRedraws = []
        window.__composeObserver = new MutationObserver((records) => {
          for (const r of records) {
            if (r.type === 'childList') window.__composeRedraws.push(r.target.nodeName + ' +' + r.addedNodes.length + ' -' + r.removedNodes.length)
          }
        })
        window.__composeObserver.observe(document.querySelector('${PRE(hb.js)}'), { childList: true, subtree: true })
      })()`)
      await send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 })
      await send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
      // 미룬 다시 읽기의 기다림(150ms)보다 오래 조합한다 — 그 사이에 다시 칠하면 조합하는 글자 둘레의 span 이 바뀐다.
      await sleep(500)
      const during = await evaluate(`(() => {
        window.__composeObserver.disconnect()
        const n = window.getSelection()?.anchorNode ?? null
        return { same: n !== null && n === window.__composeNode && n.isConnected, text: n?.textContent ?? null, redraws: window.__composeRedraws }
      })()`)
      await send('Input.insertText', { text: '한' })
      await typeText('글')
      // 둘 다 ProseMirror 의 조합 보호가 지키는 것이다 — 강조의 미루기(apply · 뷰)를 빼도 통과했다(8a-3 반사실 e4 · e5 · 증명하지 못한
      // 방어). 강조가 그 보호를 깨지 않는지 본다.
      check('조합하는 동안 강조가 코드의 DOM 을 다시 그리지 않는다', during.redraws.length === 0, JSON.stringify(during))
      check('조합하는 동안 조합 중인 글자의 텍스트 노드가 그대로다', during.same, JSON.stringify(during))
      check('★ 조합이 끝나면 글자가 그대로 들어가고 주석으로 칠한다',
        await waitFor(`document.querySelector('${PRE(hb.js)}').textContent === ${JSON.stringify(`${JS_TEXT} + 42 // 한글`)} && ${hasPaint(hb.js, '// 한글', 'hljs-comment')}`, 3000),
        JSON.stringify([await codeText(hb.js), await paintedIn(hb.js)]))

      // ⑥ 다른 참여자가 언어를 바꾸면 내 화면도 그 문법으로 다시 칠한다
      await remoteEdit((client) => edit(client, (tr, doc) => {
        const { pos, node } = findBlock(doc, hb.py)
        const content = node.firstChild
        tr.setNodeMarkup(pos + 1, undefined, { ...content.attrs, props: { ...content.attrs.props, language: 'javascript' } })
      }))
      check('★ 다른 참여자가 언어를 javascript 로 바꾸면 다시 칠한다 — def 는 더 이상 키워드가 아니고 return 은 키워드다',
        await waitFor(`!${hasPaint(hb.py, 'def', 'hljs-keyword')} && ${hasPaint(hb.py, 'return', 'hljs-keyword')}`, 8000),
        JSON.stringify(await paintedIn(hb.py)))

      // ⑦ 1만 줄 붙여넣기 — 보이는 줄 ± 여백만 칠한다(가상화)
      const BIG_LINES = 10_000
      const bigText = Array.from({ length: BIG_LINES }, (_, i) => `const v${i} = ${i} // c${i}`).join('\n')
      await caretInCode(hb.big, 0)
      check('전제 — 빈 js 블록에 캐럿', (await caretOffset(hb.big)) === 0, String(await caretOffset(hb.big)))
      const pasteAt = Date.now()
      await evaluate(`(() => {
        const dt = new DataTransfer()
        dt.setData('text/plain', ${JSON.stringify(bigText)})
        document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      })()`)
      const pasted = await waitFor(`document.querySelector('${PRE(hb.big)}')?.textContent.length === ${bigText.length}`, 30000)
      const pasteMs = Date.now() - pasteAt
      check('전제 — 1만 줄을 코드 블록에 붙여넣었다', pasted, `${pasteMs}ms`)
      const LAST = `// c${BIG_LINES - 1}`
      check('★ 1만 줄 — 붙여넣은 끝(보이는 줄)이 칠해진다', await waitFor(hasPaint(hb.big, LAST, 'hljs-comment'), 8000),
        JSON.stringify((await paintedIn(hb.big)).slice(-3)))
      const spanCount = () => evaluate(`document.querySelectorAll('${PRE(hb.big)} ${HL}').length`)
      const atEnd = await spanCount()
      // 다 칠하면 줄마다 셋(const · 숫자 · 주석) — 3만 개다. 보이는 줄 ± 여백 80줄이면 수백 개.
      check('★ 1만 줄 — 칠한 span 이 블록 크기와 상관없이 묶인다(다 칠하면 3만 개)', atEnd > 0 && atEnd < 3000, String(atEnd))
      check('★ 1만 줄 — 보이지 않는 첫 줄은 칠하지 않는다', !(await evaluate(hasPaint(hb.big, '// c0', 'hljs-comment'))))

      // 굴린다 — 맨 위로 · 가운데로. 보이게 된 줄을 칠하고 멀어진 줄은 놓는다.
      await evaluate(`document.querySelector('${PRE(hb.big)}').scrollIntoView({ block: 'start' })`)
      check('★ 1만 줄 — 맨 위로 굴리면 첫 줄을 칠하고 끝 줄은 놓는다',
        await waitFor(`${hasPaint(hb.big, '// c0', 'hljs-comment')} && !${hasPaint(hb.big, LAST, 'hljs-comment')}`, 5000),
        String(await spanCount()))
      await evaluate(`(() => {
        const pre = document.querySelector('${PRE(hb.big)}')
        // 5000째 줄의 글자 위치 — 그 줄이 화면 가운데에 오게 굴린다(편집기를 품은 스크롤 상자 · 없으면 문서).
        const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
        const target = ${JSON.stringify('const v5000 =')}
        let node
        while ((node = walker.nextNode())) {
          const at = node.data.indexOf(target)
          if (at === -1) continue
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + target.length)
          let box = pre.parentElement
          while (box && box !== document.body) {
            const style = getComputedStyle(box).overflowY
            if ((style === 'auto' || style === 'scroll') && box.scrollHeight > box.clientHeight) break
            box = box.parentElement
          }
          const scroller = box && box !== document.body ? box : document.scrollingElement
          scroller.scrollTop += range.getBoundingClientRect().top - window.innerHeight / 2
          return
        }
      })()`)
      check('★ 1만 줄 — 가운데로 굴리면 그 줄을 칠하고 첫 줄 · 끝 줄은 칠하지 않는다',
        await waitFor(`${hasPaint(hb.big, '// c5000', 'hljs-comment')} && !${hasPaint(hb.big, '// c0', 'hljs-comment')} && !${hasPaint(hb.big, LAST, 'hljs-comment')}`, 5000),
        String(await spanCount()))

      // 끝에서 글자를 친다 — 칠 때마다 1만 줄을 다시 읽지 않는다(미뤘다가 손을 멈추면 그 창만)
      await caretInCode(hb.big, bigText.length)
      check('전제 — 1만 줄 블록 끝에 캐럿', (await caretOffset(hb.big)) === bigText.length, String(await caretOffset(hb.big)))
      const times = []
      for (let i = 0; i < 5; i += 1) {
        const t0 = Date.now()
        await send('Input.insertText', { text: 'x' })
        await evaluate('0')
        times.push(Date.now() - t0)
      }
      const median = [...times].sort((a, b) => a - b)[2]
      check('★ 1만 줄 — 끝에서 글자를 쳐도 멈추지 않는다(한 글자 중앙값 200ms 미만)', median < 200, times.join(','))
      console.log(`      (붙여넣기 ${pasteMs}ms · 끝에서 칠한 span ${atEnd}개 · 한 글자 ${times.join(', ')}ms)`)
      check('★ 1만 줄 — 손을 멈추면 친 글자까지 다시 칠한다', await waitFor(hasPaint(hb.big, `${LAST}xxxxx`, 'hljs-comment'), 5000),
        JSON.stringify((await paintedIn(hb.big)).slice(-2)))

      // ⑧ 읽기 전용에서도 칠한다 — 열어 둔 채로 잠근다(편집기를 다시 만든다)
      const locked = await fetch(`${pagesUrl}/${hlPage}/lock`, { method: 'PUT', headers: authed })
      check('전제 — 잠갔고 열어 둔 편집기가 읽기 전용이 됐다',
        locked.ok && (await waitFor(`document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'false'`, 15000)), String(locked.status))
      check('★ 읽기 전용 편집기도 칠한다', await waitFor(`${hasPaint(hb.py, '"hi"', 'hljs-string')} && ${hasPaint(hb.plain, 'fn', 'hljs-keyword')}`, 8000),
        JSON.stringify(await paintedIn(hb.py)))
      await fetch(`${pagesUrl}/${hlPage}/lock`, { method: 'DELETE', headers: authed })
      await sleep(1500)
    }

    if (sectionIf('목차 (8b-1 · F-01-16)')) {
      // 목차는 내용을 저장하지 않고 그릴 때 헤딩에서 계산한다. 헤딩을 고치면 · 다른 참여자가 넣으면 따라가고, 항목을 누르면 그
      // 헤딩으로 간다(접힌 토글은 펼친다 · 같은 항목을 두 번 눌러도 · 읽기 전용에서도 키보드로). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const newPage = async (title) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title }) })).json()).page.id
      const tocPage = await newPage(`목차 ${stamp}`)
      const tb = { top: randomUUID(), toc: randomUUID(), h1: randomUUID(), toggle: randomUUID(), inner: randomUUID(), h3: randomUUID(), last: randomUUID(), bottom: randomUUID() }
      const heading = (id, level, text) => block(id, `heading_${level}`, text)
      const filler = (n, tag) => Array.from({ length: n }, (_, i) => block(randomUUID(), 'paragraph', `${tag} ${i + 1}`))
      await saveBody(tocPage, {
        blocks: [
          block(tb.top, 'paragraph', '맨 위'),
          { id: tb.toc, type: 'table_of_contents', title: [], properties: {}, format: { block_color: 'blue' }, children: [] },
          heading(tb.h1, 1, '개요'),
          ...filler(25, '앞 문단'),
          block(tb.toggle, 'toggle', '접히는 토글', [heading(tb.inner, 2, '토글 안 제목')]),
          heading(tb.h3, 3, '셋째'),
          ...filler(25, '뒤 문단'),
          heading(tb.last, 2, '끝 제목'),
          // 끝 제목 아래에도 굴릴 자리가 있어야 그 제목이 화면 위쪽에 온다.
          ...filler(30, '꼬리 문단'),
          block(tb.bottom, 'paragraph', '끝 문단'),
        ],
      })

      const NAV = `[data-block-id="${tb.toc}"] nav.blk-table_of_contents`
      const EDITABLE = `document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`
      /** 목차의 줄 — (깊이, 글자). */
      const tocLines = () => evaluate(`[...document.querySelectorAll('${NAV} .blk-toc-item')].map((li) => [Number(li.style.getPropertyValue('--toc-depth')), li.textContent])`)
      const sameLines = (expected) => `JSON.stringify([...document.querySelectorAll('${NAV} .blk-toc-item')].map((li) => [Number(li.style.getPropertyValue('--toc-depth')), li.textContent])) === ${JSON.stringify(JSON.stringify(expected))}`
      /** 그 헤딩이 화면 위쪽(0 ~ 160px)에 있는가 · 골라졌는가 · 주소의 해시. */
      const landed = (id) => `(() => {
        const c = document.querySelector('[data-block-id="${id}"]')
        if (!c) return false
        const top = c.getBoundingClientRect().top
        return top >= 0 && top < 160 && c.classList.contains('blk-selected') && window.location.hash === '#${id}'
      })()`
      const landedInfo = (id) => evaluate(`(() => {
        const c = document.querySelector('[data-block-id="${id}"]')
        return { top: c?.getBoundingClientRect().top ?? null, selected: c?.classList.contains('blk-selected') ?? null, hash: window.location.hash }
      })()`)
      /** 목차의 그 줄을 누른다 — 목차를 화면 가운데로 굴린 뒤. */
      const clickEntry = async (text) => {
        const box = await evaluate(`(() => {
          document.querySelector('${NAV}')?.scrollIntoView({ block: 'center' })
          const link = [...document.querySelectorAll('${NAV} a.blk-toc-link')].find((a) => a.textContent === ${JSON.stringify(text)})
          if (!link) return null
          const r = link.getBoundingClientRect()
          return { x: r.x + Math.min(r.width / 2, 40), y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        return true
      }
      /** 그 블록의 글자 끝에 캐럿 — 캐럿이 그 블록에 섰는지 보고 아니면 다시 누른다. */
      const caretAtEnd = async (id) => {
        for (let i = 0; i < 6; i += 1) {
          await clickSelector(`[data-block-id="${id}"] > *:first-child`)
          await key('End')
          const inside = await evaluate(`(() => {
            const n = window.getSelection()?.anchorNode
            const el = n?.nodeType === 1 ? n : n?.parentElement
            return document.activeElement === document.querySelector('.blk-editor') && el?.closest('[data-block-id]')?.getAttribute('data-block-id') === '${id}'
          })()`)
          if (inside) return true
          await sleep(200)
        }
        return false
      }
      const { loadDocState } = await import(new URL('../src/lib/collab/doc-store.ts', import.meta.url).href)
      const { appendDocUpdate } = await import(new URL('../src/lib/block/body-write.ts', import.meta.url).href)
      const { peer, edit, findBlock, changesSince } = await import(new URL('../src/lib/testing/collab-peers.ts', import.meta.url).href)
      let remoteClient = 9700
      const remoteEdit = async (change) => {
        const state = await loadDocState(ctx, tocPage)
        if (!state.ok) throw new Error('본문을 읽지 못했다')
        remoteClient += 1
        const client = peer(state.value.ydoc, remoteClient)
        change(client)
        const result = await appendDocUpdate(ctx, tocPage, changesSince(client, state.value.ydoc), { origin: 'editor' })
        if (!result.ok) throw new Error(`원격 편집을 받지 않았다: ${JSON.stringify(result)}`)
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${tocPage}` })
      check('전제 — 목차가 그려졌고 편집할 수 있다', await waitFor(`!!document.querySelector('${NAV} .blk-toc-item') && ${EDITABLE}`, 15000))

      // ① 그리기 — 문서 순서 · 수준의 순위 · 블록 색
      check('★ 목차가 헤딩을 문서 순서로 그린다 — 토글 안까지 · 쓰인 수준의 순위로 들여 쓴다',
        await waitFor(sameLines([[0, '개요'], [1, '토글 안 제목'], [2, '셋째'], [1, '끝 제목']]), 3000), JSON.stringify(await tocLines()))
      const look = await evaluate(`(() => {
        const nav = document.querySelector('${NAV}')
        const links = [...nav.querySelectorAll('a.blk-toc-link')]
        const plain = document.querySelector('[data-block-id="${tb.top}"] p')
        return {
          color: nav.dataset.color ?? null, navColor: getComputedStyle(nav).color, plainColor: getComputedStyle(plain).color,
          lefts: links.map((a) => Math.round(a.getBoundingClientRect().left)), hrefs: links.map((a) => a.getAttribute('href')),
          tabIndexes: links.map((a) => a.tabIndex),
        }
      })()`)
      check('★ 줄이 실제로 들여 써진다(CSS) · 항목은 그 블록으로 가는 링크(#id)',
        look.lefts[1] > look.lefts[0] && look.lefts[2] > look.lefts[1] && look.lefts[3] === look.lefts[1]
          && JSON.stringify(look.hrefs) === JSON.stringify([`#${tb.h1}`, `#${tb.inner}`, `#${tb.h3}`, `#${tb.last}`]), JSON.stringify(look))
      check('★ 블록 색이 목차에 보인다(노드 뷰가 data-color 를 단다)', look.color === 'blue' && look.navColor !== look.plainColor, JSON.stringify(look))
      check('★ 편집 중에는 목차의 링크가 탭 순서에 없다 — Tab 은 들여쓰기다', look.tabIndexes.every((t) => t === -1), JSON.stringify(look.tabIndexes))

      // ② 누르면 그 헤딩으로 — 화면 위쪽 · 블록 선택 · 주소의 해시
      await clickEntry('끝 제목')
      check('★ 항목을 누르면 그 헤딩이 화면 위쪽에 오고 · 골라지고 · 주소의 해시가 그 블록이다',
        await waitFor(landed(tb.last), 4000), JSON.stringify(await landedInfo(tb.last)))
      await sleep(300)
      await clickEntry('끝 제목')
      check('★ 같은 항목을 두 번 눌러도 간다 — 해시가 같아 hashchange 가 나지 않아도',
        await waitFor(landed(tb.last), 4000), JSON.stringify(await landedInfo(tb.last)))

      // ③ 접힌 토글 안의 헤딩 — 누르면 펼친다
      // 화살표를 화면에 들인 뒤 누른다 — 앞 장면이 끝 제목으로 굴려 화살표가 화면 밖이다.
      await evaluate(`document.querySelector('[data-block-id="${tb.toggle}"] .blk-toggle-arrow').scrollIntoView({ block: 'center' })`)
      const arrow = await rect(`[data-block-id="${tb.toggle}"] .blk-toggle-arrow`)
      await click(arrow.x + arrow.w / 2, arrow.y + arrow.h / 2)
      const folded = await waitFor(`document.querySelector('[data-block-id="${tb.toggle}"]').getAttribute('data-collapsed') === 'true'
        && document.querySelector('[data-block-id="${tb.inner}"]').getBoundingClientRect().height === 0`, 3000)
      check('전제 — 토글을 접었고 안의 제목이 숨었다', folded)
      check('★ 접혀도 목차에 남는다 — 접힘은 보는 사람의 상태다', (await tocLines()).some(([, t]) => t === '토글 안 제목'), JSON.stringify(await tocLines()))
      await clickEntry('토글 안 제목')
      check('★ 접힌 토글 안의 헤딩을 누르면 토글을 펼치고 그 헤딩으로 간다',
        await waitFor(`document.querySelector('[data-block-id="${tb.toggle}"]').getAttribute('data-collapsed') !== 'true' && ${landed(tb.inner)}`, 4000),
        JSON.stringify(await landedInfo(tb.inner)))

      // ④ 따라간다 — 헤딩의 글자 · 마크다운으로 만든 새 제목 · 다른 참여자의 제목
      check('전제 — 셋째 제목 끝에 캐럿', await caretAtEnd(tb.h3))
      await typeText('!!')
      check('★ 헤딩의 글자를 고치면 목차의 줄이 따라간다', await waitFor(sameLines([[0, '개요'], [1, '토글 안 제목'], [2, '셋째!!'], [1, '끝 제목']]), 3000),
        JSON.stringify(await tocLines()))
      check('전제 — 끝 문단 끝에 캐럿', await caretAtEnd(tb.bottom))
      await key('Enter')
      for (const ch of '## ') await typeText(ch)
      await typeText('새 제목')
      check('★ 마크다운으로 만든 새 제목이 목차의 끝에 선다', await waitFor(sameLines([[0, '개요'], [1, '토글 안 제목'], [2, '셋째!!'], [1, '끝 제목'], [1, '새 제목']]), 3000),
        JSON.stringify(await tocLines()))
      const remoteId = randomUUID()
      await remoteEdit((client) => edit(client, (tr, doc) => {
        const { pos, node } = findBlock(doc, tb.top)
        const schema = doc.type.schema
        tr.insert(pos + node.nodeSize, schema.nodes.blockContainer.create({ blockId: remoteId }, [
          schema.nodes.heading_1.create({ props: {}, format: {} }, schema.text('원격 제목')),
        ]))
      }))
      check('★ 다른 참여자가 넣은 제목이 목차에 선다(문서 순서 그대로)',
        await waitFor(sameLines([[0, '원격 제목'], [0, '개요'], [1, '토글 안 제목'], [2, '셋째!!'], [1, '끝 제목'], [1, '새 제목']]), 8000),
        JSON.stringify(await tocLines()))

      // ⑤ 서버 — 목차는 내용을 저장하지 않는다
      let saved = null
      for (let i = 0; i < 60; i += 1) {
        const blocks = (await readBody(tocPage)).doc.blocks
        saved = blocks.find((b) => b.id === tb.toc) ?? null
        if (blocks.some((b) => (b.title ?? []).map((r) => r.plain_text).join('') === '새 제목')) break
        await sleep(150)
      }
      check("★ 서버 — 목차는 type='table_of_contents' · 색만 · 내용(글자)이 없다",
        saved?.type === 'table_of_contents' && saved?.format?.block_color === 'blue' && (saved?.title ?? []).length === 0,
        JSON.stringify(saved))

      // ⑥ /목차 — 헤딩이 없는 새 페이지에서 만들고, 제목을 쓰면 안내가 목록으로 바뀐다
      const emptyPage = await newPage(`목차 빈 ${stamp}`)
      const first = randomUUID()
      await saveBody(emptyPage, { blocks: [block(first, 'paragraph', '')] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${emptyPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${first}"] p') && ${EDITABLE}`, 15000)
      check('전제 — 빈 줄에 캐럿', await caretAtEnd(first))
      await typeText('/')
      await typeText('목차')
      await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 2000)
      await key('Enter')
      check('★ /목차 로 만들면 헤딩이 없다는 안내가 선다',
        await waitFor(`document.querySelector('[data-block-id="${first}"] nav.blk-table_of_contents .blk-toc-empty')?.textContent?.includes('목차가 생깁니다') === true`, 3000),
        await evaluate(`document.querySelector('[data-block-id="${first}"]')?.innerHTML?.slice(0, 200) ?? '(없음)'`))
      // 텍스트 없는 블록으로 바꾸면 뒤에 빈 문단이 생기고 캐럿이 그리로 간다(8b-1 이 고친 옛 틈 — 전에는 이어 쓸 길이 없었다).
      for (const ch of '# ') await typeText(ch)
      await typeText('첫 제목')
      check('★ /목차 뒤에는 빈 줄이 생기고 캐럿이 그리로 — 이어 친 글자가 그 줄에 들어간다',
        await evaluate(`(() => {
          const rows = [...document.querySelectorAll('.blk-editor [data-block-id]')]
          return rows.length === 2 && rows[0].getAttribute('data-block-id') === '${first}' && rows[1].querySelector('h1')?.textContent === '첫 제목'
        })()`),
        JSON.stringify(await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((c) => c.firstElementChild?.tagName + ':' + c.textContent.slice(0, 40))`)))
      check('★ 제목을 쓰면 안내가 목록으로 바뀐다',
        await waitFor(`[...document.querySelectorAll('[data-block-id="${first}"] nav .blk-toc-item')].map((li) => li.textContent).join('|') === '첫 제목'`, 3000),
        await evaluate(`document.querySelector('[data-block-id="${first}"] nav')?.textContent ?? '(없음)'`))

      // ⑦ 읽기 전용 — 열어 둔 채 잠근다. 링크가 탭 순서에 서고 Enter 로 그 헤딩으로 간다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${tocPage}` })
      await waitFor(`!!document.querySelector('${NAV} .blk-toc-item') && ${EDITABLE}`, 15000)
      const locked = await fetch(`${pagesUrl}/${tocPage}/lock`, { method: 'PUT', headers: authed })
      check('전제 — 잠갔고 열어 둔 편집기가 읽기 전용이 됐다', locked.ok && (await waitFor(`document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'false'`, 15000)),
        String(locked.status))
      check('★ 읽기 전용에서도 목차를 그린다', await waitFor(`document.querySelectorAll('${NAV} .blk-toc-item').length === 6`, 5000), JSON.stringify(await tocLines()))
      await evaluate(`document.querySelector('input[aria-label="페이지 제목"]')?.focus()`)
      let tabbed = false
      for (let i = 0; i < 20 && !tabbed; i += 1) {
        await key('Tab')
        tabbed = await evaluate(`document.activeElement?.matches?.('${NAV} a.blk-toc-link') === true`)
      }
      check('★ 읽기 전용 — Tab 으로 목차의 링크에 닿는다', tabbed, await evaluate(`document.activeElement?.outerHTML?.slice(0, 120) ?? ''`))
      const target = await evaluate(`document.activeElement?.dataset?.tocTarget ?? ''`)
      await key('Enter')
      check('★ 읽기 전용 — Enter 로 그 헤딩으로 간다(문서를 바꾸지 않으므로 읽기 전용에서도)', target !== '' && (await waitFor(landed(target), 4000)),
        JSON.stringify(await landedInfo(target)))
      await fetch(`${pagesUrl}/${tocPage}/lock`, { method: 'DELETE', headers: authed })
      await sleep(1500)
    }

    if (sectionIf('이동 경로 블록 (8b-2 · F-01-16)')) {
      // breadcrumb 블록은 내용을 저장하지 않고 머리의 경로와 같은 줄을 그린다(볼 수 있는 조상만 · teamspace 는 멤버에게만). 링크는
      // 앱 안에서 옮겨 가고, 제목을 고치면(서버가 다시 그린다) 따라간다. 볼 수 없는 조상은 공유받은 동료의 경로에 없다(브라우저
      // 세션을 동료로 바꾼다 — 끝에 되돌린다). 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const topTitle = `기밀 상위 ${stamp}`
      const midTitle = `기밀 중간 ${stamp}`
      const leafTitle = `경로 페이지 ${stamp}`
      const top = await post({ title: topTitle, privateTop: true })
      const mid = await post({ title: midTitle, parentPageId: top })
      const leaf = await post({ title: leafTitle, parentPageId: mid })
      const crumbId = randomUUID()
      const after = randomUUID()
      await saveBody(leaf, {
        blocks: [
          block(randomUUID(), 'paragraph', '맨 위'),
          { id: crumbId, type: 'breadcrumb', title: [], properties: {}, format: {}, children: [] },
          block(after, 'paragraph', '아래 문단'),
        ],
      })
      const NAV = `[data-block-id="${crumbId}"] nav.blk-breadcrumb`
      const EDITABLE = `document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`
      /** 블록의 줄 — (종류, 글자, 링크인가). */
      const crumbs = () => evaluate(`[...document.querySelectorAll('${NAV} .blk-breadcrumb-item')].map((li) => [li.dataset.kind, li.textContent, !!li.querySelector('a')])`)
      const crumbLabels = (sel = NAV) => `JSON.stringify([...document.querySelectorAll('${sel} .blk-breadcrumb-item')].map((li) => li.textContent))`
      /** 머리의 경로 — 글자만(구분자 '/' 는 뺀다). */
      const headerLabels = () => evaluate(`[...document.querySelectorAll('nav[aria-label="상위 경로"] a, nav[aria-label="상위 경로"] span.text-neutral-400')].map((e) => e.textContent)`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${leaf}` })
      check('전제 — breadcrumb 블록이 그려졌고 편집할 수 있다', await waitFor(`!!document.querySelector('${NAV} .blk-breadcrumb-item') && ${EDITABLE}`, 15000))

      // ① 그리기 — 머리와 같은 줄 · 지금 페이지는 링크가 아니다
      check('★ 블록이 이 페이지의 경로를 그린다 — 워크스페이스 · 조상 · 지금 페이지(링크 아님)',
        JSON.stringify(await crumbs()) === JSON.stringify([['workspace', '워크스페이스', true], ['page', topTitle, true], ['page', midTitle, true], ['current', leafTitle, false]]),
        JSON.stringify(await crumbs()))
      check('★ 머리의 경로와 같은 줄이다(같은 함수를 지난다)',
        JSON.stringify((await crumbs()).map(([, t]) => t)) === JSON.stringify(await headerLabels()), JSON.stringify([await crumbs(), await headerLabels()]))
      const look = await evaluate(`(() => {
        const links = [...document.querySelectorAll('${NAV} a.blk-breadcrumb-link')]
        return { hrefs: links.map((a) => a.getAttribute('href')), tabs: links.map((a) => a.tabIndex), separator: getComputedStyle(document.querySelectorAll('${NAV} .blk-breadcrumb-item')[1], '::before').content }
      })()`)
      check('★ 링크는 그 페이지의 주소 · 편집 중에는 탭 순서에 없다 · 구분자는 CSS 가 그린다',
        JSON.stringify(look.hrefs) === JSON.stringify([`/w/${workspaceId}`, `/w/${workspaceId}/${top}`, `/w/${workspaceId}/${mid}`])
          && look.tabs.every((t) => t === -1) && look.separator.includes('/'), JSON.stringify(look))

      // ② 제목을 고치면 따라간다 — 서버가 다시 그린 경로가 메타 트랜잭션으로 들어온다
      await clickSelector('input[aria-label="페이지 제목"]')
      await key('End')
      await typeText(' 고침')
      await key('Enter')
      check('★ 이 페이지의 제목을 고치면 경로의 끝이 따라간다(서버가 다시 그린 경로)',
        await waitFor(`${crumbLabels()} === ${JSON.stringify(JSON.stringify(['워크스페이스', topTitle, midTitle, `${leafTitle} 고침`]))}`, 8000),
        JSON.stringify(await crumbs()))

      // ③ 누르면 그 페이지로 — 앱 안에서
      const midBox = await evaluate(`(() => {
        const a = [...document.querySelectorAll('${NAV} a.blk-breadcrumb-link')].find((x) => x.textContent === ${JSON.stringify(midTitle)})
        if (!a) return null
        a.scrollIntoView({ block: 'center' })
        const r = a.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      // 표지 — 앱 안에서 옮겨 가면(클라이언트 라우터) 창이 그대로라 남고, 문서를 다시 불러오면 사라진다.
      await evaluate(`window.__crumbMarker = ${stamp}`)
      if (midBox) await click(midBox.x, midBox.y)
      check('★ 경로의 링크를 누르면 그 페이지로 간다', !!midBox && (await waitFor(`window.location.pathname === '/w/${workspaceId}/${mid}'
        && document.querySelector('input[aria-label="페이지 제목"]')?.value === ${JSON.stringify(midTitle)}`, 8000)),
        await evaluate('window.location.pathname'))
      check('★ 앱 안에서 옮겨 간다 — 문서를 다시 불러오지 않는다(창의 표지가 남는다)', (await evaluate('window.__crumbMarker')) === stamp,
        String(await evaluate('window.__crumbMarker')))

      // ④ /이동 경로 — 빈 줄을 breadcrumb 으로 · 뒤의 빈 줄로 이어 쓴다
      const fresh = await post({ title: `경로 새 페이지 ${stamp}`, parentPageId: mid })
      const first = randomUUID()
      await saveBody(fresh, { blocks: [block(first, 'paragraph', '')] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${fresh}` })
      await waitFor(`!!document.querySelector('[data-block-id="${first}"] p') && ${EDITABLE}`, 15000)
      let focused = false
      for (let i = 0; i < 10 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${first}"] p`)
        focused = await evaluate(`document.activeElement === document.querySelector('.blk-editor')`)
        if (!focused) await sleep(200)
      }
      await typeText('/')
      await typeText('경로')
      await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 2000)
      await key('Enter')
      await typeText('이어 쓴 글')
      check('★ /경로 로 만든 블록이 이 페이지의 경로를 그리고 · 이어 친 글자는 뒤의 새 줄에 들어간다',
        await waitFor(`${crumbLabels(`[data-block-id="${first}"] nav.blk-breadcrumb`)} === ${JSON.stringify(JSON.stringify(['워크스페이스', topTitle, midTitle, `경로 새 페이지 ${stamp}`]))}
          && [...document.querySelectorAll('.blk-editor [data-block-id]')][1]?.textContent === '이어 쓴 글'`, 4000),
        JSON.stringify(await evaluate(`[...document.querySelectorAll('.blk-editor [data-block-id]')].map((c) => c.textContent.slice(0, 60))`)))
      let savedType = null
      for (let i = 0; i < 60 && savedType !== 'breadcrumb'; i += 1) {
        savedType = (await readBody(fresh)).doc.blocks.find((b) => b.id === first)?.type ?? null
        if (savedType !== 'breadcrumb') await sleep(150)
      }
      check("★ 서버 — type='breadcrumb' 행으로 저장됐다", savedType === 'breadcrumb', String(savedType))

      // ⑤ 볼 수 없는 조상은 없다 — 이 페이지만 공유받은 동료(조상은 소유자의 개인 페이지 아래)
      const reader = await joinAs(workspaceId, await createUser(`경로 동료 ${stamp}`), 'member')
      const granted = await fetch(`${pagesUrl}/${leaf}/access`, {
        method: 'POST', headers: authed, body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: reader.userId }, level: 'view' }),
      })
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      try {
        check('전제 — 동료는 이 페이지만 읽기로 받았다', granted.ok, String(granted.status))
        await browseAs(reader.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${leaf}` })
        check('전제 — 동료의 화면에 breadcrumb 블록이 그려졌고 읽기 전용이다',
          await waitFor(`!!document.querySelector('${NAV} .blk-breadcrumb-item') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'false'`, 15000))
        const seen = await crumbs()
        const html = await evaluate(`document.querySelector('${NAV}').outerHTML`)
        check('★ 볼 수 없는 조상은 동료의 경로에 없다 — 제목도 자리도(머리와 같은 줄)',
          JSON.stringify(seen) === JSON.stringify([['workspace', '워크스페이스', true], ['current', `${leafTitle} 고침`, false]])
            && !html.includes('기밀')
            && JSON.stringify(seen.map(([, t]) => t)) === JSON.stringify(await headerLabels()),
          JSON.stringify([seen, await headerLabels()]))
        check('★ 읽기 전용에서는 경로의 링크가 탭 순서에 선다',
          await evaluate(`[...document.querySelectorAll('${NAV} a.blk-breadcrumb-link')].every((a) => a.tabIndex === 0)`))
      } finally {
        await browseAs(session)
      }
      await sleep(1000)
    }

    if (sectionIf('페이지 아이콘 (8c-1 · F-02-05)')) {
      // 머리의 "아이콘 추가"는 무작위 이모지를 곧바로 단다 · 아이콘을 누르면 고르개(검색 · 키보드 · 무작위 · 제거) · 고른 아이콘이
      // 사이드바 · 경로(머리와 블록)에 선다 · 새로고침해도 남는다 · 읽기만 받은 사람은 보기만 한다(브라우저 세션을 동료로 바꾼다 — 끝에
      // 되돌린다). 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const patchIcon = (page, icon, headers = authed) =>
        fetch(`${pagesUrl}/${page}`, { method: 'PATCH', headers, body: JSON.stringify({ icon }) })
      const parentTitle = `아이콘 부모 ${stamp}`
      const childTitle = `아이콘 자식 ${stamp}`
      const parent = await post({ title: parentTitle })
      const child = await post({ title: childTitle, parentPageId: parent })
      const crumbId = randomUUID()
      await saveBody(child, {
        blocks: [{ id: crumbId, type: 'breadcrumb', title: [], properties: {}, format: {}, children: [] }, block(randomUUID(), 'paragraph', '본문')],
      })

      const ICON = '[data-testid="page-icon"]'
      const ADD = '[data-testid="page-icon-add"]'
      const PICKER = '[data-testid="emoji-picker"]'
      const SEARCH = '[data-testid="emoji-search"]'
      const ACTIVE_OPTION = `${PICKER} [role="option"][aria-selected="true"]`
      const headerIcon = () => evaluate(`document.querySelector('${ICON}')?.textContent ?? null`)
      const treeLink = (page) => `nav[aria-label="페이지 트리"] li > div > a[href="/w/${workspaceId}/${page}"]`
      /** 사이드바 트리에서 그 페이지 줄의 아이콘 — 이모지 · 기본 글리프면 '' · 줄이 없으면 null. */
      const treeIconExpr = (page) => `(document.querySelector(${JSON.stringify(treeLink(page))})?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null)`
      const treeIcon = (page) => evaluate(treeIconExpr(page))
      const focusedOn = (sel) => `document.activeElement === document.querySelector(${JSON.stringify(sel)})`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${parent}` })
      check('전제 — 아이콘 없는 페이지 · "아이콘 추가"가 있다', await waitFor(`!!document.querySelector('${ADD}') && !document.querySelector('${ICON}')`, 15000))
      check('★ 사이드바 — 아이콘 없는 페이지는 기본 문서 글리프 · 줄의 글자는 제목뿐(글리프는 글자가 아니다)',
        (await treeIcon(parent)) === '' && (await evaluate(`document.querySelector(${JSON.stringify(treeLink(parent))})?.textContent`)) === parentTitle,
        JSON.stringify([await treeIcon(parent), await evaluate(`document.querySelector(${JSON.stringify(treeLink(parent))})?.textContent`)]))

      // ① "아이콘 추가" — 머리에 마우스를 올리면 보이고, 누르면 무작위 이모지를 곧바로 단다
      const hiddenBefore = await evaluate(`getComputedStyle(document.querySelector('${ADD}')).opacity`)
      const titleBox = await rect('input[aria-label="페이지 제목"]')
      if (titleBox) await move(titleBox.x + 20, titleBox.y + titleBox.h / 2)
      check('★ "아이콘 추가"는 머리에 마우스를 올려야 보인다',
        hiddenBefore === '0' && (await waitFor(`getComputedStyle(document.querySelector('${ADD}')).opacity === '1'`, 2000)),
        `${hiddenBefore} → ${await evaluate(`getComputedStyle(document.querySelector('${ADD}')).opacity`)}`)
      await clickSelector(ADD)
      check('★ "아이콘 추가"를 누르면 무작위 이모지가 곧바로 선다 — 고르개는 열리지 않는다',
        await waitFor(`!!document.querySelector('${ICON}') && !document.querySelector('${PICKER}')`, 8000), String(await headerIcon()))
      const added = await headerIcon()
      check('★ 사이드바의 그 줄도 같은 아이콘이다(서버가 다시 그렸다)', await waitFor(`${treeIconExpr(parent)} === ${JSON.stringify(added)}`, 8000),
        JSON.stringify([added, await treeIcon(parent)]))

      // ② 고르개 — 검색칸이 포커스 · 한국어로 찾고 Enter
      await clickSelector(ICON)
      check('★ 아이콘을 누르면 고르개가 열리고 검색칸이 포커스를 갖는다',
        await waitFor(`!!document.querySelector('${PICKER} [role="option"]') && ${focusedOn(SEARCH)}`, 8000))
      await typeText('새싹')
      check('검색 — 맨 앞 후보 🌱 을 가리킨다', await waitFor(`document.querySelector('${ACTIVE_OPTION}')?.dataset.emoji === '🌱'`, 3000),
        String(await evaluate(`document.querySelector('${ACTIVE_OPTION}')?.dataset.emoji`)))
      await key('Enter')
      check('★ Enter 로 고르면 닫히고 아이콘이 바뀐다 · 포커스는 아이콘으로',
        await waitFor(`!document.querySelector('${PICKER}') && document.querySelector('${ICON}')?.textContent === '🌱' && ${focusedOn(ICON)}`, 5000),
        JSON.stringify([await headerIcon(), await evaluate('document.activeElement?.outerHTML?.slice(0, 80)')]))
      check('★ 사이드바도 따라간다', await waitFor(`${treeIconExpr(parent)} === '🌱'`, 8000), String(await treeIcon(parent)))

      // ③ 키보드 — → 로 다음 후보 · 검색칸이 포커스를 지킨다(목록의 빈 곳 · 그룹 제목을 눌러도)
      await clickSelector(ICON)
      await waitFor(`!!document.querySelector('${PICKER} [role="option"]') && ${focusedOn(SEARCH)}`, 8000)
      await clickSelector(`${PICKER} [role="group"] > div:first-child`)
      await typeText('고양이')
      check('★ 목록의 그룹 제목을 눌러도 검색칸이 포커스를 지킨다 — 친 글자가 검색어가 된다',
        (await evaluate(`document.querySelector('${SEARCH}')?.value`)) === '고양이' && (await evaluate(focusedOn(SEARCH))),
        JSON.stringify([await evaluate(`document.querySelector('${SEARCH}')?.value`), await evaluate('document.activeElement?.tagName')]))
      await waitFor(`document.querySelectorAll('${PICKER} [role="option"]').length > 2`, 3000)
      const second = await evaluate(`document.querySelectorAll('${PICKER} [role="option"]')[1]?.dataset.emoji ?? null`)
      await key('ArrowRight')
      check('★ → 로 다음 후보를 가리킨다 — 포커스는 검색칸에 남는다',
        second !== null && (await waitFor(`document.querySelector('${ACTIVE_OPTION}')?.dataset.emoji === ${JSON.stringify(second)} && ${focusedOn(SEARCH)}`, 2000)),
        JSON.stringify([second, await evaluate(`document.querySelector('${ACTIVE_OPTION}')?.dataset.emoji`)]))
      await key('Enter')
      check('★ 그 후보가 아이콘이 된다', await waitFor(`document.querySelector('${ICON}')?.textContent === ${JSON.stringify(second)}`, 5000), String(await headerIcon()))

      // ④ 무작위 — 연 채로 바뀐다 · Esc 로 닫으면 아이콘으로
      await clickSelector(ICON)
      await waitFor(`!!document.querySelector('${PICKER} [role="option"]')`, 8000)
      await clickSelector('[data-testid="emoji-random"]')
      check('★ 무작위 — 아이콘이 바뀌고 고르개는 열려 있다',
        await waitFor(`document.querySelector('${ICON}')?.textContent !== ${JSON.stringify(second)} && !!document.querySelector('${PICKER}')`, 5000),
        String(await headerIcon()))
      const randomIcon = await headerIcon()
      await key('Escape')
      check('★ Esc 로 닫고 포커스는 아이콘으로', await waitFor(`!document.querySelector('${PICKER}') && ${focusedOn(ICON)}`, 3000))
      check('무작위로 단 아이콘도 저장됐다(사이드바)', await waitFor(`${treeIconExpr(parent)} === ${JSON.stringify(randomIcon)}`, 8000),
        JSON.stringify([randomIcon, await treeIcon(parent)]))

      // ⑤ 하위 페이지의 경로 — 부모 줄이 그 아이콘을 앞에 단다 · 머리와 블록이 같은 줄 · 아이콘만 바뀌어도 블록이 따라간다
      const CRUMB_ITEMS = `[data-block-id="${crumbId}"] .blk-breadcrumb-item`
      const crumbTexts = () => evaluate(`[...document.querySelectorAll('${CRUMB_ITEMS}')].map((li) => li.textContent)`)
      const headerTexts = () =>
        evaluate(`[...document.querySelectorAll('nav[aria-label="상위 경로"] a, nav[aria-label="상위 경로"] span.text-neutral-400')].map((e) => e.textContent)`)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${child}` })
      await waitFor(`!!document.querySelector('${CRUMB_ITEMS}') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      const crumbs = await crumbTexts()
      check('★ 경로의 부모 줄이 그 아이콘을 앞에 단다 — 머리와 블록이 같은 줄',
        JSON.stringify(crumbs) === JSON.stringify(['워크스페이스', `${randomIcon}${parentTitle}`, childTitle])
          && JSON.stringify(await headerTexts()) === JSON.stringify(crumbs),
        JSON.stringify([crumbs, await headerTexts()]))
      check('★ 사이드바 — 펼쳐진 부모 아래의 자식은 기본 글리프', (await treeIcon(child)) === '', String(await treeIcon(child)))
      // 아이콘만 바뀐 경로 — 부모의 아이콘을 바꾸고(API), 이 페이지에 아이콘을 단다(화면 — 저장이 서버 렌더를 다시 그린다). 제목은 그대로라
      // 같은 경로의 판단이 아이콘을 보지 않으면 새 경로를 버린다(8c-1 반사실 s9 — 처음 쓴 장면은 제목도 함께 바꿔 그것을 가리지 못했다).
      const swapped = await patchIcon(parent, { type: 'emoji', emoji: '🚀' })
      await clickSelector(ADD)
      await waitFor(`!!document.querySelector('${ICON}')`, 8000)
      const childIcon = await headerIcon()
      check('★ 아이콘만 바뀌어도 경로 블록이 따라간다 — 부모(🚀) · 이 페이지(제목은 그대로)',
        swapped.ok && childIcon !== null && (await waitFor(`JSON.stringify([...document.querySelectorAll('${CRUMB_ITEMS}')].map((li) => li.textContent)) === ${JSON.stringify(JSON.stringify(['워크스페이스', `🚀${parentTitle}`, `${childIcon}${childTitle}`]))}`, 8000)),
        JSON.stringify([childIcon, await crumbTexts()]))

      // ⑥ 제거 — "아이콘 추가"로 돌아온다 · 사이드바는 기본 글리프 · 새로고침해도 없다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${parent}` })
      check('★ 새로고침해도 아이콘이 남는다(서버의 값)', await waitFor(`document.querySelector('${ICON}')?.textContent === '🚀'`, 15000), String(await headerIcon()))
      await clickSelector(ICON)
      await waitFor(`!!document.querySelector('[data-testid="page-icon-remove"]')`, 8000)
      await clickSelector('[data-testid="page-icon-remove"]')
      check('★ 제거하면 "아이콘 추가"로 돌아오고 포커스가 그리로 간다',
        await waitFor(`!document.querySelector('${ICON}') && !document.querySelector('${PICKER}') && ${focusedOn(ADD)}`, 5000),
        String(await evaluate('document.activeElement?.outerHTML?.slice(0, 80)')))
      check('★ 사이드바는 기본 글리프로 돌아온다', await waitFor(`${treeIconExpr(parent)} === ''`, 8000), String(await treeIcon(parent)))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${parent}` })
      check('★ 새로고침해도 아이콘이 없다', await waitFor(`!!document.querySelector('${ADD}') && !document.querySelector('${ICON}')`, 15000))

      // ⑦ 라우트 — 모양이 아니면 400 · type 은 생략할 수 있다
      const bad = await patchIcon(parent, { type: 'emoji', emoji: '🚀🚀' })
      const badBody = await bad.json().catch(() => ({}))
      const loose = await patchIcon(parent, { emoji: '🌵' })
      const looseBody = await loose.json().catch(() => ({}))
      check('★ 라우트 — 두 글자는 400 invalid_icon · type 을 빼도 받는다',
        bad.status === 400 && badBody.error === 'invalid_icon' && loose.status === 200 && looseBody.page?.icon?.emoji === '🌵',
        JSON.stringify([bad.status, badBody, loose.status, looseBody]))

      // ⑧ 읽기만 받은 사람 — 아이콘은 보이고 버튼이 아니다 · 라우트는 403 · 아이콘은 그대로
      const secret = await post({ title: `아이콘 읽기 ${stamp}`, privateTop: true })
      const marked = await patchIcon(secret, { type: 'emoji', emoji: '📕' })
      const reader = await joinAs(workspaceId, await createUser(`아이콘 동료 ${stamp}`), 'member')
      const granted = await fetch(`${pagesUrl}/${secret}/access`, {
        method: 'POST', headers: authed, body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: reader.userId }, level: 'view' }),
      })
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      try {
        check('전제 — 아이콘을 달았고 동료는 이 페이지를 읽기로 받았다', marked.ok && granted.ok, `${marked.status} ${granted.status}`)
        await browseAs(reader.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${secret}` })
        check('★ 읽기만 받은 사람 — 아이콘은 보이고 버튼이 아니다 · "아이콘 추가"가 없다',
          await waitFor(`document.querySelector('${ICON}')?.textContent === '📕' && document.querySelector('${ICON}').tagName !== 'BUTTON' && !document.querySelector('${ADD}')`, 15000),
          String(await evaluate(`document.querySelector('${ICON}')?.outerHTML ?? '(없음)'`)))
        const denied = await patchIcon(secret, { type: 'emoji', emoji: '😈' }, { ...json, cookie: `nc_session=${reader.token}` })
        check('★ 라우트 — 읽기만 받은 사람의 아이콘 바꾸기는 403', denied.status === 403, String(denied.status))
      } finally {
        await browseAs(session)
      }
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${secret}` })
      check('거부한 뒤에도 아이콘은 그대로다', await waitFor(`document.querySelector('${ICON}')?.textContent === '📕'`, 15000), String(await headerIcon()))
      await sleep(500)
    }

    if (sectionIf('페이지 아이콘이 서는 나머지 자리 (8c-2 · F-02-05)')) {
      // 본문의 하위 페이지 블록 · 멘션 칩 · `@` 후보, 검색 결과, 백링크, 옮기기 후보, 휴지통, 인박스가 그 페이지의 아이콘을 앞에 단다.
      // 아이콘이 없으면 기본 문서 글리프(그림이라 줄의 글자가 제목 그대로다). 다른 사람이 옮겨 온 하위 페이지의 아이콘은 제목과 함께
      // 다시 읽은 맵에서 온다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const setIcon = async (page, emoji) =>
        (await fetch(`${pagesUrl}/${page}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ icon: { type: 'emoji', emoji } }) })).ok
      const parentTitle = `아이콘본문${stamp}`
      const foxTitle = `아이콘여우${stamp}`
      const plainTitle = `아이콘없음${stamp}`
      const movedTitle = `옮겨온하위${stamp}`
      const fadingTitle = `지울아이콘${stamp}`
      const octoTitle = `문어멘션${stamp}`
      const parent = await post({ title: parentTitle })
      const fox = await post({ title: foxTitle, parentPageId: parent })
      const plain = await post({ title: plainTitle, parentPageId: parent })
      const fading = await post({ title: fadingTitle, parentPageId: parent })
      const elsewhere = await post({ title: `옮겨올곳${stamp}` })
      const moved = await post({ title: movedTitle, parentPageId: elsewhere })
      // 본문 어디에도 없는 페이지 — `@` 로 고르면 칩의 아이콘은 후보에서만 온다(맵을 다시 묻지 않는다).
      const octo = await post({ title: octoTitle })
      const iconsSet = (await setIcon(parent, '🌳')) && (await setIcon(fox, '🦊')) && (await setIcon(moved, '🚚'))
        && (await setIcon(fading, '🍂')) && (await setIcon(octo, '🐙'))
      // 부모의 본문 — 하위 페이지 참조 둘(만들 때 들어갔다) 뒤에 여우를 멘션한 문단. 참조를 지우지 않게 읽은 본문에 더한다.
      const mentionBlock = randomUUID()
      const before = (await readBody(parent)).doc
      await saveBody(parent, {
        blocks: [...before.blocks, { id: mentionBlock, type: 'paragraph', title: [textRun('참고 '), pageMentionRun(fox)], properties: {}, format: {}, children: [] }],
      })

      const iconIn = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null)`
      const textOf = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? null)`
      const REF = (id) => `[data-block-id="${id}"] .blk-page-link`
      const CHIP = `[data-block-id="${mentionBlock}"] .blk-mention-page[data-mention-id="${fox}"]`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${parent}` })
      check('전제 — 아이콘을 달았고 부모의 본문이 그려졌다',
        iconsSet && (await waitFor(`!!document.querySelector(${JSON.stringify(REF(fox))}) && !!document.querySelector(${JSON.stringify(CHIP)})`, 15000)))

      // ① 본문 — 하위 페이지 블록 · 멘션 칩
      check('★ 하위 페이지 블록이 그 페이지의 아이콘을 앞에 단다',
        (await evaluate(iconIn(REF(fox)))) === '🦊' && (await evaluate(textOf(REF(fox)))) === `🦊${foxTitle}`,
        JSON.stringify([await evaluate(iconIn(REF(fox))), await evaluate(textOf(REF(fox)))]))
      check('★ 아이콘 없는 하위 페이지는 기본 글리프 — 글자는 제목뿐',
        (await evaluate(iconIn(REF(plain)))) === '' && (await evaluate(textOf(REF(plain)))) === plainTitle,
        JSON.stringify([await evaluate(iconIn(REF(plain))), await evaluate(textOf(REF(plain)))]))
      check('전제 — 지울 아이콘(🍂)도 처음에는 선다', (await evaluate(iconIn(REF(fading)))) === '🍂', String(await evaluate(iconIn(REF(fading)))))
      check('★ 페이지 멘션 칩이 그 아이콘을 앞에 단다',
        (await evaluate(iconIn(CHIP))) === '🦊' && (await evaluate(textOf(CHIP))) === `🦊${foxTitle}`,
        JSON.stringify([await evaluate(iconIn(CHIP)), await evaluate(textOf(CHIP))]))

      // ② 다른 사람이 옮겨 온 하위 페이지 — 참조가 협업으로 도착하고, 다시 읽은 맵이 제목과 아이콘을 함께 준다. 그사이 아이콘을 지운
      //    하위 페이지(🍂)는 다시 읽은 뒤 기본 글리프로 돌아간다(맵이 옛 아이콘을 남기지 않는다 — `mergePageIcons`).
      const unset = (await fetch(`${pagesUrl}/${fading}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ icon: null }) })).ok
      const movedOk = (await fetch(`${pagesUrl}/${moved}/move`, { method: 'POST', headers: authed, body: JSON.stringify({ targetParentId: parent }) })).ok
      check('★ 옮겨 온 하위 페이지의 블록도 아이콘을 단다(참조가 도착한 뒤 다시 읽은 맵)',
        movedOk && (await waitFor(`${iconIn(REF(moved))} === '🚚' && ${textOf(REF(moved))} === ${JSON.stringify(`🚚${movedTitle}`)}`, 12000)),
        JSON.stringify([movedOk, await evaluate(iconIn(REF(moved))), await evaluate(textOf(REF(moved)))]))
      check('★ 다시 읽은 맵에서 아이콘을 지운 하위 페이지는 기본 글리프로 돌아간다(옛 아이콘이 남지 않는다)',
        unset && (await waitFor(`${iconIn(REF(fading))} === '' && ${textOf(REF(fading))} === ${JSON.stringify(fadingTitle)}`, 5000)),
        JSON.stringify([unset, await evaluate(iconIn(REF(fading))), await evaluate(textOf(REF(fading)))]))

      // ③ `@` 후보 — 페이지 후보가 아이콘을 싣고, 고르면 칩도 곧바로 아이콘을 단다. 본문에 없던 페이지(🐙)라 아이콘은 후보에서만 온다
      //    (맵을 다시 묻지 않는다 — 이름과 함께 넣는다).
      const mentionLine = await line(mentionBlock)
      if (mentionLine) await click(mentionLine.x + mentionLine.w - 4, mentionLine.y + mentionLine.h / 2)
      await key('End')
      for (const ch of ' @문어멘션') await typeText(ch)
      const CANDIDATE = `[role="listbox"][aria-label="멘션"] li`
      check('★ `@` 의 페이지 후보가 아이콘을 앞에 단다',
        await waitFor(`[...document.querySelectorAll('${CANDIDATE}')].some((li) => li.textContent.includes(${JSON.stringify(octoTitle)}) && li.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') === '🐙')`, 8000),
        String(await evaluate(`document.querySelector('[role="listbox"][aria-label="멘션"]')?.innerHTML?.slice(0, 300) ?? '(없음)'`)))
      await key('Enter')
      const OCTO_CHIP = `[data-block-id="${mentionBlock}"] .blk-mention-page[data-mention-id="${octo}"]`
      check('★ 고른 멘션 칩도 곧바로 아이콘을 단다(후보의 아이콘)',
        await waitFor(`${iconIn(OCTO_CHIP)} === '🐙' && ${textOf(OCTO_CHIP)} === ${JSON.stringify(`🐙${octoTitle}`)}`, 5000),
        String(await evaluate(`[...document.querySelectorAll('.blk-mention')].map((e) => e.textContent).join('|')`)))

      // ④ 검색 — 결과 줄이 아이콘을 앞에 단다. 사이드바의 단추로 연다 — 편집기에서 Esc 를 누르면 블록 선택이 되고, 그 상태의 Mod+K 는
      //   검색을 열지 않아 친 검색어가 고른 블록을 덮어쓴다(이 절의 첫 판이 그렇게 멘션 문단을 지웠다).
      await clickSelector('nav[aria-label="페이지 트리"] button[title^="검색"]')
      check('전제 — 검색 입력칸이 포커스를 가졌다', await waitFor(`document.activeElement === document.querySelector('[data-testid="search-input"]')`, 5000))
      await typeText(foxTitle)
      const HIT = `[data-testid="search-hit"][data-page-id="${fox}"]`
      check('★ 검색 결과가 그 페이지의 아이콘을 앞에 단다', await waitFor(`${iconIn(HIT)} === '🦊'`, 8000),
        String(await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 200) ?? '(없음)'`)))
      await key('Escape')
      await waitFor(`!document.querySelector('[data-testid="search-overlay"]')`, 3000)

      // ⑤ 백링크 · 옮기기 후보 — 여우의 페이지에서
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${fox}` })
      await waitFor(`!!document.querySelector('details[aria-label="백링크"]') && !!document.querySelector('[data-testid="move-open"]')`, 15000)
      check('★ 백링크가 멘션한 페이지의 아이콘을 앞에 단다',
        (await evaluate(`[...document.querySelectorAll('details[aria-label="백링크"] a')].find((a) => a.getAttribute('href') === '/w/${workspaceId}/${parent}')?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null`)) === '🌳',
        String(await evaluate(`document.querySelector('details[aria-label="백링크"]')?.innerHTML?.slice(0, 300)`)))
      await clickSelector('[data-testid="move-open"]')
      const OPTION = (id) => `[data-testid="move-to-page"][data-page-id="${id}"]`
      check('★ 옮기기 후보가 그 페이지의 아이콘을 앞에 단다 — 없으면 기본 글리프',
        await waitFor(`${iconIn(OPTION(parent))} === '🌳' && ${iconIn(OPTION(elsewhere))} === ''`, 5000),
        JSON.stringify([await evaluate(iconIn(OPTION(parent))), await evaluate(iconIn(OPTION(elsewhere)))]))
      await key('Escape')

      // ⑥ 휴지통 — 버린 페이지의 아이콘. 전체 판에서는 앞 절들이 버린 페이지가 많다 — 패널의 검색칸으로 이 줄만 남긴다.
      const trashRes = await fetch(`${pagesUrl}/${moved}/trash`, { method: 'POST', headers: authed, body: '{}' })
      const trashed = trashRes.ok
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${parent}` })
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
      // 패널이 열릴 때까지 다시 누른다 — 전체 판은 사이드바가 길어 hydration 이 늦고, 그 전의 클릭은 버려진다(§6 의 hydration 함정 ·
      // 전체 판의 첫 실행이 "패널 닫힘"으로 떨어졌다).
      const TRASH_BUTTON = `[...document.querySelectorAll('nav[aria-label="페이지 트리"] button[aria-expanded]')].find((x) => x.textContent.trim().startsWith('휴지통'))`
      let trashButton = null
      for (let i = 0; i < 10 && (await evaluate(`${TRASH_BUTTON}?.getAttribute('aria-expanded') ?? null`)) !== 'true'; i += 1) {
        trashButton = await evaluate(`(() => {
          const b = ${TRASH_BUTTON}
          if (!b) return null
          b.scrollIntoView({ block: 'center' })
          const r = b.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (trashButton) await click(trashButton.x, trashButton.y)
        await waitFor(`${TRASH_BUTTON}?.getAttribute('aria-expanded') === 'true'`, 500)
      }
      if (await waitFor(`!!document.querySelector('input[aria-label="휴지통 검색"]')`, 5000)) {
        await clickSelector('input[aria-label="휴지통 검색"]')
        await typeText(movedTitle)
      }
      const trashEntry = `[...document.querySelectorAll('nav[aria-label="페이지 트리"] li')].find((li) => li.textContent.includes(${JSON.stringify(movedTitle)}))`
      check('★ 휴지통의 줄이 버린 페이지의 아이콘을 앞에 단다',
        trashed && (await waitFor(`${trashEntry}?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') === '🚚'`, 5000)),
        JSON.stringify([trashRes.status, !!trashButton, await evaluate(`${trashEntry}?.innerHTML?.slice(0, 200) ?? '(줄 없음)'`),
          await evaluate(`document.querySelector('input[aria-label="휴지통 검색"]')?.value ?? '(패널 닫힘)'`)]))

      // ⑦ 인박스 — 동료가 멘션한 사람의 인박스에서. 멘션당하는 사람은 따로 만들고 그 사람으로 본다 — 브라우저의 주인을 멘션하면 뒤의
      //    인박스 절이 보는 안 읽음 목록에 이 알림이 끼어든다(전체 판의 첫 실행이 그렇게 세 검사를 떨어뜨렸다).
      const pal = await joinAs(workspaceId, await createUser(`아이콘 멘션 동료 ${stamp}`), 'member')
      const mentioned = await joinAs(workspaceId, await createUser(`아이콘 멘션 받는 이 ${stamp}`), 'member')
      const palBody = (await readBody(fox)).doc
      const palSaved = await savePageBody(pal.ctx, fox, {
        blocks: [...palBody.blocks, { id: randomUUID(), type: 'paragraph', title: [textRun('확인 부탁 '), userMentionRun(mentioned.userId)], properties: {}, format: {}, children: [] }],
      })
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      try {
        await browseAs(mentioned.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/inbox` })
        const INBOX_LINK = `ul[aria-label="알림 목록"] a[href^="/w/${workspaceId}/${fox}"]`
        check('★ 인박스의 줄이 그 페이지의 아이콘을 앞에 단다', palSaved.ok && (await waitFor(`${iconIn(INBOX_LINK)} === '🦊'`, 15000)),
          String(await evaluate(`document.querySelector('ul[aria-label="알림 목록"]')?.textContent?.slice(0, 200) ?? '(없음)'`)))
      } finally {
        await browseAs(session)
      }
      await sleep(500)
    }

    if (sectionIf('데이터베이스 행의 아이콘 (8c-3a · F-02-05)')) {
      // 행은 페이지라 아이콘의 자리가 같다(`format.page_icon` · `setPageIcon` 이 행을 받는다). 표의 제목 칸 · 보드 카드 · 관계형 칩과
      // 고르개 · 템플릿 목록 · 새 행 메뉴 · 템플릿 편집 화면이 그것을 앞에 단다. 셀을 고친 응답(화면이 그 행으로 갈아 끼운다)도 아이콘을
      // 싣는다. 준비는 서버 명령으로 한다 — 자기 데이터를 스스로 만든다(E2E_ONLY 로 홀로 돈다).
      const stamp = Date.now()
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const dbMod = await import(src('database/database.ts'))
      const propMod = await import(src('database/property.ts'))
      const rowMod = await import(src('database/row.ts'))
      const relMod = await import(src('database/relation.ts'))
      const tplMod = await import(src('database/template.ts'))
      const viewMod = await import(src('database/view.ts'))
      const pageMod = await import(src('block/page.ts'))
      const { withReadTransaction } = await import(src('db/tx.ts'))
      const must = (r, what) => {
        if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
        return r.value
      }
      const emoji = (e) => ({ type: 'emoji', emoji: e })
      const tasks = must(await dbMod.createDatabase(ctx, { name: `행아이콘작업${stamp}` }), '표')
      const projects = must(await dbMod.createDatabase(ctx, { name: `행아이콘프로젝트${stamp}` }), '표')
      const titleIdOf = async (ds) => must(await propMod.getSchema(ctx, ds), '스키마').properties.find((p) => p.type === 'title').id
      const taskTitle = await titleIdOf(tasks.dataSourceId)
      const projectTitle = await titleIdOf(projects.dataSourceId)
      const mkRow = async (ds, titleId, title, icon) => {
        const id = must(await rowMod.createRow(ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] }), '행').id
        if (icon !== undefined) await pageMod.setPageIcon(ctx, id, emoji(icon))
        return id
      }
      const relation = must(await relMod.addRelationProperty(ctx, tasks.dataSourceId, { name: '프로젝트', targetDataSourceId: projects.dataSourceId }), '관계형')
      const rocketTitle = `로켓${stamp}`
      const plainProjectTitle = `그냥프로젝트${stamp}`
      const cactusTitle = `선인장${stamp}`
      const foxTitle = `여우작업${stamp}`
      const plainTaskTitle = `그냥작업${stamp}`
      const rocket = await mkRow(projects.dataSourceId, projectTitle, rocketTitle, '🚀')
      const plainProject = await mkRow(projects.dataSourceId, projectTitle, plainProjectTitle)
      const cactus = await mkRow(projects.dataSourceId, projectTitle, cactusTitle, '🌵')
      const fox = await mkRow(tasks.dataSourceId, taskTitle, foxTitle, '🦊')
      await mkRow(tasks.dataSourceId, taskTitle, plainTaskTitle)
      must(await relMod.linkRows(ctx, fox, relation.propertyId, { add: [rocket, plainProject] }), '연결')
      const templateTitle = `회의록틀${stamp}`
      const template = must(await tplMod.createTemplate(ctx, tasks.dataSourceId, { title: templateTitle }), '템플릿')
      await pageMod.setPageIcon(ctx, template.id, emoji('📝'))
      // 템플릿만 잇는 프로젝트(☄️) — 템플릿으로 만든 행이 화면에 처음 보는 id 를 가져온다. 그 제목 · 아이콘은 첫 화면이 아니라
      // 화면이 나중에 묻는 길(`POST /relation-labels` · `useRelationLabels`)로 온다.
      const cometTitle = `혜성${stamp}`
      const comet = await mkRow(projects.dataSourceId, projectTitle, cometTitle, '☄️')
      must(await relMod.linkRows(ctx, template.id, relation.propertyId, { add: [comet] }), '템플릿 연결')
      must(await propMod.addProperty(ctx, tasks.dataSourceId, { name: '끝', type: 'checkbox' }), '체크박스')
      const doneId = must(await propMod.getSchema(ctx, tasks.dataSourceId), '스키마').properties.find((p) => p.name === '끝').id
      const board = must(await viewMod.createView(ctx, tasks.id, { type: 'board', name: '보드', groupBy: { property_id: doneId } }), '보드')

      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const iconIn = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null)`
      const textOf = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? null)`
      /** 그 칸의 관계형 칩 — (글자, 아이콘). */
      const chipsIn = (cell) => `[...document.querySelectorAll('td[data-cell="${cell}"] [data-testid="db-relation-chip"]')].map((c) => [c.textContent, c.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null])`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}` })
      check('전제 — 표가 그려졌다', await waitFor(`!!document.querySelector('td[data-cell="0:0"] [data-testid="db-row-title"]')`, 15000))

      // ① 제목 칸
      check('★ 표의 제목 칸이 그 행의 아이콘을 앞에 단다 — 글자는 아이콘 + 제목',
        (await evaluate(iconIn('td[data-cell="0:0"]'))) === '🦊' && (await evaluate(textOf('td[data-cell="0:0"]'))) === `🦊${foxTitle}`,
        JSON.stringify([await evaluate(iconIn('td[data-cell="0:0"]')), await evaluate(textOf('td[data-cell="0:0"]'))]))
      check('★ 아이콘 없는 행은 기본 글리프 — 칸의 글자는 제목뿐',
        (await evaluate(iconIn('td[data-cell="1:0"]'))) === '' && (await evaluate(textOf('td[data-cell="1:0"]'))) === plainTaskTitle,
        JSON.stringify([await evaluate(iconIn('td[data-cell="1:0"]')), await evaluate(textOf('td[data-cell="1:0"]'))]))

      // ② 관계형 칩 — 아이콘이 있으면 그것, 없으면 ↗
      check('★ 관계형 칩이 연결된 행의 아이콘을 단다 — 없으면 ↗',
        await waitFor(`JSON.stringify(${chipsIn('0:1')}) === ${JSON.stringify(JSON.stringify([[`🚀${rocketTitle}`, '🚀'], [`↗${plainProjectTitle}`, null]]))}`, 5000),
        JSON.stringify(await evaluate(chipsIn('0:1'))))

      // ③ 셀을 고친 응답도 아이콘을 싣는다 — 서버가 받은 뒤에도 그대로(화면이 응답의 행으로 갈아 끼운다)
      const renamed = `${foxTitle}고침`
      await clickOn('td[data-cell="0:0"]')
      await key('Enter')
      const editing = await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 5000)
      if (editing) {
        await evaluate(`document.querySelector('[data-testid="db-cell-input"]').select()`)
        await typeText(renamed)
        await key('Enter')
      }
      let serverTitle = null
      for (let i = 0; i < 40 && serverTitle !== renamed; i += 1) {
        serverTitle = (await withReadTransaction((tx) => rowMod.readRow(tx, fox)))?.title ?? null
        if (serverTitle !== renamed) await sleep(150)
      }
      // 응답이 화면에 닿을 때까지 — 서버가 받은 뒤 1초 동안 칸이 아이콘과 새 제목을 계속 지키는지 본다.
      let held = serverTitle === renamed
      for (let i = 0; i < 10 && held; i += 1) {
        held = (await evaluate(iconIn('td[data-cell="0:0"]'))) === '🦊' && (await evaluate(textOf('td[data-cell="0:0"]'))) === `🦊${renamed}`
        await sleep(100)
      }
      check('★ 제목을 고친 뒤에도(서버의 응답으로 갈아 끼운 행) 아이콘이 남는다', editing && held,
        JSON.stringify([editing, serverTitle, await evaluate(iconIn('td[data-cell="0:0"]')), await evaluate(textOf('td[data-cell="0:0"]'))]))

      // ④ 관계형 고르개 — 지금 연결 · 후보, 고른 칩은 곧바로 아이콘을 단다
      await clickOn('td[data-cell="0:1"]')
      await clickOn('td[data-cell="0:1"]')
      const opened = await waitFor(`document.activeElement?.matches('[data-testid="db-relation-input"]')`, 8000)
      check('★ 고르개의 지금 연결이 아이콘을 단다 — 없으면 ↗',
        opened && (await waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-relation-linked"]')].map((li) => li.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null)) === ${JSON.stringify(JSON.stringify(['🚀', null]))}`, 5000)),
        String(await evaluate(`document.querySelector('[data-testid="db-relation-editor"]')?.innerHTML?.slice(0, 300) ?? '(없음)'`)))
      const CANDIDATE = `[data-testid="db-relation-candidate"][data-row-id="${cactus}"]`
      check('★ 고르개의 후보가 아이콘을 단다', await waitFor(`${iconIn(CANDIDATE)} === '🌵'`, 5000),
        String(await evaluate(`[...document.querySelectorAll('[data-testid="db-relation-candidate"]')].map((e) => e.textContent).join('|')`)))
      await clickOn(CANDIDATE)
      check('★ 고른 행의 칩은 곧바로 아이콘을 단다(고르개가 넘긴 아이콘 — 다시 묻지 않는다)',
        await waitFor(`${chipsIn('0:1')}.some(([t, i]) => t === ${JSON.stringify(`🌵${cactusTitle}`)} && i === '🌵')`, 5000),
        JSON.stringify(await evaluate(chipsIn('0:1'))))
      await key('Escape')
      await waitFor(`!document.querySelector('[data-testid="db-relation-editor"]')`, 3000)

      // ⑤ 템플릿 — 목록 · 새 행 메뉴가 아이콘을 달고, 템플릿으로 만든 행이 물려받는다
      await clickOn('[data-testid="db-templates-button"]')
      const TEMPLATE_OPEN = `[data-testid="db-template-open"][data-template-id="${template.id}"]`
      check('★ 템플릿 목록이 템플릿의 아이콘을 단다', await waitFor(`${iconIn(TEMPLATE_OPEN)} === '📝'`, 8000),
        String(await evaluate(`document.querySelector('[data-testid="db-templates-panel"]')?.textContent ?? '(없음)'`)))
      await clickOn('[data-testid="db-templates-button"]')
      await clickOn('[data-testid="db-add-row-menu"]')
      const NEW_FROM = `[data-testid="db-new-template"][data-template-id="${template.id}"]`
      check('★ 새 행 메뉴의 템플릿이 아이콘을 단다', await waitFor(`${iconIn(NEW_FROM)} === '📝'`, 8000),
        String(await evaluate(`document.querySelector('[data-testid="db-add-row-menu-menu"]')?.textContent ?? '(없음)'`)))
      await clickOn(NEW_FROM)
      // 새 행은 제목 칸을 편집 상태로 연다 — 편집칸이 제목 자리(아이콘 포함)를 덮으므로 끝낸 뒤 본다.
      if (await waitFor(`document.querySelectorAll('td[data-cell$=":0"]').length === 3 && !!document.querySelector('[data-testid="db-cell-input"]')`, 8000)) {
        await key('Escape')
      }
      check('★ 템플릿으로 만든 행이 그 아이콘을 물려받는다(만든 응답의 행)',
        await waitFor(`[...document.querySelectorAll('td[data-cell$=":0"] [data-testid="db-row-title"]')].some((t) => t.textContent === ${JSON.stringify(`📝${templateTitle}`)} && t.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') === '📝')`, 8000),
        String(await evaluate(`[...document.querySelectorAll('td[data-cell$=":0"]')].map((t) => t.textContent).join('|')`)))
      check('★ 나중에 온 행의 관계형 칩도 아이콘을 단다(화면이 다시 물은 제목 · 아이콘)',
        await waitFor(`${chipsIn('2:1')}.some(([t, i]) => t === ${JSON.stringify(`☄️${cometTitle}`)} && i === '☄️')`, 8000),
        JSON.stringify(await evaluate(chipsIn('2:1'))))

      // ⑥ 보드 카드
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}?v=${board.id}` })
      const CARD = `[...document.querySelectorAll('[data-testid="db-board-card-title"]')].find((c) => c.textContent.includes(${JSON.stringify(renamed)}))`
      check('★ 보드 카드의 제목이 그 행의 아이콘을 앞에 단다',
        await waitFor(`${CARD}?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') === '🦊'`, 15000),
        String(await evaluate(`[...document.querySelectorAll('[data-testid="db-board-card-title"]')].map((c) => c.textContent).join('|')`)))

      // ⑦ 템플릿 편집 화면 — 머리의 아이콘(고칠 수 있으면 단추)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}/templates/${template.id}` })
      check('★ 템플릿 편집 화면의 머리에 아이콘이 서고 고를 수 있다(단추)',
        await waitFor(`document.querySelector('[data-testid="page-icon"]')?.textContent === '📝' && document.querySelector('[data-testid="page-icon"]').tagName === 'BUTTON'`, 15000),
        String(await evaluate(`document.querySelector('[data-testid="page-icon"]')?.outerHTML ?? '(없음)'`)))
      await sleep(500)
    }

    if (sectionIf('데이터베이스 자신의 아이콘 (8c-3b · F-02-05)')) {
      // 데이터베이스의 아이콘은 정본의 `database.icon` 이다(페이지 아이콘과 같은 모양 · 같은 고르개). 머리의 고르개가 그것을 바꾸고 사이드바 ·
      // 머리의 경로 · 템플릿 화면의 경로 · 관계형의 대상 고르개 · teamspace 화면이 그것을 단다. 아이콘이 없으면 사이드바 · teamspace 화면은
      // 표 글리프(그림 — 전에는 글자 `▦` 였다). 고치는 사람은 이름과 같다(구조 · 데이터베이스 잠금). 자기 데이터를 스스로 만든다 —
      // E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const dbMod = await import(src('database/database.ts'))
      const tplMod = await import(src('database/template.ts'))
      const aclMod = await import(src('permissions/acl.ts'))
      const { DATABASE_GLYPH } = await import(src('block/page-icon.ts'))
      const must = (r, what) => {
        if (!r.ok) throw new Error(`${what} 준비 실패: ${r.reason}`)
        return r.value
      }
      const shelfName = `서가${stamp}`
      const pickerName = `대상고르기${stamp}`
      const shelf = must(await dbMod.createDatabase(ctx, { name: shelfName }), '표')
      const picker = must(await dbMod.createDatabase(ctx, { name: pickerName }), '표')
      const template = must(await tplMod.createTemplate(ctx, shelf.dataSourceId, { title: `서가틀${stamp}` }), '템플릿')
      const dbApi = (id) => `${BASE}/api/workspaces/${workspaceId}/databases/${id}`
      const patchDb = (id, body, headers = authed) => fetch(dbApi(id), { method: 'PATCH', headers, body: JSON.stringify(body) })

      const ICON = '[data-testid="page-icon"]'
      const ADD = '[data-testid="page-icon-add"]'
      const PICKER = '[data-testid="emoji-picker"]'
      const ACTIVE_OPTION = `${PICKER} [role="option"][aria-selected="true"]`
      const headerIcon = () => evaluate(`document.querySelector('${ICON}')?.textContent ?? null`)
      /** 그 줄의 [아이콘(이모지 · 글리프면 '' · 없으면 null), 글리프의 첫 선, 줄의 글자]. */
      const rowExpr = (sel) => `(() => { const a = document.querySelector(${JSON.stringify(sel)}); const i = a?.querySelector('[data-page-icon]')
        return a ? [i?.getAttribute('data-page-icon') ?? null, i?.querySelector('path')?.getAttribute('d') ?? null, a.textContent] : null })()`
      const TREE_ROW = `nav[aria-label="페이지 트리"] a[href="/w/${workspaceId}/db/${shelf.id}"]`
      const treeRow = () => evaluate(rowExpr(TREE_ROW))
      const glyphRow = (name) => JSON.stringify(['', DATABASE_GLYPH.paths[0], name])

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${shelf.id}` })
      check('전제 — 아이콘 없는 표 · "아이콘 추가"가 있다',
        await waitFor(`!!document.querySelector('${ADD}') && !document.querySelector('${ICON}') && !!document.querySelector(${JSON.stringify(TREE_ROW)})`, 15000))
      check('★ 사이드바 — 아이콘 없는 표는 표 글리프(문서 글리프가 아니다) · 줄의 글자는 이름뿐(글리프는 글자가 아니다)',
        JSON.stringify(await treeRow()) === glyphRow(shelfName), JSON.stringify(await treeRow()))

      // ① "아이콘 추가" — 머리에 마우스를 올리면 보이고, 누르면 무작위 이모지를 곧바로 단다
      const nameBox = await rect('input[aria-label="데이터베이스 이름"]')
      if (nameBox) await move(nameBox.x + 20, nameBox.y + nameBox.h / 2)
      check('★ "아이콘 추가"는 표의 머리에 마우스를 올리면 보인다',
        await waitFor(`getComputedStyle(document.querySelector('${ADD}')).opacity === '1'`, 2000))
      await clickSelector(ADD)
      check('★ "아이콘 추가"를 누르면 무작위 이모지가 곧바로 선다 — 고르개는 열리지 않는다',
        await waitFor(`!!document.querySelector('${ICON}') && !document.querySelector('${PICKER}')`, 8000), String(await headerIcon()))
      const added = await headerIcon()
      check('★ 사이드바의 그 표 줄도 같은 아이콘이다(서버가 다시 그렸다)',
        await waitFor(`${rowExpr(TREE_ROW)}?.[0] === ${JSON.stringify(added)}`, 8000), JSON.stringify([added, await treeRow()]))

      // ② 고르개 — 한국어로 찾고 Enter. 머리의 경로도 그 아이콘을 단다
      await clickSelector(ICON)
      await waitFor(`!!document.querySelector('${PICKER} [role="option"]')`, 8000)
      await typeText('책')
      await waitFor(`document.querySelector('${ACTIVE_OPTION}')?.dataset.emoji?.codePointAt(0) === 0x1f4da`, 3000)
      const picked = await evaluate(`document.querySelector('${ACTIVE_OPTION}')?.dataset.emoji ?? null`)
      await key('Enter')
      check('★ 고르면 닫히고 표의 아이콘이 바뀐다(📚)',
        picked !== null && picked.codePointAt(0) === 0x1f4da
          && (await waitFor(`!document.querySelector('${PICKER}') && document.querySelector('${ICON}')?.textContent === ${JSON.stringify(picked)}`, 5000)),
        JSON.stringify([picked, await headerIcon()]))
      check('★ 사이드바 · 머리의 경로가 따라간다',
        await waitFor(`${rowExpr(TREE_ROW)}?.[0] === ${JSON.stringify(picked)}
          && document.querySelector('nav[aria-label="상위 경로"] span.text-neutral-400')?.textContent === ${JSON.stringify(`${picked}${shelfName}`)}`, 8000),
        JSON.stringify([await treeRow(), await evaluate(`document.querySelector('nav[aria-label="상위 경로"] span.text-neutral-400')?.textContent ?? null`)]))

      // ③ 템플릿 편집 화면의 경로 — 표의 줄이 그 아이콘을 앞에 단다(새로 그린 화면 — 서버의 값)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${shelf.id}/templates/${template.id}` })
      const CRUMB = `nav[aria-label="상위 경로"] a[href="/w/${workspaceId}/db/${shelf.id}"]`
      check('★ 템플릿 화면의 경로 — 표의 줄이 그 아이콘을 앞에 단다',
        await waitFor(`JSON.stringify(${rowExpr(CRUMB)}?.filter((_, i) => i !== 1)) === ${JSON.stringify(JSON.stringify([picked, `${picked}${shelfName}`]))}`, 15000),
        JSON.stringify(await evaluate(rowExpr(CRUMB))))

      // ④ 관계형의 대상 고르개 — `<option>` 은 글자만 담는다: 아이콘이 있으면 이름 앞의 글자, 없으면 이름만
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${picker.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-add-column"]')`, 15000)
      await clickSelector('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await setSelect('select[aria-label="속성 유형"]', 'relation')
      const optionTexts = `[...(document.querySelector('[data-testid="db-relation-target"]')?.options ?? [])].map((o) => o.textContent)`
      check('★ 관계형의 대상 고르개 — 표의 아이콘이 이름 앞에 · 아이콘 없는 표는 이름만',
        await waitFor(`(() => { const t = ${optionTexts}
          return t.includes(${JSON.stringify(`${picked} ${shelfName}`)}) && t.includes(${JSON.stringify(`${pickerName} (이 표)`)}) })()`, 8000),
        JSON.stringify((await evaluate(optionTexts)).filter((t) => t.includes(String(stamp)))))

      // ⑤ teamspace 화면 — 데이터베이스 목록이 그 아이콘을 단다 · 없으면 표 글리프. 아이콘은 라우트로 단다
      const tsUrl = `${BASE}/api/workspaces/${workspaceId}/teamspaces`
      const team = (await (await fetch(tsUrl, { method: 'POST', headers: authed, body: JSON.stringify({ name: `표아이콘팀${stamp}` }) })).json()).teamspace.id
      const compassName = `나침반표${stamp}`
      const bareName = `맨표${stamp}`
      const compass = must(await dbMod.createDatabase(ctx, { name: compassName, teamspaceId: team }), '팀 표')
      const bare = must(await dbMod.createDatabase(ctx, { name: bareName, teamspaceId: team }), '팀 표')
      const viaRoute = await patchDb(compass.id, { icon: { type: 'emoji', emoji: '🧭' } })
      const viaRouteBody = await viaRoute.json().catch(() => ({}))
      check('라우트 — 아이콘만 보내면 바꾸고 그 아이콘을 돌려준다',
        viaRoute.status === 200 && viaRouteBody.database?.icon?.emoji === '🧭', JSON.stringify([viaRoute.status, viaRouteBody]))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/teamspaces/${team}` })
      const teamRow = (id) => `[data-testid="teamspace-databases"] a[href="/w/${workspaceId}/db/${id}"]`
      check('★ teamspace 화면의 데이터베이스 목록 — 아이콘을 단다 · 없으면 표 글리프(글자가 아니다)',
        await waitFor(`JSON.stringify(${rowExpr(teamRow(compass.id))}?.filter((_, i) => i !== 1)) === ${JSON.stringify(JSON.stringify(['🧭', `🧭${compassName}`]))}
          && JSON.stringify(${rowExpr(teamRow(bare.id))}) === ${JSON.stringify(glyphRow(bareName))}`, 15000),
        JSON.stringify([await evaluate(rowExpr(teamRow(compass.id))), await evaluate(rowExpr(teamRow(bare.id)))]))

      // ⑥ 잠근 표 — 아이콘은 보이고 버튼이 아니다(구조를 고칠 수 있어도) · 라우트는 409
      const lockUrl = `${dbApi(shelf.id)}/lock`
      const locked = await fetch(lockUrl, { method: 'PUT', headers: authed })
      try {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${shelf.id}` })
        check('★ 잠근 표 — 아이콘은 보이고 버튼이 아니다 · "아이콘 추가"가 없다',
          locked.ok && (await waitFor(`document.querySelector('${ICON}')?.textContent === ${JSON.stringify(picked)}
            && document.querySelector('${ICON}').tagName !== 'BUTTON'
            && document.querySelector('${ICON}').getAttribute('aria-label') === ${JSON.stringify(`데이터베이스 아이콘 ${picked}`)}
            && !document.querySelector('${ADD}')`, 15000)),
          String(await evaluate(`document.querySelector('${ICON}')?.outerHTML ?? '(없음)'`)))
        const refused = await patchDb(shelf.id, { icon: { type: 'emoji', emoji: '🔥' } })
        check('★ 라우트 — 잠근 표의 아이콘 바꾸기는 409 locked', refused.status === 409 && (await refused.json()).error === 'locked', String(refused.status))
      } finally {
        await fetch(lockUrl, { method: 'DELETE', headers: authed })
      }

      // ⑦ 볼 수만 있는 사람 — 화면은 아이콘만(버튼 · "아이콘 추가" 없음) · 라우트는 403 · 모양이 아니면 400
      const secretName = `열쇠표${stamp}`
      const secret = must(await dbMod.createDatabase(ctx, { name: secretName, privateTop: true }), '개인 표')
      const reader = await joinAs(workspaceId, await createUser(`표 아이콘 독자 ${stamp}`), 'member')
      const marked = await patchDb(secret.id, { icon: { type: 'emoji', emoji: '🗝️' } })
      const shared = await aclMod.grantAccess(ctx, secret.id, { type: 'user', id: reader.userId }, 'view')
      const asReader = { ...json, cookie: `nc_session=${reader.token}` }
      const readerHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${secret.id}`, { headers: asReader })).text()
      check('★ 볼 수만 있는 사람의 표 화면 — 아이콘은 보이고 버튼 · "아이콘 추가"가 없다',
        marked.ok && shared.ok && readerHtml.includes('aria-label="데이터베이스 아이콘 🗝️"') && !readerHtml.includes('data-testid="page-icon-add"')
          && !readerHtml.includes('aria-label="아이콘 바꾸기'),
        JSON.stringify([marked.status, shared.ok, readerHtml.length]))
      const denied = await patchDb(secret.id, { icon: { type: 'emoji', emoji: '😈' } }, asReader)
      const bad = await patchDb(shelf.id, { icon: { type: 'emoji', emoji: '📚📖' } })
      const badBody = await bad.json().catch(() => ({}))
      check('★ 라우트 — 볼 수만 있으면 403 · 두 글자는 400 invalid_icon',
        denied.status === 403 && bad.status === 400 && badBody.error === 'invalid_icon', JSON.stringify([denied.status, bad.status, badBody]))

      // ⑧ 제거 — "아이콘 추가"로 돌아오고 사이드바는 표 글리프로
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${shelf.id}` })
      check('거부한 뒤에도 아이콘은 그대로다 · 잠금을 풀면 다시 단추다',
        await waitFor(`document.querySelector('${ICON}')?.textContent === ${JSON.stringify(picked)} && document.querySelector('${ICON}').tagName === 'BUTTON'`, 15000),
        String(await headerIcon()))
      await clickSelector(ICON)
      await waitFor(`!!document.querySelector('[data-testid="page-icon-remove"]')`, 8000)
      await clickSelector('[data-testid="page-icon-remove"]')
      check('★ 제거하면 "아이콘 추가"로 돌아온다', await waitFor(`!document.querySelector('${ICON}') && !!document.querySelector('${ADD}')`, 5000))
      check('★ 사이드바는 표 글리프로 돌아온다', await waitFor(`JSON.stringify(${rowExpr(TREE_ROW)}) === ${JSON.stringify(glyphRow(shelfName))}`, 8000),
        JSON.stringify(await treeRow()))
      await sleep(500)
    }

    if (sectionIf('이미지 아이콘 (8c-4 · F-02-05)')) {
      // 고르개의 "이미지" 탭 — 파일을 올리거나(이미지 블록과 같은 업로드 길) 이미지 주소를 넣는다. 고른 이미지가 머리 · 사이드바 · 부모 본문의
      // 하위 페이지 블록(노드 뷰의 DOM)에 선다. 올린 파일은 그 파일의 참조다(`ref_count`). 불러오지 못한 이미지는 기본 글리프로 바뀐다.
      // 데이터베이스 아이콘도 같다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const { query: dbQuery } = await import(src('db/pool.ts'))
      const dbMod = await import(src('database/database.ts'))
      const aclMod = await import(src('permissions/acl.ts'))
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const patchIcon = (page, icon, headers = authed) => fetch(`${pagesUrl}/${page}`, { method: 'PATCH', headers, body: JSON.stringify({ icon }) })
      const parentTitle = `이미지아이콘부모${stamp}`
      const pageTitle = `이미지아이콘${stamp}`
      const parent = await post({ title: parentTitle })
      const page = await post({ title: pageTitle, parentPageId: parent })
      const seeded = await patchIcon(page, { type: 'emoji', emoji: '🌱' })
      const iconPng = join(profile, 'e2e-icon.png')
      writeFileSync(iconPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
      // 외부 주소 — 앱이 내놓는 정적 파일을 절대 주소로(이 PC 의 헤드리스 브라우저는 바깥 망을 믿지 않는다). 받는 쪽에서는 그냥 http 주소다.
      const linkUrl = `${BASE}/globe.svg`
      // id 가 uuid 가 아니면(앞 장면이 떨어져 아이콘이 파일이 아니다) 던지지 않고 -1 — 한 장면이 떨어져도 뒤의 검사가 돈다.
      const refCountOf = async (fileId) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)
          ? Number((await dbQuery(`SELECT ref_count FROM file WHERE id = $1`, [fileId]))[0]?.ref_count ?? -1)
          : -1

      const ICON = '[data-testid="page-icon"]'
      const ADD = '[data-testid="page-icon-add"]'
      const PICKER = '[data-testid="emoji-picker"]'
      /** 머리 아이콘이 가리키는 것 — 이미지면 `data-page-icon`, 이모지면 그 글자. */
      const headerKey = () =>
        evaluate(`(() => { const b = document.querySelector('${ICON}'); if (!b) return null
          const i = b.querySelector('[data-page-icon]'); return i ? i.getAttribute('data-page-icon') : b.textContent })()`)
      const treeLink = (id, prefix = '') => `nav[aria-label="페이지 트리"] a[href="/w/${workspaceId}/${prefix}${id}"]`
      const keyIn = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null)`
      /** 그 자리의 아이콘이 이미지이고 실제로 디코드됐는가. */
      const decodedIn = (sel) => `(() => { const i = document.querySelector(${JSON.stringify(sel)})?.querySelector('img[data-page-icon]')
        return !!i && i.complete && i.naturalWidth > 0 })()`
      // 하이드레이션 전의 클릭은 사라진다(§6 — 서버가 그린 머리의 단추) — 고르개가 설 때까지 다시 누른다.
      const openPicker = async () => {
        for (let tries = 0; tries < 6; tries += 1) {
          await clickSelector(ICON)
          if (await waitFor(`!!document.querySelector('${PICKER}')`, 2000)) return true
        }
        return false
      }
      const openImageTab = async () => {
        await openPicker()
        await waitFor(`!!document.querySelector('${PICKER} [data-testid="icon-tab-image"]')`, 8000)
        await clickSelector('[data-testid="icon-tab-image"]')
        return waitFor(`!!document.querySelector('[data-testid="icon-image-panel"]')`, 3000)
      }

      // ① 파일 올리기 — 머리 · 사이드바가 그 이미지를 그리고, 파일의 참조가 하나다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      check('전제 — 이모지 아이콘인 페이지', seeded.ok && (await waitFor(`document.querySelector('${ICON}')?.textContent === '🌱'`, 15000)))
      check('★ 고르개의 "이미지" 탭 — 파일 올리기 · 이미지 주소', await openImageTab(),
        String(await evaluate(`document.querySelector('${PICKER}')?.textContent ?? '(없음)'`)))
      await send('DOM.enable')
      const docRoot = (await send('DOM.getDocument', { depth: -1 })).root.nodeId
      const uploadNode = (await send('DOM.querySelector', { nodeId: docRoot, selector: '[data-testid="icon-upload-input"]' })).nodeId
      await send('DOM.setFileInputFiles', { files: [iconPng], nodeId: uploadNode })
      check('★ 파일을 고르면 올라가고 머리의 아이콘이 그 이미지가 된다 — 고르개는 닫힌다',
        await waitFor(`!document.querySelector('${PICKER}') && (document.querySelector('${ICON} img[data-page-icon]')?.getAttribute('data-page-icon') ?? '').startsWith('file:')`, 15000),
        String(await headerKey()))
      const uploadedKey = String(await headerKey())
      const fileId = uploadedKey.slice('file:'.length)
      check('★ 머리의 이미지가 실제로 디코드된다(세션으로 인증되는 파일 경로)', await waitFor(decodedIn(ICON), 8000),
        String(await evaluate(`document.querySelector('${ICON} img')?.src ?? '(없음)'`)))
      // 화면은 아이콘을 먼저 바꾸고 저장한다 — 서버가 받을 때까지 기다린다.
      let held = -1
      for (let i = 0; i < 30 && held !== 1; i += 1) {
        held = await refCountOf(fileId)
        if (held !== 1) await sleep(150)
      }
      check('★ 올린 파일의 참조가 하나다(아이콘이 그 파일을 가리킨다)', held === 1, String(held))
      check('★ 사이드바의 그 줄도 같은 이미지를 그린다',
        await waitFor(`${keyIn(treeLink(page))} === ${JSON.stringify(uploadedKey)} && ${decodedIn(treeLink(page))}`, 8000),
        String(await evaluate(keyIn(treeLink(page)))))

      // ② 부모 본문의 하위 페이지 블록 — 노드 뷰(DOM)가 같은 이미지를 그린다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${parent}` })
      const REF = `.blk-editor [data-block-id="${page}"] .blk-page-link`
      const refKey = `(document.querySelector(${JSON.stringify(REF)})?.querySelector('[data-page-icon]')?.getAttribute('data-page-icon') ?? null)`
      check('★ 부모 본문의 하위 페이지 블록이 그 이미지를 그린다(노드 뷰 — 파일 경로)',
        await waitFor(`${refKey} === ${JSON.stringify(uploadedKey)} && ${decodedIn(REF)}`, 15000),
        String(await evaluate(refKey)))

      // ③ 이미지 주소 — 안전하지 않은 주소는 말하고 그대로 · http 주소는 아이콘이 된다(남의 서버에 우리 주소를 알리지 않는다)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      await waitFor(`!!document.querySelector('${ICON} img')`, 15000)
      await openImageTab()
      await clickSelector('[data-testid="icon-link-input"]')
      // 고르개는 검색칸의 포커스를 지키려고 바깥 누르기를 막는다 — 주소 칸은 막으면 안 된다(누르고 곧바로 쓴다).
      check('★ 이미지 주소 칸을 누르면 그 칸에 쓴다(고르개가 포커스를 막지 않는다)',
        await waitFor(`document.activeElement === document.querySelector('[data-testid="icon-link-input"]')`, 2000),
        String(await evaluate('document.activeElement?.outerHTML?.slice(0, 80) ?? null')))
      await typeText('javascript:alert(1)')
      await clickSelector('[data-testid="icon-link-submit"]')
      check('★ 안전하지 않은 주소는 거절을 말하고 아이콘은 그대로다',
        (await waitFor(`!!document.querySelector('[data-testid="icon-image-error"]')`, 3000)) && (await headerKey()) === uploadedKey,
        JSON.stringify([await evaluate(`document.querySelector('[data-testid="icon-image-error"]')?.textContent ?? null`), await headerKey()]))
      // 거절한 뒤의 포커스는 "넣기" 단추에 있다 — 입력칸을 다시 누르고 고친다(`select()` 는 포커스를 옮기지 않는다).
      await clickSelector('[data-testid="icon-link-input"]')
      await evaluate(`document.querySelector('[data-testid="icon-link-input"]')?.select()`)
      await typeText(linkUrl)
      await key('Enter')
      check('★ 이미지 주소를 넣으면 그 주소가 아이콘이 된다 — referrer 를 보내지 않는다',
        await waitFor(`(async () => { const i = document.querySelector('${ICON} img'); return !!i && i.getAttribute('src') === ${JSON.stringify(linkUrl)}
          && i.referrerPolicy === 'no-referrer' && (await i.decode().then(() => true, () => false)) })()`, 10000),
        String(await evaluate(`document.querySelector('${ICON}')?.innerHTML?.slice(0, 200) ?? '(없음)'`)))
      let released = -1
      for (let i = 0; i < 30 && released !== 0; i += 1) {
        released = await refCountOf(fileId)
        if (released !== 0) await sleep(150)
      }
      check('★ 올린 파일 아이콘을 바꾸면 그 파일의 참조가 내려간다', released === 0, String(released))

      // ④ 불러오지 못한 이미지 — 깨진 그림 대신 기본 글리프(사이드바) · 머리의 단추가 비지 않는다
      const broken = await patchIcon(page, { type: 'external', url: 'http://127.0.0.1:9/broken-icon.png' })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      check('★ 불러오지 못한 이미지는 기본 글리프로 바뀐다 — 사이드바 · 머리',
        broken.ok && (await waitFor(`${keyIn(treeLink(page))} === '' && !!document.querySelector('${ICON} svg[data-page-icon=""]')`, 15000)),
        JSON.stringify([await evaluate(keyIn(treeLink(page))), await evaluate(`document.querySelector('${ICON}')?.innerHTML?.slice(0, 120) ?? null`)]))

      // ⑤ 데이터베이스 아이콘 — 같은 파일을 라우트로 · 머리 · 사이드바
      const table = await dbMod.createDatabase(ctx, { name: `이미지아이콘표${stamp}` })
      const dbPatched = table.ok
        ? await fetch(`${BASE}/api/workspaces/${workspaceId}/databases/${table.value.id}`, {
            method: 'PATCH', headers: authed, body: JSON.stringify({ icon: { type: 'file', file_id: fileId } }),
          })
        : null
      check('데이터베이스 아이콘도 올린 파일을 받고 참조를 센다', dbPatched?.ok === true && (await refCountOf(fileId)) === 1,
        JSON.stringify([dbPatched?.status, await refCountOf(fileId)]))
      if (table.ok) {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${table.value.id}` })
        check('★ 데이터베이스 머리 · 사이드바가 그 이미지를 그린다',
          await waitFor(`${decodedIn(ICON)} && ${keyIn(treeLink(table.value.id, 'db/'))} === ${JSON.stringify(uploadedKey)} && ${decodedIn(treeLink(table.value.id, 'db/'))}`, 15000),
          JSON.stringify([await headerKey(), await evaluate(keyIn(treeLink(table.value.id, 'db/')))]))
      }

      // ⑥ 라우트 — 이 워크스페이스에 없는 파일은 400 · 볼 수만 있는 사람은 보기만 한다
      const missing = await patchIcon(page, { type: 'file', file_id: randomUUID() })
      const missingBody = await missing.json().catch(() => ({}))
      check('★ 라우트 — 없는 파일 아이콘은 400 invalid_icon', missing.status === 400 && missingBody.error === 'invalid_icon',
        JSON.stringify([missing.status, missingBody]))
      const secret = await post({ title: `이미지아이콘읽기${stamp}`, privateTop: true })
      const marked = await patchIcon(secret, { type: 'file', file_id: fileId })
      const reader = await joinAs(workspaceId, await createUser(`이미지 아이콘 독자 ${stamp}`), 'member')
      const shared = await aclMod.grantAccess(ctx, secret, { type: 'user', id: reader.userId }, 'view')
      const readerHtml = await (await fetch(`${BASE}/w/${workspaceId}/${secret}`, { headers: { ...json, cookie: `nc_session=${reader.token}` } })).text()
      const readerImg = await fetch(`${BASE}/api/workspaces/${workspaceId}/files/${fileId}/content`, { headers: { cookie: `nc_session=${reader.token}` } })
      check('★ 볼 수만 있는 사람 — 아이콘(이미지)은 보이고 단추가 아니다 · 그 파일을 받는다',
        marked.ok && shared.ok && readerHtml.includes('aria-label="페이지 아이콘 올린 이미지"') && readerHtml.includes(`/files/${fileId}/content`)
          && !readerHtml.includes('data-testid="page-icon-add"') && readerImg.status === 200,
        JSON.stringify([marked.status, shared.ok, readerHtml.includes('올린 이미지'), readerImg.status]))

      // ⑦ 제거 — 이미지 아이콘도 고르개에서 지운다
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      await waitFor(`!!document.querySelector('${ICON}')`, 15000)
      await openPicker()
      await waitFor(`!!document.querySelector('[data-testid="page-icon-remove"]')`, 8000)
      await clickSelector('[data-testid="page-icon-remove"]')
      check('★ 이미지 아이콘도 제거하면 "아이콘 추가"로 돌아온다', await waitFor(`!document.querySelector('${ICON}') && !!document.querySelector('${ADD}')`, 5000),
        JSON.stringify([await evaluate(`document.querySelector('${ICON}')?.outerHTML?.slice(0, 160) ?? null`), await evaluate(`!!document.querySelector('${PICKER}')`),
          await evaluate(`document.querySelector('[role="alert"]')?.textContent ?? null`)]))
      await sleep(500)
    }

    if (sectionIf('버전 기록 (8d-1 · F-11-01)')) {
      // 본문을 고치는 길은 협업 서버다 — 그 쓰기도 본문 세션을 지나므로 버전 판정이 그 페이지의 잠금 안에서 돈다(`history/record.ts`).
      // 2분 쉰 뒤의 첫 쓰기 · 목록 열기가 그 세션의 버전을 남긴다. 시각은 로그의 created_at 을 뒤로 밀어 흉내 낸다. 기록 화면은 다음
      // 조각(8d-2)이다 — 여기서는 라우트를 본다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const { query: dbQuery } = await import(src('db/pool.ts'))
      const aclMod = await import(src('permissions/acl.ts'))
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const page = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `버전기록${stamp}`, privateTop: true }) })).json()).page.id
      const versionsUrl = `${pagesUrl}/${page}/versions`
      const getJson = async (url, headers = authed) => {
        const res = await fetch(url, { headers })
        return { status: res.status, body: await res.json().catch(() => ({})) }
      }
      const age = (by) => dbQuery(`UPDATE doc_update SET created_at = created_at - $2::interval WHERE page_id = $1`, [page, by])
      const textOf = (doc) => (doc?.blocks ?? []).map((b) => (b.title ?? []).map((r) => r.plain_text ?? r.text?.content ?? '').join('')).join('|')
      /** 친 글이 모두 서버에 닿을 때까지 — 행 투영(1s 창)에 그 글이 들어오면 그 앞의 update 는 모두 로그에 있다. */
      const storedHas = async (text, ms = 15000) => {
        const end = Date.now() + ms
        for (;;) {
          if (textOf((await readBody(page)).doc).includes(text)) return true
          if (Date.now() > end) return false
          await sleep(200)
        }
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      await waitFor(`document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      await click((await rect('.blk-editor')).x + 40, (await rect('.blk-editor')).y + 10)
      await typeText('첫 세션의 글')
      check('전제 — 친 글이 협업 서버를 지나 서버에 닿았다', await storedHas('첫 세션의 글'))
      const fresh = await getJson(versionsUrl)
      check('★ 방금 고친 세션은 아직 버전이 아니다(2분 쉬지 않았다)', fresh.status === 200 && fresh.body.versions?.length === 0, JSON.stringify(fresh))

      // ① 2분 쉰 것처럼 — 다음에 친 글(협업 서버의 쓰기)이 쓰기 전의 상태를 남긴다.
      await age('3 minutes')
      await typeText(' 쉰 뒤')
      check('전제 — 쉰 뒤에 친 글도 서버에 닿았다', await storedHas('쉰 뒤'))
      const listed = await getJson(versionsUrl)
      const first = listed.body.versions?.[0]
      check('★ 쉰 뒤의 첫 쓰기(협업 서버의 길)가 쓰기 전의 상태를 버전으로 남긴다 — 고친 사람은 나',
        listed.body.versions?.length === 1 && first.reason === 'idle' && first.editors?.length === 1 && first.editors[0].id === ctx.userId,
        JSON.stringify(listed.body))
      const preview = first ? await getJson(`${versionsUrl}/${first.id}`) : null
      check('★ 미리보기는 그 버전의 본문이다 — 쉰 뒤에 친 글은 없다', textOf(preview?.body?.doc) === '첫 세션의 글',
        JSON.stringify([preview?.status, textOf(preview?.body?.doc)]))

      // ② 목록 열기도 판정한다 — 아무도 쓰지 않아도 끝난 세션이 선다.
      await age('3 minutes')
      const opened = await getJson(versionsUrl)
      const latest = opened.body.versions?.[0]
      const latestPreview = latest ? await getJson(`${versionsUrl}/${latest.id}`) : null
      check('★ 목록을 열면 끝난 세션이 버전으로 선다(쓰지 않아도) — 최신순',
        opened.body.versions?.length === 2 && opened.body.versions[1].id === first?.id && textOf(latestPreview?.body?.doc) === '첫 세션의 글 쉰 뒤',
        JSON.stringify([opened.body.versions?.map((v) => v.reason), textOf(latestPreview?.body?.doc)]))

      // ③ 누가 — 볼 수만 있으면 403 · 볼 수 없으면 404 · 지난 버전은 410
      const viewer = await joinAs(workspaceId, await createUser(`버전 보기만 ${stamp}`), 'member')
      const stranger = await joinAs(workspaceId, await createUser(`버전 못 봄 ${stamp}`), 'member')
      const shared = await aclMod.grantAccess(ctx, page, { type: 'user', id: viewer.userId }, 'view')
      const asViewer = await getJson(versionsUrl, { ...json, cookie: `nc_session=${viewer.token}` })
      const asStranger = await getJson(versionsUrl, { ...json, cookie: `nc_session=${stranger.token}` })
      check('★ 라우트 — 볼 수만 있으면 403 · 볼 수 없으면 404',
        shared.ok && asViewer.status === 403 && asViewer.body.error === 'forbidden' && asStranger.status === 404,
        JSON.stringify([asViewer.status, asStranger.status]))
      await dbQuery(`UPDATE page_version SET expires_at = now() - interval '1 second' WHERE id = $1`, [first?.id])
      const gone = first ? await getJson(`${versionsUrl}/${first.id}`) : null
      const afterGone = await getJson(versionsUrl)
      check('★ 보관 기간이 지난 버전은 목록에 없고 열면 410',
        gone?.status === 410 && gone.body.error === 'expired' && afterGone.body.versions?.length === 1,
        JSON.stringify([gone?.status, afterGone.body.versions?.length]))
      await sleep(300)
    }

    if (sectionIf('기록 화면 (8d-2 · F-11-01)')) {
      // 머리의 "기록" — 버전 목록(최신순 · 시각 · 고친 사람)과 고른 버전의 읽기 전용 미리보기. 준비는 서버 명령으로 한다: 본문을 세 번
      // 저장하며 로그의 시각을 밀어 버전 둘을 만든다(2분 쉰 뒤의 첫 쓰기가 쓰기 전의 상태를 남긴다 — 8d-1). 둘째 버전은 다른 페이지를
      // 멘션한다 — 미리보기가 그 이름 · 아이콘을 지금의 권한으로 거른 맵에서 그리는지 본다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const { query: dbQuery } = await import(src('db/pool.ts'))
      const aclMod = await import(src('permissions/acl.ts'))
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const page = await post({ title: `기록화면${stamp}`, privateTop: true })
      const targetTitle = `멘션된곳${stamp}`
      const target = await post({ title: targetTitle })
      await fetch(`${pagesUrl}/${target}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ icon: { type: 'emoji', emoji: '🧭' } }) })
      const age = () => dbQuery(`UPDATE doc_update SET created_at = created_at - interval '3 minutes' WHERE page_id = $1`, [page])
      await saveBody(page, { blocks: [block(randomUUID(), 'paragraph', '첫 버전 글')] })
      await age()
      await saveBody(page, {
        blocks: [
          block(randomUUID(), 'paragraph', '둘째 버전 글'),
          { id: randomUUID(), type: 'paragraph', title: [textRun('참고 '), pageMentionRun(target)], properties: {}, format: {}, children: [] },
        ],
      })
      await age()
      await saveBody(page, { blocks: [block(randomUUID(), 'paragraph', '지금 글')] })
      const made = (await dbQuery(`SELECT count(*)::int AS n FROM page_version WHERE page_id = $1`, [page]))[0].n

      const DIALOG = '[data-testid="page-history"]'
      const ITEMS = `${DIALOG} [data-testid="page-history-item"]`
      const PREVIEW = `${DIALOG} [data-testid="version-preview"] .blk-editor`
      const previewText = () => evaluate(`document.querySelector('${PREVIEW}')?.textContent ?? null`)
      // 하이드레이션 전의 클릭은 사라진다(§6) — 창이 설 때까지 다시 누른다.
      const openHistory = async () => {
        for (let tries = 0; tries < 6; tries += 1) {
          await clickSelector('[data-testid="page-history-open"]')
          if (await waitFor(`!!document.querySelector('${DIALOG}')`, 2000)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      await waitFor(`!!document.querySelector('[data-testid="page-history-open"]')`, 15000)
      check('전제 — 버전 둘을 만들었다', made === 2, String(made))
      check('★ 머리의 "기록"을 누르면 기록 창이 열린다', await openHistory())
      const newestFirst = (await dbQuery(`SELECT id FROM page_version WHERE page_id = $1 ORDER BY through_seq DESC`, [page])).map((r) => r.id)
      const ownerName = (await dbQuery(`SELECT name FROM "user" WHERE id = $1`, [ctx.userId]))[0]?.name ?? ''
      check('★ 목록은 최신순 · 시각(오늘) · 고친 사람의 이름 — 가장 최근 것을 골라 둔다',
        ownerName !== '' && (await waitFor(`(() => { const items = [...document.querySelectorAll('${ITEMS}')]
          return JSON.stringify(items.map((b) => b.dataset.versionId)) === ${JSON.stringify(JSON.stringify(newestFirst))}
            && items.every((b) => b.textContent.startsWith('오늘 ') && b.textContent.includes(${JSON.stringify(ownerName)}))
            && items[0].getAttribute('aria-current') === 'true' })()`, 8000)),
        String(await evaluate(`[...document.querySelectorAll('${ITEMS}')].map((b) => b.textContent).join(' | ')`)))
      check('★ 처음에는 가장 최근 버전을 보여 준다 — 그 시점의 본문(지금 글은 없다) · 읽기 전용',
        await waitFor(`(document.querySelector('${PREVIEW}')?.textContent ?? '').includes('둘째 버전 글')
          && !document.querySelector('${PREVIEW}').textContent.includes('지금 글')
          && document.querySelector('${PREVIEW}').getAttribute('contenteditable') === 'false'`, 8000),
        String(await previewText()))
      const chip = `${PREVIEW} .blk-mention-page`
      check('★ 미리보기의 멘션은 지금의 권한으로 거른 이름 · 아이콘을 그린다',
        await waitFor(`(document.querySelector('${chip}')?.textContent ?? '').includes(${JSON.stringify(targetTitle)})
          && document.querySelector('${chip} [data-page-icon]')?.getAttribute('data-page-icon') === '🧭'`, 5000),
        String(await evaluate(`document.querySelector('${chip}')?.outerHTML?.slice(0, 200) ?? '(없음)'`)))
      await clickSelector(`${DIALOG} li:nth-child(2) [data-testid="page-history-item"]`)
      check('★ 다른 버전을 고르면 그 본문으로 바뀐다',
        await waitFor(`(document.querySelector('${PREVIEW}')?.textContent ?? '') === '첫 버전 글'
          && document.querySelectorAll('${ITEMS}')[1].getAttribute('aria-current') === 'true'`, 8000),
        String(await previewText()))
      await key('Escape')
      check('★ Esc 로 닫고 포커스는 "기록" 단추로 돌아간다 · 본문은 그대로다',
        await waitFor(`!document.querySelector('${DIALOG}') && document.activeElement?.getAttribute('data-testid') === 'page-history-open'
          && (document.querySelector('.blk-editor')?.textContent ?? '').includes('지금 글')`, 5000),
        JSON.stringify([await evaluate(`!!document.querySelector('${DIALOG}')`), await evaluate('document.activeElement?.outerHTML?.slice(0, 80) ?? null')]))

      // 버전이 없는 페이지 — 빈 상태를 말한다.
      const blank = await post({ title: `기록없음${stamp}` })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${blank}` })
      await waitFor(`!!document.querySelector('[data-testid="page-history-open"]')`, 15000)
      await openHistory()
      check('★ 버전이 없으면 "아직 기록된 버전이 없습니다"', await waitFor(`!!document.querySelector('[data-testid="page-history-empty"]')`, 8000))
      await clickSelector('[data-testid="page-history-close"]')
      check('닫기 단추로도 닫는다', await waitFor(`!document.querySelector('${DIALOG}')`, 3000))

      // 볼 수만 있는 사람 — 단추가 없다(서버도 403 — 8d-1).
      const viewer = await joinAs(workspaceId, await createUser(`기록 보기만 ${stamp}`), 'member')
      const shared = await aclMod.grantAccess(ctx, page, { type: 'user', id: viewer.userId }, 'view')
      const viewerHtml = await (await fetch(`${BASE}/w/${workspaceId}/${page}`, { headers: { ...json, cookie: `nc_session=${viewer.token}` } })).text()
      check('★ 볼 수만 있는 사람에게는 "기록" 단추가 없다',
        shared.ok && viewerHtml.includes('기록화면') && !viewerHtml.includes('data-testid="page-history-open"'),
        JSON.stringify([shared.ok, viewerHtml.length]))
      await sleep(300)
    }

    if (sectionIf('되돌리기 (8d-3 · F-11-02)')) {
      // 기록 창에서 고른 버전으로 되돌린다 — 한 번 더 묻고, 되돌리면 **열린 본문 편집기가 협업 서버가 퍼뜨린 update 로 따라온다**. 되돌리기
      // 전의 상태도 버전으로 남아 그것을 다시 되돌리면 취소다. 하위 페이지는 지금 그대로다(버전 뒤에 만든 자식이 남는다). 잠긴 페이지는
      // 되돌리기가 없다. 준비는 서버 명령으로 한다(로그의 시각을 밀어 버전을 만든다). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const { query: dbQuery } = await import(src('db/pool.ts'))
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const page = await post({ title: `되돌리기${stamp}`, privateTop: true })
      const age = () => dbQuery(`UPDATE doc_update SET created_at = created_at - interval '3 minutes' WHERE page_id = $1`, [page])
      await saveBody(page, { blocks: [block(randomUUID(), 'paragraph', '옛 글')] })
      await age()
      // 버전 뒤에 만든 자식 — 그 쓰기(부모 본문에 참조)가 여는 순간의 판정으로 '옛 글' 버전을 남긴다.
      const childTitle = `되돌리기자식${stamp}`
      const child = await post({ title: childTitle, parentPageId: page })
      const refBlock = { id: child, type: 'page', title: [], properties: {}, format: {}, children: [] }
      await saveBody(page, { blocks: [block(randomUUID(), 'paragraph', '지금 글'), refBlock] })
      const versionCount = async () => (await dbQuery(`SELECT count(*)::int AS n FROM page_version WHERE page_id = $1`, [page]))[0].n

      const DIALOG = '[data-testid="page-history"]'
      const ITEMS = `${DIALOG} [data-testid="page-history-item"]`
      const PREVIEW = `${DIALOG} [data-testid="version-preview"] .blk-editor`
      const LIVE = '.blk-editor[aria-label="페이지 본문"]'
      const liveText = () => evaluate(`document.querySelector('${LIVE}')?.textContent ?? null`)
      const openHistory = async () => {
        for (let tries = 0; tries < 6; tries += 1) {
          await clickSelector('[data-testid="page-history-open"]')
          if (await waitFor(`!!document.querySelector('${DIALOG}')`, 2000)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      await waitFor(`(document.querySelector('${LIVE}')?.textContent ?? '').includes('지금 글') && document.querySelector('${LIVE}').getAttribute('contenteditable') === 'true'`, 15000)
      check('전제 — 버전 하나(옛 글) · 지금 본문은 지금 글 + 자식', (await versionCount()) === 1 && String(await liveText()).includes(childTitle),
        JSON.stringify([await versionCount(), await liveText()]))
      await openHistory()
      await waitFor(`(document.querySelector('${PREVIEW}')?.textContent ?? '') === '옛 글'`, 8000)
      check('★ 고칠 수 있으면 미리보기에 "이 버전으로 되돌리기"가 선다', await waitFor(`!!document.querySelector('[data-testid="version-restore"]')`, 5000))
      await clickSelector('[data-testid="version-restore"]')
      check('★ 누르면 한 번 더 묻는다 — 되돌리기 단추에 포커스', await waitFor(`!!document.querySelector('[data-testid="version-restore-ask"]')
        && document.activeElement?.getAttribute('data-testid') === 'version-restore-confirm'`, 3000))
      await clickSelector('[data-testid="version-restore-confirm"]')
      check('★ 되돌리면 열린 본문 편집기가 그 버전으로 바뀐다(협업 서버가 퍼뜨린 update) — 버전 뒤에 만든 자식은 남는다',
        await waitFor(`(() => { const t = document.querySelector('${LIVE}')?.textContent ?? ''
          return t.startsWith('옛 글') && !t.includes('지금 글') && t.includes(${JSON.stringify(childTitle)}) })()`, 15000),
        String(await liveText()))
      check('★ 목록을 다시 읽어 되돌린 버전을 고른다 — 그 위에 "○○ 버전에서 되돌림", 다음이 "되돌리기 전"',
        await waitFor(`(() => { const items = [...document.querySelectorAll('${ITEMS}')]
          const reasons = items.map((b) => b.querySelector('[data-testid="page-history-reason"]')?.textContent ?? '')
          return items.length === 3 && items[0].getAttribute('aria-current') === 'true' && reasons[0].endsWith('버전에서 되돌림') && reasons[1] === '되돌리기 전' && reasons[2] === '' })()`, 8000),
        String(await evaluate(`[...document.querySelectorAll('${ITEMS}')].map((b) => b.textContent).join(' | ')`)))
      check('되돌렸다고 말한다', await waitFor(`(document.querySelector('[data-testid="version-restore-notice"]')?.textContent ?? '').startsWith('되돌렸습니다')`, 3000))

      // 같은 내용 — 지금과 같은 버전(방금 되돌린 버전)을 다시 되돌리면 아무것도 쓰지 않는다.
      const before = await versionCount()
      await clickSelector('[data-testid="version-restore"]')
      await waitFor(`!!document.querySelector('[data-testid="version-restore-confirm"]')`, 3000)
      await clickSelector('[data-testid="version-restore-confirm"]')
      check('★ 지금과 같은 버전으로 되돌리면 "바꾼 것이 없다"고 말하고 아무것도 쓰지 않는다',
        (await waitFor(`(document.querySelector('[data-testid="version-restore-notice"]')?.textContent ?? '').startsWith('지금 본문과 같습니다')`, 8000))
          && (await versionCount()) === before,
        JSON.stringify([await evaluate(`document.querySelector('[data-testid="version-restore-notice"]')?.textContent ?? null`), before, await versionCount()]))

      // 되돌리기 취소 — "되돌리기 전"을 다시 되돌린다.
      await clickSelector(`${DIALOG} li:nth-child(2) [data-testid="page-history-item"]`)
      await waitFor(`(document.querySelector('${PREVIEW}')?.textContent ?? '').startsWith('지금 글')`, 8000)
      await clickSelector('[data-testid="version-restore"]')
      await waitFor(`!!document.querySelector('[data-testid="version-restore-confirm"]')`, 3000)
      await clickSelector('[data-testid="version-restore-confirm"]')
      check('★ "되돌리기 전"을 되돌리면 원래대로 — 열린 본문도 따라온다',
        await waitFor(`(() => { const t = document.querySelector('${LIVE}')?.textContent ?? ''
          return t.startsWith('지금 글') && !t.includes('옛 글') && t.includes(${JSON.stringify(childTitle)}) })()`, 15000),
        String(await liveText()))
      await key('Escape')
      await waitFor(`!document.querySelector('${DIALOG}')`, 3000)

      // 잠긴 페이지 — 기록은 보지만 되돌리기는 없다.
      const locked = await fetch(`${pagesUrl}/${page}/lock`, { method: 'PUT', headers: authed })
      try {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
        await waitFor(`!!document.querySelector('[data-testid="page-history-open"]')`, 15000)
        await openHistory()
        check('★ 잠긴 페이지 — 기록은 보이고 "되돌리기"는 없다',
          locked.ok && (await waitFor(`!!document.querySelector('${PREVIEW}')`, 8000)) && !(await evaluate(`!!document.querySelector('[data-testid="version-restore"]')`)),
          String(locked.status))
        await key('Escape')
      } finally {
        await fetch(`${pagesUrl}/${page}/lock`, { method: 'DELETE', headers: authed })
      }
      await sleep(300)
    }

    if (sectionIf('코멘트 패널 · 인박스 (F-05-08 · F-11-07)')) {
      const commentPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({ title: `코멘트 대상 ${Date.now()}` }),
      })).json()).page.id

      /**
       * 컨테이너 **안에서** 글자가 정확히 같은 버튼을 누른다.
       *
       * `clickText` 는 `includes` 라 "해결"이 필터의 "해결됨"을, "읽음"이 필터의 "안 읽음"을 먼저 잡는다 — 실제로
       * 그래서 처음 돌렸을 때 필터만 눌리고 아무것도 해결되지 않았다. 탭과 동작 버튼은 컨테이너가 다르므로
       * 그것으로 가른다.
       */
      const clickIn = async (container, text, selector = 'button') => {
        const box = await evaluate(`(() => {
          const root = document.querySelector(${JSON.stringify(container)})
          if (!root) return null
          const el = [...root.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})
          if (!el) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (!box) return false
        await click(box.x, box.y)
        await sleep(150)
        return true
      }
      const THREAD = 'article[aria-label="코멘트 스레드"]'
      const PANEL_FILTER = '[role="group"][aria-label="코멘트 필터"]'
      const INBOX_FILTER = '[role="group"][aria-label="인박스 필터"]'
      // `li` 로 잡으면 사이드바 트리의 첫 `li` 가 걸린다 — 목록에 이름을 붙여 거기서만 찾는다.
      const INBOX_LIST = 'ul[aria-label="알림 목록"]'
      // ⚠ 패널의 글은 **입력칸을 빼고** 읽는다. React 는 제어되는 `<textarea>` 의 값을 `defaultValue` 에도 써서 친 글이
      //   `textContent` 에 들어간다 — 그대로 읽으면 "남기기"를 누른 직후(요청이 가는 동안) 입력칸의 글이 스레드로 보인 것처럼
      //   통과하고, 곧바로 누른 "답글"이 아직 없는 스레드를 찾다 실패한다. 서버가 느릴 때만 난다(7c-2 에서 겪었다).
      const PANEL_TEXT = `(() => {
        const d = document.querySelector('[role="dialog"][aria-label="코멘트"]')
        if (!d) return null
        const c = d.cloneNode(true)
        c.querySelectorAll('textarea').forEach((t) => t.remove())
        return c.textContent
      })()`
      const commentPanel = async () => (await evaluate(PANEL_TEXT)) ?? '(패널 없음)'
      const panelHas = (text, ms = 8000) => waitFor(`(${PANEL_TEXT} ?? '').includes(${JSON.stringify(text)})`, ms)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${commentPage}` })
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('코멘트'))`, 15000)

      // ① 페이지에 코멘트를 남긴다.
      check('코멘트 버튼이 있다', await clickText('코멘트'))
      check('빈 상태를 말해 준다', await panelHas('아직 코멘트가 없습니다'), await commentPanel())
      check('새 코멘트 입력칸에 쓴다', await clickSelector('textarea[aria-label="새 코멘트"]'))
      await typeText('이 문단 근거가 뭔가요')
      check('코멘트를 남긴다', await clickText('코멘트 남기기'))
      check('★ 남긴 코멘트가 스레드로 보인다', await panelHas('이 문단 근거가 뭔가요'), await commentPanel())

      // ② 답글.
      check('답글 버튼을 누른다', await clickIn(THREAD, '답글'))
      check('답글 입력칸에 쓴다', await clickSelector('textarea[aria-label="답글"]'))
      await typeText('출처를 붙이겠습니다')
      check('답글을 남긴다', await clickIn(THREAD, '답글 남기기'))
      check('★ 답글이 같은 스레드에 붙는다', await panelHas('출처를 붙이겠습니다'), await commentPanel())

      // ③ 지운 코멘트는 자리만 남는다(D3) — 내용이 화면에서 사라진다.
      check('내 코멘트를 지운다', await clickIn(THREAD, '지우기'))
      check('★ 지운 자리는 "삭제된 코멘트"로 남는다', await panelHas('삭제된 코멘트'), await commentPanel())
      check('★ 지운 글은 화면에 남지 않는다', !(await commentPanel()).includes('이 문단 근거가 뭔가요'), await commentPanel())

      // ④ 해결하면 열림 목록에서 빠지고 해결됨에서 보인다.
      check('해결을 누른다', await clickIn(THREAD, '해결'))
      check('★ 해결한 스레드는 열림 목록에서 빠진다',
        await waitFor(
          `(document.querySelector('[role="dialog"][aria-label="코멘트"]')?.textContent ?? '').includes('아직 코멘트가 없습니다')`,
          8000,
        ),
        await commentPanel())
      check('해결됨 필터를 누른다', await clickIn(PANEL_FILTER, '해결됨'))
      check('★ 해결됨에서는 보인다', await panelHas('출처를 붙이겠습니다'), await commentPanel())
      check('다시 열 수 있다', await clickIn(THREAD, '다시 열기'))

      // ⑤ 다른 사람이 코멘트를 달면 인박스로 온다 — 알림은 자기 글에는 오지 않으므로 동료가 필요하다.
      const mate = await joinAs(workspaceId, await createUser('동료'), 'member')
      const fromMate = await createDiscussion(mate.ctx, {
        pageId: commentPage,
        richText: [textRun('동료가 남긴 코멘트')],
      })
      check('동료가 코멘트를 남겼다', fromMate.ok, JSON.stringify(fromMate))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/inbox` })
      await waitFor(`!!document.querySelector('[role="group"][aria-label="인박스 필터"]')`, 15000)
      const inboxText = () => evaluate(`document.querySelector('main')?.textContent ?? '(없음)'`)
      check('★ 동료의 코멘트가 인박스에 온다', (await inboxText()).includes('동료가 남긴 코멘트'), await inboxText())
      check('안 읽음 배지가 사이드바에 있다',
        await evaluate(`!!document.querySelector('[aria-label="안 읽은 알림 1개"]')`),
        await evaluate(`document.querySelector('nav')?.textContent?.slice(0, 120) ?? '(없음)'`))

      // ⑥ 읽음 · 보관 — 필터 넷이 서로 다른 것을 준다.
      check('읽음으로 표시한다', await clickIn(INBOX_LIST, '읽음'))
      check('★ 읽으면 안 읽음 목록에서 빠진다',
        (await clickIn(INBOX_FILTER, '안 읽음')) &&
          (await waitFor(`(document.querySelector('main')?.textContent ?? '').includes('알림이 없습니다')`, 8000)),
        await inboxText())
      check('읽음 목록에서는 보인다',
        (await clickIn(INBOX_FILTER, '읽음')) &&
          (await waitFor(`(document.querySelector('main')?.textContent ?? '').includes('동료가 남긴 코멘트')`, 8000)),
        await inboxText())
      check('보관하면 전체에서도 빠진다',
        (await clickIn(INBOX_LIST, '보관')) &&
          (await clickIn(INBOX_FILTER, '전체')) &&
          (await waitFor(`(document.querySelector('main')?.textContent ?? '').includes('알림이 없습니다')`, 8000)),
        await inboxText())
      check('★ 보관 목록에서는 보인다 — 읽음과 보관은 따로다',
        (await clickIn(INBOX_FILTER, '보관')) &&
          (await waitFor(`(document.querySelector('main')?.textContent ?? '').includes('동료가 남긴 코멘트')`, 8000)),
        await inboxText())
    }

    if (sectionIf('본문 글자에 단 코멘트 (F-05-07)')) {
      const anchorBlock = randomUUID()
      const anchorPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({ title: `앵커 대상 ${Date.now()}` }),
      })).json()).page.id
      await saveBody(anchorPage, {
        blocks: [{ id: anchorBlock, type: 'paragraph', title: [textRun('가나다라마바사')], properties: {}, format: {}, children: [] }],
      })

      const blockText = () =>
        evaluate(`document.querySelector('[data-block-id="${anchorBlock}"] > *:first-child')?.textContent ?? '(없음)'`)
      const highlighted = () =>
        evaluate(`[...document.querySelectorAll('.blk-comment')].map((e) => e.textContent).join('|')`)
      const composer = () =>
        evaluate(`document.querySelector('[role="dialog"][aria-label="고른 글자에 코멘트"]')?.textContent ?? '(없음)'`)
      const panelText = () =>
        evaluate(`document.querySelector('[role="dialog"][aria-label="코멘트"]')?.textContent ?? '(패널 없음)'`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${anchorPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${anchorBlock}"]')`, 15000)

      // 좌표로 캐럿 자리를 맞추지 않는다 — 클릭이 글자 사이 어디에 떨어질지는 글꼴 · 여백에 달렸고, 처음에 그것으로
      // 재다가 "지웠는데 한 글자가 남는" 실패를 봤다. `End` 에서 왼쪽으로 세는 것은 어디를 눌러도 같다.
      // 블록의 **왼쪽 끝**을 누른다. 가운데를 누르면 하이라이트 위에 떨어져 패널이 열리고, 그러면 포커스가 옮겨져
      // 이어지는 키가 편집기에 닿지 않는다 — 처음에 그것으로 "지워지지 않는" 실패를 봤다.
      const caretInBlock = async () => {
        const box = await line(anchorBlock)
        await click(box.x + 4, box.y + box.h / 2)
      }
      /** 블록의 **마지막** `n` 글자를 고른다. */
      const selectLast = async (n) => {
        await caretInBlock()
        await key('End')
        for (let i = 0; i < n; i += 1) await key('ArrowLeft', SHIFT)
        await sleep(120)
      }
      /** 블록의 맨 앞으로. 한 블록뿐이라 왼쪽 끝에서 더 눌러도 그대로다. */
      const caretToStart = async () => {
        await caretInBlock()
        await key('End')
        for (let i = 0; i < 20; i += 1) await key('ArrowLeft')
        await sleep(80)
      }

      // ① 글자를 고르면 버튼이 뜨고, 누르면 고른 글자를 보여 준다.
      await selectLast(3)
      check('★ 글자를 고르면 "코멘트 달기"가 뜬다',
        await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '코멘트 달기')`, 5000))
      check('버튼을 누른다', await clickText('코멘트 달기'))
      check('고른 글자를 보여 준다', (await composer()).includes('마바사'), await composer())

      check('코멘트를 쓴다', await clickSelector('textarea[aria-label="고른 글자에 남길 코멘트"]'))
      await typeText('이 표현을 바꾸죠')
      check('남긴다', await clickText('남기기'))

      // ② 하이라이트가 그 글자에 남고, 패널이 그 스레드를 연다.
      check('★ 고른 글자에 하이라이트가 남는다',
        await waitFor(`[...document.querySelectorAll('.blk-comment')].map((e) => e.textContent).join('') === '마바사'`, 8000),
        await highlighted())
      check('★ 방금 만든 스레드가 패널에 열린다',
        await waitFor(`(document.querySelector('[role="dialog"][aria-label="코멘트"]')?.textContent ?? '').includes('이 표현을 바꾸죠')`, 8000),
        await panelText())
      check('패널이 인용한 원문을 보여 준다', (await panelText()).includes('마바사'), await panelText())
      await key('Escape')

      // ③ ★ 앞에 글자를 쳐도 같은 글자를 덮는다 — 오프셋이 아니라 글자를 가리키기 때문이다.
      await caretToStart()
      await typeText('앞')
      check('전제: 맨 앞에 글자가 들어갔다', (await blockText()) === '앞가나다라마바사', await blockText())
      check('★ 앞에 친 글자는 하이라이트 밖에 남는다 — 같은 글자를 계속 덮는다',
        await waitFor(`[...document.querySelectorAll('.blk-comment')].map((e) => e.textContent).join('') === '마바사'`, 8000),
        await highlighted())

      // ④ ★ 그 글자를 다 지우면 하이라이트가 사라지고, 스레드는 "원본 없음"으로 남는다.
      await selectLast(3)
      await key('Backspace')
      check('전제: 마지막 세 글자가 지워졌다', (await blockText()) === '앞가나다라', await blockText())
      check('★ 가리키던 글자를 다 지우면 하이라이트가 사라진다',
        await waitFor(`document.querySelectorAll('.blk-comment').length === 0`, 8000),
        await highlighted())

      await send('Page.reload')
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('코멘트'))`, 15000)
      check('패널을 연다', await clickText('코멘트'))
      check('★ 스레드는 살아남아 "원본 없음"으로 보인다',
        await waitFor(`(document.querySelector('[role="dialog"][aria-label="코멘트"]')?.textContent ?? '').includes('원본 없음')`, 8000),
        await panelText())
      check('지워진 원문 스냅샷은 그대로 보여 준다', (await panelText()).includes('마바사'), await panelText())
      await key('Escape')
    }

    if (sectionIf('@ 멘션 (F-07-08 · F-07-09 · F-05-09)')) {
      const mentionBlock = randomUUID()
      const targetTitle = `멘션대상문서${Date.now() % 100000}`
      const targetPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({ title: targetTitle }),
      })).json()).page.id
      const mentionPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({ title: `멘션하는문서 ${Date.now()}` }),
      })).json()).page.id
      await saveBody(mentionPage, {
        blocks: [{ id: mentionBlock, type: 'paragraph', title: [textRun('담당 ')], properties: {}, format: {}, children: [] }],
      })
      // 알림은 자기 글에는 오지 않는다 — 멘션당할 동료를 하나 만든다.
      const pal = await joinAs(workspaceId, await createUser('박동료'), 'member')
      const { listInbox } = await import(new URL('../src/lib/notification/inbox.ts', import.meta.url).href)

      const listbox = () => evaluate(`document.querySelector('[role="listbox"][aria-label="멘션"]')?.textContent ?? '(없음)'`)
      const mentions = () =>
        evaluate(`[...document.querySelectorAll('.blk-mention')].map((e) => e.textContent).join('|')`)
      /** 한 글자씩 — 여러 글자를 한 번에 넣으면 붙여넣기로 보고 열지 않는다(07 F-07-08). */
      const typeChars = async (text) => {
        for (const ch of text) await typeText(ch)
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${mentionPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${mentionBlock}"]')`, 15000)
      const box = await line(mentionBlock)
      await click(box.x + 4, box.y + box.h / 2)
      await key('End')

      // ① 사람 멘션 — `@박` → 박동료 → Enter.
      await typeChars('@박')
      check('★ @ 를 치면 후보 팝업이 뜨고 동료가 보인다',
        await waitFor(`(document.querySelector('[role="listbox"][aria-label="멘션"]')?.textContent ?? '').includes('박동료')`, 8000),
        await listbox())
      await key('Enter')
      check('★ 고르면 @쿼리가 이름 칩으로 바뀐다 — 노드에는 id 뿐이고 이름은 맵에서 온다',
        await waitFor(`[...document.querySelectorAll('.blk-mention-user')].some((e) => e.textContent === '@박동료')`, 5000),
        await mentions())
      check('팝업은 닫힌다', await waitFor(`!document.querySelector('[role="listbox"][aria-label="멘션"]')`, 3000))

      // ② 페이지 멘션 — 볼 수 있는 페이지가 후보에 있고, 고르면 제목 칩이 된다.
      await typeChars('@멘션대상')
      check('페이지 후보가 보인다',
        await waitFor(`(document.querySelector('[role="listbox"][aria-label="멘션"]')?.textContent ?? '').includes(${JSON.stringify(targetTitle)})`, 8000),
        await listbox())
      await key('Enter')
      check('★ 페이지 멘션은 지금 제목을 그린다',
        await waitFor(`[...document.querySelectorAll('.blk-mention-page')].some((e) => e.textContent === ${JSON.stringify(targetTitle)})`, 5000),
        await mentions())

      // ③ 이메일을 방해하지 않는다 — 글자 뒤의 @ 는 열리지 않는다.
      await typeChars(' me@ex')
      check('★ 글자 뒤의 @ 는 팝업을 열지 않는다', !(await evaluate(`!!document.querySelector('[role="listbox"][aria-label="멘션"]')`)))

      // ④ 멘션 알림 — 동료의 인박스에 온다(멘션을 넣은 update 는 미루지 않으므로 곧 도착한다).
      let inbox = []
      for (let i = 0; i < 40 && !inbox.some((it) => it.kind === 'mention'); i += 1) {
        inbox = await listInbox(pal.ctx)
        if (!inbox.some((it) => it.kind === 'mention')) await sleep(250)
      }
      check('★ 멘션당한 동료의 인박스에 멘션 알림이 온다', inbox.some((it) => it.kind === 'mention' && it.pageId === mentionPage), JSON.stringify(inbox))

      // ⑤ 새로 고쳐도 이름이 남는다 — 서버가 권한으로 거른 맵을 실어 준다.
      await send('Page.reload')
      await waitFor(`!!document.querySelector('[data-block-id="${mentionBlock}"]')`, 15000)
      check('★ 새로 고친 뒤에도 이름 · 제목이 그려진다', await waitFor(`[...document.querySelectorAll('.blk-mention')].map((e) => e.textContent).join('|').includes('@박동료')`, 5000), await mentions())

      // ⑥ 백링크 — 멘션된 페이지에서 "이 페이지를 멘션한 페이지" 가 보인다.
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${targetPage}` })
      await waitFor(`!!document.querySelector('.blk-editor')`, 15000)
      check('★ 멘션된 페이지에 백링크가 뜬다',
        await waitFor(`(document.querySelector('details[aria-label="백링크"]')?.textContent ?? '').includes('멘션하는문서')`, 8000),
        await evaluate(`document.querySelector('details[aria-label="백링크"]')?.textContent ?? '(없음)'`))
    }

    if (sectionIf('내비게이션 — 최근 · 즐겨찾기 (W6-a)')) {
    // 방금까지 여러 페이지를 오갔으므로 사이드바에 "최근"이 있어야 한다.
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
    await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
    // 사이드바(레이아웃)와 본문(페이지)은 같은 요청에서 **병렬로** 렌더된다 — 이 방문의 기록이 이번 사이드바에 실린다는
    // 보장이 없다. 앞 절들이 다른 페이지를 많이 다녀 이 페이지가 최근 목록 밖으로 밀리면 그 경쟁이 드러난다(§7).
    // 한 번 더 열어 방금 기록된 방문을 본다.
    await send('Page.reload')
    await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
    check('★ 사이드바에 "최근" 섹션이 생긴다 — 방문이 기록됐다',
      await waitFor(`!!document.querySelector('section[aria-label="최근"]')`, 5000),
      await evaluate(`document.querySelector('nav[aria-label="페이지 트리"]')?.textContent?.slice(0, 120) ?? '(사이드바 없음)'`))
    check('지금 보고 있는 페이지가 최근 목록에 있다',
      await evaluate(`!!document.querySelector('section[aria-label="최근"] a[href$="/${pageId}"]')`))

    // 즐겨찾기는 아직 없다 — 빈 섹션은 그리지 않는다.
    check('즐겨찾기가 없으면 그 섹션도 없다', !(await evaluate(`!!document.querySelector('section[aria-label="즐겨찾기"]')`)))

    const starBox = await evaluate(`(() => {
      const b = document.querySelector('button[aria-label="즐겨찾기에 넣기"]')
      if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    check('별 버튼이 있다 — 상태를 이름으로도 알린다', !!starBox)
    if (starBox) {
      await click(starBox.x, starBox.y)
      check('★ 별을 누르면 즐겨찾기 섹션이 나타난다',
        await waitFor(`!!document.querySelector('section[aria-label="즐겨찾기"] a[href$="/${pageId}"]')`, 10000))
      check('별의 상태가 바뀐다 (aria-pressed)',
        await waitFor(`document.querySelector('button[aria-label="즐겨찾기에서 빼기"]')?.getAttribute('aria-pressed') === 'true'`, 5000))

      // 다시 누르면 사라진다.
      const unstar = await evaluate(`(() => {
        const b = document.querySelector('button[aria-label="즐겨찾기에서 빼기"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      if (unstar) {
        await click(unstar.x, unstar.y)
        check('다시 누르면 즐겨찾기에서 빠진다',
          await waitFor(`!document.querySelector('section[aria-label="즐겨찾기"]')`, 10000))
      }
    }

    // 제목을 복사해 두지 않는다 — 제목을 바꾸면 최근 목록도 바뀐다.
    const renamed = `이름 바꾼 페이지 ${Date.now()}`
    await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${pageId}`, {
      method: 'PATCH',
      headers: authed,
      body: JSON.stringify({ title: renamed }),
    })
    await send('Page.reload')
    await waitFor(`!!document.querySelector('section[aria-label="최근"]')`, 15000)
    check('★ 제목을 바꾸면 최근 목록의 제목도 바뀐다 — 제목을 복사해 두지 않는다',
      await waitFor(`document.querySelector('section[aria-label="최근"]')?.textContent.includes(${JSON.stringify(renamed)})`, 5000),
      await evaluate(`document.querySelector('section[aria-label="최근"]')?.textContent ?? '(없음)'`))

    }
    if (sectionIf('검색 오버레이 (W7 · F-07-01)')) {
    // 이 절이 헤드리스로는 절대 안 보이는 것을 본다: 단축키가 에디터까지 새지
    // 않는가 · 포커스가 돌아오는가 · ↑↓/Enter 가 본문을 건드리지 않는가.
      // 찾을 대상 — 제목에 고유 토큰을 넣은 페이지를 API 로 만든다.
      const token = `검색대상${Date.now()}`
      const found = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: token }),
      })).json()).page.id

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
      await waitFor(`!!document.querySelector('.blk-editor [data-block-id]')`, 15000)

      const overlayOpen = () => evaluate(`!!document.querySelector('[data-testid="search-overlay"]')`)
      const hitIds = () => evaluate(
        `[...document.querySelectorAll('[data-testid="search-hit"]')].map((e) => e.dataset.pageId)`)
      const selectedId = () => evaluate(
        `document.querySelector('[data-testid="search-hit"][aria-selected="true"]')?.dataset.pageId ?? null`)

      // ── 에디터에 포커스를 두고 연다 ──
      const editorBox = await rect('.blk-editor')
      await click(editorBox.x + 40, editorBox.y + 10)
      // 편집할 수 있는 글자만 비교한다 — 편집 불가 노드 뷰(`contenteditable=false`: 이미지 · 참조 · 체크박스)는 뺀다. 이미지 노드
      // 뷰는 오버레이가 열린 동안 비동기로 "이미지를 불러올 수 없습니다"를 그려, 본문 전체를 비교하면 이 검사가 간헐적으로
      // 떨어졌다(#81 의 실행에서 넣어 둔 진단이 달라진 글자를 남겨 확인했다). 새는 타이핑은 편집 가능한 블록으로 들어간다.
      const editableText = `(() => {
        const root = document.querySelector('.blk-editor')
        if (!root) return ''
        const copy = root.cloneNode(true)
        copy.querySelectorAll('[contenteditable="false"]').forEach((e) => e.remove())
        return copy.textContent
      })()`
      const bodyBefore = await evaluate(editableText)

      await key('k', MOD)
      check('★ Mod+K 로 열린다 (선택이 없을 때)', await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000))
      check('입력창으로 포커스가 간다',
        await waitFor(`document.activeElement === document.querySelector('[data-testid="search-input"]')`, 3000))

      // 빈 입력 = 이동 모드. 방금까지 여러 페이지를 오갔으므로 최근 방문이 있다.
      check('★ 빈 입력이면 최근 방문이 보인다 (F-07-01 이동 모드)',
        await waitFor(`document.querySelector('[data-testid="search-results"]')?.textContent.includes('최근 방문')`, 3000),
        await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 120) ?? '(없음)'`))

      // ── 검색 모드 ──
      await typeText(token)
      check('★ 타이핑하면 결과가 바뀐다 — debounce 뒤 질의가 돈다',
        await waitFor(`[...document.querySelectorAll('[data-testid="search-hit"]')].some((e) => e.dataset.pageId === ${JSON.stringify(found)})`, 8000),
        JSON.stringify(await hitIds()))
      check('일치 구간이 강조된다 (<mark>)',
        await evaluate(`!!document.querySelector('[data-testid="search-hit"] mark')`))

      // ── ↑↓ 이동 ──
      const before = await selectedId()
      await key('ArrowDown')
      await sleep(80)
      const afterDown = await selectedId()
      const many = (await hitIds()).length > 1
      check('★ ↓ 로 선택이 옮겨진다', many ? afterDown !== before : afterDown === before,
        `결과 ${(await hitIds()).length}건 · ${before} → ${afterDown}`)
      await key('ArrowUp')
      await sleep(80)
      check('★ ↑ 로 되돌아온다', (await selectedId()) === before)

      // 오버레이가 열린 동안의 입력(검색어 타이핑 · ↑↓)이 본문에 닿지 않았다.
      //
      // `bodyBefore` 는 오버레이를 열기 **전**에 찍었다. 반사실로 확인한 결과
      // 이 검사가 실제로 잡는 것은 화살표가 아니라 **타이핑이 에디터로 새는 것**
      // 이었다(포커스 이동을 끄면 검색어가 본문에 박힌다). 이름을 그대로 적는다.
      {
        const bodyAfter = await evaluate(editableText)
        // 실패하면 무엇이 달라졌는지 남긴다 — 참/거짓만으로는 새어 들어간 타이핑인지,
        // 비동기로 바뀐 다른 글자인지 구분할 수 없다(추측하지 않는다, HANDOFF §6).
        let at = 0
        while (at < bodyBefore.length && bodyBefore[at] === bodyAfter[at]) at += 1
        check('★ 오버레이가 열린 동안의 입력이 본문에 새지 않았다', bodyAfter === bodyBefore,
          `처음 달라진 곳 ${at}자: 전 ${JSON.stringify(bodyBefore.slice(Math.max(0, at - 20), at + 40))}` +
            ` / 후 ${JSON.stringify(bodyAfter.slice(Math.max(0, at - 20), at + 40))}`)
      }

      // ★ 위 검사를 **성립시키는 메커니즘**을 따로 본다.
      //
      //   처음에는 그 보호를 `stopPropagation()` 이 한다고 적었는데, 반사실로
      //   확인해 보니 그 줄을 빼도 135개가 전부 통과했다. 실제 이유는 **포커스
      //   격리**다 — 오버레이가 에디터 DOM 밖에 있고 포커스가 그쪽으로 가므로
      //   ProseMirror 의 `handleKeyDown`(= `view.dom` 의 리스너)이 있는 경로를
      //   이벤트가 지나지 않는다. 그 사실이 깨지면(오버레이를 에디터 안에 그리거나
      //   포커스를 옮기지 않게 바꾸면) 이 검사가 잡는다.
      check('★ 포커스가 에디터 DOM 밖에 있다 — 이것이 에디터를 지키는 메커니즘이다',
        await evaluate(`(() => {
          const active = document.activeElement
          const editor = document.querySelector('.blk-editor')
          return !!active && !!editor && !editor.contains(active)
        })()`),
        await evaluate(`document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '(없음)'`))

      // ── Esc 로 닫고 포커스 복귀 ──
      await key('Escape')
      check('Esc 로 닫힌다', await waitFor(`!document.querySelector('[data-testid="search-overlay"]')`, 3000))
      check('★ 포커스가 에디터로 돌아온다 (F-07-01)',
        await waitFor(`document.activeElement?.closest('.blk-editor') !== null`, 3000),
        await evaluate(`document.activeElement?.className ?? '(없음)'`))

      // ── Mod+P 도 연다 (충돌 없는 우회 경로) ──
      await key('p', MOD)
      check('★ Mod+P 로도 열린다', await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000))

      // ── 0건 상태 ──
      await typeText(`없는말${Date.now()}`)
      check('결과가 없으면 그렇게 말한다',
        await waitFor(`!!document.querySelector('[data-testid="search-empty"]')`, 8000),
        await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 80) ?? '(없음)'`))

      // 지우면 다시 이동 모드 — 낡은 결과가 비치지 않는다.
      for (let i = 0; i < 40; i += 1) await key('Backspace')
      check('★ 지우면 이동 모드로 돌아간다 — 낡은 결과가 남지 않는다',
        await waitFor(`document.querySelector('[data-testid="search-results"]')?.textContent.includes('최근 방문')
                       && !document.querySelector('[data-testid="search-empty"]')`, 5000),
        await evaluate(`document.querySelector('[data-testid="search-results"]')?.textContent?.slice(0, 120) ?? '(없음)'`))

      // ── Enter 로 이동 ──
      await typeText(token)
      await waitFor(`[...document.querySelectorAll('[data-testid="search-hit"]')].some((e) => e.dataset.pageId === ${JSON.stringify(found)})`, 8000)
      // 찾은 페이지가 선택될 때까지 ↓ 를 누른다(최근 방문과 섞일 수 있다).
      for (let i = 0; i < 10 && (await selectedId()) !== found; i += 1) {
        await key('ArrowDown')
        await sleep(60)
      }
      check('목표 페이지가 선택됐다', (await selectedId()) === found)
      await key('Enter')
      check('★ Enter 로 그 페이지가 열린다',
        await waitFor(`location.pathname.endsWith('/${found}')`, 8000),
        await evaluate('location.pathname'))
      check('오버레이가 닫혔다', !(await overlayOpen()))

      // ── 사이드바 버튼 ──
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
      const searchBtn = await evaluate(`(() => {
        const b = [...document.querySelectorAll('nav[aria-label="페이지 트리"] button')]
          .find((e) => e.textContent.includes('검색'))
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      check('사이드바에 검색 버튼이 있다', searchBtn !== null)
      if (searchBtn) {
        await click(searchBtn.x, searchBtn.y)
        check('★ 사이드바 버튼으로도 열린다', await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000))
        await key('Escape')
      }
    }

    if (sectionIf('데이터베이스 표 (W8-b · F-04-14 · F-03-16)')) {
    // 이 절이 헤드리스로는 볼 수 없는 것을 본다: 포커스가 칸을 따라 움직이는가 ·
    // 편집기가 쓴 Enter 가 표의 규칙을 한 번 더 타지 않는가 · 표 끝의 Tab 이 표 밖으로
    // 나가는가. 규칙 자체는 `grid-nav.test.ts` · `cell-format.test.ts` 가 본다.
      const poll = async (fn, tries = 50) => {
        for (let i = 0; i < tries; i += 1) {
          if (await fn()) return true
          await sleep(100)
        }
        return false
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      /**
       * 팝오버가 조상 스크롤 상자에 잘리지 않는가.
       *
       * 한 축이 `auto` 인 상자는 다른 축의 `visible` 도 `auto` 로 계산된다(CSS 규칙).
       * 그래서 표를 가로 스크롤 상자로 감싸면 칸 안의 절대 위치 팝오버가 **세로로 잘리고**
       * 상자 안에 스크롤이 생긴다. 키보드와 `scrollIntoView` 로만 조작하는 검사는 이것을
       * 보지 못한다 — 좌표로 본다.
       */
      const unclipped = (selector) => evaluate(`(() => {
        const pop = document.querySelector(${JSON.stringify(selector)})
        if (!pop) return { ok: false, detail: '팝오버가 없다' }
        for (let box = pop.parentElement; box && box !== document.body; box = box.parentElement) {
          if (!/(auto|scroll|hidden)/.test(getComputedStyle(box).overflowY)) continue
          const p = pop.getBoundingClientRect()
          const b = box.getBoundingClientRect()
          return { ok: p.bottom <= b.bottom + 1, detail: box.className + ' · 팝오버 아래 ' + Math.round(p.bottom) + ' / 상자 아래 ' + Math.round(b.bottom) }
        }
        return { ok: true, detail: '자르는 조상이 없다' }
      })()`)
      const activeCell = () => evaluate(`document.activeElement?.dataset?.cell ?? null`)
      const editingCell = () => evaluate(`document.querySelector('td[data-editing]')?.dataset.cell ?? null`)
      const rowCount = () => evaluate(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length`)

      // ── 사이드바에서 만든다 ──
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"]')`, 15000)
      const newDbBox = () => evaluate(`(() => {
        const b = [...document.querySelectorAll('nav[aria-label="페이지 트리"] button')]
          .find((e) => e.textContent.includes('새 데이터베이스'))
        if (!b) return null
        b.scrollIntoView({ block: 'center' })
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      check('사이드바에 "+ 새 데이터베이스" 가 있다', (await newDbBox()) !== null)
      // 하이드레이션 전의 클릭은 아무 일이 없고, 하이드레이션 뒤 사이드바의 펼침 상태가 돌아오며 줄이 움직인다(§6 — 앞 절들이 사이드바를
      // 길게 만든 전체 판에서 그 사이의 클릭이 팀 공간 링크에 떨어졌다). 누를 때마다 단추를 다시 재고, 표가 열릴 때까지 다시 누른다.
      // 주소가 /db/ 로 바뀌면 멈춘다(두 번 만들지 않게).
      for (let i = 0; i < 6 && !(await evaluate(`/\\/db\\//.test(location.pathname)`)); i += 1) {
        const box = await newDbBox()
        if (box === null) break
        await click(box.x, box.y)
        await waitFor(`/\\/db\\/[0-9a-f-]{36}$/.test(location.pathname)`, 5000)
      }
      check('★ 누르면 풀페이지 데이터베이스 화면이 열린다',
        await waitFor(`/\\/db\\/[0-9a-f-]{36}$/.test(location.pathname) && !!document.querySelector('[data-testid="db-table"]')`, 15000),
        await evaluate('location.pathname'))
      const databaseId = (await evaluate('location.pathname')).split('/').pop()
      check('★ 사이드바에 표가 서고 지금 연 줄로 강조된다 — /db/ 경로를 읽는다',
        await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"] a[href$="/db/${databaseId}"][aria-current="page"]')`, 10000))
      check('빈 표는 비어 있다고 말하고, 머리와 "+ 새로 만들기" 는 남는다',
        await evaluate(`!!document.querySelector('[data-testid="db-empty"]') && !!document.querySelector('[data-testid="db-add-row"]')
          && document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]').length === 1`))

      // ── 이름 ──
      const dbName = `할 일 ${Date.now()}`
      await clickOn('input[aria-label="데이터베이스 이름"]')
      await typeText(dbName)
      await key('Enter')
      check('★ 표 이름을 바꾸면 사이드바의 이름도 바뀐다',
        await waitFor(`document.querySelector('nav[aria-label="페이지 트리"] a[href$="/db/${databaseId}"]')?.textContent.includes(${JSON.stringify(dbName)})`, 10000))

      const viewId = await evaluate(`new URL(document.querySelector('nav[aria-label="뷰"] a').href).searchParams.get('v')`)
      const rowsApi = async () => (await fetch(`${BASE}/api/workspaces/${workspaceId}/views/${viewId}/rows`, { headers: authed })).json()
      const cellOf = async (rowIndex, propertyId) => ((await rowsApi()).rows[rowIndex]?.properties ?? {})[propertyId]

      // ── 속성 ──
      let formChecked = false
      const addColumn = async (name, type) => {
        await clickOn('[data-testid="db-add-column"]')
        await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
        if (!formChecked) {
          // 행이 0개인 표 — 폼이 표보다 훨씬 길다. 잘림이 가장 잘 드러나는 순간이다.
          formChecked = true
          const clip = await unclipped('[data-testid="db-add-column-form"]')
          check('★ 속성 추가 폼이 표 상자에 잘리지 않는다', clip.ok, clip.detail)
        }
        await typeText(name)
        await evaluate(`(() => {
          const s = document.querySelector('select[aria-label="속성 유형"]')
          s.value = ${JSON.stringify(type)}
          s.dispatchEvent(new Event('change', { bubbles: true }))
        })()`)
        // 사람이 누르는 버튼으로 제출한다 — 키 이벤트 흉내에 기대지 않는다.
        await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
        await waitFor(`!document.querySelector('[data-testid="db-add-column-form"]')`, 8000)
      }
      await addColumn('수량', 'number')
      await addColumn('상태', 'select')
      await addColumn('완료', 'checkbox')
      // 머리는 서버가 답한 뒤에 붙는다 — 한 번만 세면 부하에서 셋을 읽는다(#253 의 전체 판). 넷이 될 때까지 기다린다
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]').length === 4`, 8000)
      const propIds = await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].map((th) => th.dataset.propertyId)`)
      check('★ 속성을 더하면 머리에 붙는다 — 제목 · 수량 · 상태 · 완료', propIds.length === 4, JSON.stringify(propIds))
      const [, numberProp, selectProp, checkProp] = propIds

      // ── 행 추가 → 제목 편집 → Tab ──
      await clickOn('[data-testid="db-add-row"]')
      check('★ "+ 새로 만들기" 는 새 행의 제목 칸을 편집 상태로 연다',
        await waitFor(`document.querySelector('td[data-editing]')?.dataset.cell === '0:0'
          && document.activeElement?.matches('[data-testid="db-cell-input"]')`, 8000),
        String(await editingCell()))
      const title1 = `첫 행 ${Date.now()}`
      await typeText(title1)
      await key('Tab')
      check('★ 편집 중 Tab 은 저장하고 오른쪽 칸으로 — 포커스가 그 칸에 있다',
        await waitFor(`document.activeElement?.dataset?.cell === '0:1'`, 3000), String(await activeCell()))
      check('제목이 서버에 저장된다', await poll(async () => (await rowsApi()).rows[0]?.title === title1))

      // ── 틀린 값 · 취소 ──
      await key('Enter')
      check('선택 칸의 Enter 는 편집을 시작한다',
        await waitFor(`document.querySelector('td[data-editing]')?.dataset.cell === '0:1'`, 3000))
      await typeText('abc')
      await key('Enter')
      check('★ 숫자가 아니면 저장하지 않고 편집에 머문다 — 이유를 말한다',
        (await waitFor(`!!document.querySelector('[data-testid="db-error"]')`, 3000)) && (await editingCell()) === '0:1',
        String(await editingCell()))
      await key('Escape')
      check('★ Esc 는 버리고 같은 칸을 선택한 채로 남는다',
        await waitFor(`!document.querySelector('td[data-editing]') && document.activeElement?.dataset?.cell === '0:1'`, 3000),
        String(await activeCell()))
      check('버린 값은 서버에 가지 않았다', (await cellOf(0, numberProp)) === undefined, JSON.stringify(await cellOf(0, numberProp)))

      // ── 둘째 행 — 아래 칸이 있어야 "아래로 간다/안 간다"를 구분할 수 있다 ──
      await clickOn('[data-testid="db-add-row"]')
      await waitFor(`document.querySelector('td[data-editing]')?.dataset.cell === '1:0'`, 8000)
      const title2 = `둘째 행 ${Date.now()}`
      await typeText(title2)
      await key('Enter')
      check('마지막 줄의 Enter 는 저장하고 제자리에 머문다 — 행을 몰래 만들지 않는다',
        (await waitFor(`document.activeElement?.dataset?.cell === '1:0'`, 3000)) && (await rowCount()) === 2,
        `${await activeCell()} · ${await rowCount()}행`)

      // ── 편집 중 Enter 는 저장하고 아래 칸 ──
      await key('ArrowUp')
      await key('ArrowRight')
      check('화살표로 선택이 움직인다', await waitFor(`document.activeElement?.dataset?.cell === '0:1'`, 3000), String(await activeCell()))
      await key('Enter')
      await waitFor(`!!document.querySelector('td[data-editing]')`, 3000)
      await typeText('42')
      await key('Enter')
      check('★ 편집 중 Enter 는 저장하고 아래 칸을 선택한다 (F-03-16)',
        await waitFor(`document.activeElement?.dataset?.cell === '1:1'`, 3000), String(await activeCell()))
      check('숫자가 서버에 저장된다', await poll(async () => (await cellOf(0, numberProp))?.number === 42),
        JSON.stringify(await cellOf(0, numberProp)))

      // ── select ──
      await key('ArrowUp')
      await key('ArrowRight')
      await key('Enter')
      check('select 칸은 옵션 편집기를 열고 검색칸에 포커스를 둔다',
        await waitFor(`document.activeElement?.matches('[data-testid="db-select-input"]')`, 3000))
      {
        const clip = await unclipped('[data-testid="db-select-editor"]')
        check('★ 옵션 편집기가 표 상자에 잘리지 않는다 — 가로 스크롤 상자가 세로로도 자른다', clip.ok, clip.detail)
      }
      await typeText('진행 중')
      check('없는 이름이면 "만들기" 가 보인다', await waitFor(`!!document.querySelector('[data-testid="db-create-option"]')`, 3000))
      await key('Enter')
      // 만들기는 비동기다(옵션 POST 뒤에 칸에 넣는다). 그래서 이 검사는 표가 같은 Enter 를
      // 한 번 더 처리하는지를 **가리지 못한다** — 반사실로 확인했다: 표의 defaultPrevented
      // 가드를 빼도 통과한다. 선택이 잠깐 아래 칸으로 갔다가 요청이 끝난 뒤 되돌아온다.
      // 그 가드는 아래의 "기존 옵션 고르기"(동기 경로)가 본다.
      check('옵션을 만들면 편집기가 닫히고 그 칸이 선택된 채로 남는다',
        await waitFor(`!document.querySelector('[data-testid="db-select-editor"]') && document.activeElement?.dataset?.cell === '0:2'`, 8000),
        String(await activeCell()))
      check('★ 만든 옵션이 칸에 칩으로 들어간다',
        await waitFor(`document.querySelector('td[data-cell="0:2"] [data-testid="db-option-chip"]')?.textContent === '진행 중'`, 5000))
      check('서버의 칸은 옵션 id 를 담고, 그 id 의 이름이 컬럼에 실린다',
        await poll(async () => {
          const body = await rowsApi()
          const id = body.rows[0]?.properties?.[selectProp]?.select?.id
          return !!id && body.columns.find((c) => c.propertyId === selectProp)?.options.find((o) => o.id === id)?.name === '진행 중'
        }))

      // 기존 옵션을 Enter 로 고른다 — 고르는 순간 칸이 "선택" 상태가 되므로, 같은 Enter 가
      // 표에 닿으면 "선택 칸의 Enter = 편집 시작"이 되어 **편집기가 다시 열린다.**
      await key('ArrowDown')
      await key('Enter')
      await waitFor(`document.activeElement?.matches('[data-testid="db-select-input"]')`, 3000)
      await typeText('진행')
      await waitFor(`!!document.querySelector('[data-testid="db-option"][aria-selected="true"]')`, 3000)
      await key('Enter')
      check('★ 기존 옵션을 고르는 Enter 가 표의 규칙을 한 번 더 타지 않는다 — 편집기가 다시 열리지 않는다',
        await waitFor(`!document.querySelector('[data-testid="db-select-editor"]') && document.activeElement?.dataset?.cell === '1:2'
          && document.querySelector('td[data-cell="1:2"] [data-testid="db-option-chip"]')?.textContent === '진행 중'`, 5000),
        `선택 ${await activeCell()} · 편집기 ${await evaluate(`!!document.querySelector('[data-testid="db-select-editor"]')`)}`)
      // 편집기가 다시 열렸을 때(= 위 검사가 실패한 경우)만 닫는다. 선택 상태에서 Esc 를
      // 누르면 선택이 풀려 뒤의 검사가 연쇄로 실패하고, 무엇이 깨졌는지 가려진다.
      if (await evaluate(`!!document.querySelector('[data-testid="db-select-editor"]')`)) await key('Escape')
      await key('ArrowUp')

      // ── checkbox ──
      await key('ArrowRight')
      await key('Enter')
      check('★ 체크박스 칸의 Enter 는 토글이다 — 편집칸을 열지 않는다',
        await waitFor(`document.querySelector('td[data-cell="0:3"] [role="img"]')?.getAttribute('aria-label') === '체크됨'
          && !document.querySelector('td[data-editing]')`, 3000))
      check('체크가 서버에 저장된다', await poll(async () => (await cellOf(0, checkProp))?.checkbox === true))

      // ── 비우기 ──
      await key('ArrowLeft')
      await key('ArrowLeft')
      await key('Delete')
      check('Delete 는 선택한 칸을 비운다', await poll(async () => (await cellOf(0, numberProp))?.number === null),
        JSON.stringify(await cellOf(0, numberProp)))

      // ── 포커스가 진짜 칸에 있다 ──
      await key('k', MOD)
      await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 5000)
      await key('Escape')
      check('검색을 열었다 닫으면 포커스가 그 칸으로 돌아온다 — 칸이 실제 포커스를 갖고 있다 (roving tabindex)',
        await waitFor(`!document.querySelector('[data-testid="search-overlay"]') && document.activeElement?.dataset?.cell === '0:1'`, 3000),
        String(await activeCell()))

      // ── 표 끝의 Tab ──
      await key('ArrowDown')
      await key('ArrowRight')
      await key('ArrowRight')
      check('마지막 칸을 선택했다', await waitFor(`document.activeElement?.dataset?.cell === '1:3'`, 3000), String(await activeCell()))
      await key('Tab')
      // "표 밖"은 칸의 격자(`tbody`) 밖이다 — 그 다음 자리는 표 아래의 집계 줄(`tfoot` 의 "계산" · 2d-2)일 수 있고, 그것도 갇힘이 아니다.
      check('★ 표 끝의 Tab 은 포커스를 칸의 격자 밖으로 보낸다 — 키보드 사용자를 가두지 않는다 (WCAG 2.1.2)',
        await waitFor(`!!document.activeElement && document.activeElement !== document.body
          && !document.querySelector('[data-testid="db-table"] tbody').contains(document.activeElement)`, 3000),
        await evaluate(`document.activeElement?.outerHTML?.slice(0, 100) ?? '(없음)'`))

      // ── 새로고침 ──
      await send('Page.reload')
      await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)
      check('★ 새로고침해도 값이 남는다 — 제목 · 옵션 칩 · 체크',
        await evaluate(`(() => {
          const row = document.querySelector('[data-testid="db-table"] tbody tr')
          return row?.querySelector('td[data-cell="0:0"]')?.textContent === ${JSON.stringify(title1)}
            && row?.querySelector('td[data-cell="0:2"] [data-testid="db-option-chip"]')?.textContent === '진행 중'
            && row?.querySelector('td[data-cell="0:3"] [role="img"]')?.getAttribute('aria-label') === '체크됨'
        })()`))
      check('★ 사이드바에는 행이 없다 — 표 한 줄만 선다',
        !(await evaluate(`document.querySelector('nav[aria-label="페이지 트리"]')?.textContent.includes(${JSON.stringify(title1)})`)))

      // ── 더 보기 (F-04-15) ──
      for (let i = 0; i < 55; i += 1) {
        await fetch(`${BASE}/api/workspaces/${workspaceId}/views/${viewId}/rows`, { method: 'POST', headers: authed, body: '{}' })
      }
      await send('Page.reload')
      await waitFor(`!!document.querySelector('[data-testid="db-load-more"]')`, 15000)
      check('★ 첫 화면은 50행이고 "더 보기" 가 있다 — 무한 스크롤이 아니다', (await rowCount()) === 50, `${await rowCount()}행`)
      // 다시 불러온 직후의 클릭은 React 가 붙기 전이면 사라진다(§6) — 행이 늘 때까지 다시 누른다(두 판 연속 흔들렸다 · 8a-1).
      let loadedMore = false
      for (let i = 0; i < 10 && !loadedMore; i += 1) {
        if (await evaluate(`!!document.querySelector('[data-testid="db-load-more"]')`)) await clickOn('[data-testid="db-load-more"]')
        loadedMore = await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 57
          && !document.querySelector('[data-testid="db-load-more"]')`, 1500)
      }
      check('★ "더 보기" 가 나머지를 이어 붙이고 사라진다 — 57행', loadedMore, `${await rowCount()}행`)
      check('이어 붙인 행에 같은 행이 두 번 없다',
        await evaluate(`(() => {
          const ids = [...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.dataset.rowId)
          return new Set(ids).size === ids.length
        })()`))

      section('데이터베이스 필터 · 정렬 · 속성 (W8-b · F-04-09 · F-04-10 · F-04-12)')
      // 규칙(평평한 AND · 덜 찬 규칙 · 지워진 속성)은 `filter-draft.test.ts` 가 본다. 여기서는
      // 저장 → 서버 렌더 → 표 재마운트가 실제로 행 집합을 바꾸는지, 패널 초안이 그 과정을
      // 견디는지, 편집할 수 없는 필터를 건드리지 않는지를 본다.
      const titles = () => evaluate(`[...document.querySelectorAll('[data-testid="db-table"] tbody tr')]
        .map((tr) => tr.querySelector('td[data-cell$=":0"]')?.textContent ?? '')`)
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const chipTexts = (testId) => evaluate(`[...document.querySelectorAll('[data-testid="${testId}"]')].map((e) => e.textContent).join(' | ')`)

      // 정렬에 쓸 숫자 — 첫 행 5, 둘째 행 30. 나머지 55행은 빈 칸이다.
      const firstPage = (await rowsApi()).rows
      for (const [title, n] of [[title1, 5], [title2, 30]]) {
        const id = firstPage.find((r) => r.title === title)?.id
        await fetch(`${BASE}/api/workspaces/${workspaceId}/rows/${id}`, {
          method: 'PATCH', headers: authed,
          body: JSON.stringify({ cells: [{ propertyId: numberProp, value: { type: 'number', number: n } }] }),
        })
      }
      await send('Page.reload')
      await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)

      // ── 머리 메뉴 ──
      await clickOn(`th[data-property-id="${propIds[0]}"] [data-testid="db-column-menu"]`)
      check('제목 속성의 머리 메뉴에는 숨기기 · 삭제가 없다',
        await waitFor(`!!document.querySelector('[data-testid="db-column-menu-panel"]')
          && !document.querySelector('[data-testid="db-column-hide"]') && !document.querySelector('[data-testid="db-column-delete"]')`, 3000))
      await clickOn(`th[data-property-id="${propIds[0]}"] [data-testid="db-column-menu"]`)

      await clickOn(`th[data-property-id="${selectProp}"] [data-testid="db-column-menu"]`)
      check('★ select 머리 메뉴에는 정렬이 없다 — 옵션 id 순서를 정렬처럼 보여주지 않는다',
        await waitFor(`!!document.querySelector('[data-testid="db-column-menu-panel"]') && !document.querySelector('[data-testid="db-column-sort-asc"]')`, 3000))
      await clickOn(`th[data-property-id="${selectProp}"] [data-testid="db-column-menu"]`)

      await clickOn(`th[data-property-id="${numberProp}"] [data-testid="db-column-menu"]`)
      await waitFor(`!!document.querySelector('[data-testid="db-column-menu-panel"]')`, 3000)
      {
        const clip = await unclipped('[data-testid="db-column-menu-panel"]')
        check('★ 머리 메뉴가 잘리지 않는다 — th 에 overflow 를 걸지 않았다', clip.ok, clip.detail)
      }
      await clickOn('[data-testid="db-column-sort-desc"]')
      check('★ 머리 메뉴의 내림차순 — 큰 수가 위, 빈 칸은 맨 아래 (NULLS LAST)',
        await waitFor(`(() => {
          const t = [...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.querySelector('td[data-cell$=":0"]')?.textContent)
          return t[0] === ${JSON.stringify(title2)} && t[1] === ${JSON.stringify(title1)}
        })()`, 10000),
        JSON.stringify((await titles()).slice(0, 3)))
      check('정렬 칩이 걸린 조건을 보여준다', await waitFor(`[...document.querySelectorAll('[data-testid="db-sort-chip"]')].some((e) => e.textContent.includes('↓'))`, 5000),
        await chipTexts('db-sort-chip'))

      // ── 필터 패널 ──
      await clickOn('[data-testid="db-filter-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-filter-panel"]')`, 3000)
      // 첫 규칙은 값을 넣지 않고 둔다(제목 · 포함 · 빈 값). 둘째 규칙을 저장한 뒤에도
      // 이 규칙이 남아 있어야 "서버 렌더가 초안을 덮지 않는다"가 검사된다 — 규칙이 하나뿐이면
      // 패널이 서버 값으로 다시 그려져도 똑같이 1개로 보여 가려내지 못한다.
      await clickOn('[data-testid="db-filter-add"]')
      await waitFor(`document.querySelectorAll('[data-testid="db-filter-rule"]').length === 1`, 3000)
      await clickOn('[data-testid="db-filter-add"]')
      await waitFor(`document.querySelectorAll('[data-testid="db-filter-rule"]').length === 2`, 3000)
      const second = '[data-testid="db-filter-rule"]:nth-child(2)'
      await setSelect(`${second} select[aria-label="필터 속성"]`, numberProp)
      await waitFor(`!!document.querySelector('${second} select[aria-label="필터 조건"] option[value="greater_than"]')`, 3000)
      check('★ 연산자는 카탈로그의 한국어 라벨이다 — 숫자 속성이면 "초과"가 있고 "포함"은 없다',
        await evaluate(`(() => {
          const labels = [...document.querySelectorAll('${second} select[aria-label="필터 조건"] option')].map((o) => o.textContent)
          return labels.includes('초과') && !labels.includes('포함')
        })()`))
      await setSelect(`${second} select[aria-label="필터 조건"]`, 'greater_than')
      check('값이 없는 규칙은 아직 적용되지 않는다고 말한다',
        await waitFor(`document.querySelector('[data-testid="db-filter-panel"]')?.textContent.includes('값을 넣으면 적용됩니다')`, 3000))
      check('값이 없는 규칙은 보내지 않는다 — 거부 오류도 없고 행도 그대로다',
        (await rowCount()) === 50 && !(await evaluate(`!!document.querySelector('[data-testid="db-toolbar-error"]')`)),
        `${await rowCount()}행 · ${await evaluate(`document.querySelector('[data-testid="db-toolbar-error"]')?.textContent ?? '오류 없음'`)}`)
      await clickOn(`${second} input[data-testid="db-filter-value"]`)
      await typeText('10')
      await key('Enter')
      check('★ 수량 > 10 필터가 저장되어 한 행만 남는다 — 값이 빈 첫 규칙이 저장을 막지 않는다',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1`, 10000), `${await rowCount()}행`)
      check('필터 칩이 조건을 말한다 — 수량 · 초과 · 10',
        await waitFor(`[...document.querySelectorAll('[data-testid="db-filter-chip"]')].some((e) => e.textContent === '수량 · 초과 · 10')`, 5000),
        await chipTexts('db-filter-chip'))
      check('★ 저장 뒤에도 값이 빈 규칙이 패널에 남는다 — 서버 렌더가 초안을 덮지 않는다',
        await evaluate(`!!document.querySelector('[data-testid="db-filter-panel"]') && document.querySelectorAll('[data-testid="db-filter-rule"]').length === 2`),
        `규칙 ${await evaluate(`document.querySelectorAll('[data-testid="db-filter-rule"]').length`)}줄`)

      await send('Page.reload')
      await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
      check('★ 새로고침해도 필터 · 정렬이 남는다 — 뷰에 저장된 공유 상태다',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1
          && document.querySelectorAll('[data-testid="db-filter-chip"]').length === 1 && document.querySelectorAll('[data-testid="db-sort-chip"]').length === 1`, 10000),
        `${await rowCount()}행 · ${await chipTexts('db-filter-chip')} · ${await chipTexts('db-sort-chip')}`)

      await clickOn('[data-testid="db-filter-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-filter-remove"]')`, 3000)
      await clickOn('[data-testid="db-filter-remove"]')
      check('규칙을 지우면 필터가 없어지고 다시 50행 + "더 보기"다',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 50
          && !!document.querySelector('[data-testid="db-load-more"]') && !document.querySelector('[data-testid="db-filter-chip"]')`, 10000),
        `${await rowCount()}행`)
      await clickOn('[data-testid="db-filter-button"]')

      // ── 편집할 수 없는 필터 ──
      const viewUrl = `${BASE}/api/workspaces/${workspaceId}/views/${viewId}`
      const orFilter = { op: 'or', children: [
        { property_id: numberProp, operator: 'equals', value: 5 },
        { property_id: numberProp, operator: 'equals', value: 30 },
      ] }
      await fetch(viewUrl, { method: 'PATCH', headers: authed, body: JSON.stringify({ filter: orFilter }) })
      await send('Page.reload')
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)
      await clickOn('[data-testid="db-filter-button"]')
      check('★ OR 필터는 편집할 수 없다고 말한다 — 규칙 줄로 펴지 않는다',
        await waitFor(`!!document.querySelector('[data-testid="db-filter-not-editable"]') && !document.querySelector('[data-testid="db-filter-rule"]')`, 3000))
      check('★ 패널을 열어도 서버의 OR 필터는 그대로다 — AND 로 다시 저장하지 않는다',
        (await (await fetch(viewUrl, { headers: authed })).json()).view?.filter?.op === 'or')
      await clickOn('[data-testid="db-filter-clear"]')
      check('"필터 지우기" 로 없앤다',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 50 && !document.querySelector('[data-testid="db-filter-chip"]')`, 10000),
        `${await rowCount()}행`)

      // ── 속성(표시) ──
      await clickOn('[data-testid="db-properties-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-properties-panel"]')`, 3000)
      check('제목 속성의 표시 토글은 잠겨 있다 (F-04-12)',
        await evaluate(`document.querySelector('[data-testid="db-property-toggle"][data-property-id="${propIds[0]}"]')?.disabled === true`))
      await clickOn(`[data-testid="db-property-toggle"][data-property-id="${checkProp}"]`)
      check('★ 속성을 숨기면 표 머리에서 빠진다',
        await waitFor(`!document.querySelector('[data-testid="db-table"] thead th[data-property-id="${checkProp}"]')`, 10000))
      await clickOn('[data-testid="db-properties-button"]')

      // ── 이름 바꾸기 · 삭제 ──
      await clickOn(`th[data-property-id="${numberProp}"] [data-testid="db-column-menu"]`)
      await clickOn('[data-testid="db-column-rename"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 새 이름'`, 3000)
      await evaluate(`document.activeElement.select()`)
      await typeText('개수')
      await clickOn('[data-testid="db-column-rename-save"]')
      check('★ 머리 메뉴로 이름을 바꾸면 머리와 정렬 칩이 함께 바뀐다',
        await waitFor(`document.querySelector('th[data-property-id="${numberProp}"]')?.textContent.includes('개수')
          && [...document.querySelectorAll('[data-testid="db-sort-chip"]')].some((e) => e.textContent.includes('개수'))`, 10000),
        await chipTexts('db-sort-chip'))

      await clickOn(`th[data-property-id="${selectProp}"] [data-testid="db-column-menu"]`)
      await clickOn('[data-testid="db-column-delete"]')
      check('삭제는 메뉴 안에서 한 번 더 묻는다', await waitFor(`!!document.querySelector('[data-testid="db-column-delete-confirm"]')`, 3000))
      await clickOn('[data-testid="db-column-delete-confirm"]')
      check('★ 속성을 지우면 머리에서 빠진다',
        await waitFor(`!document.querySelector('[data-testid="db-table"] thead th[data-property-id="${selectProp}"]')`, 10000))

      // ── 정렬 지우기 ──
      await clickOn('[data-testid="db-sort-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-sort-remove"]')`, 3000)
      await clickOn('[data-testid="db-sort-remove"]')
      check('정렬을 지우면 칩이 사라지고 만든 순서로 돌아온다',
        await waitFor(`!document.querySelector('[data-testid="db-sort-chip"]')
          && document.querySelector('[data-testid="db-table"] tbody tr td[data-cell$=":0"]')?.textContent === ${JSON.stringify(title1)}`, 10000),
        JSON.stringify((await titles()).slice(0, 2)))

      section('익스포트 (F-09-14)')
      // 규칙(누가 · 범위 · 크기 거부 · 첨부 바이트)은 `download.db.test.ts` · `http.test.ts` 가 본다. 여기서는
      // 버튼 → 요약 → 링크 → **브라우저가 실제로 ZIP 을 디스크에 받는** 길을 프로덕션 빌드로 끝까지 본다.
      // 받은 ZIP 은 python zipfile 로 읽는다(우리가 짜지 않은 구현, HANDOFF §3.3-63).
      const downloads = mkdtempSync(join(tmpdir(), 'nc-e2e-download-'))
      try {
        await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
        const { findPython, runPythonJson } = await import(new URL('../src/lib/testing/external-tools.ts', import.meta.url).href)
        const python = findPython()
        const readZip = (file) => python === null
          ? { bad: 'python 없음', names: [], texts: {}, error: 'python 을 찾지 못해 받은 ZIP 을 읽지 못했다' }
          : runPythonJson(python, [
              'import sys, json, zipfile',
              'z = zipfile.ZipFile(sys.argv[1])',
              'names = [i.filename for i in z.infolist()]',
              "texts = {n: z.read(n).decode('utf-8') for n in names if n.endswith(('.md', '.csv', '.json'))}",
              'print(json.dumps({"bad": z.testzip(), "names": names, "texts": texts}))',
            ].join('\n'), [file])
        /** 받기가 끝나 이름이 맞는 파일이 생길 때까지. 받는 중에는 `.crdownload` 로 있다. */
        const downloaded = async (match) => {
          for (let i = 0; i < 150; i += 1) {
            const found = readdirSync(downloads).find((name) => match(name))
            if (found) return found
            await sleep(100)
          }
          return null
        }
        const exportPanelText = () => evaluate(`document.querySelector('[data-testid="export-panel"]')?.textContent ?? '(패널 없음)'`)
        const summaryMatches = (pattern, ms = 15000) =>
          waitFor(`${pattern}.test(document.querySelector('[data-testid="export-summary"]')?.textContent ?? '')`, ms)

        // ── 페이지 — 본문 한 줄 + 하위 페이지 ──
        const stamp = Date.now()
        const exportTitle = `내보내기 ${stamp}`
        const childTitle = `하위 ${stamp}`
        const newPage = async (body) =>
          (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
        const exportPage = await newPage({ title: exportTitle })
        await newPage({ parentPageId: exportPage, title: childTitle })
        const current = await readBody(exportPage)
        const prepared = await savePageBody(ctx, exportPage, {
          blocks: [block(randomUUID(), 'paragraph', '익스포트 본문 한 줄'), ...current.doc.blocks],
        }, { expectedVersion: current.version })
        check('내보낼 페이지를 준비했다 — 본문 한 줄 + 하위 페이지', prepared.ok, JSON.stringify(prepared))

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${exportPage}` })
        await waitFor(`!!document.querySelector('[data-testid="export-button"]')`, 15000)
        await clickOn('[data-testid="export-button"]')
        check('★ 누르면 먼저 센다 — 페이지 2개가 들어간다고 말한다', await summaryMatches('/^페이지 2 · 최대 /'), await exportPanelText())

        const staying = await evaluate('location.href')
        await clickOn('[data-testid="export-download"]')
        const pageZip = await downloaded((name) => name === `${exportTitle}.zip`)
        check('★ 내려받기를 누르면 브라우저가 ZIP 을 디스크에 받는다 — 이름은 페이지 제목', pageZip !== null,
          readdirSync(downloads).join(', ') || '(빈 폴더)')
        check('받는 동안 화면을 떠나지 않는다', (await evaluate('location.href')) === staying)
        if (pageZip) {
          const zip = readZip(join(downloads, pageZip))
          check('★ 받은 ZIP 에 페이지 · 하위 페이지 · 보고서가 이 순서로 있다',
            zip.bad === null && same(zip.names, [`${exportTitle}.md`, `${exportTitle}/${childTitle}.md`, '_export_report.json']),
            zip.error ?? JSON.stringify(zip.names))
          const markdown = zip.texts[`${exportTitle}.md`] ?? ''
          check('본문 글자와 하위 페이지 링크가 들어 있다', markdown.includes('익스포트 본문 한 줄') && markdown.includes(`[${childTitle}](`),
            markdown.slice(0, 300))
          check('보고서가 요약과 같은 개수를 센다', JSON.parse(zip.texts['_export_report.json'] ?? '{}').counts?.pages === 2)
        }

        // ── 워크스페이스 — 소유자만 ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=workspace.general` })
        check('소유자의 설정 — 일반 절에 전체 내보내기가 있다(8g-2 — 홈에서 옮겼다)',
          await waitFor(`document.querySelector('[data-testid="export-button"]')?.textContent === '워크스페이스 내보내기'`, 15000))
        await clickOn('[data-testid="export-button"]')
        // 표의 수는 앞 절들이 만든 것에 따라 달라진다(7c-4 가 teamspace 에 표를 만든다) — 소유자가 볼 수 있는 표의 수로 묻는다.
        const visibleTables = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/databases`, { headers: authed })).json()).databases.length
        check('★ 워크스페이스 요약은 표와 그 행까지 센다', await summaryMatches(`/데이터베이스 ${visibleTables} · 행 \\d+ ·/`), await exportPanelText())
        await clickOn('[data-testid="export-download"]')
        const workspaceZip = await downloaded((name) => /^워크스페이스 \d{4}-\d{2}-\d{2}\.zip$/.test(name))
        check('★ 워크스페이스 전체 ZIP 을 받는다', workspaceZip !== null, readdirSync(downloads).join(', '))
        if (workspaceZip) {
          const zip = readZip(join(downloads, workspaceZip))
          const report = JSON.parse(zip.texts['_export_report.json'] ?? '{}')
          check('★ 워크스페이스 ZIP 에 표의 CSV 와 앞에서 내보낸 페이지가 있고, 보고서의 범위가 워크스페이스다',
            zip.bad === null && zip.names.includes(`${dbName}.csv`) && zip.names.includes(`${exportTitle}.md`) && report.scope?.kind === 'workspace',
            zip.error ?? `${report.scope?.kind} · ${zip.names.filter((n) => !n.includes('/')).join(', ')}`)
        }

        // ── 표 — 풀페이지 표는 워크스페이스 직속이라 페이지 내보내기로는 닿지 않는다 ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${databaseId}` })
        await waitFor(`!!document.querySelector('[data-testid="export-button"]')`, 15000)
        await clickOn('[data-testid="export-button"]')
        check('★ 표 화면에서도 내보낸다 — 표 하나와 그 행들', await summaryMatches('/^데이터베이스 1 · 행 \\d+ · 최대 /'), await exportPanelText())
      } finally {
        try {
          rmSync(downloads, { recursive: true, force: true })
        } catch {
          /* 임시 폴더 */
        }
      }
      if (sectionIf('데이터베이스 보드 (보드 4b · F-04-03 · F-04-11)')) {
      // 규칙(드롭 자리 · 상태 · 되돌리기)은 `board-drag.test.ts` 가, 서버(셀 값 + 자리 한 트랜잭션 · 그룹 질의 · 커서)는
      // `group.db.test.ts` 가 본다. 여기서는 **실제 포인터로** 카드를 끌어 놓는 길과, 그 결과가 서버에 남는지를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다 — 그 절의 워크스페이스 요약이 표 개수(1)를 센다. 이 절은 표를 둘 더 만든다.
        const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }

        // ── 그룹으로 삼을 속성이 없으면 보드를 만들 수 없다 (§3.2-27) ──
        const bare = (await api('POST', '/databases', { name: `보드 없음 ${Date.now()}` })).body.database
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${bare.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-view-add"]')`, 15000)
        await clickOn('[data-testid="db-view-add"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-add-board"]')`, 3000)
        await clickOn('[data-testid="db-view-add-board"]')
        check('★ select · checkbox 속성이 없는 표에서 보드를 만들면 이유를 말한다(group_required) — 속성을 대신 만들지 않는다',
          (await waitFor(`document.querySelector('[data-testid="db-view-error"]')?.textContent.includes('그룹 기준')`, 8000))
            && (await api('GET', `/databases/${bare.id}/views`)).body.views.length === 1,
          await evaluate(`document.querySelector('[data-testid="db-view-error"]')?.textContent ?? '(오류 없음)'`))

        // ── 보드용 표: 상태(select) · 완료(checkbox) · 행 다섯 ──
        const db = (await api('POST', '/databases', { name: `보드 ${Date.now()}` })).body.database
        const dsId = db.dataSourceId
        const tableViewId = db.defaultViewId
        const statusProp = (await api('POST', `/data-sources/${dsId}/properties`, { name: '상태', type: 'select' })).body.property.id
        const doneProp = (await api('POST', `/data-sources/${dsId}/properties`, { name: '완료', type: 'checkbox' })).body.property.id
        const option = async (name) =>
          (await api('POST', `/data-sources/${dsId}/properties/${statusProp}/options`, { name })).body.option.id
        const todo = await option('할 일')
        const doing = await option('진행 중')
        const doneOpt = await option('완료')
        await option('보류') // 행이 없는 옵션 — 빈 그룹 숨김을 본다
        const titleProp = (await api('GET', `/views/${tableViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
        const addRow = async (title, status, done = false) =>
          (await api('POST', `/views/${tableViewId}/rows`, { cells: [
            { propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } },
            ...(status ? [{ propertyId: statusProp, value: { type: 'select', select: { id: status } } }] : []),
            ...(done ? [{ propertyId: doneProp, value: { type: 'checkbox', checkbox: true } }] : []),
          ] })).body.row.id
        const rowA = await addRow('A 카드', todo)
        const rowB = await addRow('B 카드', todo)
        const rowC = await addRow('C 카드', todo, true)
        const rowD = await addRow('D 카드', doing)
        const rowE = await addRow('E 카드', null)
        const rowOf = async (rowId) => (await api('GET', `/views/${tableViewId}/rows`)).body.rows.find((r) => r.id === rowId)
        const statusOf = async (rowId) => (await rowOf(rowId))?.properties[statusProp]?.select?.id ?? null

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
        await clickOn('[data-testid="db-view-add"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-add-board"]')`, 3000)
        await clickOn('[data-testid="db-view-add-board"]')
        check('★ "+ 보드 만들기" → 새 탭이 서고 보드가 그려진다 — 그룹은 첫 select(상태)가 자동으로 잡힌다',
          await waitFor(`new URL(location.href).searchParams.get('v') && !!document.querySelector('[data-testid="db-board"]')
            && document.querySelector('[data-testid="db-view-tab"][aria-current="page"]')?.dataset.viewType === 'board'`, 15000))
        const boardViewId = await evaluate(`new URL(location.href).searchParams.get('v')`)
        const columnsOf = () => evaluate(`[...document.querySelectorAll('[data-testid="db-board-column"]')]
          .map((c) => c.getAttribute('aria-label') + ':' + c.querySelector('[data-testid="db-board-count"]').textContent)`)
        const labelsOf = () => evaluate(`[...document.querySelectorAll('[data-testid="db-board-column"]')].map((c) => c.getAttribute('aria-label'))`)
        const cardsIn = (key) => evaluate(`[...document.querySelectorAll('[data-testid="db-board-column"][data-group-key="${key}"] [data-row-id]')].map((c) => c.dataset.rowId)`)
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
        check('★ 열은 "상태 없음" · 옵션 순서이고, 머리의 숫자는 그 그룹의 행 수다',
          same(await columnsOf(), ['상태 없음:1', '할 일:3', '진행 중:1', '완료:0', '보류:0']), JSON.stringify(await columnsOf()))
        check('카드는 제목과 배지(체크된 완료)를 보여 준다 — 그룹 프로퍼티 자체는 배지에 없다',
          await evaluate(`(() => { const c = document.querySelector('[data-row-id="${rowC}"]')
            return c?.querySelector('[data-testid="db-board-card-title"]')?.textContent === 'C 카드'
              && [...c.querySelectorAll('[data-testid="db-board-badge"]')].map((b) => b.textContent).join('|') === '☑ 완료' })()`))
        check('값이 빈 배지는 그리지 않는다 — A 카드에는 배지가 없다',
          await evaluate(`document.querySelectorAll('[data-row-id="${rowA}"] [data-testid="db-board-badge"]').length === 0`))

        // ── 드래그 ──
        const cardRect = (rowId) => rect(`[data-testid="db-board"] [data-row-id="${rowId}"]`)
        const columnRect = (key) => rect(`[data-testid="db-board-column"][data-group-key="${key}"]`)
        /** 카드 한가운데를 잡아 (tx, ty) 로 끈다. 놓지 않으면 드래그 중 상태로 돌아온다. */
        const dragCard = async (rowId, tx, ty, { drop = true } = {}) => {
          const r = await cardRect(rowId)
          const sx = r.x + r.w / 2
          const sy = r.y + r.h / 2
          await move(sx, sy)
          await press(sx, sy)
          for (let i = 1; i <= 10; i += 1) {
            await move(sx + ((tx - sx) * i) / 10, sy + ((ty - sy) * i) / 10, true)
            await sleep(16)
          }
          if (drop) {
            await release(tx, ty)
            await sleep(80)
          }
        }
        const dropShown = () => evaluate(`!!document.querySelector('[data-testid="db-board-drop"]')`)

        // A 를 "진행 중" 열의 맨 뒤로. 놓기 전에 자리 표시가 그 열에 선다.
        const doingCol = await columnRect(doing)
        const doingEnd = { x: doingCol.x + doingCol.w / 2, y: doingCol.y + doingCol.h - 10 }
        await dragCard(rowA, doingEnd.x, doingEnd.y, { drop: false })
        check('★ 끄는 동안 자리 표시가 대상 열에 서고 카드는 흐려진다',
          await evaluate(`!!document.querySelector('[data-testid="db-board-column"][data-group-key="${doing}"][data-drop-target] [data-testid="db-board-drop"]')
            && document.querySelector('[data-row-id="${rowA}"]')?.dataset.dragging === 'true'`))
        await release(doingEnd.x, doingEnd.y)
        check('★ 놓으면 카드가 그 열로 옮겨 가고 머리 숫자가 따라간다(낙관적)',
          (await waitFor(`!document.querySelector('[data-testid="db-board-drop"]') && !document.querySelector('[data-dragging]')`, 3000))
            && same(await cardsIn(doing), [rowD, rowA])
            && same(await columnsOf(), ['상태 없음:1', '할 일:2', '진행 중:2', '완료:0', '보류:0']),
          JSON.stringify(await columnsOf()))
        check('★ 서버에 셀 값이 남았다 — 드롭 = 요청 하나(셀 값 + 자리)', await poll(async () => (await statusOf(rowA)) === doing))

        // 열 안 재정렬: C 를 B 앞으로 (할 일: B, C → C, B)
        const bRect = await cardRect(rowB)
        await dragCard(rowC, bRect.x + bRect.w / 2, bRect.y + 4)
        check('★ 열 안에서 끌어 놓으면 순서가 바뀐다 — C 가 B 앞',
          await waitFor(`JSON.stringify([...document.querySelectorAll('[data-group-key="${todo}"] [data-row-id]')].map((c) => c.dataset.rowId)) === ${JSON.stringify(JSON.stringify([rowC, rowB]))}`, 3000),
          JSON.stringify(await cardsIn(todo)))
        await sleep(400) // 요청이 끝나길
        await send('Page.reload')
        await waitFor(`!!document.querySelector('[data-testid="db-board"]')`, 15000)
        check('★ 새로고침해도 열 · 순서가 남는다 — 자리의 정본은 서버(row_position)다',
          same(await cardsIn(todo), [rowC, rowB]) && same(await cardsIn(doing), [rowD, rowA]),
          `${JSON.stringify(await cardsIn(todo))} · ${JSON.stringify(await cardsIn(doing))}`)

        // 제자리 드롭은 요청을 만들지 않는다 — 버전이 그대로다
        const versionBefore = (await rowOf(rowB)).version
        const bNow = await cardRect(rowB)
        await dragCard(rowB, bNow.x + bNow.w / 2, bNow.y + bNow.h - 4)
        await sleep(300)
        check('★ 제자리(마지막 카드의 아래쪽)에 놓으면 요청을 보내지 않는다 — 버전이 그대로다',
          (await rowOf(rowB)).version === versionBefore && same(await cardsIn(todo), [rowC, rowB]))

        // ── 열 머리의 + : 그 그룹 값이 미리 채워진 새 카드 ──
        await clickOn(`[data-testid="db-board-column"][data-group-key="${doneOpt}"] [data-testid="db-board-add"]`)
        check('★ 열의 + 는 그 그룹 값이 미리 채워진 카드를 만들고 제목 입력칸을 연다',
          await waitFor(`document.activeElement?.matches('[data-testid="db-board-title-input"]')
            && document.querySelectorAll('[data-group-key="${doneOpt}"] [data-row-id]').length === 1`, 8000))
        const newCard = await evaluate(`document.querySelector('[data-group-key="${doneOpt}"] [data-row-id]')?.dataset.rowId`)
        await typeText('새 카드')
        await key('Enter')
        check('★ Enter 로 제목이 저장되고, 서버의 상태 값은 완료다',
          (await waitFor(`document.querySelector('[data-row-id="${newCard}"] [data-testid="db-board-card-title"]')?.textContent === '새 카드'`, 5000))
            && (await poll(async () => (await statusOf(newCard)) === doneOpt && (await rowOf(newCard))?.title === '새 카드')),
          JSON.stringify(await rowOf(newCard)))

        // ── 그룹 숨기기 · 보이기 (edit_structure) ──
        await clickOn(`[data-testid="db-board-column"][data-group-key=""] [data-testid="db-board-hide"]`)
        check('★ 열 머리에서 숨기면 열이 빠지고 "숨긴 그룹" 띠에 숫자와 함께 남는다',
          await waitFor(`!document.querySelector('[data-testid="db-board-column"][data-group-key=""]')
            && document.querySelector('[data-testid="db-board-hidden-group"]')?.textContent.includes('상태 없음')`, 10000))
        const strip = await rect('[data-testid="db-board-hidden"]')
        await dragCard(rowB, strip.x + 20, strip.y + strip.h / 2, { drop: false })
        check('숨긴 그룹으로는 끌어 놓을 수 없다 — 띠에는 자리 표시가 서지 않는다',
          !(await evaluate(`!!document.querySelector('[data-testid="db-board-hidden"] [data-testid="db-board-drop"]')`)))
        await key('Escape')
        check('Esc 로 취소하면 흐림과 자리 표시가 걷힌다',
          await waitFor(`!document.querySelector('[data-dragging]') && !document.querySelector('[data-testid="db-board-drop"]')`, 2000))
        await release(strip.x + 20, strip.y + strip.h / 2)
        await sleep(200)
        check('취소한 드래그는 아무것도 바꾸지 않는다', same(await cardsIn(todo), [rowC, rowB]))
        await clickOn('[data-testid="db-board-show"]')
        check('★ "보이기" 로 돌아온다',
          await waitFor(`!!document.querySelector('[data-testid="db-board-column"][data-group-key=""]') && !document.querySelector('[data-testid="db-board-hidden"]')`, 10000))

        // ── 도구줄 "그룹" 패널: 빈 그룹 숨기기 · 그룹 기준 바꾸기 ──
        const pickGroupProperty = (propertyId) => evaluate(`(() => {
          const s = document.querySelector('[data-testid="db-group-property"]')
          s.value = ${JSON.stringify(propertyId)}
          s.dispatchEvent(new Event('change', { bubbles: true }))
        })()`)
        await clickOn('[data-testid="db-group-button"]')
        await waitFor(`!!document.querySelector('[data-testid="db-group-panel"]')`, 3000)
        check('그룹 패널은 그룹 기준 · 빈 그룹 숨기기 · 그룹별 보이기를 보여 준다',
          await evaluate(`document.querySelector('[data-testid="db-group-property"]')?.value === '${statusProp}'
            && document.querySelectorAll('[data-testid="db-group-visible"]').length === 5`))
        await clickOn('[data-testid="db-group-hide-empty"]')
        check('★ 빈 그룹 숨기기 — 행이 없는 "보류" 열이 빠진다(완료는 새 카드가 있어 남는다)',
          await waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-board-column"]')].map((c) => c.getAttribute('aria-label'))) === ${JSON.stringify(JSON.stringify(['상태 없음', '할 일', '진행 중', '완료']))}`, 10000),
          JSON.stringify(await labelsOf()))
        await pickGroupProperty(doneProp)
        check('★ 그룹 기준을 체크박스로 바꾸면 열이 "체크 안 됨 · 체크됨" 이 된다',
          await waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-board-column"]')].map((c) => c.getAttribute('aria-label'))) === ${JSON.stringify(JSON.stringify(['체크 안 됨', '체크됨']))}`, 10000),
          JSON.stringify(await labelsOf()))
        check('체크됨 열에 C 카드가 있다', same(await cardsIn('true'), [rowC]), JSON.stringify(await cardsIn('true')))
        await pickGroupProperty(statusProp)
        await waitFor(`document.querySelector('[data-testid="db-board-column"]')?.getAttribute('aria-label') === '상태 없음'`, 10000)
        await clickOn('[data-testid="db-group-button"]')

        // ── 정렬이 걸린 보드: 열 안 이동은 없고, 열 사이 이동은 셀 값만 ──
        await api('PATCH', `/views/${boardViewId}`, { sorts: [{ property_id: titleProp, direction: 'asc' }] })
        await send('Page.reload')
        await waitFor(`document.querySelector('[data-testid="db-board"]')?.dataset.manualOrder === 'false'`, 15000)
        check('★ 정렬이 걸리면 열 안 순서는 정렬이 정한다 — 할 일: B, C (제목 오름차순 · 자리는 무시)',
          same(await cardsIn(todo), [rowB, rowC]), JSON.stringify(await cardsIn(todo)))
        const bSorted = await cardRect(rowB)
        await dragCard(rowC, bSorted.x + bSorted.w / 2, bSorted.y + 4, { drop: false })
        check('★ 정렬된 보드에서는 열 안에 자리 표시가 서지 않는다', !(await dropShown()))
        await release(bSorted.x + bSorted.w / 2, bSorted.y + 4)
        await sleep(200)
        check('놓아도 순서가 그대로다', same(await cardsIn(todo), [rowB, rowC]))
        const noneCol = await columnRect('')
        await dragCard(rowB, noneCol.x + noneCol.w / 2, noneCol.y + noneCol.h - 10)
        check('★ 정렬된 보드의 열 사이 이동은 셀 값만 바꾸고 자리는 정렬이 정한다 — 상태 없음: B, E',
          (await waitFor(`JSON.stringify([...document.querySelectorAll('[data-group-key=""] [data-row-id]')].map((c) => c.dataset.rowId)) === ${JSON.stringify(JSON.stringify([rowB, rowE]))}`, 5000))
            && (await poll(async () => (await statusOf(rowB)) === null)),
          JSON.stringify(await cardsIn('')))
        await api('PATCH', `/views/${boardViewId}`, { sorts: [] })

        // ── 종류 바꾸기: 보드 ↔ 표 ──
        await clickOn('[data-testid="db-view-menu"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-type-table"]')`, 3000)
        await clickOn('[data-testid="db-view-type-table"]')
        check('★ 뷰 메뉴로 표로 바꾸면 같은 뷰가 표로 그려진다',
          await waitFor(`!!document.querySelector('[data-testid="db-table"]') && !document.querySelector('[data-testid="db-board"]')
            && document.querySelector('[data-testid="db-view-tab"][aria-current="page"]')?.dataset.viewType === 'table'`, 10000))
        await clickOn('[data-testid="db-view-menu"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-type-board"]')`, 3000)
        await clickOn('[data-testid="db-view-type-board"]')
        check('다시 보드로 — 그룹 설정(빈 그룹 숨김)이 남아 있다',
          (await waitFor(`!!document.querySelector('[data-testid="db-board"]')`, 10000)) && !(await labelsOf()).includes('보류'),
          JSON.stringify(await labelsOf()))

        // ── 그룹 프로퍼티가 지워지면 "그룹 기준을 고르라" (§3.2-26) ──
        await api('DELETE', `/data-sources/${dsId}/properties/${statusProp}`)
        await send('Page.reload')
        check('★ 그룹 프로퍼티를 지우면 보드는 다른 속성을 자동으로 고르지 않고 고르라고 말한다',
          await waitFor(`!!document.querySelector('[data-testid="db-board-needs-group"]') && !document.querySelector('[data-testid="db-board"]')`, 15000))
        await clickOn('[data-testid="db-group-button"]')
        await waitFor(`!!document.querySelector('[data-testid="db-group-panel"]')`, 3000)
        await pickGroupProperty(doneProp)
        check('그룹 패널에서 체크박스 속성을 고르면 보드가 돌아온다',
          await waitFor(`!!document.querySelector('[data-testid="db-board"]') && document.querySelectorAll('[data-testid="db-board-column"]').length === 2`, 10000),
          JSON.stringify(await labelsOf()))
        await clickOn('[data-testid="db-group-button"]')
      }
      if (sectionIf('데이터베이스 상태 속성 (보드 4c-1 · F-03-05)')) {
      // 값 계약 · 그룹 불변식 · 기본 옵션 · 옵션 순서는 `status.db.test.ts` · `verify-schema` ⑭ 가 본다. 여기서는 화면이
      // 그것을 **보여 주는지**를 본다 — 색 점 칩 · 그룹 머리로 구획된 편집기 · 새 옵션의 자리 · 보드의 자동 선택.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다 — 보드 절 머리말과 같은 이유).
        const created = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/databases`, {
          method: 'POST', headers: authed, body: JSON.stringify({ name: `상태 ${Date.now()}` }),
        })).json()
        const statusDb = created.database
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${statusDb.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-add-column"]')`, 15000)

        await addColumn('진행', 'status')
        const statusProp = await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].at(-1)?.dataset.propertyId`)
        check('★ 상태 속성을 더하면 머리에 붙는다', await evaluate(`document.querySelector('th[data-property-id="${statusProp}"]')?.textContent.includes('진행')`))

        // ── 새 행은 기본 옵션을 받는다 ──
        await clickOn('[data-testid="db-add-row"]')
        await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 8000)
        await typeText('첫 일')
        await key('Enter')
        check('★ 새 행은 기본 옵션 "시작 전"을 받는다 — 색 점이 있는 칩(select 의 칩과 다르다)',
          await waitFor(`(() => { const chip = document.querySelector('td[data-cell="0:1"] [data-testid="db-option-chip"]')
            return chip?.textContent === '시작 전' && chip.dataset.statusGroup === 'todo' && chip.querySelector('span[aria-hidden]') !== null })()`, 8000),
          await evaluate(`document.querySelector('td[data-cell="0:1"]')?.innerHTML ?? '(칸 없음)'`))

        // ── 편집기: 그룹 머리 셋 · 새 옵션은 "할 일" 그룹에 ──
        const openStatusEditor = async () => {
          await clickOn('td[data-cell="0:1"]')
          await clickOn('td[data-cell="0:1"]')
          return waitFor(`document.activeElement?.matches('[data-testid="db-select-input"]')`, 3000)
        }
        const optionNames = () => evaluate(`[...document.querySelectorAll('[data-testid="db-option"] [data-testid="db-option-chip"]')].map((e) => e.textContent)`)
        check('상태 칸을 두 번 누르면 옵션 편집기가 열린다', await openStatusEditor())
        check('★ 편집기가 그룹 머리 셋으로 구획된다 — 할 일 · 진행 중 · 완료',
          JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-testid="db-status-group"]')].map((e) => e.textContent)`))
            === JSON.stringify(['할 일', '진행 중', '완료']))
        await typeText('검토')
        check('★ 새 옵션은 어느 그룹에 생기는지 말한다 — "할 일 그룹에"',
          await waitFor(`document.querySelector('[data-testid="db-create-option"]')?.textContent.includes('할 일 그룹에')`, 3000),
          await evaluate(`document.querySelector('[data-testid="db-create-option"]')?.textContent ?? '(없음)'`))
        await clickOn('[data-testid="db-create-option"]')
        check('만든 옵션이 칸에 들어간다 — 할 일 그룹의 칩',
          await waitFor(`(() => { const chip = document.querySelector('td[data-cell="0:1"] [data-testid="db-option-chip"]')
            return !document.querySelector('[data-testid="db-select-editor"]') && chip?.textContent === '검토' && chip.dataset.statusGroup === 'todo' })()`, 8000))
        await openStatusEditor()
        check('★ 새 옵션은 자기 그룹의 끝에 선다 — 새로고침 없이도 서버가 읽어 주는 순서다(완료 뒤가 아니다)',
          JSON.stringify(await optionNames()) === JSON.stringify(['시작 전', '검토', '진행 중', '완료']), JSON.stringify(await optionNames()))
        await key('Escape')
        await send('Page.reload')
        await waitFor(`!!document.querySelector('td[data-cell="0:1"] [data-testid="db-option-chip"]')`, 15000)
        await openStatusEditor()
        check('새로고침해도 같은 순서다', JSON.stringify(await optionNames()) === JSON.stringify(['시작 전', '검토', '진행 중', '완료']),
          JSON.stringify(await optionNames()))
        await key('Escape')

        // ── 보드: status 가 그룹 기준으로 잡힌다 · "없음" 열의 + 는 그 열에 남는다 ──
        await clickOn('[data-testid="db-view-add"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-add-board"]')`, 3000)
        await clickOn('[data-testid="db-view-add-board"]')
        await waitFor(`!!document.querySelector('[data-testid="db-board"]')`, 15000)
        const boardColumns = () => evaluate(`[...document.querySelectorAll('[data-testid="db-board-column"]')]
          .map((c) => c.getAttribute('aria-label') + ':' + c.querySelector('[data-testid="db-board-count"]').textContent)`)
        check('★ 보드를 만들면 상태 속성이 그룹 기준으로 잡히고 열이 그룹 순서다',
          JSON.stringify(await boardColumns()) === JSON.stringify(['진행 없음:0', '시작 전:0', '검토:1', '진행 중:0', '완료:0']),
          JSON.stringify(await boardColumns()))
        await clickOn(`[data-testid="db-board-column"][data-group-key=""] [data-testid="db-board-add"]`)
        await waitFor(`document.activeElement?.matches('[data-testid="db-board-title-input"]')`, 8000)
        await typeText('빈 카드')
        await key('Enter')
        check('★ "없음" 열의 + 로 만든 카드는 그 열에 남는다 — 기본 옵션의 열로 가지 않는다',
          (await waitFor(`document.querySelector('[data-group-key=""] [data-testid="db-board-card-title"]')?.textContent === '빈 카드'`, 5000))
            && JSON.stringify(await boardColumns()) === JSON.stringify(['진행 없음:1', '시작 전:0', '검토:1', '진행 중:0', '완료:0']),
          JSON.stringify(await boardColumns()))
        await send('Page.reload')
        await waitFor(`!!document.querySelector('[data-testid="db-board"]')`, 15000)
        check('새로고침해도 그 열에 있다 — 서버에도 빈 값으로 남았다',
          JSON.stringify(await boardColumns()) === JSON.stringify(['진행 없음:1', '시작 전:0', '검토:1', '진행 중:0', '완료:0']),
          JSON.stringify(await boardColumns()))
      }
      if (sectionIf('데이터베이스 List 뷰 (보드 4c-2 · F-04-04)')) {
      // 어느 칸을 접는지 · 제목이 앞인지는 `list-layout.test.ts` 가, 서버(그룹 없이 만들어진다 · 모양만 바뀐다)는
      // `view.db.test.ts` 가 본다. 여기서는 **같은 격자가 목록 모양으로 그려지는지**와, 표의 키보드 · 편집이 그 모양에서도
      // 그대로 도는지를 본다 — List 는 별도 컴포넌트가 아니다(F-04-04).
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
        const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const listDb = (await api('POST', '/databases', { name: `목록 ${Date.now()}` })).body.database
        const dsId = listDb.dataSourceId
        const tableViewId = listDb.defaultViewId
        const countProp = (await api('POST', `/data-sources/${dsId}/properties`, { name: '수량', type: 'number' })).body.property.id
        await api('POST', `/data-sources/${dsId}/properties`, { name: '완료', type: 'checkbox' })
        const titleProp = (await api('GET', `/views/${tableViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
        const addItem = async (title, count) =>
          (await api('POST', `/views/${tableViewId}/rows`, { cells: [
            { propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } },
            ...(count === undefined ? [] : [{ propertyId: countProp, value: { type: 'number', number: count } }]),
          ] })).body.row.id
        await addItem('A 항목', 3)
        const rowB = await addItem('B 항목')

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${listDb.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
        await clickOn('[data-testid="db-view-add"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-add-list"]')`, 3000)
        await clickOn('[data-testid="db-view-add-list"]')
        check('★ "+ 목록 만들기" → 새 탭이 서고 같은 격자가 목록 모양으로 그려진다',
          await waitFor(`document.querySelector('[data-testid="db-table"]')?.dataset.variant === 'list'
            && document.querySelector('[data-testid="db-view-tab"][aria-current="page"]')?.dataset.viewType === 'list'`, 15000))
        check('★ 머리 행은 화면에 없다 — 컬럼 이름은 스크린 리더에 남고, 머리 메뉴 · 속성 추가는 없다',
          await evaluate(`(() => { const head = document.querySelector('[data-testid="db-table"] thead')
            const r = head.getBoundingClientRect()
            return r.width <= 1 && r.height <= 1 && head.textContent.includes('수량')
              && !document.querySelector('[data-testid="db-column-menu"]') && !document.querySelector('[data-testid="db-add-column"]') })()`))
        check('★ 제목은 왼쪽, 값이 있는 속성은 오른쪽 — 빈 속성은 자리를 차지하지 않고 체크박스는 남는다',
          await evaluate(`(() => {
            const cell = (k) => document.querySelector('td[data-cell="' + k + '"]')
            const box = (k) => cell(k).getBoundingClientRect()
            return box('0:0').x < box('0:1').x && cell('0:1').textContent === '3'
              && cell('1:1').dataset.collapsed === 'true' && box('1:1').width === 0
              && cell('1:2').dataset.collapsed === undefined && box('1:2').width > 0
          })()`),
          await evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid="db-table"] tbody td')].map((td) => td.dataset.cell + ':' + (td.dataset.collapsed ?? '') + ':' + Math.round(td.getBoundingClientRect().width)))`))

        // ── 키보드: 표의 규칙 그대로 — 접혀 있던 빈 칸이 선다 ──
        await clickOn('td[data-cell="1:0"]')
        await key('ArrowRight')
        check('★ 키보드로 옮겨 가면 접혀 있던 빈 칸이 서고 무엇을 채우는 자리인지 말한다',
          await waitFor(`(() => { const td = document.querySelector('td[data-cell="1:1"]')
            return document.activeElement === td && td.dataset.collapsed === undefined && td.getBoundingClientRect().width > 0
              && td.querySelector('[data-testid="db-list-placeholder"]')?.textContent === '수량' })()`, 3000),
          await evaluate(`document.activeElement?.dataset?.cell ?? '(포커스 없음)'`))
        await key('Enter')
        await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 3000)
        await typeText('7')
        await key('Enter')
        check('★ 그 자리에서 값을 넣으면 배지가 된다 — 셀 편집이 표와 한 벌이다',
          (await waitFor(`document.querySelector('td[data-cell="1:1"]')?.textContent === '7'`, 5000))
            && (await poll(async () => ((await api('GET', `/views/${tableViewId}/rows`)).body.rows.find((r) => r.id === rowB)?.properties[countProp]?.number) === 7)))
        await clickOn('td[data-cell="0:0"]')
        check('다른 칸으로 옮겨도 값이 있는 칸은 남는다', await evaluate(`document.querySelector('td[data-cell="1:1"]')?.dataset.collapsed === undefined`))

        // ── 새 항목 ──
        await clickOn('[data-testid="db-add-row"]')
        await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 8000)
        await typeText('C 항목')
        await key('Enter')
        check('"+ 새로 만들기" 가 목록 끝에 항목을 더하고 제목을 바로 받는다',
          await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 3
            && document.querySelector('td[data-cell="2:0"]')?.textContent === 'C 항목'`, 8000))

        // ── 종류 바꾸기: list → 표 ──
        await clickOn('[data-testid="db-view-menu"]')
        await waitFor(`!!document.querySelector('[data-testid="db-view-type-table"]')`, 3000)
        await clickOn('[data-testid="db-view-type-table"]')
        check('★ 표로 바꾸면 같은 뷰가 머리 행 · 머리 메뉴와 함께 표로 그려진다',
          await waitFor(`document.querySelector('[data-testid="db-table"]')?.dataset.variant === 'table'
            && !!document.querySelector('[data-testid="db-column-menu"]')
            && document.querySelector('td[data-cell="1:1"]')?.textContent === '7'`, 10000))
      }
      if (sectionIf('데이터베이스 relation 칸 (relation 5b-1 · F-03-10)')) {
      // 엣지 · 거울상 · 권한 · 제목 맵의 규칙은 `relation.db.test.ts` · `verify-schema` ⑮ 가 본다. 여기서는 화면이 그것을
      // **그리는지**를 본다 — 제목 칩 · 휴지통에 간 연결 · "더 보기"로 온 행의 제목 · 목록과 보드의 배지.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 둘 더 만든다).
        const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const stamp = Date.now()
        const projects = (await api('POST', '/databases', { name: `프로젝트 ${stamp}` })).body.database
        const tasks = (await api('POST', '/databases', { name: `작업 ${stamp}` })).body.database
        const made = (await api('POST', `/data-sources/${tasks.dataSourceId}/relations`, {
          name: '프로젝트', targetDataSourceId: projects.dataSourceId, twoWay: { name: '작업들' },
        })).body
        const relId = made.property.id
        const titleOf = async (db) => (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
        const rowIn = async (db, titleProp, title) =>
          (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } }] })).body.row.id
        const projectTitle = await titleOf(projects)
        const taskTitle = await titleOf(tasks)
        const alpha = await rowIn(projects, projectTitle, '알파')
        const beta = await rowIn(projects, projectTitle, '베타')
        const gone = await rowIn(projects, projectTitle, '버릴 것')
        const gamma = await rowIn(projects, projectTitle, '감마')
        const t1 = await rowIn(tasks, taskTitle, '작업 하나')
        const t2 = await rowIn(tasks, taskTitle, '작업 둘')
        const t3 = await rowIn(tasks, taskTitle, '작업 셋')
        await api('POST', `/rows/${t1}/relations/${relId}`, { add: [alpha, beta, gone] })
        await api('POST', `/rows/${t2}/relations/${relId}`, { add: [gamma] })
        await api('DELETE', `/rows/${gone}`)

        const chipsIn = (cell) => evaluate(`[...document.querySelectorAll('td[data-cell="${cell}"] [data-testid="db-relation-chip"]')].map((e) => e.textContent.replace('↗', '').trim())`)
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)
        check('★ relation 컬럼이 표에 서고, 연결된 행의 제목이 칩으로 보인다 — 첫 화면에 함께 온다(서버 렌더)',
          (await evaluate(`document.querySelector('th[data-property-id="${relId}"]')?.textContent.includes('프로젝트')`))
            && same(await chipsIn('0:1'), ['알파', '베타']),
          JSON.stringify(await chipsIn('0:1')))
        check('★ 휴지통에 간 연결은 칩도 "볼 수 없는 연결"도 아니다 — 그냥 없다(복원하면 돌아온다)',
          await evaluate(`!document.querySelector('td[data-cell="0:1"] [data-testid="db-relation-hidden"]')
            && !document.querySelector('[data-testid="db-table"]').textContent.includes('버릴 것')`))
        check('연결이 없는 칸은 비어 있다', same(await chipsIn('2:1'), []))

        await clickOn('td[data-cell="0:1"]')
        await clickOn('td[data-cell="0:1"]')
        check('★ relation 칸을 한 번 더 누르면 행 고르기가 열린다 — 위에는 지금 연결(휴지통에 간 것은 없다), 포커스는 검색칸',
          (await waitFor(`document.querySelectorAll('[data-testid="db-relation-linked"]').length === 2`, 8000))
            && (await evaluate(`document.querySelector('td[data-editing]')?.dataset.cell === '0:1'
              && document.activeElement?.matches('[data-testid="db-relation-input"]')
              && !document.querySelector('[data-testid="db-relation-editor"]').textContent.includes('버릴 것')`)))
        await key('Escape')
        check('Esc 는 고르기를 닫고 칸에 선택을 남긴다',
          await waitFor(`!document.querySelector('[data-testid="db-relation-editor"]') && document.activeElement?.dataset?.cell === '0:1'`, 3000))

        await clickOn('[data-testid="db-filter-button"]')
        await waitFor(`!!document.querySelector('[data-testid="db-filter-panel"]')`, 3000)
        await clickOn('[data-testid="db-filter-add"]')
        check('★ 필터 패널의 속성 목록에 relation 이 없다 — 값이 셀이 아니라 거를 축이 없다',
          await waitFor(`(() => { const s = document.querySelector('select[aria-label="필터 속성"]')
            return !!s && ![...s.options].some((o) => o.textContent === '프로젝트') })()`, 5000))
        await clickOn('[data-testid="db-filter-remove"]')
        await clickOn('[data-testid="db-filter-button"]')

        // ── "더 보기"로 온 행의 제목은 그때 받는다 ──
        await api('PATCH', `/views/${tasks.defaultViewId}`, { loadLimit: 1 })
        await send('Page.reload')
        await waitFor(`!!document.querySelector('[data-testid="db-load-more"]')`, 15000)
        check('첫 화면에는 한 행뿐이다 — 감마의 제목은 아직 화면에 없다',
          (await evaluate(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length`)) === 1
            && !(await evaluate(`document.documentElement.outerHTML.includes('감마')`)))
        await clickOn('[data-testid="db-load-more"]')
        check('★ "더 보기"로 온 행의 제목은 그때 받아 칩이 선다 — 캐시의 id 로 직접 읽지 않는다',
          await waitFor(`[...document.querySelectorAll('td[data-cell="1:1"] [data-testid="db-relation-chip"]')].map((e) => e.textContent.replace('↗', '').trim()).join() === '감마'`, 8000),
          JSON.stringify(await chipsIn('1:1')))
        await api('PATCH', `/views/${tasks.defaultViewId}`, { loadLimit: 50 })

        // ── 반대쪽 표: 거울상이 칸에 보인다 ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${projects.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)
        check('★ 양방향 — 프로젝트 표의 "작업들" 칸에 그 작업이 보인다(한쪽에서만 연결했다)',
          (await evaluate(`document.querySelector('th[data-property-id="${made.syncedPropertyId}"]')?.textContent.includes('작업들')`))
            && same(await chipsIn('0:1'), ['작업 하나']) && same(await chipsIn('2:1'), ['작업 둘']),
          `${JSON.stringify(await chipsIn('0:1'))} · ${JSON.stringify(await chipsIn('2:1'))}`)

        // ── 목록 · 보드의 배지 ──
        const listView = (await api('POST', `/databases/${tasks.id}/views`, { type: 'list', name: '목록' })).body.view
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}?v=${listView.id}` })
        await waitFor(`document.querySelector('[data-testid="db-table"]')?.dataset.variant === 'list'`, 15000)
        check('★ 목록에서도 칩이 서고, 연결이 없는 칸은 접힌다',
          same(await chipsIn('0:1'), ['알파', '베타'])
            && (await evaluate(`document.querySelector('td[data-cell="2:1"]')?.dataset.collapsed === 'true'`)),
          JSON.stringify(await chipsIn('0:1')))

        await api('POST', `/data-sources/${tasks.dataSourceId}/properties`, { name: '상태', type: 'status' })
        const boardView = (await api('POST', `/databases/${tasks.id}/views`, { type: 'board', name: '보드' })).body.view
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}?v=${boardView.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-board-card"]')`, 15000)
        check('★ 보드 카드의 배지에도 제목 칩이 선다',
          same(await evaluate(`[...document.querySelectorAll('[data-row-id="${t1}"] [data-testid="db-relation-chip"]')].map((e) => e.textContent.replace('↗', '').trim())`), ['알파', '베타'])
            && (await evaluate(`document.querySelectorAll('[data-row-id="${t3}"] [data-testid="db-relation-chip"]').length`)) === 0)
      }

      if (sectionIf('데이터베이스 relation 고르기 (relation 5b-2 · F-03-10)')) {
      // 후보 검색의 규칙(이미 연결된 행 제외 · LIKE 글자 그대로 · 권한)은 `relation.db.test.ts` ⑩ 이 본다. 여기서는 사람이
      // 하는 순서를 본다 — 속성 추가 폼에서 관계형을 만들고, 칸에서 찾아 고르고, × 로 빼고, 반대쪽 표에서 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 둘 더 만든다).
        const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const stamp = Date.now()
        const customers = (await api('POST', '/databases', { name: `고객 ${stamp}` })).body.database
        const orders = (await api('POST', '/databases', { name: `주문 ${stamp}` })).body.database
        const titleOf = async (db) => (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
        const rowIn = async (db, titleProp, title) =>
          (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } }] })).body.row.id
        const customerTitle = await titleOf(customers)
        const orderTitle = await titleOf(orders)
        for (const name of ['가나상사', '가나다라', '100%_할인', '다른 곳']) await rowIn(customers, customerTitle, name)
        const o1 = await rowIn(orders, orderTitle, '주문 1')
        await rowIn(orders, orderTitle, '주문 2')

        const chipsIn = (cell) => evaluate(`[...document.querySelectorAll('td[data-cell="${cell}"] [data-testid="db-relation-chip"]')].map((e) => e.textContent.replace('↗', '').trim())`)
        const candidates = () => evaluate(`[...document.querySelectorAll('[data-testid="db-relation-candidate"]')].map((e) => e.textContent.trim())`)
        const linked = () => evaluate(`[...document.querySelectorAll('[data-testid="db-relation-linked"] > span')].map((e) => e.textContent.replace('↗', '').trim())`)
        const candidatesAre = (expected, ms = 8000) =>
          waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-relation-candidate"]')].map((e) => e.textContent.trim())) === ${JSON.stringify(JSON.stringify(expected))}`, ms)
        const chipsAre = (cell, expected, ms = 8000) =>
          waitFor(`JSON.stringify([...document.querySelectorAll('td[data-cell="${cell}"] [data-testid="db-relation-chip"]')].map((e) => e.textContent.replace('↗', '').trim())) === ${JSON.stringify(JSON.stringify(expected))}`, ms)
        const openEditor = async (cell) => {
          await clickOn(`td[data-cell="${cell}"]`)
          await clickOn(`td[data-cell="${cell}"]`)
          return waitFor(`document.activeElement?.matches('[data-testid="db-relation-input"]')`, 8000)
        }
        const search = async (text) => {
          await evaluate(`document.querySelector('[data-testid="db-relation-input"]').select()`)
          await typeText(text)
        }

        // ── 속성 추가 폼에서 관계형을 만든다 ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${orders.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)
        await clickOn('[data-testid="db-add-column"]')
        await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
        await typeText('고객')
        await setSelect('select[aria-label="속성 유형"]', 'relation')
        check('★ 유형에서 "관계형"을 고르면 볼 수 있는 데이터베이스가 대상 목록에 선다 — 이 표는 "(이 표)"로 짚는다',
          await waitFor(`(() => { const s = document.querySelector('[data-testid="db-relation-target"]')
            if (!s || s.disabled) return false
            const texts = [...s.options].map((o) => o.textContent)
            return texts.includes(${JSON.stringify(`고객 ${stamp}`)}) && texts.includes(${JSON.stringify(`주문 ${stamp} (이 표)`)}) })()`, 8000))
        await setSelect('[data-testid="db-relation-target"]', customers.dataSourceId)
        await clickOn('[data-testid="db-relation-twoway"]')
        check('"반대쪽에도 표시"를 켜면 역방향 이름을 받는다 — 기본값은 이 표의 이름이다',
          await waitFor(`document.querySelector('[data-testid="db-relation-inverse-name"]')?.value === ${JSON.stringify(`주문 ${stamp}`)}`, 3000))
        const clip = await unclipped('[data-testid="db-add-column-form"]')
        check('관계형 폼(칸이 셋 더 있다)이 잘리지 않는다', clip.ok, clip.detail)
        await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
        check('★ 만들면 새로고침 없이 relation 컬럼이 머리에 선다',
          (await waitFor(`!document.querySelector('[data-testid="db-add-column-form"]')`, 8000))
            && (await waitFor(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].map((th) => th.textContent).some((t) => t.includes('고객') && t.includes('관계형'))`, 5000)))
        const relId = await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')][1]?.dataset.propertyId ?? null`)

        // ── 찾아서 고른다 ──
        check('★ 방금 만든 컬럼의 칸을 바로 열 수 있다 — 후보는 대상 표의 행 전부, 표의 순서대로',
          (await openEditor('0:1')) && (await candidatesAre(['가나상사', '가나다라', '100%_할인', '다른 곳'])),
          JSON.stringify(await candidates()))
        const popClip = await unclipped('[data-testid="db-relation-editor"]')
        check('행 고르기 팝오버가 잘리지 않는다', popClip.ok, popClip.detail)
        await clickOn('td[data-cell="0:1"]')
        check('★ 열린 채로 칸을 또 눌러도 포커스는 검색칸에 남는다 — 칸이 가져가면 고르려던 Enter 가 아래 칸으로 내려간다',
          await evaluate(`document.activeElement?.matches('[data-testid="db-relation-input"]') && !!document.querySelector('[data-testid="db-relation-editor"]')`))

        await search('가나')
        check('★ 글자를 치면 제목으로 좁혀진다', await candidatesAre(['가나상사', '가나다라']), JSON.stringify(await candidates()))
        await key('ArrowDown')
        await key('Enter')
        check('★ ↓ · Enter 로 고르면 그 자리에서 저장되고 칩이 선다 — 표의 Enter(아래 칸으로)가 아니다',
          (await chipsAre('0:1', ['가나다라']))
            && (await evaluate(`document.querySelector('td[data-editing]')?.dataset.cell === '0:1'`)),
          JSON.stringify(await chipsIn('0:1')))
        check('★ 고른 행은 위(지금 연결)로 가고 후보에서 빠진다 — 팝오버는 열려 있다(여러 개를 고른다)',
          same(await linked(), ['가나다라']) && (await candidatesAre(['가나상사']))
            && (await evaluate(`document.activeElement?.matches('[data-testid="db-relation-input"]')`)),
          `${JSON.stringify(await linked())} · ${JSON.stringify(await candidates())}`)

        await clickOn('[data-testid="db-relation-candidate"]')
        check('★ 눌러서 고른다 — 팝오버가 닫히지 않는다(mousedown 이 포커스를 빼앗지 않는다)',
          (await chipsAre('0:1', ['가나다라', '가나상사']))
            && (await evaluate(`!!document.querySelector('[data-testid="db-relation-editor"]')`)),
          JSON.stringify(await chipsIn('0:1')))
        const stored = (await api('GET', `/rows/${o1}/relations/${relId}`)).body
        check('서버에 엣지 둘이 있다', stored?.items?.length === 2, JSON.stringify(stored?.items?.map((i) => i.title)))

        await search('%')
        check('★ "%" 는 글자다 — 전부가 아니라 "100%_할인" 하나만 나온다', await candidatesAre(['100%_할인']), JSON.stringify(await candidates()))

        // ── × 로 뺀다 ──
        await search('가나')
        await candidatesAre([])
        await clickOn('[data-testid="db-relation-unlink"]')
        check('★ × 는 그 연결 하나만 뺀다 — 칩이 줄고, 뺀 행은 다시 후보다',
          (await chipsAre('0:1', ['가나상사'])) && (await candidatesAre(['가나다라'])) && same(await linked(), ['가나상사']),
          `${JSON.stringify(await chipsIn('0:1'))} · ${JSON.stringify(await candidates())}`)
        await key('Escape')
        check('Esc 로 닫으면 칸에 선택이 남는다',
          await waitFor(`!document.querySelector('[data-testid="db-relation-editor"]') && document.activeElement?.dataset?.cell === '0:1'`, 3000))

        // ── 반대쪽 표 ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${customers.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)
        check('★ 양방향 — 고객 표에 역방향 컬럼이 생겼고, "가나상사" 칸에 그 주문이 보인다',
          (await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')][1]?.textContent.includes(${JSON.stringify(`주문 ${stamp}`)})`))
            && same(await chipsIn('0:1'), ['주문 1']) && same(await chipsIn('1:1'), []),
          `${JSON.stringify(await chipsIn('0:1'))} · ${JSON.stringify(await chipsIn('1:1'))}`)
        await openEditor('1:1')
        await candidatesAre(['주문 1', '주문 2'])
        await search('주문 2')
        await candidatesAre(['주문 2'])
        await key('Enter')
        await chipsAre('1:1', ['주문 2'])
        await key('Escape')
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${orders.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"] tbody tr')`, 15000)
        check('★ 반대쪽에서 고른 연결이 이쪽 칸에 선다 — "주문 2" 의 고객이 "가나다라"',
          same(await chipsIn('1:1'), ['가나다라']) && same(await chipsIn('0:1'), ['가나상사']),
          `${JSON.stringify(await chipsIn('0:1'))} · ${JSON.stringify(await chipsIn('1:1'))}`)

        // ── 하나만 연결 ──
        await clickOn('[data-testid="db-add-column"]')
        await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
        await typeText('담당 고객')
        await setSelect('select[aria-label="속성 유형"]', 'relation')
        await waitFor(`document.querySelector('[data-testid="db-relation-target"]')?.disabled === false`, 8000)
        await setSelect('[data-testid="db-relation-target"]', customers.dataSourceId)
        await clickOn('[data-testid="db-relation-limit-one"]')
        await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]').length === 3`, 8000)
        await openEditor('0:2')
        await candidatesAre(['가나상사', '가나다라', '100%_할인', '다른 곳'])
        await clickOn('[data-testid="db-relation-candidate"]')
        check('★ "하나만 연결" 칸은 고르는 즉시 닫힌다 — 더 고를 것이 없다',
          (await chipsAre('0:2', ['가나상사']))
            && (await waitFor(`!document.querySelector('[data-testid="db-relation-editor"]') && document.activeElement?.dataset?.cell === '0:2'`, 3000)),
          JSON.stringify(await chipsIn('0:2')))
        await openEditor('0:2')
        await search('다른')
        await candidatesAre(['다른 곳'])
        await key('Enter')
        check('★ 다시 고르면 **바뀐다** — 둘이 되지 않는다',
          await chipsAre('0:2', ['다른 곳']), JSON.stringify(await chipsIn('0:2')))
      }

      if (sectionIf('데이터베이스 rollup — 서버 (rollup 5c-1 · F-03-11)')) {
      // 집계 함수 · 권한 · 끊긴 설정의 규칙은 `rollup-functions.test.ts` · `rollup.db.test.ts` 가 본다. 화면은 5c-2 가 붙인다 —
      // 여기서는 빌드된 앱에서 라우트 둘이 실제로 답하는지, 그리고 **rollup 속성이 있어도 표가 열리는지**를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 둘 더 만든다).
        const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const stamp = Date.now()
        const projects = (await api('POST', '/databases', { name: `롤업 프로젝트 ${stamp}` })).body.database
        const tasks = (await api('POST', '/databases', { name: `롤업 작업 ${stamp}` })).body.database
        const hours = (await api('POST', `/data-sources/${tasks.dataSourceId}/properties`, { name: '시간', type: 'number' })).body.property.id
        const made = (await api('POST', `/data-sources/${tasks.dataSourceId}/relations`, {
          name: '프로젝트', targetDataSourceId: projects.dataSourceId, twoWay: { name: '작업들' },
        })).body
        const titleOf = async (db) => (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
        const projectTitle = await titleOf(projects)
        const taskTitle = await titleOf(tasks)
        const rowIn = async (db, cells) => (await api('POST', `/views/${db.defaultViewId}/rows`, { cells })).body.row.id
        const titled = (propertyId, title) => ({ propertyId, value: { type: 'title', title: [textRun(title)] } })
        const p1 = await rowIn(projects, [titled(projectTitle, '프로젝트 하나')])
        const p2 = await rowIn(projects, [titled(projectTitle, '빈 프로젝트')])
        const t1 = await rowIn(tasks, [titled(taskTitle, '설계'), { propertyId: hours, value: { type: 'number', number: 3 } }])
        const t2 = await rowIn(tasks, [titled(taskTitle, '구현'), { propertyId: hours, value: { type: 'number', number: 4.5 } }])
        const t3 = await rowIn(tasks, [titled(taskTitle, '시간 없음')])
        await api('POST', `/rows/${p1}/relations/${made.syncedPropertyId}`, { add: [t1, t2, t3] })

        const rollupOf = (name, fn, extra = {}) =>
          api('POST', `/data-sources/${projects.dataSourceId}/rollups`, {
            name, relationPropertyId: made.syncedPropertyId, targetPropertyId: hours, function: fn, ...extra,
          })
        // 거부되는 것을 먼저 보낸다 — 그 뒤에 성공한 요청의 스키마에 그 이름들이 없어야 한다.
        const mismatch = await rollupOf('틀린 함수', 'percent_checked')
        const foreign = await rollupOf('남의 relation', 'sum', { relationPropertyId: made.property.id })
        const sum = await rollupOf('총 시간', 'sum')
        const average = await rollupOf('평균 시간', 'average')
        check('★ rollup 속성을 만든다 — 스키마에 `rollup` 타입으로 서고 config 는 relation · 대상 · 함수다',
          sum.status === 201 && sum.body?.property?.type === 'rollup'
            && sum.body.property.config.relation_property_id === made.syncedPropertyId
            && sum.body.property.config.target_property_id === hours && sum.body.property.config.function === 'sum',
          JSON.stringify(sum.body?.property ?? sum.body))

        check('★ 맞지 않는 함수 · 이 표의 것이 아닌 relation 은 거부한다 — 아무것도 생기지 않는다',
          mismatch.status === 400 && mismatch.body?.error === 'invalid_config'
            && foreign.status === 400 && foreign.body?.error === 'invalid_target'
            && average.body?.schema?.properties?.map((p) => p.name).join() === ['이름', '작업들', '총 시간', '평균 시간'].join(),
          `${mismatch.status} ${JSON.stringify(mismatch.body)} · ${foreign.status} ${JSON.stringify(foreign.body)} · ${average.body?.schema?.properties?.map((p) => p.name).join()}`)

        const values = await api('POST', `/data-sources/${projects.dataSourceId}/rollup-values`, { rowIds: [p1, p2] })
        const cellOf = (rowId, property) => values.body?.values?.[rowId]?.[property.body.property.id]
        check('★ 값은 읽을 때 계산된다 — 합 7.5 · 평균 3.75(시간이 없는 작업은 분모에 들지 않는다)',
          values.status === 200 && cellOf(p1, sum)?.result?.number === 7.5 && cellOf(p1, average)?.result?.number === 3.75
            && cellOf(p1, sum)?.hidden === 0,
          JSON.stringify(values.body?.values?.[p1]))
        check('★ 연결이 없는 행 — 합은 0 이고 평균은 **없음**이다(0 이 아니다)',
          cellOf(p2, sum)?.result?.number === 0 && cellOf(p2, average)?.result?.number === null,
          JSON.stringify(values.body?.values?.[p2]))

        const written = await api('PATCH', `/rows/${p1}`, { cells: [{ propertyId: sum.body.property.id, value: { type: 'number', number: 99 } }] })
        check('rollup 칸에는 쓸 수 없다 — 읽기 전용이다', written.status >= 400 && written.status < 500, `${written.status} ${JSON.stringify(written.body)}`)

        // ── 화면 (5c-2) ──
        const rollupIn = (cell) => evaluate(`document.querySelector('td[data-cell="${cell}"] [data-testid="db-rollup-value"]')?.textContent.trim() ?? null`)
        const rollupIs = (cell, expected, ms = 8000) =>
          waitFor(`(document.querySelector('td[data-cell="${cell}"] [data-testid="db-rollup-value"]')?.textContent.trim() ?? null) === ${JSON.stringify(expected)}`, ms)

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${projects.id}` })
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)
        const heads = () => evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].map((th) => th.textContent)`)
        check('★ rollup 컬럼이 표에 서고 머리가 "롤업"이라고 말한다',
          (await heads()).filter((t) => t.includes('총 시간') && t.includes('롤업')).length === 1,
          JSON.stringify(await heads()))
        check('★ 값은 첫 화면에 함께 온다(서버 렌더가 계산한다) — 합 7.5 · 평균 3.75',
          (await rollupIn('0:2')) === '7.5' && (await rollupIn('0:3')) === '3.75',
          `${await rollupIn('0:2')} · ${await rollupIn('0:3')}`)
        check('★ 연결이 없는 행 — 합은 **0 을 그리고** 평균은 **빈 칸**이다(0 이 아니다)',
          (await rollupIn('1:2')) === '0' && (await rollupIn('1:3')) === null,
          `${await rollupIn('1:2')} · ${await rollupIn('1:3')}`)

        await clickOn('td[data-cell="0:2"]')
        await clickOn('td[data-cell="0:2"]')
        check('★ rollup 칸은 읽기 전용이다 — 두 번 눌러도 편집기가 열리지 않는다',
          (await evaluate(`document.querySelector('td[data-cell="0:2"]')?.getAttribute('aria-readonly') === 'true'`))
            && !(await evaluate(`!!document.querySelector('td[data-editing]') || !!document.querySelector('[data-testid="db-cell-input"]')`)))

        // ── 속성 추가 폼의 "롤업" — 관계 → 속성 → 계산 ──
        await clickOn('[data-testid="db-add-column"]')
        await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
        await typeText('작업 수')
        await setSelect('select[aria-label="속성 유형"]', 'rollup')
        check('★ "롤업"을 고르면 3단이 뜬다 — 관계(이 표의 관계형) · 모을 속성(대상 표의 것) · 계산',
          await waitFor(`(() => {
            const rel = document.querySelector('[data-testid="db-rollup-relation"]')
            const target = document.querySelector('[data-testid="db-rollup-target"]')
            const fn = document.querySelector('[data-testid="db-rollup-function"]')
            if (!rel || !target || !fn || target.disabled) return false
            return [...rel.options].some((o) => o.textContent === '작업들')
              && [...target.options].map((o) => o.textContent).join() === '이름,시간'
              && [...fn.options].some((o) => o.textContent === '개수')
          })()`, 8000),
          await evaluate(`[...(document.querySelector('[data-testid="db-rollup-target"]')?.options ?? [])].map((o) => o.textContent).join()`))
        check('★ 계산 목록은 **모을 속성의 타입**이 정한다 — 글에는 합계가 없다',
          await evaluate(`(() => {
            const fn = document.querySelector('[data-testid="db-rollup-function"]')
            return !!fn && ![...fn.options].some((o) => o.textContent === '합계')
          })()`))
        await setSelect('[data-testid="db-rollup-function"]', 'count')
        await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
        check('★ 만들면 새로고침 없이 컬럼이 서고 **값까지 채워진다** — 이미 불러온 행의 새 칸도 받는다',
          (await waitFor(`!document.querySelector('[data-testid="db-add-column-form"]')`, 8000))
            && (await rollupIs('0:4', '3')) && (await rollupIs('1:4', '0')),
          `${await rollupIn('0:4')} · ${await rollupIn('1:4')}`)

        // ── relation 을 고치면 그 행의 rollup 을 다시 묻는다 ──
        await clickOn('td[data-cell="1:1"]')
        await clickOn('td[data-cell="1:1"]')
        // ★ 후보는 팝오버가 열린 **뒤에** 온다 — 기다리지 않고 누르면 아무것도 고르지 않는다(처음에 그렇게 썼다가
        //   이 절과 다음 절이 함께 틀렸다). 고른 뒤의 값을 보는 검사이므로 여기서 눌린 것까지 같이 본다.
        const picked =
          (await waitFor(`document.querySelectorAll('[data-testid="db-relation-candidate"]').length > 0`, 8000)) &&
          (await clickOn('[data-testid="db-relation-candidate"]'))
        check('★ 연결을 더하면 **그 행의 rollup 이 다시 계산된다** — 값은 연결을 타고 나온다',
          picked && (await rollupIs('1:4', '1')) && (await rollupIs('1:2', '3')),
          `고름=${picked} · ${await rollupIn('1:4')} · ${await rollupIn('1:2')}`)
        await key('Escape')

        // ── 설정이 끊기면 말한다 ──
        await api('DELETE', `/data-sources/${tasks.dataSourceId}/properties/${hours}`)
        await send('Page.reload')
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)
        check('★ 대상 속성이 지워지면 "설정이 끊겼습니다" — 조용히 비워 두지 않는다. 컬럼은 남는다(복원하면 돌아온다)',
          (await evaluate(`document.querySelector('td[data-cell="0:2"] [data-testid="db-rollup-broken"]')?.textContent.trim() === '설정이 끊겼습니다'`))
            && (await rollupIn('0:4')) === '3',
          await evaluate(`document.querySelector('td[data-cell="0:2"]')?.textContent`))

        // ── rollup 컬럼이 **없던** 표에 첫 컬럼을 만든다 ──
        // 마운트 때 rollup 이 없으면 서버는 아무것도 계산하지 않았다. 그 자리를 "이미 물었다"로 적어 두면 첫 컬럼의
        // 칸이 영영 빈 채로 남는다(`use-rollup-values.ts` 머리말) — 이 절이 그것을 본다.
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}` })
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 3`, 15000)
        await clickOn('[data-testid="db-add-column"]')
        await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
        await typeText('프로젝트 수')
        await setSelect('select[aria-label="속성 유형"]', 'rollup')
        await waitFor(`document.querySelector('[data-testid="db-rollup-target"]')?.disabled === false`, 8000)
        await setSelect('[data-testid="db-rollup-function"]', 'count')
        await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
        check('★ rollup 컬럼이 **없던** 표에 첫 컬럼을 만들어도 값이 온다 — 이미 불러온 행 전부를 다시 묻는다',
          (await waitFor(`!document.querySelector('[data-testid="db-add-column-form"]')`, 8000))
            && (await rollupIs('0:2', '2')) && (await rollupIs('1:2', '1')),
          `${await rollupIn('0:2')} · ${await rollupIn('1:2')}`)

        // ── 관계형이 없는 표 ──
        const plain = (await api('POST', '/databases', { name: `롤업 없음 ${stamp}` })).body.database
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${plain.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-add-column"]')`, 15000)
        await clickOn('[data-testid="db-add-column"]')
        await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
        await setSelect('select[aria-label="속성 유형"]', 'rollup')
        check('관계형 속성이 없는 표에서는 만들 수 없다고 말한다 — 롤업은 관계 위에서만 선다',
          await waitFor(`!!document.querySelector('[data-testid="db-rollup-no-relation"]')
            && !document.querySelector('[data-testid="db-rollup-relation"]')`, 5000))
        await key('Escape')
      }

      if (sectionIf('데이터베이스 템플릿 — 서버 (템플릿 6c-1 · 6c-2 · F-08-02 · F-08-03)')) {
      // 권한 · 상한 · 기본 지정의 규칙은 `template.db.test.ts` 가 본다. 여기서는 빌드된 앱에서 라우트가 실제로 답하는지,
      // 그리고 **불변식 R1 이 화면까지 지켜지는지** — 템플릿을 만들어도 표에 행이 늘지 않는지 — 를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
        const { textRun } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const stamp = Date.now()
        const db = (await api('POST', '/databases', { name: `템플릿 표 ${stamp}` })).body.database
        const titleId = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
        await api('POST', `/views/${db.defaultViewId}/rows`, {
          cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun('보통 행')] } }],
        })

        const made = await api('POST', `/data-sources/${db.dataSourceId}/templates`, { title: '주간 회의' })
        check('★ 템플릿을 만든다 — 라우트가 201 과 그 이름을 준다',
          made.status === 201 && made.body?.template?.title === '주간 회의',
          `${made.status} ${JSON.stringify(made.body)}`)

        const listed = await api('GET', `/data-sources/${db.dataSourceId}/templates`)
        const rows = await api('GET', `/views/${db.defaultViewId}/rows`)
        check('★ 불변식 R1 — 템플릿은 템플릿 목록에만 있고 행 목록에는 없다',
          listed.body?.templates?.map((t) => t.title).join() === '주간 회의'
            && rows.body?.rows?.length === 1 && rows.body.rows[0].title === '보통 행',
          `${JSON.stringify(listed.body?.templates)} · ${JSON.stringify(rows.body?.rows?.map((r) => r.title))}`)

        const templateId = made.body.template.id
        const badDefault = await api('PATCH', `/views/${db.defaultViewId}`, { defaultTemplateId: rows.body.rows[0].id })
        const setDefault = await api('PATCH', `/views/${db.defaultViewId}`, { defaultTemplateId: templateId })
        check('★ 기본 템플릿은 템플릿만 가리킨다 — 일반 행은 400 이고 템플릿은 붙는다',
          badDefault.status === 400 && badDefault.body?.error === 'invalid_template'
            && setDefault.status === 200 && setDefault.body?.view?.defaultTemplateId === templateId,
          `${badDefault.status} ${JSON.stringify(badDefault.body)} · ${JSON.stringify(setDefault.body?.view?.defaultTemplateId)}`)

        // 화면은 6c-2 가 붙인다. 지금 보는 것은 **템플릿이 있어도 표가 그대로 열리는가** 하나다 —
        // 새 컬럼 · 새 행 종류가 생길 때마다 표가 열리지 않던 일이 여러 번 있었다.
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        check('★ 템플릿이 있어도 표는 열리고 행은 하나다 — 템플릿이 섞여 보이지 않는다',
          await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1`, 15000),
          await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.textContent).join(' | ')`))

        const template2 = await api('POST', `/data-sources/${db.dataSourceId}/templates`, { title: '점검 항목' })
        const priority = await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '중요도', type: 'number' })
        const priorityId = priority.body.property.id
        await api('PATCH', `/rows/${template2.body.template.id}`, {
          cells: [{ propertyId: priorityId, value: { type: 'number', number: 7 } }],
        })

        const fromTemplate = await api('POST', `/views/${db.defaultViewId}/rows`, {
          templateId: template2.body.template.id,
        })
        check('★ 템플릿으로 행을 만든다 — 제목과 셀이 따라오고 꼬리표는 붙지 않는다',
          fromTemplate.status === 201 && fromTemplate.body?.row?.title === '점검 항목'
            && fromTemplate.body.row.properties?.[priorityId]?.number === 7
            && fromTemplate.body.skippedPages === 0 && fromTemplate.body.skippedLinks === 0,
          `${fromTemplate.status} ${JSON.stringify(fromTemplate.body)}`)

        const overridden = await api('POST', `/views/${db.defaultViewId}/rows`, {
          templateId: template2.body.template.id,
          cells: [{ propertyId: priorityId, value: { type: 'number', number: 1 } }],
        })
        check('★ 보내 준 셀이 템플릿의 값을 덮는다 — 보드 열의 값이 이긴다',
          overridden.body?.row?.properties?.[priorityId]?.number === 1,
          JSON.stringify(overridden.body?.row?.properties))

        const notATemplate = await api('POST', `/views/${db.defaultViewId}/rows`, { templateId: rows.body.rows[0].id })
        check('일반 행 id 로는 만들 수 없다 — 템플릿만 원본이 된다',
          notATemplate.status === 404, `${notATemplate.status} ${JSON.stringify(notATemplate.body)}`)

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        check('★ 템플릿으로 만든 행은 표에 선다 — 보통 행 1 + 템플릿에서 2',
          await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 3`, 15000),
          await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.textContent).join(' | ')`))

        const removed = await api('DELETE', `/templates/${templateId}`)
        const afterDelete = await api('GET', `/data-sources/${db.dataSourceId}/templates`)
        const view = await api('GET', `/views/${db.defaultViewId}`)
        check('★ 템플릿을 버리면 목록에서 빠지고 기본 지정도 빈 페이지로 돌아간다',
          removed.status === 200
            && afterDelete.body?.templates?.map((t) => t.title).join() === '점검 항목'
            && view.body?.view?.defaultTemplateId === null,
          `${removed.status} ${JSON.stringify(afterDelete.body)} · ${JSON.stringify(view.body?.view?.defaultTemplateId)}`)

        const asRow = await api('DELETE', `/rows/${templateId}`)
        check('행 라우트로는 템플릿을 버릴 수 없다 — 템플릿의 길은 하나다',
          asRow.status === 404, `${asRow.status} ${JSON.stringify(asRow.body)}`)
      }

      if (sectionIf('데이터베이스 템플릿 — 화면 (템플릿 6c-3 · F-08-02)')) {
      // 만드는 · 채우는 · 버리는 길이 실제 브라우저에서 이어지는지 본다. 속성 목록은 표의 세 번째 모양
      // (`variant="record"`)이라 배치 규칙 자체는 `list-layout.test.ts` 가 DOM 없이 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const templatesOf = async (dataSourceId) => (await api('GET', `/data-sources/${dataSourceId}/templates`)).body?.templates ?? []
        /** 서버가 그 값이 될 때까지 기다린다 — 화면의 저장은 blur · Enter 뒤 한 왕복이다. */
        const untilTitle = async (dataSourceId, title) => {
          for (let i = 0; i < 40; i += 1) {
            if ((await templatesOf(dataSourceId))[0]?.title === title) return true
            await sleep(200)
          }
          return false
        }

        const stamp = Date.now()
        const db = (await api('POST', '/databases', { name: `템플릿 화면 ${stamp}` })).body.database
        const memo = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '메모', type: 'rich_text' })).body.property.id

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-templates-button"]')`, 15000)

        await clickOn('[data-testid="db-templates-button"]')
        check('★ 도구줄의 "템플릿" 이 패널을 연다 — 처음에는 비어 있다고 말한다',
          await waitFor(`!!document.querySelector('[data-testid="db-templates-empty"]')`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-templates-panel"]')?.textContent ?? '패널 없음'`))

        await clickOn('[data-testid="db-template-new"]')
        check('★ "+ 새 템플릿" 을 누르면 목록에 선다',
          await waitFor(`document.querySelectorAll('[data-testid="db-template-open"]').length === 1`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-templates-list"]')?.textContent ?? '목록 없음'`))

        await clickOn('[data-testid="db-template-open"]')
        check('★ 템플릿 편집 화면이 열린다 — 배너 · 이름 · 속성 목록 · 본문이 함께 선다',
          await waitFor(`/\\/templates\\/[0-9a-f-]{36}$/.test(location.pathname)
            && !!document.querySelector('[data-testid="template-banner"]')
            && !!document.querySelector('input[aria-label="템플릿 이름"]')
            && !!document.querySelector('[data-testid="db-table"] td[data-property-id="${memo}"]')
            && !!document.querySelector('.blk-editor')`, 15000),
          await evaluate('location.pathname'))
        const templateId = (await evaluate('location.pathname')).split('/').pop()

        check('★ 속성 목록에는 제목 칸도 "+ 새로 만들기" 도 없다 — 이름은 `h1` 이, 행 만들기는 표가 쥔다',
          await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] td[data-property-id]')].length === 1
            && !document.querySelector('[data-testid="db-add-row"]')
            && !document.querySelector('[data-testid="db-add-column"]')`),
          await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] td[data-property-id]')]
            .map((td) => td.getAttribute('data-property-id')).join()`))

        // ── 이름 · 속성 · 본문을 채운다 ──
        await clickOn('input[aria-label="템플릿 이름"]')
        // 이름이 이미 "새 템플릿"이다 — 전체 선택 뒤에 친다(`Input.insertText` 가 선택을 대체한다).
        // 안 그러면 뒤에 이어 붙어 "새 템플릿주간 회의"가 된다(처음 돌렸을 때 그랬다).
        await evaluate(`document.querySelector('input[aria-label="템플릿 이름"]').select()`)
        await typeText('주간 회의')
        await key('Enter')
        check('★ 템플릿 이름을 고치면 title 셀에 저장된다 — 행은 `renamePage` 가 거부한다',
          await untilTitle(db.dataSourceId, '주간 회의'),
          JSON.stringify(await templatesOf(db.dataSourceId)))

        await clickOn(`[data-testid="db-table"] td[data-property-id="${memo}"]`)
        await key('Enter')
        await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 8000)
        await typeText('지난 주 회고부터')
        await key('Enter')
        check('★ 속성 칸을 고치면 템플릿 행에 저장된다 — 표와 같은 셀 편집기다',
          await waitFor(`document.querySelector('[data-testid="db-table"] td[data-property-id="${memo}"]')?.textContent.includes('지난 주 회고부터')`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-table"] td[data-property-id="${memo}"]')?.textContent`))

        await clickOn('.blk-editor [data-block-id]')
        await typeText('안건을 적는다')
        check('★ 템플릿 본문도 협업 편집기다 — 친 글이 남는다',
          await waitFor(`document.querySelector('.blk-editor')?.textContent.includes('안건을 적는다')`, 8000),
          await evaluate(`document.querySelector('.blk-editor')?.textContent ?? ''`))

        // ── 표로 돌아온다 — 템플릿은 표에 없다(R1) ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
        check('★ 다 채운 뒤에도 템플릿은 표에 섞이지 않는다',
          await evaluate(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 0`),
          await evaluate(`document.querySelector('[data-testid="db-table"] tbody')?.textContent ?? ''`))

        // ── 화면에서 채운 것이 실제로 새 행에 실리는가(6c-2 의 서버와 이어 본다) ──
        const made = await api('POST', `/views/${db.defaultViewId}/rows`, { templateId })
        check('★ 화면에서 채운 이름 · 속성 · 본문이 새 행으로 간다',
          made.status === 201 && made.body?.row?.title === '주간 회의'
            && String(made.body.row.properties?.[memo]?.rich_text?.[0]?.plain_text ?? '').includes('지난 주 회고부터'),
          `${made.status} ${JSON.stringify(made.body?.row)}`)

        // ── 버리기 ──
        await clickOn('[data-testid="db-templates-button"]')
        await waitFor(`!!document.querySelector('[data-testid="db-template-delete"]')`, 8000)
        await clickOn('[data-testid="db-template-delete"]')
        check('★ "버리기" 를 누르면 목록에서 빠진다',
          await waitFor(`!!document.querySelector('[data-testid="db-templates-empty"]')`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-templates-panel"]')?.textContent ?? '패널 없음'`))
      }

      if (sectionIf('데이터베이스 New ▾ — 템플릿으로 만들기 · 기본 템플릿 (템플릿 6c-4 · F-08-02 · F-08-03)')) {
      // 문구 규칙은 `new-row.test.ts` 가, 복제 · 덮기 · 빠진 것의 개수는 `template.db.test.ts` 가 본다. 여기서는 표와 보드의
      // 버튼이 실제로 그 길을 타는지, 그리고 **기본 템플릿이 버튼의 글자와 동작을 함께 바꾸는지**를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
        const api = async (method, path, body) => {
          const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
            method,
            headers: authed,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          return { status: r.status, body: await r.json().catch(() => null) }
        }
        const stamp = Date.now()
        const db = (await api('POST', '/databases', { name: `New 메뉴 ${stamp}` })).body.database
        const done = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '완료', type: 'checkbox' })).body.property.id
        const template = (await api('POST', `/data-sources/${db.dataSourceId}/templates`, { title: '주간 회의' })).body.template
        // 템플릿은 "완료" 를 켜 둔다 — 보드의 "체크 안 됨" 열에서 만들면 그 열의 값이 이겨야 한다.
        await api('PATCH', `/rows/${template.id}`, { cells: [{ propertyId: done, value: { type: 'checkbox', checkbox: true } }] })
        const rowsNow = async () => (await api('GET', `/views/${db.defaultViewId}/rows`)).body?.rows ?? []

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-add-row-menu"]')`, 15000)
        check('기본 템플릿이 없으면 버튼은 빈 항목을 만든다고 말한다',
          (await evaluate(`document.querySelector('[data-testid="db-add-row"]')?.textContent.trim()`)) === '+ 새로 만들기',
          await evaluate(`document.querySelector('[data-testid="db-add-row"]')?.textContent`))

        // ── ▾ 에서 고른다 ──
        await clickOn('[data-testid="db-add-row-menu"]')
        check('★ ▾ 가 빈 항목과 템플릿을 늘어놓는다',
          await waitFor(`!!document.querySelector('[data-testid="db-new-blank"]')
            && [...document.querySelectorAll('[data-testid="db-new-template"]')].map((b) => b.textContent.trim()).join() === '주간 회의'`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-new-menu"]')?.textContent ?? '메뉴 없음'`))
        await clickOn(`[data-testid="db-new-template"][data-template-id="${template.id}"]`)
        check('★ 템플릿을 고르면 그 제목으로 행이 서고 제목 칸이 **그 제목을 담은 채로** 열린다 — 빈 글자로 덮지 않는다',
          await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1
            && document.activeElement?.matches('[data-testid="db-cell-input"]')
            && document.activeElement.value === '주간 회의'`, 8000),
          await evaluate(`document.activeElement?.value ?? document.activeElement?.tagName`))
        // ★ Enter(= 저장)로 빠져나간다. Esc 는 초안을 **버리므로** 초안이 빈 글자여도 통과한다 — 위험한 길은 저장이다.
        await key('Enter')
        await sleep(600)
        const firstRows = await rowsNow()
        check('★ 저장하며 빠져나가도 제목이 지워지지 않고 템플릿의 셀이 실려 있다',
          firstRows.length === 1 && firstRows[0].title === '주간 회의' && firstRows[0].properties?.[done]?.checkbox === true,
          JSON.stringify(firstRows.map((r) => ({ title: r.title, done: r.properties?.[done] }))))

        // ── 기본으로 지정 → 버튼이 그 이름을 말하고, 그냥 누르면 그것으로 만든다 ──
        await clickOn('[data-testid="db-add-row-menu"]')
        await waitFor(`!!document.querySelector('[data-testid="db-new-set-default"]')`, 8000)
        await clickOn(`[data-testid="db-new-set-default"][data-template-id="${template.id}"]`)
        check('★ "기본으로" 를 누르면 버튼이 "+ 새 주간 회의" 가 된다',
          await waitFor(`document.querySelector('[data-testid="db-add-row"]')?.textContent.trim() === '+ 새 주간 회의'`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-add-row"]')?.textContent`))
        const viewAfter = await api('GET', `/views/${db.defaultViewId}`)
        check('기본 지정은 서버의 뷰에 저장된다',
          viewAfter.body?.view?.defaultTemplateId === template.id, JSON.stringify(viewAfter.body?.view?.defaultTemplateId))

        await key('Escape')
        await clickOn('[data-testid="db-add-row"]')
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 8000)
        await key('Enter')
        await sleep(600)
        const secondRows = await rowsNow()
        check('★ 그냥 누르면 메뉴 없이 기본 템플릿으로 만든다',
          secondRows.length === 2 && secondRows[1].title === '주간 회의' && secondRows[1].properties?.[done]?.checkbox === true,
          JSON.stringify(secondRows.map((r) => r.title)))

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        check('★ 다시 열어도 버튼이 기본 템플릿의 이름을 말한다 — 서버 렌더가 이름까지 읽는다',
          await waitFor(`document.querySelector('[data-testid="db-add-row"]')?.textContent.trim() === '+ 새 주간 회의'`, 15000),
          await evaluate(`document.querySelector('[data-testid="db-add-row"]')?.textContent`))

        // ── 보드 — 열의 값이 템플릿의 값을 이긴다 ──
        const board = (await api('POST', `/databases/${db.id}/views`, { type: 'board', groupBy: { property_id: done } })).body.view
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${board.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-board-column"][data-group-key="false"] [data-testid="db-board-add-menu"]')`, 15000)
        await clickOn('[data-testid="db-board-column"][data-group-key="false"] [data-testid="db-board-add-menu"]')
        await waitFor(`!!document.querySelector('[data-testid="db-new-template"]')`, 8000)
        await clickOn(`[data-testid="db-new-template"][data-template-id="${template.id}"]`)
        check('★ 보드 열의 ▾ 로 템플릿을 고르면 카드가 **그 열에** 선다 — 템플릿은 "완료" 를 켰지만 열의 값이 이긴다',
          await waitFor(`document.querySelectorAll('[data-testid="db-board-column"][data-group-key="false"] [data-testid="db-board-card"]').length === 1
            && document.querySelectorAll('[data-testid="db-board-column"][data-group-key="true"] [data-testid="db-board-card"]').length === 2`, 8000),
          await evaluate(`[...document.querySelectorAll('[data-testid="db-board-column"]')].map((c) => c.dataset.groupKey + ':' + c.querySelectorAll('[data-testid="db-board-card"]').length).join(' ')`))
        check('보드의 제목 입력도 템플릿이 준 제목을 담고 열린다',
          (await evaluate(`document.querySelector('[data-testid="db-board-title-input"]')?.value ?? null`)) === '주간 회의',
          await evaluate(`document.querySelector('[data-testid="db-board-title-input"]')?.value ?? '입력 없음'`))
        await key('Enter')
        await sleep(600)
        const boardRows = await rowsNow()
        const fromBoard = boardRows.find((r) => !firstRows.concat(secondRows).some((o) => o.id === r.id))
        check('★ 서버에도 그 열의 값으로 저장됐다(완료 = false) · 제목은 템플릿의 것',
          fromBoard?.properties?.[done]?.checkbox === false && fromBoard?.title === '주간 회의',
          JSON.stringify(fromBoard ?? boardRows.map((r) => r.title)))

        // ── 기본 지정은 뷰마다 따로다 ──
        check('보드 뷰는 표 뷰의 기본 지정을 물려받지 않는다 — 기본은 뷰의 것이다',
          (await evaluate(`document.querySelector('[data-testid="db-board-add"]')?.getAttribute('aria-label') ?? ''`)).endsWith('에 새로 만들기')
            && !(await evaluate(`document.querySelector('[data-testid="db-board-add"]')?.getAttribute('aria-label') ?? ''`)).includes('템플릿'),
          await evaluate(`document.querySelector('[data-testid="db-board-add"]')?.getAttribute('aria-label')`))

        // ── 해제 ──
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('[data-testid="db-add-row-menu"]')`, 15000)
        await clickOn('[data-testid="db-add-row-menu"]')
        await waitFor(`!!document.querySelector('[data-testid="db-new-unset-default"]')`, 8000)
        await clickOn('[data-testid="db-new-unset-default"]')
        check('★ 기본을 해제하면 버튼이 다시 빈 항목을 말한다',
          await waitFor(`document.querySelector('[data-testid="db-add-row"]')?.textContent.trim() === '+ 새로 만들기'`, 8000),
          await evaluate(`document.querySelector('[data-testid="db-add-row"]')?.textContent`))
        await key('Escape')
      }
    }

    if (sectionIf('페이지 복제 (복제 6a · 6b · F-02-09 · F-08-01)')) {
    // 재매핑 · 권한 · 상한의 규칙은 `duplicate-remap.test.ts` · `duplicate.db.test.ts` 가 본다. 여기서는 빌드된 앱에서
    // 라우트가 실제로 답하는지, 그리고 **사본이 열리는 진짜 페이지인지**를 본다.
      const newPage = async (title, parent) => {
        const res = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
          method: 'POST',
          headers: authed,
          body: JSON.stringify({ title, ...(parent ? { parentPageId: parent } : {}) }),
        })
        return (await res.json()).page.id
      }
      const duplicate = async (pageId, body = {}) => {
        const res = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${pageId}/duplicate`, {
          method: 'POST',
          headers: authed,
          body: JSON.stringify(body),
        })
        return { status: res.status, body: await res.json().catch(() => null) }
      }
      // `clickOn` 은 데이터베이스 절의 블록 안에만 있다 — 여기서도 쓰려고 같은 것을 둔다(좌표로 진짜 클릭한다).
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const stamp = Date.now()
      const outside = await newPage(`바깥 문서 ${stamp}`)
      const source = await newPage(`복제 원본 ${stamp}`)
      const child = await newPage('하위 문서', source)
      const marker = `사본에서도 보이는 글 ${stamp}`
      await saveBody(source, {
        blocks: [
          { id: randomUUID(), type: 'paragraph', title: [textRun(marker)], properties: {}, format: {}, children: [] },
          { id: randomUUID(), type: 'paragraph', title: [pageMentionRun(child), pageMentionRun(outside)], properties: {}, format: {}, children: [] },
          { id: child, type: 'page', title: [], properties: {}, format: {}, children: [] },
        ],
      })

      const made = await duplicate(source)
      check('★ 복제하면 사본이 생긴다 — 제목에 꼬리표가 붙고 하위 페이지까지 따라온다',
        made.status === 201 && made.body?.page?.plainTitle === `복제 원본 ${stamp} (1)` && made.body?.pages === 2
          && made.body?.skipped === 0,
        `${made.status} ${JSON.stringify(made.body?.page?.plainTitle)} pages=${made.body?.pages}`)

      const copyId = made.body.page.id
      const copied = await readBody(copyId)
      const runs = copied.doc.blocks[1].title
      const copiedChild = copied.doc.blocks[2]
      check('★ 안쪽 멘션은 **사본의** 하위 페이지를, 바깥 멘션은 원본을 가리킨다 — 이 조각이 고정한 규칙',
        mentionTarget(runs[0])?.id === copiedChild.id && mentionTarget(runs[0])?.id !== child
          && mentionTarget(runs[1])?.id === outside,
        `${mentionTarget(runs[0])?.id} · ${mentionTarget(runs[1])?.id}`)
      check('원본의 본문은 그대로다 — 복제가 원본을 고치지 않는다',
        mentionTarget((await readBody(source)).doc.blocks[1].title[0])?.id === child)

      const cycle = await duplicate(source, { parentPageId: source })
      check('자기 자신 안으로는 복제할 수 없다', cycle.status === 400 && cycle.body?.error === 'cycle',
        `${cycle.status} ${JSON.stringify(cycle.body)}`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${copyId}` })
      check('★ 사본은 열리는 진짜 페이지다 — 본문과 하위 페이지가 화면에 선다',
        (await waitFor(`(document.body?.textContent ?? '').includes(${JSON.stringify(marker)})`, 15000))
          && (await evaluate(`document.querySelectorAll('.blk-editor .blk-page-link').length === 1
            && [...document.querySelectorAll('.blk-editor .blk-page-link')].every((e) => e.textContent === '하위 문서')`)),
        await evaluate(`[...document.querySelectorAll('.blk-editor .blk-page-link')].map((e) => e.textContent).join() || '(참조 없음)'`))
      check('사이드바에도 사본이 선다',
        await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"] a[href$="/${copyId}"]')`, 8000))

      // ── 화면 (6b) ──
      const pageCount = () => evaluate(`document.querySelectorAll('nav[aria-label="페이지 트리"] a').length`)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${source}` })
      await waitFor(`!!document.querySelector('[data-testid="page-duplicate"]')`, 15000)
      const before = await pageCount()
      await clickOn('[data-testid="page-duplicate"]')
      check('★ 페이지의 "복제"를 누르면 사본으로 옮겨 간다 — 본문이 따라와 있다',
        (await waitFor(`!location.pathname.endsWith('/${source}') && (document.body?.textContent ?? '').includes(${JSON.stringify(marker)})`, 15000))
          // 개수는 한 번만 세면 refresh 와 경주한다(7c-7 반사실 빌드에서 한 번 걸렸다) — 자랄 때까지 기다린다.
          && (await waitFor(`document.querySelectorAll('nav[aria-label="페이지 트리"] a').length > ${before}`, 8000)),
        `${await evaluate('location.pathname')} · 트리 ${before} → ${await pageCount()}`)

      // 사이드바의 ⧉ — 원본 옆에 하나 더.
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"] a[href$="/${source}"]')`, 15000)
      const beforeSide = await pageCount()
      await clickOn(`[aria-label=${JSON.stringify(`복제 원본 ${stamp} 복제`)}]`)
      check('★ 사이드바의 ⧉ 로도 복제한다 — 사본으로 옮겨 간다',
        (await waitFor(`(document.body?.textContent ?? '').includes(${JSON.stringify(marker)})`, 15000))
          && (await pageCount()) > beforeSide,
        `트리 ${beforeSide} → ${await pageCount()}`)

      // ── 빠진 것이 있으면 멈춰서 말한다 ──
      // 볼 수 없는 하위 페이지를 만든다(`볼 수 없는 하위 페이지의 참조` 절과 같은 방법). 따로 만든 페이지에서 한다 —
      // 소유자도 못 보는 페이지를 앞 절의 트리에 남기지 않는다.
      const partial = await newPage(`일부만 복제 ${stamp}`)
      const hidden = await newPage('숨길 하위', partial)
      const access = (body) =>
        fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${hidden}/access`, { method: 'POST', headers: authed, body: JSON.stringify(body) })
      await access({ action: 'restrict' })
      // 이 세션이 아닌 **이 워크스페이스의 사람** 하나에게만 남긴다 — 워크스페이스 밖의 id 에는 이제 줄 수 없다(7d-2).
      const keeper = await joinAs(workspaceId, await createUser('숨긴 하위의 관리자'), 'member')
      await access({ action: 'grant', principal: { type: 'user', id: keeper.userId }, level: 'full_access' })
      await access({ action: 'revoke', principal: { type: 'workspace_everyone' } })

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${partial}` })
      await waitFor(`!!document.querySelector('[data-testid="page-duplicate"]')`, 15000)
      await clickOn('[data-testid="page-duplicate"]')
      check('★ 볼 수 없는 하위 페이지가 빠지면 **멈춰서 말한다** — 옮겨 가면 그 말이 사라진다',
        (await waitFor(`!!document.querySelector('[data-testid="page-duplicate-note"]')`, 15000))
          && (await evaluate(`document.querySelector('[data-testid="page-duplicate-note"]').textContent.includes('1개')`))
          && (await evaluate(`location.pathname.endsWith('/${partial}')`)),
        await evaluate(`document.querySelector('[data-testid="page-duplicate-note"]')?.textContent ?? '(말이 없다)'`))
      await clickOn('[data-testid="page-duplicate-open"]')
      check('"사본 열기"로 그때 옮겨 간다',
        await waitFor(`!location.pathname.endsWith('/${partial}') && !!document.querySelector('[data-testid="page-duplicate"]')`, 15000))
    }

    if (sectionIf('볼 수 없는 하위 페이지의 참조 (HANDOFF §3.2-22)')) {
      // 새 페이지에서 따로 본다 — 앞 절의 페이지에 "소유자도 못 보는 하위 페이지"를 남기지 않는다.
      const createAt = async (parentPageId) =>
        (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify(parentPageId ? { parentPageId } : {}) })).json()).page.id
      const refParent = await createAt(null)
      const hiddenChild = await createAt(refParent)
      const hiddenTitle = `숨긴 하위 ${Date.now()}`
      const access = (body) =>
        fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${hiddenChild}/access`, { method: 'POST', headers: authed, body: JSON.stringify(body) })
      await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${hiddenChild}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ title: hiddenTitle }) })
      // 상속을 끊고, 다른 멤버 하나에게만 남긴다 — 이 세션(소유자)도 그 페이지를 볼 수 없다. 워크스페이스 밖의 id 에는
      // 이제 줄 수 없다(7d-2 — 전에는 임의의 uuid 에 주던 자리다).
      await access({ action: 'restrict' })
      const keeper = await joinAs(workspaceId, await createUser('숨긴 참조의 관리자'), 'member')
      await access({ action: 'grant', principal: { type: 'user', id: keeper.userId }, level: 'full_access' })
      const revoked = await access({ action: 'revoke', principal: { type: 'workspace_everyone' } })
      // 페이지 라우트에는 GET 이 없다(PATCH 뿐 — 처음에 그것으로 재서 405 로 실패했다). 권한을 거치는 제목 맵 라우트로 본다.
      const hiddenTitles = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${hiddenChild}/page-ref-titles`, { headers: authed })
      check('전제: 하위 페이지를 이 세션이 볼 수 없게 됐다', revoked.ok && hiddenTitles.status === 404, `revoke ${revoked.status} · titles ${hiddenTitles.status}`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${refParent}` })
      await waitFor(`!!document.querySelector('.blk-editor .blk-page-link')`, 15000)
      check('★ 볼 수 없는 하위 페이지의 참조는 "접근 권한 없음"으로 그리고 열리지 않는다',
        await waitFor(`[...document.querySelectorAll('.blk-editor .blk-page-link')].some((e) => e.textContent === '접근 권한 없음' && e.disabled)`, 5000))
      check('★ 그 제목은 페이지 어디에도 없다', !(await evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(hiddenTitle)})`)))
    }

    if (sectionIf('여러 data source — 서버 (8e-1 · F-04-23)')) {
      // 데이터베이스 하나에 data source 둘. 소스를 더하는 화면은 8e-2 다 — 여기서는 라우트로 더하고, 둘째 소스의 탭이 **그 소스의** 표 ·
      // 새 행 · 템플릿 화면 · 관계형 고르개로 서는지 본다(8e-1 전에는 모두 데이터베이스의 첫 소스를 골랐다). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const dbName = `여러소스${stamp}`
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: dbName }) }))).body?.database
      const dbId = created?.id
      const firstSource = created?.dataSourceId
      const firstView = created?.defaultViewId
      const added = await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { method: 'POST', headers: authed, body: JSON.stringify({ name: '회사' }) }))
      const secondSource = added.body?.dataSource?.id
      const secondView = added.body?.viewId
      check('data source 를 더하면 201 · 함께 생긴 뷰를 준다', added.status === 201 && !!secondSource && !!secondView, JSON.stringify(added))

      const listed = await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { headers: authed }))
      check('★ 목록 — 부착 순서 · 첫째는 데이터베이스 이름을 받았다(둘째를 더한 순간)',
        JSON.stringify(listed.body?.dataSources?.map((d) => [d.id, d.name])) === JSON.stringify([[firstSource, dbName], [secondSource, '회사']]),
        JSON.stringify(listed.body))

      // 첫째 소스에만 속성 하나 — 둘째 소스의 탭에 나오면 남의 스키마를 그린 것이다.
      const scoreName = `점수${stamp}`
      await fetch(`${api}/data-sources/${firstSource}/properties`, { method: 'POST', headers: authed, body: JSON.stringify({ name: scoreName, type: 'number' }) })
      const headers = `[...document.querySelectorAll('[data-testid="db-table"] th[data-property-id]')].map((th) => th.textContent)`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${secondView}` })
      await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
      check('탭이 둘 — 소스마다 하나', (await evaluate(`document.querySelectorAll('[data-testid="db-view-tab"]').length`)) === 2,
        String(await evaluate(`document.querySelectorAll('[data-testid="db-view-tab"]').length`)))
      check('★ 둘째 소스의 탭은 그 소스의 속성만 그린다', await waitFor(`(() => { const h = ${headers}
          return h.length === 1 && !h.some((t) => t.includes(${JSON.stringify(scoreName)})) })()`, 5000),
        JSON.stringify(await evaluate(headers)))

      // 새 행 — 이 탭의 소스에 생긴다.
      await clickSelector('[data-testid="db-add-row"]')
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] [data-row-id]').length === 1`, 8000)
      const rowsOf = async (view) => (await readRes(await fetch(`${api}/views/${view}/rows`, { headers: authed }))).body?.rows?.map((r) => r.id) ?? null
      const inSecond = await rowsOf(secondView)
      const inFirst = await rowsOf(firstView)
      check('★ 둘째 소스의 탭에서 만든 새 행은 둘째 소스에 있다 — 첫째 소스에는 없다',
        inSecond?.length === 1 && Array.isArray(inFirst) && inFirst.length === 0, JSON.stringify({ inSecond, inFirst }))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${firstView}` })
      await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
      check('첫째 소스의 탭은 그 소스의 속성 · 행이다', await waitFor(`(() => { const h = ${headers}
          return h.some((t) => t.includes(${JSON.stringify(scoreName)})) && !document.querySelector('[data-testid="db-table"] [data-row-id]') })()`, 5000),
        JSON.stringify(await evaluate(headers)))

      // 관계형의 대상 고르개 — 소스마다 한 항목 · "데이터베이스 · 소스"
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await clickSelector('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await setSelect('select[aria-label="속성 유형"]', 'relation')
      const optionTexts = `[...(document.querySelector('[data-testid="db-relation-target"]')?.options ?? [])].map((o) => o.textContent)`
      check('★ 관계형의 대상 고르개 — 소스마다 한 항목이고 소스 이름으로 가른다',
        await waitFor(`(() => { const t = ${optionTexts}
          return t.includes(${JSON.stringify(`${dbName} · ${dbName} (이 표)`)}) && t.includes(${JSON.stringify(`${dbName} · 회사`)}) })()`, 8000),
        JSON.stringify((await evaluate(optionTexts)).filter((t) => t.includes(String(stamp)))))
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

      // 템플릿 화면 — 템플릿 자신의 소스로 그린다(전에는 첫 뷰의 소스였다 — 둘째 소스의 템플릿은 열리지 않았다)
      const template = (await readRes(await fetch(`${api}/data-sources/${secondSource}/templates`, { method: 'POST', headers: authed, body: JSON.stringify({ title: `회사 템플릿 ${stamp}` }) }))).body?.template
      const templatePage = await fetch(`${BASE}/w/${workspaceId}/db/${dbId}/templates/${template?.id}`, { headers: { cookie: authed.cookie } })
      const templateHtml = await templatePage.text()
      check('★ 둘째 소스의 템플릿 화면이 열린다 — 그 소스의 속성으로',
        templatePage.status === 200 && templateHtml.includes(`회사 템플릿 ${stamp}`) && !templateHtml.includes(scoreName),
        `status ${templatePage.status} · 점수 속성 ${templateHtml.includes(scoreName)}`)
      const elsewhere = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: `다른곳${stamp}` }) }))).body?.database
      const crossed = await fetch(`${BASE}/w/${workspaceId}/db/${elsewhere?.id}/templates/${template?.id}`, { headers: { cookie: authed.cookie } })
      check('다른 데이터베이스의 주소로는 그 템플릿이 열리지 않는다', crossed.status === 404, String(crossed.status))

      // 뷰 만들기 · 이름 바꾸기 라우트
      const viewOnSecond = await readRes(await fetch(`${api}/databases/${dbId}/views`, { method: 'POST', headers: authed, body: JSON.stringify({ name: '회사 목록', type: 'list', dataSourceId: secondSource }) }))
      const viewElsewhere = await readRes(await fetch(`${api}/databases/${dbId}/views`, { method: 'POST', headers: authed, body: JSON.stringify({ dataSourceId: elsewhere?.dataSourceId }) }))
      check('뷰를 만들 때 소스를 고른다 — 남의 데이터베이스의 소스는 404',
        viewOnSecond.status === 201 && viewOnSecond.body?.view?.dataSourceId === secondSource && viewElsewhere.status === 404,
        JSON.stringify([viewOnSecond.status, viewOnSecond.body?.view?.dataSourceId === secondSource, viewElsewhere.status]))
      const renamed = await readRes(await fetch(`${api}/data-sources/${secondSource}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ name: '  거래처  ' }) }))
      const blank = await fetch(`${api}/data-sources/${secondSource}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ name: ' ' }) })
      check('소스 이름 바꾸기 — 공백을 접는다 · 빈 이름은 400', renamed.status === 200 && renamed.body?.dataSource?.name === '거래처' && blank.status === 400,
        JSON.stringify([renamed, blank.status]))
    }

    if (sectionIf('여러 data source — 화면 (8e-2 · F-04-23)')) {
      // 데이터베이스 머리의 "데이터 소스" 창에서 소스를 더하고 이름을 바꾸고 옮겨 다닌다. 소스가 둘 이상이면 탭 줄 위에 지금 뷰의 소스
      // 이름이 서고, "뷰 추가"가 볼 소스를 묻는다. 하나일 때는 소스 이름이 어디에도 없다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const dbName = `소스화면${stamp}`
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: dbName, privateTop: true }) }))).body?.database
      const dbId = created?.id
      const firstSource = created?.dataSourceId
      const LABEL = '[data-testid="db-source-name"]'
      const labelText = () => evaluate(`document.querySelector('${LABEL}')?.textContent ?? null`)
      const itemsExpr = `[...document.querySelectorAll('[data-testid="db-source-item"]')].map((li) => ({
          id: li.getAttribute('data-source-id'),
          name: li.querySelector('[data-testid="db-source-name-input"]')?.value ?? li.querySelector('[data-testid="db-source-label"]')?.textContent ?? null,
          current: !!li.querySelector('[data-testid="db-source-current"]'),
        }))`
      // 서버가 그린 단추는 하이드레이션 전에 눌러도 아무 일이 없다 — 열릴 때까지 몇 번 누른다.
      const openPanel = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await evaluate(`!!document.querySelector('[data-testid="db-sources-panel"]')`)) return true
          await clickSelector('[data-testid="db-sources-button"]')
          if (await waitFor(`!!document.querySelector('[data-testid="db-sources-panel"]')`, 1500)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}` })
      await waitFor(`!!document.querySelector('[data-testid="db-sources-button"]')`, 15000)
      check('소스가 하나면 탭 줄 위에 소스 이름이 없다', (await labelText()) === null, String(await labelText()))
      await openPanel()
      check('★ 하나일 때 창은 데이터베이스 이름을 글자로만 보여 준다 — 고치는 칸이 없다(둘째를 더할 때 덮이는 이름이다)',
        await waitFor(`(() => { const items = ${itemsExpr}
          return items.length === 1 && items[0].name === ${JSON.stringify(dbName)} && items[0].current
            && !document.querySelector('[data-testid="db-source-name-input"]') })()`, 5000),
        JSON.stringify(await evaluate(itemsExpr)))

      // 더하기 — 새 소스의 뷰로 옮긴다
      await clickSelector('[data-testid="db-source-add"]')
      check('★ 데이터 소스를 더하면 새 소스의 뷰로 옮기고 탭 줄 위에 그 이름이 선다',
        await waitFor(`location.search.startsWith('?v=') && document.querySelector('${LABEL}')?.textContent === '새 데이터 소스'
          && document.querySelectorAll('[data-testid="db-view-tab"]').length === 2`, 15000),
        JSON.stringify([await evaluate('location.search'), await labelText()]))
      const sourcesNow = (await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { headers: authed }))).body?.dataSources ?? []
      const secondSource = sourcesNow[1]?.id
      check('창의 단추가 소스 수를 말한다', (await evaluate(`document.querySelector('[data-testid="db-sources-button"]')?.textContent`)) === '데이터 소스 2',
        String(await evaluate(`document.querySelector('[data-testid="db-sources-button"]')?.textContent`)))

      // 이름 바꾸기 — 창 안의 칸
      await openPanel()
      check('둘이 되면 첫째는 데이터베이스 이름을 받았고 둘 다 고치는 칸이다',
        await waitFor(`(() => { const items = ${itemsExpr}
          return items.length === 2 && items[0].name === ${JSON.stringify(dbName)} && items[1].name === '새 데이터 소스' && items[1].current
            && document.querySelectorAll('[data-testid="db-source-name-input"]').length === 2 })()`, 5000),
        JSON.stringify(await evaluate(itemsExpr)))
      const secondInput = `[data-testid="db-source-item"][data-source-id="${secondSource}"] [data-testid="db-source-name-input"]`
      await clickSelector(secondInput)
      await evaluate(`document.querySelector(${JSON.stringify(secondInput)})?.select()`)
      await typeText('임시 이름')
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      check('Esc 는 고치던 이름만 되돌린다 — 창은 열려 있다',
        await waitFor(`document.querySelector(${JSON.stringify(secondInput)})?.value === '새 데이터 소스' && !!document.querySelector('[data-testid="db-sources-panel"]')`, 3000),
        String(await evaluate(`document.querySelector(${JSON.stringify(secondInput)})?.value`)))
      await evaluate(`document.querySelector(${JSON.stringify(secondInput)})?.select()`)
      await typeText('회사')
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      check('★ Enter 로 이름을 바꾸면 탭 줄 위의 이름이 따라온다',
        await waitFor(`document.querySelector('${LABEL}')?.textContent === '회사'`, 10000), String(await labelText()))
      const listedAfter = (await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { headers: authed }))).body?.dataSources ?? []
      check('서버에도 그 이름이다', listedAfter[1]?.name === '회사', JSON.stringify(listedAfter.map((d) => d.name)))

      // 관계형의 반대쪽 이름 기본값 — 소스가 여럿이면 소스 이름
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${(await evaluate(`new URLSearchParams(location.search).get('v')`))}` })
      await waitFor(`!!document.querySelector('[data-testid="db-add-column"]')`, 15000)
      await clickSelector('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await evaluate(`(() => { const s = document.querySelector('select[aria-label="속성 유형"]'); s.value = 'relation'
        s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await waitFor(`!!document.querySelector('[data-testid="db-relation-twoway"]')`, 5000)
      await evaluate(`(() => { const c = document.querySelector('[data-testid="db-relation-twoway"]'); if (!c.checked) c.click() })()`)
      check('★ 양방향 관계형의 반대쪽 이름 기본값이 소스 이름이다(데이터베이스 이름이 아니라)',
        await waitFor(`document.querySelector('[data-testid="db-relation-inverse-name"]')?.value === '회사'`, 5000),
        String(await evaluate(`document.querySelector('[data-testid="db-relation-inverse-name"]')?.value ?? null`)))
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

      // 뷰 추가 ① — 둘째 소스를 보는 중이면 처음 값이 둘째다(첫째로 두면 서버의 기본값과 같아 고르기를 가를 수 없다)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${(await evaluate(`new URLSearchParams(location.search).get('v')`))}` })
      await waitFor(`!!document.querySelector('[data-testid="db-view-add"]')`, 15000)
      // 하이드레이션 전에 누른 단추는 아무 일이 없다 — 열릴 때까지 몇 번 누른다.
      const openAdd = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await evaluate(`!!document.querySelector('[data-testid="db-view-add-panel"]')`)) return true
          await clickSelector('[data-testid="db-view-add"]')
          if (await waitFor(`!!document.querySelector('[data-testid="db-view-add-panel"]')`, 1500)) return true
        }
        return false
      }
      const viewsNow = async () => (await readRes(await fetch(`${api}/databases/${dbId}/views`, { headers: authed }))).body?.views ?? []
      await openAdd()
      check('★ 소스가 둘이면 "뷰 추가"가 볼 소스를 묻는다 — 처음 값은 지금 뷰의 소스(둘째)',
        await waitFor(`document.querySelector('[data-testid="db-view-add-source"]')?.value === ${JSON.stringify(secondSource)}`, 5000),
        String(await evaluate(`document.querySelector('[data-testid="db-view-add-source"]')?.value ?? null`)))
      await clickSelector('[data-testid="db-view-add-list"]')
      await waitFor(`document.querySelectorAll('[data-testid="db-view-tab"]').length === 3`, 15000)
      const made = (await viewsNow()).find((v) => v.type === 'list')
      check('★ 처음 값 그대로 만들면 그 소스의 뷰가 생기고 그 탭으로 옮긴다',
        made?.dataSourceId === secondSource && (await waitFor(`location.search === ${JSON.stringify(`?v=${made?.id}`)} && document.querySelector('${LABEL}')?.textContent === '회사'`, 10000)),
        JSON.stringify([made?.dataSourceId === secondSource, await evaluate('location.search'), await labelText()]))

      // 열기 — 다른 소스의 첫 뷰로
      await openPanel()
      await clickSelector(`[data-testid="db-source-item"][data-source-id="${firstSource}"] [data-testid="db-source-open"]`)
      check('★ 창의 "열기"는 그 소스의 첫 뷰로 옮긴다',
        await waitFor(`document.querySelector('${LABEL}')?.textContent === ${JSON.stringify(dbName)} && location.search === ${JSON.stringify(`?v=${created?.defaultViewId}`)}`, 15000),
        JSON.stringify([await evaluate('location.search'), await labelText()]))

      // 뷰 추가 ② — 첫째를 보는 중에 둘째를 고른다
      await openAdd()
      check('처음 값은 지금 뷰의 소스(첫째)', await waitFor(`document.querySelector('[data-testid="db-view-add-source"]')?.value === ${JSON.stringify(firstSource)}`, 5000),
        String(await evaluate(`document.querySelector('[data-testid="db-view-add-source"]')?.value ?? null`)))
      await evaluate(`(() => { const s = document.querySelector('[data-testid="db-view-add-source"]'); if (!s) return
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        set.call(s, ${JSON.stringify(secondSource)})
        s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await clickSelector('[data-testid="db-view-add-table"]')
      await waitFor(`document.querySelectorAll('[data-testid="db-view-tab"]').length === 4`, 15000)
      // 탭 순서의 끝이 방금 만든 뷰다(listViews 는 order_idx 순).
      const picked = (await viewsNow()).at(-1)
      check('★ 고른 소스로 뷰가 생긴다 — 지금 뷰의 소스가 아니라',
        picked?.dataSourceId === secondSource && (await waitFor(`document.querySelector('${LABEL}')?.textContent === '회사'`, 10000)),
        JSON.stringify([picked?.dataSourceId === secondSource, await labelText()]))

      // 볼 수만 있는 사람 — 소스 이름은 보이고 창은 없다 · 잠기면 고치는 사람에게도 창이 없다
      const aclMod = await import(new URL('../src/lib/permissions/acl.ts', import.meta.url).href)
      const reader = await joinAs(workspaceId, await createUser(`소스 독자 ${stamp}`), 'member')
      const shared = await aclMod.grantAccess(ctx, dbId, { type: 'user', id: reader.userId }, 'view')
      const readerHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${dbId}?v=${made?.id}`, { headers: { cookie: `nc_session=${reader.token}` } })).text()
      check('★ 볼 수만 있는 사람 — 탭 줄 위의 소스 이름은 보이고 "데이터 소스" 창 · 뷰의 소스 고르개가 없다',
        shared.ok && readerHtml.includes('data-testid="db-source-name"') && readerHtml.includes('>회사<')
          && !readerHtml.includes('data-testid="db-sources-button"') && !readerHtml.includes('data-testid="db-view-add"'),
        JSON.stringify([shared.ok, readerHtml.includes('data-testid="db-source-name"'), readerHtml.includes('data-testid="db-sources-button"')]))
      const locked = await fetch(`${api}/databases/${dbId}/lock`, { method: 'PUT', headers: authed })
      const lockedHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${dbId}`, { headers: { cookie: authed.cookie } })).text()
      check('잠긴 데이터베이스 — 고칠 수 있는 사람에게도 "데이터 소스" 창이 없다',
        locked.ok && !lockedHtml.includes('data-testid="db-sources-button"') && lockedHtml.includes('data-testid="db-source-name"'),
        JSON.stringify([locked.status, lockedHtml.includes('data-testid="db-sources-button"')]))
      await fetch(`${api}/databases/${dbId}/lock`, { method: 'DELETE', headers: authed })
    }

    if (sectionIf('data source 휴지통 (8e-3a · F-04-23)')) {
      // "데이터 소스" 창에서 소스를 휴지통으로 보내고(한 번 더 묻는다), 사이드바의 휴지통에서 되살리고 영구 삭제한다. 그 소스의 행은 함께
      // 가고 함께 돌아온다 — 휴지통에 있는 동안 행의 주소는 열리지 않는다. 마지막 소스에는 휴지통 단추가 없다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const dbName = `소스휴지통${stamp}`
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: dbName, privateTop: true }) }))).body?.database
      const dbId = created?.id
      const added = (await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { method: 'POST', headers: authed, body: JSON.stringify({ name: '거래처' }) }))).body
      const secondSource = added?.dataSource?.id
      const secondView = added?.viewId
      const secondRow = (await readRes(await fetch(`${api}/views/${secondView}/rows`, { method: 'POST', headers: authed, body: '{}' }))).body?.row?.id
      const LABEL = '[data-testid="db-source-name"]'
      const openPanel = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await evaluate(`!!document.querySelector('[data-testid="db-sources-panel"]')`)) return true
          await clickSelector('[data-testid="db-sources-button"]')
          if (await waitFor(`!!document.querySelector('[data-testid="db-sources-panel"]')`, 1500)) return true
        }
        return false
      }
      const trashButtonOf = (id) => `[data-testid="db-source-item"][data-source-id="${id}"] [data-testid="db-source-trash"]`
      const rowStatus = async () => (await fetch(`${BASE}/w/${workspaceId}/${secondRow}`, { headers: { cookie: authed.cookie } })).status
      check('전제: 둘째 소스에 행이 있고 그 행의 주소가 열린다', !!secondRow && (await rowStatus()) === 200, String(secondRow))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${secondView}` })
      await waitFor(`!!document.querySelector('[data-testid="db-sources-button"]')`, 15000)
      await openPanel()
      check('소스가 둘이면 소스마다 휴지통 단추가 선다', (await evaluate(`document.querySelectorAll('[data-testid="db-source-trash"]').length`)) === 2,
        String(await evaluate(`document.querySelectorAll('[data-testid="db-source-trash"]').length`)))

      // 취소 — 아무것도 보내지 않는다
      await clickSelector(trashButtonOf(secondSource))
      check('★ 휴지통 단추는 창 안에서 한 번 더 묻는다 — 확정 단추가 포커스를 갖는다',
        await waitFor(`!!document.querySelector('[data-testid="db-source-trash-ask"]') && document.activeElement?.getAttribute('data-testid') === 'db-source-trash-confirm'`, 5000))
      await clickSelector('[data-testid="db-source-trash-cancel"]')
      const afterCancel = (await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { headers: authed }))).body?.dataSources?.length
      check('취소하면 묻는 상자가 닫히고 소스는 그대로다',
        (await waitFor(`!document.querySelector('[data-testid="db-source-trash-ask"]')`, 3000)) && afterCancel === 2, String(afterCancel))

      // 보내기 — 보고 있던 소스면 데이터베이스의 첫 뷰로
      await clickSelector(trashButtonOf(secondSource))
      await waitFor(`!!document.querySelector('[data-testid="db-source-trash-confirm"]')`, 3000)
      await clickSelector('[data-testid="db-source-trash-confirm"]')
      check('★ 보고 있던 소스를 휴지통으로 보내면 데이터베이스의 첫 뷰로 옮기고 탭 · 소스 이름이 사라진다',
        await waitFor(`location.search === '' && document.querySelectorAll('[data-testid="db-view-tab"]').length === 1 && !document.querySelector('${LABEL}')`, 15000),
        JSON.stringify([await evaluate('location.search'), await evaluate(`document.querySelectorAll('[data-testid="db-view-tab"]').length`)]))
      check('★ 그 소스의 행도 함께 갔다 — 행의 주소가 열리지 않는다', (await rowStatus()) === 404, String(await rowStatus()))
      await openPanel()
      check('마지막 소스에는 휴지통 단추가 없다', await waitFor(`!document.querySelector('[data-testid="db-source-trash"]') && document.querySelectorAll('[data-testid="db-source-item"]').length === 1`, 5000))
      const lastTry = await readRes(await fetch(`${api}/data-sources/${created?.dataSourceId}/trash`, { method: 'POST', headers: authed }))
      check('마지막 소스를 라우트로 보내도 409 와 그 까닭', lastTry.status === 409 && lastTry.body?.error === 'last_source' && typeof lastTry.body?.message === 'string',
        JSON.stringify(lastTry))

      // 사이드바의 휴지통 — 소스 한 줄 · 되살리기
      const entrySel = `[data-testid="trash-entry"][data-trash-id="${secondSource}"]`
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}` })
      await waitFor(`!!document.querySelector('[data-testid="trash-toggle"]')`, 15000)
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector(${JSON.stringify(entrySel)})`)); i += 1) {
        await clickSelector('[data-testid="trash-toggle"]')
        await waitFor(`!!document.querySelector(${JSON.stringify(entrySel)})`, 1500)
      }
      check('★ 사이드바의 휴지통에 소스가 한 줄로 선다 — 데이터 소스 · 데이터베이스 이름 · 함께 간 항목 수',
        await waitFor(`(() => { const e = document.querySelector(${JSON.stringify(entrySel)})
          return !!e && e.getAttribute('data-trash-kind') === 'data_source' && e.textContent.includes('거래처')
            && e.textContent.includes(${JSON.stringify(`데이터 소스 · ${dbName}`)}) && e.textContent.includes('항목 1개 포함') })()`, 5000),
        String(await evaluate(`document.querySelector(${JSON.stringify(entrySel)})?.textContent ?? null`)))
      check('함께 간 행은 따로 줄을 갖지 않는다', !(await evaluate(`!!document.querySelector('[data-testid="trash-entry"][data-trash-id="${secondRow}"]')`)))
      await clickSelector(`${entrySel} [data-testid="trash-restore"]`)
      check('★ 휴지통에서 되살리면 탭 · 소스 이름이 돌아온다',
        await waitFor(`!document.querySelector(${JSON.stringify(entrySel)}) && document.querySelectorAll('[data-testid="db-view-tab"]').length === 2`, 15000),
        String(await evaluate(`document.querySelectorAll('[data-testid="db-view-tab"]').length`)))
      check('★ 행도 함께 돌아왔다 — 행의 주소가 다시 열린다', (await rowStatus()) === 200, String(await rowStatus()))

      // 영구 삭제 — 확인 창을 받아들이고
      await readRes(await fetch(`${api}/data-sources/${secondSource}/trash`, { method: 'POST', headers: authed }))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}` })
      await waitFor(`!!document.querySelector('[data-testid="trash-toggle"]')`, 15000)
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector(${JSON.stringify(entrySel)})`)); i += 1) {
        await clickSelector('[data-testid="trash-toggle"]')
        await waitFor(`!!document.querySelector(${JSON.stringify(entrySel)})`, 1500)
      }
      await evaluate(`window.confirm = () => true`)
      await clickSelector(`${entrySel} [data-testid="trash-purge"]`)
      const purgedTrash = async () => (await readRes(await fetch(`${api}/trash`, { headers: authed }))).body
      check('★ 영구 삭제하면 휴지통 목록에서 사라지고 되살릴 수 없다',
        (await waitFor(`!document.querySelector(${JSON.stringify(entrySel)})`, 15000))
          && (await fetch(`${api}/data-sources/${secondSource}/trash`, { method: 'DELETE', headers: authed })).status === 404,
        JSON.stringify(await purgedTrash()).slice(0, 200))
    }

    if (sectionIf('뷰 지우기 (8e-3b · F-04-01 · F-04-23)')) {
      // 뷰 메뉴의 "뷰 지우기" — 메뉴 안에서 한 번 더 묻고, 지우면 첫 뷰로 옮긴다. 데이터베이스의 마지막 뷰에는 서지 않는다. 그 소스를 보는
      // 마지막 뷰면 "뷰와 소스를 함께 휴지통으로"를 묻는다(되살리면 그 뷰도 돌아온다). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: `뷰지우기${stamp}`, privateTop: true }) }))).body?.database
      const dbId = created?.id
      const viewsOf = async () => (await readRes(await fetch(`${api}/databases/${dbId}/views`, { headers: authed }))).body?.views ?? []
      const tabCount = () => evaluate(`document.querySelectorAll('[data-testid="db-view-tab"]').length`)
      // 하이드레이션 전의 클릭은 아무 일이 없다 — 열릴 때까지 몇 번 누른다.
      const openMenu = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await evaluate(`!!document.querySelector('[data-testid="db-view-menu-panel"]')`)) return true
          await clickSelector('[data-testid="db-view-menu"]')
          if (await waitFor(`!!document.querySelector('[data-testid="db-view-menu-panel"]')`, 1500)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}` })
      await waitFor(`!!document.querySelector('[data-testid="db-view-menu"]')`, 15000)
      await openMenu()
      check('데이터베이스의 마지막 뷰에는 "뷰 지우기"가 없다', !(await evaluate(`!!document.querySelector('[data-testid="db-view-delete"]')`)))

      // 뷰가 둘 — 같은 소스
      const listView = (await readRes(await fetch(`${api}/databases/${dbId}/views`, { method: 'POST', headers: authed, body: JSON.stringify({ name: '목록', type: 'list' }) }))).body?.view
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${listView?.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-view-tab"]').length === 2`, 15000)
      await openMenu()
      await clickSelector('[data-testid="db-view-delete"]')
      check('★ "뷰 지우기"는 메뉴 안에서 한 번 더 묻는다 — 확정 단추가 포커스를 갖고, 같은 소스의 뷰가 더 있으면 뷰만 지운다고 말한다',
        await waitFor(`!!document.querySelector('[data-testid="db-view-delete-ask"]')
          && document.activeElement?.getAttribute('data-testid') === 'db-view-delete-confirm'
          && !document.querySelector('[data-testid="db-view-delete-with-source-note"]')
          && document.querySelector('[data-testid="db-view-delete-confirm"]')?.textContent === '지우기'`, 5000))
      await clickSelector('[data-testid="db-view-delete-cancel"]')
      check('취소하면 묻는 상자가 닫히고 뷰는 그대로다',
        (await waitFor(`!document.querySelector('[data-testid="db-view-delete-ask"]') && !!document.querySelector('[data-testid="db-view-delete"]')`, 3000))
          && (await viewsOf()).length === 2)
      await clickSelector('[data-testid="db-view-delete"]')
      await waitFor(`!!document.querySelector('[data-testid="db-view-delete-confirm"]')`, 3000)
      await clickSelector('[data-testid="db-view-delete-confirm"]')
      const afterDelete = async () => (await viewsOf()).map((v) => v.id)
      check('★ 지우면 그 뷰가 사라지고 데이터베이스의 첫 뷰로 옮긴다',
        (await waitFor(`location.search === '' && document.querySelectorAll('[data-testid="db-view-tab"]').length === 1`, 15000))
          && JSON.stringify(await afterDelete()) === JSON.stringify([created?.defaultViewId]),
        JSON.stringify([await evaluate('location.search'), await tabCount(), await afterDelete()]))

      // 소스의 마지막 뷰 — 뷰와 소스를 함께 휴지통으로
      const added = (await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { method: 'POST', headers: authed, body: JSON.stringify({ name: '협력사' }) }))).body
      const secondSource = added?.dataSource?.id
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${added?.viewId}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-view-tab"]').length === 2`, 15000)
      await openMenu()
      await clickSelector('[data-testid="db-view-delete"]')
      check('★ 소스를 보는 마지막 뷰면 "뷰와 데이터 소스를 함께 휴지통으로"를 묻는다 — 그 소스의 이름과 함께',
        await waitFor(`(() => { const note = document.querySelector('[data-testid="db-view-delete-with-source-note"]')
          return !!note && note.textContent.includes('협력사') && document.querySelector('[data-testid="db-view-delete-confirm"]')?.textContent === '뷰와 소스를 함께 휴지통으로' })()`, 5000),
        String(await evaluate(`document.querySelector('[data-testid="db-view-delete-ask"]')?.textContent ?? null`)))
      await clickSelector('[data-testid="db-view-delete-confirm"]')
      const sourcesNow = async () => (await readRes(await fetch(`${api}/databases/${dbId}/data-sources`, { headers: authed }))).body?.dataSources?.map((d) => d.id) ?? []
      const inTrash = async () => ((await readRes(await fetch(`${api}/trash`, { headers: authed }))).body?.entries ?? []).some((e) => e.id === secondSource && e.kind === 'data_source')
      check('★ 확정하면 소스가 휴지통으로 가고 데이터베이스의 첫 뷰로 옮긴다',
        (await waitFor(`location.search === '' && document.querySelectorAll('[data-testid="db-view-tab"]').length === 1`, 15000))
          && JSON.stringify(await sourcesNow()) === JSON.stringify([created?.dataSourceId]) && (await inTrash()),
        JSON.stringify([await evaluate('location.search'), await tabCount(), await sourcesNow(), await inTrash()]))
      const restored = await fetch(`${api}/data-sources/${secondSource}/trash`, { method: 'DELETE', headers: authed })
      const viewsBack = (await viewsOf()).map((v) => v.id)
      check('되살리면 그 뷰도 돌아온다 — 지우지 않고 숨겼다', restored.ok && viewsBack.includes(added?.viewId), JSON.stringify([restored.status, viewsBack]))
    }

    if (sectionIf('행 페이지 (8f-1 · F-16-07 · F-16-03)')) {
      // 표의 제목 칸 · 보드 카드의 "열기"로 행 페이지를 연다. 경로는 그 데이터베이스, 제목은 제목 셀, 본문 위에 속성 묶음(스키마 순서 ·
      // 뷰에서 숨긴 것도). 행에 맞지 않는 머리 단추는 서지 않고, 지우면 그 표로 돌아간다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const dbName = `행페이지${stamp}`
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: dbName, privateTop: true }) }))).body?.database
      const dbId = created?.id
      const ds = created?.dataSourceId
      const viewId = created?.defaultViewId
      const addProp = async (name, type) => (await readRes(await fetch(`${api}/data-sources/${ds}/properties`, { method: 'POST', headers: authed, body: JSON.stringify({ name, type }) }))).body
      await addProp('수량', 'number')
      const schema = await addProp('메모', 'rich_text')
      const props = schema?.schema?.properties ?? []
      const idOf = (name) => props.find((p) => p.name === name)?.id
      // 뷰에서 "메모"를 숨긴다 — 행 페이지의 속성 묶음에는 그래도 있어야 한다(뷰가 아니라 스키마의 것).
      await fetch(`${api}/views/${viewId}/columns/${idOf('메모')}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ visible: false }) })
      const row = (await readRes(await fetch(`${api}/views/${viewId}/rows`, { method: 'POST', headers: authed, body: JSON.stringify({ cells: [{ propertyId: idOf('이름'), value: { type: 'title', title: [textRun('첫 행')] } }] }) }))).body?.row
      const rowId = row?.id
      const ROW_URL = `${BASE}/w/${workspaceId}/${rowId}`

      // 표의 제목 칸 — "열기"
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}` })
      await waitFor(`!!document.querySelector('[data-testid="db-row-open"]')`, 15000)
      check('제목 칸의 "열기"는 제목의 글자에 섞이지 않는다', (await evaluate(`document.querySelector('[data-testid="db-row-title"]')?.textContent`)) === '첫 행',
        String(await evaluate(`document.querySelector('[data-testid="db-row-title"]')?.textContent`)))
      for (let i = 0; i < 6 && !(await evaluate(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${rowId}`)}`)); i += 1) {
        await clickSelector('[data-testid="db-row-open"]')
        await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${rowId}`)}`, 2000)
      }
      check('★ 표의 제목 칸에서 "열기"를 누르면 행 페이지가 열린다',
        await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${rowId}`)} && !!document.querySelector('[data-testid="row-properties"]')`, 15000),
        String(await evaluate('location.pathname')))

      const crumbs = `[...document.querySelectorAll('nav[aria-label="상위 경로"] > span')].map((s) => s.textContent.trim())`
      check('★ 경로는 워크스페이스 · 그 데이터베이스 · 이 행',
        JSON.stringify(await evaluate(crumbs)) === JSON.stringify(['워크스페이스', `/${dbName}`, '/첫 행'])
          && (await evaluate(`!!document.querySelector('nav[aria-label="상위 경로"] a[href="/w/${workspaceId}/db/${dbId}"]')`)),
        JSON.stringify(await evaluate(crumbs)))
      const propNames = `[...document.querySelectorAll('[data-testid="row-properties"] td[data-property-id]')].map((td) => td.getAttribute('data-property-id'))`
      check('★ 본문 위에 속성 묶음 — 스키마 순서 · 뷰에서 숨긴 속성도 · 제목은 빠진다',
        JSON.stringify(await evaluate(propNames)) === JSON.stringify([idOf('수량'), idOf('메모')]),
        JSON.stringify(await evaluate(propNames)))
      check('속성 묶음은 본문 편집기보다 위에 선다',
        await evaluate(`(() => { const p = document.querySelector('[data-testid="row-properties"]'); const e = document.querySelector('.blk-editor[aria-label="페이지 본문"]')
          return !!p && !!e && (p.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 })()`))
      // 머리 단추 — 보통 페이지에는 서는 것(대조)이 행 페이지에는 없다. 공유 단추는 testid 가 없어 글자로 고른다.
      const headTestIds = ['move-open', 'export-button', 'page-duplicate']
      const plainHtml = await (await fetch(`${BASE}/w/${workspaceId}/${pageId}`, { headers: { cookie: authed.cookie } })).text()
      const plainHas = headTestIds.every((id) => plainHtml.includes(`data-testid="${id}"`)) && plainHtml.includes('>공유</button>')
      const rowHeads = `(() => ({ testIds: ${JSON.stringify(headTestIds)}.filter((id) => !!document.querySelector('[data-testid="' + id + '"]')),
          share: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유') }))()`
      const rowHas = await evaluate(rowHeads)
      check('행에 맞지 않는 머리 단추(공유 · 옮기기 · 내보내기 · 복제)가 서지 않는다 — 보통 페이지에는 선다',
        plainHas && rowHas.testIds.length === 0 && rowHas.share === false, JSON.stringify({ plainHas, rowHas }))

      // 셀 편집 — 숫자
      const qtyCell = `[data-testid="row-properties"] td[data-property-id="${idOf('수량')}"]`
      await clickSelector(qtyCell)
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(`!!document.querySelector('[data-testid="db-cell-input"]')`, 3000)
      await typeText('42')
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      const savedQty = async () => {
        const rows = (await readRes(await fetch(`${api}/views/${viewId}/rows`, { headers: authed }))).body?.rows ?? []
        return rows.find((r) => r.id === rowId)?.properties?.[idOf('수량')]?.number ?? null
      }
      let qty = null
      for (let i = 0; i < 20 && qty !== 42; i += 1) { await sleep(250); qty = await savedQty() }
      check('★ 행 페이지의 속성 묶음에서 셀을 고치면 저장된다', qty === 42, String(qty))

      // 제목 — 제목 셀로
      const titleInput = '[data-testid="row-title"]'
      await clickSelector(titleInput)
      await evaluate(`(() => { const el = document.querySelector('${titleInput}'); if (el && typeof el.select === 'function') el.select() })()`)
      await typeText('고친 행')
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      const titleOf = async () => {
        const rows = (await readRes(await fetch(`${api}/views/${viewId}/rows`, { headers: authed }))).body?.rows ?? []
        return rows.find((r) => r.id === rowId)?.title ?? null
      }
      let title = null
      for (let i = 0; i < 20 && title !== '고친 행'; i += 1) { await sleep(250); title = await titleOf() }
      check('★ 제목을 고치면 제목 셀에 저장되고 경로가 따라온다',
        title === '고친 행' && (await waitFor(`${crumbs}.at(-1) === '/고친 행'`, 8000)),
        JSON.stringify([title, await evaluate(crumbs)]))

      // 잠긴 행 페이지 — 제목 · 셀을 고칠 수 없다(셀 저장은 그 행의 잠금을 묻는다)
      const locked = await fetch(`${api}/pages/${rowId}/lock`, { method: 'PUT', headers: authed })
      const lockedHtml = await (await fetch(ROW_URL, { headers: { cookie: authed.cookie } })).text()
      check('잠긴 행 페이지 — 제목은 글자로 · 셀은 읽기 전용이다',
        locked.ok && !lockedHtml.includes('aria-label="제목"') && lockedHtml.includes('data-testid="row-title"') && lockedHtml.includes('aria-readonly="true"'),
        JSON.stringify([locked.status, lockedHtml.includes('aria-label="제목"'), lockedHtml.includes('aria-readonly="true"')]))
      await fetch(`${api}/pages/${rowId}/lock`, { method: 'DELETE', headers: authed })

      // 보드 카드 — "열기"
      const board = (await readRes(await fetch(`${api}/databases/${dbId}/views`, { method: 'POST', headers: authed, body: JSON.stringify({ type: 'board' }) }))).body?.view
      await addProp('단계', 'select')
      const boardView = board?.id ?? (await readRes(await fetch(`${api}/databases/${dbId}/views`, { method: 'POST', headers: authed, body: JSON.stringify({ type: 'board' }) }))).body?.view?.id
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${dbId}?v=${boardView}` })
      await waitFor(`!!document.querySelector('[data-testid="db-board-card"] [data-testid="db-row-open"]')`, 15000)
      check('카드의 "열기"도 제목의 글자에 섞이지 않는다', (await evaluate(`document.querySelector('[data-testid="db-board-card-title"]')?.textContent`)) === '고친 행',
        String(await evaluate(`document.querySelector('[data-testid="db-board-card-title"]')?.textContent`)))
      for (let i = 0; i < 6 && !(await evaluate(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${rowId}`)}`)); i += 1) {
        await clickSelector('[data-testid="db-board-card"] [data-testid="db-row-open"]')
        await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${rowId}`)}`, 2000)
      }
      check('★ 보드 카드의 "열기"로도 행 페이지가 열린다', await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${rowId}`)} && !!document.querySelector('[data-testid="row-title"]')`, 15000),
        String(await evaluate('location.pathname')))

      // 지우기 — 그 표로 돌아간다
      await evaluate(`window.confirm = () => true`)
      await clickText('삭제')
      check('★ 행 페이지에서 지우면 그 데이터베이스로 돌아간다',
        await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/db/${dbId}`)}`, 15000),
        String(await evaluate('location.pathname')))
    }

    if (sectionIf('행 페이지 레이아웃 (8f-2 · F-16-03 · F-16-01)')) {
      // 행 페이지의 "레이아웃 편집"에서 숨기고 순서를 바꾼 뒤 "모든 행에 적용" — 같은 데이터베이스의 다른 행도 따른다. 숨긴 속성은
      // "숨긴 속성 N개"로 펼쳐 채운다. 취소는 아무것도 바꾸지 않고, 남이 먼저 적용했으면 거부된다. 잠긴 데이터베이스에는 단추가 없다.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: `레이아웃${stamp}`, privateTop: true }) }))).body?.database
      const dbId = created?.id
      const ds = created?.dataSourceId
      const viewId = created?.defaultViewId
      const addProp = async (name, type) => (await readRes(await fetch(`${api}/data-sources/${ds}/properties`, { method: 'POST', headers: authed, body: JSON.stringify({ name, type }) }))).body
      await addProp('수량', 'number')
      await addProp('메모', 'rich_text')
      const props = (await addProp('마감', 'date'))?.schema?.properties ?? []
      const idOf = (name) => props.find((p) => p.name === name)?.id
      const makeRow = async (title) => (await readRes(await fetch(`${api}/views/${viewId}/rows`, { method: 'POST', headers: authed,
        body: JSON.stringify({ cells: [{ propertyId: idOf('이름'), value: { type: 'title', title: [textRun(title)] } }] }) }))).body?.row?.id
      const rowA = await makeRow('첫 행')
      const rowB = await makeRow('둘째 행')

      const layoutVersion = async () => (await dbQuery(`SELECT version::text AS v FROM page_layout WHERE data_source_id = $1`, [ds]))[0]?.v ?? '0'
      const schemaOrder = async () => (await dbQuery(`SELECT name FROM property WHERE data_source_id = $1 AND deleted_at IS NULL ORDER BY order_idx, id`, [ds])).map((r) => r.name)
      const idsExpr = (testId) => `[...document.querySelectorAll('[data-testid="${testId}"] td[data-property-id]')].map((td) => td.getAttribute('data-property-id'))`
      const idsIn = (testId) => evaluate(idsExpr(testId))
      const editorIds = () => evaluate(`[...document.querySelectorAll('[data-testid="row-layout-item"]')].map((li) => li.getAttribute('data-property-id'))`)
      const item = (name, testId) => `[data-testid="row-layout-item"][data-property-id="${idOf(name)}"] [data-testid="${testId}"]`
      const ids = (...names) => JSON.stringify(names.map(idOf))
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      // 하이드레이션 전의 클릭은 아무 일이 없다 — 열릴 때까지 몇 번 누른다.
      const openEditor = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await has('[data-testid="row-layout-editor"]')) return true
          await clickSelector('[data-testid="row-layout-edit"]')
          if (await waitFor(`!!document.querySelector('[data-testid="row-layout-editor"]')`, 1500)) return true
        }
        return false
      }
      const openRow = async (rowId) => {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${rowId}` })
        return waitFor(`!!document.querySelector('[data-testid="row-layout-edit"]') && !!document.querySelector('[data-testid="row-title"]')`, 15000)
      }

      await openRow(rowA)
      check('처음에는 스키마 순서로 모두 보인다 — "숨긴 속성" 단추가 없다',
        JSON.stringify(await idsIn('row-visible-properties')) === ids('수량', '메모', '마감') && !(await has('[data-testid="row-hidden-toggle"]')),
        JSON.stringify(await idsIn('row-visible-properties')))

      check('★ "레이아웃 편집"을 누르면 편집 모드 — 속성이 스키마 순서로 늘어서고 표는 가려진다',
        (await openEditor()) && JSON.stringify(await editorIds()) === ids('수량', '메모', '마감')
          && (await evaluate(`document.querySelector('[data-testid="row-visible-properties"]')?.offsetParent === null`)),
        JSON.stringify(await editorIds()))

      // 수량을 숨기고 마감을 맨 위로
      await clickSelector(item('수량', 'row-layout-visibility'))
      await clickSelector(item('마감', 'row-layout-up'))
      await clickSelector(item('마감', 'row-layout-up'))
      check('옮긴 뒤에도 포커스가 그 속성에 남는다 — 맨 위에 닿으면 아래 단추로',
        await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(item('마감', 'row-layout-down'))})`),
        String(await evaluate(`document.activeElement?.getAttribute('aria-label')`)))
      check('초안은 화면에만 있다 — 목록은 바뀌고 서버는 그대로(머리도 없다)',
        JSON.stringify(await editorIds()) === ids('마감', '수량', '메모')
          && (await evaluate(`document.querySelector(${JSON.stringify(item('수량', 'row-layout-visibility'))})?.getAttribute('aria-pressed')`)) === 'true'
          && (await layoutVersion()) === '0',
        JSON.stringify([await editorIds(), await layoutVersion()]))

      await clickSelector('[data-testid="row-layout-apply"]')
      check('★ "모든 행에 적용" — 편집 모드가 닫히고 새 순서 · 숨김으로 다시 그린다',
        await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]')
          && JSON.stringify(${idsExpr('row-visible-properties')}) === ${JSON.stringify(ids('마감', '메모'))}
          && document.querySelector('[data-testid="row-hidden-toggle"]')?.textContent.includes('숨긴 속성 1개')`, 15000),
        JSON.stringify([await idsIn('row-visible-properties'), await evaluate(`document.querySelector('[data-testid="row-hidden-toggle"]')?.textContent ?? null`)]))
      check('★ 서버 — 레이아웃의 첫 버전 · 스키마 순서가 바뀌었다',
        (await layoutVersion()) === '1' && JSON.stringify(await schemaOrder()) === JSON.stringify(['이름', '마감', '수량', '메모']),
        JSON.stringify([await layoutVersion(), await schemaOrder()]))
      check('편집 모드를 닫으면 포커스가 "레이아웃 편집" 단추로 돌아온다',
        await waitFor(`document.activeElement?.getAttribute('data-testid') === 'row-layout-edit'`, 3000),
        String(await evaluate(`document.activeElement?.outerHTML.slice(0, 80) ?? null`)))

      // 숨긴 속성 — 펼쳐서 채운다
      await clickSelector('[data-testid="row-hidden-toggle"]')
      check('★ "숨긴 속성 1개"를 펼치면 숨긴 속성이 선다',
        await waitFor(`document.querySelector('[data-testid="row-hidden-toggle"]')?.getAttribute('aria-expanded') === 'true'
          && document.querySelector('[data-testid="row-hidden-properties"]')?.offsetParent !== null`, 5000)
          && JSON.stringify(await idsIn('row-hidden-properties')) === ids('수량'),
        JSON.stringify(await idsIn('row-hidden-properties')))
      const qtyCell = `[data-testid="row-hidden-properties"] td[data-property-id="${idOf('수량')}"]`
      await clickSelector(qtyCell)
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(`!!document.querySelector('[data-testid="db-cell-input"]')`, 3000)
      await typeText('7')
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      const savedQty = async () => {
        const rows = (await readRes(await fetch(`${api}/views/${viewId}/rows`, { headers: authed }))).body?.rows ?? []
        return rows.find((r) => r.id === rowA)?.properties?.[idOf('수량')]?.number ?? null
      }
      let qty = null
      for (let i = 0; i < 20 && qty !== 7; i += 1) { await sleep(250); qty = await savedQty() }
      check('★ 숨긴 속성도 채울 수 있다 — 숨김은 표시 규칙이다', qty === 7, String(qty))

      // 취소 — 아무것도 바꾸지 않고, 그사이 고친 값도 그대로 보인다(편집하는 동안 표를 내리지 않는다)
      await openEditor()
      await clickSelector(item('메모', 'row-layout-visibility'))
      await clickSelector('[data-testid="row-layout-cancel"]')
      check('★ 취소하면 초안을 버린다 — 서버도 화면도 그대로 · 고친 값이 옛값으로 돌아가지 않는다',
        await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]')
          && JSON.stringify(${idsExpr('row-visible-properties')}) === ${JSON.stringify(ids('마감', '메모'))}
          && (document.querySelector(${JSON.stringify(qtyCell)})?.textContent ?? '').includes('7')`, 5000)
          && (await layoutVersion()) === '1',
        JSON.stringify([await idsIn('row-visible-properties'), await evaluate(`document.querySelector(${JSON.stringify(qtyCell)})?.textContent ?? null`), await layoutVersion()]))
      await clickSelector('[data-testid="row-hidden-toggle"]')
      await clickSelector('[data-testid="row-hidden-toggle"]')
      check('숨긴 속성을 접었다 펴도 고친 값이 그대로다 — 접혀도 표를 내리지 않는다',
        await waitFor(`document.querySelector('[data-testid="row-hidden-toggle"]')?.getAttribute('aria-expanded') === 'true'
          && (document.querySelector(${JSON.stringify(qtyCell)})?.textContent ?? '').includes('7')`, 5000),
        String(await evaluate(`document.querySelector(${JSON.stringify(qtyCell)})?.textContent ?? null`)))

      // 다른 행 — 레이아웃은 데이터베이스의 모든 행의 것이다
      await openRow(rowB)
      check('★ 같은 데이터베이스의 다른 행도 같은 레이아웃이다',
        JSON.stringify(await idsIn('row-visible-properties')) === ids('마감', '메모')
          && (await evaluate(`document.querySelector('[data-testid="row-hidden-toggle"]')?.textContent ?? ''`)).includes('숨긴 속성 1개'),
        JSON.stringify(await idsIn('row-visible-properties')))

      // 남이 먼저 적용했다 — 거부되고 초안은 남는다
      await openEditor()
      const other = await fetch(`${api}/data-sources/${ds}/layout`, { method: 'PUT', headers: authed,
        body: JSON.stringify({ version: '1', order: [], hidden: [idOf('수량'), idOf('메모')] }) })
      await clickSelector(item('마감', 'row-layout-visibility'))
      await clickSelector('[data-testid="row-layout-apply"]')
      check('★ 남이 먼저 적용했으면 거부된다 — 알리고 편집 모드에 남는다 · 남의 레이아웃은 그대로',
        other.ok && (await waitFor(`(document.querySelector('[data-testid="row-layout-error"]')?.textContent ?? '').includes('다른 사람이 먼저')`, 8000))
          && (await has('[data-testid="row-layout-editor"]')) && (await layoutVersion()) === '2'
          // 양쪽을 JS 로 정렬한다 — DB 의 `ORDER BY` 는 ko-KR 정렬 규칙(대소문자를 섞는다)이라 JS 의 `.sort()` 와 순서가 다를 수 있다(무작위
          // id 의 대소문자에 따라 갈렸다 · §3.3-345 ①)
          && JSON.stringify((await dbQuery(`SELECT property_id FROM layout_module WHERE data_source_id = $1 AND kind = 'property'`, [ds])).map((r) => r.property_id).sort())
            === JSON.stringify([idOf('수량'), idOf('메모')].sort()),
        // 상세에 조건 넷을 모두 싣는다 — 전체 판(부하)에서 한 번 떨어졌는데 무엇이었는지 알 수 없었다(§3.3-286 ⑥).
        JSON.stringify([other.status, await evaluate(`document.querySelector('[data-testid="row-layout-error"]')?.textContent ?? null`), await layoutVersion(),
          await has('[data-testid="row-layout-editor"]'),
          (await dbQuery(`SELECT property_id FROM layout_module WHERE data_source_id = $1 AND kind = 'property' ORDER BY property_id`, [ds])).map((r) => r.property_id),
          [idOf('수량'), idOf('메모')].sort()]))
      await clickSelector('[data-testid="row-layout-cancel"]')

      // 잠긴 데이터베이스 — 단추가 없고 서버도 거부한다
      const locked = await fetch(`${api}/databases/${dbId}/lock`, { method: 'PUT', headers: authed })
      const lockedHtml = await (await fetch(`${BASE}/w/${workspaceId}/${rowB}`, { headers: { cookie: authed.cookie } })).text()
      const lockedPut = await fetch(`${api}/data-sources/${ds}/layout`, { method: 'PUT', headers: authed, body: JSON.stringify({ version: '2', order: [], hidden: [] }) })
      check('잠긴 데이터베이스 — "레이아웃 편집"이 서지 않고 적용은 409 다(숨긴 속성은 그대로 펼칠 수 있다)',
        locked.ok && !lockedHtml.includes('data-testid="row-layout-edit"') && lockedHtml.includes('data-testid="row-hidden-toggle"') && lockedPut.status === 409,
        JSON.stringify([locked.status, lockedHtml.includes('data-testid="row-layout-edit"'), lockedPut.status]))
      await fetch(`${api}/databases/${dbId}/lock`, { method: 'DELETE', headers: authed })
    }

    if (sectionIf('설정 화면 (8g-1 · F-17-12)')) {
      // 사이드바의 "설정"으로 연다. 왼쪽 내비와 항목은 레지스트리에서 나온다 — 소유자는 내 계정(프로필) · 워크스페이스(일반 · 보안), 멤버는
      // 보안 절이 없고 워크스페이스 이름이 읽기 전용, 게스트는 내 계정만. 내 이름 · 워크스페이스 이름을 고치면 사이드바 · 홈이 따라온다.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 끝에 두 이름을 되돌린다.
      const stamp = Date.now()
      const settingsApi = (key) => `${BASE}/api/workspaces/${workspaceId}/settings/${key}`
      const row = (key) => `[data-testid="setting-row"][data-setting-key="${key}"]`
      const control = (key) => `${row(key)} [data-testid="setting-control"]`
      const statusOf = (key) => evaluate(`document.querySelector(${JSON.stringify(`${row(key)} [data-testid="setting-status"]`)})?.textContent ?? null`)
      const valueOf = (key) => evaluate(`document.querySelector(${JSON.stringify(control(key))})?.value ?? null`)
      const navSections = () => evaluate(`[...document.querySelectorAll('[data-testid="settings-nav-link"]')].map((a) => a.getAttribute('data-section'))`)
      const title = () => evaluate(`document.querySelector('[data-testid="settings-title"]')?.textContent ?? null`)
      const key = (name, code, vk) => async () => {
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: vk })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk })
      }
      const enter = key('Enter', 'Enter', 13)
      const backspace = key('Backspace', 'Backspace', 8)
      const escape = key('Escape', 'Escape', 27)
      // 글자를 통째로 바꾸고 Enter(또는 포커스를 옮겨) 저장한다. 하이드레이션 전에 쓴 글자는 저장되지 않는다 — 상태 줄이 설 때까지 다시 한다.
      const setText = async (settingKey, text, commit = enter) => {
        for (let i = 0; i < 6; i += 1) {
          await clickSelector(control(settingKey))
          await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(control(settingKey))}); el?.focus(); el?.select() })()`)
          if (text === '') await backspace()
          else await typeText(text)
          await commit()
          if (await waitFor(`!!document.querySelector(${JSON.stringify(`${row(settingKey)} [data-testid="setting-status"]`)})`, 2000)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="sidebar-settings"]')`, 15000)
      const originalWorkspace = await evaluate(`document.querySelector('[data-testid="sidebar-workspace-name"]')?.textContent ?? null`)
      await clickSelector('[data-testid="sidebar-settings"]')
      check('★ 사이드바의 "설정"으로 연다 — 첫 절은 내 계정의 프로필',
        await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/settings`)} && document.querySelector('[data-testid="settings-title"]')?.textContent === '프로필'`, 15000),
        JSON.stringify([await evaluate('location.pathname'), await title()]))
      check('★ 소유자의 내비 — 내 계정(프로필 · 환경설정 · 보안) · 워크스페이스(일반 · 사람 · 보안)',
        JSON.stringify(await navSections()) === JSON.stringify(['account.profile', 'account.preferences', 'account.security', 'workspace.general', 'workspace.people', 'workspace.security', 'workspace.plan']),
        JSON.stringify(await navSections()))

      // 내 이름 — Enter 로 저장 · 공백을 정리한 값이 남는다
      const originalName = await valueOf('account.name')
      const myName = `설정 이름 ${stamp}`
      await setText('account.name', `  설정   이름 ${stamp}  `)
      check('★ 내 이름 — Enter 로 저장하면 "저장했습니다" · 공백을 정리한 값이 칸에 남는다',
        (await waitFor(`(document.querySelector(${JSON.stringify(`${row('account.name')} [data-testid="setting-status"]`)})?.textContent ?? '') === '저장했습니다.'
          && document.querySelector(${JSON.stringify(control('account.name'))})?.value === ${JSON.stringify(myName)}`, 8000)),
        JSON.stringify([await statusOf('account.name'), await valueOf('account.name')]))

      // 비우면 거부되고 · Esc 는 저장된 값으로 되돌린다 · 서버는 그대로
      await setText('account.name', '')
      check('★ 비우면 거부되고 이유를 말한다 — 쓴 글자(빈 칸)는 남는다',
        (await waitFor(`(document.querySelector(${JSON.stringify(`${row('account.name')} [role="alert"]`)})?.textContent ?? '').includes('비워 둘 수 없고')`, 8000))
          && (await valueOf('account.name')) === '',
        JSON.stringify([await statusOf('account.name'), await valueOf('account.name')]))
      await escape()
      check('Esc 는 저장된 값으로 되돌린다', (await valueOf('account.name')) === myName, String(await valueOf('account.name')))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings` })
      check('새로 열어도 저장된 이름이다 — 거부된 빈 이름은 쓰이지 않았다',
        await waitFor(`document.querySelector(${JSON.stringify(control('account.name'))})?.value === ${JSON.stringify(myName)}`, 15000),
        String(await valueOf('account.name')))

      // 워크스페이스 이름 — 포커스를 옮기면 저장 · 사이드바 머리와 홈이 따라온다
      const wsName = `설정 워크스페이스 ${stamp}`
      await clickSelector('[data-testid="settings-nav-link"][data-section="workspace.general"]')
      await waitFor(`document.querySelector('[data-testid="settings-title"]')?.textContent === '일반'`, 15000)
      await setText('workspace.name', wsName, () => clickSelector('[data-testid="settings-title"]'))
      check('★ 워크스페이스 이름 — 포커스를 옮기면 저장되고 사이드바 머리가 따라온다',
        await waitFor(`document.querySelector('[data-testid="sidebar-workspace-name"]')?.textContent === ${JSON.stringify(wsName)}`, 10000),
        JSON.stringify([await statusOf('workspace.name'), await evaluate(`document.querySelector('[data-testid="sidebar-workspace-name"]')?.textContent ?? null`)]))
      const homeHtml = await (await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie: authed.cookie } })).text()
      check('홈의 제목도 그 이름이다', homeHtml.includes(`data-testid="workspace-title">${wsName}<`), String(homeHtml.includes(wsName)))

      // 멤버 — 보안 절이 없고 워크스페이스 이름은 읽기 전용 · 바꾸는 API 는 403 · 자기 이름은 고친다
      const mate = await joinAs(workspaceId, await createUser(`설정의 멤버 ${stamp}`), 'member')
      const asMate = { ...json, cookie: `nc_session=${mate.token}` }
      const mateHtml = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.general`, { headers: asMate })).text()
      const mateRename = await fetch(settingsApi('workspace.name'), { method: 'PUT', headers: asMate, body: JSON.stringify({ value: '몰래' }) })
      const mateSelf = await fetch(settingsApi('account.name'), { method: 'PUT', headers: asMate, body: JSON.stringify({ value: `고친 멤버 ${stamp}` }) })
      check('★ 멤버 — 보안 절이 없고 워크스페이스 이름은 읽기 전용("소유자만") · 바꾸는 API 는 403 · 자기 이름은 고친다',
        !mateHtml.includes('data-section="workspace.security"') && mateHtml.includes('data-testid="setting-readonly-note"')
          && mateHtml.includes('소유자만 바꿀 수 있습니다') && !mateHtml.includes(`value="${wsName}"`) && mateHtml.includes(wsName)
          && mateRename.status === 403 && mateSelf.ok,
        JSON.stringify([mateHtml.includes('data-section="workspace.security"'), mateHtml.includes('setting-readonly-note'), mateRename.status, mateSelf.status]))

      // 게스트 — 내 계정만 · 워크스페이스 절을 주소로 열어도 프로필이다
      const visitor = await joinAs(workspaceId, await createUser(`설정의 게스트 ${stamp}`), 'guest')
      const guestHtml = await (await fetch(`${BASE}/w/${workspaceId}/settings?s=workspace.general`, { headers: { ...json, cookie: `nc_session=${visitor.token}` } })).text()
      check('게스트에게는 내 계정만 선다 — 워크스페이스 절을 주소로 열어도 프로필이다',
        guestHtml.includes('data-section="account.profile"') && !guestHtml.includes('data-section="workspace.general"')
          && /data-testid="settings-title"[^>]*>프로필</.test(guestHtml) && !guestHtml.includes('data-setting-key="workspace.name"'),
        String(guestHtml.includes('data-section="workspace.general"')))

      // 되돌린다 — 뒤 절이 이름을 보지 않지만 다음 판을 위해
      await fetch(settingsApi('account.name'), { method: 'PUT', headers: authed, body: JSON.stringify({ value: originalName }) })
      await fetch(settingsApi('workspace.name'), { method: 'PUT', headers: authed, body: JSON.stringify({ value: originalWorkspace }) })
    }

    if (sectionIf('휴지통 보관 기간 (4b-3 · F-11-06)')) {
      // 설정 → 워크스페이스 → 보안의 "휴지통 보관 기간"(1 ~ 3650일)은 Enterprise 만 바꾼다(엔타이틀먼트 `trash.custom_retention`). 이 판의
      // 워크스페이스는 Business 라 처음엔 보이되 읽기 전용("요금제 필요") · 서버도 403 plan_required. Enterprise 로 올리면 숫자 칸이 서고, 범위
      // 밖은 거부 · Esc 는 되돌림 · Enter 로 저장. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 끝에 기간 · 요금제를 되돌린다.
      const { setWorkspacePlan } = await import(new URL('../src/lib/billing/plan.ts', import.meta.url).href)
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const SECURITY = `${BASE}/w/${workspaceId}/settings?s=workspace.security`
      const ROW = '[data-testid="setting-row"][data-setting-key="workspace.trash_days"]'
      const CONTROL = `${ROW} [data-testid="setting-control"]`
      const trashDaysApi = `${BASE}/api/workspaces/${workspaceId}/settings/workspace.trash_days`
      const days = async () => Number((await dbQuery(`SELECT trash_days AS d FROM workspace WHERE id = $1`, [workspaceId]))[0]?.d)
      const rowState = () => evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(ROW)})
        if (row === null) return null
        const control = row.querySelector('[data-testid="setting-control"]')
        return {
          tag: control?.tagName ?? null, type: control?.getAttribute('type') ?? null, value: control?.value ?? null, text: control?.textContent ?? null,
          badge: row.querySelector('[data-testid="setting-plan-badge"]')?.textContent ?? null,
          note: row.querySelector('[data-testid="setting-readonly-note"]')?.textContent ?? null,
          unit: row.querySelector('[data-testid="setting-unit"]')?.textContent ?? null,
          status: row.querySelector('[data-testid="setting-status"]')?.textContent ?? null,
        }
      })()`)
      const pressKey = (name, code, vk) => async () => {
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: vk })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk })
      }
      const enter = pressKey('Enter', 'Enter', 13)
      const escape = pressKey('Escape', 'Escape', 27)
      // 숫자 칸을 통째로 바꿔 쓴다 — 하이드레이션 전에 쓴 글자는 사라지므로 칸이 그 글자가 될 때까지 다시 한다.
      const fill = async (text) => {
        for (let i = 0; i < 6; i += 1) {
          await clickSelector(CONTROL)
          await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(CONTROL)}); el?.focus(); el?.select() })()`)
          await typeText(text)
          if ((await evaluate(`document.querySelector(${JSON.stringify(CONTROL)})?.value ?? null`)) === text) return true
          await sleep(300)
        }
        return false
      }

      const originalDays = await days()
      try {
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`!!document.querySelector(${JSON.stringify(ROW)})`, 15000)
        const locked = await rowState()
        check('★ Business — 보안 절에 "휴지통 보관 기간"이 서되 읽기 전용 · "요금제 필요" · 요금제를 올리면 바꿀 수 있다고 말한다',
          locked?.tag === 'SPAN' && locked.text === `${originalDays}일` && locked.badge === '요금제 필요' && (locked.note ?? '').includes('요금제를 올리면'),
          JSON.stringify(locked))
        const blocked = await fetch(trashDaysApi, { method: 'PUT', headers: authed, body: JSON.stringify({ value: 7 }) })
        const blockedBody = await blocked.json().catch(() => null)
        check('★ 화면을 건너뛰어도 서버가 막는다 — 403 plan_required · 값은 그대로',
          blocked.status === 403 && blockedBody?.error === 'plan_required' && (await days()) === originalDays,
          JSON.stringify([blocked.status, blockedBody]))

        await setWorkspacePlan(workspaceId, 'enterprise')
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`document.querySelector(${JSON.stringify(CONTROL)})?.tagName === 'INPUT'`, 15000)
        const open = await rowState()
        check('★ Enterprise — 숫자 칸(일)이 서고 "요금제 필요"가 사라진다',
          open?.type === 'number' && open.value === String(originalDays) && open.unit === '일' && open.badge === null,
          JSON.stringify(open))

        await fill('0')
        await enter()
        check('★ 범위 밖(0)은 거부되고 범위를 말한다 — 쓴 글자는 남는다 · 서버는 그대로',
          (await waitFor(`(document.querySelector(${JSON.stringify(`${ROW} [role="alert"]`)})?.textContent ?? '') === '1일에서 3650일 사이의 정수를 적으세요.'`, 8000))
            && (await rowState())?.value === '0' && (await days()) === originalDays,
          JSON.stringify([await rowState(), await days()]))
        await escape()
        check('Esc 는 저장된 값으로 되돌린다', (await rowState())?.value === String(originalDays), JSON.stringify(await rowState()))

        await fill('7')
        await enter()
        check('★ Enter 로 저장 — "저장했습니다" · 워크스페이스의 휴지통 보관 기간이 7일이 된다',
          (await waitFor(`(document.querySelector(${JSON.stringify(`${ROW} [data-testid="setting-status"]`)})?.textContent ?? '') === '저장했습니다.'`, 8000))
            && (await days()) === 7,
          JSON.stringify([await rowState(), await days()]))
        await send('Page.navigate', { url: SECURITY })
        check('새로 열어도 7일이다', await waitFor(`document.querySelector(${JSON.stringify(CONTROL)})?.value === '7'`, 15000), JSON.stringify(await rowState()))
      } finally {
        await dbQuery(`UPDATE workspace SET trash_days = $2 WHERE id = $1`, [workspaceId, originalDays])
        await setWorkspacePlan(workspaceId, 'business')
      }
    }

    if (sectionIf('설정 — 사람 · 내보내기 (8g-2 · F-17-12)')) {
      // 홈의 관리 절(멤버 · 초대 · 게스트 · 그룹 · 내보내기)이 설정으로 옮겨 갔다 — 사람 절의 패널 넷 · 일반 절의 내보내기. 패널은 그 기능의
      // 판정 그대로 선다(멤버 관리자: 내보내기 · 보안 없음 / 멤버: 목록 · 그룹뿐 / 게스트: 내 계정만). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const PEOPLE = `${BASE}/w/${workspaceId}/settings?s=workspace.people`
      const GENERAL = `${BASE}/w/${workspaceId}/settings?s=workspace.general`
      const PANELS = ['workspace-members', 'invite-form', 'workspace-guests', 'group-panel']
      const panelsIn = (html) => PANELS.filter((id) => html.includes(`data-testid="${id}"`))
      const navIn = (html) => [...html.matchAll(/data-testid="settings-nav-link" data-section="([^"]+)"/g)].map((m) => m[1])
      const htmlAs = async (url, token) => (await fetch(url, { headers: { cookie: `nc_session=${token}` } })).text()

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings` })
      await waitFor(`!!document.querySelector('[data-testid="settings-nav-link"][data-section="workspace.people"]')`, 15000)
      await clickSelector('[data-testid="settings-nav-link"][data-section="workspace.people"]')
      check('★ 내비의 "사람"을 누르면 멤버 · 초대 · 게스트 · 그룹 패널이 선다',
        await waitFor(`document.querySelector('[data-testid="settings-title"]')?.textContent === '사람'
          && ${JSON.stringify(PANELS)}.every((id) => !!document.querySelector('[data-testid="' + id + '"]'))`, 15000),
        JSON.stringify(await evaluate(`${JSON.stringify(PANELS)}.filter((id) => !!document.querySelector('[data-testid="' + id + '"]'))`)))
      const ownerGeneral = await htmlAs(GENERAL, session)
      check('★ 일반 절 — 워크스페이스 이름 뒤에 전체 내보내기 · 사람 패널은 자기 절에만 선다',
        ownerGeneral.includes('data-setting-key="workspace.name"') && ownerGeneral.includes('data-testid="export-button"') && panelsIn(ownerGeneral).length === 0,
        JSON.stringify(panelsIn(ownerGeneral)))

      const home = await htmlAs(`${BASE}/w/${workspaceId}`, session)
      check('★ 홈에는 관리 절이 없다 — "설정 → 사람" 안내와 설정 링크만',
        panelsIn(home).length === 0 && !home.includes('data-testid="export-button"') && home.includes('settings?s=workspace.people') && home.includes('data-testid="home-settings"'),
        JSON.stringify(panelsIn(home)))

      const admin = await joinAs(workspaceId, await createUser(`사람 절의 멤버 관리자 ${stamp}`), 'membership_admin')
      const adminPeople = await htmlAs(PEOPLE, admin.token)
      const adminGeneral = await htmlAs(GENERAL, admin.token)
      check('★ 멤버 관리자 — 사람 절의 패널 넷 · 내보내기와 보안 절은 없다',
        JSON.stringify(panelsIn(adminPeople)) === JSON.stringify(PANELS) && !adminGeneral.includes('data-testid="export-button"')
          && JSON.stringify(navIn(adminPeople)) === JSON.stringify(['account.profile', 'account.preferences', 'account.security', 'workspace.general', 'workspace.people', 'workspace.plan']),
        JSON.stringify([panelsIn(adminPeople), navIn(adminPeople)]))

      const mate = await joinAs(workspaceId, await createUser(`사람 절의 멤버 ${stamp}`), 'member')
      const matePeople = await htmlAs(PEOPLE, mate.token)
      check('★ 멤버 — 멤버 목록과 그룹만(초대 · 게스트 없음)',
        JSON.stringify(panelsIn(matePeople)) === JSON.stringify(['workspace-members', 'group-panel']), JSON.stringify(panelsIn(matePeople)))

      const visitor = await joinAs(workspaceId, await createUser(`사람 절의 게스트 ${stamp}`), 'guest')
      const guestPeople = await htmlAs(PEOPLE, visitor.token)
      const guestHome = await htmlAs(`${BASE}/w/${workspaceId}`, visitor.token)
      check('게스트 — 사람 절을 주소로 열어도 내 계정의 프로필 · 홈에 "설정 → 사람" 안내도 없다',
        panelsIn(guestPeople).length === 0 && /data-testid="settings-title"[^>]*>프로필</.test(guestPeople) && !guestHome.includes('settings?s=workspace.people'),
        JSON.stringify(panelsIn(guestPeople)))
    }

    if (sectionIf('테마 (8h · F-12-03)')) {
      // 설정 → 환경설정의 "테마"(시스템 · 밝게 · 어둡게)는 계정의 값이다 — 서버가 첫 HTML 의 `<html data-theme>` 에 싣고(다른 세션에도),
      // CSS 의 dark 변형이 그 속성을 본다(system 이면 OS). Ctrl/Cmd + Shift + L 은 지금 보이는 것의 반대. OS 의 밝기는 CDP 로 정한다.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다. 끝에 테마 · 에뮬레이션을 되돌린다.
      // 페이지가 바뀌는 순간에는 documentElement · body 가 비어 있을 수 있다 — waitFor 는 예외를 삼키지 않으므로 식을 null 에 안전하게 쓴다
      // (전체 판에서 그 순간에 걸려 판이 멈췄다).
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const THEME = '[data-testid="setting-row"][data-setting-key="account.theme"] [data-testid="setting-control"]'
      const themeApi = `${BASE}/api/workspaces/${workspaceId}/settings/account.theme`
      const os = (scheme) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      const htmlTheme = () => evaluate(`document.documentElement?.dataset.theme ?? null`)
      const bodyBg = () => evaluate(`(document.body ? getComputedStyle(document.body).backgroundColor : null)`)
      const LIGHT_BG = 'rgb(255, 255, 255)'
      const DARK_BG = 'rgb(10, 10, 10)'
      const choose = (value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(THEME)})
        if (!s) return false
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)})
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      // 하이드레이션 전의 선택은 저장되지 않는다 — 서버의 값이 바뀔 때까지 다시 고른다.
      const stored = async () => (await dbQuery(
        `SELECT sv.value FROM setting_value sv JOIN user_email e ON e.user_id = sv.user_id WHERE e.email = $1 AND sv.key = 'account.theme'`, [email]))[0]?.value ?? null
      const chooseUntil = async (value) => {
        for (let i = 0; i < 8; i += 1) {
          await choose(value)
          for (let j = 0; j < 6; j += 1) { if ((await stored()) === value) return true; await sleep(250) }
        }
        return false
      }
      const serverTheme = async (cookie) => (/<html[^>]*data-theme="([a-z]+)"/.exec(await (await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie } })).text()) ?? [])[1] ?? null

      try {
        await os('light')
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings?s=account.preferences` })
        await waitFor(`!!document.querySelector(${JSON.stringify(THEME)})`, 15000)
        check('처음에는 "시스템 설정 따르기" — html 은 system 이고 OS 가 밝으니 밝다',
          (await htmlTheme()) === 'system' && (await evaluate(`document.querySelector(${JSON.stringify(THEME)})?.value`)) === 'system' && (await bodyBg()) === LIGHT_BG,
          JSON.stringify([await htmlTheme(), await bodyBg()]))

        const saved = await chooseUntil('dark')
        check('★ "어둡게"를 고르면 저장되고 화면이 곧바로 어두워진다',
          saved && (await waitFor(`document.documentElement?.dataset.theme === 'dark' && (document.body ? getComputedStyle(document.body).backgroundColor : null) === ${JSON.stringify(DARK_BG)}`, 8000)),
          JSON.stringify([await stored(), await htmlTheme(), await bodyBg()]))
        check('★ 서버가 첫 HTML 에 싣는다 — 새로 열어도 · 다른 세션(같은 계정)에서도 dark',
          (await serverTheme(authed.cookie)) === 'dark'
            && (await serverTheme(`nc_session=${(await joinAs(workspaceId, { userId: (await dbQuery(`SELECT user_id FROM user_email WHERE email = $1`, [email]))[0]?.user_id }, 'owner')).token}`)) === 'dark',
          String(await serverTheme(authed.cookie)))
        check('로그인 전의 화면은 system 이다', /<html[^>]*data-theme="system"/.test(await (await fetch(`${BASE}/login`)).text()))

        // 편집기의 색도 따른다 — editor.css 의 다크 덩어리(코드 강조 팔레트)가 미디어 쿼리가 아니라 테마를 본다. 서버와 무관하게 CSS 만
        // 보려고 html 의 속성을 화면에서 바꿔 읽는다(서버가 싣는 것은 위 검사가 본다).
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })
        await waitFor(`!!document.querySelector('.blk-editor')`, 15000)
        const keywordAs = (theme) => evaluate(`(() => {
          const root = document.documentElement
          const before = root.dataset.theme
          root.dataset.theme = ${JSON.stringify(theme)}
          const value = getComputedStyle(document.querySelector('.blk-editor')).getPropertyValue('--code-keyword').trim()
          root.dataset.theme = before
          return value
        })()`)
        const darkKeyword = await keywordAs('dark')
        const lightKeyword = await keywordAs('light')
        check('★ 편집기의 색(코드 강조 팔레트)도 테마를 따른다 — OS 는 밝은 채로',
          darkKeyword !== '' && lightKeyword === '#cf222e' && darkKeyword !== lightKeyword, JSON.stringify([darkKeyword, lightKeyword]))

        // system — OS 를 따른다
        await fetch(themeApi, { method: 'PUT', headers: authed, body: JSON.stringify({ value: 'system' }) })
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`document.documentElement?.dataset.theme === 'system'`, 15000)
        await os('dark')
        const followsDark = await waitFor(`(document.body ? getComputedStyle(document.body).backgroundColor : null) === ${JSON.stringify(DARK_BG)}`, 5000)
        await os('light')
        check('★ system 은 OS 를 따른다 — OS 가 어두우면 어둡고 밝으면 밝다(새로고침 없이)',
          followsDark && (await waitFor(`(document.body ? getComputedStyle(document.body).backgroundColor : null) === ${JSON.stringify(LIGHT_BG)}`, 5000)),
          JSON.stringify([followsDark, await bodyBg()]))

        // 단축키 — 지금 보이는 것(OS 밝음 → 밝게)의 반대
        const shortcut = async () => {
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 | 8 })
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 | 8 })
        }
        let toggled = false
        for (let i = 0; i < 6 && !toggled; i += 1) {
          await shortcut()
          toggled = await waitFor(`document.documentElement?.dataset.theme === 'dark'`, 1500)
        }
        let dark = null
        for (let i = 0; i < 20 && dark !== 'dark'; i += 1) { await sleep(250); dark = await stored() }
        check('★ Ctrl + Shift + L — system(밝게 보임)에서 어둡게 · 같은 설정으로 저장된다',
          toggled && dark === 'dark' && (await bodyBg()) === DARK_BG, JSON.stringify([await htmlTheme(), dark]))
        await shortcut()
        let light = null
        for (let i = 0; i < 20 && light !== 'light'; i += 1) { await sleep(250); light = await stored() }
        check('한 번 더 누르면 밝게', (await htmlTheme()) === 'light' && light === 'light', JSON.stringify([await htmlTheme(), light]))
      } finally {
        await fetch(themeApi, { method: 'PUT', headers: authed, body: JSON.stringify({ value: 'system' }) })
        await send('Emulation.setEmulatedMedia', { features: [] })
      }
    }

    if (sectionIf('비밀번호 — 서버 (8i-1a · F-14-03)')) {
      // 화면은 8i-1b 다 — 여기서는 라우트를 실제 서버로 본다. 정하기 → 비밀번호로 로그인(세션 쿠키) → 실패는 모두 같은 말 → 오래된 세션의
      // 바꾸기는 지금 비밀번호를 묻고, 바꾸면 다른 세션이 폐기된다 → 지우면 비밀번호로 못 들어온다. 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const who = await joinAs(workspaceId, await createUser(`비밀번호의 사람 ${stamp}`), 'member')
      const asWho = { ...json, cookie: `nc_session=${who.token}` }
      const pwUrl = `${BASE}/api/workspaces/${workspaceId}/account/password`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const loginWith = (email, password) => fetch(`${BASE}/api/auth/password-login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })
      const GOOD = `correct horse ${stamp}`
      const NEXT = `battery staple ${stamp}`

      const weak = await readRes(await fetch(pwUrl, { method: 'PUT', headers: asWho, body: JSON.stringify({ newPassword: 'short1' }) }))
      const set = await readRes(await fetch(pwUrl, { method: 'PUT', headers: asWho, body: JSON.stringify({ newPassword: GOOD }) }))
      check('★ 비밀번호를 정한다 — 정책을 지키지 않으면 400 weak_password',
        weak.status === 400 && weak.body?.error === 'weak_password' && set.status === 200 && set.body?.revokedSessions === 0,
        JSON.stringify([weak, set]))

      const logged = await loginWith(who.email, GOOD)
      const cookie = logged.headers.getSetCookie().find((c) => c.startsWith('nc_session='))?.split(';')[0] ?? null
      // 화면을 받을 때는 본문까지 읽는다 — 읽지 않고 버린 응답은 서버의 스트리밍 도중에 연결을 닫아 "destination stream closed early" 를 남긴다.
      const home = cookie === null ? null : await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie }, redirect: 'manual' })
      await home?.text().catch(() => null)
      check('★ 이메일 + 비밀번호로 들어온다 — 세션 쿠키 · 그 쿠키로 홈이 열린다',
        logged.status === 200 && cookie !== null && home?.status === 200, JSON.stringify([logged.status, cookie !== null, home?.status]))
      const method = (await dbQuery(`SELECT auth_method FROM user_session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [who.userId]))[0]?.auth_method
      check('그 세션은 비밀번호로 들어온 세션이다', method === 'password', String(method))

      const wrong = await readRes(await loginWith(who.email, `wrong ${stamp}`))
      const nobody = await readRes(await loginWith(`nobody-${stamp}@example.com`, GOOD))
      check('★ 실패는 모두 같은 말이다 — 틀린 비밀번호 · 없는 이메일 둘 다 401 invalid_credentials',
        wrong.status === 401 && nobody.status === 401 && JSON.stringify(wrong.body) === JSON.stringify(nobody.body) && wrong.body?.error === 'invalid_credentials',
        JSON.stringify([wrong, nobody]))

      // 오래된 세션 — 지금 비밀번호를 묻는다
      await dbQuery(`UPDATE user_session SET created_at = now() - interval '1 hour' WHERE token_hash IS NOT NULL AND user_id = $1 AND auth_method = 'login_code'`, [who.userId])
      const noCurrent = await readRes(await fetch(pwUrl, { method: 'PUT', headers: asWho, body: JSON.stringify({ newPassword: NEXT }) }))
      const changed = await readRes(await fetch(pwUrl, { method: 'PUT', headers: asWho, body: JSON.stringify({ newPassword: NEXT, currentPassword: GOOD }) }))
      const homeAfter = await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie }, redirect: 'manual' })
      await homeAfter.text().catch(() => null)
      check('★ 오래된 세션의 바꾸기는 지금 비밀번호를 묻고(400) · 바꾸면 다른 세션(비밀번호로 들어온 쪽)이 폐기된다',
        noCurrent.status === 400 && noCurrent.body?.error === 'current_required' && changed.status === 200 && changed.body?.revokedSessions >= 1
          && homeAfter.status !== 200 && (await loginWith(who.email, NEXT)).status === 200,
        JSON.stringify([noCurrent, changed, homeAfter.status]))

      const removed = await readRes(await fetch(pwUrl, { method: 'DELETE', headers: asWho, body: JSON.stringify({ currentPassword: NEXT }) }))
      check('지우면 비밀번호로 못 들어온다(로그인 코드로는 들어온다)',
        removed.status === 200 && (await loginWith(who.email, NEXT)).status === 401, JSON.stringify(removed))
    }

    if (sectionIf('비밀번호 — 화면 (8i-1b · F-14-03)')) {
      // 설정 → 내 계정 → 보안의 비밀번호 패널(정하기 · 체크리스트 · 바꾸기 · 지우기)과 로그인 화면의 "비밀번호로 로그인". 브라우저 세션을 새
      // 멤버로 바꿔 진행하고 끝에 소유자로 되돌린다(뒤 절이 소유자의 세션을 쓴다). 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const mate = await joinAs(workspaceId, await createUser(`비밀번호 화면의 사람 ${stamp}`), 'member')
      const SECURITY = `${BASE}/w/${workspaceId}/settings?s=account.security`
      const GOOD = `correct horse ${stamp}`
      const NEXT = `battery staple ${stamp}`
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const textOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
      const ruleStates = () => evaluate(`[...document.querySelectorAll('[data-testid="password-rules"] li')].map((li) => li.dataset.rule + ':' + li.dataset.state).join(' ')`)
      const typeInto = async (sel, text) => {
        await clickSelector(sel)
        await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.focus(); el?.select() })()`)
        await typeText(text)
      }
      // 하이드레이션 전의 클릭은 아무 일이 없다 — 열릴 때까지 다시 누른다.
      const openUntil = async (button, target) => {
        for (let i = 0; i < 6; i += 1) {
          if (await has(target)) return true
          await clickSelector(button)
          if (await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 1500)) return true
        }
        return false
      }

      try {
        await browseAs(mate.token)
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`!!document.querySelector('[data-testid="password-panel"]')`, 15000)
        check('설정 → 보안 — 비밀번호가 없다고 말하고 "정하기"만 선다',
          (await evaluate(`document.querySelector('[data-testid="password-panel"]')?.dataset.hasPassword`)) === 'false'
            && (await has('[data-testid="password-set-open"]')) && !(await has('[data-testid="password-remove-open"]')),
          String(await textOf('[data-testid="password-state"]')))

        check('★ 정하기 — 체크리스트가 쓰는 대로 따라온다(15자부터 "글자와 숫자"는 지운 줄)',
          (await openUntil('[data-testid="password-set-open"]', '[data-testid="password-form"]'))
            && (await ruleStates()) === 'length:unmet unique:unmet letter_and_digit:unmet'
            && (await typeInto('[data-testid="password-new"]', 'abcdefghijklmno'), await waitFor(`document.querySelector('[data-testid="password-rules"] li[data-rule="letter_and_digit"]')?.dataset.state === 'waived'`, 3000)),
          String(await ruleStates()))
        await typeInto('[data-testid="password-new"]', 'abc')
        check('★ 규칙을 지키기 전에는 저장할 수 없다',
          await waitFor(`document.querySelector('[data-testid="password-save"]')?.disabled === true`, 3000))
        await typeInto('[data-testid="password-new"]', GOOD)
        await clickSelector('[data-testid="password-save"]')
        check('★ 저장하면 "정했습니다" · 패널이 "있다"로 바뀐다 · 서버에 argon2id 한 줄',
          (await waitFor(`(document.querySelector('[data-testid="password-status"]')?.textContent ?? '').includes('비밀번호를 정했습니다')
            && document.querySelector('[data-testid="password-panel"]')?.dataset.hasPassword === 'true'`, 10000))
            && /^\$argon2id\$/.test((await dbQuery(`SELECT password_hash FROM credential WHERE user_id = $1 AND kind = 'password'`, [mate.userId]))[0]?.password_hash ?? ''),
          String(await textOf('[data-testid="password-status"]')))

        // 방금 로그인 코드로 들어온 세션 — 지금 비밀번호 없이 바꾼다(재설정)
        check('10분 안의 코드 세션 — "지금 비밀번호 없이 바꿀 수 있다"고 말하고 바꾸기 폼에 지금 비밀번호 칸이 없다',
          (await has('[data-testid="password-fresh-note"]'))
            && (await openUntil('[data-testid="password-change-open"]', '[data-testid="password-form"]')) && !(await has('[data-testid="password-current"]')))
        await clickSelector('[data-testid="password-cancel"]')

        // 오래된 세션 — 지금 비밀번호를 묻는다
        await dbQuery(`UPDATE user_session SET created_at = now() - interval '1 hour' WHERE user_id = $1`, [mate.userId])
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`document.querySelector('[data-testid="password-panel"]')?.dataset.hasPassword === 'true'`, 15000)
        await openUntil('[data-testid="password-change-open"]', '[data-testid="password-form"]')
        await typeInto('[data-testid="password-current"]', `wrong ${stamp}`)
        await typeInto('[data-testid="password-new"]', NEXT)
        await clickSelector('[data-testid="password-save"]')
        check('★ 오래된 세션 — 지금 비밀번호를 묻고, 틀리면 그렇다고 말한다',
          await waitFor(`(document.querySelector('[data-testid="password-status"]')?.textContent ?? '').includes('지금 비밀번호가 맞지 않습니다')`, 8000),
          String(await textOf('[data-testid="password-status"]')))
        await typeInto('[data-testid="password-current"]', GOOD)
        await clickSelector('[data-testid="password-save"]')
        check('★ 맞으면 바뀐다', await waitFor(`(document.querySelector('[data-testid="password-status"]')?.textContent ?? '').includes('비밀번호를 바꿨습니다')`, 10000),
          String(await textOf('[data-testid="password-status"]')))

        // 로그인 화면 — 쿠키 없이
        await send('Network.deleteCookies', { name: 'nc_session', domain: 'localhost' })
        await send('Page.navigate', { url: `${BASE}/login` })
        await waitFor(`!!document.querySelector('#email')`, 15000)
        await typeInto('#email', mate.email)
        check('로그인 화면 — 이메일 다음 "비밀번호로 로그인"이 비밀번호 칸을 연다',
          await openUntil('[data-testid="login-password-open"]', '[data-testid="login-password-form"]'))
        await typeInto('[data-testid="login-password"]', `wrong ${stamp}`)
        await clickSelector('[data-testid="login-password-submit"]')
        check('★ 틀리면 무엇이 틀렸는지 말하지 않는다 — "이메일 또는 비밀번호가 맞지 않습니다"',
          await waitFor(`(document.querySelector('[role="alert"]')?.textContent ?? '').includes('이메일 또는 비밀번호가 맞지 않습니다')`, 8000),
          String(await textOf('[role="alert"]')))
        await typeInto('[data-testid="login-password"]', NEXT)
        await clickSelector('[data-testid="login-password-submit"]')
        check('★ 맞으면 들어온다 — 처음 화면으로 · 그 세션은 비밀번호 세션',
          (await waitFor(`location.pathname === '/'`, 10000))
            && (await dbQuery(`SELECT auth_method FROM user_session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [mate.userId]))[0]?.auth_method === 'password',
          String(await evaluate('location.pathname')))

        // 지우기 — 비밀번호 세션이라 지금 비밀번호를 묻는다
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`document.querySelector('[data-testid="password-panel"]')?.dataset.hasPassword === 'true'`, 15000)
        await openUntil('[data-testid="password-remove-open"]', '[data-testid="password-remove-form"]')
        await typeInto('[data-testid="password-current"]', NEXT)
        await clickSelector('[data-testid="password-remove-confirm"]')
        check('★ 지우면 "로그인 코드로 들어온다"고 말하고 패널이 "없다"로 돌아간다',
          await waitFor(`(document.querySelector('[data-testid="password-status"]')?.textContent ?? '').includes('비밀번호를 지웠습니다')
            && document.querySelector('[data-testid="password-panel"]')?.dataset.hasPassword === 'false'`, 10000),
          String(await textOf('[data-testid="password-status"]')))
      } finally {
        await browseAs(session)
      }
    }

    if (sectionIf('2단계 인증 — 서버 (8i-2a · F-14-05)')) {
      // 화면은 8i-2b 다 — 라우트와 진입 게이트를 실제 서버로 본다. 켜기(시작 · 확정 · 백업 코드) → 비밀번호로 새로 들어오면 둘째 단계가
      // 남는다(화면은 /login?mfa=1 · API 는 401 mfa_required) → 백업 코드로 통과 → 끄기. 코드는 비밀값으로 직접 계산한다. 자기 데이터를 스스로.
      const { totpAt, totpStepAt, base32Decode } = await import(new URL('../src/lib/auth/totp.ts', import.meta.url).href)
      const stamp = Date.now()
      const who = await joinAs(workspaceId, await createUser(`2단계 인증의 사람 ${stamp}`), 'member')
      const asWho = { ...json, cookie: `nc_session=${who.token}` }
      const acct = `${BASE}/api/workspaces/${workspaceId}/account`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      // 화면을 받을 때는 본문까지 읽는다 — 읽지 않고 버린 응답은 서버의 스트리밍 도중에 연결을 닫는다(전체 판의 "서버에서 오류" 로 떨어졌다).
      const pageStatus = async (cookieHeader) => {
        const res = await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie: cookieHeader }, redirect: 'manual' })
        await res.text().catch(() => null)
        return res.status
      }
      const PASSWORD = `correct horse ${stamp}`
      await fetch(`${acct}/password`, { method: 'PUT', headers: asWho, body: JSON.stringify({ newPassword: PASSWORD }) })

      const started = await readRes(await fetch(`${acct}/mfa`, { method: 'POST', headers: asWho, body: JSON.stringify({ label: '휴대폰' }) }))
      const secret = started.body?.secret
      const codeNow = (offset = 0) => totpAt(base32Decode(secret), totpStepAt(Date.now()) + offset)
      const wrong = await readRes(await fetch(`${acct}/mfa/${started.body?.methodId}/confirm`, { method: 'POST', headers: asWho, body: JSON.stringify({ code: '000000' }) }))
      const confirmed = await readRes(await fetch(`${acct}/mfa/${started.body?.methodId}/confirm`, { method: 'POST', headers: asWho, body: JSON.stringify({ code: codeNow() }) }))
      const backup = confirmed.body?.backupCodes ?? []
      check('★ 켜기 — 시작하면 QR 주소 · 틀린 코드는 400 · 맞으면 백업 코드 6개 · 켠 세션은 그대로 들어온다',
        started.status === 201 && typeof secret === 'string' && String(started.body?.uri).startsWith('otpauth://totp/')
          && wrong.status === 400 && confirmed.status === 200 && backup.length === 6
          && (await pageStatus(asWho.cookie)) === 200,
        JSON.stringify([started.status, wrong.status, confirmed.status, backup.length]))

      const logged = await fetch(`${BASE}/api/auth/password-login`, { method: 'POST', headers: json, body: JSON.stringify({ email: who.email, password: PASSWORD }) })
      const loggedBody = await logged.json().catch(() => null)
      const cookie = logged.headers.getSetCookie().find((c) => c.startsWith('nc_session='))?.split(';')[0] ?? ''
      const pendingHome = await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie }, redirect: 'manual' })
      await pendingHome.text().catch(() => null)
      const pendingApi = await readRes(await fetch(`${BASE}/api/workspaces/${workspaceId}/search?q=x`, { headers: { cookie } }))
      check('★ 비밀번호로 새로 들어오면 응답이 "둘째 단계가 남았다"고 말한다', logged.status === 200 && loggedBody?.mfaRequired === true,
        JSON.stringify([logged.status, loggedBody]))
      check('★ 그 세션으로 워크스페이스 화면을 열면 /login?mfa=1 로 보낸다',
        [303, 307, 308].includes(pendingHome.status) && (pendingHome.headers.get('location') ?? '').includes('/login?mfa=1'),
        JSON.stringify([pendingHome.status, pendingHome.headers.get('location')]))
      check('★ 그 세션의 API 는 401 mfa_required 다', pendingApi.status === 401 && pendingApi.body?.error === 'mfa_required', JSON.stringify(pendingApi))
      const pendingRoot = await fetch(`${BASE}/`, { headers: { cookie }, redirect: 'manual' })
      await pendingRoot.text().catch(() => null)
      check('★ 처음 화면(워크스페이스 목록)도 로그인 전처럼 대한다 — 둘째 단계 전에는 목록이 없다',
        [303, 307, 308].includes(pendingRoot.status) && (pendingRoot.headers.get('location') ?? '').includes('/login'),
        JSON.stringify([pendingRoot.status, pendingRoot.headers.get('location')]))

      const verify = (code) => fetch(`${BASE}/api/auth/mfa-verify`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ code }) })
      const bad = await readRes(await verify('000000'))
      const good = await readRes(await verify(backup[0]))
      check('★ 둘째 단계 — 틀리면 400 · 백업 코드로 통과하면 그 세션으로 들어온다',
        bad.status === 400 && bad.body?.error === 'invalid_code' && good.status === 200 && good.body?.via === 'backup'
          && (await pageStatus(cookie)) === 200,
        JSON.stringify([bad, good]))

      const removed = await readRes(await fetch(`${acct}/mfa/${started.body?.methodId}`, { method: 'DELETE', headers: asWho, body: JSON.stringify({ code: backup[1] }) }))
      const again = await (await fetch(`${BASE}/api/auth/password-login`, { method: 'POST', headers: json, body: JSON.stringify({ email: who.email, password: PASSWORD }) })).json().catch(() => null)
      check('끄기 — 지금 코드(백업 코드)로 지우면 꺼지고, 그 뒤의 로그인은 둘째 단계가 없다',
        removed.status === 200 && removed.body?.disabled === true && again?.mfaRequired === false, JSON.stringify([removed, again]))
    }

    if (sectionIf('2단계 인증 — 화면 (8i-2b · F-14-05)')) {
      // 설정 → 내 계정 → 보안의 2단계 인증 패널(켜기 · QR · 비밀값 · 백업 코드 · 새로 받기 · 지우기)과 로그인 화면의 둘째 단계. 코드는 화면에
      // 보인 비밀값으로 직접 계산한다. 브라우저 세션을 새 멤버로 바꿔 진행하고 끝에 소유자로 되돌린다. 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const { totpAt, totpStepAt, base32Decode } = await import(new URL('../src/lib/auth/totp.ts', import.meta.url).href)
      const stamp = Date.now()
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const mate = await joinAs(workspaceId, await createUser(`2단계 인증 화면의 사람 ${stamp}`), 'member')
      const SECURITY = `${BASE}/w/${workspaceId}/settings?s=account.security`
      const PASSWORD = `correct horse ${stamp}`
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const textOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
      const typeInto = async (sel, text) => {
        await clickSelector(sel)
        await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.focus(); el?.select() })()`)
        await typeText(text)
      }
      // 하이드레이션 전의 클릭은 아무 일이 없다 — 열릴 때까지 다시 누른다.
      const openUntil = async (button, target) => {
        for (let i = 0; i < 6; i += 1) {
          if (await has(target)) return true
          await clickSelector(button)
          if (await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 1500)) return true
        }
        return false
      }
      const statusHas = (text) => waitFor(`(document.querySelector('[data-testid="mfa-status"]')?.textContent ?? '').includes(${JSON.stringify(text)})`, 10000)
      const shownCodes = () => evaluate(`[...document.querySelectorAll('[data-testid="mfa-backup-codes"] li')].map((li) => li.textContent)`)
      const closeCodes = async () => {
        await clickSelector('[data-testid="mfa-codes-saved"]')
        await waitFor(`document.querySelector('[data-testid="mfa-codes-close"]')?.disabled === false`, 3000)
        await clickSelector('[data-testid="mfa-codes-close"]')
      }

      try {
        await browseAs(mate.token)
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`!!document.querySelector('[data-testid="mfa-panel"]')`, 15000)
        check('설정 → 보안 — 비밀번호가 없으면 "먼저 비밀번호를 정하세요"라고 말하고 켜기 버튼이 없다',
          (String(await textOf('[data-testid="mfa-state"]'))).includes('먼저 비밀번호를 정하세요') && !(await has('[data-testid="mfa-enroll-open"]')),
          String(await textOf('[data-testid="mfa-state"]')))

        // 비밀번호는 API 로 정한다(화면은 8i-1b 가 본다)
        await fetch(`${BASE}/api/workspaces/${workspaceId}/account/password`, {
          method: 'PUT', headers: { ...json, cookie: `nc_session=${mate.token}` }, body: JSON.stringify({ newPassword: PASSWORD }),
        }).then((r) => r.text())
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`!!document.querySelector('[data-testid="mfa-enroll-open"]')`, 15000)
        check('비밀번호를 정하면 "2단계 인증 켜기"가 선다', (await textOf('[data-testid="mfa-enroll-open"]')) === '2단계 인증 켜기',
          String(await textOf('[data-testid="mfa-enroll-open"]')))

        await openUntil('[data-testid="mfa-enroll-open"]', '[data-testid="mfa-label-form"]')
        await typeInto('[data-testid="mfa-label"]', '내 휴대폰')
        await clickSelector('[data-testid="mfa-start"]')
        await waitFor(`!!document.querySelector('[data-testid="mfa-secret"]')`, 10000)
        const shown = String(await textOf('[data-testid="mfa-secret"]'))
        const secret = shown.replace(/\s/g, '')
        check('★ 켜기 — QR(SVG)과 넷씩 끊은 base32 비밀값(20바이트 = 32자)이 보인다',
          (await has('[data-testid="mfa-qr"] svg path')) && /^[A-Z2-7]{4}( [A-Z2-7]{4})*$/.test(shown) && secret.length === 32, shown)
        const codeNow = (offset = 0) => totpAt(base32Decode(secret), totpStepAt(Date.now()) + offset)

        await typeInto('[data-testid="mfa-code"]', '000000')
        await clickSelector('[data-testid="mfa-confirm"]')
        check('틀린 코드는 그렇다고 말하고 켜지 않는다', await statusHas('코드가 맞지 않습니다'), String(await textOf('[data-testid="mfa-status"]')))
        await typeInto('[data-testid="mfa-code"]', codeNow())
        await clickSelector('[data-testid="mfa-confirm"]')
        await waitFor(`document.querySelectorAll('[data-testid="mfa-backup-codes"] li').length === 6`, 10000)
        const codes = (await shownCodes()) ?? []
        check('★ 맞는 코드면 켜지고 백업 코드 6개를 한 번 보인다', codes.length === 6 && codes.every((c) => /^[a-z2-7]{5}-[a-z2-7]{5}$/.test(c)),
          JSON.stringify(codes))
        check('★ "안전한 곳에 저장했습니다"를 고르기 전에는 닫히지 않는다',
          (await evaluate(`document.querySelector('[data-testid="mfa-codes-close"]')?.disabled ?? null`)) === true)
        const href = String(await evaluate(`document.querySelector('[data-testid="mfa-codes-download"]')?.getAttribute('href') ?? ''`))
        const fileLines = decodeURIComponent(href.slice(href.indexOf(',') + 1)).split('\n')
        check('내려받기 — 코드가 한 줄에 하나씩 든 텍스트 파일', href.startsWith('data:text/plain') && codes.every((c) => fileLines.includes(c)), href.slice(0, 60))
        await closeCodes()
        check('★ 닫으면 패널이 "켜져 있다"로 — 이름 붙인 수단 하나 · 남은 백업 코드 6개',
          await waitFor(`document.querySelector('[data-testid="mfa-panel"]')?.dataset.enabled === 'true'
            && document.querySelectorAll('[data-testid="mfa-method"]').length === 1
            && (document.querySelector('[data-testid="mfa-method"]')?.textContent ?? '').includes('내 휴대폰')
            && (document.querySelector('[data-testid="mfa-backup-left"]')?.textContent ?? '').includes('6개')`, 10000),
          String(await textOf('[data-testid="mfa-panel"]')))

        // 로그인 — 쿠키 없이 비밀번호로 들어오면 둘째 단계가 남는다
        await send('Network.deleteCookies', { name: 'nc_session', domain: 'localhost' })
        await send('Page.navigate', { url: `${BASE}/login` })
        await waitFor(`!!document.querySelector('#email')`, 15000)
        await typeInto('#email', mate.email)
        await openUntil('[data-testid="login-password-open"]', '[data-testid="login-password-form"]')
        await typeInto('[data-testid="login-password"]', PASSWORD)
        await clickSelector('[data-testid="login-password-submit"]')
        check('★ 비밀번호가 맞으면 둘째 단계를 묻는다 — 아직 들어가지 않는다',
          (await waitFor(`!!document.querySelector('[data-testid="login-mfa-form"]')`, 10000)) && (await evaluate('location.pathname')) === '/login',
          String(await evaluate('location.pathname')))
        await typeInto('[data-testid="login-mfa-code"]', '000000')
        await clickSelector('[data-testid="login-mfa-submit"]')
        check('★ 틀린 코드는 그렇다고 말한다',
          await waitFor(`(document.querySelector('[role="alert"]')?.textContent ?? '').includes('코드가 맞지 않습니다')`, 8000),
          String(await textOf('[role="alert"]')))
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        check('★ 둘째 단계 전에 워크스페이스를 열면 로그인 화면의 둘째 단계로 돌아온다(/login?mfa=1)',
          await waitFor(`location.pathname === '/login' && location.search.includes('mfa=1') && !!document.querySelector('[data-testid="login-mfa-form"]')`, 15000),
          String(await evaluate('location.href')))
        await typeInto('[data-testid="login-mfa-code"]', (codes[0] ?? 'missing').toUpperCase())
        await clickSelector('[data-testid="login-mfa-submit"]')
        check('★ 백업 코드(대소문자 가리지 않음)로 통과하면 들어온다 — 처음 화면으로 · 그 코드는 쓴 것이 된다',
          (await waitFor(`location.pathname === '/'`, 10000))
            && Number((await dbQuery(`SELECT count(*)::int AS n FROM mfa_backup_code WHERE user_id = $1 AND used_at IS NULL`, [mate.userId]))[0]?.n) === 5,
          String(await evaluate('location.pathname')))

        // 백업 코드 새로 받기 — 인증 앱의 코드로(켤 때 쓴 창 다음 창)
        await send('Page.navigate', { url: SECURITY })
        await waitFor(`(document.querySelector('[data-testid="mfa-backup-left"]')?.textContent ?? '').includes('5개')`, 15000)
        await openUntil('[data-testid="mfa-regenerate-open"]', '[data-testid="mfa-regenerate-form"]')
        await typeInto('[data-testid="mfa-confirm-code"]', codeNow(1))
        await clickSelector('[data-testid="mfa-confirm-action"]')
        await waitFor(`document.querySelectorAll('[data-testid="mfa-backup-codes"] li').length === 6`, 10000)
        const fresh = (await shownCodes()) ?? []
        await closeCodes()
        check('★ 새로 받기 — 새 코드 6개(앞의 것과 다르다) · 닫으면 남은 백업 코드 6개',
          fresh.length === 6 && fresh.every((c) => !codes.includes(c))
            && (await waitFor(`(document.querySelector('[data-testid="mfa-backup-left"]')?.textContent ?? '').includes('6개')`, 10000)),
          JSON.stringify(fresh))

        // 지우기 — 마지막 수단이라 꺼진다고 미리 말한다
        await openUntil('[data-testid="mfa-remove-open"]', '[data-testid="mfa-remove-form"]')
        check('마지막 인증 앱을 지우려 하면 "2단계 인증이 꺼진다"고 미리 말한다',
          String(await textOf('[data-testid="mfa-remove-form"]')).includes('2단계 인증이 꺼지고'), String(await textOf('[data-testid="mfa-remove-form"]')))
        await typeInto('[data-testid="mfa-confirm-code"]', fresh[0] ?? 'missing')
        await clickSelector('[data-testid="mfa-confirm-action"]')
        check('★ 지우면 꺼진다 — "껐습니다" · 패널이 다시 "켜기"로',
          (await statusHas('2단계 인증을 껐습니다'))
            && (await waitFor(`document.querySelector('[data-testid="mfa-panel"]')?.dataset.enabled === 'false' && !!document.querySelector('[data-testid="mfa-enroll-open"]')`, 10000)),
          String(await textOf('[data-testid="mfa-status"]')))
      } finally {
        await browseAs(session)
      }
    }

    if (sectionIf('워크스페이스 스위처 (8j-1 · F-14-09)')) {
      // 사이드바 머리의 이름 → 스위처(이 계정의 이메일 · 워크스페이스(만든 순서) · 지금 것에 ✓ · 역할) → 고르면 그리로 · Ctrl/Cmd + Shift + 숫자 ·
      // Esc · 사이드바의 "홈". 브라우저 세션을 새 멤버로 바꿔 진행하고 끝에 소유자로 되돌린다. 그 멤버가 둘째 워크스페이스를 만든다(소유자).
      // 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const mate = await joinAs(workspaceId, await createUser(`스위처의 사람 ${stamp}`), 'member')
      const SECOND = `둘째 ${stamp}`
      const created = await (await fetch(`${BASE}/api/workspaces`, {
        method: 'POST', headers: { ...json, cookie: `nc_session=${mate.token}` }, body: JSON.stringify({ name: SECOND }),
      })).json().catch(() => null)
      const second = created?.workspaceId ?? 'missing'
      const SWITCHER = '[data-testid="sidebar-workspace-switcher"]'
      const MENU = '[data-testid="workspace-switcher-menu"]'
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const textOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
      const openUntil = async (button, target) => {
        for (let i = 0; i < 6; i += 1) {
          if (await has(target)) return true
          await clickSelector(button)
          if (await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 1500)) return true
        }
        return false
      }
      const menuRows = () => evaluate(`[...document.querySelectorAll('[data-testid="switcher-workspace"]')]
        .map((a) => a.dataset.workspaceId + (a.getAttribute('aria-current') === 'true' ? '*' : ''))`)
      const DIGIT_KEYS = ['', '!', '@', '#', '$', '%']
      const digit = async (n) => {
        const base = { key: DIGIT_KEYS[n], code: `Digit${n}`, windowsVirtualKeyCode: 48 + n, nativeVirtualKeyCode: 48 + n, modifiers: MOD | SHIFT }
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      }
      const nameNow = () => textOf('[data-testid="sidebar-workspace-name"]')

      try {
        await browseAs(mate.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector(${JSON.stringify(SWITCHER)})`, 15000)
        const firstName = await nameNow()
        check('★ 머리의 이름을 누르면 스위처가 열린다 — 이 계정의 이메일 · 워크스페이스 둘(만든 순서) · 지금 것에 ✓',
          (await openUntil(SWITCHER, MENU)) && (await textOf('[data-testid="switcher-email"]')) === mate.email
            && JSON.stringify(await menuRows()) === JSON.stringify([`${workspaceId}*`, second]),
          JSON.stringify([await textOf('[data-testid="switcher-email"]'), await menuRows()]))
        const roles = await evaluate(`[...document.querySelectorAll('[data-testid="switcher-workspace"]')].map((a) => a.children[1]?.textContent ?? null)`)
        check('역할을 적는다 — 들어온 곳은 멤버 · 만든 곳은 소유자', JSON.stringify(roles) === JSON.stringify(['멤버', '소유자']), JSON.stringify(roles))

        await clickSelector(`[data-testid="switcher-workspace"][data-workspace-id="${second}"]`)
        check('★ 고르면 그 워크스페이스로 — 주소 · 머리의 이름 · 메뉴는 닫힌다',
          await waitFor(`location.pathname === ${JSON.stringify(`/w/${second}`)}
            && document.querySelector('[data-testid="sidebar-workspace-name"]')?.textContent === ${JSON.stringify(SECOND)}
            && !document.querySelector(${JSON.stringify(MENU)})`, 15000),
          JSON.stringify([await evaluate('location.pathname'), await nameNow()]))
        // 다른 워크스페이스로 가면 레이아웃이 새로 그려져 메뉴는 어차피 닫힌다 — "고르면 닫는다"가 일하는 것은 지금 것을 고를 때다(반사실이 살아남아 더했다)
        await openUntil(SWITCHER, MENU)
        await clickSelector(`[data-testid="switcher-workspace"][data-workspace-id="${second}"]`)
        check('지금 것을 고르면 닫히고 그 자리에 머문다',
          (await waitFor(`!document.querySelector(${JSON.stringify(MENU)})`, 3000)) && (await evaluate('location.pathname')) === `/w/${second}`,
          String(await evaluate('location.pathname')))

        // 단축키 — 하이드레이션 전의 키는 아무 일이 없다 · 갈 때까지 다시 누른다
        let back = false
        for (let i = 0; i < 6 && !back; i += 1) {
          await digit(1)
          back = await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}`)}`, 2000)
        }
        check('★ Ctrl/Cmd + Shift + 1 — 목록의 첫째로', back && (await waitFor(`document.querySelector('[data-testid="sidebar-workspace-name"]')?.textContent === ${JSON.stringify(firstName)}`, 10000)),
          JSON.stringify([await evaluate('location.pathname'), await nameNow()]))
        // 누르기 전 자리와 비교한다 — 앞 검사(단축키)가 떨어져도 이 검사가 따로 판정되게
        const beforeFive = await evaluate('location.pathname')
        await digit(5)
        await sleep(1000)
        check('없는 자리(5)는 아무 일도 없다', (await evaluate('location.pathname')) === beforeFive, String(await evaluate('location.pathname')))

        await openUntil(SWITCHER, MENU)
        await key('Escape')
        check('Esc 로 닫히고 초점은 이름 버튼으로',
          await waitFor(`!document.querySelector(${JSON.stringify(MENU)}) && document.activeElement?.dataset?.testid === 'sidebar-workspace-switcher'`, 3000))
        // 밖 — 본문 쪽 오른쪽 아래. 사이드바의 항목은 열린 메뉴 밑에 깔려 있어 누르면 메뉴의 항목이 눌린다(첫 판이 그랬다).
        await openUntil(SWITCHER, MENU)
        const corner = await evaluate(`({ x: window.innerWidth - 40, y: window.innerHeight - 40 })`)
        const beforeOutside = await evaluate('location.pathname')
        await click(corner.x, corner.y)
        check('밖을 누르면 닫히고 그 자리에 머문다',
          (await waitFor(`!document.querySelector(${JSON.stringify(MENU)})`, 3000)) && (await evaluate('location.pathname')) === beforeOutside,
          String(await evaluate('location.pathname')))

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/settings` })
        await waitFor(`location.pathname.endsWith('/settings') && !!document.querySelector('[data-testid="sidebar-home"]')`, 15000)
        await clickSelector('[data-testid="sidebar-home"]')
        check('홈 — 사이드바의 "홈"이 이 워크스페이스의 첫 화면으로(이름은 이제 스위처를 연다)',
          await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}`)}`, 15000), String(await evaluate('location.pathname')))
      } finally {
        await browseAs(session)
      }
    }

    if (sectionIf('다중 계정 — 서버 (8j-2 · F-14-09)')) {
      // 화면은 8j-3 이다 — 라우트를 실제 서버로 본다. 세 사람이 한 "브라우저"(손으로 나르는 쿠키 상자)에 차례로 로그인한다: A 는 코드로,
      // B 는 코드 + 더하기, C 는 비밀번호 + 더하기 → 목록 · 바꾸기 · 지금 계정 로그아웃(다음 계정이 활성) · 끝난 세션은 "다시 로그인" ·
      // 한 계정만 로그아웃 · 모두 로그아웃. 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const jar = new Map()
      const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      // 지우는 Set-Cookie 는 값이 비었거나 만료가 지난 것이다
      const absorb = (res) => {
        for (const line of res.headers.getSetCookie()) {
          const [pair, ...attrs] = line.split(';')
          const at = pair.indexOf('=')
          const name = pair.slice(0, at).trim()
          const value = pair.slice(at + 1)
          const gone = value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || /expires=.*1970/i.test(a))
          if (gone) jar.delete(name)
          else jar.set(name, value)
        }
      }
      const call = async (path, init = {}) => {
        const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...json, ...(init.headers ?? {}), cookie: cookieHeader() }, redirect: 'manual' })
        absorb(res)
        return { status: res.status, body: await res.json().catch(() => null) }
      }
      const codeLogin = async (email, addAccount) => {
        await call('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) })
        return call('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code: await loginCodeFor(email), addAccount }) })
      }
      const list = async () => {
        const got = (await call('/api/auth/accounts')).body
        return { current: got?.current ? `${got.current.email}:${got.current.state}` : null, others: (got?.others ?? []).map((a) => `${a.email}:${a.state}`) }
      }
      const userOf = async (email) => (await dbQuery(`SELECT user_id FROM user_email WHERE email = $1`, [email]))[0]?.user_id ?? 'missing'
      const liveSessions = async (userId) =>
        Number((await dbQuery(`SELECT count(*)::int AS n FROM user_session WHERE user_id = $1 AND revoked_at IS NULL`, [userId]))[0]?.n)

      const A = `e2e-acct-a+${stamp}@example.com`
      const B = `e2e-acct-b+${stamp}@example.com`
      await codeLogin(A, false)
      const firstToken = jar.get('nc_session')
      const addedB = await codeLogin(B, true)
      check('★ 더하기 — 둘째 계정이 지금 계정이 되고 첫째는 로그아웃 없이 목록에 남는다',
        addedB.status === 200 && jar.get('nc_accounts') === firstToken
          && JSON.stringify(await list()) === JSON.stringify({ current: `${B}:signed_in`, others: [`${A}:signed_in`] }),
        JSON.stringify([addedB.status, await list()]))

      // C — 비밀번호로 더한다(비밀번호는 C 의 다른 세션으로 정해 둔다)
      const cUser = await createUser(`다중 계정의 C ${stamp}`)
      const cSide = await joinAs(workspaceId, cUser, 'member')
      const PASSWORD = `correct horse ${stamp}`
      await fetch(`${BASE}/api/workspaces/${workspaceId}/account/password`, {
        method: 'PUT', headers: { ...json, cookie: `nc_session=${cSide.token}` }, body: JSON.stringify({ newPassword: PASSWORD }),
      })
      const C = cUser.email
      const addedC = await call('/api/auth/password-login', { method: 'POST', body: JSON.stringify({ email: C, password: PASSWORD, addAccount: true }) })
      check('비밀번호 로그인도 더한다 — 앞의 계정이 목록의 맨 앞으로',
        addedC.status === 200 && JSON.stringify(await list()) === JSON.stringify({ current: `${C}:signed_in`, others: [`${B}:signed_in`, `${A}:signed_in`] }),
        JSON.stringify([addedC.status, await list()]))

      const toA = await call('/api/auth/switch-account', { method: 'POST', body: JSON.stringify({ userId: await userOf(A) }) })
      const home = await fetch(`${BASE}/`, { headers: { cookie: cookieHeader() }, redirect: 'manual' })
      const homeHtml = await home.text()
      check('★ 바꾸기 — 지금 계정이 A 가 되고 C 는 목록의 맨 앞 · 처음 화면이 A 의 것이다',
        toA.status === 200 && toA.body?.mfaRequired === false
          && JSON.stringify(await list()) === JSON.stringify({ current: `${A}:signed_in`, others: [`${C}:signed_in`, `${B}:signed_in`] })
          && home.status === 200 && homeHtml.includes(A) && !homeHtml.includes(B),
        JSON.stringify([toA, await list(), home.status]))
      const nobody = await call('/api/auth/switch-account', { method: 'POST', body: JSON.stringify({ userId: randomUUID() }) })
      check('이 브라우저에 없는 계정으로는 못 바꾼다 — 404', nobody.status === 404 && nobody.body?.error === 'not_found', JSON.stringify(nobody))

      const outA = await call('/api/auth/logout', { method: 'POST', headers: { accept: 'application/json' }, body: '{}' })
      check('★ 지금 계정만 로그아웃 — A 의 세션이 폐기되고 목록의 살아 있는 첫째(C)가 지금 계정이 된다',
        outA.status === 200 && outA.body?.signedIn === true && (await liveSessions(await userOf(A))) === 0
          && JSON.stringify(await list()) === JSON.stringify({ current: `${C}:signed_in`, others: [`${B}:signed_in`] }),
        JSON.stringify([outA, await list()]))

      await dbQuery(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'e2e' WHERE user_id = $1 AND revoked_at IS NULL`, [await userOf(B)])
      const toB = await call('/api/auth/switch-account', { method: 'POST', body: JSON.stringify({ userId: await userOf(B) }) })
      check('★ 끝난 세션 — 목록에 "다시 로그인"으로 남고, 그 계정으로는 못 바꾼다(409) · 지금 계정은 그대로',
        toB.status === 409 && toB.body?.error === 'signed_out'
          && JSON.stringify(await list()) === JSON.stringify({ current: `${C}:signed_in`, others: [`${B}:signed_out`] }),
        JSON.stringify([toB, await list()]))

      const outB = await call('/api/auth/logout', { method: 'POST', headers: { accept: 'application/json' }, body: JSON.stringify({ userId: await userOf(B) }) })
      check('한 계정만 로그아웃 — 목록에서 빠지고 지금 계정은 그대로',
        outB.status === 200 && !jar.has('nc_accounts') && JSON.stringify(await list()) === JSON.stringify({ current: `${C}:signed_in`, others: [] }),
        JSON.stringify([outB, await list()]))

      await codeLogin(A, true)
      const outAll = await call('/api/auth/logout', { method: 'POST', headers: { accept: 'application/json' }, body: JSON.stringify({ scope: 'all' }) })
      check('★ 모두 로그아웃 — 두 쿠키가 지워지고 두 세션이 모두 폐기된다(C 의 다른 기기 세션은 그대로)',
        outAll.status === 200 && outAll.body?.signedIn === false && !jar.has('nc_session') && !jar.has('nc_accounts')
          && (await liveSessions(await userOf(A))) === 0 && (await liveSessions(cUser.userId)) === 1,
        JSON.stringify([outAll, [...jar.keys()], await liveSessions(cUser.userId)]))

      const form = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'scope=all', redirect: 'manual' })
      check('폼으로 보낸 로그아웃은 화면으로 보낸다 — 아무도 남지 않으면 /login',
        form.status === 303 && new URL(form.headers.get('location') ?? '', BASE).pathname === '/login', JSON.stringify([form.status, form.headers.get('location')]))
    }

    if (sectionIf('다중 계정 — 화면 (8j-3 · F-14-09)')) {
      // 스위처의 "다른 계정 더하기" → 로그인 화면의 더하기 모드(비밀번호) → 두 계정이 함께 · 스위처에 다른 계정과 그 워크스페이스 → 고르면 그
      // 계정으로 바꿔 그리로 · 다른 계정만 로그아웃 · 끝난 세션은 "다시 로그인"(이메일을 채운 로그인 화면) · 모든 계정에서 로그아웃. 브라우저
      // 세션을 새 사람들로 바꿔 진행하고 끝에 소유자로 되돌린다(목록 쿠키도 지운다). 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const { hashSessionToken } = await import(new URL('../src/lib/auth/session-context.ts', import.meta.url).href)
      const stamp = Date.now()
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const first = await joinAs(workspaceId, await createUser(`첫 계정 ${stamp}`), 'member')
      const secondUser = await createUser(`둘째 계정 ${stamp}`)
      const secondSide = await joinAs(workspaceId, secondUser, 'member')
      const asSecond = { ...json, cookie: `nc_session=${secondSide.token}` }
      const SECOND_SPACE = `둘째의 공간 ${stamp}`
      const secondWs = (await (await fetch(`${BASE}/api/workspaces`, { method: 'POST', headers: asSecond, body: JSON.stringify({ name: SECOND_SPACE }) })).json().catch(() => null))?.workspaceId ?? 'missing'
      const PASSWORD = `correct horse ${stamp}`
      await fetch(`${BASE}/api/workspaces/${workspaceId}/account/password`, { method: 'PUT', headers: asSecond, body: JSON.stringify({ newPassword: PASSWORD }) })

      const SWITCHER = '[data-testid="sidebar-workspace-switcher"]'
      const MENU = '[data-testid="workspace-switcher-menu"]'
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const textOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
      const typeInto = async (sel, text) => {
        await clickSelector(sel)
        await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.focus(); el?.select() })()`)
        await typeText(text)
      }
      const openUntil = async (button, target) => {
        for (let i = 0; i < 6; i += 1) {
          if (await has(target)) return true
          await clickSelector(button)
          if (await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 1500)) return true
        }
        return false
      }
      const otherAccounts = () => evaluate(`[...document.querySelectorAll('[data-testid="switcher-account"]')].map((s) => s.getAttribute('aria-label') + ':' + s.dataset.state
        + ':' + [...s.querySelectorAll('[data-testid="switcher-account-workspace"]')].map((b) => b.dataset.workspaceId).join(','))`)
      const browserCookies = async () => (await send('Network.getCookies', { urls: [BASE] })).cookies.map((c) => c.name).filter((n) => n.startsWith('nc_')).sort()
      const liveSession = async (token) => Number((await dbQuery(`SELECT count(*)::int AS n FROM user_session WHERE token_hash = $1 AND revoked_at IS NULL`, [hashSessionToken(token)]))[0]?.n) === 1

      try {
        await browseAs(first.token)
        await send('Network.deleteCookies', { name: 'nc_accounts', domain: 'localhost' })
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector(${JSON.stringify(SWITCHER)})`, 15000)
        check('혼자일 때 — 다른 계정이 없고 "모든 계정에서 로그아웃"도 없다 · "다른 계정 더하기"가 선다',
          (await openUntil(SWITCHER, MENU)) && JSON.stringify(await otherAccounts()) === '[]'
            && !(await has('[data-testid="switcher-logout-all"]')) && (await has('[data-testid="switcher-add-account"]')))

        await clickSelector('[data-testid="switcher-add-account"]')
        await waitFor(`location.pathname === '/login' && !!document.querySelector('#email')`, 15000)
        check('★ "다른 계정 더하기" — 로그인 화면이 지금 계정은 로그아웃되지 않는다고 말한다',
          (await evaluate('location.search')).includes('add=1') && String(await textOf('main p')).includes('지금 계정은 로그아웃되지 않습니다'),
          String(await textOf('main p')))
        await typeInto('#email', secondUser.email)
        await openUntil('[data-testid="login-password-open"]', '[data-testid="login-password-form"]')
        await typeInto('[data-testid="login-password"]', PASSWORD)
        await clickSelector('[data-testid="login-password-submit"]')
        await waitFor(`location.pathname === '/'`, 15000)
        check('★ 더하면 둘째가 지금 계정이 되고 첫째는 그대로 살아 있다(쿠키 둘)',
          JSON.stringify(await browserCookies()) === JSON.stringify(['nc_accounts', 'nc_session']) && (await liveSession(first.token))
            && String(await evaluate('document.body.innerText')).includes(secondUser.email),
          JSON.stringify(await browserCookies()))

        await send('Page.navigate', { url: `${BASE}/w/${secondWs}` })
        await waitFor(`!!document.querySelector(${JSON.stringify(SWITCHER)})`, 15000)
        await openUntil(SWITCHER, MENU)
        check('★ 스위처 — 지금 계정(둘째)의 워크스페이스 아래 첫째 계정과 그 워크스페이스가 선다',
          (await textOf('[data-testid="switcher-email"]')) === secondUser.email
            && JSON.stringify(await otherAccounts()) === JSON.stringify([`${first.email}:signed_in:${workspaceId}`])
            && (await has('[data-testid="switcher-logout-all"]')),
          JSON.stringify(await otherAccounts()))

        await clickSelector(`[data-testid="switcher-account-workspace"][data-workspace-id="${workspaceId}"]`)
        await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}`)}`, 15000)
        await waitFor(`!!document.querySelector(${JSON.stringify(SWITCHER)})`, 15000)
        await openUntil(SWITCHER, MENU)
        check('★ 다른 계정의 워크스페이스를 고르면 그 계정으로 바뀌어 그리로 간다 — 둘째는 목록으로(그 워크스페이스 둘과 함께)',
          (await textOf('[data-testid="switcher-email"]')) === first.email
            && JSON.stringify(await otherAccounts()) === JSON.stringify([`${secondUser.email}:signed_in:${workspaceId},${secondWs}`]),
          JSON.stringify([await textOf('[data-testid="switcher-email"]'), await otherAccounts()]))

        const secondBrowserToken = (await send('Network.getCookies', { urls: [BASE] })).cookies.find((c) => c.name === 'nc_accounts')?.value ?? ''
        await clickSelector(`[data-testid="switcher-account"][data-user-id="${secondUser.userId}"] [data-testid="switcher-account-logout"]`)
        check('★ 다른 계정만 로그아웃 — 그 계정이 목록에서 빠지고 그 세션이 폐기된다 · 지금 계정과 둘째의 다른 기기 세션은 그대로',
          (await waitFor(`!document.querySelector('[data-testid="switcher-account"]')`, 10000))
            && !(await liveSession(secondBrowserToken)) && (await liveSession(secondSide.token)) && (await liveSession(first.token))
            && (await textOf('[data-testid="switcher-email"]')) === first.email,
          JSON.stringify(await otherAccounts()))

        // 끝난 세션 — 셋째의 세션을 목록 쿠키에 넣고 폐기한다
        const third = await joinAs(workspaceId, await createUser(`셋째 계정 ${stamp}`), 'member')
        await send('Network.setCookie', { name: 'nc_accounts', value: third.token, domain: 'localhost', path: '/', httpOnly: true })
        await dbQuery(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'e2e' WHERE token_hash = $1`, [hashSessionToken(third.token)])
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector(${JSON.stringify(SWITCHER)})`, 15000)
        await openUntil(SWITCHER, MENU)
        check('★ 끝난 세션 — "다시 로그인 필요"로 서고 워크스페이스는 보이지 않는다',
          JSON.stringify(await otherAccounts()) === JSON.stringify([`${third.email}:signed_out:`])
            && String(await textOf('[data-testid="switcher-account"]')).includes('다시 로그인 필요')
            && (await has('[data-testid="switcher-account-relogin"]')),
          JSON.stringify(await otherAccounts()))
        await clickSelector('[data-testid="switcher-account-relogin"]')
        check('"다시 로그인"은 그 이메일을 채운 더하기 모드의 로그인 화면이다',
          await waitFor(`location.pathname === '/login' && location.search.includes('add=1') && document.querySelector('#email')?.value === ${JSON.stringify(third.email)}`, 15000),
          String(await evaluate(`document.querySelector('#email')?.value ?? null`)))

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector(${JSON.stringify(SWITCHER)})`, 15000)
        await openUntil(SWITCHER, MENU)
        await clickSelector('[data-testid="switcher-logout-all"]')
        check('★ 모든 계정에서 로그아웃 — 로그인 화면으로 · 쿠키 둘이 지워지고 지금 계정의 세션도 폐기된다',
          (await waitFor(`location.pathname === '/login'`, 15000)) && JSON.stringify(await browserCookies()) === '[]' && !(await liveSession(first.token)),
          JSON.stringify([await evaluate('location.pathname'), await browserCookies()]))
      } finally {
        await send('Network.deleteCookies', { name: 'nc_accounts', domain: 'localhost' })
        await browseAs(session)
      }
    }

    if (sectionIf('요금제 게이트 (8k-2 · F-13-18)')) {
      // 이 절이 만든 **Free** 워크스페이스에서(주 워크스페이스는 Business 다): private teamspace 를 만들려 하면 요금제의 말이 서고 만들어지지
      // 않는다 · 게스트 한도(10 — 계정 없는 이메일의 대기 초대 열 개로 채운다)에서 이메일 초대가 한도의 말을 하고 초대가 남지 않는다 · 요금제를
      // 올리면(운영자 명령) 같은 초대가 된다. 브라우저 세션을 그 워크스페이스의 소유자로 바꿔 진행하고 끝에 되돌린다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const bossSide = await joinAs(workspaceId, await createUser(`요금제의 대표 ${stamp}`), 'member')
      const asBoss = { ...json, cookie: `nc_session=${bossSide.token}` }
      const freeWs = (await (await fetch(`${BASE}/api/workspaces`, { method: 'POST', headers: asBoss, body: JSON.stringify({ name: `무료 ${stamp}` }) })).json()).workspaceId
      const doc = (await (await fetch(`${BASE}/api/workspaces/${freeWs}/pages`, { method: 'POST', headers: asBoss, body: JSON.stringify({ title: `한도의 문서 ${stamp}` }) })).json()).page.id
      const guestsUrl = `${BASE}/api/workspaces/${freeWs}/pages/${doc}/guests`
      for (let i = 0; i < 10; i += 1) {
        await fetch(guestsUrl, { method: 'POST', headers: asBoss, body: JSON.stringify({ email: `seat-${i}-${stamp}@example.com`, level: 'view' }) })
      }
      const pending = async () => Number((await dbQuery(`SELECT count(*)::int AS n FROM workspace_invite WHERE workspace_id = $1 AND role = 'guest' AND accepted_at IS NULL AND revoked_at IS NULL`, [freeWs]))[0]?.n)
      const teamspaces = async () => Number((await dbQuery(`SELECT count(*)::int AS n FROM teamspace WHERE workspace_id = $1`, [freeWs]))[0]?.n)
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const openUntil = async (button, target) => {
        for (let i = 0; i < 6; i += 1) {
          if (await has(target)) return true
          await clickSelector(button)
          if (await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 1500)) return true
        }
        return false
      }
      const DIALOG = '[role="dialog"][aria-label="공유 설정"]'
      const EMAIL = `${DIALOG} input[aria-label="초대할 이메일"]`
      const panelSays = (text) => waitFor(`(document.querySelector('${DIALOG}')?.textContent ?? '').includes(${JSON.stringify(text)})`, 10000)
      const inviteInPanel = async (email) => {
        await clickSelector(EMAIL)
        await evaluate(`document.querySelector(${JSON.stringify(EMAIL)})?.select()`)
        await send('Input.insertText', { text: email })
        await clickSelector('[data-testid="share-invite-guest-submit"]')
      }

      try {
        check('준비 — Free 워크스페이스에 대기 초대 열 개(게스트 한도)', (await pending()) === 10, String(await pending()))
        await browseAs(bossSide.token)
        await send('Page.navigate', { url: `${BASE}/w/${freeWs}` })
        await waitFor(`!!document.querySelector('[data-testid="teamspace-create-open"]')`, 15000)
        await openUntil('[data-testid="teamspace-create-open"]', '[data-testid="teamspace-create-visibility"]')
        await clickSelector('[data-testid="teamspace-visibility-private"]')
        // 8k-3 부터 화면이 private 를 막는다 — 눌러도 고르지 않고 "요금제 필요"가 붙는다. 서버의 거부는 화면을 건너뛰어 본다.
        check('★ Free 에서는 만들기 폼의 private 가 막혀 있고 "요금제 필요"가 붙는다(눌러도 고르지 않는다)',
          await evaluate(`(() => {
            const radio = document.querySelector('[data-testid="teamspace-visibility-private"]')
            return !!radio && radio.disabled && !radio.checked
              && (document.querySelector('[data-testid="teamspace-visibility-private-plan"]')?.textContent ?? '') === '요금제 필요'
          })()`))
        const direct = await fetch(`${BASE}/api/workspaces/${freeWs}/teamspaces`, {
          method: 'POST', headers: asBoss, body: JSON.stringify({ name: `비밀 ${stamp}`, visibility: 'private' }),
        })
        const directBody = await direct.json().catch(() => null)
        check('★ 화면을 건너뛰어도 서버가 막는다 — 403 plan_required · 만들어지지 않는다',
          direct.status === 403 && directBody?.error === 'plan_required' && (await teamspaces()) === 0,
          JSON.stringify([direct.status, directBody, await teamspaces()]))

        await send('Page.navigate', { url: `${BASE}/w/${freeWs}/${doc}` })
        await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '공유')`, 15000)
        await clickText('공유')
        await waitFor(`!!document.querySelector(${JSON.stringify(EMAIL)})`, 10000)
        const newcomer = `newcomer-${stamp}@example.com`
        await inviteInPanel(newcomer)
        check('★ 게스트 한도에서 이메일 초대가 한도의 말을 하고 초대는 남지 않는다',
          (await panelSays('게스트 한도에 닿았습니다')) && (await pending()) === 10, String(await pending()))

        await setWorkspacePlan(freeWs, 'business')
        await inviteInPanel(newcomer)
        check('요금제를 올리면(운영자 명령) 같은 초대가 된다', (await panelSays('초대 메일을 보냈습니다')) && (await pending()) === 11, String(await pending()))
      } finally {
        await browseAs(session)
      }
    }

    if (sectionIf('요금제 패널 (8k-3 · F-13-18)')) {
      // 설정 → 워크스페이스 → 요금제: 지금 요금제 · 게스트 쓴 양 · 네 요금제의 비교 표(값은 표 그대로) — 소유자 · 멤버 관리자만. 요금제를
      // 올리면(운영자 명령) 패널이 따라온다. teamspace 설정의 private 고르개 — 이미 private 인 것은 내려도 그대로 · 닫힌 것은 막힌다. 이 절이
      // 만든 Free 워크스페이스에서 그 소유자로 진행하고 끝에 되돌린다.
      const stamp = Date.now()
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const bossSide = await joinAs(workspaceId, await createUser(`요금제 패널의 대표 ${stamp}`), 'member')
      const asBoss = { ...json, cookie: `nc_session=${bossSide.token}` }
      const ws = (await (await fetch(`${BASE}/api/workspaces`, { method: 'POST', headers: asBoss, body: JSON.stringify({ name: `요금제 패널 ${stamp}` }) })).json()).workspaceId
      const doc = (await (await fetch(`${BASE}/api/workspaces/${ws}/pages`, { method: 'POST', headers: asBoss, body: JSON.stringify({ title: `패널의 문서 ${stamp}` }) })).json()).page.id
      await fetch(`${BASE}/api/workspaces/${ws}/pages/${doc}/guests`, { method: 'POST', headers: asBoss, body: JSON.stringify({ email: `panel-${stamp}@example.com`, level: 'view' }) })
      const plain = await joinAs(ws, await createUser(`요금제 패널의 멤버 ${stamp}`), 'member')
      const PLAN = `${BASE}/w/${ws}/settings?s=workspace.plan`
      const textOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
      const cell = (key, plan) => textOf(`[data-testid="plan-compare"] tr[data-key="${key}"] td[data-plan="${plan}"]`)

      try {
        await browseAs(bossSide.token)
        await send('Page.navigate', { url: PLAN })
        await waitFor(`!!document.querySelector('[data-testid="plan-panel"]')`, 15000)
        check('★ 요금제 절 — 지금 요금제(Free) · 게스트 쓴 양(대기 초대 하나 / 10명) · 바꾸는 길은 운영자',
          (await textOf('[data-testid="plan-current"]')) === 'Free' && (await textOf('[data-testid="plan-usage-guests"]')) === '게스트 1 / 10명'
            && String(await textOf('[data-testid="plan-panel"]')).includes('운영자가 정합니다'),
          JSON.stringify([await textOf('[data-testid="plan-current"]'), await textOf('[data-testid="plan-usage-guests"]')]))
        const header = await evaluate(`[...document.querySelectorAll('[data-testid="plan-compare"] thead th[data-plan]')].map((th) => th.dataset.plan + (th.getAttribute('aria-current') === 'true' ? '*' : ''))`)
        check('★ 비교 표 — 네 요금제(가격 순 · 지금 것 표시) · 값은 엔타이틀먼트 표 그대로',
          JSON.stringify(header) === JSON.stringify(['free*', 'plus', 'business', 'enterprise'])
            && (await cell('history.days', 'free')) === '7일' && (await cell('history.days', 'enterprise')) === '무제한'
            && (await cell('guests.max', 'free')) === '10명' && (await cell('teamspace.private', 'plus')) === '—'
            && (await cell('teamspace.private', 'business')) === '쓸 수 있음',
          JSON.stringify([header, await cell('history.days', 'free'), await cell('guests.max', 'free'), await cell('teamspace.private', 'business')]))

        await setWorkspacePlan(ws, 'business')
        await send('Page.navigate', { url: PLAN })
        check('요금제를 올리면(운영자 명령) 패널이 따라온다 — Business · 게스트는 무제한',
          await waitFor(`document.querySelector('[data-testid="plan-current"]')?.textContent === 'Business'
            && document.querySelector('[data-testid="plan-usage-guests"]')?.textContent === '게스트 1명 (무제한)'`, 15000),
          JSON.stringify([await textOf('[data-testid="plan-current"]'), await textOf('[data-testid="plan-usage-guests"]')]))

        // teamspace 설정의 private 고르개 — Business 에서 private 와 닫힌 것을 만들고 Free 로 내린다
        const mk = async (name, visibility) =>
          (await (await fetch(`${BASE}/api/workspaces/${ws}/teamspaces`, { method: 'POST', headers: asBoss, body: JSON.stringify({ name, visibility }) })).json()).teamspace?.id
        const secret = await mk(`비밀 ${stamp}`, 'private')
        const closed = await mk(`닫힌 ${stamp}`, 'closed')
        await setWorkspacePlan(ws, 'free')
        const radio = () => evaluate(`(() => { const r = document.querySelector('[data-testid="teamspace-settings-visibility-private"]'); return r ? { disabled: r.disabled, checked: r.checked, badge: !!document.querySelector('[data-testid="teamspace-settings-visibility-private-plan"]') } : null })()`)
        await send('Page.navigate', { url: `${BASE}/w/${ws}/teamspaces/${secret}` })
        await waitFor(`!!document.querySelector('[data-testid="teamspace-settings-visibility-private"]')`, 15000)
        const secretRadio = await radio()
        await send('Page.navigate', { url: `${BASE}/w/${ws}/teamspaces/${closed}` })
        await waitFor(`!!document.querySelector('[data-testid="teamspace-settings-visibility-private"]')`, 15000)
        const closedRadio = await radio()
        check('★ 내린 뒤의 teamspace 설정 — 이미 private 인 것은 그대로 고를 수 있고, 닫힌 것은 private 가 막히고 "요금제 필요"',
          secretRadio?.checked === true && secretRadio.disabled === false && secretRadio.badge === false
            && closedRadio?.disabled === true && closedRadio.checked === false && closedRadio.badge === true,
          JSON.stringify([secretRadio, closedRadio]))

        await browseAs(plain.token)
        await send('Page.navigate', { url: `${BASE}/w/${ws}/settings` })
        await waitFor(`!!document.querySelector('[data-testid="settings-nav-link"][data-section="workspace.general"]')`, 15000)
        check('멤버에게는 요금제 절이 없다(일반 절은 선다)',
          !(await evaluate(`!!document.querySelector('[data-testid="settings-nav-link"][data-section="workspace.plan"]')`)))
      } finally {
        await browseAs(session)
      }
    }

    if (sectionIf('검색 쿼리 문법 (8l-1 · F-07-02)')) {
      // 검색 오버레이에서 한국어 축의 문법 — 공백은 AND(떨어져 있어도) · "구절" 은 붙어 있을 때만 · -제외. 구절은 한 덩이로 강조된다(서버와
      // 같은 파서). 제목으로 찾는다 — 자기 데이터를 스스로 만든다.
      const x = String(Date.now()).slice(-7)
      const mk = async (title) =>
        (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ title }) })).json()).page.id
      const near = await mk(`주간 보고 ${x}`)
      const far = await mk(`주간 회의 보고 ${x}`)
      const hitIds = () => evaluate(`[...document.querySelectorAll('[data-testid="search-hit"]')].map((e) => e.dataset.pageId)`)
      const settled = (want) => waitFor(`(() => {
        const ids = [...document.querySelectorAll('[data-testid="search-hit"]')].map((e) => e.dataset.pageId)
        return ${JSON.stringify(want)}.every((id) => ids.includes(id)) && ids.length === ${want.length}
      })()`, 8000)
      const ask = async (query) => {
        await evaluate(`(() => { const el = document.querySelector('[data-testid="search-input"]'); el?.focus(); el?.select() })()`)
        await typeText(query)
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="sidebar-workspace-switcher"]')`, 15000)
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="search-overlay"]')`)); i += 1) {
        await key('k', MOD)
        await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 1500)
      }
      await ask(`주간 보고 ${x}`)
      check('★ 공백은 AND — 떨어져 있어도 둘 다 걸린다', await settled([near, far]), JSON.stringify(await hitIds()))

      await ask(`"주간 보고" ${x}`)
      check('★ 구절은 붙어 있을 때만', await settled([near]), JSON.stringify(await hitIds()))
      const marks = await evaluate(`[...document.querySelectorAll('[data-testid="search-hit"][data-page-id="${near}"] mark')].map((m) => m.textContent)`)
      check('★ 구절은 한 덩이로 강조된다(서버와 같은 파서)', Array.isArray(marks) && marks.includes('주간 보고'), JSON.stringify(marks))

      await ask(`주간 ${x} -회의`)
      check('제외 — 그 말이 있는 문서는 빠진다', await settled([near]), JSON.stringify(await hitIds()))
      await key('Escape')
    }

    if (sectionIf('검색 랭킹 · 정렬 (8l-2 · F-07-02)')) {
      // 검색 오버레이 — 가장 잘 맞는 순(제목이 정확히 같은 것이 먼저 — 더 최근에 고친 것보다)과 정렬 고르개(찾는 동안만 · 만든 때 오름).
      // 색인의 시각은 SQL 로 정한다(검사만의 지름길). 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const x = String(Date.now()).slice(-7)
      const mk = async (title) =>
        (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ title }) })).json()).page.id
      const exact = await mk(`정렬${x}`)
      const second = await mk(`정렬${x} 회의`)
      const third = await mk(`정렬${x} 셋`)
      const setTimes = (page, created, edited) =>
        dbQuery(`UPDATE search_document SET created_at = $2::timestamptz, last_edited_at = $3::timestamptz WHERE doc_id = $1`, [page, created, edited])
      // 만든 순서 second · third · exact / 편집은 exact 가 가장 오래됐다
      await setTimes(second, '2026-01-01', '2026-03-03')
      await setTimes(third, '2026-01-02', '2026-03-02')
      await setTimes(exact, '2026-01-03', '2026-03-01')
      const hitIds = () => evaluate(`[...document.querySelectorAll('[data-testid="search-hit"]')].map((e) => e.dataset.pageId)`)
      const orderIs = (want) => waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="search-hit"]')].map((e) => e.dataset.pageId)) === ${JSON.stringify(JSON.stringify(want))}`, 8000)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="sidebar-workspace-switcher"]')`, 15000)
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="search-overlay"]')`)); i += 1) {
        await key('k', MOD)
        await waitFor(`!!document.querySelector('[data-testid="search-overlay"]')`, 1500)
      }
      check('빈 입력(최근 방문)에서는 정렬 고르개가 없다', !(await evaluate(`!!document.querySelector('[data-testid="search-sort"]')`)))
      await evaluate(`document.querySelector('[data-testid="search-input"]')?.focus()`)
      await typeText(`정렬${x}`)
      check('★ 가장 잘 맞는 순 — 제목이 정확히 같은 것이 먼저(더 최근에 고친 것보다) · 그다음 최근 편집',
        await orderIs([exact, second, third]), JSON.stringify(await hitIds()))
      check('찾는 동안 정렬 고르개가 서고 기본은 가장 잘 맞는 순',
        (await evaluate(`document.querySelector('[data-testid="search-sort"]')?.value ?? null`)) === 'best')

      await evaluate(`(() => {
        const s = document.querySelector('[data-testid="search-sort"]')
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'created_asc')
        s.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      check('★ 만든 때 — 오래된 순으로 바꾸면 단계를 보지 않고 만든 순서로', await orderIs([second, third, exact]), JSON.stringify(await hitIds()))
      await key('Escape')
    }

    if (sectionIf('가져오기 — 마크다운 · 텍스트 (8m-1 · F-09-12)')) {
      // 사이드바의 "가져오기" → 창 → 파일 둘(마크다운 · 텍스트) → 가져온 페이지의 링크와 옮기지 못한 것(표) → 링크로 연 페이지의 제목과 본문.
      // 받지 않는 형식은 무엇이 왜인지 말하고 아무것도 남기지 않는다. 파일은 임시 폴더에 쓴다.
      const x = String(Date.now()).slice(-7)
      const dir = mkdtempSync(join(tmpdir(), 'nc-e2e-import-'))
      const md = join(dir, `회의록-${x}.md`)
      const txt = join(dir, `메모-${x}.txt`)
      const docx = join(dir, `문서-${x}.docx`)
      writeFileSync(md, `# 가져온 회의록 ${x}\n\n- [x] 끝난 일 ${x}\n\n| 칸 | 값 |\n|---|---|\n| 가 | 나 |\n`)
      writeFileSync(txt, `메모 첫 문단 ${x}\n\n메모 둘째 문단`)
      writeFileSync(docx, 'not really a docx')
      const DIALOG = '[data-testid="import-dialog"]'
      const setFiles = async (paths) => {
        await send('DOM.enable')
        const rootId = (await send('DOM.getDocument', { depth: -1 })).root.nodeId
        const node = (await send('DOM.querySelector', { nodeId: rootId, selector: '[data-testid="import-files"]' })).nodeId
        await send('DOM.setFileInputFiles', { files: paths, nodeId: node })
      }
      const openDialog = async () => {
        for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('${DIALOG}')`)); i += 1) {
          await clickSelector('[data-testid="sidebar-import"]')
          await waitFor(`!!document.querySelector('${DIALOG}')`, 1500)
        }
      }

      try {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector('[data-testid="sidebar-import"]')`, 15000)
        await openDialog()
        await setFiles([docx])
        await waitFor(`document.querySelector('[data-testid="import-submit"]')?.disabled === false`, 5000)
        await clickSelector('[data-testid="import-submit"]')
        check('★ 받지 않는 형식은 무엇이 왜인지 말한다(서버가 거른다 — 고르개의 accept 를 건너뛰어도)',
          await waitFor(`(document.querySelector('[data-testid="import-error"]')?.textContent ?? '').includes('문서-${x}.docx')`, 10000),
          String(await evaluate(`document.querySelector('[data-testid="import-error"]')?.textContent ?? null`)))

        await setFiles([md, txt])
        await waitFor(`(document.querySelector('[data-testid="import-submit"]')?.textContent ?? '').includes('2개')`, 5000)
        await clickSelector('[data-testid="import-submit"]')
        const titles = () => evaluate(`[...document.querySelectorAll('[data-testid="import-page-link"]')].map((a) => a.textContent)`)
        check('★ 두 파일 → 두 페이지 — 제목은 # 제목 · 파일 이름',
          (await waitFor(`document.querySelectorAll('[data-testid="import-page-link"]').length === 2`, 15000))
            && JSON.stringify(await titles()) === JSON.stringify([`가져온 회의록 ${x}`, `메모-${x}`]),
          JSON.stringify(await titles()))
        // 표는 이제 표로 옮긴다(Phase 2 1d-3) — 잃은 것으로 말하지 않는다.
        check('표는 옮기지 못한 것이 아니다(1d-3)', !String(await evaluate(`document.querySelector('[data-testid="import-losses"]')?.textContent ?? ''`)).includes('표'))

        await clickSelector('[data-testid="import-page-link"]')
        check('★ 링크로 연 페이지 — 제목과 본문(할 일 · 표는 표로 — 1d-3)',
          await waitFor(`document.querySelector('input[aria-label="페이지 제목"]')?.value === ${JSON.stringify(`가져온 회의록 ${x}`)}
            && (document.querySelector('.blk-editor')?.textContent ?? '').includes('끝난 일 ${x}')
            && JSON.stringify([...document.querySelectorAll('.blk-editor .blk-table tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))) === JSON.stringify([['칸', '값'], ['가', '나']])`, 15000),
          String(await evaluate(`document.querySelector('.blk-editor')?.textContent?.slice(0, 120) ?? null`)))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    if (sectionIf('가져오기 — ZIP (8m-2a · F-09-12)')) {
      // 사이드바의 "가져오기"에 ZIP 하나 — 폴더 계층이 페이지 나무가 되고(이름.md + 폴더 · 폴더만의 페이지), 가져올 수 없는 항목(그림)은 이유와
      // 함께 "건너뛴 것"으로 선다. 연 하위 페이지의 경로에 부모가 선다. ZIP 은 우리 쓰기(`export/zip.ts`)로 만들어 임시 폴더에 둔다.
      const { createZipWriter } = await import(new URL('../src/lib/export/zip.ts', import.meta.url).href)
      const x = String(Date.now()).slice(-7)
      const dir = mkdtempSync(join(tmpdir(), 'nc-e2e-zip-'))
      const zipPath = join(dir, `묶음-${x}.zip`)
      const writer = createZipWriter()
      const parts = []
      for (const [path, text] of [
        [`프로젝트 ${x}.md`, `# 프로젝트 ${x}\n\n개요 문단`],
        [`프로젝트 ${x}/일정.md`, `# 일정 ${x}\n\n- [ ] 첫 할 일 ${x}`],
        [`자료 ${x}/참고.txt`, `참고 ${x}`],
        [`프로젝트 ${x}/그림.png`, 'not really png'],
      ]) parts.push(...writer.add(path, text))
      parts.push(writer.finish())
      writeFileSync(zipPath, Buffer.concat(parts))
      const DIALOG = '[data-testid="import-dialog"]'

      try {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector('[data-testid="sidebar-import"]')`, 15000)
        for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('${DIALOG}')`)); i += 1) {
          await clickSelector('[data-testid="sidebar-import"]')
          await waitFor(`!!document.querySelector('${DIALOG}')`, 1500)
        }
        await send('DOM.enable')
        const rootId = (await send('DOM.getDocument', { depth: -1 })).root.nodeId
        const node = (await send('DOM.querySelector', { nodeId: rootId, selector: '[data-testid="import-files"]' })).nodeId
        await send('DOM.setFileInputFiles', { files: [zipPath], nodeId: node })
        await waitFor(`document.querySelector('[data-testid="import-submit"]')?.disabled === false`, 5000)
        await clickSelector('[data-testid="import-submit"]')
        const titles = () => evaluate(`[...document.querySelectorAll('[data-testid="import-page-link"]')].map((a) => a.textContent)`)
        check('★ ZIP 하나 → 폴더 계층의 페이지들(이름.md + 폴더 · 폴더만의 페이지) — 처음 나온 순서',
          (await waitFor(`document.querySelectorAll('[data-testid="import-page-link"]').length === 4`, 20000))
            && JSON.stringify(await titles()) === JSON.stringify([`프로젝트 ${x}`, `일정 ${x}`, `자료 ${x}`, '참고']),
          JSON.stringify(await titles()))
        const skipped = await evaluate(`[...document.querySelectorAll('[data-testid="import-skipped-item"]')].map((li) => li.dataset.reason + ':' + li.textContent)`)
        check('★ 가져올 수 없는 항목은 이유와 함께 "건너뛴 것"으로 선다(부분 성공)',
          Array.isArray(skipped) && skipped.length === 1 && skipped[0].startsWith('unsupported_type:') && skipped[0].includes('그림.png')
            && String(await evaluate(`document.querySelector('[data-testid="import-skipped"]')?.textContent ?? ''`)).includes('건너뛴 것 1개'),
          JSON.stringify(skipped))

        // 둘째 링크(일정)의 id 를 먼저 읽는다 — 링크를 누르면 창이 닫혀 읽을 수 없다
        const second = await evaluate(`[...document.querySelectorAll('[data-testid="import-page-link"]')][1]?.dataset.pageId ?? null`)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${second}` })
        check('★ 하위 페이지를 열면 경로에 부모(프로젝트)가 서고 본문이 있다',
          await waitFor(`(document.querySelector('nav[aria-label="상위 경로"]')?.textContent ?? '').includes(${JSON.stringify(`프로젝트 ${x}`)})
            && (document.querySelector('.blk-editor')?.textContent ?? '').includes(${JSON.stringify(`첫 할 일 ${x}`)})`, 15000),
          String(await evaluate(`document.querySelector('nav[aria-label="상위 경로"]')?.textContent ?? null`)))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    if (sectionIf('가져오기 — ZIP 링크 · 이미지 (8m-2b · F-09-12)')) {
      // ZIP 안의 상대 주소가 살아난다 — 한 줄짜리 하위 링크는 **그 자리**의 하위 페이지 참조, 글 속의 링크는 페이지 멘션, 언급만 된 하위는 끝의 참조,
      // 이미지는 올린 파일(브라우저가 실제로 그린다). 쓰지 않은 이미지는 이유와 함께 "건너뛴 것"이다. 링크는 노션 · 우리 내보내기처럼 `%20` 으로 쓴다.
      const { createZipWriter } = await import(new URL('../src/lib/export/zip.ts', import.meta.url).href)
      const x = String(Date.now()).slice(-7)
      const dir = mkdtempSync(join(tmpdir(), 'nc-e2e-zip-links-'))
      const zipPath = join(dir, `여행-${x}.zip`)
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      const folder = encodeURIComponent(`여행 ${x}`)
      const writer = createZipWriter()
      const parts = []
      for (const [path, data] of [
        [`여행 ${x}.md`, [`# 여행 ${x}`, '', `앞 문단 ${x}`, '', `[준비물](${folder}/%EC%A4%80%EB%B9%84%EB%AC%BC.md)`, '', `![사진](${folder}/사진.png)`, '',
          `뒤 문단 [일정](${folder}/일정.md) 참고`].join('\n')],
        [`여행 ${x}/준비물.md`, `# 준비물 ${x}\n\n[여행으로](../${folder}.md)`],
        [`여행 ${x}/일정.md`, `# 일정 ${x}\n\n일정 본문`],
        [`여행 ${x}/사진.png`, png],
        [`여행 ${x}/안쓰는.png`, png],
      ]) parts.push(...writer.add(path, data))
      parts.push(writer.finish())
      writeFileSync(zipPath, Buffer.concat(parts))
      const DIALOG = '[data-testid="import-dialog"]'

      try {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        await waitFor(`!!document.querySelector('[data-testid="sidebar-import"]')`, 15000)
        for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('${DIALOG}')`)); i += 1) {
          await clickSelector('[data-testid="sidebar-import"]')
          await waitFor(`!!document.querySelector('${DIALOG}')`, 1500)
        }
        await send('DOM.enable')
        const rootId = (await send('DOM.getDocument', { depth: -1 })).root.nodeId
        const node = (await send('DOM.querySelector', { nodeId: rootId, selector: '[data-testid="import-files"]' })).nodeId
        await send('DOM.setFileInputFiles', { files: [zipPath], nodeId: node })
        await waitFor(`document.querySelector('[data-testid="import-submit"]')?.disabled === false`, 5000)
        await clickSelector('[data-testid="import-submit"]')
        const links = () => evaluate(`[...document.querySelectorAll('[data-testid="import-page-link"]')].map((a) => [a.textContent, a.dataset.pageId])`)
        await waitFor(`document.querySelectorAll('[data-testid="import-page-link"]').length === 3`, 20000)
        const pages = new Map(await links())
        check('ZIP 의 세 페이지(부모 · 하위 둘)', [`여행 ${x}`, `준비물 ${x}`, `일정 ${x}`].every((t) => pages.has(t)), JSON.stringify([...pages.keys()]))
        const skipped = await evaluate(`[...document.querySelectorAll('[data-testid="import-skipped-item"]')].map((li) => li.dataset.reason + ':' + li.textContent)`)
        check('★ 쓰지 않은 이미지는 이유와 함께 "건너뛴 것"(쓴 이미지는 아니다)',
          Array.isArray(skipped) && skipped.length === 1 && skipped[0].startsWith('unreferenced:') && skipped[0].includes('안쓰는.png')
            && skipped[0].includes('본문에서 쓰지 않은 이미지'),
          JSON.stringify(skipped))

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pages.get(`여행 ${x}`)}` })
        const shape = `[...document.querySelectorAll('.blk-editor .blk')].map((el) =>
          el.classList.contains('blk-page-ref') ? 'ref:' + el.textContent.trim()
          : el.classList.contains('blk-image') ? 'img'
          : el.querySelector('.blk-mention-page') ? 'mention:' + el.querySelector('.blk-mention-page').dataset.mentionId
          : 'p:' + el.textContent.trim())`
        const expected = [`p:앞 문단 ${x}`, `ref:준비물 ${x}`, 'img', `mention:${pages.get(`일정 ${x}`)}`, `ref:일정 ${x}`]
        check('★ 하위 링크는 그 자리의 참조 · 글 속 링크는 멘션 · 언급만 된 하위는 끝의 참조',
          await waitFor(`JSON.stringify(${shape}) === ${JSON.stringify(JSON.stringify(expected))}`, 15000),
          JSON.stringify(await evaluate(shape)))
        check('★ ZIP 안의 이미지는 올린 파일 — 브라우저가 실제로 그린다',
          await waitFor(`(() => { const img = document.querySelector('.blk-editor figure.blk-image img'); return !!img && img.complete && img.naturalWidth === 1
            && img.getAttribute('src').includes('/files/') })()`, 15000),
          String(await evaluate(`document.querySelector('.blk-editor figure.blk-image img')?.getAttribute('src') ?? null`)))

        // 하위의 "부모로" 링크(`../여행%20….md`)는 부모의 멘션 — 눌러서 부모로 간다
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pages.get(`준비물 ${x}`)}` })
        check('★ 상위로 가는 링크(../)는 그 페이지의 멘션',
          await waitFor(`document.querySelector('.blk-editor .blk-mention-page')?.dataset.mentionId === ${JSON.stringify(pages.get(`여행 ${x}`))}
            && (document.querySelector('.blk-editor .blk-mention-page')?.textContent ?? '').includes(${JSON.stringify(`여행 ${x}`)})`, 15000),
          String(await evaluate(`document.querySelector('.blk-editor .blk-mention-page')?.outerHTML?.slice(0, 200) ?? null`)))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    if (sectionIf('블록 수식 (Phase 2 1a · F-01-20)')) {
      // 빈 줄에서 `/수식` → 입력창이 곧바로 열리고 쓰는 동안 미리 그린다 → Enter 로 저장하면 블록이 KaTeX 로 그려지고(글꼴까지) 서버에
      // `type='equation'` 행이 선다 · 캐럿은 뒤의 빈 문단. 블록을 누르면 다시 열리고 Esc 는 고치지 않는다. 틀린 식은 까닭을 붉게 보이고
      // 그대로 저장된다. 키보드만으로도 연다(블록 선택 → Enter). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const eqPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `블록 수식 ${stamp}` }),
      })).json()).page.id
      const line = randomUUID()
      await saveBody(eqPage, { blocks: [{ id: line, type: 'paragraph', title: [], properties: {}, format: {}, children: [] }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${eqPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${line}"] p')`, 15000)
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${line}"] p`)
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && document.querySelector('[data-block-id="${line}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      check('전제 — 빈 줄에 캐럿이 섰다', focused)

      const BLOCK = `[data-block-id="${line}"] div.blk-equation`
      const EDITOR = '[data-testid="equation-editor"]'
      await typeText('/')
      await typeText('수식')
      await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 3000)
      await key('Enter')
      check('★ /수식 — 그 줄이 블록 수식이 되고 입력창이 곧바로 열려 포커스를 받는다',
        await waitFor(`!!document.querySelector('${BLOCK}') && document.activeElement?.dataset.testid === 'equation-input'`, 5000),
        String(await evaluate(`document.querySelector('[data-block-id="${line}"]')?.innerHTML?.slice(0, 160) ?? '(없음)'`)))
      check('빈 수식은 자리 표시를 보인다', await evaluate(`document.querySelector('${BLOCK} .blk-equation-placeholder')?.textContent === '수식을 입력하세요'`))

      await typeText('\\frac{a}{b} + \\sqrt{x}')
      check('★ 쓰는 동안 미리 그린다 — 블록은 아직 그대로(저장 전)',
        await waitFor(`!!document.querySelector('[data-testid="equation-preview"] .mfrac') && !!document.querySelector('${BLOCK} .blk-equation-placeholder')`, 8000))
      await key('Enter')
      check('★ Enter 로 저장 — 입력창이 닫히고 블록이 KaTeX 로 그려진다(분수 · 근호)',
        await waitFor(`!document.querySelector('${EDITOR}') && !!document.querySelector('${BLOCK} .blk-equation-render .katex-display .mfrac')
          && !!document.querySelector('${BLOCK} .sqrt')`, 8000),
        String(await evaluate(`document.querySelector('${BLOCK}')?.innerHTML?.slice(0, 200) ?? '(없음)'`)))
      check('★ KaTeX 의 스타일시트가 붙었다 — 수식 글꼴로 그린다',
        String(await evaluate(`getComputedStyle(document.querySelector('${BLOCK} .katex')).fontFamily`)).includes('KaTeX_Main'),
        String(await evaluate(`getComputedStyle(document.querySelector('${BLOCK} .katex')).fontFamily`)))

      // 캐럿은 뒤의 빈 문단 — 이어 쓴다.
      await typeText('뒤 문단')
      const shapeOnServer = async () => (await readBody(eqPage)).doc.blocks.map((b) => [b.type, b.type === 'equation' ? b.properties?.expression ?? null : (b.title ?? []).map((r) => r.plain_text ?? '').join('')])
      let saved = null
      for (let i = 0; i < 60; i += 1) {
        saved = await shapeOnServer()
        if (JSON.stringify(saved) === JSON.stringify([['equation', '\\frac{a}{b} + \\sqrt{x}'], ['paragraph', '뒤 문단']])) break
        await sleep(150)
      }
      check("★ 서버 — type='equation' 행에 식 · 뒤 문단에 이어 쓴 글(포커스가 편집기로 돌아왔다)",
        JSON.stringify(saved) === JSON.stringify([['equation', '\\frac{a}{b} + \\sqrt{x}'], ['paragraph', '뒤 문단']]), JSON.stringify(saved))

      // 누르면 다시 열린다 — 연 순간의 식 · Esc 는 고치지 않는다.
      await clickSelector(BLOCK)
      check('★ 블록을 누르면 입력창이 지금 식으로 열린다',
        await waitFor(`document.querySelector('[data-testid="equation-input"]')?.value === ${JSON.stringify('\\frac{a}{b} + \\sqrt{x}')}`, 5000))
      await typeText(' + 1')
      await key('Escape')
      await sleep(400)
      check('Esc 는 저장하지 않고 닫는다',
        !(await evaluate(`!!document.querySelector('${EDITOR}')`)) && (await evaluate(`!!document.querySelector('${BLOCK} .mfrac')`))
          && JSON.stringify((await shapeOnServer())[0]) === JSON.stringify(['equation', '\\frac{a}{b} + \\sqrt{x}']))

      // 틀린 식 — 까닭을 보이고 그대로 저장한다(블록을 날리지 않는다).
      await clickSelector(BLOCK)
      await waitFor(`!!document.querySelector('[data-testid="equation-input"]')`, 5000)
      await evaluate(`(() => { const i = document.querySelector('[data-testid="equation-input"]'); i.setSelectionRange(0, i.value.length) })()`)
      await typeText('\\frac{a}{')
      check('틀린 식은 미리보기가 까닭을 보인다', await waitFor(`!!document.querySelector('[data-testid="equation-preview-error"]')`, 5000))
      await key('Enter')
      check('★ 틀린 식도 저장된다 — 블록은 원문을 붉게 · 까닭을 보인다',
        await waitFor(`document.querySelector('${BLOCK} .blk-equation-error code')?.textContent === ${JSON.stringify('\\frac{a}{')}
          && (document.querySelector('${BLOCK} .blk-equation-error-message')?.textContent ?? '').startsWith('수식을 그릴 수 없습니다')`, 8000),
        String(await evaluate(`document.querySelector('${BLOCK}')?.innerHTML?.slice(0, 200) ?? '(없음)'`)))

      // 키보드만으로 — 뒤 문단에서 Esc(블록 선택) → ↑(수식 블록 선택) → Enter.
      await clickSelector(`.blk-editor [data-block-id]:nth-child(2) p`)
      await key('Escape')
      await key('ArrowUp')
      await key('Enter')
      check('★ 키보드만으로 연다 — 블록 선택 → Enter',
        await waitFor(`document.activeElement?.dataset.testid === 'equation-input' && document.activeElement.value === ${JSON.stringify('\\frac{a}{')}`, 5000))
      await key('Escape')

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${eqPage}` })
      check('다시 열어도 그 식이다(틀린 식 그대로)', await waitFor(`document.querySelector('${BLOCK} .blk-equation-error code')?.textContent === ${JSON.stringify('\\frac{a}{')}`, 15000))
      await sleep(1000)
    }

    if (sectionIf('인라인 수식 (Phase 2 1b · F-01-20)')) {
      // 글 속에서 `$$식$$` 을 치면 닫는 순간 수식이 되고(KaTeX 로 그린다) 이어 쓴다. 누르면 입력창 — 고쳐 저장하면 캐럿은 수식 뒤.
      // 글자를 골라 Ctrl/Cmd+Shift+E 를 치면 그 글자가 식이 되고, 고른 것 없이 치면 빈 수식 + 입력창 — Esc 면 빈 수식은 사라진다.
      const stamp = Date.now()
      const iePage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `인라인 수식 ${stamp}` }),
      })).json()).page.id
      const line = randomUUID()
      await saveBody(iePage, { blocks: [{ id: line, type: 'paragraph', title: [textRun('넓이는 ')], properties: {}, format: {}, children: [] }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${iePage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${line}"] p')`, 15000)
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${line}"] p`)
        await key('End')
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && document.querySelector('[data-block-id="${line}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      check('전제 — 그 줄 끝에 캐럿이 섰다', focused)

      const EQ = `[data-block-id="${line}"] span[data-inline-equation]`
      for (const ch of '$$\\pi r^2$$') await typeText(ch)
      check('★ $$식$$ — 닫는 순간 수식이 되고 KaTeX 로 글자 사이에 그린다',
        await waitFor(`!!document.querySelector('${EQ} .katex') && !document.querySelector('${EQ} .katex-display')`, 8000),
        String(await evaluate(`document.querySelector('[data-block-id="${line}"] p')?.innerHTML?.slice(0, 200) ?? '(없음)'`)))
      await typeText(' 이다')

      const runsOnServer = async () => ((await readBody(iePage)).doc.blocks[0]?.title ?? []).map((r) => (r.type === 'equation' ? `[${r.equation?.expression}]` : r.plain_text ?? ''))
      const serverIs = async (expected) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          got = (await runsOnServer()).join('')
          if (got === expected) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      const [first, firstGot] = await serverIs('넓이는 [\\pi r^2] 이다')
      check('★ 서버 — 글 속의 수식 조각(type=equation)과 이어 쓴 글', first, firstGot)

      await clickSelector(EQ)
      check('★ 수식을 누르면 입력창이 그 식으로 열린다',
        await waitFor(`document.activeElement?.dataset.testid === 'equation-input' && document.activeElement.value === ${JSON.stringify('\\pi r^2')}`, 5000))
      await evaluate(`(() => { const i = document.querySelector('[data-testid="equation-input"]'); i.setSelectionRange(0, i.value.length) })()`)
      await typeText('2\\pi r')
      check('입력창의 미리보기는 글자 사이의 모양(디스플레이가 아니다)',
        await waitFor(`!!document.querySelector('[data-testid="equation-preview"] .katex') && !document.querySelector('[data-testid="equation-preview"] .katex-display')`, 5000))
      await key('Enter')
      await typeText('!')
      const [edited, editedGot] = await serverIs('넓이는 [2\\pi r]! 이다')
      check('★ 고쳐 저장하면 그 수식이 바뀌고 캐럿은 수식 바로 뒤다(다음 글자가 수식을 덮지 않는다)', edited, editedGot)

      // 글자를 골라 Ctrl/Cmd+Shift+E — 줄 끝에 "a+b" 를 치고 셋을 고른다.
      await key('End')
      await typeText(' a+b')
      // 친 글자의 협업 왕복이 끝난 뒤에 고른다 — 그 전에 넓힌 선택은 되돌아온 문서가 다시 놓는다(첫 판에서 한 글자만 골렸다).
      check('전제 — 친 글자가 서버에 닿았다', (await serverIs('넓이는 [2\\pi r]! 이다 a+b'))[0])
      for (let i = 0; i < 3; i += 1) {
        await key('ArrowLeft', SHIFT)
        await sleep(80)
      }
      check('전제 — 세 글자를 골랐다', await waitFor(`window.getSelection()?.toString() === 'a+b'`, 3000), String(await evaluate(`window.getSelection()?.toString()`)))
      await key('e', MOD | SHIFT)
      const [converted, convertedGot] = await serverIs('넓이는 [2\\pi r]! 이다 [a+b]')
      check('★ 글자를 골라 Ctrl/Cmd+Shift+E — 그 글자가 식이 된다', converted && (await evaluate(`document.querySelectorAll('${EQ}').length === 2`)), convertedGot)

      // 고른 것 없이 — 빈 수식 + 입력창 · Esc 면 사라진다.
      await key('e', MOD | SHIFT)
      check('★ 고른 것 없이 Ctrl/Cmd+Shift+E — 빈 수식을 넣고 입력창이 열린다',
        await waitFor(`document.activeElement?.dataset.testid === 'equation-input' && document.querySelectorAll('${EQ}').length === 3`, 5000))
      await key('Escape')
      check('★ 쓰지 않고 Esc — 빈 수식은 사라지고 캐럿은 그 자리',
        await waitFor(`document.querySelectorAll('${EQ}').length === 2 && document.activeElement?.classList.contains('ProseMirror')`, 5000))
      await typeText('.')
      const [after, afterGot] = await serverIs('넓이는 [2\\pi r]! 이다 [a+b].')
      check('서버에 빈 수식이 남지 않았다 — 그 자리에 이어 쓴 글', after, afterGot)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${iePage}` })
      check('다시 열어도 두 수식이 그려진다', await waitFor(`document.querySelectorAll('${EQ} .katex').length === 2`, 15000))
      await sleep(1000)
    }

    if (sectionIf('컬럼 (Phase 2 1c · F-01-12)')) {
      // 빈 줄에서 `/2열` → 그 줄이 첫 컬럼으로 들어가고 두 컬럼이 나란히 선다. 양쪽에 쓰면 서버에 틀(컬럼 목록 → 컬럼 → 문단)이 선다.
      // 컬럼 안의 Enter 는 그 컬럼에 새 블록, Shift+Tab · 둘째 컬럼 맨 앞의 Backspace 는 경계를 넘지 않는다(아무것도 바뀌지 않는다).
      // 핸들은 포인터 쪽 컬럼의 블록을 잡는다. 좁은 화면에서는 세로로 쌓인다.
      const stamp = Date.now()
      const colPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `컬럼 ${stamp}` }),
      })).json()).page.id
      const line = randomUUID()
      await saveBody(colPage, { blocks: [{ id: line, type: 'paragraph', title: [], properties: {}, format: {}, children: [] }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${colPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${line}"] p')`, 15000)
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${line}"] p`)
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && document.querySelector('[data-block-id="${line}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      check('전제 — 빈 줄에 캐럿이 섰다', focused)

      const COLS = `.blk-editor .blk-container:has(> .blk-column_list) > .blk-group > .blk-container`
      await typeText('/')
      await typeText('2열')
      await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 3000)
      await key('Enter')
      const side = async () => evaluate(`(() => {
        const cols = [...document.querySelectorAll('${COLS}')].map((c) => c.getBoundingClientRect())
        return cols.length === 2 ? { left: cols[0].left, leftRight: cols[0].right, right: cols[1].left, rightTop: cols[1].top, leftTop: cols[0].top, leftBottom: cols[0].bottom } : null
      })()`)
      check('★ /2열 — 두 컬럼이 나란히 선다 · 친 줄이 첫 컬럼 안이다',
        await waitFor(`(() => {
          const cols = [...document.querySelectorAll('${COLS}')]
          if (cols.length !== 2) return false
          const [a, b] = cols.map((c) => c.getBoundingClientRect())
          return b.left >= a.right && Math.abs(a.top - b.top) < 2 && cols[0].contains(document.querySelector('[data-block-id="${line}"]'))
        })()`, 5000),
        JSON.stringify(await side()))

      await typeText('왼쪽 글')
      const rightFirst = await evaluate(`document.querySelectorAll('${COLS}')[1]?.querySelector('[data-block-id]')?.dataset.blockId ?? null`)
      await clickSelector(`[data-block-id="${rightFirst}"] p`)
      await typeText('오른쪽 글')
      const treeOnServer = async () => {
        const text = (b) => (b.title ?? []).map((r) => r.plain_text ?? '').join('')
        const walk = (blocks) => blocks.map((b) => (b.type === 'paragraph' && !(b.children ?? []).length ? text(b) : [b.type === 'paragraph' ? text(b) : b.type, walk(b.children ?? [])]))
        return JSON.stringify(walk((await readBody(colPage)).doc.blocks))
      }
      const serverIs = async (expected) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          got = await treeOnServer()
          if (got === JSON.stringify(expected)) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      const twoColumns = [['column_list', [['column', ['왼쪽 글']], ['column', ['오른쪽 글']]]]]
      const [built, builtGot] = await serverIs(twoColumns)
      check('★ 서버 — 컬럼 목록 → 컬럼 둘 → 각자의 문단', built, builtGot)

      // 컬럼 안의 Enter — 그 컬럼에 새 블록.
      await clickSelector(`[data-block-id="${line}"] p`)
      await key('End')
      await key('Enter')
      await typeText('왼쪽 둘째')
      const [entered, enteredGot] = await serverIs([['column_list', [['column', ['왼쪽 글', '왼쪽 둘째']], ['column', ['오른쪽 글']]]]])
      check('★ 컬럼 안의 Enter — 그 컬럼에 새 블록', entered, enteredGot)

      // 경계 — Shift+Tab(컬럼의 직속 블록) · 둘째 컬럼 맨 앞의 Backspace 는 아무것도 바꾸지 않는다.
      await key('Tab', SHIFT)
      await clickSelector(`[data-block-id="${rightFirst}"] p`)
      for (let i = 0; i < 12; i += 1) await key('ArrowLeft')
      await key('Backspace')
      await sleep(800)
      const [kept, keptGot] = await serverIs([['column_list', [['column', ['왼쪽 글', '왼쪽 둘째']], ['column', ['오른쪽 글']]]]])
      check('★ Shift+Tab · 둘째 컬럼 맨 앞의 Backspace — 컬럼 경계를 넘지 않는다', kept, keptGot)

      // 핸들 — 왼쪽 컬럼의 블록 위에 포인터를 두면 그 블록의 핸들(오른쪽 컬럼의 블록이 아니다).
      const leftLine = await rect(`[data-block-id="${line}"] > *:first-child`)
      await move(leftLine.x + 20, leftLine.y + leftLine.h / 2)
      await waitFor(`!!document.querySelector('.blk-gutter-grip')`, 3000)
      const grip = await rect('.blk-gutter-grip')
      check('★ 핸들은 포인터 쪽 컬럼의 블록을 잡는다', !!grip && Math.abs(grip.y - leftLine.y) < 10 && grip.x + grip.w <= leftLine.x + 2, JSON.stringify({ grip, leftLine }))

      // 좁은 화면 — 세로로 쌓인다.
      await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: false })
      const stacked = await waitFor(`(() => {
        const [a, b] = [...document.querySelectorAll('${COLS}')].map((c) => c.getBoundingClientRect())
        return !!a && !!b && b.top >= a.bottom - 1
      })()`, 5000)
      await send('Emulation.clearDeviceMetricsOverride')
      check('좁은 화면에서는 세로로 쌓인다', stacked, JSON.stringify(await side()))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${colPage}` })
      check('다시 열어도 두 컬럼이 나란히', await waitFor(`(() => {
        const [a, b] = [...document.querySelectorAll('${COLS}')].map((c) => c.getBoundingClientRect())
        return !!a && !!b && b.left >= a.right
      })()`, 15000))
      await sleep(1000)
    }

    if (sectionIf('컬럼 폭 · 끌어 넣기 (Phase 2 1c-2 · F-01-12)')) {
      // 컬럼 사이의 손잡이를 끌면 폭이 바뀌고(놓을 때 한 번 저장 · 합 1), 위 블록을 끌어 둘째 컬럼 안에 놓으면 그 컬럼에 들어간다(차선).
      // 첫 컬럼의 마지막 블록을 끌어내면 그 컬럼이 사라지고 하나 남은 컬럼 목록은 풀린다. 빈 컬럼의 빈 블록에서 Backspace 는 그 컬럼을 지운다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const newPage = async (title) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title }) })).json()).page.id
      const cid = { top: randomUUID(), a: randomUUID(), b: randomUUID(), b2: randomUUID(), b3: randomUUID(), end: randomUUID(), list: randomUUID(), left: randomUUID(), right: randomUUID() }
      const para = (id, text) => ({ id, type: 'paragraph', title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children: [] })
      const col = (id, children) => ({ id, type: 'column', title: [], properties: {}, format: {}, children })
      const widthPage = await newPage(`컬럼 폭 ${stamp}`)
      await saveBody(widthPage, { blocks: [
        para(cid.top, '위 블록'),
        { id: cid.list, type: 'column_list', title: [], properties: {}, format: {}, children: [col(cid.left, [para(cid.a, '왼쪽 a')]), col(cid.right, [para(cid.b, '오른쪽 b'), para(cid.b2, '오른쪽 b2'), para(cid.b3, '오른쪽 b3')])] },
        para(cid.end, '끝 블록'),
      ] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${widthPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${cid.b}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      const colRect = (id) => rect(`[data-block-id="${id}"]`)
      const serverIs = async (page, expected) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          const text = (b) => (b.title ?? []).map((r) => r.plain_text ?? '').join('')
          const walk = (blocks) => blocks.map((b) => (b.type === 'paragraph' ? text(b) : [b.type, walk(b.children ?? [])]))
          got = JSON.stringify(walk((await readBody(page)).doc.blocks))
          if (got === JSON.stringify(expected)) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }

      // ① 폭 — 손잡이를 오른쪽으로 끈다.
      const before = [await colRect(cid.left), await colRect(cid.right)]
      const handle = await evaluate(`(() => {
        const h = document.querySelector('[data-block-id="${cid.right}"] > .blk-column-resize')
        if (!h) return null
        const r = h.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 12) }
      })()`)
      check('전제 — 둘째 컬럼의 왼쪽 경계에 폭 손잡이가 있다', handle !== null)
      if (handle) {
        await move(handle.x, handle.y)
        await press(handle.x, handle.y)
        for (let i = 1; i <= 8; i += 1) {
          await move(handle.x + 15 * i, handle.y, true)
          await sleep(16)
        }
        await release(handle.x + 120, handle.y)
      }
      const widened = await waitFor(`(() => {
        const l = document.querySelector('[data-block-id="${cid.left}"]')?.getBoundingClientRect()
        const r = document.querySelector('[data-block-id="${cid.right}"]')?.getBoundingClientRect()
        return !!l && !!r && l.width > ${before[0].w} + 60 && r.width < ${before[1].w} - 60
      })()`, 5000)
      check('★ 손잡이를 끌면 왼쪽 컬럼이 넓어진다', widened, JSON.stringify({ before, after: [await colRect(cid.left), await colRect(cid.right)] }))
      let savedRatios = null
      for (let i = 0; i < 60; i += 1) {
        const list = (await readBody(widthPage)).doc.blocks.find((b) => b.type === 'column_list')
        savedRatios = list?.children?.map((c) => c.format?.column_ratio ?? null) ?? null
        if (savedRatios?.every((r) => typeof r === 'number')) break
        await sleep(150)
      }
      check('★ 서버 — 컬럼마다 폭(column_ratio) · 왼쪽이 크고 합이 1',
        !!savedRatios && savedRatios[0] > 0.55 && Math.abs(savedRatios[0] + savedRatios[1] - 1) < 1e-6, JSON.stringify(savedRatios))

      // ② 위 블록을 끈다 — 먼저 왼쪽 컬럼의 a 아래 빈자리(오른쪽 컬럼이 더 길어 가장 가까운 줄은 오른쪽의 b3)에서 가이드가 왼쪽 컬럼에
      //    서는지 보고(차선), 둘째 컬럼의 b 아래로 옮겨 놓는다.
      const a = await line(cid.a)
      const b3 = await line(cid.b3)
      const left = await colRect(cid.left)
      await drag(cid.top, a.x + 5, b3.y + b3.h / 2, { drop: false })
      const leftGuide = await rect('.blk-drop-guide')
      check('★ 오른쪽 컬럼이 더 길어도 가이드는 포인터 쪽 컬럼의 줄에 선다 — 왼쪽 컬럼의 a 아래(차선)',
        !!leftGuide && leftGuide.x >= left.x - 2 && leftGuide.x + leftGuide.w <= left.x + left.w + 2 && Math.abs(leftGuide.y + 1 - (a.y + a.h)) < 6,
        JSON.stringify({ leftGuide, left, a }))
      const b = await line(cid.b)
      for (let i = 1; i <= 5; i += 1) {
        await move(a.x + 5 + ((b.x - a.x) * i) / 5, b3.y + b3.h / 2 + ((b.y + b.h * 0.8 - b3.y - b3.h / 2) * i) / 5, true)
        await sleep(16)
      }
      const guide = await rect('.blk-drop-guide')
      const right = await colRect(cid.right)
      check('★ 끄는 동안 가이드가 둘째 컬럼 안에 선다(폭도 그 컬럼만큼)',
        !!guide && guide.x >= right.x - 2 && guide.x + guide.w <= right.x + right.w + 2 && Math.abs(guide.y + 1 - (b.y + b.h)) < 6,
        JSON.stringify({ guide, right, b }))
      await release(b.x + 5, b.y + b.h * 0.8)
      const [into, intoGot] = await serverIs(widthPage, [['column_list', [['column', ['왼쪽 a']], ['column', ['오른쪽 b', '위 블록', '오른쪽 b2', '오른쪽 b3']]]], '끝 블록'])
      check('★ 놓으면 그 컬럼에 들어간다', into, intoGot)

      // ③ 첫 컬럼의 마지막 블록을 끝 블록 아래로 끌어낸다 — 그 컬럼이 사라지고 하나 남은 컬럼 목록이 풀린다.
      const end = await line(cid.end)
      // 직전 끌기의 핸들이 남아 있다 — 이 블록 줄에 핸들이 맞춰진 뒤에 끈다(`drag` 는 핸들이 있기만 하면 그 자리를 읽는다).
      const aLine = await line(cid.a)
      await move(aLine.x + 30, aLine.y + aLine.h / 2)
      // a 와 b 는 같은 높이다 — 핸들이 a 의 왼쪽(컬럼 밖)에 있는지도 본다. b 로 건너가면 틈(왼쪽 컬럼의 오른쪽)에 선다.
      const gripOnA = `(() => {
        const g = document.querySelector('.blk-gutter-grip')?.getBoundingClientRect()
        return !!g && Math.abs(g.y - ${aLine.y}) < 10 && g.right <= ${aLine.x} + 2
      })()`
      check('전제 — 왼쪽 컬럼의 블록에 핸들이 선다', await waitFor(gripOnA, 3000))
      // 핸들은 컬럼 밖(왼쪽 여백)에 선다 — 그 위로 옮겨도 포인터 쪽(첫) 컬럼의 블록을 고른다. 끝 쪽 컬럼으로 건너가면 엉뚱한 블록을 끈다.
      const grip = await rect('.blk-gutter-grip')
      if (grip) await move(grip.x + grip.w / 2, grip.y + grip.h / 2)
      await sleep(150)
      check('★ 핸들 위(컬럼 밖 여백)로 옮겨도 핸들은 왼쪽 컬럼의 블록에 머문다', await waitFor(gripOnA, 1000),
        JSON.stringify({ grip: await rect('.blk-gutter-grip'), aLine }))
      await drag(cid.a, end.x + 5, end.y + end.h * 0.8)
      const [unwrapped, unwrappedGot] = await serverIs(widthPage, ['오른쪽 b', '위 블록', '오른쪽 b2', '오른쪽 b3', '끝 블록', '왼쪽 a'])
      check('★ 마지막 블록을 끌어낸 컬럼은 사라지고 · 하나 남은 컬럼 목록은 풀린다', unwrapped, unwrappedGot)

      // ④ 빈 컬럼의 빈 블록에서 Backspace — 그 컬럼을 지운다.
      const emptyPage = await newPage(`빈 컬럼 ${stamp}`)
      const e = { list: randomUUID(), c1: randomUUID(), c2: randomUUID(), c3: randomUUID(), empty: randomUUID(), x: randomUUID(), y: randomUUID() }
      await saveBody(emptyPage, { blocks: [{ id: e.list, type: 'column_list', title: [], properties: {}, format: {}, children: [
        col(e.c1, [para(e.x, '엑스')]), col(e.c2, [para(e.empty, '')]), col(e.c3, [para(e.y, '와이')]),
      ] }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${emptyPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${e.empty}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      let inEmpty = false
      for (let i = 0; i < 20 && !inEmpty; i += 1) {
        await clickSelector(`[data-block-id="${e.empty}"] p`)
        inEmpty = await waitFor(`document.querySelector('[data-block-id="${e.empty}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      check('전제 — 빈 컬럼의 빈 블록에 캐럿이 섰다', inEmpty)
      await key('Backspace')
      const [removed, removedGot] = await serverIs(emptyPage, [['column_list', [['column', ['엑스']], ['column', ['와이']]]]])
      check('★ 빈 컬럼의 빈 블록에서 Backspace — 그 컬럼이 사라진다', removed, removedGot)
      await typeText('!')
      const [caretAt, caretGot] = await serverIs(emptyPage, [['column_list', [['column', ['엑스!']], ['column', ['와이']]]]])
      check('캐럿은 앞 컬럼의 끝이다', caretAt, caretGot)
      await sleep(1000)
    }

    if (sectionIf('컬럼 — 옆에 놓아 만들기 · 경계를 넘는 선택 (Phase 2 1c-3 · F-01-12)')) {
      // 블록을 다른 블록 줄의 오른쪽 끝으로 끌면 세로 가이드가 서고, 놓으면 두 블록이 나란한 컬럼이 된다. 컬럼 안 블록의 옆에 놓으면 그
      // 목록에 컬럼이 더해진다. 첫 컬럼의 블록에서 Shift+↓ 는 옆 컬럼의 블록을 고르고(틀이 아니다), 위에서 내려오는 Shift+↓ 는 컬럼을
      // 한 줄씩 지나 목록 뒤까지 간다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const newPage = async (title) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title }) })).json()).page.id
      const s = { top: randomUUID(), one: randomUUID(), two: randomUUID(), three: randomUUID(), end: randomUUID() }
      const para = (id, text) => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })
      const sidePage = await newPage(`옆에 놓기 ${stamp}`)
      await saveBody(sidePage, { blocks: [para(s.top, '위 블록'), para(s.one, '첫 블록'), para(s.two, '둘째 블록'), para(s.three, '셋째 블록'), para(s.end, '끝 블록')] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${sidePage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${s.end}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      const serverIs = async (expected) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          const text = (b) => (b.title ?? []).map((r) => r.plain_text ?? '').join('')
          const walk = (blocks) => blocks.map((b) => (b.type === 'paragraph' ? text(b) : [b.type, walk(b.children ?? [])]))
          got = JSON.stringify(walk((await readBody(sidePage)).doc.blocks))
          if (got === JSON.stringify(expected)) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      // 직전 끌기의 핸들이 남아 있을 수 있다 — 그 블록 줄에 핸들이 맞춰진 뒤에 끈다(`drag` 는 핸들이 있기만 하면 그 자리를 읽는다).
      const gripOn = async (id) => {
        const l = await line(id)
        await move(l.x + 30, l.y + l.h / 2)
        return waitFor(`(() => {
          const g = document.querySelector('.blk-gutter-grip')?.getBoundingClientRect()
          return !!g && Math.abs(g.y - ${l.y}) < 10 && g.right <= ${l.x} + 2
        })()`, 3000)
      }
      const selectedIds = () => evaluate(`[...document.querySelectorAll('.blk-selected')].map((e) => e.getAttribute('data-block-id'))`)

      // ① 둘째 블록을 첫 블록 줄의 오른쪽 끝으로 — 세로 가이드 · 놓으면 나란한 두 컬럼.
      const one = await line(s.one)
      await gripOn(s.two)
      await drag(s.two, one.x + one.w - 10, one.y + one.h / 2, { drop: false })
      const guide = await evaluate(`(() => {
        const g = document.querySelector('.blk-drop-guide')
        if (!g) return null
        const r = g.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height, o: g.getAttribute('data-orientation') }
      })()`)
      check('★ 블록 줄의 오른쪽 끝으로 끌면 세로 가이드가 그 줄의 오른쪽에 선다(줄의 높이만큼)',
        !!guide && guide.o === 'vertical' && guide.w <= 4 && Math.abs(guide.h - one.h) < 3 && Math.abs(guide.y - one.y) < 3 && Math.abs(guide.x + 2 - (one.x + one.w)) < 4,
        JSON.stringify({ guide, one }))
      await release(one.x + one.w - 10, one.y + one.h / 2)
      const [made, madeGot] = await serverIs(['위 블록', ['column_list', [['column', ['첫 블록']], ['column', ['둘째 블록']]]], '셋째 블록', '끝 블록'])
      check('★ 놓으면 두 블록이 나란한 컬럼이 된다 — 서버', made, madeGot)
      check('화면에서도 나란히 — 둘째 블록이 첫 블록의 오른쪽 · 같은 높이', await waitFor(`(() => {
        const a = document.querySelector('[data-block-id="${s.one}"]')?.getBoundingClientRect()
        const b = document.querySelector('[data-block-id="${s.two}"]')?.getBoundingClientRect()
        return !!a && !!b && b.left > a.right && Math.abs(a.top - b.top) < 4
      })()`, 5000))

      // ② 셋째 블록을 첫 블록(첫 컬럼) 줄의 오른쪽 끝으로 — 첫 컬럼 오른쪽에 컬럼이 더해진다.
      check('전제 — 셋째 블록에 핸들이 선다', await gripOn(s.three))
      const one2 = await line(s.one)
      await drag(s.three, one2.x + one2.w - 8, one2.y + one2.h / 2)
      const [added, addedGot] = await serverIs(['위 블록', ['column_list', [['column', ['첫 블록']], ['column', ['셋째 블록']], ['column', ['둘째 블록']]]], '끝 블록'])
      check('★ 컬럼 안 블록의 옆에 놓으면 그 컬럼 오른쪽에 컬럼이 더해진다', added, addedGot)

      // ③ 첫 컬럼의 블록에서 Shift+↓ — 옆 컬럼의 블록을 고른다(컬럼 틀이 아니다). 선택은 끌어 만든 결과에 기대지 않게 같은 모양을
      //    저장해 둔 페이지에서 본다 — 앞의 끌기가 떨어져도 이 검사는 선택만 본다.
      const col = (children) => ({ id: randomUUID(), type: 'column', title: [], properties: {}, format: {}, children })
      const selectPage = await newPage(`경계를 넘는 선택 ${stamp}`)
      Object.assign(s, { top: randomUUID(), one: randomUUID(), two: randomUUID(), three: randomUUID(), end: randomUUID() })
      await saveBody(selectPage, { blocks: [
        para(s.top, '위 블록'),
        { id: randomUUID(), type: 'column_list', title: [], properties: {}, format: {}, children: [col([para(s.one, '첫 블록')]), col([para(s.three, '셋째 블록')]), col([para(s.two, '둘째 블록')])] },
        para(s.end, '끝 블록'),
      ] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${selectPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${s.end}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      let inOne = false
      for (let i = 0; i < 20 && !inOne; i += 1) {
        await clickSelector(`[data-block-id="${s.one}"] p`)
        inOne = await waitFor(`document.querySelector('[data-block-id="${s.one}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      await key('Escape')
      check('전제 — Esc 로 첫 블록이 골라졌다', await waitFor(`(() => { const ids = [...document.querySelectorAll('.blk-selected')].map((e) => e.getAttribute('data-block-id')); return ids.length === 1 && ids[0] === '${s.one}' })()`, 3000),
        JSON.stringify(await selectedIds()))
      await key('ArrowDown', SHIFT)
      await sleep(200)
      const across = await selectedIds()
      check('★ 첫 컬럼에서 Shift+↓ — 옆 컬럼의 블록이 골라진다(컬럼 틀이 아니다)', same(across, [s.one, s.three]), JSON.stringify(across))
      await key('ArrowDown', SHIFT)
      await sleep(200)
      const across2 = await selectedIds()
      check('한 번 더 — 셋째 컬럼의 블록까지', same(across2, [s.one, s.three, s.two]), JSON.stringify(across2))

      // ④ 위 블록에서 Shift+↓ 를 네 번 — 컬럼을 한 줄씩 지나 목록 뒤의 블록까지(목록은 통째로 덮이면 목록째).
      let inTop = false
      for (let i = 0; i < 20 && !inTop; i += 1) {
        await clickSelector(`[data-block-id="${s.top}"] p`)
        inTop = await waitFor(`document.querySelector('[data-block-id="${s.top}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      await key('Escape')
      await waitFor(`document.querySelectorAll('.blk-selected').length === 1`, 3000)
      for (let i = 0; i < 4; i += 1) {
        await key('ArrowDown', SHIFT)
        await sleep(150)
      }
      const down = await selectedIds()
      check('★ 위에서 Shift+↓ 네 번 — 컬럼을 지나 목록 뒤까지(위 · 컬럼 목록 · 끝)',
        down.length === 3 && down[0] === s.top && down[2] === s.end && !Object.values(s).includes(down[1]), JSON.stringify(down))
      await key('Escape')
      await sleep(1000)
    }

    if (sectionIf('심플 테이블 (Phase 2 1d-1 · F-01-18)')) {
      // 빈 줄에서 `/표` → 그 줄이 3열 × 2행의 표가 되고 캐럿은 첫 셀. Tab 으로 셀을 건너며 쓰고, 마지막 셀의 Tab 은 행을 더한다. 마지막
      // 행의 Enter 는 표를 나가 그 뒤의 새 문단으로. 셀 맨 앞의 Backspace 는 아무것도 바꾸지 않는다. 서버에는 표 → 행(셀) 이 선다.
      const stamp = Date.now()
      const tPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `심플 테이블 ${stamp}` }),
      })).json()).page.id
      const ids = { above: randomUUID(), line: randomUUID(), below: randomUUID() }
      const para = (id, text) => ({ id, type: 'paragraph', title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children: [] })
      await saveBody(tPage, { blocks: [para(ids.above, '표 위'), para(ids.line, ''), para(ids.below, '표 아래')] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${tPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${ids.below}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${ids.line}"] p`)
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && document.querySelector('[data-block-id="${ids.line}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      check('전제 — 빈 줄에 캐럿이 섰다', focused)
      const tableText = (b) => (b.title ?? []).map((r) => r.plain_text ?? '').join('')
      const serverShape = async () => {
        const walk = (blocks) => blocks.map((b) => (b.type === 'table'
          ? ['table', (b.children ?? []).map((r) => (r.properties?.cells ?? []).map((c) => c.map((run) => run.plain_text ?? '').join('')))]
          : tableText(b)))
        return JSON.stringify(walk((await readBody(tPage)).doc.blocks))
      }
      const serverIs = async (expected) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          got = await serverShape()
          if (got === JSON.stringify(expected)) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      const CELLS = `[data-block-id="${ids.line}"] .blk-table td`
      const caretCell = () => evaluate(`(() => {
        const cells = [...document.querySelectorAll('${CELLS}')]
        const at = window.getSelection()?.anchorNode
        return cells.findIndex((c) => c.contains(at ?? null))
      })()`)

      await typeText('/')
      await typeText('표')
      await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 3000)
      await key('Enter')
      check('★ /표 — 그 줄이 3열 × 2행의 표가 되고 캐럿은 첫 셀',
        (await waitFor(`document.querySelectorAll('${CELLS}').length === 6 && document.querySelectorAll('[data-block-id="${ids.line}"] .blk-table tr').length === 2`, 5000))
          && (await caretCell()) === 0,
        String(await caretCell()))

      await typeText('가1')
      await key('Tab')
      await typeText('나1')
      await key('Tab')
      await typeText('다1')
      await key('Tab')
      check('Tab — 행의 끝에서 다음 행의 첫 셀로', (await caretCell()) === 3, String(await caretCell()))
      await typeText('가2')
      const [typed, typedGot] = await serverIs(['표 위', ['table', [['가1', '나1', '다1'], ['가2', '', '']]], '표 아래'])
      check('★ 서버 — 표 → 행 둘 · 셀마다 쓴 글자', typed, typedGot)

      await key('Tab')
      await key('Tab')
      await key('Tab')
      check('★ 마지막 셀의 Tab — 행이 더해지고 그 첫 셀로',
        (await waitFor(`document.querySelectorAll('[data-block-id="${ids.line}"] .blk-table tr').length === 3`, 3000)) && (await caretCell()) === 6,
        String(await caretCell()))
      await typeText('가3')
      await key('Enter')
      check('★ 마지막 행의 Enter — 표를 나가 그 뒤의 새 줄로(셀 밖)', (await caretCell()) === -1, String(await caretCell()))
      await typeText('표 뒤')
      const [exited, exitedGot] = await serverIs(['표 위', ['table', [['가1', '나1', '다1'], ['가2', '', ''], ['가3', '', '']]], '표 뒤', '표 아래'])
      check('서버 — 셋째 행 · 표 뒤의 새 문단', exited, exitedGot)

      // 셀 맨 앞의 Backspace — 아무것도 바꾸지 않는다(셀 · 블록을 합치지 않는다). 누르기 전의 서버 모양과 견준다 — 앞 장면의 결과에
      // 기대지 않는다(화면 반사실이 Enter 와 이 키를 한 판에서 가른다).
      const beforeBackspace = await serverShape()
      const second = await rect(`${CELLS}:nth-child(2)`)
      let inSecond = false
      for (let i = 0; i < 10 && !inSecond; i += 1) {
        await click(second.x + 4, second.y + second.h / 2)
        inSecond = await waitFor(`(() => { const s = window.getSelection(); const cell = document.querySelectorAll('${CELLS}')[1]; return !!cell && cell.contains(s?.anchorNode ?? null) })()`, 500)
      }
      await key('End')
      await key('ArrowLeft')
      await key('ArrowLeft')
      await key('Backspace')
      await key('Backspace')
      let afterBackspace = beforeBackspace
      for (let i = 0; i < 20 && afterBackspace === beforeBackspace; i += 1) {
        await sleep(150)
        afterBackspace = await serverShape()
      }
      check('★ 셀 맨 앞의 Backspace 는 아무것도 바꾸지 않는다', inSecond && afterBackspace === beforeBackspace, `${beforeBackspace} → ${afterBackspace}`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${tPage}` })
      check('다시 열어도 표 — 3행 × 3열 · 쓴 글자',
        await waitFor(`(() => {
          const rows = [...document.querySelectorAll('[data-block-id="${ids.line}"] .blk-table tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
          return JSON.stringify(rows) === JSON.stringify([['가1', '나1', '다1'], ['가2', '', ''], ['가3', '', '']])
        })()`, 15000), await evaluate(`JSON.stringify([...document.querySelectorAll('[data-block-id="${ids.line}"] .blk-table tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerHTML))) + ' | ' + (document.querySelector('[data-block-id="${ids.line}"]')?.outerHTML.slice(0, 300) ?? '(없음)')`))
      await sleep(1000)
    }

    if (sectionIf('표 — 행 · 열 · 머리 (Phase 2 1d-2 · F-01-18)')) {
      // 셀 위에 포인터를 올리면 행 · 열 손잡이와 "+" 막대가 선다. 행 손잡이의 "아래에 행 넣기" · 열 손잡이의 "열 지우기" · 아래 · 오른쪽
      // "+" 가 표를 고친다. 블록 메뉴의 '표' → '머리 줄' 이 첫 행을 머리로 그린다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const gPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `표 손잡이 ${stamp}` }),
      })).json()).page.id
      const g = { table: randomUUID(), r0: randomUUID(), r1: randomUUID(), after: randomUUID() }
      const cellsRow = (id, ...texts) => ({ id, type: 'table_row', title: [], properties: { cells: texts.map((t) => (t === '' ? [] : [textRun(t)])) }, format: {}, children: [] })
      await saveBody(gPage, { blocks: [
        { id: g.table, type: 'table', title: [], properties: {}, format: {}, children: [cellsRow(g.r0, 'a', 'b'), cellsRow(g.r1, 'c', 'd')] },
        { id: g.after, type: 'paragraph', title: [textRun('표 뒤')], properties: {}, format: {}, children: [] },
      ] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${gPage}` })
      await waitFor(`document.querySelectorAll('[data-block-id="${g.table}"] .blk-table td').length === 4 && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      const gridOnServer = async () => {
        const body = await readBody(gPage)
        const t = body.doc.blocks.find((b) => b.type === 'table')
        return JSON.stringify({ props: t?.properties ?? null, grid: (t?.children ?? []).map((r) => (r.properties?.cells ?? []).map((c) => c.map((run) => run.plain_text ?? '').join(''))) })
      }
      const serverGrid = async (grid, props = {}) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          got = await gridOnServer()
          if (got === JSON.stringify({ props, grid })) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      // 포인터를 그 셀에 — 손잡이가 그 행 · 열에 설 때까지 다시 잰다. 열린 직후 머리가 늦게 그려져 표가 밀리면, 먼저 잰 자리가
      // 다른 행을 가리켜 엉뚱한 행에 넣는다(1e-1 의 전체 판에서 겪었다 — 첫 행 대신 둘째 행 아래에 들어갔다).
      const hoverCell = async (row, column) => {
        let r = null
        for (let i = 0; i < 10; i += 1) {
          r = await evaluate(`(() => {
            const tr = document.querySelectorAll('[data-block-id="${g.table}"] .blk-table tr')[${row}]
            const td = tr?.querySelectorAll('td')[${column}]
            if (!td) return null
            const b = td.getBoundingClientRect()
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
          })()`)
          if (!r) return null
          await move(r.x + 1, r.y)
          await move(r.x, r.y)
          const aligned = await waitFor(`(() => {
            const tr = document.querySelectorAll('[data-block-id="${g.table}"] .blk-table tr')[${row}]?.getBoundingClientRect()
            const td = document.querySelectorAll('[data-block-id="${g.table}"] .blk-table tr')[${row}]?.querySelectorAll('td')[${column}]?.getBoundingClientRect()
            const rh = document.querySelector('.blk-table-handle[data-axis="row"]')?.getBoundingClientRect()
            const ch = document.querySelector('.blk-table-handle[data-axis="column"]')?.getBoundingClientRect()
            if (!tr || !td || !rh || !ch) return false
            const ry = rh.y + rh.height / 2
            const cx = ch.x + ch.width / 2
            return ry >= tr.top && ry <= tr.bottom && cx >= td.left && cx <= td.right
          })()`, 1000)
          if (aligned) return r
        }
        return r
      }
      const clickControl = async (selector) => {
        const r = await rect(selector)
        if (!r) return false
        await move(r.x + r.w / 2, r.y + r.h / 2)
        await click(r.x + r.w / 2, r.y + r.h / 2)
        return true
      }
      const clickMenuItem = async (menuLabel, text) => {
        await waitFor(`!!document.querySelector('[role="menu"][aria-label="${menuLabel}"]')`, 3000)
        const r = await evaluate(`(() => {
          const item = [...document.querySelectorAll('[role="menu"][aria-label="${menuLabel}"] [role^="menuitem"]')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))
          if (!item) return null
          const b = item.getBoundingClientRect()
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        })()`)
        if (r) await click(r.x, r.y)
        return r !== null
      }

      // ① 행 손잡이 — 아래에 행 넣기.
      await hoverCell(0, 0)
      check('★ 셀 위에 포인터 — 행 · 열 손잡이와 "+" 막대가 선다',
        await waitFor(`!!document.querySelector('.blk-table-handle[data-axis="row"]') && !!document.querySelector('.blk-table-handle[data-axis="column"]') && document.querySelectorAll('.blk-table-add').length === 2`, 3000))
      await clickControl('.blk-table-handle[data-axis="row"]')
      check('행 손잡이 — 메뉴가 열린다', await clickMenuItem('행 메뉴', '아래에 행 넣기'))
      const [rowAdded, rowAddedGot] = await serverGrid([['a', 'b'], ['', ''], ['c', 'd']])
      check('★ "아래에 행 넣기" — 그 행 아래에 빈 행', rowAdded, rowAddedGot)

      // ② 열 손잡이 — 열 지우기.
      await hoverCell(0, 1)
      await waitFor(`!!document.querySelector('.blk-table-handle[data-axis="column"]')`, 3000)
      await clickControl('.blk-table-handle[data-axis="column"]')
      check('열 손잡이 — 메뉴가 열린다', await clickMenuItem('열 메뉴', '열 지우기'))
      const [colRemoved, colRemovedGot] = await serverGrid([['a'], [''], ['c']])
      check('★ "열 지우기" — 그 열이 행마다 빠진다', colRemoved, colRemovedGot)

      // ③ "+" 막대 — 끝에 행 · 열.
      await hoverCell(0, 0)
      await waitFor(`!!document.querySelector('.blk-table-add[data-edge="bottom"]')`, 3000)
      await clickControl('.blk-table-add[data-edge="bottom"]')
      await hoverCell(0, 0)
      await waitFor(`!!document.querySelector('.blk-table-add[data-edge="right"]')`, 3000)
      await clickControl('.blk-table-add[data-edge="right"]')
      const [grown, grownGot] = await serverGrid([['a', ''], ['', ''], ['c', ''], ['', '']])
      check('★ 아래 · 오른쪽 "+" — 끝에 행 · 열', grown, grownGot)

      // ④ 블록 메뉴의 '표' → '머리 줄'.
      const tableLine = await line(g.table)
      await move(tableLine.x + 30, tableLine.y + 10)
      await waitFor(`(() => { const gr = document.querySelector('.blk-gutter-grip')?.getBoundingClientRect(); return !!gr && Math.abs(gr.y - ${tableLine.y}) < 12 })()`, 3000)
      await clickSelector('.blk-gutter-grip')
      await waitFor(`!!document.querySelector('[role="menu"][aria-label="블록 메뉴"]')`, 3000)
      const tableMenu = await evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menu"][aria-label="블록 메뉴"] > .blk-menu-row > [role="menuitem"]')].find((b) => b.textContent.trim().startsWith('표'))
        if (!item) return null
        const b = item.getBoundingClientRect()
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, disabled: item.getAttribute('aria-disabled') }
      })()`)
      check('전제 — 블록 메뉴에 켜진 \'표\'', tableMenu !== null && tableMenu.disabled === 'false', JSON.stringify(tableMenu))
      if (tableMenu) await click(tableMenu.x, tableMenu.y)
      check('\'표\' 하위 메뉴의 \'머리 줄\'', await clickMenuItem('표', '머리 줄'))
      check('★ 머리 줄 — 표에 머리 표시', await waitFor(`document.querySelector('[data-block-id="${g.table}"] .blk-table')?.getAttribute('data-column-header') === 'true'`, 3000))
      // 속성만 본다 — 앞 장면(손잡이)의 결과에 기대지 않는다(화면 반사실이 두 끊기를 한 판에서 가른다).
      let headerGot = null
      for (let i = 0; i < 60 && headerGot?.has_column_header !== true; i += 1) {
        headerGot = JSON.parse(await gridOnServer()).props
        if (headerGot?.has_column_header !== true) await sleep(150)
      }
      check('★ 서버 — 표의 has_column_header', headerGot?.has_column_header === true, JSON.stringify(headerGot))
      await sleep(1000)
    }

    if (sectionIf('표 — 붙여넣기 · 검색 (Phase 2 1d-3 · F-01-18)')) {
      // 바깥(스프레드시트 · 웹)의 HTML 표를 빈 줄에 붙이면 표가 된다(`<thead>` 면 머리 줄). 셀의 글자는 검색에 걸린다. 셀 안에 글자를
      // 붙이면 그 셀의 글자가 된다. 진짜 클립보드 대신 합성 paste 이벤트를 쓴다 — 이 PC 의 헤드리스 브라우저는 클립보드를 못 쓴다(§6).
      const stamp = Date.now()
      const pPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `표 붙여넣기 ${stamp}` }),
      })).json()).page.id
      const pz = { line: randomUUID(), after: randomUUID() }
      const word = `사과${stamp}`
      await saveBody(pPage, { blocks: [
        { id: pz.line, type: 'paragraph', title: [], properties: {}, format: {}, children: [] },
        { id: pz.after, type: 'paragraph', title: [textRun('뒤')], properties: {}, format: {}, children: [] },
      ] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${pz.after}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${pz.line}"] p`)
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && document.querySelector('[data-block-id="${pz.line}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
      }
      check('전제 — 빈 줄에 캐럿이 섰다', focused)
      const paste = (data) => evaluate(`(() => {
        const dt = new DataTransfer()
        for (const [type, value] of Object.entries(${JSON.stringify(data)})) dt.setData(type, value)
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
        document.querySelector('.blk-editor').dispatchEvent(ev)
        return ev.defaultPrevented
      })()`)
      // 맨 위의 표 — `anywhere` 면 트리 어디든(셀 붙여넣기 검사는 표의 자리에 기대지 않는다 — 화면 반사실이 두 끊기를 한 판에서 가른다).
      const tableOnServer = async (anywhere = false) => {
        const all = (blocks) => blocks.flatMap((b) => [b, ...all(b.children ?? [])])
        const blocks = (await readBody(pPage)).doc.blocks
        const t = (anywhere ? all(blocks) : blocks).find((b) => b.type === 'table')
        return t ? JSON.stringify({ props: t.properties, grid: (t.children ?? []).map((r) => (r.properties?.cells ?? []).map((c) => c.map((run) => run.plain_text ?? '').join(''))) }) : null
      }
      const serverTable = async (expected, anywhere = false) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          got = await tableOnServer(anywhere)
          if (got === JSON.stringify(expected)) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }

      await paste({
        'text/html': `<meta charset="utf-8"><table><thead><tr><th>품목</th><th>수량</th></tr></thead><tbody><tr><td>${word}</td><td>3</td></tr></tbody></table>`,
        'text/plain': `품목\t수량\n${word}\t3`,
      })
      check('★ 바깥 HTML 표를 붙이면 표가 선다(머리 줄 표시)',
        await waitFor(`(() => { const t = document.querySelector('.blk-editor .blk-table'); return !!t && t.getAttribute('data-column-header') === 'true' && t.querySelectorAll('td').length === 4 })()`, 5000),
        await evaluate(`document.querySelector('.blk-editor')?.innerHTML.slice(0, 300) ?? ''`))
      const [pasted, pastedGot] = await serverTable({ props: { has_column_header: true }, grid: [['품목', '수량'], [word, '3']] })
      check('★ 서버 — 표 · 머리 플래그 · 셀', pasted, pastedGot ?? JSON.stringify((await readBody(pPage)).doc.blocks.map((b) => [b.type, (b.children ?? []).map((c) => c.type)])))

      let hit = false
      let found = null
      for (let i = 0; i < 40 && !hit; i += 1) {
        found = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(word)}`, { headers: authed })).json()
        hit = found.results?.some((r) => r.pageId === pPage) ?? false
        if (!hit) await sleep(250)
      }
      check('★ 셀의 글자로 검색하면 그 페이지가 찾힌다', hit, JSON.stringify(found?.results?.map((r) => r.pageId) ?? found))

      // 셀 안에 글자를 붙이면 그 셀의 글자다(블록을 풀어 넣지 않는다).
      const lastCell = await rect('.blk-editor .blk-table tr:nth-child(2) td:nth-child(2)')
      let inCell = false
      for (let i = 0; i < 10 && !inCell && lastCell; i += 1) {
        await click(lastCell.x + lastCell.w - 6, lastCell.y + lastCell.h / 2)
        inCell = await waitFor(`(() => { const c = document.querySelector('.blk-editor .blk-table tr:nth-child(2) td:nth-child(2)'); return !!c && c.contains(window.getSelection()?.anchorNode ?? null) })()`, 500)
      }
      // 붙인 표는 블록 선택으로 남는다 — 셀을 누른 뒤 편집기가 그 선택을 놓을 때까지 기다린다(DOM 선택은 곧바로 바뀌어도 편집기는
      // selectionchange 를 늦게 읽는다 — 기다리지 않으면 붙여넣기가 블록 선택에 간다).
      await waitFor(`!document.querySelector('.blk-editor .blk-selected')`, 3000)
      await sleep(200)
      await key('End')
      await paste({ 'text/plain': '개\n더' })
      const [inside, insideGot] = await serverTable({ props: { has_column_header: true }, grid: [['품목', '수량'], [word, '3개\n더']] }, true)
      check('★ 셀 안에 글자를 붙이면 그 셀의 글자 — 줄바꿈도 셀 안에', inCell && inside, insideGot)
      await sleep(1000)
    }

    if (sectionIf('블록 색 — / 명령 · 마지막 색 (Phase 2 1e-1 · F-01-21)')) {
      const toPlainTextOfFirst = (body) => (body.doc.blocks[0]?.title ?? []).map((r) => r.plain_text ?? '').join('')
      // 줄 끝에서 `/빨강 배경` → 그 블록 전체가 빨강 배경. 다른 줄에서 Ctrl/Cmd+Shift+H → 마지막으로 쓴 색(빨강 배경)이 그 블록에.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const cPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `블록 색 ${stamp}` }),
      })).json()).page.id
      const cz = { first: randomUUID(), second: randomUUID() }
      const para = (id, text) => ({ id, type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })
      await saveBody(cPage, { blocks: [para(cz.first, '색 줄'), para(cz.second, '다른 줄')] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${cPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${cz.second}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      const colorOnServer = async (id, want) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          const block = (await readBody(cPage)).doc.blocks.find((b) => b.id === id)
          got = block?.format?.block_color ?? null
          if (got === want) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      const caretAtEnd = async (id) => {
        let inside = false
        for (let i = 0; i < 20 && !inside; i += 1) {
          await clickSelector(`[data-block-id="${id}"] p`)
          inside = await waitFor(`document.activeElement?.classList.contains('ProseMirror') && document.querySelector('[data-block-id="${id}"]')?.contains(window.getSelection()?.anchorNode ?? null)`, 500)
        }
        await key('End')
        return inside
      }

      check('전제 — 첫 줄 끝에 캐럿', await caretAtEnd(cz.first))
      // 메뉴는 쿼리의 공백에서 닫힌다(F-01-04 의 종료 조건) — 이름은 붙여 친다(`/제목1` 과 같다).
      await typeText(' /')
      await typeText('빨강배경')
      await waitFor(`!!document.querySelector('[role="listbox"][aria-label="블록 삽입"]')`, 3000)
      await key('Enter')
      check('★ /빨강배경 — 그 블록 전체가 빨강 배경으로 그려진다',
        await waitFor(`document.querySelector('[data-block-id="${cz.first}"] > [data-block-type]')?.getAttribute('data-color') === 'red_background'`, 3000))
      const [painted, paintedGot] = await colorOnServer(cz.first, 'red_background')
      check('★ 서버 — format.block_color · 쳐 둔 /쿼리는 지워졌다', painted && toPlainTextOfFirst(await readBody(cPage)) === '색 줄 ', String(paintedGot))

      check('전제 — 둘째 줄 끝에 캐럿', await caretAtEnd(cz.second))
      await key('h', MOD | SHIFT)
      const [again, againGot] = await colorOnServer(cz.second, 'red_background')
      check('★ Ctrl/Cmd+Shift+H — 마지막으로 쓴 색이 그 블록에', again, String(againGot))
      await sleep(1000)
    }

    if (sectionIf('서식 툴바 (Phase 2 1e-2 · F-01-03 · F-01-21)')) {
      // 글자를 고르면 그 위에 툴바가 선다. 굵게 · 색(빨강)이 그 글자에만 걸리고, Ctrl/Cmd+K 로 연 입력칸에 주소를 치면 https:// 링크가
      // 걸린다. `javascript:` 는 거부한다. 캐럿만 남으면 툴바가 접힌다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const fPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `서식 툴바 ${stamp}` }),
      })).json()).page.id
      const fid = randomUUID()
      await saveBody(fPage, { blocks: [{ id: fid, type: 'paragraph', title: [textRun('굵게 링크 보통')], properties: {}, format: {}, children: [] }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${fPage}` })
      await waitFor(`!!document.querySelector('[data-block-id="${fid}"] p') && document.querySelector('.blk-editor')?.getAttribute('contenteditable') === 'true'`, 15000)
      const TOOLBAR = '[role="toolbar"][aria-label="서식"]'
      let focused = false
      for (let i = 0; i < 20 && !focused; i += 1) {
        await clickSelector(`[data-block-id="${fid}"] p`)
        focused = await waitFor(`document.activeElement?.classList.contains('ProseMirror')`, 500)
      }
      check('전제 — 편집기에 캐럿', focused)
      /** 문단의 글자 [from, to) 를 고른다 — 브라우저의 선택을 바꾸면 편집기가 selectionchange 로 읽는다. */
      const selectText = (from, to) => evaluate(`(() => {
        const p = document.querySelector('[data-block-id="${fid}"] p')
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        let at = 0, start = null, end = null
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const len = n.textContent.length
          if (start === null && ${from} <= at + len) start = [n, ${from} - at]
          if (end === null && ${to} <= at + len) end = [n, ${to} - at]
          at += len
        }
        if (!start || !end) return false
        window.getSelection().setBaseAndExtent(start[0], start[1], end[0], end[1])
        return true
      })()`)
      const runsOnServer = async () => ((await readBody(fPage)).doc.blocks[0]?.title ?? [])
        .map((r) => ({ t: r.plain_text, b: r.annotations?.bold === true, c: r.annotations?.color ?? 'default', l: r.text?.link?.url ?? null }))
      const serverRuns = async (pred) => {
        let got = null
        for (let i = 0; i < 60; i += 1) {
          got = await runsOnServer()
          if (pred(got)) return [true, got]
          await sleep(150)
        }
        return [false, got]
      }
      const clickInToolbar = async (selector) => {
        const r = await rect(`${TOOLBAR} ${selector}`)
        if (!r) return false
        await click(r.x + r.w / 2, r.y + r.h / 2)
        return true
      }

      await selectText(0, 2)
      check('★ 글자를 고르면 서식 툴바가 선다', await waitFor(`!!document.querySelector('${TOOLBAR}')`, 3000))
      await clickInToolbar('button[aria-label="굵게"]')
      const [bold, boldGot] = await serverRuns((runs) => runs.some((r) => r.t === '굵게' && r.b))
      check('★ 굵게 — 고른 글자만 굵다(서버)', bold && !boldGot.some((r) => r.t.includes('보통') && r.b), JSON.stringify(boldGot))
      check('굵게 버튼이 눌린 상태로 보인다', await waitFor(`document.querySelector('${TOOLBAR} button[aria-label="굵게"]')?.getAttribute('aria-pressed') === 'true'`, 3000))

      await clickInToolbar('button[aria-label="색"]')
      await waitFor(`!!document.querySelector('${TOOLBAR} [role="menu"][aria-label="색"]')`, 3000)
      await clickInToolbar('[role="menuitemradio"][aria-label="빨강"]')
      // 색만 본다 — 굵게의 결과에 기대지 않는다(화면 반사실이 두 끊기를 한 판에서 가른다).
      const [red, redGot] = await serverRuns((runs) => runs.some((r) => r.t === '굵게' && r.c === 'red'))
      check('★ 색 → 빨강 — 그 글자만(인라인 · 블록 색이 아니다)', red && (await readBody(fPage)).doc.blocks[0]?.format?.block_color === undefined, JSON.stringify(redGot))

      await selectText(3, 5)
      await waitFor(`!!document.querySelector('${TOOLBAR}')`, 3000)
      await key('k', MOD)
      check('★ Ctrl/Cmd+K — 툴바의 링크 입력칸이 열린다', await waitFor(`document.activeElement?.getAttribute('aria-label') === '링크 주소'`, 3000))
      await typeText('javascript:alert(1)')
      await key('Enter')
      check('★ javascript: 주소는 거부하고 이유를 말한다', await waitFor(`(document.querySelector('${TOOLBAR} [role="alert"]')?.textContent ?? '').includes('http')`, 3000))
      await evaluate(`(() => { const i = document.activeElement; if (i instanceof HTMLInputElement) i.value = '' })()`)
      await typeText('example.com/doc')
      await key('Enter')
      const [linked, linkedGot] = await serverRuns((runs) => runs.some((r) => r.t === '링크' && r.l === 'https://example.com/doc'))
      check('★ 주소를 넣고 Enter — https:// 를 붙여 그 글자에 링크(서버)', linked && !linkedGot.some((r) => r.l?.startsWith('javascript')), JSON.stringify(linkedGot))

      await clickSelector(`[data-block-id="${fid}"] p`)
      await key('End')
      check('캐럿만 남으면 툴바가 접힌다', await waitFor(`!document.querySelector('${TOOLBAR}')`, 3000))
      await sleep(1000)
    }

    if (sectionIf('링크 소독 (보안 · F-01-03)')) {
      // 저장 계약은 링크 주소의 길이만 본다 — API · 협업 참여자는 `javascript:` 링크를 쓸 수 있다. 편집기는 그런 주소에 href 를 달지
      // 않는다(누르면 그 사람의 세션으로 스크립트가 돈다). 받는 주소는 그대로 링크다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const lPage = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, {
        method: 'POST', headers: authed, body: JSON.stringify({ title: `링크 소독 ${stamp}` }),
      })).json()).page.id
      const linkRun = (text, url) => ({ ...textRun(text), href: url, text: { content: text, link: { url } } })
      const lid = randomUUID()
      const saved = await saveBody(lPage, { blocks: [{ id: lid, type: 'paragraph', title: [linkRun('안전', 'https://example.com/a'), textRun(' · '), linkRun('위험', 'javascript:alert(1)')], properties: {}, format: {}, children: [] }] })
      check('전제 — 저장 계약은 javascript: 링크를 받는다(길이만 본다)', saved?.ok !== false)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${lPage}` })
      await waitFor(`document.querySelectorAll('[data-block-id="${lid}"] a').length === 2`, 15000)
      const anchors = await evaluate(`[...document.querySelectorAll('[data-block-id="${lid}"] a')].map((a) => ({ t: a.textContent, href: a.getAttribute('href'), unsafe: a.getAttribute('data-unsafe-href') }))`)
      check('★ 받는 주소는 링크 — href 그대로', anchors[0]?.t === '안전' && anchors[0]?.href === 'https://example.com/a', JSON.stringify(anchors))
      check('★ javascript: 링크에는 href 가 없다 — 글자는 남는다', anchors[1]?.t === '위험' && anchors[1]?.href === null && anchors[1]?.unsafe === 'true', JSON.stringify(anchors))
      await sleep(500)
    }

    if (sectionIf('고유 ID (2a-1 · F-03-09)')) {
      // ID 속성을 더하면 있던 행이 만든 순서대로 번호를 받고, 그 뒤의 행은 다음 번호다. 표의 칸은 `접두사-번호` 를 그리고 읽기
      // 전용이다(Enter 로 편집이 열리지 않는다). 접두사를 바꾸면 표시가 따라온다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `ID 표 ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const titleCell = (text) => ({ propertyId: titleProp, value: { type: 'title', title: [textRun(text)] } })
      await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell('첫 행')] })
      await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell('둘째 행')] })

      const added = await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: 'ID', type: 'unique_id', prefix: 'tk' })
      check('★ ID 속성을 더한다 — 201 · 접두사는 대문자로', added.status === 201 && added.body?.property?.type === 'unique_id' && added.body?.property?.prefix === 'TK',
        JSON.stringify({ status: added.status, property: added.body?.property }))
      const idProp = added.body?.property?.id
      const second = await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '둘째 ID', type: 'unique_id' })
      check('ID 속성은 표에 하나뿐이다 — 409 unique_id_exists', second.status === 409 && second.body?.error === 'unique_id_exists', JSON.stringify(second))
      const badPrefix = await api('PATCH', `/data-sources/${db.dataSourceId}/properties/${idProp}`, { prefix: 'TA-SK' })
      check('틀린 접두사는 400 invalid_config', badPrefix.status === 400 && badPrefix.body?.error === 'invalid_config', JSON.stringify(badPrefix))
      const third = await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell('셋째 행')] })
      check('★ 그 뒤로 만든 행은 다음 번호를 받는다 — 응답에 실린다', third.body?.row?.uniqueSeq === 3, JSON.stringify(third.body?.row))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      const ids = () => evaluate(`[...document.querySelectorAll('[data-testid="db-unique-id"]')].map((e) => e.textContent)`)
      await waitFor(`document.querySelectorAll('[data-testid="db-unique-id"]').length === 3`, 15000)
      check('★ 표의 칸은 접두사-번호 — 있던 행은 만든 순서대로', JSON.stringify(await ids()) === JSON.stringify(['TK-1', 'TK-2', 'TK-3']), JSON.stringify(await ids()))
      const cell = `td[data-property-id="${idProp}"]`
      check('ID 칸은 읽기 전용이다(aria-readonly)', await evaluate(`document.querySelector('${cell}')?.getAttribute('aria-readonly') === 'true'`))
      const box = await rect(cell)
      if (box) {
        await click(box.x + box.w / 2, box.y + box.h / 2)
        await waitFor(`document.querySelector('${cell}')?.getAttribute('aria-selected') === 'true'`, 5000)
        await key('Enter')
        await sleep(300)
        check('★ ID 칸에서 Enter 를 눌러도 편집이 열리지 않는다 — 고를 수만 있다',
          await evaluate(`!document.querySelector('[data-testid="db-cell-input"]') && !document.querySelector('td[data-editing]') && document.querySelector('${cell}')?.getAttribute('aria-selected') === 'true'`))
      } else check('ID 칸을 찾는다', false)

      const renamed = await api('PATCH', `/data-sources/${db.dataSourceId}/properties/${idProp}`, { prefix: 'bug' })
      check('접두사를 바꾼다 — 200', renamed.status === 200, String(renamed.status))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-unique-id"]').length === 3 && document.querySelector('[data-testid="db-unique-id"]')?.textContent === 'BUG-1'`, 15000)
      check('★ 접두사를 바꾸면 표시가 따라온다 — 번호는 그대로', JSON.stringify(await ids()) === JSON.stringify(['BUG-1', 'BUG-2', 'BUG-3']), JSON.stringify(await ids()))
      await sleep(500)
    }

    if (sectionIf('행 동시 추가 (F-03-16)')) {
      // 같은 표에 행을 동시에 여럿 더해도 모두 201 이다 — 전에는 형제의 마지막 키를 잠금 없이 읽어 한쪽이 500 이었다(HANDOFF §3.3-301).
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `동시 표 ${stamp}` })).body.database
      const made = await Promise.all([1, 2, 3, 4, 5, 6].map(() => api('POST', `/views/${db.defaultViewId}/rows`, {})))
      check('★ 같은 표에 동시에 행 여섯 — 모두 201', made.every((r) => r.status === 201), JSON.stringify(made.map((r) => r.status)))
      const rows = (await api('GET', `/views/${db.defaultViewId}/rows`)).body?.rows ?? []
      check('여섯 행이 모두 표에 있다', rows.length === 6 && new Set(rows.map((r) => r.id)).size === 6, String(rows.length))
    }

    if (sectionIf('고유 ID 화면 (2a-2 · F-03-09)')) {
      // 속성 추가 폼에서 ID 를 만들고(접두사 · 틀린 접두사는 이유를 말한다) · 머리 메뉴에서 접두사를 바꾸고 · 정렬하고 · 도구줄
      // 필터로 번호를 거른다(`TASK-12` 처럼 보이는 그대로 쳐도 된다). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const ids = () => evaluate(`[...document.querySelectorAll('[data-testid="db-unique-id"]')].map((e) => e.textContent)`)
      const idsAre = (expected, ms = 10000) =>
        waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-unique-id"]')].map((e) => e.textContent)) === ${JSON.stringify(JSON.stringify(expected))}`, ms)

      const db = (await api('POST', '/databases', { name: `ID 화면 ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      for (const t of ['가', '나', '다']) {
        await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }] })
      }
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 3`, 15000)

      // ── 속성 추가 폼 ──
      await clickOn('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await typeText('번호')
      await setSelect('select[aria-label="속성 유형"]', 'unique_id')
      check('★ 유형에서 ID 를 고르면 접두사 칸이 선다', await waitFor(`!!document.querySelector('[data-testid="db-unique-id-prefix"]')`, 3000))
      await clickOn('[data-testid="db-unique-id-prefix"]')
      await typeText('t-k')
      await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
      check('틀린 접두사는 이유를 말하고 폼이 남는다 — 아무것도 만들지 않는다',
        await waitFor(`[...document.querySelectorAll('[data-testid="db-add-column-form"] [role="alert"]')].some((e) => e.textContent.includes('영숫자 2~7자'))`, 5000)
          && (await evaluate(`![...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].some((th) => th.textContent.includes('번호'))`)))
      await evaluate(`document.querySelector('[data-testid="db-unique-id-prefix"]').select()`)
      await typeText('tk')
      await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
      check('★ 만들면 있던 행이 만든 순서대로 번호를 받아 보인다 — 접두사는 대문자로',
        (await waitFor(`!document.querySelector('[data-testid="db-add-column-form"]')`, 8000)) && (await idsAre(['TK-1', 'TK-2', 'TK-3'])),
        JSON.stringify(await ids()))
      const idProp = await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].find((th) => th.textContent.includes('번호'))?.dataset.propertyId ?? null`)

      await clickOn('[data-testid="db-add-column"]')
      check('ID 가 이미 있으면 유형 목록에 ID 가 서지 않는다 — 표에 하나다',
        await waitFor(`!!document.querySelector('select[aria-label="속성 유형"]') && !document.querySelector('select[aria-label="속성 유형"] option[value="unique_id"]')`, 3000))
      await clickOn('[data-testid="db-add-column"]')

      // ── 머리 메뉴: 접두사 · 정렬 ──
      await clickOn(`th[data-property-id="${idProp}"] [data-testid="db-column-menu"]`)
      check('★ ID 머리 메뉴에 접두사 바꾸기와 정렬이 선다',
        await waitFor(`!!document.querySelector('[data-testid="db-column-prefix"]') && !!document.querySelector('[data-testid="db-column-sort-desc"]')`, 3000))
      await clickOn('[data-testid="db-column-prefix"]')
      check('접두사 칸은 지금 접두사로 연다', await waitFor(`document.activeElement?.getAttribute('aria-label') === 'ID 접두사' && document.activeElement.value === 'TK'`, 3000))
      await evaluate(`document.activeElement.select()`)
      await typeText('bug')
      await clickOn('[data-testid="db-column-prefix-save"]')
      check('★ 접두사를 바꾸면 표시가 따라온다 — 번호는 그대로', await idsAre(['BUG-1', 'BUG-2', 'BUG-3']), JSON.stringify(await ids()))

      await clickOn(`th[data-property-id="${idProp}"] [data-testid="db-column-menu"]`)
      await waitFor(`!!document.querySelector('[data-testid="db-column-sort-desc"]')`, 3000)
      await clickOn('[data-testid="db-column-sort-desc"]')
      check('★ 머리 메뉴의 내림차순 — 큰 번호가 위', await idsAre(['BUG-3', 'BUG-2', 'BUG-1']), JSON.stringify(await ids()))
      check('★ 정렬 칩이 선다 — 셀 컬럼만 보던 때는 ID 정렬이 도구줄에서 사라졌다',
        await waitFor(`[...document.querySelectorAll('[data-testid="db-sort-chip"]')].some((e) => e.textContent.includes('번호'))`, 5000),
        await evaluate(`[...document.querySelectorAll('[data-testid="db-sort-chip"]')].map((e) => e.textContent).join(' | ')`))

      // ── 도구줄 필터 ──
      await clickOn('[data-testid="db-filter-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-filter-panel"]')`, 3000)
      await clickOn('[data-testid="db-filter-add"]')
      await waitFor(`document.querySelectorAll('[data-testid="db-filter-rule"]').length === 1`, 3000)
      check('★ 필터 속성 목록에 ID 가 있다', await evaluate(`!!document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 속성"] option[value="${idProp}"]')`))
      await setSelect('[data-testid="db-filter-rule"] select[aria-label="필터 속성"]', idProp)
      await waitFor(`!!document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 조건"] option[value="greater_than"]')`, 3000)
      await setSelect('[data-testid="db-filter-rule"] select[aria-label="필터 조건"]', 'greater_than')
      await clickOn('[data-testid="db-filter-rule"] input[data-testid="db-filter-value"]')
      await typeText('BUG-1')
      await key('Enter')
      check('★ 보이는 그대로 `BUG-1` 을 쳐도 번호로 거른다 — 1 보다 큰 둘이 남는다', await idsAre(['BUG-3', 'BUG-2']), JSON.stringify(await ids()))
      check('필터 칩이 조건을 말한다 — 번호 · 초과 · 1',
        await waitFor(`[...document.querySelectorAll('[data-testid="db-filter-chip"]')].some((e) => e.textContent === '번호 · 초과 · 1')`, 5000),
        await evaluate(`[...document.querySelectorAll('[data-testid="db-filter-chip"]')].map((e) => e.textContent).join(' | ')`))
      await sleep(500)
    }

    if (sectionIf('고유 ID 내보내기 · 행 페이지 (2a-2b · F-03-09 · F-09-14)')) {
      // 행 페이지의 속성 묶음에 ID 가 보이고, 표를 내보낸 ZIP 의 CSV · 행 Markdown 에 보이는 그대로(`TK-1`) 들어간다. ZIP 은 우리가 짜지
      // 않은 구현(python zipfile)으로 읽는다(§3.3-63). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const name = `ID 내보내기 ${stamp}`
      const db = (await api('POST', '/databases', { name })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const rowIds = []
      for (const t of ['첫 이슈', '둘째 이슈']) {
        rowIds.push((await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }] })).body.row.id)
      }
      await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '번호', type: 'unique_id', prefix: 'tk' })

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${rowIds[1]}` })
      check('★ 행 페이지의 속성 묶음에 ID 가 보인다 — 읽기 전용 칸',
        await waitFor(`[...document.querySelectorAll('[data-testid="db-unique-id"]')].some((e) => e.textContent === 'TK-2')`, 15000),
        await evaluate(`[...document.querySelectorAll('[data-testid="db-unique-id"]')].map((e) => e.textContent).join(' | ') || '(없음)'`))

      const zipRes = await fetch(`${BASE}/api/workspaces/${workspaceId}/export?root=${db.id}`, { headers: authed })
      check('표를 내보낸다 — 200', zipRes.status === 200, String(zipRes.status))
      const dir = mkdtempSync(join(tmpdir(), 'nc-e2e-uid-export-'))
      try {
        const file = join(dir, 'export.zip')
        writeFileSync(file, Buffer.from(await zipRes.arrayBuffer()))
        const { findPython, runPythonJson } = await import(new URL('../src/lib/testing/external-tools.ts', import.meta.url).href)
        const python = findPython()
        const zip = python === null
          ? { names: [], texts: {}, error: 'python 을 찾지 못했다' }
          : runPythonJson(python, [
              'import sys, json, zipfile',
              'z = zipfile.ZipFile(sys.argv[1])',
              "print(json.dumps({'names': z.namelist(), 'texts': {n: z.read(n).decode('utf-8') for n in z.namelist() if n.endswith(('.md', '.csv'))}}))",
            ].join('\n'), [file])
        const texts = zip.texts ?? {}
        const csv = Object.entries(texts).find(([n]) => n.endsWith('.csv'))?.[1] ?? ''
        check('★ CSV 에 ID 열과 보이는 그대로의 값', csv.includes('번호') && csv.includes('첫 이슈,TK-1') && csv.includes('둘째 이슈,TK-2'), JSON.stringify(csv.slice(0, 200)))
        const rowMd = Object.entries(texts).find(([n, t]) => n.endsWith('.md') && t.includes('둘째 이슈'))?.[1] ?? ''
        check('★ 행 Markdown 의 속성 줄에도 — **번호**: TK-2', rowMd.includes('**번호**: TK-2'), JSON.stringify(rowMd.slice(0, 200)))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    if (sectionIf('하위 항목 — 서버 (2b-1 · F-03-18)')) {
      // 켜기 · 끄기 · 연결의 순환 거부 · 짝을 따로 지우기 거부를 실제 경로로 본다(규칙은 `sub-items.db.test.ts`). 화면은 2b-2.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `하위 항목 ${stamp}` })).body.database
      const on = await api('POST', `/data-sources/${db.dataSourceId}/sub-items`)
      check('★ 하위 항목을 켜면 상위 항목 · 하위 항목 짝이 생긴다', on.status === 200 && on.body?.schema?.properties?.some((p) => p.name === '상위 항목') && on.body?.schema?.properties?.some((p) => p.name === '하위 항목'),
        JSON.stringify({ status: on.status, names: on.body?.schema?.properties?.map((p) => p.name) }))
      const again = await api('POST', `/data-sources/${db.dataSourceId}/sub-items`)
      check('두 번 켜도 같은 짝이다', again.status === 200 && again.body?.parentPropertyId === on.body?.parentPropertyId)
      const [a, b] = [(await api('POST', `/views/${db.defaultViewId}/rows`, {})).body.row.id, (await api('POST', `/views/${db.defaultViewId}/rows`, {})).body.row.id]
      const link = (row, propertyId, add) => api('POST', `/rows/${row}/relations/${propertyId}`, { add })
      check('부모를 둔다 — 200', (await link(a, on.body.parentPropertyId, [b])).status === 200)
      const cycle = await link(b, on.body.parentPropertyId, [a])
      check('★ 자기 하위 항목을 부모로 두면 400 — 이유를 말한다', cycle.status === 400 && JSON.stringify(cycle.body).includes('상위 항목으로 둘 수 없습니다'), JSON.stringify(cycle))
      const remove = await api('DELETE', `/data-sources/${db.dataSourceId}/properties/${on.body.childrenPropertyId}`)
      check('짝의 한쪽을 따로 지우면 409 managed_property', remove.status === 409 && remove.body?.error === 'managed_property', JSON.stringify(remove))
      const off = await api('DELETE', `/data-sources/${db.dataSourceId}/sub-items`)
      check('★ 끄면 일반 relation 으로 남는다', off.status === 200 && off.body?.schema?.properties?.filter((p) => p.type === 'relation').length === 2, JSON.stringify({ status: off.status }))
    }

    if (sectionIf('하위 항목 화면 — 트리 (2b-2a · F-03-18)')) {
      // 도구줄 "속성" 패널의 스위치로 켜고, 표가 최상위 행만 그리다 토글을 펴면 자식을 들여 끼우는지(손자까지) · 접으면 빠지는지 ·
      // 끄면 평평한 표로 돌아오는지 본다. 연결은 API 로 만든다(연결 편집기는 relation 의 것 그대로다). 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      // 도구줄 "속성" 패널의 스위치를 원하는 상태로 — 패널이 닫혀 있으면 열고, 누른 뒤 상태가 바뀌지 않았으면(팝오버가 자리를 잡기 전에
      // 눌러 빗나갔다) 다시 누른다. 켠 뒤에도 패널은 열려 있다 — 버튼을 다시 누르면 닫힌다.
      const setSwitch = async (testId, want) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!(await evaluate(`!!document.querySelector('[data-testid="${testId}"]')`))) await clickOn('[data-testid="db-properties-button"]')
          await waitFor(`!!document.querySelector('[data-testid="${testId}"]') && !document.querySelector('[data-testid="${testId}"]').disabled`, 3000)
          if ((await evaluate(`document.querySelector('[data-testid="${testId}"]')?.checked === true`)) === want) return true
          await clickOn(`[data-testid="${testId}"]`)
          if (await waitFor(`document.querySelector('[data-testid="${testId}"]')?.checked === ${want}`, 5000)) return true
        }
        return false
      }
      const shown = () => evaluate(`[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) =>
        (tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '') + ':' + (tr.dataset.depth ?? '-'))`)
      const shownIs = (expected, ms = 10000) => waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) =>
        (tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '') + ':' + (tr.dataset.depth ?? '-'))) === ${JSON.stringify(JSON.stringify(expected))}`, ms)

      const db = (await api('POST', '/databases', { name: `하위 항목 화면 ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const ids = {}
      for (const t of ['가', '나', '다', '라']) {
        ids[t] = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }] })).body.row.id
      }
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 4`, 15000)

      await setSwitch('db-subitems-switch', true)
      check('★ 도구줄의 "하위 항목"을 켜면 상위 항목 · 하위 항목 속성이 머리에 선다',
        await waitFor(`(() => { const t = [...document.querySelectorAll('[data-testid="db-table"] thead th')].map((th) => th.textContent).join('|')
          return t.includes('상위 항목') && t.includes('하위 항목') })()`, 10000))

      const parentProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'relation' && c.relation.subItems === 'parent')?.propertyId
      for (const [child, parent] of [['나', '가'], ['다', '가'], ['라', '나']]) {
        await api('POST', `/rows/${ids[child]}/relations/${parentProp}`, { add: [ids[parent]] })
      }
      await send('Page.reload')
      check('★ 최상위 행만 보인다 — 자식은 부모 밑에 숨는다', await shownIs(['가:0']), JSON.stringify(await shown()))
      check('자식이 있는 행에 펼치기 토글이 선다', await evaluate(`!!document.querySelector('tr[data-row-id="${ids['가']}"] [data-testid="db-subitem-toggle"][aria-expanded="false"]')`))

      await clickOn(`tr[data-row-id="${ids['가']}"] [data-testid="db-subitem-toggle"]`)
      check('★ 펼치면 자식이 바로 아래에 한 단계 들여 선다', await shownIs(['가:0', '나:1', '다:1']), JSON.stringify(await shown()))
      check('자식이 없는 행에는 토글이 없다', await evaluate(`!document.querySelector('tr[data-row-id="${ids['다']}"] [data-testid="db-subitem-toggle"]')`))
      await clickOn(`tr[data-row-id="${ids['나']}"] [data-testid="db-subitem-toggle"]`)
      check('★ 손자도 — 그 부모 바로 아래에 두 단계', await shownIs(['가:0', '나:1', '라:2', '다:1']), JSON.stringify(await shown()))
      const indent = await evaluate(`(() => {
        const left = (id) => document.querySelector('tr[data-row-id="' + id + '"] [data-testid="db-row-title"]')?.getBoundingClientRect().left ?? 0
        return [left('${ids['가']}'), left('${ids['나']}'), left('${ids['라']}')]
      })()`)
      check('들여쓰기가 화면에 보인다 — 깊을수록 오른쪽', indent[0] < indent[1] && indent[1] < indent[2], JSON.stringify(indent))
      await clickOn(`tr[data-row-id="${ids['가']}"] [data-testid="db-subitem-toggle"]`)
      check('★ 접으면 자식 · 손자가 함께 빠진다', await shownIs(['가:0']), JSON.stringify(await shown()))

      await setSwitch('db-subitems-switch', false)
      check('★ 끄면 평평한 표로 돌아온다 — 네 행 · 토글 없음',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 4 && !document.querySelector('[data-testid="db-subitem-toggle"]')`, 10000),
        JSON.stringify(await shown()))
    }

    if (sectionIf('하위 항목 + (2b-2b · F-03-18)')) {
      // 제목 칸에 마우스를 올리면 서는 `+` 로 부모 밑에 바로 만든다 — 접혀 있던 부모가 펴지고, 새 행이 한 단계 들여 서며 제목을 바로
      // 편집한다. 서버에서도 그 행의 부모가 그 행이다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `하위 항목 + ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const parent = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun('부모')] } }] })).body.row.id
      const on = (await api('POST', `/data-sources/${db.dataSourceId}/sub-items`)).body
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('tr[data-row-id="${parent}"] [data-testid="db-subitem-add"]')`, 15000)
      const shown = () => evaluate(`[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) =>
        (tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '') + ':' + (tr.dataset.depth ?? '-'))`)

      const box = await rect(`tr[data-row-id="${parent}"] [data-testid="db-subitem-add"]`)
      await move(box.x + box.w / 2, box.y + box.h / 2)
      await click(box.x + box.w / 2, box.y + box.h / 2)
      check('★ 하위 항목 + — 부모가 펴지고 새 행이 한 단계 들여 서며 제목을 바로 편집한다',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2
          && document.querySelectorAll('[data-testid="db-table"] tbody tr')[1].dataset.depth === '1'
          && document.activeElement?.matches('[data-testid="db-cell-input"]')`, 10000),
        JSON.stringify(await shown()))
      await typeText('새 자식')
      await key('Enter')
      check('제목이 저장되어 부모 밑에 선다', await waitFor(`JSON.stringify([...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) =>
        (tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '') + ':' + (tr.dataset.depth ?? '-'))) === ${JSON.stringify(JSON.stringify(['부모:0', '새 자식:1']))}`, 10000),
        JSON.stringify(await shown()))
      const childId = await evaluate(`document.querySelectorAll('[data-testid="db-table"] tbody tr')[1]?.dataset.rowId ?? null`)
      const stored = (await api('GET', `/rows/${childId}/relations/${on.parentPropertyId}`)).body
      check('★ 서버에서도 그 행의 부모가 그 행이다 — 만들기와 연결이 함께 저장됐다', stored?.items?.[0]?.id === parent, JSON.stringify(stored?.items))
      await send('Page.reload')
      check('새로 열어도 최상위는 부모 하나다', await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1`, 15000), JSON.stringify(await shown()))
    }

    if (sectionIf('종속 관계 (2b-3 · F-03-18)')) {
      // 도구줄 "속성" 패널의 스위치로 켜면 선행 작업 · 후행 작업 속성이 서고, 서로를 막는 순환은 이유와 함께 거부되며, 끄면 일반
      // 관계형으로 남는다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      // 도구줄 "속성" 패널의 스위치를 원하는 상태로 — 패널이 닫혀 있으면 열고, 누른 뒤 상태가 바뀌지 않았으면(팝오버가 자리를 잡기 전에
      // 눌러 빗나갔다) 다시 누른다. 켠 뒤에도 패널은 열려 있다 — 버튼을 다시 누르면 닫힌다.
      const setSwitch = async (testId, want) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!(await evaluate(`!!document.querySelector('[data-testid="${testId}"]')`))) await clickOn('[data-testid="db-properties-button"]')
          await waitFor(`!!document.querySelector('[data-testid="${testId}"]') && !document.querySelector('[data-testid="${testId}"]').disabled`, 3000)
          if ((await evaluate(`document.querySelector('[data-testid="${testId}"]')?.checked === true`)) === want) return true
          await clickOn(`[data-testid="${testId}"]`)
          if (await waitFor(`document.querySelector('[data-testid="${testId}"]')?.checked === ${want}`, 5000)) return true
        }
        return false
      }
      const heads = () => evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th')].map((th) => th.textContent).join('|')`)
      const db = (await api('POST', '/databases', { name: `종속 관계 ${stamp}` })).body.database
      const [a, b] = [(await api('POST', `/views/${db.defaultViewId}/rows`, {})).body.row.id, (await api('POST', `/views/${db.defaultViewId}/rows`, {})).body.row.id]
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)

      check('종속 관계 스위치가 켜진 상태로 선다', await setSwitch('db-dependencies-switch', true))
      check('★ 도구줄의 "종속 관계"를 켜면 선행 작업 · 후행 작업 속성이 머리에 선다',
        await waitFor(`(() => { const t = [...document.querySelectorAll('[data-testid="db-table"] thead th')].map((th) => th.textContent).join('|')
          return t.includes('선행 작업') && t.includes('후행 작업') })()`, 10000), await heads())
      const blockedBy = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'relation' && c.relation.dependencies === 'blocked_by')?.propertyId
      check('선행 작업을 둔다 — 200', (await api('POST', `/rows/${a}/relations/${blockedBy}`, { add: [b] })).status === 200)
      const cycle = await api('POST', `/rows/${b}/relations/${blockedBy}`, { add: [a] })
      check('★ 서로를 막으면 400 — 순환이라고 말한다', cycle.status === 400 && JSON.stringify(cycle.body).includes('순환'), JSON.stringify(cycle))

      check('종속 관계 스위치가 꺼진 상태로 선다', await setSwitch('db-dependencies-switch', false))
      const off = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.filter((c) => c.type === 'relation')
      check('★ 끄면 일반 관계형으로 남는다 — 속성 둘은 그대로 · 표시는 없다', off.length === 2 && off.every((c) => c.relation.dependencies === null), JSON.stringify(off.map((c) => c.relation)))
    }

    if (sectionIf('속성 타입 바꾸기 — 서버 (2c-1 · F-03-14)')) {
      // 값이 사라지는 칸이 있으면 409 와 개수 · 확인을 실으면 바뀐다 · 표가 새 타입의 값을 준다 · 제목은 400. 규칙은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `타입 바꾸기 ${stamp}` })).body.database
      const memo = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '수량', type: 'rich_text' })).body.property.id
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      for (const text of ['12', '약 3']) {
        await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: memo, value: { type: 'rich_text', rich_text: [textRun(text)] } }] })
      }
      const convert = (body) => api('POST', `/data-sources/${db.dataSourceId}/properties/${memo}/convert`, body)
      const lossy = await convert({ type: 'number' })
      check('★ 값이 사라지는 칸이 있으면 409 — 그 개수를 말한다', lossy.status === 409 && lossy.body?.error === 'lossy_conversion' && lossy.body?.lost === 1, JSON.stringify(lossy))
      const done = await convert({ type: 'number', confirmLoss: true })
      check('★ 확인을 실으면 바뀐다 — 옮긴 칸 · 사라진 칸을 말한다', done.status === 200 && done.body?.converted === 1 && done.body?.lost === 1, JSON.stringify(done.body && { converted: done.body.converted, lost: done.body.lost }))
      const rows = (await api('GET', `/views/${db.defaultViewId}/rows`)).body.rows
      const values = rows.map((r) => r.properties[memo]).filter(Boolean)
      check('표가 새 타입의 값을 준다', values.length === 1 && values[0].type === 'number' && values[0].number === 12, JSON.stringify(values))
      const title = await api('POST', `/data-sources/${db.dataSourceId}/properties/${titleProp}/convert`, { type: 'rich_text' })
      check('제목은 바꿀 수 없다 — 400', title.status === 400 && title.body?.error === 'title_immutable', JSON.stringify(title))
    }

    if (sectionIf('속성 타입 바꾸기 — 화면 (2c-2 · F-03-14)')) {
      // 머리 메뉴의 "유형 바꾸기" — 값이 사라지는 칸이 있으면 개수와 함께 한 번 더 묻고, 확인하면 바뀌어 칸이 새 타입으로 그려진다.
      // 손실이 없으면 묻지 않고 바뀐다. 자기 데이터를 스스로 만든다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const db = (await api('POST', '/databases', { name: `타입 바꾸기 화면 ${stamp}` })).body.database
      const memo = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '수량', type: 'rich_text' })).body.property.id
      for (const text of ['12', '약 3']) {
        await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: memo, value: { type: 'rich_text', rich_text: [textRun(text)] } }] })
      }
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)
      const header = () => evaluate(`document.querySelector('th[data-property-id="${memo}"]')?.textContent ?? ''`)
      // 행의 칸만 — 표 아래 집계 줄(`tfoot` · 2d-2)의 칸도 같은 `data-property-id` 를 단다.
      const cellsOf = () => evaluate(`[...document.querySelectorAll('tbody td[data-property-id="${memo}"]')].map((td) => td.textContent.trim())`)

      await clickOn(`th[data-property-id="${memo}"] [data-testid="db-column-menu"]`)
      await waitFor(`!!document.querySelector('[data-testid="db-column-convert"]')`, 3000)
      await clickOn('[data-testid="db-column-convert"]')
      check('★ "유형 바꾸기"가 바꿀 수 있는 유형을 보인다 — 지금 유형은 없다',
        await waitFor(`!!document.querySelector('[data-testid="db-column-convert-number"]') && !document.querySelector('[data-testid="db-column-convert-rich_text"]')`, 3000))
      await clickOn('[data-testid="db-column-convert-number"]')
      check('★ 값이 사라지는 칸이 있으면 개수와 함께 한 번 더 묻는다 — 아직 바뀌지 않았다',
        (await waitFor(`(document.querySelector('[data-testid="db-column-convert-confirm"]')?.textContent ?? '').includes('1개 칸의 값이 사라집니다')`, 5000))
          && (await header()).includes('텍스트'),
        await evaluate(`document.querySelector('[data-testid="db-column-convert-confirm"]')?.textContent ?? '(없음)'`))
      await clickOn('[data-testid="db-column-convert-confirm-button"]')
      check('★ 확인하면 바뀌고 칸이 숫자로 그려진다 — 읽히지 않던 칸은 빈 칸',
        await waitFor(`(document.querySelector('th[data-property-id="${memo}"]')?.textContent ?? '').includes('숫자')
          && JSON.stringify([...document.querySelectorAll('tbody td[data-property-id="${memo}"]')].map((td) => td.textContent.trim())) === JSON.stringify(['12', ''])`, 10000),
        JSON.stringify({ header: await header(), cells: await cellsOf() }))

      await clickOn(`th[data-property-id="${memo}"] [data-testid="db-column-menu"]`)
      await waitFor(`!!document.querySelector('[data-testid="db-column-convert"]')`, 3000)
      await clickOn('[data-testid="db-column-convert"]')
      await waitFor(`!!document.querySelector('[data-testid="db-column-convert-rich_text"]')`, 3000)
      await clickOn('[data-testid="db-column-convert-rich_text"]')
      check('★ 손실이 없으면 묻지 않고 바뀐다 — 숫자 → 텍스트',
        await waitFor(`(document.querySelector('th[data-property-id="${memo}"]')?.textContent ?? '').includes('텍스트') && !document.querySelector('[data-testid="db-column-convert-confirm"]')`, 10000),
        JSON.stringify({ header: await header(), cells: await cellsOf() }))
    }

    if (sectionIf('열 집계 — 서버 (2d-1 · F-04-16)')) {
      // 열에 집계 함수를 달면 행 응답의 첫 페이지에 그 값이 실린다(필터를 지난 행 전부) · 고를 수 없는 함수는 400. 규칙은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `열 집계 ${stamp}` })).body.database
      const num = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '금액', type: 'number' })).body.property.id
      for (const n of [10, 20, 60]) {
        await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: num, value: { type: 'number', number: n } }] })
      }
      const set = await api('PATCH', `/views/${db.defaultViewId}/columns/${num}`, { calculation: 'average' })
      check('열에 집계 함수를 단다 — 200', set.status === 200, String(set.status))
      const first = (await api('GET', `/views/${db.defaultViewId}/rows?limit=1`)).body
      check('★ 첫 페이지에 집계가 실린다 — 페이지에 든 행이 아니라 필터를 지난 행 전부(평균 30)',
        first?.calculations?.[num]?.kind === 'number' && first.calculations[num].value === 30 && first.rows.length === 1,
        JSON.stringify({ calculations: first?.calculations, rows: first?.rows?.length }))
      const next = (await api('GET', `/views/${db.defaultViewId}/rows?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).body
      check('다음 페이지에는 다시 싣지 않는다', next?.calculations === undefined && next?.rows?.length === 1)
      const bad = await api('PATCH', `/views/${db.defaultViewId}/columns/${num}`, { calculation: 'checked' })
      check('타입이 고를 수 없는 함수는 400 invalid_calculation', bad.status === 400 && bad.body?.error === 'invalid_calculation', JSON.stringify(bad))
    }

    if (sectionIf('열 집계 — 화면 (2d-2 · F-04-16)')) {
      // 표 아래 집계 줄 — "계산"을 눌러 그 타입의 함수를 고르면 값이 서고(필터를 지난 행 전부), 바꾸면 바뀌고, "없음"이면 지워진다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const db = (await api('POST', '/databases', { name: `열 집계 화면 ${stamp}` })).body.database
      const num = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '금액', type: 'number' })).body.property.id
      for (const n of [10, 20, 60]) {
        await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: num, value: { type: 'number', number: n } }] })
      }
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 3`, 15000)
      const cell = `td[data-testid="db-calc-cell"][data-property-id="${num}"]`
      const calcText = () => evaluate(`document.querySelector('${cell} [data-testid="db-calc-button"]')?.textContent ?? '(없음)'`)
      const pick = async (testId) => {
        await clickOn(`${cell} [data-testid="db-calc-button"]`)
        await waitFor(`!!document.querySelector('${cell} [data-testid="db-calc-menu"]')`, 3000)
        await clickOn(`${cell} [data-testid="${testId}"]`)
      }

      check('계산이 없는 열은 "계산"만 있다', (await calcText()) === '계산', await calcText())
      await clickOn(`${cell} [data-testid="db-calc-button"]`)
      check('★ 숫자 열의 목록에 평균 · 합계가 있다 — 체크 계열은 없다',
        await waitFor(`!!document.querySelector('${cell} [data-testid="db-calc-average"]') && !document.querySelector('${cell} [data-testid="db-calc-checked"]')`, 3000))
      await clickOn(`${cell} [data-testid="db-calc-average"]`)
      check('★ 평균을 고르면 아래 줄에 "평균 30" — 필터를 지난 행 전부의 값', await waitFor(`(document.querySelector('${cell} [data-testid="db-calc-button"]')?.textContent ?? '') === '평균30'`, 10000), await calcText())
      await pick('db-calc-sum')
      check('합계로 바꾸면 "합계 90"', await waitFor(`(document.querySelector('${cell} [data-testid="db-calc-button"]')?.textContent ?? '') === '합계90'`, 10000), await calcText())
      await pick('db-calc-none')
      check('"없음"이면 지워진다', await waitFor(`(document.querySelector('${cell} [data-testid="db-calc-button"]')?.textContent ?? '') === '계산'`, 10000), await calcText())
    }

    if (sectionIf('그룹 집계 — 보드 머리 (2d-3 · F-04-16)')) {
      // 도구줄 "그룹" 패널의 "머리에"로 속성을 고르면 열 머리의 카드 수 자리에 그 그룹의 계산이 선다(필터를 지난 그 그룹의 행 전부).
      // 카드를 다른 열로 옮기면 두 열의 머리 값을 다시 받는다. "카드 수"로 돌리면 개수가 돌아온다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const db = (await api('POST', '/databases', { name: `그룹 집계 ${stamp}` })).body.database
      const ds = db.dataSourceId
      const num = (await api('POST', `/data-sources/${ds}/properties`, { name: '금액', type: 'number' })).body.property.id
      const stage = (await api('POST', `/data-sources/${ds}/properties`, { name: '단계', type: 'select' })).body.property.id
      const opt = async (name) => (await api('POST', `/data-sources/${ds}/properties/${stage}/options`, { name })).body.option.id
      const ga = await opt('가')
      const na = await opt('나')
      const rows = []
      for (const [n, o] of [[10, ga], [20, ga], [60, na]]) {
        const cells = [
          { propertyId: num, value: { type: 'number', number: n } },
          { propertyId: stage, value: { type: 'select', select: { id: o } } },
        ]
        rows.push((await api('POST', `/views/${db.defaultViewId}/rows`, { cells })).body.row.id)
      }
      const board = (await api('POST', `/databases/${db.id}/views`, { type: 'board', groupBy: { property_id: stage } })).body.view
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${board.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-board-card"]').length === 3`, 15000)

      // 열 머리 — 계산이 있으면 그 값, 없으면 "#카드 수".
      const headsJs = `JSON.stringify([...document.querySelectorAll('[data-testid="db-board-column"]')].map((c) =>
        c.querySelector('[data-testid="db-board-calc"]')?.textContent ?? ('#' + (c.querySelector('[data-testid="db-board-count"]')?.textContent ?? '?'))))`
      const heads = () => evaluate(headsJs)
      const headsAre = (expected) => waitFor(`${headsJs} === ${JSON.stringify(JSON.stringify(expected))}`, 10000)
      const openPanel = async () => {
        if (!(await evaluate(`!!document.querySelector('[data-testid="db-group-panel"]')`))) await clickOn('[data-testid="db-group-button"]')
        return waitFor(`!!document.querySelector('[data-testid="db-group-calc-property"]')`, 3000)
      }
      const closePanel = async () => {
        if (await evaluate(`!!document.querySelector('[data-testid="db-group-panel"]')`)) await clickOn('[data-testid="db-group-button"]')
        await waitFor(`!document.querySelector('[data-testid="db-group-panel"]')`, 3000)
      }

      // 열 순서: 단계 없음 · 가 · 나
      check('계산이 없으면 머리는 카드 수', await headsAre(['#0', '#2', '#1']), await heads())
      await openPanel()
      await setSelect('[data-testid="db-group-calc-property"]', num)
      check('★ "머리에" 금액을 고르면 합계가 붙고 열마다 그 그룹의 합 — 없음 0 · 가 30 · 나 60', await headsAre(['0', '30', '60']), await heads())
      await openPanel()
      check('함수 칸이 열리고 숫자의 함수만 있다 — 지금은 합계 · 평균은 있고 체크 계열은 없다',
        await waitFor(`(() => { const s = document.querySelector('[data-testid="db-group-calc-function"]')
          return !!s && s.value === 'sum' && !!s.querySelector('option[value="average"]') && !s.querySelector('option[value="checked"]') })()`, 3000))
      await setSelect('[data-testid="db-group-calc-function"]', 'average')
      check('평균으로 바꾸면 — 행이 없는 열은 빈 값(—) · 가 15 · 나 60', await headsAre(['—', '15', '60']), await heads())

      // 카드 이동 — 20 을 "나" 로. 가 = 10 · 나 = (60 + 20) / 2 = 40
      await closePanel()
      const card = await rect(`[data-testid="db-board"] [data-row-id="${rows[1]}"]`)
      const target = await rect(`[data-testid="db-board-column"][data-group-key="${na}"]`)
      const sx = card.x + card.w / 2
      const sy = card.y + card.h / 2
      const tx = target.x + target.w / 2
      const ty = target.y + target.h - 10
      await move(sx, sy)
      await press(sx, sy)
      for (let i = 1; i <= 10; i += 1) {
        await move(sx + ((tx - sx) * i) / 10, sy + ((ty - sy) * i) / 10, true)
        await sleep(16)
      }
      await release(tx, ty)
      check('★ 카드를 다른 열로 옮기면 두 열의 머리 값을 다시 받는다 — 가 10 · 나 40', await headsAre(['—', '10', '40']), await heads())

      await openPanel()
      await setSelect('[data-testid="db-group-calc-property"]', '')
      check('"카드 수"로 돌리면 개수가 돌아온다 — 가 1 · 나 2', await headsAre(['#0', '#1', '#2']), await heads())
      await closePanel()
    }

    if (sectionIf('뷰 검색 — 서버 (2e-1 · F-04-27)')) {
      // `?q=` 로 행 · 열 집계 · 보드가 같이 좁혀진다(뷰에 저장하지 않는다). 하위 항목이 켜진 표는 검색 중에 맞는 행을 평평하게 준다.
      // 찾는 칸 · 필터와의 AND · 탈출 같은 규칙은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `뷰 검색 ${stamp}` })).body.database
      const view = db.defaultViewId
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const titleCell = (text) => ({ propertyId: titleProp, value: { type: 'title', title: [textRun(text)] } })
      const parentRow = (await api('POST', `/views/${view}/rows`, { cells: [titleCell('분기 계획')] })).body.row.id
      await api('POST', `/views/${view}/rows`, { cells: [titleCell('회의록')] })
      await api('POST', `/data-sources/${db.dataSourceId}/sub-items`)
      await api('POST', `/views/${view}/rows`, { cells: [titleCell('주간 보고서')], parent: parentRow })
      await api('PATCH', `/views/${view}/columns/${titleProp}`, { calculation: 'count_all' })

      const titlesOf = (body) => (body?.rows ?? []).map((r) => r.title).sort().join(',')
      const all = (await api('GET', `/views/${view}/rows`)).body
      check('검색어가 없으면 트리의 최상위 행만(자식은 부모 밑에)', titlesOf(all) === ['분기 계획', '회의록'].sort().join(','), titlesOf(all))
      const found = (await api('GET', `/views/${view}/rows?q=${encodeURIComponent('보고')}`)).body
      check('★ ?q= 로 맞는 행만 — 하위 항목이 켜진 표라도 자식이 평평하게 나온다', titlesOf(found) === '주간 보고서', titlesOf(found))
      check('★ 열 집계도 검색에 맞는 행으로(모두 세기 1)', found?.calculations?.[titleProp]?.value === 1, JSON.stringify(found?.calculations))
      const nested = await api('GET', `/views/${view}/rows?q=${encodeURIComponent('보고')}&parent=${parentRow}`)
      check('검색 중에 parent 를 주면 400 — 트리를 펴지 않는다', nested.status === 400, String(nested.status))

      const done = await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '완료', type: 'checkbox' })
      const made = await api('POST', `/databases/${db.id}/views`, { type: 'board', groupBy: { property_id: done.body?.property?.id } })
      const board = made.body?.view
      const groups = board ? (await api('GET', `/views/${board.id}/groups?q=${encodeURIComponent('회의')}`)).body : null
      const counted = (groups?.groups ?? []).reduce((n, g) => n + g.count, 0)
      check('★ 보드도 ?q= 로 좁혀진다(카드 수 합 1)', counted === 1,
        JSON.stringify({ done: done.status, made: [made.status, made.body?.error], groups: groups?.groups?.map((g) => [g.key, g.count]) ?? groups }))
    }

    if (sectionIf('뷰 검색 — 화면 (2e-2 · F-04-27)')) {
      // 도구줄 "검색"을 눌러 치면 잠깐 뒤 주소의 q 가 바뀌고 표가 좁혀진다. "더 보기" · 열 집계도 같은 검색어다. 맞는 행이 없으면 안내와
      // "검색어 지우기", Esc 로 닫으면 원래대로. 보드는 열을 남기고 카드만 좁힌다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const db = (await api('POST', '/databases', { name: `뷰 검색 화면 ${stamp}` })).body.database
      const view = db.defaultViewId
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const titleCell = (text) => ({ propertyId: titleProp, value: { type: 'title', title: [textRun(text)] } })
      for (const t of ['주간 보고서', '회의록', '월간 보고서', '예산', '분기 보고서']) {
        await api('POST', `/views/${view}/rows`, { cells: [titleCell(t)] })
      }
      // 한 페이지 2행 — "더 보기"가 검색어를 싣는지 보려고.
      await api('PATCH', `/views/${view}`, { loadLimit: 2 })
      await api('PATCH', `/views/${view}/columns/${titleProp}`, { calculation: 'count_all' })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)

      const titlesJs = `[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? tr.textContent).join('|')`
      const titles = () => evaluate(titlesJs)
      const allMatch = (word, n) => waitFor(`(() => { const t = ${titlesJs}.split('|').filter(Boolean); return t.length === ${n} && t.every((x) => x.includes(${JSON.stringify(word)})) })()`, 10000)
      const calcText = () => evaluate(`document.querySelector('td[data-testid="db-calc-cell"][data-property-id="${titleProp}"] [data-testid="db-calc-button"]')?.textContent ?? ''`)

      await clickOn('[data-testid="db-search-button"]')
      check('"검색"을 누르면 검색 칸이 열리고 포커스가 간다',
        await waitFor(`document.activeElement?.getAttribute('data-testid') === 'db-search-input'`, 3000))
      await typeText('보고')
      check('★ 치고 잠깐 뒤 주소에 q 가 서고 표가 좁혀진다(첫 페이지 2행 — 둘 다 "보고")',
        (await waitFor(`new URLSearchParams(location.search).get('q') === '보고'`, 8000)) && (await allMatch('보고', 2)), await titles())
      check('★ 열 집계도 검색에 맞는 행으로 — 모두 세기 3', await waitFor(`(document.querySelector('td[data-testid="db-calc-cell"][data-property-id="${titleProp}"] [data-testid="db-calc-button"]')?.textContent ?? '') === '모두 세기3'`, 5000), await calcText())
      check('검색 칸은 치던 글자를 그대로 들고 있다', (await evaluate(`document.querySelector('[data-testid="db-search-input"]')?.value`)) === '보고')
      await clickOn('[data-testid="db-load-more"]')
      check('★ "더 보기"도 같은 검색어로 — 셋 다 "보고서"(회의록 · 예산은 오지 않는다)', await allMatch('보고', 3), await titles())

      // 맞는 행이 없다 → 안내 · "검색어 지우기"
      await evaluate(`(() => { const i = document.querySelector('[data-testid="db-search-input"]'); i.focus(); i.select() })()`)
      await typeText('없는말')
      check('★ 맞는 행이 없으면 안내와 "검색어 지우기"가 선다(빈 표만 두지 않는다)',
        await waitFor(`!!document.querySelector('[data-testid="db-search-empty"]') && !document.querySelector('[data-testid="db-empty"]')`, 8000))
      await clickOn('[data-testid="db-search-reset"]')
      check('★ "검색어 지우기" — 주소의 q 가 빠지고 행이 돌아오며 도구줄의 검색 칸도 닫힌다',
        (await waitFor(`!new URLSearchParams(location.search).has('q') && document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 8000))
          && (await waitFor(`!!document.querySelector('[data-testid="db-search-button"]') && !document.querySelector('[data-testid="db-search-input"]')`, 3000)),
        await titles())

      // Esc 로 닫는다
      await clickOn('[data-testid="db-search-button"]')
      await waitFor(`document.activeElement?.getAttribute('data-testid') === 'db-search-input'`, 3000)
      await typeText('회의')
      await waitFor(`new URLSearchParams(location.search).get('q') === '회의'`, 8000)
      await key('Escape')
      check('Esc — 검색을 지우고 닫는다(원래 첫 페이지)',
        await waitFor(`!new URLSearchParams(location.search).has('q') && document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2 && !document.querySelector('[data-testid="db-search-input"]')`, 8000),
        await titles())

      // 보드 — 열은 남고 카드만 좁혀진다 · 맞는 카드가 없으면 안내
      const done = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '완료', type: 'checkbox' })).body.property.id
      const board = (await api('POST', `/databases/${db.id}/views`, { type: 'board', groupBy: { property_id: done } })).body.view
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${board.id}&q=${encodeURIComponent('회의')}` })
      check('★ 보드 — 주소의 q 로 카드가 좁혀지고 열(체크 안 됨 · 체크됨)은 남는다',
        await waitFor(`document.querySelectorAll('[data-testid="db-board-card"]').length === 1 && document.querySelectorAll('[data-testid="db-board-column"]').length === 2
          && document.querySelector('[data-testid="db-search-input"]')?.value === '회의'`, 15000))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${board.id}&q=${encodeURIComponent('없는말')}` })
      check('보드에 맞는 카드가 없으면 안내', await waitFor(`!!document.querySelector('[data-testid="db-search-empty"]') && document.querySelectorAll('[data-testid="db-board-column"]').length === 2`, 15000))
    }

    if (sectionIf('갤러리 뷰 (2f-1 · F-04-05)')) {
      // 뷰 추가에서 "갤러리"를 고르면 카드 그리드가 선다 — 카드는 제목(아이콘) + 값이 있는 속성의 배지. 하위 항목이 켜진 표는 부모만.
      // "+ 새로 만들기"는 제목을 바로 받고, 카드의 제목은 그 행 페이지로 간다. 검색 · "더 보기"는 표와 같은 길이다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const db = (await api('POST', '/databases', { name: `갤러리 ${stamp}` })).body.database
      const ds = db.dataSourceId
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const titleCell = (text) => ({ propertyId: titleProp, value: { type: 'title', title: [textRun(text)] } })
      const amount = (await api('POST', `/data-sources/${ds}/properties`, { name: '금액', type: 'number' })).body.property.id
      const stage = (await api('POST', `/data-sources/${ds}/properties`, { name: '단계', type: 'select' })).body.property.id
      const plan = (await api('POST', `/data-sources/${ds}/properties/${stage}/options`, { name: '기획' })).body.option.id
      const first = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [
        titleCell('첫 카드'),
        { propertyId: amount, value: { type: 'number', number: 10 } },
        { propertyId: stage, value: { type: 'select', select: { id: plan } } },
      ] })).body.row.id
      await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell('둘째 카드')] })
      await api('POST', `/data-sources/${ds}/sub-items`)
      await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell('자식 카드')], parent: first })

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-view-add"]')`, 15000)
      await clickOn('[data-testid="db-view-add"]')
      await waitFor(`!!document.querySelector('[data-testid="db-view-add-gallery"]')`, 3000)
      await clickOn('[data-testid="db-view-add-gallery"]')
      const cardTitles = () => evaluate(`[...document.querySelectorAll('[data-testid="db-gallery-card-title"]')].map((e) => e.textContent).join('|')`)
      check('★ 뷰 추가의 "갤러리" — 카드 그리드가 서고 부모만 그린다(자식 카드는 없다)',
        await waitFor(`!!document.querySelector('[data-testid="db-gallery"]') && [...document.querySelectorAll('[data-testid="db-gallery-card-title"]')].map((e) => e.textContent).join('|') === '첫 카드|둘째 카드'`, 15000),
        await cardTitles())
      // 첫 카드에는 하위 항목(자식 카드)의 배지도 붙는다 — 보이는 속성이다.
      check('카드에는 값이 있는 속성만 배지로 — 첫 카드는 10 · 기획 · 하위 항목, 둘째 카드는 없다',
        await evaluate(`(() => {
          const badges = (id) => [...document.querySelectorAll('[data-row-id="' + id + '"] [data-testid="db-gallery-badge"]')].map((b) => b.textContent)
          const second = [...document.querySelectorAll('[data-testid="db-gallery-card"]')].find((c) => c.textContent.includes('둘째'))
          const mine = badges(${JSON.stringify(first)})
          return mine.includes('10') && mine.includes('기획') && mine.some((b) => b.includes('자식 카드'))
            && second.querySelectorAll('[data-testid="db-gallery-badge"]').length === 0
        })()`),
        JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-row-id="${first}"] [data-testid="db-gallery-badge"]')].map((b) => b.textContent)`)))

      await clickOn('[data-testid="db-gallery-add"]')
      check('"+ 새로 만들기" — 새 카드가 서고 제목 칸에 포커스',
        await waitFor(`document.activeElement?.getAttribute('data-testid') === 'db-gallery-title-input'`, 8000))
      await typeText('새 카드')
      await key('Enter')
      const galleryId = await evaluate(`new URLSearchParams(location.search).get('v')`)
      const storedTitle = async () => {
        for (let i = 0; i < 25; i += 1) {
          if (((await api('GET', `/views/${galleryId}/rows`)).body?.rows ?? []).some((r) => r.title === '새 카드')) return true
          await sleep(200)
        }
        return false
      }
      check('★ 제목을 치고 Enter — 카드에 서고 서버에 남는다',
        (await waitFor(`[...document.querySelectorAll('[data-testid="db-gallery-card-title"]')].some((e) => e.textContent === '새 카드')`, 5000))
          && (await storedTitle()))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${galleryId}&q=${encodeURIComponent('둘째')}` })
      check('검색 — 주소의 q 로 카드가 좁혀진다', await waitFor(`[...document.querySelectorAll('[data-testid="db-gallery-card-title"]')].map((e) => e.textContent).join('|') === '둘째 카드'`, 15000), await cardTitles())

      // 한 페이지 2행 — 행 순서는 첫 · 둘째 · 자식 · 새 카드라, 다음 페이지가 부모만이면 "새 카드", 아니면 "자식 카드"가 온다.
      await api('PATCH', `/views/${galleryId}`, { loadLimit: 2 })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${galleryId}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-gallery-card"]').length === 2`, 15000)
      await clickOn('[data-testid="db-load-more"]')
      check('★ "더 보기"도 부모만 — 다음 카드는 자식이 아니라 새 카드', await waitFor(`[...document.querySelectorAll('[data-testid="db-gallery-card-title"]')].map((e) => e.textContent).join('|') === '첫 카드|둘째 카드|새 카드'`, 8000), await cardTitles())

      await clickOn(`[data-row-id="${first}"] [data-testid="db-gallery-open"]`)
      check('★ 카드의 제목을 누르면 그 행 페이지로 간다', await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${first}`)}`, 15000), await evaluate('location.pathname'))
    }

    if (sectionIf('갤러리 — 카드 미리보기 (2f-2 · F-04-05)')) {
      // 카드 미리보기는 본문의 첫 이미지다(서버가 행마다 주소를 준다) · 이미지가 없는 카드도 같은 높이의 빈 자리 · 깨진 이미지는 빈 자리로.
      // 도구줄 "카드" 패널로 미리보기 · 크기를 바꾸면 그 키만 저장되고 갤러리가 다시 선다. "더 보기"의 카드도 미리보기를 받는다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      // 진짜로 열리는 이미지 — 1x1 PNG 를 올린다(우리 파일 경로 · 세션 인증)
      const form = new FormData()
      form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), '표지.png')
      const uploaded = await (await fetch(`${BASE}/api/workspaces/${workspaceId}/files`, { method: 'POST', headers: { cookie: authed.cookie, origin: BASE }, body: form })).json()
      const db = (await api('POST', '/databases', { name: `갤러리 미리보기 ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const titleCell = (text) => ({ propertyId: titleProp, value: { type: 'title', title: [textRun(text)] } })
      const row = async (title) => (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [titleCell(title)] })).body.row.id
      const withImage = await row('사진 있음')
      const plain = await row('사진 없음')
      const broken = await row('깨진 사진')
      const later = await row('뒤의 사진')
      const imageBlock = (source) => ({ id: randomUUID(), type: 'image', title: [], properties: { source }, format: {}, children: [] })
      const para = (text) => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)], properties: {}, format: {}, children: [] })
      await saveBody(withImage, { blocks: [para('앞 문단'), imageBlock({ type: 'file', file_id: uploaded.file.id })] })
      await saveBody(plain, { blocks: [para('글뿐')] })
      // 깨진 이미지는 **즉시** 실패하는 주소(닫힌 포트)다 — 화면이 붙기(hydration) 전에 깨져야 `onError` 가 오지 않는 경우를 늘 만든다.
      // 우리 서버의 없는 주소(404)는 응답이 늦어 붙은 뒤에 깨지기도 해서, 구간만 돌릴 땐 통과하고 전체 판에서만 떨어졌다(#219).
      await saveBody(broken, { blocks: [imageBlock({ type: 'external', url: `http://127.0.0.1:9/broken-${stamp}.png` })] })
      await saveBody(later, { blocks: [imageBlock({ type: 'file', file_id: uploaded.file.id })] })
      const gallery = (await api('POST', `/databases/${db.id}/views`, { type: 'gallery' })).body.view
      await api('PATCH', `/views/${gallery.id}`, { loadLimit: 3 })

      const card = (id) => `[data-testid="db-gallery-card"][data-row-id="${id}"]`
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${gallery.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-gallery-card"]').length === 3`, 15000)
      check('★ 본문의 첫 이미지가 카드 미리보기다 — 우리 파일 경로 · 실제로 그려졌다',
        await waitFor(`(() => { const img = document.querySelector('${card(withImage)} [data-testid="db-gallery-cover-image"]')
          return !!img && img.getAttribute('src') === ${JSON.stringify(`/api/workspaces/${workspaceId}/files/${uploaded.file.id}/content`)} && img.complete && img.naturalWidth > 0 })()`, 8000))
      check('이미지가 없는 카드도 같은 높이의 빈 자리를 둔다',
        await evaluate(`(() => { const a = document.querySelector('${card(withImage)} [data-testid="db-gallery-cover"]'), b = document.querySelector('${card(plain)} [data-testid="db-gallery-cover"]')
          return !!a && !!b && !b.querySelector('img') && a.getBoundingClientRect().height === b.getBoundingClientRect().height })()`))
      check('★ 깨진 이미지는 빈 자리로 돌린다', await waitFor(`!!document.querySelector('${card(broken)} [data-testid="db-gallery-cover"]') && !document.querySelector('${card(broken)} img')`, 8000))
      await clickOn('[data-testid="db-load-more"]')
      check('★ "더 보기"의 카드도 미리보기를 받는다', await waitFor(`!!document.querySelector('${card(later)} [data-testid="db-gallery-cover-image"]')`, 8000))

      await clickOn('[data-testid="db-gallery-layout-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-gallery-size-select"]')`, 3000)
      await setSelect('[data-testid="db-gallery-size-select"]', 'large')
      check('★ 카드 크기를 "크게" — 저장되고 그리드가 그 크기로 선다',
        (await waitFor(`document.querySelector('[data-testid="db-gallery"]')?.dataset.cardSize === 'large'`, 10000))
          && (await api('GET', `/views/${gallery.id}`)).body?.view?.gallery?.cover_size === 'large')
      await waitFor(`!!document.querySelector('[data-testid="db-gallery-cover-select"]')`, 3000)
      await setSelect('[data-testid="db-gallery-cover-select"]', 'none')
      const stored = async () => (await api('GET', `/views/${gallery.id}`)).body?.view?.gallery
      check('★ 미리보기 "없음" — 미리보기 자리가 사라지고, 앞에서 바꾼 크기는 남는다(그 키만 저장)',
        (await waitFor(`document.querySelectorAll('[data-testid="db-gallery-card"]').length > 0 && !document.querySelector('[data-testid="db-gallery-cover"]')`, 10000))
          && JSON.stringify(await stored()) === JSON.stringify({ cover: 'none', cover_size: 'large', cover_aspect: 'cover' }),
        JSON.stringify(await stored()))
      // 미리보기를 다시 켜면 서버 렌더가 미리보기를 새로 읽는다 — 갤러리는 미리보기를 상태로 들어서, 다시 서지 않으면 빈 채로 남는다.
      // ★ 미리보기가 **꺼진 채로 연** 갤러리여야 그 상태가 비어 있다(한 화면에서 끄고 켜면 처음 받은 미리보기가 그대로 남아 이 검사가
      //   다시 마운트를 가르지 못한다 — 반사실이 살아남았다).
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${gallery.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-gallery-card"]').length === 3 && !document.querySelector('[data-testid="db-gallery-cover"]')`, 15000)
      await clickOn('[data-testid="db-gallery-layout-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-gallery-cover-select"]')`, 3000)
      await setSelect('[data-testid="db-gallery-cover-select"]', 'page_content')
      check('★ 미리보기를 다시 켜면 이미지가 돌아온다(갤러리가 새로 선다)',
        await waitFor(`!!document.querySelector('${card(withImage)} [data-testid="db-gallery-cover-image"]')`, 10000))
    }

    if (sectionIf('캘린더 — 서버 (2g-1 · F-04-06)')) {
      // 캘린더 뷰는 첫 날짜 속성을 고르고(없으면 400 date_required), 보이는 기간에 걸친 행만 날짜순으로 · 날짜 없는 행은 개수만 준다.
      // 기간 · 조건 · 레이아웃의 규칙은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `캘린더 ${stamp}` })).body.database
      const refused = await api('POST', `/databases/${db.id}/views`, { type: 'calendar' })
      check('날짜 속성이 없는 표의 캘린더는 400 date_required', refused.status === 400 && refused.body?.error === 'date_required', JSON.stringify(refused))
      const due = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '마감', type: 'date' })).body.property.id
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const row = (title, date) => api('POST', `/views/${db.defaultViewId}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } }, ...(date ? [{ propertyId: due, value: { type: 'date', date } }] : [])],
      })
      await row('삼월 일', { start: '2026-03-10' })
      await row('걸친 일', { start: '2026-02-27', end: '2026-03-02' })
      await row('사월 일', { start: '2026-04-05' })
      await row('날짜 없는 일', null)
      const made = await api('POST', `/databases/${db.id}/views`, { type: 'calendar' })
      check('★ 캘린더를 만들면 첫 날짜 속성을 고른다', made.status === 201 && made.body?.view?.calendar?.date_property_id === due, JSON.stringify(made.body?.view?.calendar))
      const march = (await api('GET', `/views/${made.body.view.id}/calendar?from=2026-03-01&to=2026-03-31`)).body
      check('★ 보이는 기간에 걸친 행만 날짜순 — 날짜 없는 행은 개수만',
        JSON.stringify(march?.rows?.map((r) => r.title)) === JSON.stringify(['걸친 일', '삼월 일']) && march?.undated === 1 && march?.truncated === false,
        JSON.stringify({ rows: march?.rows?.map((r) => r.title), undated: march?.undated }))
      const bad = await api('GET', `/views/${made.body.view.id}/calendar?from=2026-03-31&to=2026-03-01`)
      check('거꾸로 된 기간은 400', bad.status === 400 && bad.body?.error === 'invalid_value', JSON.stringify(bad))
      const range = await api('PATCH', `/views/${made.body.view.id}`, { calendar: { view_range: 'week' } })
      check('레이아웃은 바꿀 키만 — 날짜 속성은 그대로', range.status === 200 && range.body?.view?.calendar?.date_property_id === due && range.body?.view?.calendar?.view_range === 'week',
        JSON.stringify(range.body?.view?.calendar))
    }

    if (sectionIf('캘린더 — 화면 (2g-2 · F-04-06)')) {
      // 뷰 추가의 "캘린더" → 이번 달 · 주소의 m 으로 달을 옮긴다 · 막대는 그 날짜 칸에 · 주를 넘는 범위는 두 막대 · 날짜 없음 칩 ·
      // 날짜 칸의 "+" 로 그 날의 행을 만들고 제목을 받는다 · "달력" 패널로 날짜 속성을 바꾼다 · 날짜 속성이 지워지면 "고르라".
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const db = (await api('POST', '/databases', { name: `캘린더 화면 ${stamp}` })).body.database
      const ds = db.dataSourceId
      const due = (await api('POST', `/data-sources/${ds}/properties`, { name: '마감', type: 'date' })).body.property.id
      const begin = (await api('POST', `/data-sources/${ds}/properties`, { name: '시작', type: 'date' })).body.property.id
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const row = async (title, cells) => (await api('POST', `/views/${db.defaultViewId}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } }, ...cells],
      })).body.row.id
      const date = (start, end) => ({ type: 'date', date: end ? { start, end } : { start } })
      const tenth = await row('삼월 십일', [{ propertyId: due, value: date('2026-03-10') }, { propertyId: begin, value: date('2026-03-03') }])
      const spanning = await row('걸친 일', [{ propertyId: due, value: date('2026-03-06', '2026-03-09') }])
      await row('사월 일', [{ propertyId: due, value: date('2026-04-15') }])
      await row('날짜 없는 일', [])

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-view-add"]')`, 15000)
      await clickOn('[data-testid="db-view-add"]')
      await waitFor(`!!document.querySelector('[data-testid="db-view-add-calendar"]')`, 3000)
      await clickOn('[data-testid="db-view-add-calendar"]')
      const thisMonth = new Date().toISOString().slice(0, 7)
      check('★ 뷰 추가의 "캘린더" — 이번 달의 달력이 선다(6주 · 42칸)',
        await waitFor(`document.querySelector('[data-testid="db-calendar"]')?.dataset.month === '${thisMonth}' && document.querySelectorAll('[data-testid="db-cal-day"]').length === 42`, 15000))
      const calId = await evaluate(`new URLSearchParams(location.search).get('v')`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${calId}&m=2026-03` })
      await waitFor(`document.querySelector('[data-testid="db-cal-title"]')?.textContent === '2026년 3월'`, 15000)
      // 막대의 가운데가 그 날짜 칸 안에 있는가
      const inDay = (rowId, day, nth = 0) => evaluate(`(() => {
        const bars = [...document.querySelectorAll('[data-testid="db-cal-event"][data-row-id="${rowId}"]')]
        const bar = bars[${nth}], cell = document.querySelector('[data-testid="db-cal-day"][data-day="${day}"]')
        if (!bar || !cell) return false
        const b = bar.getBoundingClientRect(), c = cell.getBoundingClientRect()
        const x = b.x + Math.min(b.width, c.width) / 2, y = b.y + b.height / 2
        return x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height
      })()`)
      check('★ 막대는 그 날짜 칸에 선다 — 3월 10일(화)', await inDay(tenth, '2026-03-10'))
      check('★ 주를 넘는 범위는 두 막대로 잘라 잇는다 — 3/6 ~ 3/7 · 3/8 ~ 3/9',
        (await evaluate(`document.querySelectorAll('[data-testid="db-cal-event"][data-row-id="${spanning}"]').length`)) === 2
          && (await inDay(spanning, '2026-03-06', 0)) && (await inDay(spanning, '2026-03-08', 1)))
      check('날짜 없는 행은 달력에 없고 머리에 "날짜 없음 1개"', (await evaluate(`document.querySelector('[data-testid="db-cal-undated"]')?.textContent`)) === '날짜 없음 1개')
      await clickOn('[data-testid="db-cal-next"]')
      check('다음 달 — 주소의 m 이 바뀌고 4월의 행이 선다',
        await waitFor(`new URLSearchParams(location.search).get('m') === '2026-04' && [...document.querySelectorAll('[data-testid="db-cal-event-title"]')].some((e) => e.textContent === '사월 일')`, 10000))
      await clickOn('[data-testid="db-cal-prev"]')
      await waitFor(`document.querySelector('[data-testid="db-cal-title"]')?.textContent === '2026년 3월'`, 10000)

      // 날짜 칸의 "+" — 그 날의 행 · 막대 자리에서 제목
      await clickOn('[data-testid="db-cal-day"][data-day="2026-03-20"] [data-testid="db-cal-add"]')
      check('날짜 칸의 "+" — 그 날에 새 막대가 서고 제목 칸에 포커스', await waitFor(`document.activeElement?.getAttribute('data-testid') === 'db-cal-title-input'`, 8000))
      await typeText('새 일정')
      await key('Enter')
      const storedNew = async () => {
        for (let i = 0; i < 25; i += 1) {
          const rows = (await api('GET', `/views/${calId}/calendar?from=2026-03-01&to=2026-03-31`)).body?.rows ?? []
          const found = rows.find((r) => r.title === '새 일정')
          if (found) return found.properties[due]?.date?.start
          await sleep(200)
        }
        return null
      }
      check('★ 제목을 치고 Enter — 그 날짜(3/20)로 서버에 남는다', (await storedNew()) === '2026-03-20')

      // "달력" 패널 — 날짜 속성 바꾸기
      await clickOn('[data-testid="db-cal-layout-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-cal-date-select"]')`, 3000)
      await setSelect('[data-testid="db-cal-date-select"]', begin)
      check('★ "달력"에서 날짜 속성을 "시작"으로 — 삼월 십일이 3/3 으로 옮겨 서고 시작이 없는 행은 날짜 없음',
        (await waitFor(`(() => { const bars = document.querySelectorAll('[data-testid="db-cal-event"]'); return bars.length === 1 })()`, 10000))
          && (await inDay(tenth, '2026-03-03'))
          && (await evaluate(`document.querySelector('[data-testid="db-cal-undated"]')?.textContent`)) === '날짜 없음 4개',
        await evaluate(`document.querySelector('[data-testid="db-cal-undated"]')?.textContent ?? '(칩 없음)'`))

      await api('DELETE', `/data-sources/${ds}/properties/${begin}`)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${calId}&m=2026-03` })
      check('날짜 속성이 지워지면 달력 대신 "날짜 속성을 고르라"', await waitFor(`!!document.querySelector('[data-testid="db-cal-needs-date"]')`, 15000))
    }

    if (sectionIf('캘린더 — 끌어 옮기기 (2g-3 · F-04-06)')) {
      // 막대를 끌어 다른 날짜 칸에 놓으면 그 차이만큼 날짜가 옮겨진다 — 범위는 길이를 지키고 시각은 그대로. 움직이지 않고 놓으면 링크가 열린다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `캘린더 끌기 ${stamp}` })).body.database
      const due = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '마감', type: 'date' })).body.property.id
      const titleProp = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const row = async (title, date) => (await api('POST', `/views/${db.defaultViewId}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } }, { propertyId: due, value: { type: 'date', date } }],
      })).body.row.id
      const single = await row('하루 일', { start: '2026-03-10' })
      const ranged = await row('범위 일', { start: '2026-03-06', end: '2026-03-09' })
      const timed = await row('시각 일', { start: '2026-03-17T09:30:00+09:00' })
      const cal = (await api('POST', `/databases/${db.id}/views`, { type: 'calendar' })).body.view
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${cal.id}&m=2026-03` })
      await waitFor(`document.querySelectorAll('[data-testid="db-cal-event"]').length === 4`, 15000)

      const center = (selector, nth = 0) => evaluate(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]
        if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      const dayCenter = (day) => center(`[data-testid="db-cal-day"][data-day="${day}"]`)
      /** (sx, sy) 를 잡아 (tx, ty) 로 끌어 놓는다. */
      const dragTo = async (sx, sy, tx, ty) => {
        await move(sx, sy)
        await press(sx, sy)
        for (let i = 1; i <= 10; i += 1) {
          await move(sx + ((tx - sx) * i) / 10, sy + ((ty - sy) * i) / 10, true)
          await sleep(16)
        }
        await release(tx, ty)
        await sleep(80)
      }
      const dateOf = async (rowId) => {
        const rows = (await api('GET', `/views/${cal.id}/calendar?from=2026-03-01&to=2026-04-11`)).body?.rows ?? []
        return rows.find((r) => r.id === rowId)?.properties?.[due]?.date ?? null
      }
      const settled = async (rowId, expected) => {
        for (let i = 0; i < 25; i += 1) {
          const got = await dateOf(rowId)
          if (got !== null && got.start === expected.start && (got.end ?? undefined) === expected.end) return true
          await sleep(200)
        }
        return false
      }
      const inDay = (rowId, day, nth = 0) => evaluate(`(() => {
        const bar = document.querySelectorAll('[data-testid="db-cal-event"][data-row-id="${rowId}"]')[${nth}]
        const cell = document.querySelector('[data-testid="db-cal-day"][data-day="${day}"]')
        if (!bar || !cell) return false
        const b = bar.getBoundingClientRect(), c = cell.getBoundingClientRect()
        const x = b.x + Math.min(b.width, c.width) / 2, y = b.y + b.height / 2
        return x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height
      })()`)

      // 하루 일: 3/10 → 3/12
      const bar = await center(`[data-testid="db-cal-event"][data-row-id="${single}"]`)
      const target = await dayCenter('2026-03-12')
      await dragTo(bar.x, bar.y, target.x, target.y)
      check('★ 막대를 끌어 3/12 칸에 놓으면 그 칸으로 옮겨 서고 서버에 남는다',
        (await waitFor(`(() => { const bar = document.querySelector('[data-testid="db-cal-event"][data-row-id="${single}"]'); return !!bar && !bar.dataset.dragging })()`, 3000))
          && (await inDay(single, '2026-03-12')) && (await settled(single, { start: '2026-03-12' })))

      // 범위 일: 둘째 막대(3/8 ~ 3/9)를 3/8 자리에서 잡아 3/15 로 — 7일 · 길이를 지킨다
      const grab = await dayCenter('2026-03-08')
      const second = await center(`[data-testid="db-cal-event"][data-row-id="${ranged}"]`, 1)
      const to15 = await dayCenter('2026-03-15')
      await dragTo(grab.x, second.y, to15.x, second.y + (to15.y - grab.y))
      check('★ 범위는 잡은 날과 놓은 날의 차이만큼 — 길이를 지킨다(3/6~3/9 → 3/13~3/16)', await settled(ranged, { start: '2026-03-13', end: '2026-03-16' }),
        JSON.stringify(await dateOf(ranged)))

      // 시각 일: 3/17 → 3/18 — 시각 · 시간대는 그대로
      const timedBar = await center(`[data-testid="db-cal-event"][data-row-id="${timed}"]`)
      const to18 = await dayCenter('2026-03-18')
      await dragTo(timedBar.x, timedBar.y, to18.x, to18.y)
      check('★ 시각이 있는 값은 날짜만 옮긴다 — 09:30+09:00 은 그대로', await settled(timed, { start: '2026-03-18T09:30:00+09:00' }),
        JSON.stringify(await dateOf(timed)))

      // 움직이지 않고 놓으면 링크가 열린다(끌기가 클릭을 막지 않는다)
      const still = await center(`[data-testid="db-cal-event"][data-row-id="${single}"] [data-testid="db-cal-event-open"]`)
      await click(still.x, still.y)
      check('끌지 않고 누르면 그 행 페이지가 열린다', await waitFor(`location.pathname === ${JSON.stringify(`/w/${workspaceId}/${single}`)}`, 15000), await evaluate('location.pathname'))
    }

    if (sectionIf('개인 필터 · 정렬 — 서버 (2h-1 · F-04-17)')) {
      // 나에게만 적용하는 필터 · 정렬 — 걸면 행 응답이 그것으로 좁혀지고(공유 필터를 대체) · 초기화하면 공유 것 · 모두에게 저장하면 공유 것이 된다.
      // 볼 수만 있는 사람 · 보드 · 캘린더 · 권한은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `개인 필터 ${stamp}` })).body.database
      const view = db.defaultViewId
      const score = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '점수', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      for (const [t, n] of [['가', 10], ['나', 20], ['다', 30]]) {
        await api('POST', `/views/${view}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }, { propertyId: score, value: { type: 'number', number: n } }] })
      }
      await api('PATCH', `/views/${view}`, { filter: { property_id: score, operator: 'greater_than', value: 15 } })
      const titles = async () => ((await api('GET', `/views/${view}/rows`)).body?.rows ?? []).map((r) => r.title).join(',')
      check('공유 필터(> 15)', (await titles()) === '나,다', await titles())
      const set = await api('PATCH', `/views/${view}/personal`, { filter: { property_id: score, operator: 'less_than', value: 25 } })
      check('★ 개인 필터를 걸면 행이 그것으로 — 공유 조건을 대체한다(< 25)',
        set.status === 200 && set.body?.view?.personal?.filter === true && (await titles()) === '가,나', JSON.stringify({ status: set.status, titles: await titles() }))
      await api('DELETE', `/views/${view}/personal`)
      check('초기화 — 공유 것으로', (await titles()) === '나,다', await titles())
      await api('PATCH', `/views/${view}/personal`, { filter: null })
      const published = await api('POST', `/views/${view}/personal`)
      check('★ "필터 없음"을 모두에게 저장 — 공유 필터가 지워진다', published.status === 200 && published.body?.view?.filter === null && (await titles()) === '가,나,다',
        JSON.stringify({ status: published.status, filter: published.body?.view?.filter }))
    }

    if (sectionIf('수식 속성 — 서버 (2i-2 · F-03-12)')) {
      // 수식을 만들면 행 응답에 그 행의 값이 실리고(읽을 때 계산) · 뷰 컬럼에 사람이 읽는 식이 선다. 틀린 식은 자리와 함께 400 · 순환은 400.
      // 깊이 · 되살리기 고리 · 끊긴 수식 · 권한은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `수식 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const hours = (await api('POST', props, { name: '시간', type: 'number' })).body.property.id
      const rate = (await api('POST', props, { name: '단가', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const row = (await api('POST', `/views/${view}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun('가')] } }, { propertyId: hours, value: { type: 'number', number: 3 } }, { propertyId: rate, value: { type: 'number', number: 50 } }],
      })).body.row.id
      const rows = () => api('GET', `/views/${view}/rows`)
      check('수식 컬럼이 없으면 행 응답에 수식 값이 없다', !('formulas' in ((await rows()).body ?? {})))

      const made = await api('POST', props, { name: '금액', type: 'formula', expression: 'prop("시간") * prop("단가")' })
      check('★ 수식 속성을 만든다(201 · 타입 formula)', made.status === 201 && made.body?.property?.type === 'formula', JSON.stringify({ status: made.status, body: made.body }))
      const amount = made.body?.property?.id
      const read = (await rows()).body
      check('★ 행 응답에 그 행의 수식 값이 실린다(3 × 50)',
        read?.formulas?.columns?.[amount]?.error === null && read?.formulas?.values?.[row]?.[amount]?.value === 150, JSON.stringify(read?.formulas))
      const column = (await api('GET', `/views/${view}`)).body?.view?.columns?.find((c) => c.propertyId === amount)
      check('★ 뷰 컬럼에 사람이 읽는 식과 결과 타입', column?.type === 'formula' && column?.formula?.expression === 'prop("시간") * prop("단가")' && column?.formula?.resultType === 'number',
        JSON.stringify(column))

      const bad = await api('POST', props, { name: '틀림', type: 'formula', expression: 'prop("시간") +' })
      check('★ 틀린 식 — 400 · 자리와 이유', bad.status === 400 && bad.body?.error === 'invalid_formula' && bad.body?.formulaError?.start === 12 && typeof bad.body?.formulaError?.message === 'string',
        JSON.stringify(bad))
      await api('POST', props, { name: '하나 더', type: 'formula', expression: 'prop("금액") + 1' })
      const cycle = await api('PATCH', `${props}/${amount}`, { expression: 'prop("하나 더") * 2' })
      check('★ 순환 — 400 formula_cycle', cycle.status === 400 && cycle.body?.error === 'formula_cycle', JSON.stringify(cycle))
      const fixed = await api('PATCH', `${props}/${amount}`, { expression: 'prop("시간") + prop("단가")' })
      const after = (await rows()).body
      check('★ 식을 고치면 다음 읽기가 새 값(3 + 50) · 그것을 읽는 수식도(+1)',
        fixed.status === 200 && after?.formulas?.values?.[row]?.[amount]?.value === 53 && Object.values(after?.formulas?.values?.[row] ?? {}).some((v) => v?.value === 54),
        JSON.stringify({ status: fixed.status, values: after?.formulas?.values?.[row] }))
    }

    if (sectionIf('수식 속성 — 화면 (2i-3a · F-03-12)')) {
      // 속성 추가 폼의 "수식"으로 만들면 표가 다시 서고 값이 칸에 그려진다(화면이 그 행의 칸으로 계산한다 — 숨긴 속성도 읽는다).
      // 칸을 고치면 새로고침 없이 따라 바뀐다. 틀린 식은 폼이 이유와 자리를 말한다. 행 페이지도 같은 값. 읽던 속성이 지워지면 "수식 오류".
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const db = (await api('POST', '/databases', { name: `수식 화면 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const qty = (await api('POST', props, { name: '수량', type: 'number' })).body.property.id
      const price = (await api('POST', props, { name: '단가', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const rowOf = async (title, cells) =>
        (await api('POST', `/views/${view}/rows`, {
          cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(title)] } }, ...cells],
        })).body.row.id
      const first = await rowOf('가', [{ propertyId: qty, value: { type: 'number', number: 3 } }, { propertyId: price, value: { type: 'number', number: 50 } }])
      const second = await rowOf('나', [{ propertyId: price, value: { type: 'number', number: 10 } }])
      // 단가는 숨긴다 — 표는 보이는 컬럼만 받지만 수식은 숨긴 속성도 읽어야 한다
      await api('PATCH', `/views/${view}/columns/${price}`, { visible: false })

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)

      // ── 만들기 ──
      await clickOn('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await typeText('금액')
      await setSelect('select[aria-label="속성 유형"]', 'formula')
      await waitFor(`!!document.querySelector('[data-testid="db-formula-expression"]')`, 3000)
      await evaluate(`document.querySelector('[data-testid="db-formula-expression"]').focus()`)
      await typeText('prop("수량") * prop("단가")')
      await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
      const amount = await (async () => {
        for (let i = 0; i < 40; i += 1) {
          const c = (await api('GET', `/views/${view}`)).body?.view?.columns?.find((x) => x.name === '금액')
          if (c) return c.propertyId
          await sleep(150)
        }
        return null
      })()
      const formulaCell = (rowId) => `tr[data-row-id="${rowId}"] td[data-property-id="${amount}"]`
      const formulaText = (rowId) => evaluate(`document.querySelector('${formulaCell(rowId)} [data-testid="db-formula"]')?.textContent.trim() ?? null`)
      check('★ 만들면 표가 다시 서고 값이 칸에 그려진다 — 숨긴 단가도 읽는다(3 × 50)',
        amount !== null && (await waitFor(`!document.querySelector('[data-testid="db-add-column-form"]') && (document.querySelector('${formulaCell(first)} [data-testid="db-formula"]')?.textContent.trim() ?? null) === '150'`, 15000)),
        JSON.stringify({ amount, text: await formulaText(first) }))
      check('★ 빈 칸을 읽으면 빈 칸이다(0 이 아니다) · 머리가 "수식"이라고 말한다',
        (await formulaText(second)) === null
          && (await evaluate(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].some((th) => th.textContent.includes('금액') && th.textContent.includes('수식'))`)),
        JSON.stringify({ second: await formulaText(second) }))
      check('수식 칸은 읽기 전용이다', await evaluate(`document.querySelector('${formulaCell(first)}')?.getAttribute('aria-readonly') === 'true'`))

      // ── 칸을 고치면 따라 바뀐다(왕복 없이) ──
      await clickOn(`tr[data-row-id="${first}"] td[data-property-id="${qty}"]`)
      await key('Enter')
      if (await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 5000)) {
        await evaluate(`document.querySelector('[data-testid="db-cell-input"]').select()`)
        await typeText('4')
        await key('Enter')
      }
      check('★ 수량을 4 로 고치면 새로고침 없이 200',
        await waitFor(`(document.querySelector('${formulaCell(first)} [data-testid="db-formula"]')?.textContent.trim() ?? null) === '200'`, 8000),
        await formulaText(first))

      // ── 틀린 식은 폼이 말한다 ──
      await clickOn('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await typeText('틀림')
      await setSelect('select[aria-label="속성 유형"]', 'formula')
      await waitFor(`!!document.querySelector('[data-testid="db-formula-expression"]')`, 3000)
      await evaluate(`document.querySelector('[data-testid="db-formula-expression"]').focus()`)
      await typeText('prop("수량") +')
      // 2i-3b 부터는 치는 동안 화면이 같은 함수로 검사한다 — 이유와 자리를 말하고 "추가"를 막는다(서버의 같은 답은 고리 · 깊이에서 본다)
      check('★ 틀린 식 — 이유와 자리(몇 번째 글자)를 말하고 "추가"가 막힌다',
        await waitFor(`(document.querySelector('[data-testid="db-add-column-form"] [data-testid="db-formula-check"]')?.textContent ?? '').includes('13번째 글자')
          && document.querySelector('[data-testid="db-add-column-form"] button[type="submit"]')?.disabled === true`, 8000),
        await evaluate(`document.querySelector('[data-testid="db-add-column-form"] [data-testid="db-formula-check"]')?.textContent ?? null`))
      await key('Escape')

      // ── 행 페이지 — 같은 값 ──
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${first}` })
      check('★ 행 페이지의 속성 묶음에도 같은 값(200)',
        await waitFor(`(document.querySelector('[data-testid="row-properties"] td[data-property-id="${amount}"] [data-testid="db-formula"]')?.textContent.trim() ?? null) === '200'`, 15000),
        await evaluate(`document.querySelector('[data-testid="row-properties"] td[data-property-id="${amount}"]')?.textContent ?? null`))

      // ── 읽던 속성이 지워지면 말한다 ──
      await api('DELETE', `${props}/${price}`)
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)
      check('★ 읽던 속성(단가)이 지워지면 "수식 오류" — 조용히 비우지 않는다',
        await waitFor(`!!document.querySelector('${formulaCell(first)} [data-testid="db-formula-error"]') && !!document.querySelector('${formulaCell(second)} [data-testid="db-formula-error"]')`, 8000),
        await evaluate(`document.querySelector('${formulaCell(first)}')?.textContent ?? null`))
    }

    if (sectionIf('수식 — 식 편집기 (2i-3b · F-03-12)')) {
      // 치는 동안 같은 함수로 검사한다(틀린 자리 밑줄 · 결과 타입 · 첫 행 미리보기) · 속성 · 함수를 눌러 넣는다 · 머리 메뉴의 "식 고치기"
      // (지금 식으로 연다 · 자기 자신은 화면이 막는다 · 다른 수식을 거친 고리는 서버가 이유를 준다).
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const editorIn = (scope) => ({
        value: () => evaluate(`document.querySelector('${scope} [data-testid="db-formula-expression"]')?.value ?? null`),
        status: () => evaluate(`document.querySelector('${scope} [data-testid="db-formula-check"]')?.textContent ?? null`),
        clear: async () => {
          await evaluate(`(() => { const t = document.querySelector('${scope} [data-testid="db-formula-expression"]'); t.focus(); t.select() })()`)
          await key('Backspace')
        },
        focusEnd: () => evaluate(`(() => { const t = document.querySelector('${scope} [data-testid="db-formula-expression"]'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })()`),
      })
      const db = (await api('POST', '/databases', { name: `식 편집기 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const qty = (await api('POST', props, { name: '수량', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const first = (await api('POST', `/views/${view}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun('가')] } }, { propertyId: qty, value: { type: 'number', number: 3 } }],
      })).body.row.id

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1`, 15000)

      // ── 치는 동안 검사 ──
      await clickOn('[data-testid="db-add-column"]')
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await typeText('계산')
      await setSelect('select[aria-label="속성 유형"]', 'formula')
      await waitFor(`!!document.querySelector('[data-testid="db-formula-expression"]')`, 3000)
      const add = editorIn('[data-testid="db-add-column-form"]')
      await add.focusEnd()
      await typeText('prop("수량") *')
      check('★ 치는 동안 틀린 자리를 말하고 식 아래에 밑줄로 다시 보인다 — "추가"는 막힌다',
        await waitFor(`(document.querySelector('[data-testid="db-formula-check"]')?.textContent ?? '').includes('13번째 글자')
          && !!document.querySelector('[data-testid="db-formula-mark"] mark')
          && document.querySelector('[data-testid="db-add-column-form"] button[type="submit"]')?.disabled === true`, 5000),
        await add.status())
      await typeText(' 2')
      check('★ 맞으면 결과 타입과 첫 행의 값을 미리 보인다(3 × 2) — "추가"가 열린다',
        await waitFor(`(document.querySelector('[data-testid="db-formula-check"]')?.textContent ?? '').includes('결과: 숫자')
          && (document.querySelector('[data-testid="db-formula-preview"]')?.textContent ?? '').includes('첫 행: 6')
          && document.querySelector('[data-testid="db-add-column-form"] button[type="submit"]')?.disabled === false`, 5000),
        await add.status())

      // ── 속성 · 함수 넣기 ──
      await add.clear()
      await clickOn('[data-testid="db-formula-insert"] summary')
      await clickOn('[data-testid="db-formula-insert-fn"][data-fn="abs"]')
      await add.focusEnd()
      await typeText(' - 10)')
      // 캐럿을 `abs(` 뒤(가운데)에 두고 속성을 누른다 — 끝에 붙이지 않고 캐럿 자리에 넣는지 본다
      await evaluate(`(() => { const t = document.querySelector('[data-testid="db-add-column-form"] [data-testid="db-formula-expression"]'); t.focus(); t.setSelectionRange(4, 4) })()`)
      await clickOn('[data-testid="db-formula-insert-prop"][data-name="수량"]')
      check('★ 함수 · 속성을 눌러 캐럿 자리에 넣는다 — abs( - 10) 의 가운데에 → abs(prop("수량") - 10) · 첫 행 7',
        (await add.value()) === 'abs(prop("수량") - 10)'
          && (await waitFor(`(document.querySelector('[data-testid="db-formula-preview"]')?.textContent ?? '').includes('첫 행: 7')`, 5000)),
        JSON.stringify({ value: await add.value(), status: await add.status() }))
      await clickOn('[data-testid="db-add-column-form"] button[type="submit"]')
      const calc = await (async () => {
        for (let i = 0; i < 40; i += 1) {
          const c = (await api('GET', `/views/${view}`)).body?.view?.columns?.find((x) => x.name === '계산')
          if (c) return c.propertyId
          await sleep(150)
        }
        return null
      })()
      const calcText = () => evaluate(`document.querySelector('tr[data-row-id="${first}"] td[data-property-id="${calc}"] [data-testid="db-formula"]')?.textContent.trim() ?? null`)
      check('만들면 칸에 7',
        calc !== null && (await waitFor(`(document.querySelector('tr[data-row-id="${first}"] td[data-property-id="${calc}"] [data-testid="db-formula"]')?.textContent.trim() ?? null) === '7'`, 15000)),
        await calcText())

      // ── 식 고치기 ──
      const openFormulaMenu = async () => {
        await clickOn(`th[data-property-id="${calc}"] [data-testid="db-column-menu"]`)
        await clickOn('[data-testid="db-column-formula"]')
        return waitFor(`!!document.querySelector('[data-testid="db-formula-edit"] [data-testid="db-formula-expression"]')`, 5000)
      }
      const edit = editorIn('[data-testid="db-formula-edit"]')
      check('★ "식 고치기"는 지금 식(사람이 읽는 모양)으로 연다',
        (await openFormulaMenu()) && (await edit.value()) === 'abs(prop("수량") - 10)', await edit.value())
      await edit.clear()
      await typeText('prop("계산") + 1')
      check('★ 자기 자신을 읽으면 화면이 막는다 — 저장이 막힌다',
        await waitFor(`(document.querySelector('[data-testid="db-formula-edit"] [data-testid="db-formula-check"]')?.textContent ?? '').includes('자기 자신')
          && document.querySelector('[data-testid="db-formula-save"]')?.disabled === true`, 5000),
        await edit.status())
      await edit.clear()
      await typeText('prop("수량") + 100')
      await clickOn('[data-testid="db-formula-save"]')
      check('★ 저장하면 다시 읽어 칸이 새 식의 값(103)',
        await waitFor(`!document.querySelector('[data-testid="db-formula-edit"]') && (document.querySelector('tr[data-row-id="${first}"] td[data-property-id="${calc}"] [data-testid="db-formula"]')?.textContent.trim() ?? null) === '103'`, 15000),
        await calcText())

      // ── 다른 수식을 거친 고리는 서버가 말한다 ──
      await api('POST', props, { name: '다음', type: 'formula', expression: 'prop("계산") + 1' })
      await send('Page.reload')
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 1`, 15000)
      await openFormulaMenu()
      await edit.clear()
      await typeText('prop("다음") * 2')
      await clickOn('[data-testid="db-formula-save"]')
      check('★ 다른 수식을 거쳐 돌아오는 고리 — 화면은 못 보고 서버가 이유를 준다(메뉴가 남는다)',
        await waitFor(`(document.querySelector('[data-testid="db-formula-edit"] [role="alert"]')?.textContent ?? '').includes('돌고 돌아')`, 8000),
        await evaluate(`document.querySelector('[data-testid="db-formula-edit"] [role="alert"]')?.textContent ?? null`))
      await key('Escape')
    }

    if (sectionIf('속성 의존 — 지우기 · 유형 바꾸기 전에 알린다 (2j-1 · F-03-13)')) {
      // 머리 메뉴의 "속성 삭제" · "유형 바꾸기"를 열면 그 속성을 읽는 수식 · 롤업(다른 표의 것은 그 표 이름과 함께)을 알린다. 읽는 것이
      // 없으면 아무것도 말하지 않는다. 권한(볼 수 없는 표의 롤업은 개수만) · 휴지통 · 순서는 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const tasks = (await api('POST', '/databases', { name: `작업 ${stamp}` })).body.database
      const projects = (await api('POST', '/databases', { name: `프로젝트 ${stamp}` })).body.database
      const tprops = `/data-sources/${tasks.dataSourceId}/properties`
      const qty = (await api('POST', tprops, { name: '수량', type: 'number' })).body.property.id
      const memo = (await api('POST', tprops, { name: '메모', type: 'rich_text' })).body.property.id
      await api('POST', tprops, { name: '금액', type: 'formula', expression: 'prop("수량") * 1000' })
      const rel = (await api('POST', `/data-sources/${tasks.dataSourceId}/relations`, {
        name: '프로젝트', targetDataSourceId: projects.dataSourceId, twoWay: { name: '작업들' },
      })).body
      await api('POST', `/data-sources/${projects.dataSourceId}/rollups`, {
        name: '총 수량', relationPropertyId: rel?.syncedPropertyId ?? rel?.property?.config?.synced_property_id, targetPropertyId: qty, function: 'sum',
      })

      const listed = await api('GET', `${tprops}/${qty}/dependents`)
      check('★ API — 수량을 읽는 것: 이 표의 수식 · 다른 표의 롤업(그 표 이름과 함께)',
        listed.status === 200 && JSON.stringify(listed.body?.dependents?.map((d) => [d.name, d.type, d.tableName]))
          === JSON.stringify([['금액', 'formula', null], ['총 수량', 'rollup', `프로젝트 ${stamp}`]]) && listed.body?.hidden === 0,
        JSON.stringify(listed))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${tasks.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-table"]')`, 15000)
      const noteText = () => evaluate(`document.querySelector('[data-testid="db-column-dependents"]')?.textContent ?? null`)
      const openMenuItem = async (propertyId, item) => {
        await clickOn(`th[data-property-id="${propertyId}"] [data-testid="db-column-menu"]`)
        await clickOn(`[data-testid="${item}"]`)
      }
      // 단계를 바꾸면 누른 항목이 사라져 포커스가 패널 밖으로 간다 — Escape 대신 메뉴 단추를 다시 눌러 닫는다
      const closeMenu = async (propertyId) => {
        await clickOn(`th[data-property-id="${propertyId}"] [data-testid="db-column-menu"]`)
        await waitFor(`!document.querySelector('[data-testid="db-column-menu-panel"]')`, 3000)
      }

      await openMenuItem(qty, 'db-column-delete')
      check('★ "속성 삭제"를 열면 읽는 수식 · 롤업을 알린다 — 다른 표 이름과 지우면 어떻게 되는지',
        await waitFor(`(() => {
          const t = document.querySelector('[data-testid="db-column-dependents"]')?.textContent ?? ''
          return t.includes('‘금액’ 수식') && t.includes('‘총 수량’ 롤업') && t.includes('프로젝트 ${stamp}') && t.includes('오류가 됩니다')
        })()`, 8000),
        await noteText())
      // 알림은 "삭제" 단추 **아래**에 선다 — 위에 서면 읽는 중 줄이 사라지거나 알림이 서면서 단추가 움직여 누르려던 자리를 빗나간다
      // (#230 의 전체 판에서 W8-b 의 "속성을 지우면 머리에서 빠진다"가 그렇게 떨어졌다). 시간에 기대지 않게 자리로 본다.
      check('★ 알림은 "삭제" 단추 아래에 선다(단추가 움직이지 않는다)',
        await evaluate(`(() => {
          const b = document.querySelector('[data-testid="db-column-delete-confirm"]')?.getBoundingClientRect()
          const n = document.querySelector('[data-testid="db-column-dependents"]')?.getBoundingClientRect()
          return !!b && !!n && n.top >= b.bottom
        })()`))
      await closeMenu(qty)

      await openMenuItem(qty, 'db-column-convert')
      check('★ "유형 바꾸기"를 열어도 알린다 — 맞지 않는 것은 오류가 된다',
        await waitFor(`(document.querySelector('[data-testid="db-column-convert-list"] [data-testid="db-column-dependents"]')?.textContent ?? '').includes('맞지 않는 것은 오류')`, 8000),
        await noteText())
      await closeMenu(qty)

      await openMenuItem(memo, 'db-column-delete')
      check('읽는 것이 없으면 아무것도 말하지 않는다(확인이 끝난 뒤)',
        (await waitFor(`!!document.querySelector('[data-testid="db-column-delete-confirm"]') && !document.querySelector('[data-testid="db-column-dependents-loading"]')`, 8000))
          && (await noteText()) === null,
        await noteText())
      // 단계를 바꿔도(누른 항목이 사라져도) Escape 로 닫힌다 — 포커스가 패널에 남는다
      await key('Escape')
      check('★ 지우기 단계에서도 Escape 로 메뉴가 닫힌다(포커스가 패널에 남는다)',
        await waitFor(`!document.querySelector('[data-testid="db-column-menu-panel"]')`, 3000),
        await evaluate(`document.activeElement?.outerHTML.slice(0, 80) ?? null`))
    }

    if (sectionIf('수식으로 거르기 · 정렬 — 서버 (2j-2 · F-03-13)')) {
      // 뷰의 필터 · 정렬이 수식을 읽으면 그 값의 캐시(derived_value)로 거른다 — 칸을 고치면 다음 읽기가 맞다. 무효화의 경우 · 보드 · 캘린더 ·
      // 지금을 읽는 수식은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `수식 거르기 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const qty = (await api('POST', props, { name: '수량', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const rowIds = {}
      for (const [t, n] of [['가', 3], ['나', 30], ['다', 12]]) {
        rowIds[t] = (await api('POST', `/views/${view}/rows`, {
          cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }, { propertyId: qty, value: { type: 'number', number: n } }],
        })).body.row.id
      }
      const amount = (await api('POST', props, { name: '금액', type: 'formula', expression: 'prop("수량") * 10' })).body.property.id
      const titles = async () => ((await api('GET', `/views/${view}/rows`)).body?.rows ?? []).map((r) => r.title).join(',')

      const set = await api('PATCH', `/views/${view}`, { filter: { property_id: amount, operator: 'greater_than', value: 100 } })
      check('★ 뷰의 필터가 수식을 읽는다 — 금액 > 100 (나 · 다)', set.status === 200 && (await titles()) === '나,다', JSON.stringify({ status: set.status, titles: await titles() }))
      await api('PATCH', `/rows/${rowIds['가']}`, { cells: [{ propertyId: qty, value: { type: 'number', number: 50 } }] })
      check('★ 칸을 고치면 다음 읽기가 맞다 — 가(500)도 걸린다', (await titles()) === '가,나,다', await titles())
      await api('PATCH', `/views/${view}`, { filter: null, sorts: [{ property_id: amount, direction: 'desc' }] })
      check('★ 수식으로 정렬한다 — 금액 내림차순(가 500 · 나 300 · 다 120)', (await titles()) === '가,나,다', await titles())
      await api('PATCH', `/views/${view}`, { sorts: [{ property_id: amount, direction: 'asc' }] })
      check('오름차순', (await titles()) === '다,나,가', await titles())
      const bad = await api('PATCH', `/views/${view}`, { filter: { property_id: amount, operator: 'contains', value: '1' } })
      check('결과 타입(수)에 없는 연산자는 400', bad.status === 400 && bad.body?.error === 'invalid_filter', JSON.stringify(bad))
    }

    if (sectionIf('수식으로 거르기 · 정렬 — 화면 (2j-3 · F-03-13)')) {
      // 도구줄의 필터가 수식 컬럼을 고른다(연산자 · 값 입력은 결과 타입의 칸 것) · 머리 메뉴로 수식 정렬 · 정렬 칩이 도구줄에 남는다 ·
      // 새로고침해도 같은 결과(서버가 수식 값의 캐시로 거른다).
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const db = (await api('POST', '/databases', { name: `수식 화면 거르기 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const qty = (await api('POST', props, { name: '수량', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      for (const [t, n] of [['가', 3], ['나', 30], ['다', 12]]) {
        await api('POST', `/views/${view}/rows`, {
          cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }, { propertyId: qty, value: { type: 'number', number: n } }],
        })
      }
      const amount = (await api('POST', props, { name: '금액', type: 'formula', expression: 'prop("수량") * 10' })).body.property.id
      const titlesJs = `[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '').join(',')`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 3`, 15000)

      // ── 도구줄의 필터 — 수식을 고르고 "보다 큼 100" ──
      await clickOn('[data-testid="db-filter-button"]')
      if (!(await waitFor(`!!document.querySelector('[data-testid="db-filter-rule"]')`, 2000))) await clickOn('[data-testid="db-filter-add"]')
      await waitFor(`!!document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 속성"]')`, 5000)
      check('★ 필터 속성에 수식이 선다',
        await evaluate(`[...document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 속성"]').options].some((o) => o.value === ${JSON.stringify(amount)})`))
      await setSelect('[data-testid="db-filter-rule"] select[aria-label="필터 속성"]', amount)
      await waitFor(`[...(document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 조건"]')?.options ?? [])].some((o) => o.value === 'greater_than')`, 5000)
      check('★ 연산자는 결과 타입(수)의 것 — "보다 큼"이 있고 "포함"이 없다',
        await evaluate(`(() => { const o = [...document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 조건"]').options].map((x) => x.value); return o.includes('greater_than') && !o.includes('contains') })()`))
      await setSelect('[data-testid="db-filter-rule"] select[aria-label="필터 조건"]', 'greater_than')
      await evaluate(`(() => { const i = document.querySelector('[data-testid="db-filter-value"]'); i.focus(); i.select() })()`)
      await typeText('100')
      await key('Enter')
      check('★ 수식으로 거른다 — 금액 > 100 (나 · 다)', await waitFor(`${titlesJs} === '나,다'`, 10000), await evaluate(titlesJs))
      await key('Escape')
      // 표 변경 알림(2k-2)이 행을 먼저 맞춘다 — 저장이 부른 새로 세우기(서버 렌더 · 도구줄의 칩)가 끝난 뒤에 메뉴를 연다(열린 메뉴가 닫히지 않게)
      await waitFor(`document.querySelectorAll('[data-testid="db-filter-chip"]').length === 1`, 10000)

      // ── 머리 메뉴의 정렬 — 수식에도 선다 ──
      await clickOn(`th[data-property-id="${amount}"] [data-testid="db-column-menu"]`)
      check('★ 수식 머리 메뉴에 정렬이 선다', await waitFor(`!!document.querySelector('[data-testid="db-column-sort-asc"]')`, 3000))
      await clickOn('[data-testid="db-column-sort-asc"]')
      check('★ 수식으로 정렬한다 — 금액 오름차순(다 120 · 나 300)', await waitFor(`${titlesJs} === '다,나'`, 10000), await evaluate(titlesJs))

      // ── 정렬 칩이 도구줄에 남는다(서버 렌더가 수식 키를 버리지 않는다) ──
      // 정렬을 저장한 뒤의 새로 세우기가 열린 패널을 닫을 수 있다 — 그 규칙이 보일 때까지 다시 연다(#253 의 전체 판이 부하에서 찾았다)
      const sortRuleShown = `(document.querySelector('[data-testid="db-sort-rule"] select[aria-label="정렬 속성"]')?.value ?? '') === ${JSON.stringify(amount)}`
      for (let i = 0; i < 5 && !(await evaluate(sortRuleShown)); i += 1) {
        if (!(await evaluate(`!!document.querySelector('[data-testid="db-sort-rule"]')`))) await clickOn('[data-testid="db-sort-button"]')
        await waitFor(sortRuleShown, 1500)
      }
      check('★ 정렬 패널에 수식 정렬이 남는다',
        await waitFor(sortRuleShown, 5000),
        await evaluate(`document.querySelector('[data-testid="db-sort-rule"]')?.textContent ?? null`))
      await key('Escape')

      await send('Page.reload')
      check('새로고침해도 같다(서버가 수식 값의 캐시로 거르고 정렬한다)',
        await waitFor(`${titlesJs} === '다,나'`, 15000), await evaluate(titlesJs))
    }

    if (sectionIf('표 변경 알림 — 서버 (2k-1 · F-04-24)')) {
      // 표를 보는 사람에게 "바뀌었다"를 흘리는 SSE — 준비됨 · 칸을 고치면 바뀌었다 · 볼 수 없는 표는 404 · 권한이 회수되면 회수됨으로 닫힌다.
      const stamp = Date.now()
      const api = async (method, path, body, headers = authed) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      /** SSE 를 연다 — 이벤트 이름을 차례로 모은다. */
      const openFeed = async (dataSourceId, headers = authed) => {
        const controller = new AbortController()
        // 감싸지 않은 fetch — 감싼 것은 본문을 끝까지 읽어서(파일 머리 `rawFetch`) 끝나지 않는 SSE 에서 멈춘다
        const res = await rawFetch(`${BASE}/api/workspaces/${workspaceId}/data-sources/${dataSourceId}/changes`, { headers, signal: controller.signal })
        const events = []
        let ended = false
        if (res.ok && res.body) {
          ;(async () => {
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            try {
              for (;;) {
                const { value, done } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                let at
                while ((at = buffer.indexOf('\n\n')) >= 0) {
                  const chunk = buffer.slice(0, at)
                  buffer = buffer.slice(at + 2)
                  const name = /^event: (.+)$/m.exec(chunk)?.[1]
                  if (name) events.push(name)
                }
              }
            } catch {
              // 닫았다
            }
            ended = true
          })()
        }
        const waitEvent = async (name, ms = 5000) => {
          for (let t = 0; t < ms; t += 50) {
            if (events.includes(name)) return true
            await sleep(50)
          }
          return false
        }
        return { status: res.status, type: res.headers.get('content-type'), events, waitEvent, ended: () => ended, close: () => controller.abort() }
      }

      const db = (await api('POST', '/databases', { name: `알림 ${stamp}` })).body.database
      const view = db.defaultViewId
      const qty = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '수량', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const row = (await api('POST', `/views/${view}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun('가')] } }] })).body.row.id

      const feed = await openFeed(db.dataSourceId)
      check('★ 표를 보는 사람은 구독한다 — SSE · 준비됨', feed.status === 200 && (feed.type ?? '').startsWith('text/event-stream') && (await feed.waitEvent('ready')),
        JSON.stringify({ status: feed.status, type: feed.type, events: feed.events }))
      await api('PATCH', `/rows/${row}`, { cells: [{ propertyId: qty, value: { type: 'number', number: 5 } }] })
      check('★ 칸을 고치면 "바뀌었다"가 온다(무엇이 바뀌었는지는 싣지 않는다)', await feed.waitEvent('changed'), JSON.stringify(feed.events))
      feed.close()

      // 볼 수 없는 표 — 404(존재를 알리지 않는다) · 볼 수 있다가 회수되면 회수됨으로 닫힌다
      const mate = await joinAs(workspaceId, await createUser(`알림 동료 ${stamp}`), 'member')
      const mateHeaders = { ...authed, cookie: `nc_session=${mate.token}` }
      const mateFeed = await openFeed(db.dataSourceId, mateHeaders)
      check('동료도 표를 볼 수 있으면 구독한다', await mateFeed.waitEvent('ready'), JSON.stringify(mateFeed.events))
      const access = (body) => api('POST', `/pages/${db.id}/access`, body)
      await access({ action: 'restrict' })
      await access({ action: 'grant', principal: { type: 'user', id: ctx.userId }, level: 'full_access' })
      await access({ action: 'revoke', principal: { type: 'workspace_everyone' } })
      check('★ 권한을 잃으면 서버가 "회수됨"을 보내고 닫는다', (await mateFeed.waitEvent('revoked', 8000)) && (await (async () => {
        for (let t = 0; t < 3000 && !mateFeed.ended(); t += 50) await sleep(50)
        return mateFeed.ended()
      })()), JSON.stringify(mateFeed.events))
      const denied = await openFeed(db.dataSourceId, mateHeaders)
      check('★ 볼 수 없는 표는 404', denied.status === 404, String(denied.status))
      denied.close()
    }

    if (sectionIf('표 변경 알림 — 화면 (2k-2 · F-04-24)')) {
      // 다른 곳(API)에서 바꾸면 새로고침 없이 표가 맞춰진다 — 새 행 · 제목 · 집계 · 뷰 필터. 내가 고쳐 조건 밖이 된 행은 남고 "조건 밖", 남이
      // 고쳐 나간 행은 빠진다. 편집 중에는 미뤘다가 끝나면 맞춘다. 남이 속성을 더하면 표가 새로 선다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const db = (await api('POST', '/databases', { name: `실시간 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const qty = (await api('POST', props, { name: '수량', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const rowOf = async (t, n) => (await api('POST', `/views/${view}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }, { propertyId: qty, value: { type: 'number', number: n } }],
      })).body.row.id
      const ga = await rowOf('가', 3)
      const na = await rowOf('나', 30)
      await api('PATCH', `/views/${view}/columns/${titleProp}`, { calculation: 'count_all' })
      const titlesJs = `[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '').join(',')`
      const titles = () => evaluate(titlesJs)
      const footerJs = `document.querySelector('[data-testid="db-table"] tfoot td[data-property-id="${titleProp}"]')?.textContent ?? ''`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`${titlesJs} === '가,나'`, 15000)
      await sleep(800) // 구독이 붙을 때까지

      // ── 새 행 · 제목 · 집계 ──
      const da = await rowOf('다', 12)
      check('★ 다른 곳에서 행을 더하면 새로고침 없이 선다 · 열 집계도(3)',
        await waitFor(`${titlesJs} === '가,나,다' && (${footerJs}).includes('3')`, 8000),
        JSON.stringify({ titles: await titles(), footer: await evaluate(footerJs) }))
      await api('PATCH', `/rows/${na}`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun('나!')] } }] })
      check('★ 다른 곳에서 제목을 고치면 따라 바뀐다', await waitFor(`${titlesJs} === '가,나!,다'`, 8000), await titles())

      // ── 뷰 필터가 바뀌면 행이 맞춰진다(수량 > 10) ──
      await api('PATCH', `/views/${view}`, { filter: { property_id: qty, operator: 'greater_than', value: 10 } })
      check('★ 뷰의 필터가 바뀌면 행이 맞춰진다(가 빠짐)', await waitFor(`${titlesJs} === '나!,다'`, 8000), await titles())

      // ── 내가 고쳐 조건 밖이 된 행은 남고 "조건 밖" ──
      await clickOn(`tr[data-row-id="${da}"] td[data-property-id="${qty}"]`)
      await key('Enter')
      if (await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 5000)) {
        await evaluate(`document.querySelector('[data-testid="db-cell-input"]').select()`)
        await typeText('5')
        await key('Enter')
      }
      check('★ 내가 고쳐 조건 밖이 된 행은 바로 지우지 않는다 — "조건 밖"을 단다',
        await waitFor(`!!document.querySelector('tr[data-row-id="${da}"] [data-testid="db-row-outside"]')`, 8000) && (await titles()).includes('다'),
        await titles())
      await api('PATCH', `/rows/${na}`, { cells: [{ propertyId: qty, value: { type: 'number', number: 1 } }] })
      check('★ 남이 고쳐 조건 밖이 된 행은 빠진다', await waitFor(`!document.querySelector('tr[data-row-id="${na}"]')`, 8000), await titles())

      // ── 편집 중에는 미뤘다가 끝나면 맞춘다 ──
      await api('PATCH', `/views/${view}`, { filter: null })
      await waitFor(`!!document.querySelector('tr[data-row-id="${ga}"]')`, 8000)
      await clickOn(`tr[data-row-id="${ga}"] td[data-property-id="${titleProp}"]`)
      await key('Enter')
      const editing = await waitFor(`document.activeElement?.matches('[data-testid="db-cell-input"]')`, 5000)
      const ra = await rowOf('라', 50)
      await sleep(1500)
      check('★ 편집 중에는 다시 읽지 않는다 — 편집칸이 그대로 · 새 행은 아직',
        editing && (await evaluate(`document.activeElement?.matches('[data-testid="db-cell-input"]')`)) && !(await evaluate(`!!document.querySelector('tr[data-row-id="${ra}"]')`)),
        await titles())
      await key('Escape')
      check('편집이 끝나면 맞춘다 — 새 행(라)이 선다', await waitFor(`!!document.querySelector('tr[data-row-id="${ra}"]')`, 8000), await titles())

      // ── 남이 속성을 더하면 표가 새로 선다 ──
      await api('POST', props, { name: '메모', type: 'rich_text' })
      check('★ 남이 속성을 더하면 표가 새로 선다(머리에 메모)',
        await waitFor(`[...document.querySelectorAll('[data-testid="db-table"] thead th[data-property-id]')].some((th) => th.textContent.includes('메모'))`, 10000))

      // ── 구독이 붙기 전의 변경(#250) — 변경 알림 주소를 막은 채 표를 열고, 남이 행을 더한 뒤 막음을 푼다. 다시 붙은 구독이 그 사이의
      // 변경을 따라와야 한다(고치기 전에는 첫 `ready` 를 "바뀌었다"로 치지 않아 따라오지 못했다 — #249 의 전체 e2e 가 부하에서 찾은 틈)
      // 막지 않고 **붙잡는다**(`Fetch`) — 막으면(`setBlockedURLs`) EventSource 가 다시 붙지 않고 닫힌다. 붙잡힌 요청은 놓을 때 서버에 닿는다
      await send('Fetch.enable', { patterns: [{ urlPattern: '*/changes*', requestStage: 'Request' }] })
      try {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('tr[data-row-id="${ra}"]')`, 15000)
        for (let i = 0; i < 100 && pausedCount() === 0; i += 1) await sleep(50)
        const ma = await rowOf('마', 60)
        await sleep(800)
        check('전제 — 구독이 붙잡혀 있는 동안에는 따라오지 않는다',
          pausedCount() > 0 && !(await evaluate(`!!document.querySelector('tr[data-row-id="${ma}"]')`)), JSON.stringify([pausedCount(), await titles()]))
        await send('Fetch.disable')
        await releasePaused()
        check('★ 구독이 붙기 전에 더한 행도 구독이 붙으면 따라온다 — 서버가 렌더 시각 뒤의 변경을 곧바로 알린다(#250)',
          await waitFor(`!!document.querySelector('tr[data-row-id="${ma}"]')`, 15000), await titles())
      } finally {
        await send('Fetch.disable').catch(() => undefined)
        await releasePaused()
      }
    }

    if (sectionIf('표 변경 알림 — 보드 · 갤러리 · 캘린더 (2k-3 · F-04-24)')) {
      // 다른 곳(API)에서 바꾸면 보드의 카드가 서고 · 열을 옮기고, 갤러리의 카드가 서고, 캘린더의 막대가 선다 — 새로고침 없이.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `실시간 카드 ${stamp}` })).body.database
      const view = db.defaultViewId
      const props = `/data-sources/${db.dataSourceId}/properties`
      const done = (await api('POST', props, { name: '완료', type: 'checkbox' })).body.property.id
      const due = (await api('POST', props, { name: '마감', type: 'date' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const rowOf = async (t, checked, day) => (await api('POST', `/views/${view}/rows`, {
        cells: [
          { propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } },
          { propertyId: done, value: { type: 'checkbox', checkbox: checked } },
          { propertyId: due, value: { type: 'date', date: { start: day } } },
        ],
      })).body.row.id
      const ga = await rowOf('가', false, '2026-03-05')
      await rowOf('나', true, '2026-03-06')
      const board = (await api('POST', `/databases/${db.id}/views`, { name: '보드', type: 'board', groupBy: { property_id: done } })).body.view.id
      const gallery = (await api('POST', `/databases/${db.id}/views`, { name: '갤러리', type: 'gallery' })).body.view.id
      const calendar = (await api('POST', `/databases/${db.id}/views`, { name: '캘린더', type: 'calendar' })).body.view.id
      const cardIn = (key, rowId) => `!!document.querySelector('[data-testid="db-board-column"][data-group-key="${key}"] [data-testid="db-board-card"][data-row-id="${rowId}"]')`

      // ── 보드 ──
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${board}` })
      await waitFor(cardIn('false', ga), 15000)
      await sleep(800) // 구독이 붙을 때까지
      const da = await rowOf('다', true, '2026-03-07')
      check('★ 보드 — 다른 곳에서 행을 더하면 그 열에 카드가 선다', await waitFor(cardIn('true', da), 8000))
      await api('PATCH', `/rows/${ga}`, { cells: [{ propertyId: done, value: { type: 'checkbox', checkbox: true } }] })
      check('★ 보드 — 다른 곳에서 값을 바꾸면 카드가 열을 옮긴다', await waitFor(`${cardIn('true', ga)} && !${cardIn('false', ga)}`, 8000))

      // ── 갤러리 ──
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${gallery}` })
      await waitFor(`document.querySelectorAll('[data-testid="db-gallery-card"]').length === 3`, 15000)
      await sleep(800)
      const ra = await rowOf('라', false, '2026-03-08')
      check('★ 갤러리 — 다른 곳에서 행을 더하면 카드가 선다', await waitFor(`!!document.querySelector('[data-testid="db-gallery-card"][data-row-id="${ra}"]')`, 8000))

      // ── 캘린더 ──
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}?v=${calendar}&m=2026-03` })
      await waitFor(`!!document.querySelector('[data-testid="db-cal-event"][data-row-id="${ra}"]')`, 15000)
      await sleep(800)
      const ma = await rowOf('마', false, '2026-03-20')
      check('★ 캘린더 — 다른 곳에서 행을 더하면 그 날에 막대가 선다', await waitFor(`!!document.querySelector('[data-testid="db-cal-event"][data-row-id="${ma}"]')`, 8000))
    }

    if (sectionIf('연결된 데이터베이스 — 서버 (2l-1 · F-04-13)')) {
      // 다른 데이터베이스의 소스를 붙이면 그 소스를 보는 뷰가 생기고 원본의 행이 보인다 · 두 번 붙이면 409 · 떼면 뷰와 함께 빠진다 · 제 소스는 떼지 않는다.
      // 권한(원본을 못 보면 붙일 수 없음 · 이름을 가림 · 링크로 권한이 오르지 않음)은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const original = (await api('POST', '/databases', { name: `원본 ${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${original.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      await api('POST', `/views/${original.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun('원본의 행')] } }] })
      const container = (await api('POST', '/databases', { name: `대시보드 ${stamp}` })).body.database

      const linked = await api('POST', `/databases/${container.id}/linked-sources`, { dataSourceId: original.dataSourceId })
      check('★ 다른 데이터베이스의 소스를 붙인다(201 · 소유 아님 · 그 소스를 보는 뷰)',
        linked.status === 201 && linked.body?.dataSource?.owned === false && typeof linked.body?.viewId === 'string', JSON.stringify(linked))
      const rows = await api('GET', `/views/${linked.body?.viewId}/rows`)
      check('★ 붙인 뷰로 원본의 행이 보인다', (rows.body?.rows ?? []).map((r) => r.title).join() === '원본의 행', JSON.stringify(rows.body?.rows))
      const twice = await api('POST', `/databases/${container.id}/linked-sources`, { dataSourceId: original.dataSourceId })
      check('두 번 붙이면 409', twice.status === 409 && twice.body?.error === 'already_attached', JSON.stringify(twice))
      const owned = await api('DELETE', `/databases/${container.id}/linked-sources/${container.dataSourceId}`)
      check('제 소스는 떼지 않는다(409)', owned.status === 409 && owned.body?.error === 'owned_source', JSON.stringify(owned))
      const detached = await api('DELETE', `/databases/${container.id}/linked-sources/${original.dataSourceId}`)
      const after = await api('GET', `/databases/${container.id}/data-sources`)
      const gone = await api('GET', `/views/${linked.body?.viewId}`)
      check('★ 떼면 그 소스와 뷰가 빠진다 — 원본은 그대로',
        detached.status === 200 && (after.body?.dataSources ?? []).map((d) => d.id).join() === container.dataSourceId && gone.status === 404
          && ((await api('GET', `/views/${original.defaultViewId}/rows`)).body?.rows ?? []).length === 1,
        JSON.stringify({ detached: detached.status, after: after.body?.dataSources, gone: gone.status }))
    }

    if (sectionIf('붙인 뷰의 권한 — 서버 (2l-2 · F-04-13)')) {
      // 원본을 못 보게 된 동료에게 붙인 뷰는 없는 것과 같다 — 뷰 · 행 API 가 404 이고, 그 뷰를 가리키는 주소는 그릇의 제 뷰로 열린다(원본의
      // 행 · 속성 이름이 화면에 없다). 볼 수 있는 사람에게는 그대로 열린다. 보드 · 캘린더 · 개인 필터 · 뷰 고치기는 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body, headers = authed) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const original = (await api('POST', '/databases', { name: `숨을 원본 ${stamp}` })).body.database
      const secretProp = `기밀속성${stamp}`
      await api('POST', `/data-sources/${original.dataSourceId}/properties`, { name: secretProp, type: 'text' })
      const titleProp = (await api('GET', `/views/${original.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const secretRow = `기밀행${stamp}`
      await api('POST', `/views/${original.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(secretRow)] } }] })
      const container = (await api('POST', '/databases', { name: `함께 보는 그릇 ${stamp}` })).body.database
      const linkedView = (await api('POST', `/databases/${container.id}/linked-sources`, { dataSourceId: original.dataSourceId })).body?.viewId

      const mate = await joinAs(workspaceId, await createUser(`붙인 뷰 동료 ${stamp}`), 'member')
      const asMate = { ...authed, cookie: `nc_session=${mate.token}` }
      const before = await api('GET', `/views/${linkedView}`, undefined, asMate)
      check('볼 수 있을 때는 동료에게도 붙인 뷰가 열린다', before.status === 200, String(before.status))

      const aclMod = await import(new URL('../src/lib/permissions/acl.ts', import.meta.url).href)
      const hidden = [
        await aclMod.stopInheriting(ctx, original.id),
        await aclMod.grantAccess(ctx, original.id, { type: 'user', id: ctx.userId }, 'full_access'),
        await aclMod.revokeAccess(ctx, original.id, { type: 'workspace_everyone', id: null }),
      ].every((r) => r.ok)
      const view = await api('GET', `/views/${linkedView}`, undefined, asMate)
      const rows = await api('GET', `/views/${linkedView}/rows`, undefined, asMate)
      check('★ 원본을 못 보게 되면 붙인 뷰 · 그 행이 없는 것과 같다(404 — 컬럼은 원본의 스키마다)',
        hidden && view.status === 404 && rows.status === 404 && !JSON.stringify([view.body, rows.body]).includes(secretProp),
        JSON.stringify({ hidden, view: view.status, rows: rows.status }))
      const mateHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${container.id}?v=${linkedView}`, { headers: { cookie: asMate.cookie } })).text()
      check('★ 그 뷰를 가리키는 주소는 그릇의 제 뷰로 열린다 — 원본의 행 · 속성 이름이 없다',
        mateHtml.includes('data-testid="db-view-tab"') && !mateHtml.includes(secretRow) && !mateHtml.includes(secretProp),
        JSON.stringify([mateHtml.includes('data-testid="db-view-tab"'), mateHtml.includes(secretRow), mateHtml.includes(secretProp)]))
      const ownerHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${container.id}?v=${linkedView}`, { headers: { cookie: authed.cookie } })).text()
      check('볼 수 있는 사람에게는 그 뷰가 그대로 열린다 — 원본의 행이 보인다', ownerHtml.includes(secretRow), String(ownerHtml.length))
    }

    if (sectionIf('연결된 데이터베이스 — 화면 (2l-3 · F-04-13)')) {
      // "데이터 소스" 창에서 다른 데이터베이스의 소스를 골라 붙이면 그 탭으로 옮기고 원본의 행이 보인다 · 연결 표시와 원본으로 가는 길 ·
      // 원본을 볼 수만 있는 동료에게는 칸 · 새 행이 닫힌다(그릇과 원본의 교집합) · 원본을 못 보는 동료에게는 그 탭이 "접근 권한 없음" ·
      // 떼면 그 탭이 사라지고 원본은 그대로다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const api = async (method, path, body, headers = authed) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const original = (await api('POST', '/databases', { name: `연결원본${stamp}` })).body.database
      const titleProp = (await api('GET', `/views/${original.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const originRow = `원본행${stamp}`
      await api('POST', `/views/${original.defaultViewId}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(originRow)] } }] })
      const container = (await api('POST', '/databases', { name: `연결그릇${stamp}` })).body.database
      const PANEL = '[data-testid="db-sources-panel"]'
      const LINKED = `${PANEL} [data-testid="db-source-item"][data-source-id="${original.dataSourceId}"]`
      const openPanel = async () => {
        for (let i = 0; i < 5; i += 1) {
          if (await evaluate(`!!document.querySelector('${PANEL}')`)) return true
          await clickSelector('[data-testid="db-sources-button"]')
          if (await waitFor(`!!document.querySelector('${PANEL}')`, 1500)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${container.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-sources-button"]')`, 15000)
      await openPanel()
      await clickSelector('[data-testid="db-source-link"]')
      const OPTION = (id) => `[data-testid="db-source-link-select"] option[value="${id}"]`
      check('★ "다른 데이터베이스 연결" — 볼 수 있는 데이터베이스의 소스가 고르개에 서고 · 이 데이터베이스의 것은 없다',
        (await waitFor(`!!document.querySelector('${OPTION(original.dataSourceId)}')`, 5000))
          && !(await evaluate(`!!document.querySelector('${OPTION(container.dataSourceId)}')`)),
        await evaluate(`document.querySelector('[data-testid="db-source-link-picker"]')?.textContent?.slice(0, 200) ?? '(고르개 없음)'`))
      await setSelect('[data-testid="db-source-link-select"]', original.dataSourceId)
      await clickSelector('[data-testid="db-source-link-confirm"]')
      const linkedView = await (async () => {
        for (let i = 0; i < 60; i += 1) {
          const views = (await api('GET', `/databases/${container.id}/views`)).body?.views ?? []
          const found = views.find((v) => v.dataSourceId === original.dataSourceId)
          if (found) return found.id
          await new Promise((r) => setTimeout(r, 250))
        }
        return null
      })()
      check('★ 연결하면 그 소스를 보는 새 탭으로 옮기고 원본의 행이 보인다',
        linkedView !== null
          && (await waitFor(`location.search.includes(${JSON.stringify(`v=${linkedView}`)}) && document.querySelector('main')?.textContent.includes(${JSON.stringify(originRow)})`, 15000)),
        JSON.stringify([linkedView, await evaluate('location.search')]))
      check('★ 탭 줄 위에 원본의 소스 이름과 "연결된 소스 — 원본 열기"가 선다(원본 데이터베이스로 간다)',
        await waitFor(`document.querySelector('[data-testid="db-source-original-link"]')?.getAttribute('href') === ${JSON.stringify(`/w/${workspaceId}/db/${original.id}`)}`, 5000),
        await evaluate(`document.querySelector('[data-testid="db-source-name"]')?.textContent ?? '(없음)'`))
      await openPanel()
      check('★ 창의 붙인 소스 — "연결됨" · "원본" · 떼기가 서고, 이름 칸 · 휴지통은 없다(원본의 것이다)',
        (await waitFor(`!!document.querySelector('${LINKED} [data-testid="db-source-linked"]')`, 5000))
          && (await evaluate(`document.querySelector('${LINKED} [data-testid="db-source-original"]')?.getAttribute('href') === ${JSON.stringify(`/w/${workspaceId}/db/${original.id}`)}
            && !!document.querySelector('${LINKED} [data-testid="db-source-detach"]')
            && !document.querySelector('${LINKED} input') && !document.querySelector('${LINKED} [data-testid="db-source-trash"]')`)),
        await evaluate(`document.querySelector('${LINKED}')?.outerHTML?.slice(0, 300) ?? '(줄 없음)'`))
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

      // 권한 — 원본을 볼 수만 있는 동료(그릇은 고칠 수 있다): 칸 · 새 행이 닫힌다 / 원본을 못 보는 동료: "접근 권한 없음"
      const aclMod = await import(new URL('../src/lib/permissions/acl.ts', import.meta.url).href)
      const mate = await joinAs(workspaceId, await createUser(`연결 화면 동료 ${stamp}`), 'member')
      const asMate = { cookie: `nc_session=${mate.token}` }
      const restricted = [
        await aclMod.stopInheriting(ctx, original.id),
        await aclMod.grantAccess(ctx, original.id, { type: 'user', id: ctx.userId }, 'full_access'),
        await aclMod.revokeAccess(ctx, original.id, { type: 'workspace_everyone', id: null }),
        await aclMod.grantAccess(ctx, original.id, { type: 'user', id: mate.userId }, 'view'),
      ].every((r) => r.ok)
      const readerHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${container.id}?v=${linkedView}`, { headers: asMate })).text()
      const ownHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${container.id}?v=${container.defaultViewId}`, { headers: asMate })).text()
      check('★ 원본을 볼 수만 있는 동료 — 붙인 뷰의 행은 보이고 칸은 읽기 전용 · 새 행 단추가 없다(그릇의 제 뷰에는 있다)',
        restricted && readerHtml.includes(originRow) && readerHtml.includes('aria-readonly="true"') && !readerHtml.includes('data-testid="db-add-row"')
          && ownHtml.includes('data-testid="db-add-row"'),
        JSON.stringify([restricted, readerHtml.includes(originRow), readerHtml.includes('aria-readonly="true"'), readerHtml.includes('data-testid="db-add-row"'), ownHtml.includes('data-testid="db-add-row"')]))
      const revoked = await aclMod.revokeAccess(ctx, original.id, { type: 'user', id: mate.userId })
      const blockedHtml = await (await fetch(`${BASE}/w/${workspaceId}/db/${container.id}?v=${linkedView}`, { headers: asMate })).text()
      // 탭 이름은 붙일 때 원본 소스의 이름을 받아 적은 그릇의 것이라 남는다(§3.2-139) — 소스 이름 줄은 원본의 것이라 가린다.
      check('★ 원본을 못 보는 동료 — 그 탭은 "접근 권한 없음"이다(탭 줄은 선다 · 소스 이름 줄도 "접근 권한 없음" · 원본의 행이 없다)',
        revoked.ok && blockedHtml.includes('data-testid="db-no-access"') && blockedHtml.includes('data-testid="db-view-tab"')
          && blockedHtml.includes('data-testid="db-source-name">접근 권한 없음') && !blockedHtml.includes(originRow),
        JSON.stringify([revoked.ok, blockedHtml.includes('data-testid="db-no-access"'), blockedHtml.includes('data-testid="db-view-tab"'),
          blockedHtml.includes('data-testid="db-source-name">접근 권한 없음'), blockedHtml.includes(originRow)]))

      // 떼기 — 창에서 한 번 더 묻고, 그 탭이 사라지며 그릇의 첫 뷰로 간다 · 원본은 그대로
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${container.id}?v=${linkedView}` })
      await waitFor(`!!document.querySelector('[data-testid="db-sources-button"]')`, 15000)
      await openPanel()
      await clickSelector(`${LINKED} [data-testid="db-source-detach"]`)
      const asked = await waitFor(`!!document.querySelector('[data-testid="db-source-detach-ask"]')`, 3000)
      await clickSelector('[data-testid="db-source-detach-confirm"]')
      const detached = await waitFor(`!location.search.includes(${JSON.stringify(linkedView)}) && document.querySelectorAll('[data-testid="db-view-tab"]').length === 1`, 15000)
      const after = (await api('GET', `/databases/${container.id}/data-sources`)).body?.dataSources ?? []
      const originRows = (await api('GET', `/views/${original.defaultViewId}/rows`)).body?.rows ?? []
      check('★ 떼기 — 한 번 더 묻고, 그 탭이 사라지며 그릇의 첫 뷰로 간다 · 원본의 행은 그대로',
        asked && detached && after.map((d) => d.id).join() === container.dataSourceId && originRows.map((r) => r.title).join() === originRow,
        JSON.stringify({ asked, detached, after: after.map((d) => d.id), originRows: originRows.length }))
    }

    if (sectionIf('제목 아래 고정 — 서버 (3a-1 · F-16-02)')) {
      // 레이아웃 적용(PUT …/layout)이 고정을 받는다 — 순서대로 서고, 주지 않으면 그대로다 · 16개는 400 too_many_pinned · 제목은 400.
      // 숨김과의 관계 · 지운 속성 · 행 페이지는 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const table = (await api('POST', '/databases', { name: `고정 ${stamp}` })).body.database
      const ids = []
      for (let i = 0; i < 16; i += 1) {
        const added = await api('POST', `/data-sources/${table.dataSourceId}/properties`, { name: `칸${i}`, type: 'number' })
        ids.push(added.body?.property?.id)
      }
      const titleProp = (await api('GET', `/views/${table.defaultViewId}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const layoutUrl = `/data-sources/${table.dataSourceId}/layout`

      const pinned = await api('PUT', layoutUrl, { version: '0', order: [], hidden: [], pinned: [ids[2], ids[0]] })
      check('★ 고정을 적용하면 그 순서대로 선다(스키마 순서가 아니다)',
        pinned.status === 200 && JSON.stringify(pinned.body?.layout?.pinned) === JSON.stringify([ids[2], ids[0]]) && pinned.body?.layout?.version === '1',
        JSON.stringify(pinned))
      const kept = await api('PUT', layoutUrl, { version: '1', order: [], hidden: [] })
      check('고정을 주지 않으면 그대로다', kept.status === 200 && kept.body?.changed === false && kept.body?.layout?.pinned?.length === 2, JSON.stringify(kept))
      const tooMany = await api('PUT', layoutUrl, { version: '1', order: [], hidden: [], pinned: ids })
      const title = await api('PUT', layoutUrl, { version: '1', order: [], hidden: [], pinned: [titleProp] })
      check('★ 16개를 고정하면 400 too_many_pinned · 제목을 고정하면 400 invalid_layout',
        tooMany.status === 400 && tooMany.body?.error === 'too_many_pinned' && title.status === 400 && title.body?.error === 'invalid_layout',
        JSON.stringify({ tooMany: [tooMany.status, tooMany.body?.error], title: [title.status, title.body?.error] }))
    }

    if (sectionIf('제목 아래 고정 — 화면 (3a-2 · F-16-02)')) {
      // 레이아웃 편집 모드에서 "고정"을 누르면 속성이 "제목 아래" 목록으로 옮겨 가고(포커스가 따라간다), 그 안에서 순서를 바꾼다. 적용하면
      // 제목 아래에 가로 줄로 서고 속성 묶음에서 빠진다 · 그 줄에서 값을 고친다 · 숨긴 속성을 고정하면 보인다 · 풀면 묶음의 스키마 자리로
      // 돌아온다 · 15개가 차면 핀이 꺼지고 까닭을 말한다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: `고정화면${stamp}`, privateTop: true }) }))).body?.database
      const ds = created?.dataSourceId
      const viewId = created?.defaultViewId
      const addProp = async (name, type) => (await readRes(await fetch(`${api}/data-sources/${ds}/properties`, { method: 'POST', headers: authed, body: JSON.stringify({ name, type }) }))).body
      await addProp('수량', 'number')
      await addProp('메모', 'rich_text')
      const props = (await addProp('마감', 'date'))?.schema?.properties ?? []
      const idOf = (name) => props.find((p) => p.name === name)?.id
      const rowId = (await readRes(await fetch(`${api}/views/${viewId}/rows`, { method: 'POST', headers: authed, body: JSON.stringify({ cells: [
        { propertyId: idOf('이름'), value: { type: 'title', title: [textRun('고정할 행')] } },
        { propertyId: idOf('수량'), value: { type: 'number', number: 7 } },
      ] }) }))).body?.row?.id

      const idsExpr = (testId) => `[...document.querySelectorAll('[data-testid="${testId}"] td[data-property-id]')].map((td) => td.getAttribute('data-property-id'))`
      const idsIn = (testId) => evaluate(idsExpr(testId))
      const listIds = (testId) => evaluate(`[...document.querySelectorAll('[data-testid="${testId}"] [data-testid="row-layout-item"]')].map((li) => li.getAttribute('data-property-id'))`)
      const item = (name, testId) => `[data-testid="row-layout-item"][data-property-id="${idOf(name)}"] [data-testid="${testId}"]`
      const ids = (...names) => JSON.stringify(names.map(idOf))
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const pinnedOnServer = async () =>
        (await dbQuery(`SELECT m.property_id FROM layout_module m WHERE m.data_source_id = $1 AND m.kind = 'property' AND m.area = 'heading' ORDER BY m.order_idx`, [ds])).map((r) => r.property_id)
      const openEditor = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await has('[data-testid="row-layout-editor"]')) return true
          await clickSelector('[data-testid="row-layout-edit"]')
          if (await waitFor(`!!document.querySelector('[data-testid="row-layout-editor"]')`, 1500)) return true
        }
        return false
      }
      const openRow = async () => {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${rowId}` })
        return waitFor(`!!document.querySelector('[data-testid="row-layout-edit"]') && !!document.querySelector('[data-testid="row-title"]')`, 15000)
      }

      await openRow()
      await openEditor()
      check('편집 모드 — "제목 아래 고정"은 비어 있고(0 / 15) 속성은 모두 묶음에 있다',
        (await has('[data-testid="row-layout-pinned-empty"]')) && JSON.stringify(await listIds('row-layout-group')) === ids('수량', '메모', '마감'),
        JSON.stringify(await listIds('row-layout-group')))
      await clickSelector(item('마감', 'row-layout-pin'))
      check('★ "고정"을 누르면 그 속성이 "제목 아래"로 옮겨 가고 포커스가 그 줄의 "풀기"로 따라간다',
        JSON.stringify(await listIds('row-layout-pinned')) === ids('마감')
          && (await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(item('마감', 'row-layout-unpin'))})`)),
        JSON.stringify([await listIds('row-layout-pinned'), await evaluate(`document.activeElement?.getAttribute('aria-label')`)]))
      await clickSelector(item('수량', 'row-layout-pin'))
      await clickSelector(`[data-testid="row-layout-pinned"] ${item('수량', 'row-layout-up')}`)
      check('제목 아래 안에서 순서를 바꾼다 — 스키마 순서가 아니다(서버는 아직 그대로)',
        JSON.stringify(await listIds('row-layout-pinned')) === ids('수량', '마감') && JSON.stringify(await listIds('row-layout-group')) === ids('메모')
          && (await pinnedOnServer()).length === 0,
        JSON.stringify([await listIds('row-layout-pinned'), await listIds('row-layout-group')]))

      await clickSelector('[data-testid="row-layout-apply"]')
      check('★ 적용하면 제목 아래에 그 순서로 서고 값이 보인다 · 속성 묶음에서는 빠진다',
        await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]')
          && JSON.stringify(${idsExpr('row-pinned-properties')}) === ${JSON.stringify(ids('수량', '마감'))}
          && JSON.stringify(${idsExpr('row-visible-properties')}) === ${JSON.stringify(ids('메모'))}
          && (document.querySelector('[data-testid="row-pinned-properties"] td[data-property-id="${idOf('수량')}"]')?.textContent ?? '').includes('7')`, 15000),
        JSON.stringify([await idsIn('row-pinned-properties'), await idsIn('row-visible-properties')]))
      check('서버 — 고정이 heading 의 순서로 남았다', JSON.stringify(await pinnedOnServer()) === ids('수량', '마감'), JSON.stringify(await pinnedOnServer()))
      check('제목 아래 줄은 가로다 — 둘째 칸이 첫 칸의 오른쪽에 있다(같은 줄)',
        await evaluate(`(() => { const tds = [...document.querySelectorAll('[data-testid="row-pinned-properties"] td[data-property-id]')].map((td) => td.getBoundingClientRect())
          return tds.length === 2 && tds[1].left > tds[0].left && Math.abs(tds[1].top - tds[0].top) < 2 })()`))

      // 제목 아래 줄에서 값을 고친다 — 같은 셀 편집기
      const qtyCell = `[data-testid="row-pinned-properties"] td[data-property-id="${idOf('수량')}"]`
      await clickSelector(qtyCell)
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await waitFor(`!!document.querySelector('[data-testid="db-cell-input"]')`, 3000)
      // 편집기는 지금 값(7)을 들고 열린다 — 모두 골라 바꾼다
      await evaluate(`document.querySelector('[data-testid="db-cell-input"]')?.select()`)
      await typeText('12')
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      const savedQty = async () => (await dbQuery(`SELECT num_value::float AS n FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [rowId, idOf('수량')]))[0]?.n ?? null
      let qty = null
      for (let i = 0; i < 20 && qty !== 12; i += 1) { await sleep(250); qty = await savedQty() }
      check('★ 제목 아래 줄에서 값을 고치면 저장된다', qty === 12, String(qty))

      // 숨긴 속성을 고정하면 보인다 · 고정을 풀면 묶음의 스키마 자리로 돌아온다
      await fetch(`${api}/data-sources/${ds}/layout`, { method: 'PUT', headers: authed, body: JSON.stringify({
        version: (await dbQuery(`SELECT version::text AS v FROM page_layout WHERE data_source_id = $1`, [ds]))[0]?.v, order: [], hidden: [idOf('메모')] }) })
      await openRow()
      await openEditor()
      await clickSelector(item('메모', 'row-layout-pin'))
      await clickSelector(item('수량', 'row-layout-unpin'))
      check('★ 숨긴 속성을 고정하면 보이는 것이 되고 · 푼 속성은 묶음의 스키마 자리로 돌아온다',
        JSON.stringify(await listIds('row-layout-pinned')) === ids('마감', '메모')
          && (await evaluate(`document.querySelector('[data-testid="row-layout-pinned"] [data-property-id="${idOf('메모')}"]')?.getAttribute('data-visible')`)) === 'true'
          && JSON.stringify(await listIds('row-layout-group')) === ids('수량'),
        JSON.stringify([await listIds('row-layout-pinned'), await listIds('row-layout-group')]))
      await clickSelector('[data-testid="row-layout-cancel"]')

      // 15개가 차면 핀이 꺼지고 까닭을 말한다
      for (let i = 0; i < 13; i += 1) await addProp(`칸${i}`, 'number')
      const all = (await dbQuery(`SELECT id FROM property WHERE data_source_id = $1 AND deleted_at IS NULL AND type <> 'title' ORDER BY order_idx, id`, [ds])).map((r) => r.id)
      const version = (await dbQuery(`SELECT version::text AS v FROM page_layout WHERE data_source_id = $1`, [ds]))[0]?.v
      const filled = await fetch(`${api}/data-sources/${ds}/layout`, { method: 'PUT', headers: authed, body: JSON.stringify({ version, order: [], hidden: [], pinned: all.slice(0, 15) }) })
      await openRow()
      await openEditor()
      const lastId = all[15]
      check('★ 15개가 차면 남은 속성의 "고정"이 꺼지고 까닭을 말한다(15 / 15)',
        filled.ok && (await evaluate(`document.querySelector('[data-testid="row-layout-item"][data-property-id="${lastId}"] [data-testid="row-layout-pin"]')?.disabled === true`))
          && (await has('[data-testid="row-layout-pin-full"]')),
        JSON.stringify([filled.status, await evaluate(`document.querySelector('[data-testid="row-layout-pin-full"]')?.textContent ?? null`)]))
      await clickSelector('[data-testid="row-layout-cancel"]')
    }

    if (sectionIf('페이지 설정 — 서버 (3b-1 · F-16-09 · F-16-10)')) {
      // 레이아웃 적용(PUT …/layout)이 페이지 설정을 받는다 — 준 칸만 바꾸고 나머지는 그대로 · 틀린 값은 400. 기본값 · 머리 · 숨김과의
      // 관계는 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const table = (await api('POST', '/databases', { name: `설정 ${stamp}` })).body.database
      const layoutUrl = `/data-sources/${table.dataSourceId}/layout`
      const wide = await api('PUT', layoutUrl, { version: '0', order: [], hidden: [], settings: { fullWidth: true, backlinks: 'off' } })
      const icons = await api('PUT', layoutUrl, { version: '1', order: [], hidden: [], settings: { showPropertyIcons: false } })
      check('★ 페이지 설정을 적용한다 — 준 칸만 바뀌고 나머지는 그대로다',
        wide.status === 200 && icons.status === 200
          && JSON.stringify(icons.body?.layout?.settings) === JSON.stringify({
            backlinks: 'off', inlineComments: 'default', showDiscussions: true, showPropertyIcons: false, fullWidth: true,
          }),
        JSON.stringify([wide.status, icons.body?.layout?.settings]))
      const bad = await api('PUT', layoutUrl, { version: '2', order: [], hidden: [], settings: { backlinks: 'sometimes' } })
      check('모르는 값은 400 invalid_layout', bad.status === 400 && bad.body?.error === 'invalid_layout', JSON.stringify(bad))
    }

    if (sectionIf('페이지 설정 — 화면 (3b-2 · F-16-09 · F-16-10)')) {
      // 레이아웃 편집 모드의 "페이지 설정"에서 다섯 칸을 바꾸고 적용하면 행 페이지가 따른다 — 화면 폭 · 백링크 펼침 · 코멘트 단추 없음 ·
      // 속성 아이콘 없음 · 옅은 코멘트 표시. 백링크 "보이지 않음"은 사라지고, 일반 페이지는 그대로다. 자기 데이터를 스스로 만든다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const created = (await readRes(await fetch(`${api}/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: `설정화면${stamp}`, privateTop: true }) }))).body?.database
      const ds = created?.dataSourceId
      const props = (await readRes(await fetch(`${api}/data-sources/${ds}/properties`, { method: 'POST', headers: authed, body: JSON.stringify({ name: '수량', type: 'number' }) }))).body?.schema?.properties ?? []
      const titleId = props.find((p) => p.type === 'title')?.id
      const rowId = (await readRes(await fetch(`${api}/views/${created?.defaultViewId}/rows`, { method: 'POST', headers: authed,
        body: JSON.stringify({ cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun('설정할 행')] } }] }) }))).body?.row?.id
      // 백링크 — 이 행을 멘션한 일반 페이지(투영이 쓰는 엣지를 바로 넣는다 · 멘션을 치는 길은 F-07-09 구간이 본다)
      const mentioner = (await readRes(await fetch(`${api}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ privateTop: true, title: `멘션한문서${stamp}` }) }))).body?.page?.id
      await dbQuery(`INSERT INTO link_edge (source_page_id, source_block_id, target_kind, target_id) VALUES ($1, gen_random_uuid(), 'page', $2)`, [mentioner, rowId])

      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const openRow = async () => {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${rowId}` })
        return waitFor(`!!document.querySelector('[data-testid="row-layout-edit"]') && !!document.querySelector('[data-testid="row-title"]')`, 15000)
      }
      const openEditor = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await has('[data-testid="row-layout-editor"]')) return true
          await clickSelector('[data-testid="row-layout-edit"]')
          if (await waitFor(`!!document.querySelector('[data-testid="row-layout-editor"]')`, 1500)) return true
        }
        return false
      }
      const looks = () => evaluate(`(() => {
        const main = document.querySelector('main')
        return {
          wide: main?.getAttribute('data-full-width') === 'true' && getComputedStyle(main).maxWidth === 'none',
          backlinks: document.querySelector('[data-testid="page-backlinks"]') ? (document.querySelector('[data-testid="page-backlinks"]').open ? 'open' : 'closed') : 'none',
          toggle: !!document.querySelector('[data-testid="comment-panel-toggle"]'),
          icons: !!document.querySelector('[data-testid="row-properties"] [data-testid="db-record-icon"]'),
          comments: main?.getAttribute('data-inline-comments') ?? null,
        }
      })()`)

      await openRow()
      check('처음에는 기본 — 좁게 · 백링크 접힘 · 코멘트 단추 · 속성 아이콘 · 칠한 코멘트',
        JSON.stringify(await looks()) === JSON.stringify({ wide: false, backlinks: 'closed', toggle: true, icons: true, comments: 'default' }),
        JSON.stringify(await looks()))

      await openEditor()
      await setSelect('[data-testid="row-layout-backlinks"]', 'always')
      await setSelect('[data-testid="row-layout-inline-comments"]', 'minimal')
      await clickSelector('[data-testid="row-layout-discussions"]')
      await clickSelector('[data-testid="row-layout-property-icons"]')
      await clickSelector('[data-testid="row-layout-full-width"]')
      check('편집 모드의 "페이지 설정" — 초안이 바뀌고 서버는 그대로다',
        (await evaluate(`[document.querySelector('[data-testid="row-layout-backlinks"]').value, document.querySelector('[data-testid="row-layout-inline-comments"]').value,
          document.querySelector('[data-testid="row-layout-discussions"]').checked, document.querySelector('[data-testid="row-layout-property-icons"]').checked,
          document.querySelector('[data-testid="row-layout-full-width"]').checked].join()`)) === 'always,minimal,false,false,true'
          && (await dbQuery(`SELECT 1 FROM page_layout WHERE data_source_id = $1`, [ds])).length === 0,
        String(await evaluate(`document.querySelector('[data-testid="row-layout-settings"]')?.textContent ?? '(없음)'`)))
      await clickSelector('[data-testid="row-layout-apply"]')
      // 적용 뒤 서버가 다시 그린 것을 기다린다 — 다섯 칸을 따로 본다(하나가 어긋나도 다른 칸의 검사는 그대로 선다)
      await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]') && document.querySelector('main')?.getAttribute('data-inline-comments') === 'minimal'`, 15000)
      const after = await looks()
      check('★ 적용하면 페이지가 화면 폭으로 펴진다', after.wide === true, JSON.stringify(after))
      check('★ 백링크가 펼쳐 보인다', after.backlinks === 'open', JSON.stringify(after))
      check('★ 머리의 "코멘트" 단추(토론)가 없다', after.toggle === false, JSON.stringify(after))
      check('속성 이름 앞의 유형 아이콘이 없다', after.icons === false, JSON.stringify(after))
      check('본문의 코멘트 표시가 "밑줄만"이다(표시 칸)', after.comments === 'minimal', JSON.stringify(after))
      const saved = (await dbQuery(`SELECT backlinks_mode, inline_comment_mode, show_discussions, show_property_icons, full_width FROM page_layout WHERE data_source_id = $1`, [ds]))[0]
      check('서버 — 다섯 칸이 레이아웃 머리에 남았다',
        JSON.stringify(saved) === JSON.stringify({ backlinks_mode: 'always', inline_comment_mode: 'minimal', show_discussions: false, show_property_icons: false, full_width: true }),
        JSON.stringify(saved))

      const version = (await dbQuery(`SELECT version::text AS v FROM page_layout WHERE data_source_id = $1`, [ds]))[0]?.v
      await fetch(`${api}/data-sources/${ds}/layout`, { method: 'PUT', headers: authed, body: JSON.stringify({ version, order: [], hidden: [], settings: { backlinks: 'off' } }) })
      await openRow()
      check('★ 백링크 "보이지 않음" — 멘션한 페이지가 있어도 백링크가 없다', (await looks()).backlinks === 'none', JSON.stringify(await looks()))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${mentioner}` })
      await waitFor(`!!document.querySelector('[data-testid="comment-panel-toggle"]')`, 15000)
      const plain = await evaluate(`[document.querySelector('main')?.getAttribute('data-full-width'), document.querySelector('main')?.getAttribute('data-inline-comments'), !!document.querySelector('[data-testid="comment-panel-toggle"]')].join()`)
      check('일반 페이지는 그대로다 — 레이아웃은 행의 것이다', plain === ',,true', plain)
    }

    if (sectionIf('본문 모듈 · 상세 패널 — 서버 (3c-1 · F-16-04 · F-16-05)')) {
      // 레이아웃 적용(PUT …/layout)이 본문 줄(main — 속성 묶음은 'property_group')과 패널(panel)을 받는다 — 그 순서로 선다 · 관계형을
      // 패널에 놓으면 400 panel_type · 한 속성을 두 자리에 놓으면 400. 자리 옮기기 · 지운 속성 · 행 페이지는 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const table = (await api('POST', '/databases', { name: `모듈 ${stamp}` })).body.database
      const target = (await api('POST', '/databases', { name: `모듈 대상 ${stamp}` })).body.database
      const memo = (await api('POST', `/data-sources/${table.dataSourceId}/properties`, { name: '메모', type: 'rich_text' })).body?.property?.id
      const qty = (await api('POST', `/data-sources/${table.dataSourceId}/properties`, { name: '수량', type: 'number' })).body?.property?.id
      const rel = (await api('POST', `/data-sources/${table.dataSourceId}/relations`, { name: '관계', targetDataSourceId: target.dataSourceId })).body?.property?.id
      const layoutUrl = `/data-sources/${table.dataSourceId}/layout`

      const placed = await api('PUT', layoutUrl, { version: '0', order: [], hidden: [], main: [memo, 'property_group'], panel: [qty] })
      check('★ 본문 줄 · 패널을 적용하면 그 순서로 선다(속성 묶음도 줄의 한 자리)',
        placed.status === 200 && JSON.stringify(placed.body?.layout?.main) === JSON.stringify([memo, 'property_group'])
          && JSON.stringify(placed.body?.layout?.panel) === JSON.stringify([qty]),
        JSON.stringify([placed.status, placed.body?.layout?.main, placed.body?.layout?.panel]))
      const relInPanel = await api('PUT', layoutUrl, { version: '1', order: [], hidden: [], panel: [qty, rel] })
      const twice = await api('PUT', layoutUrl, { version: '1', order: [], hidden: [], main: ['property_group', qty], panel: [qty] })
      check('★ 관계형을 패널에 놓으면 400 panel_type · 한 속성을 두 자리에 놓으면 400 invalid_layout',
        relInPanel.status === 400 && relInPanel.body?.error === 'panel_type' && twice.status === 400 && twice.body?.error === 'invalid_layout',
        JSON.stringify({ rel: [relInPanel.status, relInPanel.body?.error, rel], twice: [twice.status, twice.body?.error] }))
    }

    if (sectionIf('본문 모듈 · 상세 패널 — 화면 (3c-2 · F-16-04 · F-16-05)')) {
      // 편집 모드에서 속성을 "본문"으로 올려 속성 묶음 위에 두고, 다른 속성을 "패널"로 보낸다(관계형은 패널 단추가 꺼진다). 적용하면 행
      // 페이지가 본문 줄 순서로 모듈을 그리고, 상세 패널은 접힌 채 토글로 펼친다(이 기기에 남는다). 내리면 속성 묶음의 스키마 자리로.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const post = async (path, body) => readRes(await fetch(`${api}${path}`, { method: 'POST', headers: authed, body: JSON.stringify(body) }))
      const created = (await post('/databases', { name: `모듈화면${stamp}`, privateTop: true })).body?.database
      const target = (await post('/databases', { name: `모듈대상${stamp}`, privateTop: true })).body?.database
      const ds = created?.dataSourceId
      const memo = (await post(`/data-sources/${ds}/properties`, { name: '메모', type: 'rich_text' })).body?.property?.id
      const qty = (await post(`/data-sources/${ds}/properties`, { name: '수량', type: 'number' })).body?.property?.id
      const rel = (await post(`/data-sources/${ds}/relations`, { name: '관계', targetDataSourceId: target?.dataSourceId })).body?.property?.id
      const titleId = (await readRes(await fetch(`${api}/views/${created?.defaultViewId}`, { headers: authed }))).body?.view?.columns?.find((c) => c.type === 'title')?.propertyId
      const rowId = (await post(`/views/${created?.defaultViewId}/rows`, { cells: [
        { propertyId: titleId, value: { type: 'title', title: [textRun('모듈 행')] } },
        { propertyId: qty, value: { type: 'number', number: 42 } },
      ] })).body?.row?.id

      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const item = (id, testId) => `[data-testid="row-layout-item"][data-property-id="${id}"] [data-testid="${testId}"]`
      const listIds = (testId) => evaluate(`[...document.querySelectorAll('[data-testid="${testId}"] > li')].map((li) => li.getAttribute('data-property-id'))`)
      const openRow = async () => {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${rowId}` })
        return waitFor(`!!document.querySelector('[data-testid="row-layout-edit"]') && !!document.querySelector('[data-testid="row-title"]')`, 15000)
      }
      const openEditor = async () => {
        for (let i = 0; i < 6; i += 1) {
          if (await has('[data-testid="row-layout-editor"]')) return true
          await clickSelector('[data-testid="row-layout-edit"]')
          if (await waitFor(`!!document.querySelector('[data-testid="row-layout-editor"]')`, 1500)) return true
        }
        return false
      }
      const mainOrder = () => evaluate(`[...document.querySelectorAll('[data-testid="row-main"] > *')].map((e) => e.getAttribute('data-testid') === 'row-property-group' ? 'group' : e.getAttribute('data-property-id'))`)
      const groupIds = () => evaluate(`[...document.querySelectorAll('[data-testid="row-visible-properties"] td[data-property-id]')].map((td) => td.getAttribute('data-property-id'))`)

      await openRow()
      await openEditor()
      check('편집 모드 — 본문 줄에는 속성 묶음뿐 · 패널은 비었다 · 관계형의 "패널"은 꺼지고 까닭을 말한다',
        JSON.stringify(await listIds('row-layout-main')) === JSON.stringify(['property_group'])
          && (await has('[data-testid="row-layout-panel-empty"]'))
          && (await evaluate(`document.querySelector(${JSON.stringify(item(rel, 'row-layout-to-panel'))})?.disabled === true`))
          && (await has('[data-testid="row-layout-panel-forbidden"]')),
        JSON.stringify(await listIds('row-layout-main')))
      await clickSelector(item(memo, 'row-layout-raise'))
      check('★ "본문"을 누르면 본문 줄의 끝으로 옮겨 가고 포커스가 그 줄의 "내리기"로 따라간다',
        JSON.stringify(await listIds('row-layout-main')) === JSON.stringify(['property_group', memo])
          && (await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(item(memo, 'row-layout-lower'))})`)),
        JSON.stringify([await listIds('row-layout-main'), await evaluate('document.activeElement?.getAttribute("aria-label")')]))
      await clickSelector(`[data-testid="row-layout-main"] ${item(memo, 'row-layout-up')}`)
      await clickSelector(item(qty, 'row-layout-to-panel'))
      check('본문 줄에서 속성 묶음 위로 · 수량은 패널로 — 서버는 아직 그대로',
        JSON.stringify(await listIds('row-layout-main')) === JSON.stringify([memo, 'property_group'])
          && JSON.stringify(await listIds('row-layout-panel')) === JSON.stringify([qty])
          && (await dbQuery(`SELECT 1 FROM page_layout WHERE data_source_id = $1`, [ds])).length === 0,
        JSON.stringify([await listIds('row-layout-main'), await listIds('row-layout-panel')]))

      await clickSelector('[data-testid="row-layout-apply"]')
      await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]') && !!document.querySelector('[data-testid="row-module"]')`, 15000)
      check('★ 적용하면 본문 줄 순서로 그린다 — 올린 메모가 속성 묶음 위의 모듈 · 묶음에서는 빠진다',
        JSON.stringify(await mainOrder()) === JSON.stringify([memo, 'group']) && !(await groupIds()).includes(memo) && !(await groupIds()).includes(qty),
        JSON.stringify([await mainOrder(), await groupIds()]))
      check('★ 상세 패널은 접힌 채 토글이 선다("상세 패널 1") — 비어 있지 않으니까',
        (await evaluate(`document.querySelector('[data-testid="row-panel"]')?.hidden === true`))
          && (await evaluate(`document.querySelector('[data-testid="row-panel-toggle"]')?.textContent`)) === '상세 패널 1',
        String(await evaluate(`document.querySelector('[data-testid="row-panel-toggle"]')?.textContent ?? null`)))
      await clickSelector('[data-testid="row-panel-toggle"]')
      check('★ 토글을 누르면 패널이 펼쳐지고 그 속성의 값이 보인다',
        await waitFor(`document.querySelector('[data-testid="row-panel"]')?.hidden === false
          && (document.querySelector('[data-testid="row-panel"] td[data-property-id="${qty}"]')?.textContent ?? '').includes('42')`, 5000),
        String(await evaluate(`document.querySelector('[data-testid="row-panel"]')?.textContent ?? null`)))
      await openRow()
      check('패널의 펼침은 이 기기에 남는다 — 새로 열어도 펼쳐져 있다',
        await waitFor(`document.querySelector('[data-testid="row-panel"]')?.hidden === false`, 5000))

      await openEditor()
      await clickSelector(item(qty, 'row-layout-lower'))
      check('패널에서 "내리기" — 속성 묶음의 스키마 자리로 돌아간다(메모 · 관계 사이가 아니라 스키마 순서)',
        JSON.stringify(await listIds('row-layout-group')) === JSON.stringify([qty, rel]),
        JSON.stringify(await listIds('row-layout-group')))
      await clickSelector('[data-testid="row-layout-apply"]')
      await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]')`, 15000)
      const saved = (await dbQuery(`SELECT area, property_id FROM layout_module WHERE data_source_id = $1 AND kind = 'property' AND parent_module_id IS NULL AND area <> 'heading' ORDER BY area, order_idx`, [ds])).map((r) => `${r.area}:${r.property_id}`)
      check('★ 패널이 비면 토글이 없다 · 서버에는 본문 모듈 하나만 남는다',
        (await waitFor(`!document.querySelector('[data-testid="row-panel-toggle"]')`, 5000)) && JSON.stringify(saved) === JSON.stringify([`main:${memo}`]),
        JSON.stringify(saved))
    }

    if (sectionIf('레이아웃 되돌리기 — 서버 (3e-1 · F-16-12)')) {
      // GET …/layout 이 레이아웃과 되돌릴 수 있는지를 주고, POST …/layout/undo 가 직전 버전을 새 버전으로 되돌린다 — 두 번은 409 no_undo.
      // 한 단계 · 스키마 순서 · 권한은 DB 검사가 본다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const table = (await api('POST', '/databases', { name: `되돌리기 ${stamp}` })).body.database
      const memo = (await api('POST', `/data-sources/${table.dataSourceId}/properties`, { name: '메모', type: 'rich_text' })).body?.property?.id
      const layoutUrl = `/data-sources/${table.dataSourceId}/layout`
      const fresh = await api('GET', layoutUrl)
      await api('PUT', layoutUrl, { version: '0', order: [], hidden: [memo], settings: { fullWidth: true } })
      const applied = await api('GET', layoutUrl)
      check('★ GET — 레이아웃과 되돌릴 수 있는지(적용 전에는 없고 · 적용 뒤에는 있다)',
        fresh.status === 200 && fresh.body?.undo?.available === false && fresh.body?.layout?.version === '0'
          && applied.body?.undo?.available === true && JSON.stringify(applied.body?.layout?.hidden) === JSON.stringify([memo]),
        JSON.stringify([fresh.body?.undo, applied.body?.undo, applied.body?.layout?.hidden]))
      const undone = await api('POST', `${layoutUrl}/undo`, { version: '1' })
      const twice = await api('POST', `${layoutUrl}/undo`, { version: '2' })
      check('★ 되돌리면 직전 버전이 새 버전(2)으로 돌아온다 · 두 번은 409 no_undo',
        undone.status === 200 && undone.body?.layout?.version === '2' && JSON.stringify(undone.body?.layout?.hidden) === '[]'
          && undone.body?.layout?.settings?.fullWidth === false && twice.status === 409 && twice.body?.error === 'no_undo',
        JSON.stringify({ undone: [undone.status, undone.body?.layout?.version, undone.body?.layout?.hidden], twice: [twice.status, twice.body?.error] }))
    }

    if (sectionIf('레이아웃 되돌리기 · 실시간 — 화면 (3e-2 · F-16-12)')) {
      // 직전 레이아웃으로 되돌리기 단추(되돌릴 수 있을 때만) · 열린 행 페이지가 다른 사람의 적용을 새로고침 없이 따른다 · 편집 중이면
      // 닫은 뒤에 따른다. "다른 사람"은 API 로 적용한다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const api = `${BASE}/api/workspaces/${workspaceId}`
      const readRes = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      const post = async (path, body) => readRes(await fetch(`${api}${path}`, { method: 'POST', headers: authed, body: JSON.stringify(body) }))
      const created = (await post('/databases', { name: `레이아웃실시간${stamp}`, privateTop: true })).body?.database
      const ds = created?.dataSourceId
      const memo = (await post(`/data-sources/${ds}/properties`, { name: '메모', type: 'rich_text' })).body?.property?.id
      const qty = (await post(`/data-sources/${ds}/properties`, { name: '수량', type: 'number' })).body?.property?.id
      const titleId = (await readRes(await fetch(`${api}/views/${created?.defaultViewId}`, { headers: authed }))).body?.view?.columns?.find((c) => c.type === 'title')?.propertyId
      const rowId = (await post(`/views/${created?.defaultViewId}/rows`, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun('실시간 행')] } }] })).body?.row?.id
      const version = async () => (await dbQuery(`SELECT version::text AS v FROM page_layout WHERE data_source_id = $1`, [ds]))[0]?.v ?? '0'
      const putLayout = async (body) => readRes(await fetch(`${api}/data-sources/${ds}/layout`, { method: 'PUT', headers: authed, body: JSON.stringify({ version: await version(), order: [], hidden: [], ...body }) }))
      const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
      const visibleIds = () => evaluate(`[...document.querySelectorAll('[data-testid="row-visible-properties"] td[data-property-id]')].map((td) => td.getAttribute('data-property-id'))`)
      const openRow = async () => {
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${rowId}` })
        return waitFor(`!!document.querySelector('[data-testid="row-layout-edit"]') && !!document.querySelector('[data-testid="row-title"]')`, 15000)
      }

      // ① 되돌리기 — 남이 메모를 숨겼다 → 행 페이지의 "직전 레이아웃으로 되돌리기"
      await openRow()
      check('처음에는 되돌릴 것이 없다 — 단추가 없다', !(await has('[data-testid="row-layout-undo"]')))
      await putLayout({ hidden: [memo] })
      // 열린 화면이 그 적용을 따라 다시 그린 뒤에 떠난다 — 다시 그리기(`router.refresh`) 도중에 떠나면 서버가 그 렌더를 "destination stream
      // closed early" 로 끊는다(#250 의 전체 판 — 구독 전 틈을 고치자 이 페이지가 적용을 늘 받게 되어 드러났다)
      await waitFor(`![...document.querySelectorAll('[data-testid="row-visible-properties"] td[data-property-id]')].some((td) => td.getAttribute('data-property-id') === ${JSON.stringify(memo)})`, 10000)
      await openRow()
      check('적용 뒤에는 "직전 레이아웃으로 되돌리기"가 선다 — 메모는 숨겨져 있다',
        (await has('[data-testid="row-layout-undo"]')) && !(await visibleIds()).includes(memo),
        JSON.stringify(await visibleIds()))
      for (let i = 0; i < 5 && (await has('[data-testid="row-layout-undo"]')); i += 1) {
        await clickSelector('[data-testid="row-layout-undo"]')
        if (await waitFor(`!document.querySelector('[data-testid="row-layout-undo"]')`, 3000)) break
      }
      check('★ 되돌리면 메모가 다시 보이고 단추가 사라진다 — 서버는 새 버전(2) · 기록이 지워졌다',
        (await waitFor(`[...document.querySelectorAll('[data-testid="row-visible-properties"] td[data-property-id]')].some((td) => td.getAttribute('data-property-id') === ${JSON.stringify(memo)})`, 10000))
          && !(await has('[data-testid="row-layout-undo"]'))
          && (await version()) === '2' && (await dbQuery(`SELECT 1 FROM page_layout_history WHERE data_source_id = $1`, [ds])).length === 0,
        JSON.stringify([await visibleIds(), await version(), await has('[data-testid="row-layout-undo"]')]))

      // ② 실시간 — 행 페이지를 연 채로 남이 수량을 고정한다
      await openRow()
      await putLayout({ pinned: [qty] })
      check('★ 열린 행 페이지가 남의 적용을 새로고침 없이 따른다 — 수량이 제목 아래에 선다',
        await waitFor(`!!document.querySelector('[data-testid="row-pinned-properties"] td[data-property-id="${qty}"]')`, 10000),
        String(await evaluate(`document.querySelector('[data-testid="row-pinned-properties"]')?.textContent ?? '(없음)'`)))

      // ③ 편집 중이면 닫은 뒤에 따른다 — ② 에 기대지 않게 새로 연다(② 가 깨지면 고정 줄이 처음부터 없어 ③ 이 거저 통과했다 · §3.3-345 ③)
      await openRow()
      check('전제 — 새로 연 행 페이지에 수량이 제목 아래에 있다',
        await waitFor(`!!document.querySelector('[data-testid="row-pinned-properties"] td[data-property-id="${qty}"]')`, 5000))
      for (let i = 0; i < 6 && !(await has('[data-testid="row-layout-editor"]')); i += 1) {
        await clickSelector('[data-testid="row-layout-edit"]')
        await waitFor(`!!document.querySelector('[data-testid="row-layout-editor"]')`, 1500)
      }
      await putLayout({ pinned: [] })
      await sleep(1500)
      check('편집 중에는 다시 그리지 않는다 — 편집 모드가 그대로 열려 있다', await has('[data-testid="row-layout-editor"]'))
      await clickSelector('[data-testid="row-layout-cancel"]')
      check('★ 편집 모드를 닫으면 그사이의 적용을 따른다 — 고정이 풀렸다',
        await waitFor(`!document.querySelector('[data-testid="row-layout-editor"]') && !document.querySelector('[data-testid="row-pinned-properties"]')`, 10000))

      // ④ 구독이 붙기 전의 적용(#250) — 변경 알림 주소를 막은 채 행 페이지를 열고 남이 수량을 고정한 뒤 막음을 푼다. 다시 붙은 구독이
      // 그 사이의 적용을 따라와야 한다(#249 의 전체 e2e 가 부하에서 ② 를 떨어뜨린 틈을 결정적으로 만든다)
      await send('Fetch.enable', { patterns: [{ urlPattern: '*/changes*', requestStage: 'Request' }] })
      try {
        await openRow()
        for (let i = 0; i < 100 && pausedCount() === 0; i += 1) await sleep(50)
        await putLayout({ pinned: [qty] })
        await sleep(800)
        check('전제 — 구독이 붙잡혀 있는 동안에는 따라오지 않는다(고정 줄이 없다)',
          pausedCount() > 0 && !(await has('[data-testid="row-pinned-properties"]')), String(pausedCount()))
        await send('Fetch.disable')
        await releasePaused()
        check('★ 구독이 붙기 전의 적용도 구독이 붙으면 따른다 — 서버가 렌더 시각 뒤의 변경을 곧바로 알린다(#250)',
          await waitFor(`!!document.querySelector('[data-testid="row-pinned-properties"] td[data-property-id="${qty}"]')`, 15000),
          String(await evaluate(`document.querySelector('[data-testid="row-pinned-properties"]')?.textContent ?? '(없음)'`)))
      } finally {
        await send('Fetch.disable').catch(() => undefined)
        await releasePaused()
      }
    }

    if (sectionIf('리마인더 — 화면 (4c-3 · F-11-10)')) {
      // 날짜 칸의 종 — 없으면 마우스를 올리면 서고, 누르면 값의 모양(날짜만)에 맞는 리드 넷이 메뉴로 선다. 고르면 종이 선다(다시 열어도) ·
      // 지난 날짜는 빨갛다 · "알림 없음"으로 푼다. 울리면(워커 대신 이 판이 울리기를 부른다) 인박스에 리마인더 줄이 선다. 자기 데이터를
      // 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const { runReminderFire } = await import(new URL('../src/lib/notification/reminder-fire.ts', import.meta.url).href)
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `리마인더 ${stamp}` })).body.database
      const view = db.defaultViewId
      const due = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '마감', type: 'date' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      const rowOf = async (t, start) => (await api('POST', `/views/${view}/rows`, {
        cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }, { propertyId: due, value: { type: 'date', date: { start } } }],
      })).body.row.id
      const future = await rowOf('앞으로', '2030-05-01')
      const past = await rowOf('지난', '2020-01-01')
      const bell = (row) => `tr[data-row-id="${row}"] td[data-property-id="${due}"] [data-testid="db-reminder-bell"]`
      const stateOf = (row) => evaluate(`document.querySelector(${JSON.stringify(bell(row))})?.dataset.state ?? null`)
      const MENU = '[data-testid="db-reminder-menu"]'
      const stored = async (row) => (await dbQuery(`SELECT lead_minutes, timezone, fired_at FROM reminder WHERE page_id = $1`, [row]))[0] ?? null
      const openMenu = async (row) => {
        for (let i = 0; i < 6; i += 1) {
          await clickSelector(bell(row))
          if (await waitFor(`!!document.querySelector('${MENU}')`, 1500)) return true
        }
        return false
      }
      const pick = async (selector) => {
        await clickSelector(selector)
        return waitFor(`!document.querySelector('${MENU}')`, 8000)
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector(${JSON.stringify(bell(future))})`, 15000)
      check('처음에는 리마인더가 없다 — 종은 마우스를 올려야 보이는 자리만 있다', (await stateOf(future)) === 'none', String(await stateOf(future)))

      const opened = await openMenu(future)
      const labels = await evaluate(`[...document.querySelectorAll('${MENU} [data-testid="db-reminder-option"]')].map((b) => b.textContent.trim())`)
      check('★ 종을 누르면 날짜만인 값의 리드 넷이 선다(모두 오전 9시) · 걸려 있지 않으니 "알림 없음"은 없다',
        opened && JSON.stringify(labels) === JSON.stringify(['그날 오전 9시', '하루 전 오전 9시', '이틀 전 오전 9시', '일주일 전 오전 9시'])
          && !(await evaluate(`!!document.querySelector('${MENU} [data-testid="db-reminder-off"]')`)),
        JSON.stringify([opened, labels]))
      const closed = await pick(`${MENU} [data-testid="db-reminder-option"][data-lead="1440"]`)
      const saved = await stored(future)
      check('★ "하루 전"을 고르면 메뉴가 닫히고 종이 선다 — 서버에는 리드 1440 · 이 브라우저의 타임존',
        closed && (await waitFor(`document.querySelector(${JSON.stringify(bell(future))})?.dataset.state === 'armed'`, 8000))
          && saved?.lead_minutes === 1440 && typeof saved?.timezone === 'string' && saved.timezone.length > 0 && saved.fired_at === null,
        JSON.stringify([closed, await stateOf(future), saved]))

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      check('다시 열어도 종이 서 있다 — 제목이 리드를 말한다',
        (await waitFor(`document.querySelector(${JSON.stringify(bell(future))})?.dataset.state === 'armed'`, 15000))
          && (await evaluate(`document.querySelector(${JSON.stringify(bell(future))})?.getAttribute('title')`)) === '알림 — 하루 전 오전 9시',
        String(await evaluate(`document.querySelector(${JSON.stringify(bell(future))})?.getAttribute('title') ?? null`)))

      await openMenu(past)
      await pick(`${MENU} [data-testid="db-reminder-option"][data-lead="0"]`)
      check('★ 지난 날짜에 걸면 울리지 않고 "지남" — 종이 빨갛다',
        (await waitFor(`document.querySelector(${JSON.stringify(bell(past))})?.dataset.state === 'passed'`, 8000))
          && (await stored(past))?.fired_at !== null,
        JSON.stringify([await stateOf(past), await stored(past)]))

      await openMenu(past)
      const checked = await evaluate(`document.querySelector('${MENU} [data-testid="db-reminder-option"][data-lead="0"]')?.getAttribute('aria-checked')`)
      await pick(`${MENU} [data-testid="db-reminder-off"]`)
      check('★ 걸린 리드에 표시가 있고 "알림 없음"으로 푼다 — 종이 내려가고 서버에서도 지워진다',
        checked === 'true' && (await waitFor(`document.querySelector(${JSON.stringify(bell(past))})?.dataset.state === 'none'`, 8000))
          && (await stored(past)) === null,
        JSON.stringify([checked, await stateOf(past), await stored(past)]))

      // 울린다 — 워커 대신 이 판이 울리기를 부른다(시각을 2030년 뒤로)
      const fired = await runReminderFire(new Date('2030-06-01T00:00:00Z'), { workspaces: [workspaceId] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/inbox` })
      check('★ 울리면 인박스에 리마인더 줄이 선다 — 울린 날짜 속성의 이름을 말한다',
        fired.fired >= 1 && (await waitFor(`(document.body?.textContent ?? '').includes('"마감" 날짜의 리마인더가 울렸습니다.')`, 15000)),
        JSON.stringify(fired))
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      check('울린 리마인더의 종은 빨갛다',
        await waitFor(`document.querySelector(${JSON.stringify(bell(future))})?.dataset.state === 'passed'`, 15000), String(await stateOf(future)))
    }

    if (sectionIf('업데이트 패널 (4d-3 · F-11-04)')) {
      // 머리의 "업데이트" — 그 페이지의 활동을 최신순으로. 실제 API 로 만들고 · 이름을 바꾸고 · 옮긴 뒤(4d-2 가 남긴다), 오래된 편집 30개와
      // 보이지 않아야 할 멘션 하나를 DB 에 넣는다. 30개씩 · "더 보기" · Esc 로 닫기 · 활동이 없는 페이지의 빈 상태. 자기 데이터를 스스로
      // 만든다 — E2E_ONLY 로 홀로 돈다.
      const { query: dbQuery } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
      const stamp = Date.now()
      const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
      const post = async (body) => (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify(body) })).json()).page.id
      const page = await post({ title: `업데이트${stamp}` })
      const destTitle = `옮긴곳${stamp}`
      const dest = await post({ title: destTitle })
      const renamed = await fetch(`${pagesUrl}/${page}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ title: `바꾼이름${stamp}` }) })
      const moved = await fetch(`${pagesUrl}/${page}/move`, { method: 'POST', headers: authed, body: JSON.stringify({ targetParentId: dest }) })
      // 오래된 편집 30개(한 시간 전부터 1분 간격) · 보이지 않아야 할 멘션
      await dbQuery(
        `INSERT INTO activity_event (id, workspace_id, page_id, actor_id, type, created_at)
         SELECT gen_random_uuid(), $1, $2, $3, 'block.updated', now() - interval '1 hour' - make_interval(mins => g) FROM generate_series(1, 30) g`,
        [workspaceId, page, ctx.userId],
      )
      await dbQuery(`INSERT INTO activity_event (id, workspace_id, page_id, actor_id, type) VALUES (gen_random_uuid(), $1, $2, $3, 'user.mentioned')`, [
        workspaceId, page, ctx.userId,
      ])
      const ownerName = (await dbQuery(`SELECT name FROM "user" WHERE id = $1`, [ctx.userId]))[0]?.name ?? ''

      const DIALOG = '[data-testid="page-updates"]'
      const ITEMS = `${DIALOG} [data-testid="page-update-item"]`
      const types = () => evaluate(`[...document.querySelectorAll('${ITEMS}')].map((li) => li.dataset.type)`)
      // 하이드레이션 전의 클릭은 사라진다(§6) — 창이 설 때까지 다시 누른다.
      const openUpdates = async () => {
        for (let tries = 0; tries < 6; tries += 1) {
          await clickSelector('[data-testid="page-updates-open"]')
          if (await waitFor(`!!document.querySelector('${DIALOG}')`, 2000)) return true
        }
        return false
      }

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
      await waitFor(`!!document.querySelector('[data-testid="page-updates-open"]')`, 15000)
      check('전제 — 이름 바꾸기 · 옮기기가 됐다', renamed.ok && moved.ok, JSON.stringify([renamed.status, moved.status]))
      check('★ 머리의 "업데이트"를 누르면 패널이 열린다', await openUpdates())
      check('★ 최신순 30개 — 옮기기 · 편집(이름) · 만들기가 먼저, 멘션은 보이지 않는다',
        await waitFor(`(() => { const t = [...document.querySelectorAll('${ITEMS}')].map((li) => li.dataset.type)
          return t.length === 30 && t[0] === 'page.moved' && t[1] === 'block.updated' && t[2] === 'page.created' && !t.includes('user.mentioned') })()`, 8000),
        JSON.stringify(await types()))
      const first = await evaluate(`document.querySelector('${ITEMS}')?.textContent ?? ''`)
      check('★ 한 줄은 이름 · 한 일 · 시각 — 옮기기는 볼 수 있는 목적지의 제목을 말한다',
        ownerName !== '' && first.startsWith(ownerName) && first.includes(`‘${destTitle}’ 아래로 옮겼습니다`) && first.includes('오늘 '),
        first)
      await clickSelector('[data-testid="page-updates-more"]')
      check('★ "더 보기"로 나머지를 잇는다 — 33개 · 겹치지 않고 더 볼 것이 없다',
        await waitFor(`(() => { const ids = [...document.querySelectorAll('${ITEMS}')].map((li) => li.textContent + li.querySelector('time')?.dateTime)
          return ids.length === 33 && !document.querySelector('[data-testid="page-updates-more"]') })()`, 8000),
        JSON.stringify((await types()).length))
      check('겹친 항목이 없다', new Set(await evaluate(`[...document.querySelectorAll('${DIALOG} time')].map((t) => t.dateTime)`)).size === 33)
      await key('Escape')
      check('★ Esc 로 닫고 포커스는 "업데이트" 단추로 돌아간다',
        await waitFor(`!document.querySelector('${DIALOG}') && document.activeElement?.getAttribute('data-testid') === 'page-updates-open'`, 5000),
        String(await evaluate('document.activeElement?.outerHTML?.slice(0, 80) ?? null')))

      // 활동이 없는 페이지(4d-2 전에 만든 것처럼) — 빈 상태를 말한다
      const quiet = await post({ title: `조용한${stamp}` })
      await dbQuery(`DELETE FROM activity_event WHERE page_id = $1`, [quiet])
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${quiet}` })
      await waitFor(`!!document.querySelector('[data-testid="page-updates-open"]')`, 15000)
      await openUpdates()
      check('★ 활동이 없으면 "아직 활동이 없습니다"', await waitFor(`!!document.querySelector('[data-testid="page-updates-empty"]')`, 8000))
    }

    if (sectionIf('페이지 웹훅 — 화면 (4e-3 · F-11-19)')) {
      // Updates 패널 아래의 웹훅 칸 — 걸기(거절의 까닭 · 힌트만 보인다) · 활동을 모아 받는 서버로(워커 대신 이 판이 보내기를 부른다) ·
      // 마지막 배달 · 멈추기 · 다시 켜기 · 지우기(한 번 더 묻는다). 받는 서버는 127.0.0.1:HOOK_PORT — 앱은 그 주소만 검사를 비켜 간다.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const { runWebhookDelivery } = await import(new URL('../src/lib/notification/webhook-delivery.ts', import.meta.url).href)
      const { createServer } = await import('node:http')
      const received = []
      const receiver = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          received.push({ path: req.url, body })
          res.writeHead(200).end('ok')
        })
      })
      await new Promise((r) => receiver.listen(HOOK_PORT, '127.0.0.1', r))
      const savedAllow = process.env.OUTBOUND_ALLOW_HOSTS
      process.env.OUTBOUND_ALLOW_HOSTS = `127.0.0.1:${HOOK_PORT}` // 보내기는 이 판에서 부른다
      try {
        const stamp = Date.now()
        const pagesUrl = `${BASE}/api/workspaces/${workspaceId}/pages`
        const page = (await (await fetch(pagesUrl, { method: 'POST', headers: authed, body: JSON.stringify({ title: `웹훅${stamp}` }) })).json()).page.id
        const SECTION = '[data-testid="page-webhooks"]'
        const ITEM = `${SECTION} [data-testid="page-webhook"]`
        const INPUT = `${SECTION} [data-testid="page-webhook-url"]`
        const itemText = () => evaluate(`document.querySelector('${ITEM}')?.textContent ?? null`)
        const openPanel = async () => {
          for (let tries = 0; tries < 6; tries += 1) {
            await clickSelector('[data-testid="page-updates-open"]')
            if (await waitFor(`!!document.querySelector('${SECTION}')`, 3000)) return true
            if (await evaluate(`!!document.querySelector('[data-testid="page-updates"]')`)) await key('Escape')
          }
          return false
        }
        const connect = async (url) => {
          for (let i = 0; i < 6; i += 1) {
            await evaluate(`(() => { const el = document.querySelector('${INPUT}'); el?.focus(); el?.select() })()`)
            await typeText(url)
            if ((await evaluate(`document.querySelector('${INPUT}')?.value ?? null`)) === url) break
            await sleep(300)
          }
          await clickSelector(`${SECTION} [data-testid="page-webhook-add"]`)
        }

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${page}` })
        await waitFor(`!!document.querySelector('[data-testid="page-updates-open"]')`, 15000)
        check('★ 전체 권한이면 Updates 패널 아래에 웹훅 칸이 선다 — 무엇이 나가는지 알린다',
          (await openPanel()) && (await evaluate(`(document.querySelector('${SECTION}')?.textContent ?? '').includes('이 주소로 나갑니다')`)))

        await connect('http://hooks.example.com/x')
        check('★ https 가 아니면 까닭을 말하고 걸지 않는다',
          await waitFor(`(document.querySelector('${SECTION} [data-testid="page-webhook-error"]')?.textContent ?? '') === 'https 주소만 받습니다.'
            && !document.querySelector('${ITEM}')`, 8000),
          String(await evaluate(`document.querySelector('${SECTION}')?.textContent ?? '(없음)'`)))

        const hookPath = `/hook/${stamp}`
        await connect(`http://127.0.0.1:${HOOK_PORT}${hookPath}`)
        check('★ 걸면 힌트 · 켜짐 · 아직 보낸 적 없음 — 원문 주소는 화면에 없다',
          await waitFor(`(() => { const t = document.querySelector('${ITEM}')?.textContent ?? ''
            return t.includes('127.0.0.1:${HOOK_PORT}/…${String(stamp).slice(-4)}') && t.includes('켜짐') && t.includes('아직 보낸 적 없음')
              && !(document.body?.textContent ?? '').includes('${hookPath}')
              && document.querySelector('${INPUT}')?.value === '' })()`, 8000),
          String(await itemText()))

        // 활동 → 받는 서버(5분 창이 지난 시각으로 이 판이 보내기를 부른다)
        const renamed = await fetch(`${pagesUrl}/${page}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ title: `바꾼웹훅${stamp}` }) })
        const outcome = await runWebhookDelivery(new Date(Date.now() + 6 * 60_000), { workspaces: [workspaceId] })
        const got = received.find((r) => r.path === hookPath)
        const payload = got === undefined ? null : JSON.parse(got.body)
        check('★ 활동을 모아 받는 서버로 보낸다 — 지금 제목 · 편집 · 배달 id',
          renamed.ok && payload !== null && payload.text.includes(`‘바꾼웹훅${stamp}’`) && payload.text.includes('편집 1')
            && typeof payload.notion_clone?.delivery_id === 'string',
          JSON.stringify([outcome, payload?.text ?? null]))

        await key('Escape')
        await openPanel()
        check('★ 다시 열면 마지막 배달이 "보냄 · 오늘 …"',
          await waitFor(`(document.querySelector('${ITEM} [data-testid="page-webhook-last"]')?.textContent ?? '').startsWith('보냄 · 오늘 ')`, 8000),
          String(await itemText()))

        await clickSelector(`${ITEM} [data-testid="page-webhook-toggle"]`)
        check('★ 멈추기 — 상태가 멈춤 · 단추는 다시 켜기',
          await waitFor(`document.querySelector('${ITEM}')?.dataset.state === 'manual'
            && document.querySelector('${ITEM} [data-testid="page-webhook-toggle"]')?.textContent === '다시 켜기'`, 8000),
          String(await itemText()))
        await clickSelector(`${ITEM} [data-testid="page-webhook-toggle"]`)
        check('다시 켜기 — 켜짐',
          await waitFor(`document.querySelector('${ITEM}')?.dataset.state === 'on'`, 8000), String(await itemText()))

        await clickSelector(`${ITEM} [data-testid="page-webhook-remove"]`)
        const asked = await waitFor(`!!document.querySelector('${ITEM} [data-testid="page-webhook-remove-confirm"]') && !!document.querySelector('${ITEM}')`, 5000)
        await clickSelector(`${ITEM} [data-testid="page-webhook-remove-confirm"]`)
        check('★ 지우기는 한 번 더 묻고 · 지우면 목록에서 사라진다',
          asked && (await waitFor(`!document.querySelector('${ITEM}')`, 8000)), String(await itemText()))
      } finally {
        if (savedAllow === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
        else process.env.OUTBOUND_ALLOW_HOSTS = savedAllow
        receiver.closeAllConnections()
        await new Promise((r) => receiver.close(() => r()))
      }
    }

    if (sectionIf('버튼 속성 — 화면 (5a-3 · F-03-15)')) {
      // 속성 추가에서 "버튼" → 버튼 열(칸은 이름의 단추) · 액션 0개면 "할 일이 없습니다" · 열 머리 메뉴의 "버튼 설정"으로 값 바꾸기 둘을
      // 넣는다 · 누르면 "완료"이고 칸이 바뀐다 · 잠긴 행은 "일부를 건너뛰었습니다" · 지우기는 그 액션만(다른 액션은 남는다). 자기 데이터를
      // 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `버튼 ${stamp}` })).body.database
      const other = (await api('POST', '/databases', { name: `버튼이 더할 표 ${stamp}` })).body.database
      const prop = async (name, type) => (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name, type })).body.property.id
      const qty = await prop('수량', 'number')
      const done = await prop('완료', 'checkbox')
      const row = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [] })).body.row.id
      const cellsOf = async () => (await api('GET', `/views/${db.defaultViewId}/rows`)).body.rows.find((r) => r.id === row)?.properties ?? {}
      const CELL = `tr[data-row-id="${row}"] [data-testid="db-button-cell"]`
      const RESULT = `tr[data-row-id="${row}"] [data-testid="db-button-result"]`
      const resultText = () => evaluate(`document.querySelector('${RESULT}')?.textContent ?? null`)
      const press = async () => {
        await clickSelector(CELL)
        return waitFor(`!!document.querySelector('${RESULT}') && document.querySelector('${CELL}')?.getAttribute('aria-busy') === 'false'`, 10000)
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-add-column"]') && document.querySelectorAll('thead th').length >= 3`, 15000)
      // ① 속성 추가에서 "버튼"
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="db-add-column-form"]')`)); i += 1) {
        await clickSelector('[data-testid="db-add-column"]')
        await waitFor(`!!document.querySelector('[data-testid="db-add-column-form"]')`, 2000)
      }
      await waitFor(`document.activeElement?.getAttribute('aria-label') === '속성 이름'`, 3000)
      await typeText('끝내기')
      await setSelect('select[aria-label="속성 유형"]', 'button')
      await clickSelector('[data-testid="db-add-column-form"] button[type="submit"]')
      check('★ 속성 추가에서 "버튼"을 고르면 버튼 열이 선다 — 칸은 속성 이름의 단추',
        await waitFor(`(document.querySelector('${CELL}')?.textContent ?? '') === '끝내기'`, 15000),
        String(await evaluate(`document.querySelector('tr[data-row-id="${row}"]')?.textContent ?? '(행 없음)'`)))
      const buttonId = (await api('GET', `/views/${db.defaultViewId}`)).body.view.columns.find((c) => c.name === '끝내기')?.propertyId

      // ② 액션 0개
      check('누르면 — 액션이 없으면 "할 일이 없습니다"', (await press()) && ((await resultText()) ?? '').startsWith('할 일이 없습니다'), String(await resultText()))

      // ③ 버튼 설정 — 값 바꾸기 둘
      const MENU = `th:has([data-testid="db-column-menu"][aria-label="끝내기 속성 메뉴"]) [data-testid="db-column-menu"]`
      const EDITOR = '[data-testid="db-button-editor"]'
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="db-column-button"]')`)); i += 1) {
        await clickSelector(MENU)
        await waitFor(`!!document.querySelector('[data-testid="db-column-button"]')`, 2000)
      }
      await clickSelector('[data-testid="db-column-button"]')
      const opened = await waitFor(`(document.querySelector('${EDITOR}')?.textContent ?? '').includes('아직 할 일이 없습니다')`, 8000)
      await clickSelector(`${EDITOR} [data-testid="db-button-add-action"]`)
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-property"]')`, 3000)
      await setSelect(`${EDITOR} [data-testid="db-button-property"]`, qty)
      await waitFor(`document.querySelector('${EDITOR} [data-testid="db-button-value"]')?.type === 'number'`, 3000)
      await evaluate(`(() => { const el = document.querySelector('${EDITOR} [data-testid="db-button-value"]'); el.focus(); el.select() })()`)
      await typeText('7')
      await clickSelector(`${EDITOR} [data-testid="db-button-add-value"]`)
      await waitFor(`document.querySelectorAll('${EDITOR} [data-testid="db-button-property"]').length === 2`, 3000)
      await setSelect(`${EDITOR} [data-testid="db-button-cell-value"]:nth-child(2) [data-testid="db-button-property"]`, done)
      await waitFor(`document.querySelector('${EDITOR} [data-testid="db-button-cell-value"]:nth-child(2) [data-testid="db-button-value"]')?.type === 'checkbox'`, 3000)
      await clickSelector(`${EDITOR} [data-testid="db-button-cell-value"]:nth-child(2) [data-testid="db-button-value"]`)
      await clickSelector(`${EDITOR} [data-testid="db-button-save"]`)
      const savedActions = async () => (await api('GET', `/data-sources/${db.dataSourceId}/properties/${buttonId}/actions`)).body?.actions ?? []
      check('★ "버튼 설정"으로 이 행의 값 바꾸기를 넣고 저장한다 — 수량 7 · 완료 체크',
        opened && (await waitFor(`!document.querySelector('${EDITOR}')`, 8000))
          && JSON.stringify(await savedActions()) === JSON.stringify([{ type: 'edit_property', config: { v: 1, cells: [
            { propertyId: qty, value: { type: 'number', number: 7 } },
            { propertyId: done, value: { type: 'checkbox', checkbox: true } },
          ] } }]),
        JSON.stringify([opened, await savedActions()]))

      // ④ 누르면 완료 · 칸이 바뀐다
      const pressed = await press()
      const cells = await cellsOf()
      check('★ 누르면 "완료" — 그 행의 수량 · 완료가 바뀐다',
        pressed && (await resultText()) === '완료' && cells[qty]?.number === 7 && cells[done]?.checkbox === true,
        JSON.stringify([await resultText(), cells[qty], cells[done]]))

      // ⑤ 잠긴 행 — 건너뛴다
      await api('PUT', `/pages/${row}/lock`)
      check('★ 잠긴 행에서 누르면 "일부를 건너뛰었습니다"',
        (await press()) && ((await resultText()) ?? '').startsWith('일부를 건너뛰었습니다'), String(await resultText()))
      await api('DELETE', `/pages/${row}/lock`)

      // ⑥ 편집기가 모르는 액션은 저장해도 남는다
      await api('PUT', `/data-sources/${db.dataSourceId}/properties/${buttonId}/actions`, { actions: [
        { type: 'add_page_to', config: { v: 1, dataSourceId: other.dataSourceId, cells: [] } },
        { type: 'edit_property', config: { v: 1, cells: [{ propertyId: qty, value: { type: 'number', number: 1 } }] } },
      ] })
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="db-column-button"]')`)); i += 1) {
        await clickSelector(MENU)
        await waitFor(`!!document.querySelector('[data-testid="db-column-button"]')`, 2000)
      }
      await clickSelector('[data-testid="db-column-button"]')
      const both = await waitFor(`(() => { const kinds = [...document.querySelectorAll('${EDITOR} [data-testid="db-button-action"]')].map((li) => li.dataset.kind)
        return kinds.join(',') === 'add,edit' && (document.querySelector('${EDITOR}')?.textContent ?? '').includes('다른 표에 행 추가') })()`, 8000)
      // 줄어든 것을 보고 저장한다 — 전체 판의 부하에서 첫 누름이 닿지 않은 채 저장해 둘 다 남은 적이 있다(#265)
      let removed = false
      for (let i = 0; i < 3 && !removed; i += 1) {
        await clickSelector(`${EDITOR} [data-testid="db-button-action"]:nth-child(2) [data-testid="db-button-action-remove"]`)
        removed = await waitFor(`document.querySelectorAll('${EDITOR} [data-testid="db-button-action"]').length === 1`, 3000)
      }
      await clickSelector(`${EDITOR} [data-testid="db-button-save"]`)
      await waitFor(`!document.querySelector('${EDITOR}')`, 8000)
      const kept = await savedActions()
      check('★ 지우기는 그 액션만 — 다른 표에 행 추가는 저장해도 남는다',
        both && kept.length === 1 && kept[0].type === 'add_page_to' && kept[0].config.dataSourceId === other.dataSourceId,
        JSON.stringify([both, kept]))
    }

    if (sectionIf('버튼 속성 — 행 추가 편집기 · 카드 · 템플릿 (5a-4 · F-08-07)')) {
      // "버튼 설정"이 그 표의 스키마로 고른다(숨긴 속성도) · "다른 표에 행 추가"를 고친다(대상 표 · 템플릿 — 템플릿 값이 이긴다를 알린다 ·
      // 그 표의 값) · 누르면 그 표에 템플릿 값으로 행이 선다 · 갤러리 카드의 단추는 카드를 열지 않는다 · 템플릿 화면에는 버튼이 없다.
      // 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const db = (await api('POST', '/databases', { name: `행 추가 버튼 ${stamp}` })).body.database
      const other = (await api('POST', '/databases', { name: `행이 설 표 ${stamp}` })).body.database
      const prop = async (ds, name, type) => (await api('POST', `/data-sources/${ds}/properties`, { name, type })).body.property.id
      await prop(db.dataSourceId, '수량', 'number')
      const hidden = await prop(db.dataSourceId, '숨김', 'number')
      const buttonId = await prop(db.dataSourceId, '더하기', 'button')
      const score = await prop(other.dataSourceId, '점수', 'number')
      await api('PATCH', `/views/${db.defaultViewId}/columns/${hidden}`, { visible: false })
      const template = (await api('POST', `/data-sources/${other.dataSourceId}/templates`, { title: `틀 ${stamp}` })).body.template.id
      await api('PATCH', `/rows/${template}`, { cells: [{ propertyId: score, value: { type: 'number', number: 5 } }] })
      const row = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [] })).body.row.id
      const otherRows = async () => (await api('GET', `/views/${other.defaultViewId}/rows`)).body.rows
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const EDITOR = '[data-testid="db-button-editor"]'
      const MENU = `th:has([data-testid="db-column-menu"][aria-label="더하기 속성 메뉴"]) [data-testid="db-column-menu"]`

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('tr[data-row-id="${row}"] [data-testid="db-button-cell"]')`, 15000)
      for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="db-column-button"]')`)); i += 1) {
        await clickSelector(MENU)
        await waitFor(`!!document.querySelector('[data-testid="db-column-button"]')`, 2000)
      }
      await clickSelector('[data-testid="db-column-button"]')
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-add-action"]')`, 8000)
      // ① 숨긴 속성도 고른다 — 보기의 컬럼이 아니라 스키마
      await clickSelector(`${EDITOR} [data-testid="db-button-add-action"]`)
      const hiddenListed = await waitFor(`[...(document.querySelector('${EDITOR} [data-testid="db-button-property"]')?.options ?? [])].some((o) => o.value === '${hidden}')`, 5000)
      check('★ "버튼 설정"은 그 표의 스키마로 고른다 — 이 보기에서 숨긴 속성도', hiddenListed,
        String(await evaluate(`[...(document.querySelector('${EDITOR} [data-testid="db-button-property"]')?.options ?? [])].map((o) => o.textContent).join(',')`)))
      await clickSelector(`${EDITOR} [data-testid="db-button-action-remove"]`)
      await waitFor(`document.querySelectorAll('${EDITOR} [data-testid="db-button-action"]').length === 0`, 3000)

      // ② 다른 표에 행 추가 — 대상 표 · 템플릿 · 값
      await clickSelector(`${EDITOR} [data-testid="db-button-add-row-action"]`)
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-target"]')`, 3000)
      await waitFor(`[...document.querySelector('${EDITOR} [data-testid="db-button-target"]').options].some((o) => o.value === '${other.dataSourceId}')`, 8000)
      await setSelect(`${EDITOR} [data-testid="db-button-target"]`, other.dataSourceId)
      await waitFor(`[...(document.querySelector('${EDITOR} [data-testid="db-button-template"]')?.options ?? [])].some((o) => o.value === '${template}')`, 8000)
      await setSelect(`${EDITOR} [data-testid="db-button-template"]`, template)
      const noted = await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-template-note"]')`, 3000)
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-add-value"]')`, 5000)
      await clickSelector(`${EDITOR} [data-testid="db-button-add-value"]`)
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-property"]')`, 3000)
      await setSelect(`${EDITOR} [data-testid="db-button-property"]`, score)
      await waitFor(`document.querySelector('${EDITOR} [data-testid="db-button-value"]')?.type === 'number'`, 3000)
      await evaluate(`(() => { const el = document.querySelector('${EDITOR} [data-testid="db-button-value"]'); el.focus(); el.select() })()`)
      await typeText('1')
      await clickSelector(`${EDITOR} [data-testid="db-button-save"]`)
      const saved = (await api('GET', `/data-sources/${db.dataSourceId}/properties/${buttonId}/actions`)).body?.actions ?? []
      await waitFor(`!document.querySelector('${EDITOR}')`, 8000)
      const actions = (await api('GET', `/data-sources/${db.dataSourceId}/properties/${buttonId}/actions`)).body?.actions ?? []
      check('★ 다른 표에 행 추가를 고친다 — 대상 표 · 템플릿(템플릿 값이 이긴다를 알린다) · 그 표의 값',
        noted && actions.length === 1 && actions[0].type === 'add_page_to' && actions[0].config.dataSourceId === other.dataSourceId
          && actions[0].config.templateId === template && actions[0].config.cells?.[0]?.propertyId === score && actions[0].config.cells?.[0]?.value?.number === 1,
        JSON.stringify([noted, saved, actions]))

      // ③ 누르면 그 표에 템플릿 값으로 행이 선다
      const before = (await otherRows()).length
      await clickSelector(`tr[data-row-id="${row}"] [data-testid="db-button-cell"]`)
      await waitFor(`(document.querySelector('tr[data-row-id="${row}"] [data-testid="db-button-result"]')?.textContent ?? '') === '완료'`, 10000)
      const after = await otherRows()
      check('★ 누르면 그 표에 행이 선다 — 템플릿 값(5)이 버튼 값(1)을 이긴다',
        after.length === before + 1 && after.some((r) => r.properties[score]?.number === 5),
        JSON.stringify([before, after.map((r) => r.properties[score])]))

      // ④ 갤러리 카드 — 단추는 카드를 열지 않는다
      const gallery = (await api('POST', `/databases/${db.id}/views`, { type: 'gallery', name: `갤러리 ${stamp}` })).body.view.id
      const galleryUrl = `${BASE}/w/${workspaceId}/db/${db.id}?v=${gallery}`
      await send('Page.navigate', { url: galleryUrl })
      const CARD_BUTTON = '[data-testid="db-gallery-badge"] [data-testid="db-button-cell"]'
      await waitFor(`!!document.querySelector('${CARD_BUTTON}')`, 15000)
      const beforeCard = (await otherRows()).length
      await clickSelector(CARD_BUTTON)
      const cardDone = await waitFor(`(document.querySelector('[data-testid="db-gallery-badge"] [data-testid="db-button-result"]')?.textContent ?? '') === '완료'`, 10000)
      await sleep(500)
      const stillHere = await evaluate(`location.href`)
      check('★ 갤러리 카드에도 단추가 선다 — 누르면 실행하고 카드를 열지 않는다',
        cardDone && stillHere.includes(`/db/${db.id}`) && (await otherRows()).length === beforeCard + 1,
        JSON.stringify([cardDone, stillHere]))

      // ⑤ 템플릿 화면에는 버튼이 없다
      const ownTemplate = (await api('POST', `/data-sources/${db.dataSourceId}/templates`, { title: `버튼 표의 틀 ${stamp}` })).body.template.id
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}/templates/${ownTemplate}` })
      const loaded = await waitFor(`(document.body?.textContent ?? '').includes('수량')`, 15000)
      check('★ 템플릿 화면에는 버튼이 서지 않는다 — 템플릿은 누를 행이 아니다',
        loaded && !(await evaluate(`!!document.querySelector('[data-testid="db-button-cell"]')`)),
        String(loaded))
    }

    if (sectionIf('DB automation — 목록 · 켜고 끄기 · 실행 기록 (5b-3a · F-08-09)')) {
      // ⚡ 는 전체 권한이 있는 사람에게만 선다 — 배지는 켜진 수 · 꺼진 까닭이 있으면 `!`. 목록은 트리거(조건은 보기의 칩과 같은 말) · 액션 ·
      // 실행 주체 · 켜고 끄기(배지가 따라간다) · 꺼진 까닭(켜면 지워진다) · 실행 기록(결과 · 트리거된 항목 · 단계) · 지우기는 한 번 더 묻는다.
      // 실행은 워커 대신 판을 직접 부른다(웹훅 화면과 같다). 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const db = (await api('POST', '/databases', { name: `자동화 화면 ${stamp}` })).body.database
      const ds = db.dataSourceId
      const prop = async (name, type) => (await api('POST', `/data-sources/${ds}/properties`, { name, type })).body.property.id
      const qty = await prop('수량', 'number')
      const mark = await prop('표시', 'checkbox')
      await api('PATCH', `/views/${db.defaultViewId}/columns/${mark}`, { visible: false })
      const definition = (name, triggers) => ({
        name, triggers, actions: [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: mark, value: { type: 'checkbox', checkbox: true } }] } }],
      })
      const auto = (await api('POST', `/data-sources/${ds}/automations`, definition(`많으면 표시 ${stamp}`, [
        { type: 'property_edited', propertyId: qty, condition: { property_id: qty, operator: 'greater_than', value: 5 } },
      ]))).body.automation
      const tired = (await api('POST', `/data-sources/${ds}/automations`, definition(`지칠 것 ${stamp}`, [{ type: 'page_added' }]))).body.automation
      const { query: dbQuery } = await import(src('db/pool.ts'))
      // 실행 쪽이 끈 상태(실패가 이어짐)를 만든다 — 실패 셋을 만드는 길은 서버 검사가 지킨다
      await dbQuery(`UPDATE automation SET enabled = false, disabled_reason = 'failures' WHERE id = $1`, [tired.id])
      const row = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [] })).body.row.id
      await api('PATCH', `/rows/${row}`, { cells: [{ propertyId: qty, value: { type: 'number', number: 7 } }] })
      const { runAutomationDispatch } = await import(src('automation/dispatch.ts'))
      const dispatched = await runAutomationDispatch(new Date(Date.now() + 10_000), { workspaces: [workspaceId] })
      const ITEM = (id) => `[data-testid="db-automation-item"][data-automation-id="${id}"]`
      const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)

      // ① 고치기만 받은 사람에게는 ⚡ 가 없다
      const editor = await joinAs(workspaceId, await createUser(`고치는 동료 ${stamp}`), 'member')
      const access = (body) => api('POST', `/pages/${db.id}/access`, body)
      await access({ action: 'restrict' })
      await access({ action: 'grant', principal: { type: 'user', id: ctx.userId }, level: 'full_access' })
      await access({ action: 'grant', principal: { type: 'user', id: editor.userId }, level: 'edit' })
      await access({ action: 'revoke', principal: { type: 'workspace_everyone' } })
      try {
        await browseAs(editor.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        const loaded = await waitFor(`!!document.querySelector('[data-testid="db-templates-button"]')`, 15000)
        check('★ 고치기만 받은 사람에게는 ⚡ 가 서지 않는다 — 정의의 문(전체 권한)과 같다',
          loaded && !(await evaluate(`!!document.querySelector('[data-testid="db-automations-button"]')`)), String(loaded))
      } finally {
        await browseAs(session)
      }

      // ② 배지 — 켜진 수 · 꺼진 까닭
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-automations-button"]')`, 15000)
      check('★ ⚡ 의 배지 — 켜진 수(1) · 꺼진 까닭이 있으면 !',
        (await text('[data-testid="db-automations-count"]')) === '1' && (await evaluate(`!!document.querySelector('[data-testid="db-automations-attention"]')`)),
        JSON.stringify([await text('[data-testid="db-automations-count"]'), dispatched]))

      // ③ 목록 — 트리거 · 액션 · 실행 주체 · 꺼진 까닭
      await clickSelector('[data-testid="db-automations-button"]')
      await waitFor(`!!document.querySelector('${ITEM(auto.id)}') && !!document.querySelector('${ITEM(tired.id)}')`, 8000)
      const triggerText = await text(`${ITEM(auto.id)} [data-testid="db-automation-triggers"]`)
      check('★ 트리거 요약 — 속성 이름과 조건(보기의 칩과 같은 말)', triggerText === '‘수량’이 바뀌면 (수량 · 초과 · 5)', triggerText)
      check('행 추가 트리거 · 액션 요약 · 실행 주체',
        (await text(`${ITEM(tired.id)} [data-testid="db-automation-triggers"]`)) === '새 항목이 추가되면'
          && (await text(`${ITEM(auto.id)} [data-testid="db-automation-actions"]`)) === '→ 값 바꾸기'
          && ((await text(`${ITEM(auto.id)} [data-testid="db-automation-creator"]`)) ?? '').startsWith('실행 주체: ')
          && !((await text(`${ITEM(auto.id)} [data-testid="db-automation-creator"]`)) ?? '').includes('떠난 사람'),
        JSON.stringify([await text(`${ITEM(tired.id)} [data-testid="db-automation-triggers"]`), await text(`${ITEM(auto.id)} [data-testid="db-automation-actions"]`)]))
      check('★ 꺼진 까닭을 말한다 — 실패가 이어져 꺼졌다',
        ((await text(`${ITEM(tired.id)} [data-testid="db-automation-reason"]`)) ?? '').includes('세 번 이어서 실패'),
        String(await text(`${ITEM(tired.id)} [data-testid="db-automation-reason"]`)))

      // ④ 켜고 끄기 — 켜면 까닭이 지워지고 배지가 따라간다
      await clickSelector(`${ITEM(tired.id)} [data-testid="db-automation-toggle"]`)
      const turnedOn = await waitFor(`document.querySelector('${ITEM(tired.id)} [data-testid="db-automation-toggle"]')?.getAttribute('aria-checked') === 'true'
        && !document.querySelector('${ITEM(tired.id)} [data-testid="db-automation-reason"]')
        && document.querySelector('[data-testid="db-automations-count"]')?.textContent === '2'
        && !document.querySelector('[data-testid="db-automations-attention"]')`, 8000)
      const [tiredRow] = await dbQuery(`SELECT enabled, disabled_reason FROM automation WHERE id = $1`, [tired.id])
      check('★ 켜면 꺼진 까닭이 지워진다 — 배지가 2 · ! 가 사라진다(서버도)', turnedOn && tiredRow.enabled && tiredRow.disabled_reason === null, JSON.stringify(tiredRow))
      await clickSelector(`${ITEM(auto.id)} [data-testid="db-automation-toggle"]`)
      const turnedOff = await waitFor(`document.querySelector('${ITEM(auto.id)} [data-testid="db-automation-toggle"]')?.getAttribute('aria-checked') === 'false'
        && document.querySelector('[data-testid="db-automations-count"]')?.textContent === '1'`, 8000)
      const [autoRow] = await dbQuery(`SELECT enabled, disabled_reason FROM automation WHERE id = $1`, [auto.id])
      check('끄면 꺼지고 까닭은 없다(사람이 껐다)', turnedOff && !autoRow.enabled && autoRow.disabled_reason === null, JSON.stringify(autoRow))

      // ⑤ 실행 기록 — 결과 · 트리거된 항목 · 단계
      await clickSelector(`${ITEM(auto.id)} [data-testid="db-automation-runs-button"]`)
      await waitFor(`!!document.querySelector('${ITEM(auto.id)} [data-testid="db-automation-run"]')`, 8000)
      const run = await evaluate(`(() => {
        const r = document.querySelector('${ITEM(auto.id)} [data-testid="db-automation-run"]')
        return { status: r?.dataset.status, row: r?.querySelector('[data-testid="db-automation-run-row"]')?.textContent, href: r?.querySelector('a[data-testid="db-automation-run-row"]')?.getAttribute('href'),
          steps: [...(r?.querySelectorAll('[data-testid="db-automation-step"]') ?? [])].map((s) => s.textContent) }
      })()`)
      check('★ 실행 기록 — 성공 · 트리거된 항목(제목 없음 → 그 행으로) · 단계(값 바꾸기 — 완료)',
        run.status === 'success' && run.row === '제목 없음' && (run.href ?? '').endsWith(`/${row}`) && run.steps.join('|') === '1. 값 바꾸기 — 완료',
        JSON.stringify(run))
      await clickSelector(`${ITEM(tired.id)} [data-testid="db-automation-runs-button"]`)
      check('실행된 적이 없으면 그렇게 말한다', await waitFor(`!!document.querySelector('${ITEM(tired.id)} [data-testid="db-automation-runs-empty"]')`, 8000))

      // ⑥ 지우기는 한 번 더 묻는다
      await clickSelector(`${ITEM(tired.id)} [data-testid="db-automation-delete"]`)
      await waitFor(`!!document.querySelector('${ITEM(tired.id)} [data-testid="db-automation-delete-confirm"]')`, 3000)
      await clickSelector(`${ITEM(tired.id)} [data-testid="db-automation-delete-no"]`)
      const kept = await waitFor(`!document.querySelector('${ITEM(tired.id)} [data-testid="db-automation-delete-confirm"]') && !!document.querySelector('${ITEM(tired.id)}')`, 3000)
      await clickSelector(`${ITEM(tired.id)} [data-testid="db-automation-delete"]`)
      await waitFor(`!!document.querySelector('${ITEM(tired.id)} [data-testid="db-automation-delete-yes"]')`, 3000)
      await clickSelector(`${ITEM(tired.id)} [data-testid="db-automation-delete-yes"]`)
      const gone = await waitFor(`!document.querySelector('${ITEM(tired.id)}')`, 8000)
      const listed = (await api('GET', `/data-sources/${ds}/automations`)).body?.automations ?? []
      check('★ 지우기는 한 번 더 묻는다 — 그만두면 남고, 지우면 사라진다(서버도)',
        kept && gone && listed.length === 1 && listed[0].id === auto.id, JSON.stringify([kept, gone, listed.map((a) => a.name)]))
    }

    if (sectionIf('DB automation — 만들기 · 고치기 (5b-3b · F-08-09)')) {
      // 패널의 "+ 새 자동화"로 만든다 — 이름 · 속성 편집 트리거와 조건(보기의 필터와 같은 칸) · 트리거된 행의 값 바꾸기(숨긴 속성도) → 목록 ·
      // 배지 · 서버. 실행된다. "고치기"는 같은 편집기 — 실행 주체를 말하고 · 조건을 빼고 트리거를 더한다. 조건 값이 비면 · 이름이 비면
      // 저장하지 않고 까닭을 말한다. 자기 데이터를 스스로 만든다 — E2E_ONLY 로 홀로 돈다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const src = (p) => new URL(`../src/lib/${p}`, import.meta.url).href
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      // 칸이 없으면 치지 않는다 — 앞 장면이 틀려 편집기가 닫혔어도 판은 끝까지 돌고 검사가 실패를 말한다
      const fill = async (selector, text) => {
        const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select(); return true })()`)
        if (found) await typeText(text)
      }
      const db = (await api('POST', '/databases', { name: `자동화 편집 ${stamp}` })).body.database
      const ds = db.dataSourceId
      const prop = async (name, type) => (await api('POST', `/data-sources/${ds}/properties`, { name, type })).body.property.id
      const qty = await prop('수량', 'number')
      const mark = await prop('표시', 'checkbox')
      await api('PATCH', `/views/${db.defaultViewId}/columns/${mark}`, { visible: false })
      const EDITOR = '[data-testid="db-automation-editor"]'
      const name = `많으면 표시 ${stamp}`
      const listed = async () => (await api('GET', `/data-sources/${ds}/automations`)).body?.automations ?? []

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-automations-button"]')`, 15000)
      await clickSelector('[data-testid="db-automations-button"]')
      await waitFor(`!!document.querySelector('[data-testid="db-automations-new"]')`, 8000)
      await clickSelector('[data-testid="db-automations-new"]')
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-automation-trigger-type"]')`, 5000)
      check('새 자동화 — 기본 이름 · 행 추가 트리거 하나 · 내 권한으로 돈다고 말한다',
        (await evaluate(`document.querySelector('${EDITOR} [data-testid="db-automation-editor-name"]').value`)) === '새 자동화'
          && (await evaluate(`[...document.querySelectorAll('${EDITOR} [data-testid="db-automation-trigger"]')].map((li) => li.dataset.kind).join(',')`)) === 'page_added'
          && ((await evaluate(`document.querySelector('${EDITOR} [data-testid="db-automation-editor-actor"]')?.textContent`)) ?? '').includes('내 권한'))

      // ① 이름 · 트리거(수량이 바뀌면 · 초과 5) · 액션(숨긴 "표시"를 체크)
      await fill(`${EDITOR} [data-testid="db-automation-editor-name"]`, name)
      await setSelect(`${EDITOR} [data-testid="db-automation-trigger-type"]`, 'edited')
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-automation-trigger-property"]')`, 3000)
      await setSelect(`${EDITOR} [data-testid="db-automation-trigger-property"]`, qty)
      await clickSelector(`${EDITOR} [data-testid="db-automation-condition-add"]`)
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-automation-condition-operator"]')`, 3000)
      await setSelect(`${EDITOR} [data-testid="db-automation-condition-operator"]`, 'greater_than')
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-filter-value"]')`, 3000)
      // 값이 비면 저장하지 않는다
      await clickSelector(`${EDITOR} [data-testid="db-automation-editor-save"]`)
      const emptyRefused = await waitFor(`(document.querySelector('${EDITOR} [data-testid="db-automation-editor-error"]')?.textContent ?? '') === '1번째 트리거: 조건의 값을 넣으세요.'`, 3000)
      await fill(`${EDITOR} [data-testid="db-filter-value"]`, '5')
      await key('Enter')
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-automation-add-action"]')`, 8000)
      await clickSelector(`${EDITOR} [data-testid="db-automation-add-action"]`)
      await waitFor(`[...(document.querySelector('${EDITOR} [data-testid="db-automation-property"]')?.options ?? [])].some((o) => o.value === '${mark}')`, 5000)
      await setSelect(`${EDITOR} [data-testid="db-automation-property"]`, mark)
      await waitFor(`document.querySelector('${EDITOR} [data-testid="db-automation-value"]')?.type === 'checkbox'`, 3000)
      await clickSelector(`${EDITOR} [data-testid="db-automation-value"]`)
      await clickSelector(`${EDITOR} [data-testid="db-automation-editor-save"]`)
      const closed = await waitFor(`!document.querySelector('${EDITOR}') && !!document.querySelector('[data-testid="db-automation-item"]')`, 8000)
      const made = (await listed())[0]
      check('★ 조건의 값이 비면 저장하지 않고 몇 번째 트리거인지 말한다', emptyRefused,
        String(await evaluate(`document.querySelector('${EDITOR} [data-testid="db-automation-editor-error"]')?.textContent ?? null`)))
      check('★ 만든다 — 이름 · 속성 편집 트리거와 조건(초과 5) · 숨긴 속성을 체크하는 액션(서버)',
        closed && made?.name === name && made.enabled
          // jsonb 는 키 순서를 바꾼다 — 칸마다 본다
          && made.triggers.length === 1 && made.triggers[0].type === 'property_edited' && made.triggers[0].propertyId === qty
          && made.triggers[0].condition?.operator === 'greater_than' && made.triggers[0].condition?.value === 5
          && made.actions.length === 1 && made.actions[0].type === 'edit_property'
          && made.actions[0].config.cells?.[0]?.propertyId === mark && made.actions[0].config.cells?.[0]?.value?.checkbox === true,
        JSON.stringify(made))
      const item = `[data-testid="db-automation-item"][data-automation-id="${made?.id}"]`
      check('★ 저장하면 목록과 배지가 그 결과로 — 요약은 보기의 칩과 같은 말',
        (await evaluate(`document.querySelector('${item} [data-testid="db-automation-triggers"]')?.textContent`)) === '‘수량’이 바뀌면 (수량 · 초과 · 5)'
          && (await evaluate(`document.querySelector('[data-testid="db-automations-count"]')?.textContent`)) === '1',
        String(await evaluate(`document.querySelector('${item} [data-testid="db-automation-triggers"]')?.textContent`)))

      // ② 실행된다 — 수량 7 → 표시가 체크
      const row = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [] })).body.row.id
      await api('PATCH', `/rows/${row}`, { cells: [{ propertyId: qty, value: { type: 'number', number: 7 } }] })
      const { runAutomationDispatch } = await import(src('automation/dispatch.ts'))
      await runAutomationDispatch(new Date(Date.now() + 10_000), { workspaces: [workspaceId] })
      const markCell = (await api('GET', `/views/${db.defaultViewId}/rows`)).body?.rows?.find((r) => r.id === row)?.properties?.[mark]
      check('★ 화면에서 만든 자동화가 돈다 — 수량 7 이면 숨긴 "표시"가 체크된다', markCell?.checkbox === true, JSON.stringify(markCell))

      // ③ 고치기 — 실행 주체를 말한다 · 조건을 빼고 행 추가 트리거를 더한다 · 이름이 비면 저장하지 않는다
      await clickSelector(`${item} [data-testid="db-automation-edit"]`)
      await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-automation-condition-remove"]')`, 5000)
      const actor = await evaluate(`document.querySelector('${EDITOR} [data-testid="db-automation-editor-actor"]')?.textContent ?? ''`)
      await fill(`${EDITOR} [data-testid="db-automation-editor-name"]`, ' ')
      await clickSelector(`${EDITOR} [data-testid="db-automation-editor-save"]`)
      const nameRefused = await waitFor(`(document.querySelector('${EDITOR} [data-testid="db-automation-editor-error"]')?.textContent ?? '') === '이름을 넣으세요.'`, 3000)
      await fill(`${EDITOR} [data-testid="db-automation-editor-name"]`, `${name} 고침`)
      await clickSelector(`${EDITOR} [data-testid="db-automation-condition-remove"]`)
      await clickSelector(`${EDITOR} [data-testid="db-automation-add-trigger"]`)
      const anyNote = await waitFor(`document.querySelectorAll('${EDITOR} [data-testid="db-automation-trigger"]').length === 2 && (document.querySelector('${EDITOR}')?.textContent ?? '').includes('하나라도 일어나면 실행합니다')`, 3000)
      await clickSelector(`${EDITOR} [data-testid="db-automation-editor-save"]`)
      await waitFor(`!document.querySelector('${EDITOR}')`, 8000)
      const edited = (await listed())[0]
      check('고칠 때는 실행 주체가 처음 만든 사람으로 남는다고 말한다', actor.startsWith('실행 주체는 처음 만든'), actor)
      check('이름이 비면 저장하지 않는다', nameRefused)
      check('★ 고친다 — 같은 편집기 · 조건을 빼고 행 추가 트리거를 더한다(둘이면 "하나라도") · 켜짐 · 실행 주체는 그대로(서버)',
        anyNote && edited?.id === made?.id && edited.name === `${name} 고침` && edited.enabled && edited.createdBy.id === made.createdBy.id
          && JSON.stringify(edited.triggers.map((t) => t.type).sort()) === JSON.stringify(['page_added', 'property_edited'])
          && edited.triggers.find((t) => t.type === 'property_edited')?.condition === null
          // 서버는 트리거를 종류 순으로 준다(행 추가가 먼저)
          && (await evaluate(`document.querySelector('${item} [data-testid="db-automation-triggers"]')?.textContent`)) === '새 항목이 추가되면 또는 ‘수량’이 바뀌면',
        JSON.stringify(edited))

      // ④ 취소하면 그대로
      await clickSelector(`${item} [data-testid="db-automation-edit"]`)
      await waitFor(`!!document.querySelector('${EDITOR}')`, 5000)
      await fill(`${EDITOR} [data-testid="db-automation-editor-name"]`, '버릴 이름')
      await clickSelector(`${EDITOR} [data-testid="db-automation-editor-cancel"]`)
      await waitFor(`!document.querySelector('${EDITOR}')`, 3000)
      check('취소하면 바뀌지 않는다', (await listed())[0]?.name === `${name} 고침`
        && (await evaluate(`document.querySelector('${item} [data-testid="db-automation-name"]')?.textContent`)) === `${name} 고침`)
    }

    if (sectionIf('웹훅 보내기 — 편집 (5c-3a · F-08-13)')) {
      // 버튼 설정에서 "+ 웹훅 보내기" — 받는 주소 · 헤더 · 보낼 속성(숨긴 속성도)을 넣고 저장한다. 서버는 주소 · 헤더 값을 돌려주지 않는다 —
      // 다시 열면 힌트만 보이고 비워 둔 채 저장해도 그대로다. 누르면 받는 서버에 그 헤더와 몸이 닿는다(보내기는 이 판에서 부른다). 틀린
      // 헤더는 몇 번째 액션인지 말하고 저장하지 않는다. 받는 서버는 127.0.0.1:HOOK_PORT — 앱은 그 주소만 검사를 비켜 간다.
      const stamp = Date.now()
      const api = async (method, path, body) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers: authed, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const fill = async (selector, text) => {
        const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select(); return true })()`)
        if (found) await typeText(text)
      }
      const { runAutomationWebhooks } = await import(new URL('../src/lib/automation/webhook-send.ts', import.meta.url).href)
      const { createServer } = await import('node:http')
      const received = []
      const receiver = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          received.push({ path: req.url, headers: req.headers, body })
          res.writeHead(200).end('ok')
        })
      })
      await new Promise((r) => receiver.listen(HOOK_PORT, '127.0.0.1', r))
      const savedAllow = process.env.OUTBOUND_ALLOW_HOSTS
      process.env.OUTBOUND_ALLOW_HOSTS = `127.0.0.1:${HOOK_PORT}` // 보내기는 이 판에서 부른다
      try {
        const db = (await api('POST', '/databases', { name: `웹훅 버튼 ${stamp}` })).body.database
        const ds = db.dataSourceId
        const prop = async (name, type) => (await api('POST', `/data-sources/${ds}/properties`, { name, type })).body.property.id
        const qty = await prop('수량', 'number')
        await api('PATCH', `/views/${db.defaultViewId}/columns/${qty}`, { visible: false })
        const buttonId = await prop('알리기', 'button')
        const row = (await api('POST', `/views/${db.defaultViewId}/rows`, { cells: [{ propertyId: qty, value: { type: 'number', number: 7 } }] })).body.row.id
        const EDITOR = '[data-testid="db-button-editor"]'
        const MENU = `th:has([data-testid="db-column-menu"][aria-label="알리기 속성 메뉴"]) [data-testid="db-column-menu"]`
        const hookPath = `/hook-${stamp}`
        const openEditor = async () => {
          for (let i = 0; i < 6 && !(await evaluate(`!!document.querySelector('[data-testid="db-column-button"]')`)); i += 1) {
            await clickSelector(MENU)
            await waitFor(`!!document.querySelector('[data-testid="db-column-button"]')`, 2000)
          }
          await clickSelector('[data-testid="db-column-button"]')
          return waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-add-webhook-action"]')`, 8000)
        }
        const savedActions = async () => (await api('GET', `/data-sources/${ds}/properties/${buttonId}/actions`)).body?.actions ?? []

        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`!!document.querySelector('tr[data-row-id="${row}"] [data-testid="db-button-cell"]')`, 15000)
        await openEditor()
        // ① 넣고 저장 — 주소 · 헤더 · 숨긴 속성
        await clickSelector(`${EDITOR} [data-testid="db-button-add-webhook-action"]`)
        await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-webhook-url"]')`, 3000)
        await fill(`${EDITOR} [data-testid="db-button-webhook-url"]`, `http://127.0.0.1:${HOOK_PORT}${hookPath}`)
        await clickSelector(`${EDITOR} [data-testid="db-button-webhook-add-header"]`)
        await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-webhook-header-name"]')`, 3000)
        await fill(`${EDITOR} [data-testid="db-button-webhook-header-name"]`, 'X-Token')
        await fill(`${EDITOR} [data-testid="db-button-webhook-header-value"]`, `tok-${stamp}`)
        const hiddenListed = await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-webhook-property"][data-property-id="${qty}"]')`, 5000)
        await clickSelector(`${EDITOR} [data-testid="db-button-webhook-property"][data-property-id="${qty}"]`)
        await clickSelector(`${EDITOR} [data-testid="db-button-save"]`)
        const closed = await waitFor(`!document.querySelector('${EDITOR}')`, 8000)
        const stored = await savedActions()
        const config = stored[0]?.config ?? {}
        check('★ 웹훅을 넣고 저장한다 — 주소 · 헤더 · 숨긴 속성(서버) · 주소와 헤더 값은 돌아오지 않는다(힌트 · 이름만)',
          hiddenListed && closed && stored.length === 1 && stored[0].type === 'send_webhook'
            && String(config.urlHint ?? '').startsWith(`127.0.0.1:${HOOK_PORT}/…`)
            && JSON.stringify(config.headers) === JSON.stringify([{ name: 'x-token' }])
            && JSON.stringify(config.properties) === JSON.stringify([qty])
            && !JSON.stringify(stored).includes(`tok-${stamp}`) && !JSON.stringify(stored).includes(hookPath),
          JSON.stringify(stored))

        // ② 다시 열면 힌트만 — 비워 둔 채 저장해도 그대로
        await openEditor()
        await waitFor(`!!document.querySelector('${EDITOR} [data-testid="db-button-webhook-url"]')`, 5000)
        const shown = await evaluate(`(() => {
          const url = document.querySelector('${EDITOR} [data-testid="db-button-webhook-url"]')
          const value = document.querySelector('${EDITOR} [data-testid="db-button-webhook-header-value"]')
          return { url: url?.value, urlHint: url?.placeholder, header: value?.value, headerHint: value?.placeholder,
            checked: document.querySelector('${EDITOR} [data-testid="db-button-webhook-property"][data-property-id="${qty}"]')?.checked }
        })()`)
        await clickSelector(`${EDITOR} [data-testid="db-button-save"]`)
        // 저장이 **받아들여져** 닫혀야 한다 — 거절돼 열린 채면 서버 값이 그대로인 것은 아무것도 말하지 않는다
        const resaved = await waitFor(`!document.querySelector('${EDITOR}')`, 8000)
        check('★ 다시 열면 주소 · 헤더 값은 비어 있고 힌트만 보인다 — 비워 둔 채 저장해도 그대로',
          resaved && shown.url === '' && String(shown.urlHint).includes('지금: 127.0.0.1') && shown.header === '' && String(shown.headerHint).includes('저장된 값')
            && shown.checked === true && (await savedActions())[0]?.config?.urlHint === config.urlHint,
          JSON.stringify([resaved, shown, await evaluate(`document.querySelector('${EDITOR} [data-testid="db-button-editor-error"]')?.textContent ?? null`)]))

        // ③ 누르면 받는 서버에 그 헤더와 몸이 닿는다
        await clickSelector(`tr[data-row-id="${row}"] [data-testid="db-button-cell"]`)
        await waitFor(`(document.querySelector('tr[data-row-id="${row}"] [data-testid="db-button-result"]')?.textContent ?? '') === '완료'`, 10000)
        await runAutomationWebhooks(new Date(Date.now() + 1000), { workspaces: [workspaceId] })
        const got = received.find((r) => r.path === hookPath)
        const body = got === undefined ? null : JSON.parse(got.body)
        check('★ 누르면 받는 서버에 닿는다 — 저장한 헤더 · 고른 속성의 값 · run_id',
          got !== undefined && got.headers['x-token'] === `tok-${stamp}` && body?.properties?.['수량']?.number === 7 && typeof body?.run_id === 'string',
          JSON.stringify(got ?? received.map((r) => r.path)))

        // ④ 틀린 헤더는 몇 번째 액션인지 말하고 저장하지 않는다
        await openEditor()
        await clickSelector(`${EDITOR} [data-testid="db-button-webhook-add-header"]`)
        await waitFor(`document.querySelectorAll('${EDITOR} [data-testid="db-button-webhook-header-name"]').length === 2`, 3000)
        await evaluate(`(() => { const all = document.querySelectorAll('${EDITOR} [data-testid="db-button-webhook-header-name"]'); const el = all[all.length - 1]; el.focus(); el.select() })()`)
        await typeText('Host')
        await evaluate(`(() => { const all = document.querySelectorAll('${EDITOR} [data-testid="db-button-webhook-header-value"]'); const el = all[all.length - 1]; el.focus(); el.select() })()`)
        await typeText('evil.example.com')
        await clickSelector(`${EDITOR} [data-testid="db-button-save"]`)
        const refused = await waitFor(`(document.querySelector('${EDITOR} [data-testid="db-button-editor-error"]')?.textContent ?? '').startsWith('1번째 액션: 헤더가 맞지 않습니다')`, 5000)
        check('★ 정해진 헤더(Host)는 몇 번째 액션인지 말하고 저장하지 않는다',
          refused && !!(await evaluate(`!!document.querySelector('${EDITOR}')`)) && JSON.stringify((await savedActions())[0]?.config?.headers) === JSON.stringify([{ name: 'x-token' }]),
          String(await evaluate(`document.querySelector('${EDITOR} [data-testid="db-button-editor-error"]')?.textContent ?? null`)))
      } finally {
        if (savedAllow === undefined) delete process.env.OUTBOUND_ALLOW_HOSTS
        else process.env.OUTBOUND_ALLOW_HOSTS = savedAllow
        receiver.closeAllConnections()
        await new Promise((r) => receiver.close(() => r()))
      }
    }

    if (sectionIf('개인 필터 · 정렬 — 화면 (2h-2 · F-04-17)')) {
      // 볼 수만 있는 사람(브라우저 세션을 바꾼다)이 도구줄의 필터로 조건을 걸면 **자기 것**으로 저장되고 그 사람의 표만 좁혀진다 — "나만 보는
      // 필터" 표시 · 초기화. 편집자는 자기 개인 것을 "모두에게 저장"한다. 브라우저 세션은 끝에 반드시 소유자로 되돌린다.
      const stamp = Date.now()
      const api = async (method, path, body, headers = authed) => {
        const r = await fetch(`${BASE}/api/workspaces/${workspaceId}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const clickOn = async (selector) => {
        const p = await evaluate(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)})
          if (!e) return null
          e.scrollIntoView({ block: 'center' })
          const r = e.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (p) await click(p.x, p.y)
        return p !== null
      }
      const setSelect = (selector, value) => evaluate(`(() => {
        const s = document.querySelector(${JSON.stringify(selector)})
        if (!s) return false
        s.value = ${JSON.stringify(value)}
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      const browseAs = (token) => send('Network.setCookie', { name: 'nc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
      const db = (await api('POST', '/databases', { name: `개인 필터 화면 ${stamp}` })).body.database
      const view = db.defaultViewId
      const score = (await api('POST', `/data-sources/${db.dataSourceId}/properties`, { name: '점수', type: 'number' })).body.property.id
      const titleProp = (await api('GET', `/views/${view}`)).body.view.columns.find((c) => c.type === 'title').propertyId
      for (const [t, n] of [['가', 10], ['나', 20], ['다', 30]]) {
        await api('POST', `/views/${view}/rows`, { cells: [{ propertyId: titleProp, value: { type: 'title', title: [textRun(t)] } }, { propertyId: score, value: { type: 'number', number: n } }] })
      }
      await api('PATCH', `/views/${view}`, { filter: { property_id: score, operator: 'greater_than', value: 15 } })
      // 볼 수만 있는 동료 — 이 표만 'view'
      const viewer = await joinAs(workspaceId, await createUser(`보는 동료 ${stamp}`), 'member')
      const access = (body) => api('POST', `/pages/${db.id}/access`, body)
      await access({ action: 'restrict' })
      await access({ action: 'grant', principal: { type: 'user', id: ctx.userId }, level: 'full_access' })
      await access({ action: 'grant', principal: { type: 'user', id: viewer.userId }, level: 'view' })
      await access({ action: 'revoke', principal: { type: 'workspace_everyone' } })
      const titlesJs = `[...document.querySelectorAll('[data-testid="db-table"] tbody tr')].map((tr) => tr.querySelector('[data-testid="db-row-title"]')?.textContent ?? '').join(',')`
      const titles = () => evaluate(titlesJs)

      try {
        await browseAs(viewer.token)
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 2`, 15000)
        check('볼 수만 있는 사람 — 공유 필터(> 15)로 두 행 · "나만 보는" 표시는 없다',
          (await titles()) === '나,다' && !(await evaluate(`!!document.querySelector('[data-testid="db-personal"]')`)), await titles())
        // 필터 패널 — 규칙의 값을 25 로, 조건을 "미만"으로
        await clickOn('[data-testid="db-filter-button"]')
        await waitFor(`!!document.querySelector('[data-testid="db-filter-rule"]')`, 5000)
        check('★ 볼 수만 있는 사람도 필터 패널을 고칠 수 있다(잠겨 있지 않다)',
          await evaluate(`(() => { const s = document.querySelector('[data-testid="db-filter-rule"] select[aria-label="필터 조건"]'); return !!s && !s.disabled })()`))
        await setSelect('[data-testid="db-filter-rule"] select[aria-label="필터 조건"]', 'less_than')
        await evaluate(`(() => { const i = document.querySelector('[data-testid="db-filter-value"]'); i.focus(); i.select() })()`)
        await typeText('25')
        await key('Enter')
        check('★ 저장하면 그 사람의 표만 좁혀진다(< 25 — 공유 조건을 대체) · "나만 보는 필터"',
          await waitFor(`${titlesJs} === '가,나' && (document.querySelector('[data-testid="db-personal"]')?.textContent ?? '').includes('나만 보는 필터')`, 10000),
          await titles())
        check('볼 수만 있는 사람에게는 "모두에게 저장"이 없다', !(await evaluate(`!!document.querySelector('[data-testid="db-personal-publish"]')`)))
        const shared = await api('GET', `/views/${view}/rows`)
        check('★ 소유자는 여전히 공유 필터(> 15)로 본다', (shared.body?.rows ?? []).map((r) => r.title).join(',') === '나,다')
        await clickOn('[data-testid="db-personal-reset"]')
        check('초기화 — 공유 것으로 돌아간다', await waitFor(`${titlesJs} === '나,다' && !document.querySelector('[data-testid="db-personal"]')`, 10000), await titles())
      } finally {
        await browseAs(session)
      }

      // 편집자 — 자기 개인 것을 모두에게
      await api('PATCH', `/views/${view}/personal`, { sorts: [{ property_id: score, direction: 'desc' }] })
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/db/${db.id}` })
      await waitFor(`!!document.querySelector('[data-testid="db-personal-publish"]')`, 15000)
      await clickOn('[data-testid="db-personal-publish"]')
      const stored = async () => (await api('GET', `/views/${view}`)).body?.view
      check('★ 편집자의 "모두에게 저장" — 개인 정렬이 공유 정렬이 되고 표시는 사라진다',
        (await waitFor(`!document.querySelector('[data-testid="db-personal"]') && ${titlesJs} === '다,나'`, 10000))
          // jsonb 는 키 순서를 다시 매긴다 — 값으로 비교한다
          && ((s) => s?.length === 1 && s[0].property_id === score && s[0].direction === 'desc')((await stored())?.sorts),
        JSON.stringify((await stored())?.sorts))
    }

    section('전체')
    check('페이지에서 오류가 나지 않았다', pageErrors.length === 0, pageErrors.join('\n      '))
    const serverErrors = serverOutput.split('\n').filter((l) => l.includes('⨯'))
    check('서버에서 오류가 나지 않았다', serverErrors.length === 0, [...serverErrorSections, ...serverErrors].join('\n      '))
  } finally {
    await closePool().catch(() => undefined)
    for (const tab of tabs) tab.ws.close()
    cdp?.ws.close()
    browser?.kill()
    server.kill()
    collab?.kill()
    if (profile) {
      // 브라우저가 파일을 막 놓는 중일 수 있다. 못 지워도 임시 폴더다.
      await sleep(300)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* 임시 폴더 */
      }
    }
  }
}

try {
  await main()
} catch (e) {
  console.error(`\n실행 실패: ${e instanceof Error ? e.message : e}`)
  process.exit(2)
}

const failed = results.filter((r) => !r.ok).length
if (E2E_ONLY.length > 0) {
  console.log(`\n⚠ E2E_ONLY=${process.env.E2E_ONLY} — 게이트 ${gatesRun}개 실행 · ${gatesSkipped}개 건너뜀. 전체 판이 아니다 — 문서에 적는 숫자는 필터 없는 판의 것이다.`)
  if (gatesRun === 0) {
    console.log('E2E_ONLY 가 아무 게이트와도 맞지 않았다 — 제목 조각을 다시 보라.')
    process.exit(1)
  }
}
console.log(`\n${results.length - failed} / ${results.length} 통과`)
process.exit(failed === 0 ? 0 : 1)
