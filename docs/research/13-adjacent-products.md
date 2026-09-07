# 13. 주변 제품군 & 최신 기능 (Forms / Calendar / Mail / Sites / Charts / Wiki / Agents / Emoji / Widgets / Plans)

> 조사일: **2026-09-06** / 모드: DOMAIN (누락 영역 보충) / 대상: 노션 클론(C:/VibeCoding/notion) 기획 단계
> 태그 규칙: `[추정]` = 공개 근거 없이 추론한 내용, `[확인필요]` = 실제 제품/과금 화면에서 재확인이 필요한 내용
> 기준 시점: 노션 3.3(Custom Agents, 2026-02-24) 이후. **주변 제품군은 변동이 가장 심한 영역이다. 이 문서의 사실은 6개월 이내 재검증 대상으로 취급하라.**

## 이 문서의 위치

01~12 문서는 "노션 앱 안쪽"(블록/DB/뷰/협업/권한/AI/플랫폼)을 다뤘다. 이 문서는 **앱 바깥으로 확장된 제품군**과 **2024~2026에 추가·변경된 기능**을 다룬다.

기존 문서와 겹치는 항목은 아래처럼 역할을 나눈다. 중복 서술 대신 **이 문서는 "제품/과금/외부 표면" 관점**을 담당한다.

| 주제 | 기존 문서 | 이 문서의 담당 범위 |
|---|---|---|
| Form view | F-04-18 (DB 뷰로서의 폼) | 폼 **제품**: 질문 타입 매핑, 조건부 로직, 응답자 사후 권한, 공개 제출 파이프라인 |
| Publish to Web | F-06-08 (권한 관점) | Sites **제품**: 도메인/DNS/SEO/GA/홈페이지 지정 |
| Chart view | F-04-08 (뷰 타입 나열) | 차트 **엔진**: 축·집계·그룹 계약, 200/50 한도, Dashboard 위젯 컨테이너 |
| Wiki | F-02-23 (페이지 관점) | Wiki **전환 절차**·owner 프로퍼티·verification 만료 잡 |
| Custom Agents | F-08-16 / F-10-13 | 3.3 이후 **에이전트 제품 구조**: 개인 Agent vs Custom Agent, 크레딧 과금 |
| Dashboard view | F-04-20 (언급 수준) | 위젯 배치·global filter 계약·한도 |
| — | 없음 | Notion Calendar, Notion Mail, 커스텀 이모지, 서드파티 위젯, 요금제 엔타이틀먼트 |

## 요약 (핵심 판단 5줄)

1. **Notion Mail은 2026-09-22 종료된다.** 노션 스스로 "에이전트가 인박스를 대체했다"고 선언했다. 클론에서 메일 클라이언트를 만드는 것은 **원본이 방금 철회한 방향**이므로 P2 이하로 두라. (출처: https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next)
2. **Forms는 "DB의 쓰기 전용 뷰"로 구현하는 것이 정답이다.** 별도 폼 엔진을 만들면 응답 저장·권한·자동화가 전부 이중 구현된다. 폼 질문 = DB 프로퍼티 1:1 바인딩이 원본 설계다.
3. **Sites는 "퍼블리싱 토글 + 렌더 전용 SSR 경로"**다. 커스텀 도메인($10/월 add-on)은 노션이 **별도 과금 SKU로 분리**한 대표 사례 — 클론에서도 유료화 지점으로 그대로 복제 가능하다.
4. **Calendar는 별도 앱이지만 데이터는 노션 DB다.** 클론에서는 "date property를 가진 DB의 캘린더 뷰 + 외부 CalDAV/Google 캘린더 오버레이"로 90% 재현된다. 진짜 어려운 건 **scheduling link(예약 페이지)**다.
5. **요금제 게이팅은 기능 개발보다 "엔타이틀먼트 엔진"이 본체다.** 노션은 개수 한도(차트 1개, notion.site 1개, 게스트 10명), 기간 한도(히스토리 7/30/90일), 기능 온오프(조건부 로직, private teamspace, SSO), 사용량 크레딧(AI/Agent) 네 종류를 섞어 쓴다. 클론은 이 4종 게이팅 축을 처음부터 데이터 모델에 넣어야 한다.

---

## 기능 인벤토리

| ID | 기능 | 난이도 | 우선순위 |
|---|---|---|---|
| F-13-01 | Notion Forms — 폼 생성과 질문↔프로퍼티 바인딩 | L | P1 |
| F-13-02 | Forms — 공개 제출 파이프라인 (익명·권한·확인 화면·알림) | L | P1 |
| F-13-03 | Forms — 조건부 로직 (question branching) | M | P2 |
| F-13-04 | Notion Calendar — 독립 캘린더 앱과 외부 계정 연결 | XL | P2 |
| F-13-05 | Calendar ↔ Notion 데이터베이스 양방향 연동 | L | P1 |
| F-13-06 | Scheduling links / availability (예약 링크) | L | P2 |
| F-13-07 | Notion Mail — 뷰 기반 인박스 (2026-09-22 종료) | XL | P2(비권장) |
| F-13-08 | Notion Sites — 페이지 웹 퍼블리싱 제품화 | L | P1 |
| F-13-09 | Sites — 커스텀 도메인 · DNS 검증 · SEO · Analytics | L | P2 |
| F-13-10 | Chart view — 차트 엔진 (축·집계·그룹) | L | P1 |
| F-13-11 | Dashboard view — 위젯 컨테이너 + global filter | L | P2 |
| F-13-12 | Wiki 전환 (Turn into wiki) & Owner 프로퍼티 | M | P1 |
| F-13-13 | 페이지 verification (검증 배지 · 만료 · 재검증) | M | P2 |
| F-13-14 | Notion Agent — 개인 에이전트 (대화형) | XL | P2 |
| F-13-15 | Custom Agents — 트리거 기반 자율 에이전트 (3.3) | XL | P2 |
| F-13-16 | 커스텀 이모지 (워크스페이스 이모지 라이브러리) | M | P1 |
| F-13-17 | 서드파티 위젯 임베드 (iframe embed 계약) | S | P0 |
| F-13-18 | 요금제 엔타이틀먼트 엔진 (Free/Plus/Business/Enterprise) | L | P0 |

---

## A. Notion Forms

### F-13-01 Notion Forms — 폼 생성과 질문↔프로퍼티 바인딩

- **한 줄 정의**: 노션 계정이 없는 사람도 제출할 수 있는 웹 폼을 만들고, 제출 결과를 노션 데이터베이스의 행으로 직접 적재한다.
- **사용자 시나리오**:
  1. 빈 페이지에서 `/form` 입력 → 메뉴에서 `Form` 선택 → 새 데이터베이스 + Form 뷰가 함께 생성된다.
  2. 또는 기존 데이터베이스의 뷰 탭 `+` → `Form` 선택 → 기존 프로퍼티들이 질문 후보로 뜬다.
  3. 질문 추가 시 폼 편집기에서 질문 타입을 고르면, **대응하는 DB 프로퍼티가 자동 생성**된다.
  4. 질문별로 제목/설명/필수 여부/옵션을 설정한다. 질문과 프로퍼티의 동기화는 개별 토글로 끌 수 있다(질문 제목만 바꾸고 프로퍼티명은 유지).
  5. 우측 상단 `Share` → 접근 범위 선택 → 링크 복사 → 배포.
  6. 응답은 같은 데이터베이스의 `Responses` 테이블 뷰에 행으로 쌓인다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 폼↔DB 관계 | 폼은 독립 엔티티가 아니라 **데이터베이스의 뷰(view)** 다. 폼 삭제 ≠ 응답 삭제 |
  | 질문 → 프로퍼티 | 질문 1개 = 프로퍼티 1개. 질문 타입이 프로퍼티 타입을 결정 |
  | Respondent 프로퍼티 | 폼 생성 시 응답자 식별용 프로퍼티가 자동 추가됨. 익명 응답 허용 시 비워짐 |
  | 커스터마이즈 | 제목, 설명, 아이콘, 커버, 제출 버튼 색상/문구, 제출 후 확인 화면 제목·본문 |
  | Notion 브랜딩 | "Notion으로 제작" 배지 제거는 유료 플랜에서만 가능 |
  | 생성 플랫폼 | **폼 생성·편집은 데스크톱/웹 전용.** 모바일 앱에서는 불가(제출은 모바일 브라우저에서 가능) |
  | 응답 활용 | 응답이 일반 DB 행이므로 filter/sort/chart view/automation을 그대로 적용 가능 |

- **질문 타입 ↔ 프로퍼티 타입 매핑** (공식 문서가 전수를 명시하지 않음 — 확인된 것만 표기):

  | 폼 질문 | DB 프로퍼티 | 비고 |
  |---|---|---|
  | Short answer / Long answer | `title` 또는 `rich_text` | 첫 질문은 보통 title에 바인딩 |
  | Multiple choice (단일) | `select` | 옵션 = select option 레지스트리 |
  | Multiple choice (복수) | `multi_select` | |
  | Date | `date` | 시간 포함 여부 옵션 |
  | Person | `people` | 워크스페이스 멤버만 선택 가능 → 공개 폼에서는 사실상 무의미 |
  | Relation | `relation` | 응답자가 다른 DB의 행을 고름. 대상 DB 제목이 외부 노출되는 문제 `[확인필요]` |
  | Number / URL / Email / Phone | 동명 프로퍼티 | `[추정]` — 프로퍼티 타입 전량이 질문으로 노출되는지 미확인 |
  | File upload | `files` | `[확인필요]` — 공개 폼 업로드 허용 여부·용량 한도 미확인 |
  | Checkbox | `checkbox` | `[추정]` |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 | required 질문은 클라이언트+서버 양쪽 검증. 서버 검증이 없으면 API 직접 호출로 우회됨 |
  | 폼 질문 삭제 | "프로퍼티도 삭제" vs "질문만 제거" 분기 필요. 프로퍼티 삭제 시 **기존 응답의 그 값이 소실** → 확인 모달 필수 |
  | 프로퍼티 타입 변환 | 폼이 살아있는 상태에서 select→text 변환 시 질문 타입도 강제 전환. 진행 중 제출과 경합 `[추정]` |
  | 폼 링크 비활성화 | `No access`로 바꾸면 폼이 닫힘. 이미 열려 있던 탭의 제출도 서버에서 거절해야 함 |
  | DB 휴지통 이동 | 폼 URL은 404 처리. 복원 시 재활성 여부 `[확인필요]` |
  | 동시 제출 | 응답은 append-only insert라 충돌 없음. 단 `unique ID` 프로퍼티가 있으면 시퀀스 경합 발생 |
  | 대용량 | 응답 수만 건이면 Responses 뷰는 일반 DB 페이지네이션 규칙(F-04-15)을 그대로 탐 |
  | 권한 없음 | 폼 공유에는 연결 DB의 `Full access` 필요, 응답 열람에는 `Can view` 이상, 응답 편집에는 `Can edit content` 이상 |
  | 스팸/봇 | 공개 폼 = 무인증 쓰기 엔드포인트. rate limit·캡차 없으면 즉시 남용 `[확인필요: 노션의 봇 방어 방식은 비공개]` |

- **데이터 모델 함의**:

```
form_view                        -- database_view 를 상속 (type='form')
  id, data_source_id, title, description, icon, cover
  submit_button_text, submit_button_color
  confirmation_title, confirmation_body
  show_branding boolean          -- 유료 플랜만 false 허용
  access_mode enum('workspace','public','closed')
  allow_anonymous boolean
  respondent_property_id
  post_submit_access enum('none','view','comment','edit','full')
  notify_emails text[]           -- 제출 시 사본 받을 주소
  created_by, created_at, updated_at

form_question
  id, form_view_id, property_id  -- NULL 이면 프로퍼티 비동기화 질문
  order int
  label text, help_text text
  required boolean
  input_type enum(...)           -- 질문 타입(프로퍼티 타입과 별개로 저장)
  options jsonb                  -- select 후보 override / 허용 확장자 등
  sync_with_property boolean

form_submission                  -- 감사·중복방지용 메타(응답 본체는 DB row)
  id, form_view_id, page_id      -- 생성된 DB 행
  submitted_at, respondent_user_id NULL, respondent_email NULL
  ip_hash, user_agent            -- [추정] 남용 방지에 필요
```

  핵심 결정: **응답 본체를 별도 테이블에 두지 말 것.** 응답 = 데이터베이스 page(row) 그 자체여야 뷰·필터·자동화·차트가 공짜로 따라온다.
- **UI/인터랙션**: `/form` 슬래시 커맨드로 삽입, 질문 드래그로 순서 변경, 질문 카드 호버 시 복제/삭제 아이콘, 좌측 편집 · 우측 실시간 미리보기 2단 레이아웃, 제출 화면은 노션 에디터가 아니라 **읽기 전용 렌더러**.
- **의존 기능**: F-03-02(프로퍼티 스키마), F-04-01(뷰 컨테이너), F-04-18(Form view), F-06-07(링크 기반 일반 액세스), F-02-18(공개 URL), F-09-08(파일 업로드).
- **구현 난이도**: **L** — 폼 편집기 UI + 무인증 공개 제출 엔드포인트 + 질문/프로퍼티 양방향 동기화 3개가 각각 독립 작업이다. 특히 "인증 없는 쓰기 경로"는 기존 권한 레이어를 우회하므로 별도 보안 설계가 필요하다.
- **우선순위**: **P1** — 클론에서 "밖으로 나가는" 대표 기능이고, DB가 이미 있으면 ROI가 가장 높다.
- **클론 시 현실적 대안**: v1은 질문 타입을 `short text / long text / number / select / multi-select / date / email` 7종으로 제한하고 파일 업로드·relation·people 질문 제외. 폼 편집기도 "프로퍼티 목록에서 노출 체크 + 순서 드래그" 수준이면 M으로 내려온다.
- **참고 출처**: https://www.notion.com/help/forms

---

### F-13-02 Forms — 공개 제출 파이프라인 (익명 · 사후 권한 · 확인 화면 · 알림)

