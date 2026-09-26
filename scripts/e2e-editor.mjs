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

const { textRun, pageMentionRun, mentionTarget } = await import(new URL('../src/lib/contracts/rich-text.ts', import.meta.url).href)
// 본문 준비 · 확인은 **서버 명령 경로**로 한다(CRDT 6e). 본문 저장 API(PUT)는 걷어냈다 — 편집은 협업 서버로만 간다.
const { resolveSessionContext } = await import(new URL('../src/lib/auth/session-context.ts', import.meta.url).href)
const { savePageBody, loadPageBody } = await import(new URL('../src/lib/block/save-page-body.ts', import.meta.url).href)
const { closePool } = await import(new URL('../src/lib/db/pool.ts', import.meta.url).href)
// 알림은 자기 글에는 오지 않는다 — 인박스를 보려면 동료가 하나 필요하다(코멘트 4조각).
const { createUser, joinAs } = await import(new URL('../src/lib/testing/db-fixtures.ts', import.meta.url).href)
const { createDiscussion } = await import(new URL('../src/lib/comment/discussion.ts', import.meta.url).href)

const PORT = Number(process.env.E2E_PORT ?? 3100)
const COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? 3101)
const BASE = `http://localhost:${PORT}`
const COLLAB_URL = `ws://localhost:${COLLAB_PORT}`
const HEADFUL = process.env.E2E_HEADFUL === '1'

