# [DIGEST] 08. 템플릿 · 자동화 · 버튼

> 원본: `C:/VibeCoding/notion/docs/research/08-templates-automation.md` (978줄 / 105KB, DOMAIN + GAP 1차 보완 2026-09-06)
> 원본 `### F-` 개수 = **18** / 아래 인벤토리 행 수 = **18** (일치 검증 완료)
> 태그: `[추정]` 추론 / `[확인필요]` 미검증 / `[2차출처]` 비공식 출처만 확인

## 0. 도메인 한 줄 요약

"사람이 매번 손으로 만들던 페이지·블록·속성값을 규칙으로 대체"하는 계층. **자동화 표면이 3계층**으로 갈라져 있다.

| 계층 | 구성 | 성격 |
|---|---|---|
| ① 복제 | 템플릿(페이지 / DB행 / 반복 / 갤러리) — F-01~05 | 초기 상태 스냅샷을 복제. **참조가 아니라 복제**(원본 수정은 기존 행에 비소급) |
| ② 규칙 | 버튼(블록/property), DB automation, 변수·수식 — F-06~14 | 트리거 → 선언적 액션 순차 실행. **결정적** |
| ③ AI·코드 | AI Autofill, Custom Agents, Workers — F-15~18 | LLM 오케스트레이션 / 사용자 코드. **비결정적 + 크레딧 과금** |

**설계상 가장 중요한 단일 결론**: ①②③은 모두 "이벤트 → 실행 → 로그"라는 동일 뼈대를 쓴다. **트리거 이벤트 소스(outbox)와 실행 로그(run) 테이블을 처음부터 하나로 통일**해야 한다. 규칙형을 먼저 만들고 AI 액션을 별도 파이프라인으로 붙이면 루프 차단(`origin`/`depth`)과 권한·쿼터 계산이 두 벌로 갈라져 반드시 사고가 난다.
또한 **버튼과 DB automation은 동일한 액션 실행 엔진을 공유**한다(액션 목록이 거의 동일). 차이는 "무엇이 실행을 유발하는가"뿐 → 엔진 1벌 + 트리거 소스 N개.

---