- **한 줄 정의**: 워크스페이스 외부 사용자가 인증 없이 데이터를 써넣게 하면서도, 워크스페이스 데이터가 새어나가지 않도록 격리하는 경로.
- **사용자 시나리오**:
  1. 작성자가 `Share`에서 세 가지 중 선택: `Anyone at {workspace} with link` / `Anyone on the web with link` / `No access`.
  2. 공개(web)를 고르면 **응답자는 자동으로 익명 처리**된다.
  3. 작성자가 "제출 후 응답자에게 줄 권한"을 고른다: `No access` / `Can view` / `Can comment` / `Can edit` / `Full access`.
  4. 응답자가 폼 URL 접속 → 입력 → Submit.
  5. 확인 화면(커스텀 제목/본문)이 뜨고, 설정에 따라 제출 사본 이메일이 발송된다.
  6. 작성자 쪽은 automation으로 Slack 알림·상태 변경 등을 연결한다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 접근 3단계 | workspace-only / public / closed. closed는 폼 URL을 죽인다 |
  | 익명성 | 공개 링크 제출자는 **강제 익명** — Respondent 프로퍼티가 채워지지 않음 |
  | 워크스페이스 링크 | 로그인 멤버만 열람, Respondent에 실제 계정 기록 |
  | 사후 접근 권한 | 제출된 **행(page) 단위**로 응답자에게 권한 부여. 로그인 응답자에게만 의미 있음 `[추정]` |
  | 확인 화면 | 제목·본문 커스텀. "다른 응답 제출" 링크 제공 여부 `[확인필요]` |
  | 이메일 사본 | 제출마다 지정 주소로 사본 발송 옵션 |
  | 조직 차단 | Enterprise 워크스페이스 소유자가 `Disable publishing sites, forms, and public links` 토글로 조직 전체의 폼 공개를 금지 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | relation 질문 노출 | 대상 DB의 행 제목이 외부에 그대로 노출된다. 화이트리스트/필터 필요 `[확인필요]` |
  | 익명 + 사후 `Can edit` | 익명은 신원이 없어 권한 부여 대상이 없음 → 사실상 무효. UI에서 조합 차단 필요 |
  | 폼이 닫힌 뒤 재제출 | 서버 403/410. 캐시된 폼에서의 POST까지 막아야 함 |
  | 조직 정책 소급 적용 | 정책 켤 때 이미 공개된 폼을 소급 비활성화할지 결정 필요 |
  | 중복 제출 | 노션은 기본 허용(중복 방지 기능 문서화 없음) `[확인필요]` |
  | 대용량 첨부 | 무인증 업로드는 스토리지 남용 벡터. 용량·확장자 화이트리스트 필수 |
  | 필수값 누락 | 서버 400 + 필드별 에러 매핑 반환 |

- **데이터 모델 함의**: F-13-01 스키마에 더해

```
public_link_token(form_view_id, token, revoked_at)   -- URL slug ≠ 내부 id
workspace_security_policy(workspace_id, disable_public_publishing boolean, ...)
form_rate_bucket(form_view_id, ip_hash, window_start, count)   -- [추정] 남용 방지
```

  서버에는 **"anonymous form-writer"라는 별도 principal 종류**가 필요하다. 기존 user / guest / integration 3종 principal 모델(F-06-01)에 4번째를 추가하는 결정이며, 이 principal은 "특정 form_view에 대한 INSERT 한 건" 외에는 아무 권한도 갖지 않아야 한다.
- **UI/인터랙션**: 공유 패널 내 드롭다운 3종, 링크 복사, 새 탭 미리보기, 제출 버튼 로딩/중복클릭 방지.
- **의존 기능**: F-13-01, F-06-01(액세스 레벨), F-06-11(보안 정책), F-11-08(알림 규칙), F-08-09(automation 트리거).
- **구현 난이도**: **L** — 기능보다 "무인증 쓰기 경로가 권한 레이어를 우회하지 않는다"를 보장하는 설계·리뷰 비용이 크다.
- **우선순위**: **P1** — 폼 기능의 존재 이유 자체.
- **클론 시 현실적 대안**: v1은 `public + 강제 익명 + post_submit_access=none` 조합 하나만 지원. 사후 권한 부여는 v2. 남용 방지는 IP당 시간당 N건 + 캡차로 시작.
- **참고 출처**: https://www.notion.com/help/forms , https://www.notion.com/help/public-pages-and-web-publishing

---

### F-13-03 Forms — 조건부 로직 (question branching)

- **한 줄 정의**: 이전 질문의 답에 따라 다음 질문을 보여주거나 건너뛴다.
- **사용자 시나리오**: 질문 카드 `•••` → 로직 추가 → "이 질문의 답이 X이면 → 질문 N 표시/이동" 규칙 작성 → 미리보기에서 분기 확인 → 공유.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 플랜 게이팅 | **Business / Enterprise 플랜 전용** (공식 문서 명시) |
  | 규칙 형태 | (질문, 연산자, 값) → (표시 / 숨김 / 이동) `[추정]` — 공식 문서가 규칙 문법 전체를 공개하지 않음 |
  | 적용 대상 | 값 집합이 유한한 질문(select/multi-select/checkbox)이 자연스러움 `[확인필요]` |
  | 페이로드 | 숨겨진 질문은 제출 페이로드에서 제외되어야 함 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 순환 참조 | Q1→Q3→Q1 규칙은 저장 단계에서 사이클 검출·차단 |
  | 필수 + 숨김 | 숨겨진 필수 질문은 검증에서 제외. 아니면 제출 불가 데드락 |
  | 규칙 대상 질문 삭제 | 규칙 동반 삭제 또는 "끊어진 규칙" 경고 |
  | 옵션 이름 변경 | 규칙이 옵션 **id**를 참조해야 안전(이름 참조면 리네임에 깨짐) |
  | 플랜 다운그레이드 | Business→Plus 강등 시 기존 로직 무시 vs 폼 잠금 정책 필요 `[확인필요]` |
  | 규칙 충돌 | show와 hide가 동시에 걸릴 때 우선순위(예: 마지막 규칙 우선) 명시 |

- **데이터 모델 함의**:

```
form_logic_rule
  id, form_view_id, source_question_id
  operator enum('equals','not_equals','contains','is_empty','gt','lt', ...)
  value jsonb                     -- select면 option_id 배열
  action enum('show','hide','jump_to')
  target_question_id
  order int                       -- 평가 순서 = 충돌 해결 순서
```

  평가는 클라이언트 즉시(UX) + 서버 재평가(보안) **두 번** 수행한다. 서버가 규칙을 재평가하지 않으면 숨겨진 질문에 값을 주입할 수 있다.
- **UI/인터랙션**: 로직이 걸린 질문 카드에 배지, 로직 편집 사이드 패널, 미리보기 모드에서 분기 시뮬레이션.
- **의존 기능**: F-13-01, F-13-18(플랜 게이팅), F-03-04(select 옵션 id).
- **구현 난이도**: **M** — 규칙 엔진 자체는 작다. 사이클 검출·필수/숨김 상호작용·서버 재평가가 실제 비용.
- **우선순위**: **P2** — 원본도 상위 플랜 전용으로 둔 "유료 가치" 기능. MVP에는 불필요.
- **클론 시 현실적 대안**: `show/hide` 두 액션만 지원하고 `jump_to`를 빼면 사이클 문제가 사라져 S~M으로 내려간다.
- **참고 출처**: https://www.notion.com/help/forms

---

## B. Notion Calendar (구 Cron)

> 배경: 노션은 2022년 캘린더 앱 Cron을 인수했고, 2024년 **Notion Calendar**로 리브랜딩해 재출시했다. 노션 본체와 별도 바이너리/별도 계정 연결을 가지는 **독립 제품**이며 현재 web / macOS / Windows / iOS / Android로 제공된다. `[확인필요: Android 정식 출시 시점]`

### F-13-04 Notion Calendar — 독립 캘린더 앱과 외부 계정 연결

- **한 줄 정의**: Google Calendar / Outlook / iCloud 계정을 한 화면에 겹쳐 보고, 이벤트를 만들고, 노션 워크스페이스와 붙여 쓰는 별도 캘린더 클라이언트.
- **사용자 시나리오**:
  1. 앱 실행 → Notion 계정으로 로그인 → 캘린더 계정(Google/Outlook/iCloud) 연결.
  2. 좌측 사이드바에 계정별 캘린더 목록이 뜨고, 체크박스로 표시/숨김을 토글한다.
  3. 숫자 키 `1`~`9`를 누르면 화면에 표시되는 일수가 즉시 바뀐다(1일 ~ 9일 뷰).
  4. 빈 시간대를 드래그하면 이벤트 생성 팝오버가 뜬다. 제목·시간·참석자·회의 링크·설명 입력.
  5. 메뉴바(macOS)에 다음 일정과 회의 참여 버튼이 상주한다. `[확인필요: 2026 현재 Windows 트레이 동등 기능 여부]`
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 계정 모델 | Notion 계정 1개에 여러 캘린더 계정(구글/아웃룩/iCloud)을 연결. 캘린더마다 색상·표시 토글 |
  | 이벤트 소스 | 이벤트 원본은 **외부 캘린더 제공자**다. 노션은 동기화 클라이언트 역할 |
  | 뷰 전환 | 숫자 키로 일수 전환. 주/월 뷰 별도 존재 `[확인필요]` |
  | 회의 참여 | 이벤트의 화상회의 링크를 감지해 원클릭 참여 버튼 노출 |
  | AI 회의노트 | 이벤트에 `Add AI meeting notes` 필드가 있어 녹음·요약 노트를 노션 페이지로 생성(F-10-11 연계) |
  | 타임존 | 보조 타임존 표시, 이벤트별 타임존 지정 |
  | 가격 | Notion Calendar 자체는 **무료**. AI 회의노트 등 AI 기능은 노션 AI 한도를 소모 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 오프라인 | 로컬 캐시된 이벤트 표시 + 변경은 큐에 적재 후 재접속 시 전송 `[추정]` |
  | 외부에서 이벤트 변경 | 제공자 push/webhook 또는 폴링으로 갱신. 충돌 시 **외부 제공자가 진실의 원천** |
  | 반복 일정 예외 | RRULE + EXDATE 처리 필요. "이 일정만/이후 전체/전체" 3분기 수정 UI 필수 |
  | 계정 토큰 만료 | 재인증 배너. 만료 상태에서의 쓰기는 로컬 큐에 남기지 말고 즉시 실패시키는 편이 안전 |
  | 다중 계정 동일 이벤트 | 같은 회의가 두 계정에 초대되면 중복 표시. 중복 병합 규칙 필요 `[확인필요]` |
  | 대용량 | 5년치 이벤트를 전부 가져오지 않고 표시 구간 ± 버퍼만 페치 |
  | 권한 없음 | 읽기 전용으로 공유받은 캘린더는 편집 UI 비활성화 |

- **데이터 모델 함의**:

```
calendar_account
  id, user_id, provider enum('google','microsoft','icloud','internal')
  external_account_id, oauth_token_ref, sync_token, status, last_synced_at

calendar
  id, calendar_account_id, external_calendar_id
  name, color, is_visible, access_role enum('owner','writer','reader')

calendar_event                       -- 외부 이벤트의 로컬 미러
  id, calendar_id, external_event_id, etag
  title, description, location
  start_at, end_at, is_all_day, timezone
  rrule text, recurring_event_id, original_start_at   -- 반복/예외
  conference_url, status enum('confirmed','tentative','cancelled')
  updated_at, deleted_at

calendar_event_attendee(event_id, email, response_status, is_organizer)
```

  `sync_token`(Google) / `deltaLink`(Microsoft) 기반 증분 동기화가 필수다. 전체 재동기화 폴백 경로도 함께 설계한다.
- **UI/인터랙션**: 숫자키 일수 전환, `T`=오늘, 드래그로 이벤트 생성/이동/리사이즈, 메뉴바 상주, 명령 팔레트.
- **의존 기능**: 외부 OAuth 인프라, F-13-05(노션 DB 연동), F-10-11(AI 회의노트).
- **구현 난이도**: **XL** — 캘린더 UI 자체는 M이지만, 3개 제공자의 동기화(증분 토큰, 반복 규칙, 초대 응답, 타임존)를 정확히 다루는 것이 XL이다. 반복 일정 예외 처리만으로도 1~2주가 소요된다.
- **우선순위**: **P2** — 노션 클론의 정체성이 아니다. 외부 캘린더 통합은 클론의 차별점이 되지 않는다.
- **클론 시 현실적 대안**: 독립 앱을 만들지 말고 **노션 안의 캘린더 뷰(F-04-06)를 강화**하고, 외부 캘린더는 "읽기 전용 ICS 구독 오버레이"로만 얹는다(ICS URL 폴링 → 배경 레이어로 표시). 쓰기 동기화를 포기하면 XL → M으로 떨어진다.
- **참고 출처**: https://www.notion.com/help/category/notion-calendar , https://www.notion.com/product/calendar

---

### F-13-05 Calendar ↔ Notion 데이터베이스 양방향 연동

- **한 줄 정의**: date 프로퍼티를 가진 노션 데이터베이스를 캘린더 레이어로 얹어, 캘린더에서 직접 DB 행을 만들고 옮기고 편집한다.
- **사용자 시나리오**:
  1. 캘린더 사이드바에서 `Add Notion database` 선택(또는 노션 쪽 DB에서 `Manage in Notion Calendar`).
  2. 어느 date 프로퍼티를 시간축으로 쓸지 고른다.
  3. DB 행들이 캘린더에 이벤트처럼 나타난다. 색상·상태 필터·날짜 필터를 지정한다.
  4. 캘린더에서 항목을 드래그하면 **노션 DB의 date 값이 바뀐다.**
  5. 날짜 없는 항목은 별도 리스트 패널에 쌓이고, 여기서 캘린더로 드래그하면 날짜가 채워진다.
  6. 이벤트를 클릭하면 제목/날짜/select 프로퍼티를 그 자리에서 편집하거나 노션 페이지를 연다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 연결 조건 | 데이터베이스에 **date 프로퍼티가 반드시 있어야** 함 |
  | 연결 개수 한도 | **최대 20개 데이터베이스** |
  | 필요 권한 | 연결에 `Can view` 이상, 캘린더에서 수정하려면 `Can edit content` 이상 |
  | 편집 가능 항목 | 제목, 날짜/시간, **select 프로퍼티**(multi-select는 불가) |
  | 읽기 전용 날짜 | formula / created time / last edited time 기반 date는 **드래그 불가(읽기 전용)** |
  | 복제 | 항목 복제 시 제목·날짜만 같은 새 페이지가 생기고 **본문 내용은 복사되지 않음** |
  | 플랫폼 | 데이터베이스 **추가는 데스크톱/웹에서만**. 모바일은 열람 중심 |
  | 외부 반영 | 구글/iCloud 캘린더에서 볼 때 노션 DB 항목은 **읽기 전용** |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | date 프로퍼티 삭제 | 연결이 끊어짐. 연결 설정을 무효 처리하고 사용자에게 재선택 요구 |
  | date range vs 단일 날짜 | range면 멀티데이 이벤트, 단일이면 종일 또는 시간 블록. 드래그 시 duration 보존 |
  | 타임존 | DB date의 타임존과 캘린더 표시 타임존이 다르면 하루 밀림 버그의 온상. 항상 UTC 저장 + 표시 시 변환 |
  | 필터 적용 상태에서 드래그 | 드래그 결과가 필터에서 빠지면 이벤트가 화면에서 사라짐 → 되돌리기 토스트 제공 |
  | 동시 편집 | 노션 쪽에서 같은 행을 편집 중이면 마지막 쓰기 승리. 낙관적 UI + 서버 확인 필요 |
  | 권한 상실 | 공유가 해제되면 캘린더에서 항목이 사라져야 함(권한 캐시 무효화, F-06-14) |
  | 대용량 DB | 수천 행 DB는 표시 구간의 날짜 범위로 서버 필터링해서 가져와야 함 |
  | 21번째 DB 연결 | 한도 초과 에러 메시지 |

