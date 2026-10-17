/**
 * 지원 브라우저 — 기능 감지 (플랫폼 잔여 10i-1 · F-12-15 · 정본 §3.10 끝 [보강] 지원 브라우저)
 *
 * 버전 문자열(UA)을 읽지 않고 기능을 본다 — 표 하나(`SUPPORT_CHECKS`). 루트 레이아웃이 첫 HTML 의 `<head>` 에 인라인 스크립트로 싣는다
 * (`supportCheckScript`) — 앱의 JS 가 돌기 전에, 그 JS 가 못 도는 브라우저에서도 안내가 서야 하므로 **ES5** 로 쓴다(화살표 · const ·
 * 템플릿 글을 쓰지 않는다). 하나라도 없으면 화면 위에 안내 띠 — 앱을 막지 않는다. 서버로 아무것도 보내지 않는다.
 */

export type SupportCheck = {
  readonly key: string
  /** 앱이 무엇에 쓰는가 — 사람이 읽는 까닭. */
  readonly why: string
  /** ES5 식 — 참이면 있다. 던지면 없는 것으로 친다. */
  readonly test: string
}

export const SUPPORT_CHECKS: readonly SupportCheck[] = [
  { key: 'structuredClone', why: '편집기 · 협업의 값 복사', test: "typeof structuredClone === 'function'" },
  { key: 'array-at', why: '목록의 끝 읽기(ES2022)', test: "typeof Array.prototype.at === 'function'" },
  { key: 'object-hasown', why: '이름표 · 문구 표 읽기(ES2022)', test: "typeof Object.hasOwn === 'function'" },
  { key: 'css-color-mix', why: 'Tailwind v4 의 색(Firefox 113 · Safari 16.2)', test: "typeof CSS !== 'undefined' && CSS.supports('color', 'color-mix(in oklab, red, blue)')" },
  { key: 'css-where', why: '테마 · 고대비 변형의 선택자', test: "typeof CSS !== 'undefined' && CSS.supports('selector(:where(a))')" },
]

export const SUPPORTED_BROWSERS = 'Chrome · Edge 111, Firefox 113, Safari 16.4 이상'

export const UNSUPPORTED_MESSAGE = `이 브라우저에서는 notion-clone 이 제대로 동작하지 않을 수 있습니다 — ${SUPPORTED_BROWSERS}에서 열어 주세요.`

/** 안내 띠의 id — 두 번 세우지 않는다. */
export const UNSUPPORTED_NOTICE_ID = 'nc-unsupported'

/**
 * 첫 HTML 에 싣는 ES5 스크립트 — 표의 식을 하나씩 돌려 없는 것을 모으고, 있으면 몸이 선 뒤 안내 띠를 붙인다. 글은 JSON 으로 감싸 따옴표 ·
 * `</script>` 가 스크립트를 끊지 못하게 한다.
 */
export function supportCheckScript(): string {
  const checks = SUPPORT_CHECKS.map(
    (c) => `[${JSON.stringify(c.key)},function(){return ${c.test}}]`,
  ).join(',')
  const message = JSON.stringify(UNSUPPORTED_MESSAGE).replace(/</g, '\\u003c')
  const id = JSON.stringify(UNSUPPORTED_NOTICE_ID)
  return [
    '(function(){',
    `var checks=[${checks}],missing=[],i;`,
    'for(i=0;i<checks.length;i++){try{if(!checks[i][1]())missing.push(checks[i][0])}catch(e){missing.push(checks[i][0])}}',
    'if(!missing.length)return;',
    'function show(){',
    `if(document.getElementById(${id}))return;`,
    "var d=document.createElement('div');",
    `d.id=${id};`,
    "d.setAttribute('role','alert');",
    "d.setAttribute('data-missing',missing.join(','));",
    "d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#fef3c7;color:#78350f;font:14px/1.5 sans-serif;text-align:center;border-bottom:1px solid #f59e0b';",
    `d.textContent=${message};`,
    'document.body.appendChild(d)',
    '}',
    "if(document.body)show();else document.addEventListener('DOMContentLoaded',show)",
    '})()',
  ].join('')
}