## 1. 기능 인벤토리 (전수 18건)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-08-01 | 페이지 템플릿 (복제 엔진: 블록 서브트리 깊은 복사) | L | **P0** | 블록 트리, 권한 모델, 파일 스토리지 |
| F-08-02 | 데이터베이스 템플릿 (새 행 초기 상태 = property 기본값 + 본문) | M | **P0** | F-08-01, DB/property 스키마, 뷰 쿼리 필터 |
| F-08-03 | 기본 템플릿 지정 (뷰별 / DB 전체 스코프) | S | P1 | F-08-02, view 엔티티 |
| F-08-04 | 반복 템플릿 (recurring, daily/weekly/monthly/yearly) | L | P2 | F-08-02, 스케줄러, 타임존 |
| F-08-05 | 템플릿 갤러리 / 마켓플레이스 (공개 배포·복제·판매) | XL | P2 | F-08-01, 공개 게시, 결제, 크리에이터 프로필 |
| F-08-06 | 버튼 블록 (`/button`, insert blocks) | M | P1 | 에디터, F-08-07, F-08-12 |
| F-08-07 | 액션 실행 엔진 (공식 액션 11종) | XL (코어만 L) | P1(코어) / P2(외부연동) | 권한, DB CRUD, 알림, 수식, 아웃바운드 워커 |
| F-08-08 | 데이터베이스 버튼 property (행 단위 액션) | M | P1 | F-08-07, property 타입 시스템, 뷰 렌더러 |
| F-08-09 | DB automation 트리거 (page_added / property_edited / schedule) | **L~XL** | P1 | DB 쓰기 경로 이벤트 훅(outbox), 잡 큐, 권한 |
| F-08-10 | 실행 런타임 (연쇄·루프 차단·실행 주체·실패 처리) | L | P1 | F-08-07, F-08-09, 잡 큐, 감사 로그 |
| F-08-11 | 변수 정의 + mention/formula 결합 (값 슬롯) | M (수식엔진 없으면 XL) | P1(mention) / P2(formula) ※스키마 결정은 P0 | 수식 엔진, property, F-08-07 |
| F-08-12 | 슬래시 커맨드로 버튼·템플릿 삽입 | S | P1 | 슬래시 메뉴 인프라, F-08-06 |
| F-08-13 | 외부 연동 액션 (webhook / Gmail / Slack) | L | P2 | F-08-07, OAuth, 시크릿 암호화, 아웃바운드 워커 |
| F-08-14 | 공개 API에서의 템플릿·버튼 취급 (통합 제약) | S (database/data source 분리 반영 시 M) | P2 ※식별자 체계·템플릿 제외 필터는 P0 | 공개 API 계층, F-08-02 |
| F-08-15 | AI Autofill property (Basic / Custom Agent 모드) | L | P2 | F-08-09 이벤트 훅, LLM 게이트웨이, 크레딧 회계, 권한 |
| F-08-16 | Custom Agents (트리거 기반 자율 에이전트) | XL | P2 / 보류 | F-08-07, F-08-09, F-08-10, 권한, LLM, Slack 커넥터 |
| F-08-17 | Integration webhooks (외부로 나가는 이벤트 구독) | M (outbox 없으면 L) | P2 ※outbox 설계는 P1 | F-08-09 outbox, 공개 API 인증, 서명 키 관리 |
| F-08-18 | Notion Workers (호스팅 코드 실행) | XL | P2 / **만들지 말 것** | 멀티테넌트 샌드박스, 시크릿, 과금, F-08-13 |

---

## 2. 데이터 모델 (이 도메인의 **요구사항**만. 정본은 `00-canonical-data-model.md`)

### 2.1 기존 엔티티에 요구하는 것

| 대상 | 요구 | 이유 |
|---|---|---|
| `page` | `is_template boolean`, `template_of uuid`(소속 DB) | 템플릿은 별도 테이블이 아니라 **숨겨진 페이지** `[추정]`. property 기본값은 템플릿 페이지 자신의 property 값으로 저장 → 스키마 변경 시 자동 정합 |
| 모든 뷰 쿼리 | `WHERE is_template = false` 강제 | 템플릿이 일반 결과에 새면 안 됨 |
| `property` | 타입 enum에 `button` 추가 (값 없음 → 정렬/필터/rollup 대상 아님 `[추정]`) | F-08-08 |
| `block` | 타입 enum에 `button` 추가 + **숨김 자식 블록**(삽입 원본) 렌더링 제외 규칙 | F-08-06 |
| 셀/property 값 | `generated_by_ai`, `generated_at`, `source_hash`, `manually_overridden` 메타 | F-08-15의 "사람이 손댄 값 보호" |
| 페이지 편집 히스토리 | `edited_by_automation_id` | 감사·디버깅 |
| DB 쓰기 경로 | **트랜잭션 커밋 후 outbox 기록 훅** | 이 도메인 전체의 척추 |
| 공개 API | 부모 식별자를 `database_id`가 아니라 **`data_source_id`** 로 (database=뷰 컨테이너 / data source=스키마+행 분리) | 노션이 2025-09-03에 겪은 breaking change 회피 |

### 2.2 이 도메인이 신규로 요구하는 엔티티군 (정본에 편입 필요)