- **데이터 모델 함의**:

```
calendar_database_link
  id, user_id, data_source_id
  date_property_id                 -- 시간축으로 쓸 프로퍼티
  color, is_visible
  filter jsonb                     -- 상태/날짜 필터 (개인 설정)
  created_at
```

  중요한 설계 포인트: 이 연결은 **개인 설정(user 단위)** 이지 DB의 공유 속성이 아니다. 노션의 "개인 필터 vs 공유 필터"(F-04-17)와 같은 2층 구조를 그대로 따른다.
  캘린더 렌더는 별도 테이블이 아니라 `SELECT ... WHERE date_prop BETWEEN ? AND ?` 쿼리다. **DB 행을 캘린더 이벤트로 복제 저장하면 안 된다** — 이중 진실이 생긴다.
- **UI/인터랙션**: 사이드바에서 DB 토글, 날짜 미지정 항목의 "unscheduled" 리스트 패널, 드래그 앤 드롭 스케줄링, 이벤트 팝오버 내 인라인 프로퍼티 편집.
- **의존 기능**: F-03-06(date 프로퍼티), F-04-06(캘린더 뷰), F-06-01(권한), F-05-16(DB 실시간 동기화).
- **구현 난이도**: **L** — 읽기·드래그 갱신은 M 수준이지만, 타임존/반복/필터-드래그 상호작용/권한 실시간 반영을 합치면 L.
- **우선순위**: **P1** — 클론에서는 별도 앱 없이 "캘린더 뷰"로 그대로 구현되므로 가성비가 가장 좋은 항목.
- **클론 시 현실적 대안**: 앱 내 캘린더 뷰가 이미 있으면 추가 작업은 "여러 DB를 한 캘린더에 겹쳐 보기(멀티소스 캘린더)"뿐이다. 이것만 만들면 Notion Calendar 가치의 대부분을 흡수한다.
- **참고 출처**: https://www.notion.com/help/use-notion-calendar-with-notion

---

### F-13-06 Scheduling links / availability (예약 링크)

- **한 줄 정의**: 내 빈 시간대를 링크로 공유해 상대가 직접 회의 시간을 잡게 하는 Calendly류 기능.
- **사용자 시나리오**:
  1. 좌측 컨텍스트 패널에서 `Scheduling` 선택(단축키 `S`).
  2. `Create recurring link`(반복 가능한 링크) 또는 `Create one-off link`(1회용) 선택.
  3. 가능한 시간대를 캘린더에서 드래그해 지정하거나 규칙(평일 10~18시 등)으로 설정.
  4. 옵션 설정: 만료일, 화상회의 링크, 전화번호, 예약 가능 창(최소/최대 리드타임), 설명.
  5. `•••` → `Copy scheduling link` → 상대에게 전송.
  6. 상대가 링크를 열면 남은 슬롯이 보이고, 선택하면 양쪽 캘린더에 이벤트가 생성된다.
  7. 예약자는 이벤트 설명의 링크로 **재조정/취소**할 수 있고, 사유를 입력한다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 링크 종류 | recurring(여러 명이 예약 가능, 슬롯 소진까지 유효) / one-off(1건) |
  | 유효 기간 | 남은 슬롯이 있는 한 링크 유효. 별도 만료일 설정 가능 |
  | 슬롯 산출 | 지정 가용 시간 − 기존 일정(연결된 모든 캘린더) = 표시 슬롯 |
  | 홀드(hold) | 가용 시간을 캘린더에 "hold" 블록으로 표시해 본인도 겹치게 잡지 않도록 함 |
  | 옵션 | 회의 길이, 버퍼, 예약 가능 창(min/max), 화상회의 자동 생성, 설명 |
  | 재조정/취소 | 예약자가 링크로 직접 수행, 사유 입력 가능 |
  | Mail 연계 | Notion Mail 초안에서 `/schedule` 로 슬롯을 골라 예약 링크를 바로 삽입(단, Mail은 2026-09-22 종료) |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 동시 예약 경합 | 두 명이 같은 슬롯을 동시에 확정 → **슬롯 단위 락 또는 낙관적 잠금 + 재선택 유도** 필수. 가장 중요한 동시성 문제 |
  | 예약 후 본인이 다른 일정 생성 | 겹침 발생. hold 블록으로 예방하되, 발생 시 알림 |
  | 타임존 | 예약자의 브라우저 타임존으로 슬롯 표시. DST 경계에서 슬롯 계산이 틀어짐 |
  | 전 슬롯 소진 | 링크는 "가용 시간 없음" 화면을 보여야 함(404 아님) |
  | 만료된 링크 | 만료 안내 화면 |
  | 취소 후 슬롯 복구 | 취소 시 해당 슬롯을 다시 예약 가능 상태로 되돌릴지 정책 필요 |
  | 스팸 예약 | 무인증 쓰기 경로. 이메일 확인/캡차 필요 `[확인필요: 노션의 방식]` |

- **데이터 모델 함의**:

```
scheduling_link
  id, user_id, slug, type enum('recurring','one_off')
  title, description, duration_minutes, buffer_minutes
  min_notice_minutes, max_days_ahead
  expires_at, conference_provider, phone
  target_calendar_id                 -- 확정 이벤트를 생성할 캘린더
  status enum('active','expired','exhausted')

scheduling_availability_slot
  id, scheduling_link_id
  start_at, end_at                   -- 명시 홀드 방식
  rrule text NULL                    -- 규칙 방식일 때
  state enum('open','held','booked')
  version int                        -- 낙관적 잠금

scheduling_booking
  id, scheduling_link_id, slot_id
  booker_name, booker_email, note
  event_id                            -- 생성된 calendar_event
  status enum('confirmed','rescheduled','cancelled')
  cancel_reason, created_at
```

- **UI/인터랙션**: 단축키 `S`, 캘린더 위 드래그로 가용 시간 지정, 링크 복사, 공개 예약 페이지(반응형·타임존 셀렉터).
- **의존 기능**: F-13-04(캘린더 계정/이벤트), 공개 무인증 페이지 인프라(F-13-02와 동일 계열), 메일 발송.
- **구현 난이도**: **L** — 슬롯 계산 + 동시 예약 방지 + 타임존/DST + 재조정 플로우. 겉보기보다 상태 기계가 복잡하다.
- **우선순위**: **P2** — 노션 클론의 핵심이 아니고, Calendly/Cal.com 링크 임베드로 대체 가능하다.
- **클론 시 현실적 대안**: 직접 만들지 말고 **Cal.com(오픈소스) 임베드 블록**을 지원한다. 굳이 만든다면 one-off 링크만 지원(동시 경합 문제가 거의 사라짐).
- **참고 출처**: https://www.notion.com/help/availability-blocking-and-time-zones , https://www.notion.com/help/schedule-meetings-with-notion-mail

---

## C. Notion Mail

### F-13-07 Notion Mail — 뷰 기반 인박스 (⚠ 2026-09-22 종료 예정)

> **가장 중요한 사실부터**: Notion Mail은 **2026년 9월 22일 서비스가 종료된다.** 2026-06-25부터 데이터 내보내기가 열렸고, 2026-09-21이 마지막 저장일이다. 노션의 공식 설명은 "에이전트가 충분히 유능해지면서 Notion Mail 사용자의 절반 이상이 인박스를 열지 않고 메일을 처리하게 됐다"는 것이다.
> **클론 판단**: 메일 클라이언트는 **원본이 직접 철회한 방향**이다. 이 기능을 클론하는 것은 명백한 자원 낭비다. 아래는 "왜 실패했는가 / 무엇만 흡수할 가치가 있는가"를 위해 기록한다.

- **한 줄 정의**: Gmail을 백엔드로 쓰면서, 인박스를 노션 데이터베이스처럼 "뷰(필터·그룹·정렬)"로 재구성하고 AI가 자동 라벨링해 주는 메일 클라이언트.
- **사용자 시나리오**:
  1. Notion 계정 + Gmail 주소로 가입 → Gmail OAuth 연결 → 라벨·연락처·카테고리가 동기화된다.
  2. 좌측에 "뷰" 목록이 있다. 각 뷰는 필터 조건(발신자, 라벨, 읽음 상태, AI 라벨)의 저장본이다. 무제한 생성 가능.
  3. 메일을 열고 상단의 `Auto label similar` 버튼을 누르면, AI가 **제목·발신자 일치가 아니라 내용 의미 기준으로** 유사 메일을 찾아 같은 라벨을 붙인다.
  4. 작성창에서 `/` 슬래시 커맨드, 마크다운 단축, 코드 블록을 쓸 수 있다(노션 에디터 재사용).
  5. 스니펫(템플릿)으로 반복 답장을 삽입한다.
  6. 초안에서 `/schedule` 입력 → 가용 슬롯 선택 → 예약 링크 삽입.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 지원 제공자 | **Gmail / Google Workspace 전용.** Outlook·iCloud는 "지원 예정"으로 남은 채 종료 |
  | 계정 모델 | 이메일 주소 1개 = Notion Mail 계정 1개. 별칭(alias)은 한 계정 내에서 사용 |
  | 플랫폼 | macOS, 웹(mail.notion.com), iOS 17+. Windows는 끝내 미출시 `[확인필요]` |
  | 동기화 | Gmail과 **양방향 실시간 동기화**. 라벨·카테고리·연락처 포함 |
  | 미동기 항목 | 차단 발신자, 스누즈/예약 메일, 초안, 초기 스팸은 동기화 대상 아님 |
  | 라벨 리네임 | 최초 동기화 이후 Gmail에서 라벨 이름을 바꿔도 Notion Mail에 반영되지 않음 |
  | 알림 | 계정 / 뷰 / 발신자 3단계로 알림 설정 |
  | 과금 | 기본 무료. AI 기능은 월 한도 내 무료, 무제한은 유료 플랜 |
  | 종료 후 | 메일 본체는 Gmail에 그대로 남는다. **Notion Mail에만 있던 데이터**(초안, 예약 메일, 스니펫, 자동 라벨 지시문, 리마인더)는 수동 내보내기 필요 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | Gmail 라벨 vs 앱 라벨 | 이름 변경 미반영은 **id 대신 이름을 캐시한 설계 결함**으로 보인다 `[추정]`. 클론은 반드시 라벨 id를 참조할 것 |
  | 대용량 메일함 | 초기 동기화가 수십만 통이면 백필 잡 + 진행률 UI 필요 |
  | 오프라인 | 로컬 캐시 기반 열람, 발송은 큐 |
  | 토큰 만료/권한 회수 | 즉시 읽기 중단 + 재인증 |
  | AI 오라벨 오류 | 사용자가 라벨을 수정하면 그 피드백이 규칙에 반영되어야 함 |
  | 동일 스레드 동시 처리 | Gmail 쪽에서 이미 아카이브된 스레드에 대한 액션 → 409 처리 |
  | 서비스 종료 | 데이터 내보내기 경로와 마감일 고지 — **모든 부가 제품에 필요한 EOL 설계** |

- **데이터 모델 함의**(클론이 굳이 만든다면):

```
mail_account(id, user_id, provider, email, oauth_token_ref, history_id, status)
mail_view(id, user_id, name, order, filter jsonb, group_by, sort jsonb)
mail_label(id, mail_account_id, external_label_id, name, color, source enum('gmail','notion'))
mail_thread(id, mail_account_id, external_thread_id, subject, last_message_at, is_read, labels[])
mail_message(id, thread_id, external_message_id, from, to[], cc[], body_html, body_text, sent_at)
mail_snippet(id, user_id, name, body)               -- 템플릿
mail_autolabel_rule(id, user_id, label_id, instruction text, source_message_id)
```

  본질은 **"Gmail 미러 + 저장된 쿼리(뷰)"** 다. 노션 DB의 뷰 개념을 메일에 이식한 것이 제품의 유일한 차별점이었다.
- **UI/인터랙션**: 뷰 사이드바, 키보드 중심 조작, 노션 에디터를 그대로 쓴 작성창(슬래시 커맨드/마크다운), `Auto label similar` 버튼, `/schedule`.
- **의존 기능**: Gmail API + OAuth, F-10-xx(AI 분류), F-13-06(예약 링크), F-01-04(슬래시 커맨드 재사용).
- **구현 난이도**: **XL** — Gmail 동기화(history API, 증분/백필/충돌), 메일 렌더링(HTML 새니타이즈), 발송 신뢰성, 스팸/서명/스레딩. 메일 클라이언트는 그 자체로 하나의 제품이다.
- **우선순위**: **P2(비권장)** — 원본이 종료한 방향. 만들지 마라.
- **클론 시 현실적 대안**: 메일 클라이언트 대신 **"이메일 → 페이지/DB 행 생성" 인바운드 주소**(예: `abc123@inbox.mycl.one`)만 지원한다. 노션 Mail 가치의 실용적 부분(메일을 작업으로 전환)을 1/50 비용으로 얻는다.
- **참고 출처**: https://www.notion.com/help/get-started-with-notion-mail , https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next , https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/

---

## D. Notion Sites

### F-13-08 Notion Sites — 페이지 웹 퍼블리싱 제품화