// ── 결과 ──────────────────────────────────────────────────────────────

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  o' : '  X'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}
function section(title) {
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

function startServer() {
  if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    throw new Error('프로덕션 빌드가 없다. `npm run build` 를 먼저 돌려라.')
  }
  const server = spawn(
    process.execPath,
    [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)],
    { cwd: ROOT, env: { ...process.env, MAIL_TRANSPORT: 'console', COLLAB_URL }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const collect = (chunk) => {
    serverOutput += chunk.toString('utf8')
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

// ── CDP ───────────────────────────────────────────────────────────────

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const pageErrors = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      pageErrors.push(d?.exception?.description ?? d?.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
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
  return { ws, send, opened, pageErrors }
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
    const { send, pageErrors } = cdp

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
          await tab.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...end })
          await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', ...end })
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
    // 헤드리스는 창에 포커스가 없어서 클립보드 API 가 거부된다. 포커스를 흉내내고 권한을 준다.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await send('Browser.grantPermissions', { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
    await send('Network.setCookie', { name: 'nc_session', value: session, domain: 'localhost', path: '/', httpOnly: true })
    await send('Page.navigate', { url: `${BASE}/w/${workspaceId}/${pageId}` })

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
    await click(subGrip.x + subGrip.w / 2, subGrip.y + subGrip.h / 2)
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
    const typeText = async (text) => {
      await send('Input.insertText', { text })
      await sleep(60)
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

    section('공유 패널 (F-06-05)')
    // 새 페이지 + 하위 페이지에서 본다 — 상속 표시와 "따로 관리하기"가 핵심이다.
    const shareParent = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: '{}' })).json()).page.id
    const shareChild = (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify({ parentPageId: shareParent }) })).json()).page.id

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
    await waitFor(`(document.querySelector('[role="dialog"][aria-label="공유 설정"]')?.textContent ?? '').includes('따로 관리')`, 5000)
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

    section('그룹 — 라우트 · 공유 패널 (7a · F-06-03)')
    {
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

    section('그룹 화면 (7b · F-06-03)')
    {
      // 워크스페이스 홈의 "그룹" 절. 넣을 후보(멤버 · 게스트)는 서버 렌더가 싣으므로 화면을 열기 전에 만든다.
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

      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('[data-testid="group-panel"]')`, 15000)
      check('워크스페이스 홈에 그룹 절이 있고 소유자에게는 만들기 칸이 있다',
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
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('${row(keeper)}')`, 15000)
      await clickOnSel(`${row(keeper)} [data-testid="group-delete"]`)
      await clickOnSel(`${row(keeper)} [data-testid="group-delete-confirm"]`)
      check('★ 관리자가 남지 않는 페이지가 생기는 지우기는 거부되고 그 수를 말한다',
        await waitFor(`(document.querySelector('[data-testid="group-error"]')?.textContent ?? '').includes('아무도 남지 않는 페이지 1개')`, 5000),
        await panelMessage())
      check('거부됐으니 그룹은 그대로다', (await evaluate(`!!document.querySelector('${row(keeper)}')`)) && (await serverGroups()).some((g) => g.id === keeper))

      // ⑦ 누가 무엇을 보는가 — 서버 렌더를 그 사람의 세션으로 받는다
      const homeAs = async (actor) =>
        (await fetch(`${BASE}/w/${workspaceId}`, { headers: { cookie: `nc_session=${actor.token}` } })).text()
      const asMember = await homeAs(screenMate)
      check('★ 멤버는 그룹을 보지만 만들기 · 지우기 버튼은 없다',
        asMember.includes('data-testid="group-panel"') && asMember.includes(keeperName) &&
          !asMember.includes('data-testid="group-create-name"') && !asMember.includes('data-testid="group-delete"'))
      const asGuest = await homeAs(screenGuest)
      check('★ 게스트에게는 그룹 절이 없다', !asGuest.includes('data-testid="group-panel"') && !asGuest.includes(keeperName))
    }

    section('teamspace — 라우트 · 공유 패널 (7c-1 · F-06-04)')
    {
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

    section('teamspace 화면 (7c-2 · F-06-04)')
    {
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
      // 멤버가 아닌 사람에게 그 페이지만 따로 공유하면 — Shared 섹션이 아직 없으니 "워크스페이스 페이지" 에 선다.
      const shared = await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${designPage}/access`, {
        method: 'POST', headers: authed,
        body: JSON.stringify({ action: 'grant', principal: { type: 'user', id: uiOutsider.userId }, level: 'view' }),
      })
      const outsiderShared = await (await pageAs(uiOutsider, `/w/${workspaceId}`)).text()
      const outsiderPage = await pageAs(uiOutsider, `/w/${workspaceId}/${designPage}`)
      const outsiderPageHtml = await outsiderPage.text()
      check('★ 따로 공유받은 teamspace 페이지는 "워크스페이스 페이지" 에 선다 — 사이드바에 그 teamspace 의 id 가 가지 않는다',
        shared.ok && outsiderShared.includes(designPage) && !outsiderShared.includes(design), `공유 ${shared.status}`)
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

    section('옮기기 — teamspace 로 · 밖으로 (7c-3 · F-06-20)')
    {
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

    section('데이터베이스를 teamspace 에 (7c-4 · F-04-14 · F-06-04)')
    {
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

    section('공개 범위 · 둘러보기 · 참여 (7c-5 · F-06-04)')
    {
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

    section('코멘트 패널 · 인박스 (F-05-08 · F-11-07)')
    {
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

    section('본문 글자에 단 코멘트 (F-05-07)')
    {
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

    section('@ 멘션 (F-07-08 · F-07-09 · F-05-09)')
    {
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

    section('내비게이션 — 최근 · 즐겨찾기 (W6-a)')
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

    section('검색 오버레이 (W7 · F-07-01)')
    // 이 절이 헤드리스로는 절대 안 보이는 것을 본다: 단축키가 에디터까지 새지
    // 않는가 · 포커스가 돌아오는가 · ↑↓/Enter 가 본문을 건드리지 않는가.
    {
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

    section('데이터베이스 표 (W8-b · F-04-14 · F-03-16)')
    // 이 절이 헤드리스로는 볼 수 없는 것을 본다: 포커스가 칸을 따라 움직이는가 ·
    // 편집기가 쓴 Enter 가 표의 규칙을 한 번 더 타지 않는가 · 표 끝의 Tab 이 표 밖으로
    // 나가는가. 규칙 자체는 `grid-nav.test.ts` · `cell-format.test.ts` 가 본다.
    {
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
      const newDb = await evaluate(`(() => {
        const b = [...document.querySelectorAll('nav[aria-label="페이지 트리"] button')]
          .find((e) => e.textContent.includes('새 데이터베이스'))
        if (!b) return null
        b.scrollIntoView({ block: 'center' })
        const r = b.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })()`)
      check('사이드바에 "+ 새 데이터베이스" 가 있다', newDb !== null)
      if (newDb) await click(newDb.x, newDb.y)
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
      check('★ 표 끝의 Tab 은 포커스를 표 밖으로 보낸다 — 키보드 사용자를 가두지 않는다 (WCAG 2.1.2)',
        await waitFor(`!!document.activeElement && document.activeElement !== document.body
          && !document.querySelector('[data-testid="db-table"]').contains(document.activeElement)`, 3000),
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
      await clickOn('[data-testid="db-load-more"]')
      check('★ "더 보기" 가 나머지를 이어 붙이고 사라진다 — 57행',
        await waitFor(`document.querySelectorAll('[data-testid="db-table"] tbody tr').length === 57
          && !document.querySelector('[data-testid="db-load-more"]')`, 8000),
        `${await rowCount()}행`)
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
        await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
        check('소유자의 워크스페이스 홈에 전체 내보내기가 있다',
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
      section('데이터베이스 보드 (보드 4b · F-04-03 · F-04-11)')
      // 규칙(드롭 자리 · 상태 · 되돌리기)은 `board-drag.test.ts` 가, 서버(셀 값 + 자리 한 트랜잭션 · 그룹 질의 · 커서)는
      // `group.db.test.ts` 가 본다. 여기서는 **실제 포인터로** 카드를 끌어 놓는 길과, 그 결과가 서버에 남는지를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다 — 그 절의 워크스페이스 요약이 표 개수(1)를 센다. 이 절은 표를 둘 더 만든다.
      {
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
      section('데이터베이스 상태 속성 (보드 4c-1 · F-03-05)')
      // 값 계약 · 그룹 불변식 · 기본 옵션 · 옵션 순서는 `status.db.test.ts` · `verify-schema` ⑭ 가 본다. 여기서는 화면이
      // 그것을 **보여 주는지**를 본다 — 색 점 칩 · 그룹 머리로 구획된 편집기 · 새 옵션의 자리 · 보드의 자동 선택.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다 — 보드 절 머리말과 같은 이유).
      {
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
      section('데이터베이스 List 뷰 (보드 4c-2 · F-04-04)')
      // 어느 칸을 접는지 · 제목이 앞인지는 `list-layout.test.ts` 가, 서버(그룹 없이 만들어진다 · 모양만 바뀐다)는
      // `view.db.test.ts` 가 본다. 여기서는 **같은 격자가 목록 모양으로 그려지는지**와, 표의 키보드 · 편집이 그 모양에서도
      // 그대로 도는지를 본다 — List 는 별도 컴포넌트가 아니다(F-04-04).
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
      {
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
      section('데이터베이스 relation 칸 (relation 5b-1 · F-03-10)')
      // 엣지 · 거울상 · 권한 · 제목 맵의 규칙은 `relation.db.test.ts` · `verify-schema` ⑮ 가 본다. 여기서는 화면이 그것을
      // **그리는지**를 본다 — 제목 칩 · 휴지통에 간 연결 · "더 보기"로 온 행의 제목 · 목록과 보드의 배지.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 둘 더 만든다).
      {
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

      section('데이터베이스 relation 고르기 (relation 5b-2 · F-03-10)')
      // 후보 검색의 규칙(이미 연결된 행 제외 · LIKE 글자 그대로 · 권한)은 `relation.db.test.ts` ⑩ 이 본다. 여기서는 사람이
      // 하는 순서를 본다 — 속성 추가 폼에서 관계형을 만들고, 칸에서 찾아 고르고, × 로 빼고, 반대쪽 표에서 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 둘 더 만든다).
      {
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

      section('데이터베이스 rollup — 서버 (rollup 5c-1 · F-03-11)')
      // 집계 함수 · 권한 · 끊긴 설정의 규칙은 `rollup-functions.test.ts` · `rollup.db.test.ts` 가 본다. 화면은 5c-2 가 붙인다 —
      // 여기서는 빌드된 앱에서 라우트 둘이 실제로 답하는지, 그리고 **rollup 속성이 있어도 표가 열리는지**를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 둘 더 만든다).
      {
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

      section('데이터베이스 템플릿 — 서버 (템플릿 6c-1 · 6c-2 · F-08-02 · F-08-03)')
      // 권한 · 상한 · 기본 지정의 규칙은 `template.db.test.ts` 가 본다. 여기서는 빌드된 앱에서 라우트가 실제로 답하는지,
      // 그리고 **불변식 R1 이 화면까지 지켜지는지** — 템플릿을 만들어도 표에 행이 늘지 않는지 — 를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
      {
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

      section('데이터베이스 템플릿 — 화면 (템플릿 6c-3 · F-08-02)')
      // 만드는 · 채우는 · 버리는 길이 실제 브라우저에서 이어지는지 본다. 속성 목록은 표의 세 번째 모양
      // (`variant="record"`)이라 배치 규칙 자체는 `list-layout.test.ts` 가 DOM 없이 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
      {
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

      section('데이터베이스 New ▾ — 템플릿으로 만들기 · 기본 템플릿 (템플릿 6c-4 · F-08-02 · F-08-03)')
      // 문구 규칙은 `new-row.test.ts` 가, 복제 · 덮기 · 빠진 것의 개수는 `template.db.test.ts` 가 본다. 여기서는 표와 보드의
      // 버튼이 실제로 그 길을 타는지, 그리고 **기본 템플릿이 버튼의 글자와 동작을 함께 바꾸는지**를 본다.
      // ⚠ 익스포트 절 **뒤**에 있다(표를 하나 더 만든다).
      {
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

    section('페이지 복제 (복제 6a · 6b · F-02-09 · F-08-01)')
    // 재매핑 · 권한 · 상한의 규칙은 `duplicate-remap.test.ts` · `duplicate.db.test.ts` 가 본다. 여기서는 빌드된 앱에서
    // 라우트가 실제로 답하는지, 그리고 **사본이 열리는 진짜 페이지인지**를 본다.
    {
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
        (await waitFor(`document.body.textContent.includes(${JSON.stringify(marker)})`, 15000))
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
        (await waitFor(`!location.pathname.endsWith('/${source}') && document.body.textContent.includes(${JSON.stringify(marker)})`, 15000))
          && (await pageCount()) > before,
        `${await evaluate('location.pathname')} · 트리 ${before} → ${await pageCount()}`)

      // 사이드바의 ⧉ — 원본 옆에 하나 더.
      await send('Page.navigate', { url: `${BASE}/w/${workspaceId}` })
      await waitFor(`!!document.querySelector('nav[aria-label="페이지 트리"] a[href$="/${source}"]')`, 15000)
      const beforeSide = await pageCount()
      await clickOn(`[aria-label=${JSON.stringify(`복제 원본 ${stamp} 복제`)}]`)
      check('★ 사이드바의 ⧉ 로도 복제한다 — 사본으로 옮겨 간다',
        (await waitFor(`document.body.textContent.includes(${JSON.stringify(marker)})`, 15000))
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
      await access({ action: 'grant', principal: { type: 'user', id: randomUUID() }, level: 'full_access' })
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

    section('볼 수 없는 하위 페이지의 참조 (HANDOFF §3.2-22)')
    {
      // 새 페이지에서 따로 본다 — 앞 절의 페이지에 "소유자도 못 보는 하위 페이지"를 남기지 않는다.
      const createAt = async (parentPageId) =>
        (await (await fetch(`${BASE}/api/workspaces/${workspaceId}/pages`, { method: 'POST', headers: authed, body: JSON.stringify(parentPageId ? { parentPageId } : {}) })).json()).page.id
      const refParent = await createAt(null)
      const hiddenChild = await createAt(refParent)
      const hiddenTitle = `숨긴 하위 ${Date.now()}`
      const access = (body) =>
        fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${hiddenChild}/access`, { method: 'POST', headers: authed, body: JSON.stringify(body) })
      await fetch(`${BASE}/api/workspaces/${workspaceId}/pages/${hiddenChild}`, { method: 'PATCH', headers: authed, body: JSON.stringify({ title: hiddenTitle }) })
      // 상속을 끊고, 워크스페이스에 없는 사용자 하나에게만 남긴다 — 이 세션(소유자)도 그 페이지를 볼 수 없다.
      await access({ action: 'restrict' })
      await access({ action: 'grant', principal: { type: 'user', id: randomUUID() }, level: 'full_access' })
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

    section('전체')
    check('페이지에서 오류가 나지 않았다', pageErrors.length === 0, pageErrors.join('\n      '))
    const serverErrors = serverOutput.split('\n').filter((l) => l.includes('⨯'))
    check('서버에서 오류가 나지 않았다', serverErrors.length === 0, serverErrors.join('\n      '))
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
console.log(`\n${results.length - failed} / ${results.length} 통과`)
process.exit(failed === 0 ? 0 : 1)