| 군 | 엔티티 | 핵심 필드 |
|---|---|---|
| 템플릿 메타 | `database_template_config`, `view_default_template` | `view_default_template(view_id nullable, database_id, template_page_id, scope)` — **뷰별 지정이 DB 전체보다 우선**. 조회는 `view_id=? OR (view_id IS NULL AND database_id=?)` 2단계 |
| 반복 | `template_recurrence` | freq/interval/byweekday/start·end/run_at_time/**timezone**/`next_run_at`(인덱스)/enabled. 멱등키 `(recurrence_id, scheduled_for)` |
| 자동화 정의 | `automation`, `automation_trigger`, `automation_action` | `automation.kind ∈ {button_block, button_property, db_automation}` + `host_id`(block/property/database id). `trigger_mode ∈ {any, all}`. `action.order_index` **선형 스텝**(그래프 확장 여지는 남길 것) |
| 실행 로그 | **통합 `run` 테이블 + `kind`** (`automation`/`ai_autofill`/`agent`/`worker`) | `origin ∈ {user, button, automation, schedule, api, agent}`, `depth`, `status ∈ {queued,running,success,partial,failed}`, `actor_id`, `idempotency_key`, `error jsonb` |
| 이벤트 소스 | `outbox` | `{database_id, page_id, event_type, changed_property_ids[], actor_id, origin, event_id}` → **3방향 fan-out**(내부 automation / AI autofill / 외부 webhook) |
| AI | `ai_autofill_config`, `agent`, `agent_access`, `agent_trigger` | `agent_trigger.type`을 `automation_trigger.type`과 **같은 enum**으로 통일(트리거 매칭 코드 1벌). 실행 권한 = agent grant ∩ 생성자 권한 `[추정 — 안전측]` |
| 과금 | `credit_ledger(workspace_id, run_id, credits, model)` | AI 계층 필수 |
| 외부 | `integration_connection`(OAuth 토큰 암호화), `outbound_delivery`, `webhook_subscription`, `webhook_delivery` | webhook_subscription: URL은 검증 후 변경 불가, `verification_token`이 HMAC 키 겸함 |
| 배포 | `public_share`, `template_listing`, `creator_profile`, `template_duplication_log` | F-08-05 전용. MVP 무관 |

### 2.3 **값 슬롯(value slot)** — 이 도메인 최대의 스키마 결정 (기능은 P2여도 결정은 P0)

액션 config의 모든 인자는 4형태 중 하나여야 한다. 평문 문자열로 저장하면 나중에 전 automation 마이그레이션이 필요해진다.

| 형태 | 예 |
|---|---|
| `literal` | `{"type":"literal","value":"To do"}` |
| `mention` | `{"type":"mention","source":"trigger_page","property_id":"..."}` (+ 시스템 변수 `person_who_clicked`, `now`) |
| `formula` | `{"type":"formula","ast":{...}}` — 수식 도메인 AST **재사용** |
| `variable` | `{"type":"variable","name":"total"}` — `define_variables`가 만든 런타임 스코프 변수(영속 저장 불필요) |

공식 제약: mention/formula는 **액션에서만**(트리거 불가). `Insert blocks` / `Open page or URL` / `Send Slack notification`에서는 **formula 사용 불가**. Slack은 mention도 불가.
액션별 config는 **JSON Schema로 버전 관리**해야 마이그레이션 가능.

---

## 3. MVP 판단

### 3.1 없으면 제품이 성립 안 하는 것 (P0)

| F-ID | 근거 |
|---|---|
| **F-08-01 복제 엔진** | 템플릿 기능 전부가 이 위에 올라간다. 갤러리 복제·DB 템플릿·반복 템플릿 모두 같은 재귀 복사 호출. 여기서 결정하는 **id 재매핑 규칙**(서브트리 내부 참조는 사본으로 치환 / 외부 참조는 원본 유지)은 뒤에 못 바꾼다 |
| **F-08-02 DB 템플릿** | DB를 만든 순간 사용자가 가장 먼저 원하는 자동화. "새 행의 초기 상태"가 없으면 DB가 반복 수작업 도구가 된다 |
| (기능 아님) **값 슬롯 스키마** | F-08-11이 P2여도 액션 config 형태는 지금 확정해야 함 |
| (기능 아님) **API 식별자 체계 + 템플릿 제외 필터** | F-08-14가 P2여도 `data_source_id` 분리와 `is_template` 제외는 지금 반영 |
| (기능 아님) **outbox 확장점** | F-08-09를 만들 때 3방향 fan-out을 열어두지 않으면 F-08-15/17에서 이벤트 소스 2벌 운영 |