- **한 줄 정의**: 노션 페이지를 그대로 공개 웹사이트로 발행하고, 하위 페이지까지 사이트로 묶어 관리한다.
- **사용자 시나리오**:
  1. 페이지 우상단 `Share` → `Publish` 탭 → `Publish` 클릭.
  2. **하위 페이지가 자동으로 함께 발행된다.**
  3. URL slug를 편집한다(최대 60자, 영문/숫자/하이픈).
  4. 유료 플랜이면 SEO 설정(링크 제목·설명), Google Analytics 연결, `Discoverable on the web`(검색엔진 색인) 토글을 켠다.
  5. `Duplicate as template` 토글을 켜면 방문자가 자신의 워크스페이스로 사이트를 복제할 수 있다.
  6. 이후 노션에서 내용을 고치면 **사이트가 자동으로 갱신된다.**
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 발행 단위 | 페이지 + 그 하위 트리 전체 |
  | 도메인 | Free: `notion.site` 도메인 **1개**. 유료: 최대 **5개** |
  | 사이트 수 | Free/유료 모두 **무제한 발행** |
  | slug | 최대 60자, 영문/숫자/하이픈 |
  | 자동 갱신 | 원본 편집이 사이트에 반영됨. 캐시 무효화 지연 `[확인필요: 반영 지연 시간]` |
  | 데이터베이스 | 방문자가 뷰를 전환하고 행 페이지를 열 수 있음(읽기 전용) |
  | 템플릿 복제 | 방문자가 자기 워크스페이스로 복제하도록 허용하는 토글 |
  | 검색 색인 | 색인 후 검색 노출까지 **최대 4주** 소요 안내 |
  | 홈페이지 지정 | 유료 플랜에서 도메인의 홈페이지(루트) 페이지 지정 가능 |
  | 메타데이터 노출 | 발행 페이지의 메타데이터에 **기여자의 이름·프로필 사진·이메일이 포함**된다 — 프라이버시 주의 |
  | 조직 차단 | Enterprise 소유자가 `Disable publishing sites, forms, and public links` 로 전면 금지 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 하위 페이지에 비공개 내용 | 자동 동반 발행 때문에 **의도치 않은 유출**이 가장 흔한 사고. 발행 전 하위 트리 미리보기·개별 제외 옵션 필요 `[확인필요: 개별 제외 지원 여부]` |
  | 발행 취소 | 즉시 404로 전환하되, CDN 캐시·검색엔진 캐시는 남는다. `noindex` 병행 필요 |
  | 페이지 이동/삭제 | 발행된 URL이 깨짐. 리다이렉트 또는 안내 페이지 |
  | slug 충돌 | 같은 도메인 내 유일성 검증 |
  | 대용량 페이지 | 공개 렌더는 로그인 사용자와 달리 SSR/정적화가 유리. 수천 블록 페이지는 부분 렌더 필요 |
  | 봇 트래픽 | 공개 URL은 크롤러 폭격 대상. 렌더 캐시 없이는 DB 부하 직결 |
  | 코멘트 | 공개 사이트에서 코멘트 표시/작성 여부 정책 `[확인필요]` |
  | 권한 변경 | 페이지가 private으로 바뀌어도 발행 상태가 남으면 유출. 권한 변경 시 발행 상태 재평가 필요 |

- **데이터 모델 함의**:

```
site
  id, workspace_id, root_page_id
  domain_id                          -- notion.site 서브도메인 또는 커스텀 도메인
  home_page_id
  seo_title, seo_description, og_image_url
  is_indexable boolean               -- robots/meta noindex 제어
  allow_duplicate_as_template boolean
  analytics_provider, analytics_id
  published_by, published_at, unpublished_at

site_page                            -- 발행 트리의 물리적 매핑(캐시성)
  site_id, page_id, slug, path, is_excluded boolean
  UNIQUE(site_id, path)

site_domain
  id, workspace_id, kind enum('notion_subdomain','custom')
  hostname, verification_state, cname_ok, txt_ok, ssl_state, verified_at
```

  **렌더 경로 분리가 핵심 설계 결정이다.** 앱 렌더러(권한 검사 + 실시간 구독 + 편집기)를 공개 사이트에 그대로 쓰면 성능·보안 양쪽이 무너진다. 공개용 **읽기 전용 SSR 렌더러 + CDN 캐시 + 편집 시 태그 기반 무효화(page_id 태그)** 를 별도로 둔다.
- **UI/인터랙션**: Share 패널의 Publish 탭, slug 인라인 편집, "사이트 보기" 새 탭, 발행 상태 배지, 사이트 설정 패널(SEO/도메인/애널리틱스).
- **의존 기능**: F-02-18(웹 게시), F-06-08(퍼블리싱 권한), F-06-11(보안 정책), F-02-16(URL/slug), F-13-09(커스텀 도메인).
- **구현 난이도**: **L** — "공개 토글" 자체는 S지만, 공개 SSR 렌더러 + 캐시 무효화 + 하위 트리 발행 규칙 + SEO 메타 생성까지가 실제 범위.
- **우선순위**: **P1** — 노션의 대표적 확산 채널이자, 클론에서 "만든 걸 남에게 보여주는" 유일한 경로.
- **클론 시 현실적 대안**: v1은 `{slug}.myclone.site` 서브도메인 + 단일 페이지 발행(하위 트리 미포함) + 정적 HTML 캐시로 시작. 사이트 설정(SEO/GA/홈페이지)은 v2.
- **참고 출처**: https://www.notion.com/help/public-pages-and-web-publishing , https://www.notion.com/help/notion-sites-availability-and-pricing

---

### F-13-09 Sites — 커스텀 도메인 · DNS 검증 · SEO · Analytics

- **한 줄 정의**: 발행된 사이트를 사용자 소유 도메인(`www.example.com`)에 연결하고, 검색·분석 도구를 붙인다.
- **사용자 시나리오**:
  1. 유료 플랜 **워크스페이스 소유자**가 사이트 설정에서 도메인 입력. **반드시 서브도메인을 포함**해야 한다(`www` 등). apex(`example.com`) 직접 연결 불가.
  2. 노션이 두 개의 DNS 레코드를 제시한다.
     - `CNAME` : 호스트 = 입력한 서브도메인, 값 = `external.notion.site.` (끝 마침표 포함)
     - `TXT` : 소유권 검증용 (이름/값을 복사)
  3. DNS 제공자에 레코드를 추가한다. **Cloudflare 사용 시 Proxy status는 반드시 꺼야 한다.**
  4. 노션에서 `Verify` 클릭 → 검증 통과 시 연결 완료.
  5. apex 도메인은 DNS 제공자의 리다이렉트 기능으로 `www`로 보낸다.
  6. SEO 제목/설명 입력, Google Analytics ID 연결, `Discoverable on the web` 토글.
- **동작 상세**:

  | 항목 | 값/동작 |
  |---|---|
  | 과금 | 커스텀 도메인은 **별도 애드온**: 월 결제 $10/월, 연 결제 $8/월 |
  | 도메인 개수 | 도메인마다 애드온을 각각 구매. 최대 **25개** |
  | 결제 주기 | 노션 본 구독과 동일 주기로 강제(월↔월, 연↔연). 중도 추가 시 일할 계산 |
  | 권한 | **유료 플랜의 워크스페이스 소유자**만 연결 가능 |
  | 레코드 | CNAME(`external.notion.site.`) + TXT 검증 2종 |
  | apex 지원 | 미지원. 서브도메인 필수 |
  | SSL | 문서에 명시 없음 `[확인필요: 자동 인증서 발급 방식(Let's Encrypt 등)]` |
  | 애널리틱스 | Google Analytics 연동. 그 외 도구는 미지원(스크립트 삽입 불가) |
  | 색인 | `Discoverable on the web` 토글로 제어. 노출까지 최대 4주 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | DNS 전파 지연 | 검증 실패가 "잘못된 설정"인지 "아직 전파 안 됨"인지 구분해 안내해야 함. 재시도 잡 필요 |
  | Cloudflare 프록시 켜짐 | CNAME이 프록시 IP로 가려져 검증 실패. 가장 흔한 실패 원인 → 전용 에러 메시지 |
  | 도메인 소유권 이전/만료 | TXT가 사라지면 재검증 실패 → 유예 기간 후 연결 해제 |
  | 애드온 해지 | 도메인 연결이 끊기고 notion.site로 폴백할지, 사이트가 내려갈지 정책 필요 |
  | 플랜 다운그레이드 | 유료→Free 강등 시 커스텀 도메인 즉시 무효화 |
  | 여러 워크스페이스가 같은 도메인 주장 | TXT 검증으로 1:1 보장. 중복 등록 차단 |
  | SSL 발급 실패 | CAA 레코드가 발급 기관을 막고 있으면 HTTPS 실패 → CAA 안내 필요 |
  | GA 미승인 지역 | 쿠키 동의 배너가 필요한 지역 규제 `[확인필요]` |

- **데이터 모델 함의**:

```
custom_domain
  id, workspace_id, site_id
  hostname                            -- www.example.com (서브도메인 필수)
  cname_target                        -- external.notion.site.
  txt_record_name, txt_record_value
  verification_state enum('pending','verified','failed','revoked')
  last_checked_at, verified_at, failure_reason
  ssl_state enum('none','provisioning','active','failed')
  addon_subscription_id               -- 과금 연결

site_analytics(site_id, provider enum('google_analytics'), tracking_id)
site_seo(site_id, title, description, og_image_url, robots enum('index','noindex'))
```

  운영 관점에서 필수인 것: **주기적 DNS 재검증 크론**(도메인 탈취/설정 변경 감지)과 **인증서 자동 갱신 파이프라인**. 이 두 개가 없으면 커스텀 도메인은 반드시 사고를 낸다.
- **UI/인터랙션**: 도메인 입력 → 레코드 표 + 복사 버튼 → `Verify` 버튼(폴링 상태 표시) → 상태 배지(대기/검증됨/실패 사유).
- **의존 기능**: F-13-08(사이트), F-13-18(플랜/애드온 과금), 리버스 프록시/CDN 인프라, ACME 인증서 발급.
- **구현 난이도**: **L** — 애플리케이션 코드보다 **인프라 작업**(와일드카드 라우팅, SNI, 온디맨드 인증서, CDN 캐시 키)이 비용의 대부분이다.
- **우선순위**: **P2** — 다만 **유료화 지점으로는 최고 가치**. 노션이 이것만 별도 SKU($10/월)로 떼어낸 것이 근거다.
- **클론 시 현실적 대안**: 직접 구축하지 말고 Cloudflare for SaaS / Vercel Domains API 같은 **커스텀 도메인 위임 서비스**를 쓴다. 애플리케이션은 hostname → site_id 매핑만 관리하면 되고 인증서·라우팅은 위임된다. L → M.
- **참고 출처**: https://www.notion.com/help/connect-a-custom-domain-with-notion-sites , https://www.notion.com/help/notion-sites-availability-and-pricing

---

## E. Charts & Dashboard

### F-13-10 Chart view — 차트 엔진 (축 · 집계 · 그룹)

- **한 줄 정의**: 데이터베이스의 행들을 막대/선/도넛/숫자 차트로 집계 시각화하는 뷰 타입.
- **사용자 시나리오**:
  1. 페이지에서 `/chart` 입력 후 차트 타입 선택, 또는 데이터베이스 뷰 탭 `+` → `Chart`.
  2. 차트 타입 선택: 세로 막대 / 가로 막대 / 선 / 도넛 / 숫자.
  3. X축 프로퍼티(카테고리)와 Y축(`Count` 또는 특정 숫자 프로퍼티 + 집계 방식)을 지정한다.
  4. 필요하면 `Group by`로 추가 프로퍼티 분할(막대/선만 가능) → 누적/그룹 막대가 된다.
  5. `Visible groups`의 눈 아이콘으로 특정 카테고리를 숨긴다.
  6. 정렬(오름/내림), `Omit zero values`, `Cumulative`(누적) 토글, 색상 팔레트, 그리드선/축 라벨/데이터 라벨/범례 표시를 조정한다.
  7. 선 차트는 부드러운 곡선(smooth) 및 그라디언트 채움 옵션이 추가된다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 차트 타입 | vertical bar / horizontal bar / line / donut / number (5종) |
  | 축 설정 | X·Y축 설정은 **막대·선 차트에만** 존재. 도넛은 "값 프로퍼티 + 슬라이스 기준 프로퍼티", 숫자 차트는 단일 지표 |
  | Y축 값 | `Count`(항목 수) 또는 숫자 프로퍼티(합계/평균 등 집계) |
  | 지원 안 되는 프로퍼티 | **rollup, button, unique ID, files & media, 리스트를 반환하는 formula** 는 축으로 쓸 수 없음 |
  | 한도 | **그룹 최대 200개, 서브그룹 최대 50개** |
  | 누적 토글 | 시간 경과에 따른 누적값 vs 시점값 |
  | 필터/정렬 | 다른 뷰와 동일한 filter/sort를 차트에도 적용 |
  | 플랜 게이팅 | Free 플랜 **차트 1개**, 유료 무제한. `[확인필요: Plus도 1개로 제한된다는 자료와 "유료는 무제한"이라는 자료가 엇갈림. 실제 요금제 화면에서 재확인 필요]` |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 빈 값 / null 카테고리 | "없음(Empty)" 그룹으로 묶을지 제외할지. `Omit zero values` 토글과 상호작용 |
  | 그룹 200개 초과 | 상위 N개 + "기타"로 접거나 에러 표시. 무한 렌더 금지 |
  | 축 프로퍼티 삭제 | 차트가 깨짐 → "프로퍼티 없음" 빈 상태 + 재설정 유도 |
  | 프로퍼티 타입 변환 | number→text 변환 시 집계 불가 → 자동으로 Count로 폴백 `[추정]` |
  | 대용량 DB | 클라이언트에서 전체 행을 받아 집계하면 안 됨. **서버 집계(GROUP BY) 필수** |
  | 실시간 갱신 | 행 하나 수정에 전체 재집계는 비용. 디바운스 + 부분 무효화 |
  | 권한 | 차트는 집계값을 노출한다. 볼 수 없는 행이 합계에 포함되면 정보 유출 → **권한 필터를 집계 이전에 적용** |
  | 날짜 축 | 일/주/월/분기/연 버킷팅 필요. 타임존 기준 명시 `[확인필요: 노션의 날짜 버킷 옵션]` |

- **데이터 모델 함의**:

```
chart_view                            -- database_view 상속 (type='chart')
  id, data_source_id
  chart_type enum('bar_v','bar_h','line','donut','number')
  x_property_id, x_bucket enum('none','day','week','month','quarter','year')
  y_source enum('count','property'), y_property_id
  y_aggregation enum('sum','avg','min','max','median','count')
  group_by_property_id NULL           -- bar/line only
  stacking enum('none','stacked','percent')
  cumulative boolean, omit_zero boolean
  sort_by enum('x','y'), sort_dir
  color_palette, show_grid, show_axis_labels, show_data_labels, show_legend
  line_smooth boolean, line_gradient boolean

chart_hidden_group(chart_view_id, group_key)     -- Visible groups 의 눈 아이콘
```

  서버 쿼리는 결국 `SELECT x_bucket, group_key, AGG(y) FROM rows WHERE <filter AND permission> GROUP BY 1,2 LIMIT 200`. **집계는 반드시 DB 레벨에서** 수행한다.
- **UI/인터랙션**: `/chart` 슬래시 커맨드, 우상단 설정 메뉴에서 타입 전환, 축 드롭다운, 눈 아이콘 토글, 범례 클릭으로 시리즈 토글 `[추정]`, 호버 툴팁.
- **의존 기능**: F-04-01(뷰 컨테이너), F-04-09~F-04-11(필터/정렬/그룹), F-03-17(프로퍼티별 연산자 계약), F-04-16(집계 함수).
- **구현 난이도**: **L** — 렌더는 차트 라이브러리로 해결되지만, **프로퍼티 타입 × 집계 함수 조합 매트릭스**와 서버 집계 쿼리 생성기가 실제 비용. 프로퍼티 타입이 20종이면 조합 검증이 만만치 않다.
- **우선순위**: **P1** — 데이터베이스 제품에서 "보여줄 수 있는" 기능. 다만 P0는 아니다(테이블/보드가 먼저).
- **클론 시 현실적 대안**: v1은 `bar_v` + `line` + `donut` 3종, X축은 select/status/date만, Y축은 `count`와 `sum(number)`만 지원. 서브그룹·누적·스타일 옵션은 v2. 이러면 M.
- **참고 출처**: https://www.notion.com/help/charts

---

### F-13-11 Dashboard view — 위젯 컨테이너 + global filter

- **한 줄 정의**: 여러 데이터베이스 뷰(차트·테이블·보드·캘린더·타임라인)를 위젯으로 한 화면에 배치하고, 하나의 필터로 여러 위젯을 동시에 좁히는 뷰 타입.
- **사용자 시나리오**:
  1. `/dash` 슬래시 커맨드로 대시보드 뷰 생성(또는 뷰 탭 `+`). Notion Agent에게 초안 생성을 시킬 수도 있다.
  2. `Edit` 모드로 전환 → 위젯 추가 → 각 위젯에 표시할 데이터베이스 뷰를 지정.
  3. 위젯 사이 핸들을 좌우로 드래그해 폭 조정, 행 구분선을 상하로 드래그해 높이 조정.
  4. 위젯별로 필터·정렬·그룹·시각화 타입을 조정한다.
  5. 상단 필터 아이콘 → `Filter multiple sources` → 프로퍼티와 조건 선택 → **여러 위젯에 동시 적용**.
  6. `View` 모드로 돌아오면 레이아웃은 잠기고 데이터만 조작 가능하다.
- **동작 상세**:

  | 항목 | 값/동작 |
  |---|---|
  | 위젯 한도 | **행당 최대 4개, 전체 최대 12개** |
  | 위젯 내용 | 위젯 1개 = 데이터베이스 뷰 1개(table/board/chart/calendar/timeline 등) |
  | 데이터 소스 | 위젯마다 서로 다른 데이터베이스 가능(크로스 DB 대시보드) |
  | 모드 | Edit(레이아웃 편집) / View(일상 사용) 2모드 분리 |
  | Global filter | 여러 소스에 동시 적용. **해당 프로퍼티를 가진 위젯에만 적용**되고, 없는 위젯에는 아무 효과 없음 |
  | 다중 global filter | 서로 다른 프로퍼티로 여러 개 추가 가능 |
  | 플랜 게이팅 | 출시 시점 기준 **Business / Enterprise 전용** |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | global filter가 안 먹는 위젯 | 사용자에게 "이 위젯에는 해당 프로퍼티 없음" 힌트를 줘야 함. 아니면 "필터가 고장났다"고 오해 |
  | 같은 이름 다른 타입 프로퍼티 | DB A의 `Status`는 status, DB B의 `Status`는 select → 매칭 규칙 필요(이름+타입 일치) `[추정]` |
  | 위젯 소스 DB 삭제 | 위젯이 빈 상태로 남고 제거 유도 |
  | 권한 없는 소스 | 볼 수 없는 DB의 위젯은 잠금 아이콘 + 접근 요청 |
  | 성능 | 12개 위젯 = 12개 병렬 쿼리. 대시보드 1회 로드가 DB에 12중 부하 → 캐시·동시성 제한 필요 |
  | 모바일 | 4열 그리드는 모바일에서 세로 스택으로 붕괴시켜야 함 |
  | View 모드에서의 필터 | 개인 필터로 저장할지, 전체 공유할지(F-04-17의 2층 구조 재사용) |

- **데이터 모델 함의**:

```
dashboard_view                       -- database_view 상속 (type='dashboard')
  id, container_page_id
  row_heights int[]                  -- 행별 높이

dashboard_widget
  id, dashboard_view_id
  source_view_id                     -- 표시할 database_view
  row int, col int, width_fr float   -- 그리드 좌표 (행당 최대 4)
  title_override, created_at
  CHECK (widget 총 개수 <= 12)

dashboard_global_filter
  id, dashboard_view_id
  property_name text                 -- 소스 무관 매칭 키 (이름 기반)
  property_type text
  operator, value jsonb
  order int
```

  설계 주의: global filter는 **property_id가 아니라 (이름, 타입) 쌍으로 여러 DB에 매칭**되어야 한다. id 기반이면 크로스 DB가 성립하지 않는다.
- **UI/인터랙션**: Edit/View 모드 토글, 위젯 드래그 리사이즈, 위젯 `•••` 메뉴, 상단 global filter 칩.
- **의존 기능**: F-13-10(차트), F-04-01(뷰), F-04-09(필터), F-04-13(linked view — 위젯은 사실상 linked view의 배치판), F-13-18(플랜 게이팅).
- **구현 난이도**: **L** — 그리드 레이아웃 편집기 + 크로스 소스 필터 매칭 + 다중 위젯 로딩 성능 관리.
- **우선순위**: **P2** — 원본도 상위 플랜 전용으로 낸 기능. 클론 MVP에는 불필요하고, "인라인 DB 여러 개를 컬럼 레이아웃에 배치"(F-01-12)로 80%가 대체된다.
- **클론 시 현실적 대안**: 별도 뷰 타입을 만들지 말고 **일반 페이지 + column layout + linked view**로 대시보드를 구성하게 한다. global filter만 별도 블록으로 제공하면 차별점의 핵심은 남는다.
- **참고 출처**: https://www.notion.com/help/dashboards

---

## F. Wiki & Verification

### F-13-12 Wiki 전환 (Turn into wiki) & Owner 프로퍼티

- **한 줄 정의**: 일반 페이지를 "하위 페이지들을 데이터베이스로 관리하는 지식 허브"로 전환하고, 페이지마다 소유자를 지정한다.
- **사용자 시나리오**:
  1. 페이지 `•••` → `Turn into wiki`.
  2. 하위 페이지들이 데이터베이스 행으로 편입되고, 세 개의 기본 뷰가 생긴다: `Home` / `All pages` / `Pages I own`.
  3. 각 페이지에 `Owner`, `Tags`, `Verification` 프로퍼티가 생긴다. **페이지 생성자가 기본 owner**가 된다.
  4. owner를 다른 사람으로 바꾸거나 여러 명을 지정한다.
  5. 되돌리려면 `•••` → `Undo wiki`.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 전환 대상 | **페이지만 가능. 데이터베이스는 wiki로 전환 불가** |
  | 기본 뷰 3종 | Home(레이아웃 자유), All pages(전체 DB 뷰), Pages I own(내 소유 필터 뷰) |
  | Owner | people 계열 프로퍼티. 기본값 = 페이지 생성자. 다수 지정 가능 |
  | verification 전제 | **verification에는 owner가 최소 1명 필요** |
  | 되돌리기 | `Undo wiki`로 일반 페이지로 복귀 |
  | 하위 페이지 편입 | 전환 시점의 하위 페이지가 wiki DB의 행이 됨. 이후 만든 하위 페이지도 자동 편입 `[추정]` |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 하위에 데이터베이스가 있음 | DB는 행으로 편입 불가. 어떻게 처리할지 정책 필요 `[확인필요]` |
  | 깊은 중첩 | 손자 페이지도 wiki DB에 편입되는지, 자식만인지 `[확인필요]` |
  | Undo wiki | 프로퍼티(Owner/Tags/Verification) 값이 소실되는지 보존되는지 `[확인필요]`. 소실된다면 경고 모달 필수 |
  | owner 계정 비활성화 | 퇴사자가 owner인 verified 페이지가 방치됨 → 관리자용 "고아 owner" 리포트 필요 |
  | owner 없음 | verification 불가. 검증 시도 시 owner 지정 유도 |
  | 대용량 | 수천 페이지 wiki는 All pages 뷰의 페이지네이션·검색 성능 문제 |
  | 권한 | wiki DB 행 = 페이지이므로 페이지 권한이 그대로 적용. 볼 수 없는 페이지는 목록에서 제외 |

- **데이터 모델 함의**:

```
-- wiki 는 새 엔티티가 아니라 page 의 플래그 + 자동 생성 data_source 로 표현한다
page.is_wiki boolean
wiki
  page_id, data_source_id            -- 하위 페이지를 담는 DB
  home_view_id, all_pages_view_id, my_pages_view_id
  owner_property_id, tags_property_id, verification_property_id
  converted_at, converted_by
```

  즉 wiki는 **"page + database 의 합성 뷰"** 다. 새 저장 구조를 만들지 말고 기존 두 개를 묶는 것이 정답이다. `page.parent_id` 트리는 그대로 두고, wiki DB는 그 트리를 쿼리하는 data source로 정의한다.
- **UI/인터랙션**: `•••` 메뉴의 전환/해제, 상단 뷰 탭 3종, 페이지 행 호버 시 owner 아바타, Home 뷰의 자유 레이아웃.
- **의존 기능**: F-02-02(중첩 페이지 트리), F-03-01(DB 3계층), F-03-07(people 프로퍼티), F-13-13(verification).
- **구현 난이도**: **M** — 새 저장 구조가 필요 없고, "페이지 트리를 data source로 노출하는 어댑터" + 뷰 3종 프리셋이 주 작업.
- **우선순위**: **P1** — 팀 지식베이스 용도의 클론에서 체감 가치가 크고 비용이 낮다.
- **클론 시 현실적 대안**: `Owner` / `Tags` 프로퍼티와 `All pages` 뷰만 제공하고 Home 뷰의 자유 레이아웃은 생략하면 S~M.
- **참고 출처**: https://www.notion.com/help/wikis-and-verified-pages

---

### F-13-13 페이지 verification (검증 배지 · 만료 · 재검증)

- **한 줄 정의**: 페이지 소유자가 "이 문서는 현재 유효하다"고 도장을 찍고, 기한이 지나면 자동으로 도장이 풀린다.
- **사용자 시나리오**:
  1. 페이지 owner가 페이지 상단에서 `Verify` 선택.
  2. 유효 기간을 고른다: 특정 날짜까지 또는 **무기한(infinite)**.
  3. 검증되면 페이지에 **파란 체크 배지**가 붙고, 멘션·검색 결과에도 배지가 표시된다.
  4. 만료가 되면 owner의 **노션 인박스 + 이메일로 알림**이 간다.
  5. owner는 내용을 갱신한 뒤 재검증하거나 기한을 연장한다.
  6. 관리자는 `Settings → Verified pages`에서 전체 검증 페이지를 검색·owner별 필터·일괄 관리한다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 플랜 게이팅 | **Business / Enterprise 전용** |
  | 검증 권한 | **해당 페이지의 owner만** 검증 가능 |
  | 전제 조건 | owner가 최소 1명 있어야 함 |
  | 대상 | wiki 내 페이지뿐 아니라 **일반 워크스페이스 페이지, 데이터베이스 페이지**도 검증 가능 |
  | 기간 | 지정 날짜 또는 무기한 |
  | 만료 효과 | 배지 상실 + **검색 결과·AI 답변에서의 우선순위 상실** |
  | 알림 | 만료 시 인박스 + 이메일 |
  | 관리 화면 | Settings의 Verified pages에서 전수 조회·필터 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 검증 후 내용 수정 | 수정해도 검증이 자동 해제되지 않는다 `[확인필요]`. 해제한다면 "누가 수정하면 해제인가"(owner 본인 제외?) 정책 필요 |
  | owner 변경 | 새 owner가 검증 상태를 승계하는지 `[확인필요]` |
  | owner 퇴사/비활성 | 만료 알림이 갈 곳이 없음 → 관리자에게 에스컬레이션 필요 |
  | 시간대 | 만료 판정 기준 타임존(워크스페이스 기준 권장) |
  | 대량 만료 | 같은 날 수백 페이지가 만료되면 알림 폭탄 → 다이제스트로 묶어야 함 |
  | 플랜 다운그레이드 | Business→Plus 시 기존 배지 처리 정책 `[확인필요]` |
  | 페이지 삭제/복원 | 삭제 시 검증 레코드 유지, 복원 시 만료 여부 재판정 |

- **데이터 모델 함의**:

```
page_verification
  page_id PK
  verified_by_user_id
  verified_at
  expires_at NULL                    -- NULL = 무기한
  state enum('verified','expired','revoked')
  last_notified_at
  revoked_at, revoked_by

page_owner(page_id, user_id)         -- wiki 의 Owner 프로퍼티와 동일 소스여야 함
```

  운영 필수 구성요소: **만료 스캔 크론**(`WHERE expires_at < now() AND state='verified'` → state 갱신 + 알림 발행)과, 검색 랭킹 파이프라인에 `is_verified` 부스트 필드를 실어 보내는 인덱싱 훅(F-07-06). 검색/AI 우선순위 반영이 없으면 이 기능은 단순 배지에 불과하다.
- **UI/인터랙션**: 페이지 상단 배지, 배지 호버 시 "누가 언제까지 검증" 툴팁, 멘션·검색 결과의 체크 아이콘, 설정 내 관리 테이블.
- **의존 기능**: F-13-12(owner), F-11-08(알림 규칙), F-07-02(검색 랭킹), F-10-06(AI Q&A 소스 우선순위), F-13-18(플랜 게이팅).
- **구현 난이도**: **M** — 데이터 모델은 단순하다. 만료 크론 + 알림 + 검색 랭킹 반영 3개를 붙이는 것이 실제 작업.
- **우선순위**: **P2** — 문서가 수백 개 이상 쌓인 조직에서만 가치가 생긴다. 다만 **AI 답변 신뢰도의 근거 신호**로 쓰이므로 AI 기능이 있는 클론이라면 P1로 올릴 만하다.
- **클론 시 현실적 대안**: 배지 + 만료일 + 인앱 알림만 구현하고, 이메일·관리 콘솔·AI 랭킹 반영은 후순위. S~M.
- **참고 출처**: https://www.notion.com/help/wikis-and-verified-pages , https://www.notion.com/help/guides/verify-knowledge-your-teammates-can-trust-with-page-verification