### 3.2 빼도 되는 것 + 대체안

| 뺄 것 | 이유 | 대체안 |
|---|---|---|
| F-08-04 반복 템플릿 | 스케줄러 인프라·타임존·DST·catch-up이 로직 대비 운영 리스크 과다 | cron 워커 + `rrule` 라이브러리, 빈도 daily/weekly/monthly로 제한, 중첩 템플릿 미지원 |
| F-08-05 마켓플레이스 | 복제보다 공개게시·크리에이터 프로필·검수·결제가 각각 독립 시스템 | 워크스페이스 내부 "Templates" 폴더 + 공개 링크 `?duplicate=1` 버튼까지만 |
| F-08-07의 외부 액션 8종 | 액션마다 OAuth·토큰갱신·실패처리 별도 | 액션을 플러그인 인터페이스 `execute(ctx, config)`로 정의하고 **내부 3종**(`insert_blocks`/`add_page_to`/`edit_property`)만 구현 |
| F-08-13 Slack·Gmail | 개발량 5배 | **`send_webhook` 하나만** + 사용자가 n8n/Make/Zapier로 수신. SSRF 방어만 잘하면 됨 |
| F-08-11 formula | 수식 엔진 선행 필요 (AFFiNE이 relation/rollup/formula 부재로 자동화 전제 자체가 없는 것이 증거) | v0은 Outline식 **문자열 플레이스홀더 치환**(`{datetime}`, `{author}`), v1은 mention 3종(`현재 사용자`/`현재 시각`/`트리거 페이지 property`) |
| F-08-15 AI Autofill 자동 실행 | 편집 이벤트마다 LLM 호출 = 비용 폭발 + 크레딧 회계 선행 필요 | v1은 **수동 실행 전용 + 단일 태스크(요약)**. 프롬프트는 서버 고정(사용자 지시문 허용 = 프롬프트 인젝션 표면) |
| F-08-16 Custom Agents | 다단계 자율성이 비용·권한·디버깅 난이도의 90% | `send_webhook` → 외부 오케스트레이터(n8n / 자체 서버 + MCP). 내재화 시에도 "AI 액션 1종"까지만 |
| F-08-18 Workers | 멀티테넌트 코드 샌드박스는 독립 제품이고 보안 사고 손실이 최대 | 서명된 아웃바운드 webhook + 인바운드 API 토큰 조합. 사용자가 Cloudflare Workers/Vercel에 직접 배포 |

### 3.3 단계 로드맵 (원본 권고)

| 단계 | 포함 | 목표 |
|---|---|---|
| MVP | F-01, F-02 | "템플릿으로 새 항목 만들기" 동작 |
| v1 | +F-03, F-06, F-12, F-07(코어 3액션), F-08 | 클릭 기반 자동화 |
| v2 | +F-09, F-10, F-11(mention) | 이벤트 기반 자동화 |
| v3 | +F-04, F-11(formula), F-13, F-05 | 스케줄·외부 연동·배포 |
| v4 | +F-17, F-15(수동 AI autofill) | 생태계 개방 + AI 진입 |
| 검토만 | F-16, F-18 | webhook + 외부 오케스트레이터로 대체 |

---

## 4. 기술 난제 & 권장 구현 접근 (L / XL 항목)