---

## G. Agents (Notion 3.0 → 3.3)

> 타임라인: **2025-09-18 노션 3.0 "Agents"** — 개인 에이전트가 20분 이상 다단계 작업 수행. → **2026-02-24 노션 3.3 "Custom Agents"** — 스케줄/이벤트 트리거로 자율 실행되는 공유 에이전트. 베타 기간에 21,000개가 만들어졌고 노션 내부에서만 2,800개가 돌고 있다고 발표. → 이후 2026년 내내 릴리스가 에이전트 중심으로 이어짐(에이전트 iOS 앱, 캘린더 툴, Share 메뉴에서 에이전트에 문서 공유, suggest edits 모드 등).

### F-13-14 Notion Agent — 개인 에이전트 (대화형)

- **한 줄 정의**: 내 권한 범위 안에서 워크스페이스와 연결 앱을 읽고, 페이지·데이터베이스를 실제로 만들고 고치는 대화형 AI 동료.
- **사용자 시나리오**:
  1. 화면 하단의 에이전트 아이콘 클릭 → 채팅 패널 열림. `Sidebar`(우측 고정) / `Floating`(별도 창) 모드 전환 가능.
  2. "지난주 회의록에서 액션 아이템 뽑아서 Tasks DB에 넣어줘" 같은 지시를 자연어로 입력.
  3. 에이전트가 검색 → 읽기 → 계획 → 실행 단계를 진행 상황과 함께 보여준다.
  4. 결과가 채팅 안에 **인터랙티브 테이블**로 표시되기도 한다.
  5. Gmail·Slack 등 외부 쓰기 작업은 **실행 전 확인(confirm)** 을 요구한다.
  6. `My Notion AI` 지시 페이지에 톤·우선 참조 페이지·규칙을 적어두면 이후 모든 대화에 적용된다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 능력 | 페이지·DB 생성/편집, 워크스페이스 및 연결 앱 검색, 다단계 작업(20분+), 파일(PDF/CSV) 분석, 인박스·Gmail·캘린더 조작, MCP 서버 도구 사용 |
  | 메모리 | `My Notion AI` 지시 페이지 = 사용자 정의 컨텍스트. 노션 페이지/DB 자체를 메모리 저장소로 사용 |
  | Skills | 재사용 가능한 커스텀 프롬프트(F-10-19) |
  | 권한 | **사용자의 권한을 그대로 상속.** 사용자가 볼 수 없는 것은 에이전트도 못 본다 |
  | 승인 게이트 | 외부 시스템(Gmail/Slack) 쓰기는 사전 확인 필요 |
  | 제안 모드 | 2026-08-28부터 직접 수정 대신 **suggest edits**(줄 단위 승인) 가능 |
  | 못 하는 것 | automation·formula·고급 프로퍼티 생성 불가, 코멘트 편집 불가, 워크스페이스 설정 변경 불가, 모바일에서 캘린더 액션 불가 |
  | 과금 | Business/Enterprise에 사용량 포함. 프리미엄 모델은 **Notion 크레딧** 소모, 관리자가 통제 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 권한 없는 데이터 요청 | 조용히 무시하지 말고 "접근 권한이 없다"고 명시해야 함. 존재 자체를 노출할지도 정책 사안 |
  | 파괴적 편집 | 대량 삭제·덮어쓰기는 되돌릴 수 있어야 함 → **에이전트 변경분은 하나의 undo 단위**로 묶어야 한다(F-05-15) |
  | 장시간 실행 중 사용자 이탈 | 백그라운드 계속 실행 + 완료 알림 |
  | 동시 편집 충돌 | 에이전트가 편집 중인 블록을 사람이 동시에 수정 |
  | 프롬프트 인젝션 | 워크스페이스 문서·웹 페이지에 심어진 지시문이 에이전트를 조종할 수 있음. **읽은 콘텐츠는 데이터, 지시가 아님**을 시스템 레벨에서 강제해야 함 |
  | 크레딧 소진 | 실행 중단 지점과 부분 결과 처리 |
  | 대용량 컨텍스트 | 수천 페이지 검색 시 요약·청킹 필요 |

- **데이터 모델 함의**:

```
agent_session
  id, user_id, workspace_id, mode enum('sidebar','floating')
  model_id, created_at, ended_at, credit_cost

agent_message
  id, session_id, role enum('user','agent','tool')
  content jsonb, created_at

agent_action                          -- 감사·되돌리기의 핵심
  id, session_id, tool_name
  target_type, target_id
  before_snapshot jsonb, after_snapshot jsonb
  status enum('proposed','approved','executed','failed','reverted')
  requires_confirmation boolean, confirmed_by, executed_at

agent_instruction_page(user_id, page_id)          -- My Notion AI
agent_skill(id, owner_id, name, prompt, scope)
```

  가장 중요한 설계: **모든 에이전트 쓰기는 `agent_action`으로 기록되고 되돌릴 수 있어야 한다.** 이것이 없으면 에이전트는 조직에 배포 불가능한 기능이다.
- **UI/인터랙션**: 하단 상주 버튼, 사이드바/플로팅 전환, 진행 단계 스트리밍 표시, 인라인 승인 버튼, 결과 테이블, `@`로 특정 페이지 컨텍스트 지정.
- **의존 기능**: F-10-06(AI Q&A), F-10-08(권한 인지 인덱스), F-10-09(스트리밍), F-10-18(MCP), F-10-20(승인 게이트), F-06-01(권한).
- **구현 난이도**: **XL** — LLM 오케스트레이션 + 툴 정의 + 권한 필터 + 되돌리기 + 승인 UI. 어느 하나만 빠져도 실사용 불가.
- **우선순위**: **P2** — 노션 클론의 정체성은 에디터/DB다. 에이전트는 그 위에 얹는 것.
- **클론 시 현실적 대안**: "대화형 자율 에이전트" 대신 **범위가 좁은 툴 3~5개짜리 어시스턴트**(페이지 요약, DB 행 생성, 검색 답변)로 시작. 모든 쓰기는 "제안 → 사용자 승인" 고정. XL → L.
- **참고 출처**: https://www.notion.com/help/notion-agent , https://www.notion.com/releases/2025-09-18 , https://www.notion.com/blog/introducing-notion-3-0

---

### F-13-15 Custom Agents — 트리거 기반 자율 에이전트 (3.3)

- **한 줄 정의**: 사람이 매번 지시하지 않아도 스케줄이나 이벤트에 반응해 스스로 일하는, 팀에 공유 가능한 에이전트.
- **사용자 시나리오**:
  1. 에이전트 생성 화면에서 **원하는 동작을 평문으로 설명**하면 노션이 초안 에이전트를 만들어 준다.
  2. 이후 파라미터를 조정한다: 트리거(스케줄 / 이벤트), 지시문(instructions), 지식 소스(knowledge), 모델 선택, 연결(connections).
  3. 팀에 공유한다. 2026-08-07부터는 **Share 메뉴에서 문서·데이터베이스를 에이전트에 직접 공유**할 수 있다(에이전트가 자체 권한을 가지는 principal — F-06-18).
  4. 에이전트가 트리거될 때마다 실행 로그가 남고, 변경 내역은 확인·되돌리기 가능하다.
  5. 관리자가 언제든 비활성화할 수 있고, Business/Enterprise 관리자는 에이전트 생성 권한 자체를 통제한다.
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 개인 Agent와의 차이 | 개인 Agent = 대화 단위로 내가 지시. Custom Agent = **트리거로 자율 실행 + 팀 공유 + 자체 권한** |
  | 트리거 | 스케줄(주기) / 이벤트(DB 변경, 회의노트 생성 등). 2026-07-31부터 **AI Meeting Notes 완료가 트리거**로 사용 가능 |
  | 연결 | Slack, Notion Mail/Calendar, FigJam, MCP 호환 도구(Linear, Figma, HubSpot 등) |
  | 모델 선택 | 에이전트별 모델 지정. 2026-08-14부터 속도/지능/비용 스코어카드가 제공되는 추천 목록으로 단순화 |
  | 거버넌스 | 전체 실행 로그, 변경 가시화·되돌리기, 상시 비활성화, 관리자 권한 통제 |
  | 과금 | 2026-05-03까지 무료 체험 → **2026-05-04부터 Notion 크레딧 소비**. Business/Enterprise 애드온. `[확인필요: "1,000 크레딧당 $10" 표기를 요금 페이지에서 재확인할 것]` |
  | 대표 용도 | 반복 질문 답변(Q&A), 요청 분류·배정(triage/routing), 일일 스탠드업·스프린트 리캡 자동 생성 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 무한 루프 | 에이전트 A의 출력이 에이전트 B의 트리거가 되고 다시 A를 트리거 → **실행 깊이 제한·동일 소스 재트리거 차단 필수**(F-08-10과 동일 문제) |
  | 실행 실패 | 재시도 정책, 실패 알림, 부분 실행 롤백 |
  | 크레딧 소진 | 실행 스킵 + 관리자 알림. 조용한 실패는 최악 |
  | 권한 회수 | 에이전트에 공유된 페이지가 공유 해제되면 다음 실행부터 접근 불가. 진행 중 실행은? `[확인필요]` |
  | 생성자 퇴사 | 에이전트가 고아가 됨. 소유권 이전 경로 필요 |
  | 스케줄 폭주 | 5분 주기 × 100개 에이전트 = 실행 큐 폭발. 워크스페이스별 동시 실행 상한 필요 |
  | 프롬프트 인젝션 | 자율 실행이므로 사람 검토가 없다. 개인 에이전트보다 위험이 크다 |
  | 대량 변경 | 한 실행이 수천 행을 바꾸는 경우 배치 승인/드라이런 필요 |

- **데이터 모델 함의**:

```
custom_agent
  id, workspace_id, name, description, avatar
  created_by, owner_user_id
  instructions text
  model_id
  status enum('active','paused','disabled')
  visibility enum('private','shared')
  created_at, updated_at

agent_trigger
  id, custom_agent_id
  kind enum('schedule','db_change','meeting_notes','webhook','mention')
  cron text NULL, data_source_id NULL, condition jsonb
  next_run_at, last_run_at

agent_knowledge(custom_agent_id, resource_type, resource_id)   -- 공유된 페이지/DB
agent_connection(custom_agent_id, provider, credential_ref, scopes[])

agent_run
  id, custom_agent_id, trigger_id
  started_at, finished_at, status enum('running','succeeded','failed','skipped')
  credits_used, error, log jsonb
  -- 개별 변경은 F-13-14 의 agent_action 을 run_id 로 묶어 기록
```

  **에이전트는 사람이 아닌 principal이다.** 권한 테이블(F-06-01)의 grantee 타입에 `agent`를 추가하고, 감사 로그의 actor에도 에이전트를 표현해야 한다. 이 결정이 없으면 "누가 이 페이지를 바꿨나"에 답할 수 없다.
- **UI/인터랙션**: 에이전트 생성 위저드(평문 설명 → 초안), 에이전트 목록/상태 대시보드, 실행 로그 타임라인, Share 메뉴의 에이전트 항목, 크레딧 사용량 대시보드.
- **의존 기능**: F-13-14, F-08-09/F-08-10(트리거·실행 런타임), F-06-18(에이전트 권한), F-11-12(감사 로그), F-13-18(크레딧 과금).
- **구현 난이도**: **XL** — 스케줄러 + 실행 큐 + 격리 실행 + 크레딧 미터링 + 감사/되돌리기. 사실상 서버리스 워크플로 플랫폼 하나를 만드는 일이다.
- **우선순위**: **P2** — 클론에서는 F-08-09(DB automation)로 90%의 실용 가치를 커버할 수 있다. LLM 자율성은 그 위의 얇은 층으로 미루라.
- **클론 시 현실적 대안**: "자율 에이전트" 대신 **"automation 액션에 AI 스텝 하나 추가"**(예: 행이 추가되면 → AI로 요약해 프로퍼티 채우기)로 구현한다. 트리거·큐·감사는 이미 automation이 갖고 있으므로 XL → M.
- **참고 출처**: https://www.notion.com/releases/2026-02-24 , https://www.notion.com/releases , https://www.notion.com/blog/building-shared-memory-for-ai-agents-in-notion

---

## H. 커스터마이징 (이모지 · 위젯)

### F-13-16 커스텀 이모지 (워크스페이스 이모지 라이브러리)

- **한 줄 정의**: 워크스페이스 구성원이 직접 올린 이미지를 유니코드 이모지처럼 페이지 아이콘·반응·인라인에 사용한다.
- **사용자 시나리오**:
  1. 사이드바 `Settings` → `Emoji` → `Add emoji` → 이미지 파일 업로드 + 이름 지정.
  2. 이모지 피커의 커스텀 탭에서 검색해 선택한다.
  3. 사용처: **페이지 아이콘 / 코멘트·페이지 반응(reaction) / 본문 인라인**.
  4. 본인이 올린 이모지는 `•••`으로 수정·삭제. 워크스페이스 소유자는 **누가 올렸든** 수정·삭제 가능.
  5. 소유자가 `Limit custom emoji creation to workspace owners`를 켜면 일반 멤버는 추가할 수 없다.
- **동작 상세** (노션 엔지니어링 블로그에 구현이 이례적으로 공개되어 있음):

  | 항목 | 동작 |
  |---|---|
  | 저장 표현 | 본문에서는 rich text **annotation**으로 저장: `["‣", [["ce", "<CUSTOM_EMOJI_ID>", "<WORKSPACE_ID>"]]]` — @멘션과 동일한 구조 |
  | 왜 id 참조인가 | id로 참조하므로 이모지 이름·이미지를 바꾸면 **워크스페이스 전체에 즉시 반영**된다(반응형 갱신) |
  | 실체 | 유니코드가 아니라 **업로드된 이미지 파일**. 애니메이션 가능 |
  | 워크스페이스 한도 | **최대 500개** |
  | 로딩 전략 | 앱 시작 시 크리티컬 요청 이후 전체 목록을 프리페치 → 피커 즉시 응답. 대신 미사용 데이터도 받는 트레이드오프 |
  | 피커 성능 | **가상화(virtualization)** — 뷰포트 + 버퍼만 렌더 |
  | 향후 계획 | 에지 캐시 기반 동적 페치로 전환 예정(블로그 명시) |
  | 공개 API | 아이콘 객체로 `{"type":"custom_emoji","custom_emoji":{"id","name","url"}}`. **읽기는 3필드, 쓰기는 `id`만** 있으면 됨. `List custom emojis` 엔드포인트(`name` 쿼리 지원)로 목록 조회. callout 블록 아이콘은 `file_upload`를 제외한 모든 타입 허용 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 이모지 삭제 후 참조 잔존 | 이미 본문에 박힌 참조가 깨진다. **tombstone(삭제 표시) 유지 + 플레이스홀더 렌더**가 안전. 하드 삭제는 위험 |
  | 다른 워크스페이스로 페이지 복사 | annotation에 workspace_id가 들어 있으므로 **타 워크스페이스에서는 렌더 불가** → 텍스트 폴백 또는 이모지 동반 복사 정책 필요 `[확인필요]` |
  | 공개 사이트 렌더 | 로그인 없이 이모지 이미지 URL에 접근 가능해야 함 → 공개 CDN 경로 필요 |
  | 500개 초과 | 추가 차단 + 정리 유도 |
  | 대용량/애니메이션 파일 | 크기·해상도 제한 필요 `[확인필요: 노션의 공식 파일 크기·포맷 제한 미공개]` |
  | 이름 중복 | 검색 혼란. 유일성 강제 여부 `[확인필요]` |
  | 부적절한 이미지 | 소유자 삭제 권한이 유일한 통제 수단. 신고 경로 부재 |
  | 권한 | 이모지 이미지 URL이 예측 가능하면 워크스페이스 자산이 외부 유출 |

- **데이터 모델 함의**:

```
custom_emoji
  id, workspace_id
  name text                          -- 검색 키
  file_url, file_size, mime_type, is_animated
  created_by, created_at, updated_at
  deleted_at NULL                    -- soft delete (참조 깨짐 방지)
  UNIQUE(workspace_id, name)         -- [확인필요] 노션이 강제하는지 미확인

workspace_settings.limit_emoji_creation_to_owners boolean
```

  본문 참조는 별도 테이블이 아니라 **rich text annotation 안의 id**로만 존재한다. 즉 "어디에 쓰였는지" 역인덱스가 없다 → 삭제 시 참조 정리가 불가능하므로 **soft delete가 사실상 강제**된다.
- **UI/인터랙션**: 이모지 피커의 커스텀 탭(가상화 그리드), 이름 검색, 업로드 다이얼로그, 관리 목록(수정/삭제), `:name:` 형태의 인라인 자동완성 `[확인필요]`.
- **의존 기능**: F-01-03(rich text annotation), F-02-05(페이지 아이콘), F-05-08(반응), F-12-09(파일 업로드/스토리지), F-09-01(API 아이콘 객체).
- **구현 난이도**: **M** — 업로드·저장·피커는 평이하지만, **annotation 표현 설계와 삭제 시 참조 처리**를 처음에 잘못 잡으면 되돌리기 어렵다.
- **우선순위**: **P1** — 비용 대비 사용자 체감(브랜딩·팀 문화)이 매우 크다. 노션이 별도 엔지니어링 블로그를 쓸 만큼 UX 임팩트가 있는 기능.
- **클론 시 현실적 대안**: 프리페치 대신 **피커를 열 때만 페치**하고, 애니메이션(GIF/APNG)은 v2로 미룬다. 개수 한도는 100개로 시작.
- **참고 출처**: https://www.notion.com/blog/how-we-built-custom-emoji , https://www.notion.com/help/workspace-settings , https://developers.notion.com/reference/emoji-and-icon

---

### F-13-17 서드파티 위젯 임베드 (iframe embed 계약)

- **한 줄 정의**: 노션이 만들지 않은 기능(시계, 날씨, 카운트다운, 진행률, Pomodoro 등)을 외부 서비스의 iframe URL로 페이지 안에 심는다.
- **사용자 시나리오**:
  1. 외부 위젯 서비스(Indify, Apption, Widgetbox 등)에서 위젯을 설정하고 **위젯 URL**을 복사한다.
  2. 노션 페이지에 URL을 붙여넣으면 팝업이 뜨고 `Create embed`를 선택한다.
  3. 임베드 블록이 생기고, 좌측 6점 핸들로 이동, 모서리 드래그로 크기 조절(**데스크톱만 가능**).
  4. 외부 서비스에서 위젯 설정을 바꾸면 **재임베드 없이 노션에서도 자동 반영**된다(같은 URL이 최신 상태를 렌더하므로).
- **동작 상세**:

  | 항목 | 동작 |
  |---|---|
  | 메커니즘 | 특별한 "위젯 시스템"이 아니라 **일반 embed 블록 = iframe**. 노션은 위젯 개념을 따로 갖고 있지 않다 |
  | 붙여넣기 분기 | URL 붙여넣기 시 `Dismiss` / `Create bookmark` / `Create embed` / `Paste as link` 선택지 제공(F-09-10, F-09-11) |
  | 프로바이더 범위 | 노션은 **Iframely를 통해 1,900개 이상 도메인**의 임베드를 지원한다(YouTube, Spotify, Miro, Loom, GitHub Gist, Google Maps, Vimeo, Typeform, Tableau 등). 즉 프로바이더 정규화는 자체 구현이 아니라 **외부 언퍼링 서비스에 위임**한 것 |
  | 네이티브 위젯 | 노션이 자체 제공하는 "위젯"은 embed 프로바이더와 2026-03 추가된 **Chart / Dashboard 뷰**뿐. Pomodoro·날씨·시계 같은 것은 전부 서드파티 |
  | 파일 임베드 | `/embed`로 로컬 파일(PDF/오디오/비디오/이미지) 업로드 임베드도 가능 |
  | 크기 조절 | 데스크톱에서만. 컬럼 레이아웃 안에 넣어 폭 제어 가능 |
  | 실패 요인 | 브라우저 보안/쿠키 차단, 서드파티 사이트의 `X-Frame-Options`/CSP `frame-ancestors` 로 iframe 거부 |

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 임베드 거부 헤더 | `X-Frame-Options: DENY` 사이트는 빈 화면이 된다 → **사전 검사 후 "임베드 불가, 북마크로 전환" 안내** |
  | 서드파티 서비스 종료 | 임베드가 영구히 깨짐. 원본 URL을 항상 함께 보관해 폴백 링크 제공 |
  | 오프라인 | iframe은 로드 불가 → 플레이스홀더 |
  | 공개 사이트(F-13-08) | 임베드가 방문자 브라우저에서 직접 로드된다 → **방문자 IP가 서드파티에 노출**. 프라이버시 고지 필요 |
  | 보안 | iframe이 부모 페이지를 조작하지 못하도록 `sandbox` 속성 필수(`allow-scripts allow-same-origin` 동시 부여는 sandbox 무력화 — 피할 것) |
  | 인쇄/PDF 내보내기 | iframe은 대개 렌더되지 않음 → 스냅샷 또는 링크로 대체 |
  | 다크 모드 | 서드파티 위젯이 테마를 모름. 테마 파라미터를 URL로 넘기는 관례 존재 |
  | 대량 임베드 | 페이지에 iframe 20개면 로딩이 붕괴 → **뷰포트 진입 시 lazy load** 필수 |

- **데이터 모델 함의**:

```
block(type='embed')
  properties.source: url
  format.block_width, block_height, block_full_width
  format.embed_provider                -- youtube/figma/generic 등 라우팅용
  format.aspect_ratio

embed_provider_registry                -- 서버측 화이트리스트/변환 규칙
  domain_pattern, provider_name
  url_transform                        -- watch?v= → /embed/ 같은 정규화
  allow_iframe boolean, default_ratio
  sandbox_flags text
```

  **보안 정책이 데이터가 되어야 한다.** provider별 sandbox 플래그와 허용 여부를 코드가 아닌 레지스트리로 관리해야 신규 서비스 대응이 배포 없이 가능하다. 노션처럼 Iframely 같은 상용 언퍼링 API를 쓰면 이 레지스트리 유지보수를 통째로 아웃소싱할 수 있다.
- **UI/인터랙션**: URL 붙여넣기 팝업의 4지선다, 6점 드래그 핸들, 모서리 리사이즈, 임베드 블록 `•••`의 "원본 열기 / 소스 변경 / 캡션".
- **의존 기능**: F-01-15(미디어/임베드 블록), F-09-10(embed 블록), F-09-11(언퍼링 3종), F-01-12(컬럼 레이아웃).
- **구현 난이도**: **S** — iframe 렌더 + 리사이즈 + provider 정규화. 하루~이틀.
- **우선순위**: **P0** — 비용이 거의 없는데 "노션에 없는 모든 기능"을 사용자가 스스로 채우게 해준다. **클론이 기능 부족을 메우는 가장 값싼 수단**이다.
- **클론 시 현실적 대안**: 그대로 구현하면 된다. 다만 v1부터 lazy load와 sandbox를 반드시 넣을 것.
- **참고 출처**: https://developers.notion.com/reference/block (embed block), https://helpcenter.indify.co/notion-widget-embeds , https://www.notion.com/help/embed-and-connect-other-apps

---

## I. 요금제

### F-13-18 요금제 엔타이틀먼트 엔진 (Free / Plus / Business / Enterprise)

- **한 줄 정의**: 워크스페이스의 플랜에 따라 기능 사용 가능 여부, 개수 한도, 보존 기간, 사용량 크레딧을 실시간으로 판정하고 강제하는 계층.
- **사용자 시나리오**:
  1. 사용자가 유료 전용 기능(예: 두 번째 차트 추가, 조건부 로직 설정, private teamspace 생성)을 시도한다.
  2. UI가 해당 액션에 업그레이드 배지/자물쇠를 표시하거나, 시도 시 업그레이드 모달을 띄운다.
  3. 결제 후 즉시 잠금이 풀린다.
  4. 다운그레이드 시 한도를 초과하는 기존 자산(차트 5개 등)의 처리 정책이 적용된다.
- **동작 상세 — 플랜별 차이 (공식 요금 페이지 기준, 2026-09-06 확인)**:

  | 항목 | Free | Plus | Business | Enterprise |
  |---|---|---|---|---|
  | 가격 | ₩0 | ₩14,000/월 (연 결제 시 약 ₩11,200/월, 20% 할인) | ₩30,000/월 (연 결제 시 약 ₩24,000/월) | 별도 문의 |
  | 파일 업로드 | **5MB/파일** | 무제한 (파일당 최대 약 5GB) | 동일 | 동일 |
  | 페이지 히스토리 | **7일** | **30일** | **90일** | **무제한** |
  | 게스트 | **10명** | 무제한 | 무제한 | 무제한 |
  | Teamspace | open / closed | open / closed | **+ private teamspace** | 동일 |
  | 차트 | **1개** | 1개 `[확인필요]` | 무제한 | 무제한 |
  | Dashboard view | ✗ | ✗ | ✓ | ✓ |
  | Forms | 기본 | 커스텀 폼 | **+ 조건부 로직** | 동일 |
  | Notion 브랜딩 제거(폼) | ✗ | ✓ | ✓ | ✓ |
  | Sites: notion.site 도메인 | **1개** | **최대 5개** | 5개 | 5개 |
  | Sites: SEO/GA/홈페이지 지정 | ✗ | ✓ | ✓ | ✓ |
  | 커스텀 도메인 | ✗ | 애드온 $10/월 (연 $8/월), 최대 25개 | 동일 | 동일 |
  | 페이지 verification / wiki owner 검증 | ✗ | ✗ | ✓ | ✓ |
  | SAML SSO | ✗ | ✗ | ✓ | ✓ |
  | SCIM 프로비저닝 | ✗ | ✗ | ✓ `[확인필요]` | ✓ |
  | Audit log | ✗ | ✗ | ✗ | ✓ |
  | Notion AI / Agents | 체험 한도 | 체험 한도 | **포함**(2026-07 기준 Business/Enterprise에 번들) | 포함 |
  | Custom Agents | 2026-05-03까지 무료 체험 → 이후 크레딧 | 동일 | 크레딧 애드온 | 크레딧 애드온 |
  | 퍼블리싱 전면 차단 정책 | — | — | — | ✓ (Sites/Forms/공개링크 일괄 금지) |

  > `[확인필요]` **USD 표기가 출처마다 엇갈린다.** 공식 요금 페이지는 지역 통화(KRW)로 응답했고, 3자 자료는 Plus $10~12/user/월, Business $18~24/user/월로 서로 다르게 적는다. **실제 결제 화면에서 재확인할 것.** 이 문서의 KRW 값만 1차 출처 기준이다.
  > `[확인필요]` 차트 개수: "Free 1개 / 유료 무제한"과 "Free·Plus 1개 / Business 이상 무제한"이 자료마다 다르다.

- **게이팅의 4가지 축** (클론 설계에서 가장 중요한 부분):

  | 축 | 예시 | 구현 방식 |
  |---|---|---|
  | ① 기능 온/오프 | 조건부 로직, private teamspace, SSO, audit log, dashboard view | boolean entitlement 조회 |
  | ② 개수 한도 | 차트 1개, notion.site 1개, 게스트 10명, 커스텀 도메인 25개, 이모지 500개, 캘린더 DB 20개 | 카운터 + 생성 시점 검사 |
  | ③ 기간 한도 | 페이지 히스토리 7/30/90/무제한 | 조회 쿼리에 기간 컷 + GC 잡 |
  | ④ 사용량 크레딧 | AI/Agent 크레딧, Notion Workers 사용량 | 미터링 + 잔량 차감 + 소진 처리 |

  네 축은 강제 지점이 전부 다르다. ①은 UI+API, ②는 생성 트랜잭션, ③은 조회·삭제 잡, ④는 실행 런타임. **하나의 `hasFeature()` 헬퍼로 통합하려 하면 실패한다.**