| F-ID | 왜 어려운가 | 권장 접근 | 참고 오픈소스 |
|---|---|---|---|
| **F-08-01 (L상단)** | 재귀 복제 자체는 쉬움. 비용은 ①대용량 비동기 ②id 재매핑 ③첨부 처리 ④권한 필터링 ⑤**CRDT 위에서 "일관된 스냅샷 읽기"**(안 하면 사본에 반쯤 적용된 편집이 섞임) | 동기 복제 + 블록 수 상한(예 1,000) → 초과 시 비동기 큐 + "복제 중" 플레이스홀더. 첨부는 재업로드 대신 **스토리지 참조 공유 + 참조 카운트 GC**. 순환 복제(자기 하위로 복제)는 부모 체인 검사로 차단 | BlockSuite/Yjs: "Y.Doc 서브트리 스냅샷 → 새 doc 적용"으로 id 재매핑을 CRDT 레벨 처리 `[추정 — API 검증 필요]` |
| **F-08-05 (XL)** | 복제가 아니라 공개게시 인프라 + 크리에이터 프로필 + 검수 + 결제가 각각 독립 시스템. 보안상 최대 위험은 **비공개 하위 페이지 유출** 및 **외부 webhook 액션이 심긴 악성 템플릿** | 만들지 말 것. 공개 링크 + duplicate 버튼까지만 | — |
| **F-08-07 (XL)** | 액션 11종 각각이 별도 통합(메일/Slack/webhook/알림). 부분 실패 시 롤백 정책 `[확인필요]`. **비멱등 액션**(`Add page to`, `Insert blocks`)은 재시도 시 중복 생성 | 액션 = 플러그인 `execute(ctx, config)`. 액션별 **멱등키 `run_id + action_id`** 필수. `status='partial'` + 로그. 대량 매칭(5,000행)은 상한 초과 시 부분 실행보다 **거부**가 안전 `[추정]`. 값 병합 규칙 주의: **템플릿 값이 버튼 액션 값을 덮어쓴다**(공식, 직관과 반대 → 설정 화면 경고 필요) | Baserow Automation Builder(trigger/action/**logic** 3종 노드 그래프) — 노션은 선형이므로 선형으로 시작하되 `order_index`를 그래프로 확장 가능하게 |
| **F-08-09 (L~XL)** | 조건 매칭은 단순. 진짜 난관은 **실시간 협업(CRDT/OT) op 스트림에서 "property가 편집되었다"는 도메인 이벤트를 뽑아내는 것**. 키 입력 op를 그대로 트리거로 쓰면 초당 수십 건 발화 | ①op→도메인 이벤트 축약 ②**3초 코얼레싱 창 + 순변화(net change) 판정**(노션 공식 FAQ: 3초 안에 되돌리면 발화 안 함 → "즉시 큐 투입"이 아니라 "창 종료 시점 before/after diff") ③정확히-한-번. **커밋 후 outbox 패턴** 필수. 트리거 enum은 **처음부터 Custom Agents의 상위집합**(page_removed / comment_added / meeting_note_finished / slack_*)으로 열어두고 UI에서 일부만 노출 | (선례 부재) |
| **F-08-10 (L)** | 코드량보다 **정확성**(중복 실행 없음, 루프 없음)이 어렵다. 최대 미해결: **"누구의 권한으로 실행되는가"** — 2차 출처가 "생성자 권한" vs "workspace owner 권한, 페이지 규칙 무시"로 충돌 | 노션 공식 규칙 채택: **automation은 automation을 트리거하지 않는다**(반복 템플릿 생성 페이지·automation이 만든 페이지 모두 억제). **예외: 버튼 클릭으로 생성된 페이지는 트리거한다** — 이 비대칭이 `origin` 필드의 존재 근거. 클론은 `depth>0`이면 후속 트리거 전면 억제 + `depth` 상한(3). 권한은 **반드시 ①생성자 권한 + 실행 시점 재검증**(정의 저장 시점 권한 캐시 = 권한 상승 취약점). 권한 없는 행은 **전체 실패가 아니라 스킵+로그**(공식: "접근 제한 페이지에는 영향 없음"). `origin='agent'`도 억제 대상 포함 권장 | — |
| **F-08-13 (L)** | 액션 하나당 OAuth + 토큰 갱신 + 실패 처리. SSRF | 노션 실동작 채택: 실패 시 **무한 재시도 아님 → automation 일시정지 + 수동 재개**(공식). 클론은 짧은 재시도 3회 후 정지. 페이로드에 `run_id` 멱등키 포함. 사설 IP 대역 차단. 전송 필드 명시 선택(비공개 property 유출 방지). 노션 제약 참고: automation당 webhook 최대 5개, POST 전용, 인증 스킴 없음(헤더에 토큰 직접), **DB property만 전송 가능(본문 불가)** | NocoDB(네이티브 자동화 없이 n8n 의존) = 이 전략의 실증 |
| **F-08-04 (L)** | RRULE + 스케줄러 + 멱등성 + 타임존/DST. 로직보다 운영 리스크 | `SELECT ... WHERE next_run_at <= now() AND enabled FOR UPDATE SKIP LOCKED` 폴링. 멱등키 `(recurrence_id, scheduled_for)`. DST는 **wall-clock 고정** 권장 `[추정]`. 31일 monthly + 2월은 clamp/skip 정책 명시 `[확인필요]` | `rrule` 라이브러리 |
| **F-08-15 (L)** | LLM 호출은 쉽다. 비용은 ①편집 이벤트 디바운스 ②크레딧 회계·쿼터 ③부분 실패 ④사람 편집과의 충돌 ⑤권한 기반 컨텍스트 필터링 | `on_edit`은 **디바운스 + 입력 해시 캐시** 필수. 사람이 손댄 셀은 `manually_overridden`으로 재생성 금지(노션 정책 `[확인필요]`). 권한 없는 페이지 내용이 요약으로 새면 치명적 유출. AI 실행에도 `origin` 억제 적용(AI→automation→AI 순환 차단). 노션 사실: **기존 행 백필 불가**, Basic은 웹 미사용·크레딧 미소모, autofill로 페이지/automation/form/chart/template 생성 불가 | — |
| **F-08-16 (XL)** | LLM 오케스트레이션 + 도구 호출 + 리소스 스코프 샌드박스 + 비용 회계 + 스텝 로그 = 사실상 별도 제품. **재시도해도 결과가 달라짐**(비결정적) → 부작용 액션은 사전 멱등키 필수. hand-off 사이클. **프롬프트 인젝션**(외부 Slack/웹 콘텐츠 유입, 쓰기 권한만큼이 공격 표면) | 만들지 말 것. 단 **지금 해야 할 설계 결정 하나**: `automation_run`과 `agent_run`을 같은 로그 뼈대로. 쓰기 액션에 승인 게이트(노션도 2026-08-28 "직접 변경 대신 편집 제안" 모드 추가) | — |
| **F-08-18 (XL)** | 멀티테넌트 코드 샌드박스 = 격리·쿼터·로깅·과금 붙은 독립 제품. 체인 깊이를 **플랫폼 경계 밖까지** 전파해야 순환 차단 가능 | 내재화 금지. 대체안 3.2 참조 | Cloudflare Workers / Vercel에 위임 |
| **F-08-17 (M~L)** | outbox 없으면 이벤트 소스부터 만들어야 함 | 노션 계약 그대로 모방이 검증된 선택: **thin payload**(id만, 소비자가 API 재조회) + at-least-once + HMAC-SHA256(`X-Notion-Signature`) + 검증 핸드셰이크(1회성 POST로 토큰 전달 → 붙여넣기). 재전송 인프라 대신 **"최근 24시간 이벤트 replay API"** 로 저비용 신뢰성 확보 | Hookdeck 가이드 |

### 오픈소스 선례 종합 판단
**DB 행 템플릿 + 트리거 기반 자동화를 둘 다 갖춘 노션 클론은 사실상 없다.** (Baserow=자동화 O·블록 문서 모델 X / AppFlowy·AFFiNE=문서 모델 O·자동화 X / Outline=문서 템플릿 + 플레이스홀더만). 참고 선례가 적어 직접 설계 비중이 높으나, 그만큼 **차별화 지점**.
- AppFlowy Issue #8483(closed): "DB 레벨 기본 템플릿 1개 → 다중 선택형(고급)" 2단계 제안 = 우리 **F-02 → F-03 순서와 정확히 일치**하는 검증된 분할.
- 노션 규칙형 automation에는 **실행 로그 UI가 없다**(Activity 로그는 Custom Agents 전용, 확인됨). → **클론이 규칙형에도 실행 로그 탭을 처음부터 제공하면 명확한 차별화**(디버깅 불가는 노션 automation 대표 불만).

---

## 5. 다른 도메인과의 접점

| 상대 도메인 | 접점 | 이 도메인이 요구하는 것 |
|---|---|---|
| 블록 에디터 / 블록 트리 | F-01 복제, F-06 버튼 블록, F-12 슬래시 | 재귀 서브트리 복사 API, `button` 블록 타입, **숨김 자식 블록** 렌더링 제외, 슬래시 메뉴 항목 레지스트리(`{id,label,keywords,icon,requiresPermission,insert()}`) |
| 실시간 협업 (CRDT/OT) | F-01, F-09, F-12 | ①**버전 벡터 시점 고정 스냅샷 읽기**(복제) ②op → 도메인 이벤트 축약(트리거) ③블록 타입 교체를 "삭제+삽입"이 아닌 **단일 타입 필드 원자적 갱신**(동시 슬래시 삽입 충돌 방지) |
| 데이터베이스 / property / view | F-02, F-03, F-08, F-09 | `is_template` 쿼리 필터, `button` property 타입, 뷰 삭제 시 `view_default_template` cascade, **뷰 필터와 템플릿 값 모순 시 안내**("저장 안 됨"으로 오해하는 대표 케이스) |
| 수식 (formula) 도메인 | F-08-11 | **AST + 평가기 재사용**. 평가 컨텍스트 `{trigger_page, actor, now, variables{}}`. formula가 rollup을 참조하고 그 rollup이 automation이 쓰는 property를 집계하면 값 순환 → **수식 참조 그래프 사이클 검사** 별도 필요 |
| 권한 / 공유 | F-01, F-05, F-07, F-10, F-15, F-16 | 실행 시점 권한 재검증 API, "존재하지만 권한 없음"과 "없음"을 동일 응답으로(존재 노출 차단), 공개 서브트리만 복제(권한 누출 방지) |
| 알림 | F-07 `Send notification to` | 최대 20명 **또는 특정 People property 연결 인원(동적 수신자)** |
| 공개 API | F-14, F-17 | `data_source_id` 부모 체계, `POST /pages {template_id}`(노션의 빈틈 — 복제 엔진 호출 한 줄이라 비용 거의 없음), 버튼/automation은 **읽기 전용 JSON만 노출**(실행 엔드포인트 만들면 권한 모델 붕괴), `?include_templates=true` |
| 인프라 (잡 큐 / 스케줄러 / 아웃바운드) | F-04, F-07, F-09, F-10, F-13, F-17 | 커밋 후 outbox, at-least-once 큐 + 멱등키, 폴링 스케줄러, SSRF 방어 아웃바운드 워커, 워크스페이스 단위 쿼터 |
| AI / 과금 | F-15, F-16 | LLM 게이트웨이, `credit_ledger`, 워크스페이스 모델 제한 |
| 공개 게시 / 결제 | F-05 | `public_share`, 크리에이터 프로필(노션 계정 프로필과 **분리된 별도 엔티티**), 유료 판매 |

---

## 6. 최우선 미해결 질문 (5)

| # | 질문 | 왜 최우선인가 | 클론의 잠정 결정 |
|---|---|---|---|
| 1 | **automation은 누구의 권한으로 실행되는가** — "생성자 권한"(요검증 권한 필요) vs "workspace owner 권한, 페이지 접근 규칙 무시"라는 상충 2차 출처 존재. 단 "접근 제한 페이지에는 영향 없음"은 공식 확인 | **도메인 최대 보안 이슈**. 후자가 사실이면 권한 상승 경로 | **생성자 권한 + 실행 시점 재검증**으로 고정. 권한 없는 행은 스킵+로그 |
| 2 | **3초 윈도우가 "발화 지연"인가 "순변화 판정 창"인가** | F-09 구현 방식이 완전히 달라짐(즉시 큐 투입 vs 창 종료 후 diff). 되돌리면 발화 안 함이 공식이므로 후자로 보이나 확정 필요 | 코얼레싱 창 + before/after diff로 구현 |
| 3 | **액션 다단계 중 중간 실패 시 롤백하는가 / 이어서 진행하는가** | 트랜잭션 경계 + 비멱등 액션 재시도 정책이 여기 걸림 | `status='partial'` + 액션별 멱등키 + 로그. 롤백 없음 |
| 4 | **AI Autofill이 사람이 수동으로 덮어쓴 셀을 다시 덮어쓰는가** / **Custom Agents가 만든 변경이 규칙형 automation을 트리거하는가** | 전자는 데이터 파괴 위험, 후자는 루프 차단 규칙이 AI 계층까지 확장되는지 결정 | `manually_overridden` 플래그로 보호 / `origin='agent'`도 억제 대상 |
| 5 | **워크스페이스당 automation 실행 한도·레이트리밋, Workers/Agents의 실행 시간·행 수 상한** (모두 미공개) | 쿼터·큐 용량 설계 기준이 없음. 대량 임포트 1,000행 = 1,000 트리거 폭주 시나리오 방어 불가 | 자체 상한 설정: 워크스페이스 단위 동시성 + `Edit pages in` 대상 행 상한(초과 시 거부) |

> 그 외 잔여 `[확인필요]`: 반복 템플릿 타임존/DST/catch-up, monthly 31일→2월 규칙, API 편집의 트리거 여부(2차출처만), 구 `/template` 블록 현황, `Set as default` 해제 UI·linked view 동작, 보드/캘린더 뷰의 버튼 property 렌더링, integration webhook 재시도 횟수·순서 보장, 템플릿 값 우선 규칙의 정확한 범위.

---

## 7. 원본 출처 (핵심만)

공식: [database-templates](https://www.notion.com/help/database-templates) · [database-automations](https://www.notion.com/help/database-automations) · [buttons](https://www.notion.com/help/buttons) · [database-buttons](https://www.notion.com/help/database-buttons) · [webhook-actions](https://www.notion.com/help/webhook-actions) · [autofill](https://www.notion.com/help/autofill) · [custom-agents](https://www.notion.com/help/custom-agents) · [API webhooks](https://developers.notion.com/reference/webhooks) · [upgrade-guide-2025-09-03](https://developers.notion.com/docs/upgrade-guide-2025-09-03) · [block reference](https://developers.notion.com/reference/block)
2차: [Thomas Frank automations guide](https://thomasjfrank.com/notion-database-automations-the-complete-guide/) · [Baserow automation](https://baserow.io/blog/baserow-workflow-automation-guide) · [AppFlowy #8483](https://github.com/AppFlowy-IO/AppFlowy/issues/8483) · [Outline templates](https://docs.getoutline.com/s/guide/doc/templates-GP6DXgRtxl) · [Hookdeck Notion webhooks](https://hookdeck.com/webhooks/platforms/guide-to-notion-webhooks-features-and-best-practices)
(원본 문서에 1차 23건 + 2차 13건 전체 목록 있음)