- **엣지 케이스**:

  | 상황 | 처리 |
  |---|---|
  | 다운그레이드 시 한도 초과 | 차트 5개 → Free(1개). **삭제 강제 / 읽기 전용 전환 / 초과분 잠금** 중 택1. 노션은 대체로 "기존 것은 남기되 신규 생성 차단" 방식 `[추정]` |
  | 히스토리 축소 | 90일 → 7일 강등 시 이전 스냅샷을 즉시 삭제할지 유예할지. 즉시 삭제는 데이터 손실 클레임의 원인 |
  | 결제 실패 | 유예 기간(grace period) 동안 기능 유지 후 강등 |
  | 커스텀 도메인 애드온 해지 | 사이트가 죽는지 notion.site로 폴백하는지 명시 필요 |
  | 크레딧 소진 중 실행 | 진행 중 에이전트 실행을 중단할지 완료시킬지 |
  | 워크스페이스 병합/이전 | 서로 다른 플랜의 워크스페이스 간 페이지 이동 시 기능 차이 |
  | 게스트 한도 초과 상태 | 이미 초대된 게스트를 쫓아낼 수는 없다 → 신규 초대만 차단 |
  | Enterprise 정책과 플랜의 충돌 | 조직 정책(퍼블리싱 금지)이 개별 워크스페이스 플랜보다 우선 |

- **데이터 모델 함의**:

```
plan
  id, code enum('free','plus','business','enterprise')
  display_name, price_monthly, price_annual, currency

plan_entitlement                      -- 플랜 → 기능/한도 매핑 (코드가 아니라 데이터)
  plan_id, key                        -- 'forms.conditional_logic', 'charts.max', 'history.days'
  kind enum('boolean','limit','duration','credit')
  value jsonb                         -- true / 1 / 90 / {"monthly":1000}

subscription
  id, workspace_id, plan_id
  billing_cycle enum('monthly','annual')
  seats int, status enum('active','past_due','canceled','grace')
  current_period_start, current_period_end

subscription_addon                    -- 커스텀 도메인, 크레딧 팩 등
  id, subscription_id, addon_code, quantity, unit_price, billing_cycle

usage_counter                         -- 축 ② 개수 한도
  workspace_id, key, current_value, updated_at

credit_ledger                         -- 축 ④ 사용량
  id, workspace_id, delta int, reason, ref_type, ref_id, created_at
  -- 잔액 = SUM(delta). 이벤트 소싱으로 두면 감사·환불이 쉬움
```

  핵심 설계 원칙: **엔타이틀먼트는 코드가 아니라 데이터여야 한다.** `if (plan === 'business')` 를 코드에 흩뿌리면 플랜 개편 때마다 전면 수정이 필요하다. `entitlement(workspace_id, 'charts.max')` 하나의 조회 함수로 통일하고, 그 결과를 캐시(TTL 짧게)한다.
  또한 **모든 한도 검사는 서버의 생성 트랜잭션 안에서** 해야 한다. UI 잠금만으로는 API 직접 호출로 우회된다.

- **UI/인터랙션**: 잠긴 기능 옆 업그레이드 배지, 클릭 시 업그레이드 모달(어떤 플랜이 필요한지 명시), 설정 내 사용량 대시보드(크레딧·게스트·도메인 잔여), 다운그레이드 확인 화면(무엇을 잃는지 열거).
- **의존 기능**: 전 도메인. 특히 F-13-03/09/11/13(플랜 게이팅 대상), F-06-11(보안 정책), F-11-03(히스토리 보존), F-10-12(AI 크레딧).
- **구현 난이도**: **L** — 결제 연동(Stripe 등) + 엔타이틀먼트 조회/캐시 + 4축 강제 지점 + 다운그레이드 정책. 기능 자체보다 **전 코드베이스에 강제 지점이 흩어진다**는 점이 비용.
- **우선순위**: **P0** — 수익화 계획이 있다면 반드시 **처음부터** 넣어야 한다. 나중에 넣으면 이미 만들어진 모든 기능에 게이트를 소급 삽입해야 하고, 그때는 반드시 구멍이 생긴다.
- **클론 시 현실적 대안**: 결제는 Stripe Billing에 위임하고, 엔타이틀먼트만 자체 테이블로 관리한다. v1은 축 ①(기능 온/오프)과 ②(개수 한도)만 구현하고, ③(기간)·④(크레딧)은 실제 유료 기능이 생길 때 추가한다.
- **참고 출처**: https://www.notion.com/pricing , https://www.notion.com/help/notion-sites-availability-and-pricing , https://www.notion.com/help/connect-a-custom-domain-with-notion-sites , https://www.notion.com/help/charts , https://www.notion.com/help/dashboards , https://www.notion.com/help/forms

---

## 클론 관점 종합 판단

### 1) "유료 티어 가치"로 그대로 쓸 수 있는 기능 (원본이 검증한 지불 의사)

| 기능 | 노션의 게이팅 | 클론에서의 판단 |
|---|---|---|
| 커스텀 도메인 | **별도 애드온 $10/월** | 가장 명확한 유료 SKU. 인프라 원가도 실제로 발생하므로 정당화가 쉽다 |
| 페이지 히스토리 보존 기간 | 7 / 30 / 90 / 무제한 | 스토리지 원가와 직결. 게이팅이 자연스럽고 반발이 적다 |
| 파일 업로드 용량 | Free 5MB | 원가 연동. Free 남용 방지에도 필요 |
| 게스트 수 | Free 10명 | 팀 규모 = 지불 능력의 프록시 |
| private teamspace / SSO / audit log | Business·Enterprise | 조직 구매 결정권자가 원하는 항목. B2B 전환의 실제 트리거 |
| 조건부 로직, Dashboard view, verification | Business 이상 | "고급 사용자만 쓰는 기능"을 상위 티어에 두는 전형 |
| AI 사용량 | 크레딧 | 변동 원가라 사용량 과금이 유일하게 합리적 |

### 2) 이 문서 기준 우선순위 재정렬 (기존 12개 문서와 합쳐 볼 때)

| 단계 | 이 문서에서 포함할 것 | 근거 |
|---|---|---|
| **MVP (P0)** | F-13-17(임베드 위젯), F-13-18(엔타이틀먼트 골격) | 비용 최소, 나중에 넣기 가장 어려운 것 |
| **v1 (P1)** | F-13-01·02(Forms), F-13-08(Sites 기본), F-13-10(Chart), F-13-12(Wiki/Owner), F-13-16(커스텀 이모지), F-13-05(멀티 DB 캘린더) | 전부 기존 DB/페이지 인프라 위에 얹히는 기능. 한계비용이 낮고 체감이 크다 |
| **v2 (P2)** | F-13-09(커스텀 도메인), F-13-03(조건부 로직), F-13-11(Dashboard), F-13-13(verification), F-13-14·15(에이전트) | 수익화 또는 조직 고객 대응 시점에 |
| **만들지 말 것** | F-13-07(Mail), F-13-04(독립 캘린더 앱), F-13-06(예약 링크) | Mail은 원본이 종료, 나머지 둘은 성숙한 대체재(Google Calendar, Cal.com)가 압도적 |

### 3) 이 문서가 드러낸 아키텍처 요구사항 (기존 12개 문서에 없던 것)

| 요구사항 | 영향 받는 기능 | 왜 지금 결정해야 하나 |
|---|---|---|
| **공개(무인증) 읽기 렌더러**를 앱 렌더러와 분리 | F-13-08 Sites, F-13-02 Forms | 나중에 분리하려면 렌더 계층을 다시 쓴다 |
| **anonymous writer / agent** principal 타입 추가 | F-13-02, F-13-15 | 권한 모델의 grantee 타입 확장은 소급이 매우 비싸다 |
| **엔타이틀먼트 4축**을 데이터로 관리 | F-13-18 전체 | 코드에 박으면 플랜 개편이 불가능해진다 |
| **서버 집계(GROUP BY) 쿼리 생성기** | F-13-10 Chart, F-13-11 Dashboard | 클라이언트 집계로 시작하면 대용량에서 전면 재작성 |
| **soft delete 강제 대상**: 커스텀 이모지 | F-13-16 | rich text annotation에 id가 박혀 역참조가 불가능하다 |
| **에이전트 변경의 단일 undo 단위 + 감사 기록** | F-13-14, F-13-15 | 되돌릴 수 없는 AI는 조직에 배포 불가 |
| **부가 제품의 EOL(종료) 설계** | 전 주변 제품군 | Notion Mail이 실제로 보여준 시나리오. 데이터 내보내기 경로를 처음부터 |

---

## 검증되지 않은 항목 목록 (재조사 대상)

| # | 항목 | 태그 | 확인 방법 |
|---|---|---|---|
| 1 | Forms의 전체 질문 타입 목록과 프로퍼티 매핑 | `[확인필요]` | 실제 폼 편집기에서 질문 추가 메뉴 전수 캡처 |
| 2 | 공개 폼에서 파일 업로드 허용 여부·용량 | `[확인필요]` | 실제 폼에 files 프로퍼티 질문 추가 시도 |
| 3 | 폼 조건부 로직의 정확한 규칙 문법·연산자 | `[확인필요]` | Business 플랜 워크스페이스에서 확인 |
| 4 | 차트 개수 제한이 Plus에도 적용되는지 | `[확인필요]` | 요금 비교표 원문 재확인 |
| 5 | 차트의 날짜 축 버킷팅(일/주/월) 옵션 유무 | `[확인필요]` | 실제 차트 뷰 설정 메뉴 |
| 6 | Undo wiki 시 Owner/Verification 값 보존 여부 | `[확인필요]` | 실제 전환/해제 테스트 |
| 7 | 검증된 페이지 내용 수정 시 검증 자동 해제 여부 | `[확인필요]` | Business 워크스페이스 테스트 |
| 8 | 커스텀 이모지의 파일 크기·포맷 제한, 이름 유일성 | `[확인필요]` | 업로드 다이얼로그 실측 |
| 9 | 커스텀 이모지가 든 페이지를 타 워크스페이스로 복사할 때의 동작 | `[확인필요]` | 실제 복사 테스트 |
| 10 | Notion Sites의 하위 페이지 개별 발행 제외 옵션 | `[확인필요]` | Share → Publish 패널 |
| 11 | 커스텀 도메인의 SSL 인증서 발급 방식 | `[확인필요]` | 발급된 인증서의 발급자 확인 |
| 12 | Notion Calendar Android 정식 출시 시점 / Windows 메뉴바 동등 기능 | `[확인필요]` | 스토어 및 릴리스 노트 |
| 13 | Custom Agents 크레딧 단가(1,000 크레딧당 $10?) | `[확인필요]` | 결제 화면 |
| 14 | USD 기준 Plus/Business 정확한 단가 | `[확인필요]` | 결제 화면(지역 통화 우회) |
| 15 | 다운그레이드 시 한도 초과 자산 처리 정책 | `[추정]` | 실제 강등 테스트 또는 고객지원 문의 |

---

## 참고 출처 전체 목록

**1차 출처 (Notion 공식)**

1. https://www.notion.com/help/forms — Forms 생성·질문·공유·조건부 로직·권한
2. https://www.notion.com/help/public-pages-and-web-publishing — Sites 발행·slug·SEO·템플릿 복제·Enterprise 차단
3. https://www.notion.com/help/notion-sites-availability-and-pricing — 플랜별 Sites 기능·도메인 개수
4. https://www.notion.com/help/connect-a-custom-domain-with-notion-sites — CNAME(`external.notion.site.`)·TXT·Cloudflare 프록시·25개 한도·$10/$8 애드온
5. https://www.notion.com/help/charts — 차트 5종·축·집계·200 그룹/50 서브그룹·미지원 프로퍼티
6. https://www.notion.com/help/dashboards — 위젯 12개/행당 4개·Edit/View 모드·global filter·Business+
7. https://www.notion.com/help/wikis-and-verified-pages — wiki 전환·기본 3뷰·owner·verification·Business+
8. https://www.notion.com/help/guides/verify-knowledge-your-teammates-can-trust-with-page-verification — 검증 만료·재검증 가이드
9. https://www.notion.com/help/category/notion-calendar — Notion Calendar 헬프 인덱스
10. https://www.notion.com/help/use-notion-calendar-with-notion — DB 연동·20개 한도·읽기전용 date·권한
11. https://www.notion.com/help/availability-blocking-and-time-zones — 예약 링크·가용시간·재조정/취소
12. https://www.notion.com/help/get-started-with-notion-mail — Mail 지원 제공자·플랫폼·동기화 제약·**종료 공지**
13. https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next — Mail 종료 절차
14. https://www.notion.com/help/notion-agent — 개인 Agent 능력·권한·한계·플랜
15. https://www.notion.com/help/workspace-settings — 커스텀 이모지 관리·소유자 제한 토글
16. https://www.notion.com/help/embed-and-connect-other-apps — 임베드/북마크/멘션 3분기·Iframely 1,900+ 도메인
17. https://www.notion.com/pricing — 플랜별 가격·한도(지역 통화)
18. https://www.notion.com/releases — 릴리스 타임라인(2026년 에이전트 중심)
19. https://www.notion.com/releases/2026-02-24 — Notion 3.3 Custom Agents
20. https://www.notion.com/releases/2025-09-18 — Notion 3.0 Agents
21. https://www.notion.com/blog/introducing-notion-3-0 — 에이전트 설계 배경
22. https://www.notion.com/blog/how-we-built-custom-emoji — **커스텀 이모지 구현 세부**(annotation 표현, 500개 한도, 가상화, 프리페치)
23. https://www.notion.com/blog/building-shared-memory-for-ai-agents-in-notion — 에이전트 메모리 아키텍처
24. https://developers.notion.com/reference/emoji-and-icon — API 아이콘/커스텀 이모지 JSON 계약
25. https://www.notion.com/product/calendar — Notion Calendar 제품 페이지

**2차 출처 (교차 검증용, 사실 확정에는 사용하지 않음)**

26. https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/ — Mail 종료 배경
27. https://www.theregister.com/ai-and-ml/2026/06/26/notion-kills-its-gmail-client-after-ai-agents-keep-humans-from-troubling-inbox/5263024 — 동일 사안 교차 확인
28. https://helpcenter.indify.co/notion-widget-embeds — 서드파티 위젯 임베드 절차(대표 사업자)
29. https://www.engadget.com/ai/notion-mail-is-a-powerful-but-lightweight-email-client-for-busy-people-150007543.html — Mail 출시 시점 기능
30. https://www.testingcatalog.com/notion-introduced-wiki-pages-with-granular-ownership-and-expirable-verification-badges/ — wiki/verification 최초 도입 맥락

---

> **문서 유지보수 지침**: 이 문서의 주변 제품군은 6개월 내 변경 가능성이 높다. 재조사 시 **① notion.com/releases 최신 3개월 ② 요금 페이지 ③ 각 제품의 help 카테고리 인덱스** 순으로 확인하고, 위 "검증되지 않은 항목 목록"의 15개를 먼저 해소하라.
