# 13. 주변 제품군 & 최신 기능 — 다이제스트

> 원본 `13-adjacent-products.md`(1361줄, 2026-09-06) / 범위: 앱 **바깥** 표면(Forms·Calendar·Mail·Sites·Charts·Wiki·Agents·Emoji·Embed·Plans). 01~12와 겹치면 "제품/과금/외부 표면" 관점만 담당. **변동 최다 도메인 — 6개월 내 재검증.**

## 1. 기능 인벤토리 (전수 18개 = 원본 `### F-` 헤더 18개)

| F-ID | 기능명 | 난이도 | 우선 | 의존 |
|---|---|---|---|---|
| F-13-01 | Forms — 폼 생성 & 질문↔프로퍼티 1:1 바인딩 | L | P1 | F-03-02, F-04-01/18, F-06-07, F-02-18, F-09-08 |
| F-13-02 | Forms — 공개 제출 파이프라인(익명·사후권한·확인화면·알림) | L | P1 | F-13-01, F-06-01/11, F-11-08, F-08-09 |
| F-13-03 | Forms — 조건부 로직(question branching) | M | P2 | F-13-01/18, F-03-04 |
| F-13-04 | Notion Calendar — 독립 앱 + 외부 계정(Google/Outlook/iCloud) | XL | P2 | 외부 OAuth, F-13-05, F-10-11 |
| F-13-05 | Calendar ↔ Notion DB 양방향 연동 | L | P1 | F-03-06, F-04-06, F-06-01, F-05-16 |
| F-13-06 | Scheduling links / availability(예약 링크) | L | P2 | F-13-04, 무인증 공개페이지, 메일발송 |
| F-13-07 | Notion Mail — 뷰 기반 인박스 **(2026-09-22 종료)** | XL | P2(비권장) | Gmail API, F-10-xx, F-13-06, F-01-04 |
| F-13-08 | Notion Sites — 페이지 웹 퍼블리싱 제품화 | L | P1 | F-02-16/18, F-06-08/11, F-13-09 |
| F-13-09 | Sites — 커스텀 도메인·DNS 검증·SEO·Analytics | L | P2 | F-13-08/18, CDN·ACME 인프라 |
| F-13-10 | Chart view — 차트 엔진(축·집계·그룹) | L | P1 | F-04-01/09~11/16, F-03-17 |
| F-13-11 | Dashboard view — 위젯 컨테이너 + global filter | L | P2 | F-13-10/18, F-04-01/09/13 |
| F-13-12 | Wiki 전환 & Owner 프로퍼티 | M | P1 | F-02-02, F-03-01/07, F-13-13 |
| F-13-13 | 페이지 verification(배지·만료·재검증) | M | P2(AI 있으면 P1) | F-13-12/18, F-11-08, F-07-02, F-10-06 |
| F-13-14 | Notion Agent — 개인 대화형 에이전트 | XL | P2 | F-10-06/08/09/18/20, F-06-01 |
| F-13-15 | Custom Agents — 트리거 기반 자율 에이전트(3.3) | XL | P2 | F-13-14/18, F-08-09/10, F-06-18, F-11-12 |
| F-13-16 | 커스텀 이모지(워크스페이스 이모지 라이브러리) | M | P1 | F-01-03, F-02-05, F-05-08, F-12-09, F-09-01 |
| F-13-17 | 서드파티 위젯 임베드(iframe embed 계약) | S | **P0** | F-01-12/15, F-09-10/11 |
| F-13-18 | 요금제 엔타이틀먼트 엔진(Free/Plus/Business/Enterprise) | L | **P0** | 전 도메인, F-06-11, F-11-03, F-10-12 |

## 2. 데이터 모델 — 정본 스키마에 대한 요구사항

> 새 스키마 창작 금지. `00-canonical-data-model.md`가 수용해야 할 요구만.

| # | 요구 | 형태 | F |
|---|---|---|---|
| R1 | view 서브타입 3종 확장(form/chart/dashboard) — 설정을 view 레코드에 부착 | view 상속 | 01,10,11 |
| R2 | **폼 응답 본체 별도 테이블 금지** — 응답 = DB page(row) 자체. 그래야 뷰·필터·자동화·차트가 공짜 | `form_submission`은 감사/중복방지 메타만 | 01 |
| R3 | 질문은 프로퍼티와 분리 저장 | `form_question(property_id NULL 허용, label, required, input_type, sync_with_property)` | 01,03 |
| R4 | **principal 타입 2종 추가**: `anonymous_form_writer`, `agent` | 권한 grantee + 감사로그 actor. **소급 비용 최대** | 02,15 |
| R5 | 공개 slug를 내부 id와 분리, revoke 가능 | `public_link_token(slug, revoked_at)` | 02,08 |
| R6 | 캘린더 연결은 **user 단위 개인 설정**, DB 행의 이벤트 **복제 저장 금지** | `calendar_database_link(user_id, data_source_id, date_property_id, filter)` | 05 |
| R7 | 외부 캘린더 미러: 증분 토큰 + 반복/예외 | `calendar_account.sync_token`, `calendar_event.rrule/recurring_event_id/original_start_at` | 04 |
| R8 | 슬롯에 **낙관적 잠금 필수** | `scheduling_availability_slot(state, version)` | 06 |
| R9 | 발행 트리 매핑 + 도메인 검증 상태머신 | `site` / `site_page(UNIQUE(site_id,path), is_excluded)` / `site_domain(cname_ok, txt_ok, ssl_state)` | 08,09 |
| R10 | 차트 집계 설정 + 숨긴 그룹 | `chart_view(x_bucket, y_source, y_aggregation, group_by, stacking, cumulative)`, `chart_hidden_group` | 10 |
| R11 | global filter는 property_id 아닌 **(이름,타입) 쌍**으로 크로스 DB 매칭 | `dashboard_global_filter(property_name, property_type)` | 11 |
| R12 | wiki는 새 엔티티 아님 = `page.is_wiki` + 자동생성 data_source 합성 | `wiki(page_id, data_source_id, owner/tags/verification property_id)` | 12 |
| R13 | 검증 상태 + 만료 스캔 + 검색 인덱스 `is_verified` 부스트 필드 | `page_verification(expires_at NULL=무기한, state)` | 13 |
| R14 | **모든 에이전트 쓰기를 before/after 스냅샷과 함께 기록·되돌리기** | `agent_action(status)` ← `agent_run`으로 묶음 | 14,15 |
| R15 | 이모지는 rich text **annotation 내 id 참조**(역인덱스 없음) → **soft delete 강제** | `custom_emoji(deleted_at)`, annotation = `[문자, [["ce", emoji_id, workspace_id]]]` (@멘션과 동일 구조) | 16 |
| R16 | embed 보안정책을 코드 아닌 **레지스트리 데이터**로 | `embed_provider_registry(domain_pattern, url_transform, allow_iframe, sandbox_flags)` | 17 |
| R17 | **엔타이틀먼트는 데이터** | `plan_entitlement(key, kind∈{boolean,limit,duration,credit}, value)` + `subscription` + `subscription_addon` + `usage_counter` + `credit_ledger`(이벤트 소싱) | 18 |

## 3. MVP 판단

**P0 (없으면 성립 안 함)**
- **F-13-17 임베드** — S(1~2일)인데 "클론에 없는 모든 기능"을 사용자가 스스로 채우게 해줌. 노션조차 자체 위젯 시스템이 없고 iframe + Iframely 위임뿐.
- **F-13-18 엔타이틀먼트 골격** — 나중에 넣기 가장 어려움. 게이트가 전 코드베이스에 흩어져 소급 삽입 시 반드시 구멍.

**v1(P1)**: F-13-01·02(Forms), 08(Sites 기본), 10(Chart), 12(Wiki/Owner), 16(이모지), 05(멀티 DB 캘린더 뷰) — 전부 기존 DB/페이지 인프라 위에 얹혀 한계비용이 낮고 체감이 큼.

**빼는 것 / 대체안**

| 제외 | 이유 | 대체 |
|---|---|---|
| 07 Mail | **원본이 종료**("에이전트가 인박스를 대체") | 인바운드 이메일 주소 → 페이지/DB 행 생성만. 1/50 비용 |
| 04 독립 캘린더 앱 | 3제공자 동기화가 XL, 클론 차별점 아님 | 앱 내 캘린더 뷰 + **읽기전용 ICS 오버레이**. XL→M |
| 06 예약 링크 | 성숙 대체재 | **Cal.com 임베드**. 굳이 만들면 one-off만(경합 소멸) |
| 11 Dashboard | 원본도 Business+ | 페이지 + column layout + linked view로 80% 대체 |
| 03 조건부 로직 | 원본도 Business+ 유료가치 | `jump_to` 제거, show/hide만 → 사이클 소멸, S~M |
| 09 커스텀 도메인 | 인프라가 본체 | Cloudflare for SaaS/Vercel Domains에 위임. L→M |
| 14/15 에이전트 | 클론 정체성은 에디터/DB | 툴 3~5개 어시스턴트 + "제안→승인" 고정 / **automation에 AI 스텝 1개 추가**로 대체. XL→M |

## 4. 기술 난제 & 권장 접근 (L·XL 전량)

| F | 난점 | 접근 | 참고 |
|---|---|---|---|
| 01·02 Forms L | **무인증 쓰기가 권한 레이어를 우회.** 편집기+공개 엔드포인트+양방향 동기화 3개 독립 작업 | v1은 `public+강제익명+post_submit_access=none` 하나만, 질문 7종(text/long/number/select/multi/date/email). required·logic **서버 재평가**(클라만이면 API 직접호출로 우회), IP rate limit+캡차. 프로퍼티 삭제 시 기존 응답값 소실 → 확인 모달 | — |
| 04 Calendar XL | 증분 동기화 + **반복 예외(RRULE/EXDATE)만 1~2주** + 초대응답 + 타임존 | ICS 읽기전용 오버레이로 회피 | ical.js, rrule.js |
| 05 Cal↔DB L | 타임존 하루밀림, 필터-드래그 상호작용(드래그 결과가 필터에서 빠지면 사라짐→되돌리기 토스트), 권한 실시간 반영 | UTC 저장·표시 변환. `WHERE date_prop BETWEEN ?` 쿼리(복제 금지). formula/created time date는 읽기전용. 남은 작업은 "멀티소스 겹쳐보기"뿐 | FullCalendar |
| 06 Scheduling L | **동시 예약 경합**이 최대 난제, DST 경계 슬롯 계산 | 슬롯 락/낙관적 잠금 + 재선택 유도 | Cal.com |
| 07 Mail XL | Gmail history 증분/백필/충돌, HTML 새니타이즈, 발송 신뢰성, 스레딩 | 만들지 말 것. 교훈: 노션은 라벨을 id 아닌 **이름으로 캐시**해 리네임 미반영 결함 `[추정]` → 클론은 id 참조 | — |
| 08 Sites L | 앱 렌더러(권한검사+실시간구독+편집기)를 공개에 쓰면 성능·보안 붕괴. **하위 트리 자동 동반 발행이 유출 사고 1위** | **읽기전용 SSR 렌더러 분리 + CDN + page_id 태그 무효화.** 발행 전 트리 미리보기·개별 제외, 권한 변경 시 발행상태 재평가, 발행취소는 404+`noindex` | Next.js ISR |
| 09 도메인 L | 와일드카드 라우팅·SNI·온디맨드 인증서·캐시키 = 인프라가 비용 대부분. **Cloudflare 프록시 ON이 검증 실패 1위**, apex 미지원 | 위임. DNS 재검증 크론 + 인증서 자동갱신 없으면 반드시 사고 | Cloudflare for SaaS, Caddy on-demand ACME |
| 10 Chart L | **프로퍼티 타입 × 집계함수 조합 매트릭스**, 서버 집계 쿼리 생성기. **권한 필터를 집계 이전에** 적용 안 하면 합계로 정보 유출 | 서버 `GROUP BY … LIMIT 200`. v1은 bar_v/line/donut, X=select/status/date, Y=count/sum → M. rollup·button·unique ID·files·리스트 formula는 축 불가 | Recharts, ECharts |
| 11 Dashboard L | 그리드 편집기 + 크로스소스 매칭 + 1회 로드 12중 병렬 쿼리 | 위젯=linked view 배치판(새 저장구조 금지). 미적용 위젯 힌트, 모바일 세로 스택 | react-grid-layout |
| 14 Agent XL | 오케스트레이션+툴+권한필터+되돌리기+승인 UI(하나만 빠져도 실사용 불가). 프롬프트 인젝션 → **읽은 콘텐츠는 데이터이지 지시가 아님**을 시스템 레벨 강제 | 변경분을 **하나의 undo 단위**로. 좁은 툴셋 + suggest edits 고정 | MCP, LangGraph |
| 15 Custom Agents XL | 사실상 서버리스 워크플로 플랫폼. **무한 루프**(A출력→B트리거→A), 스케줄 폭주, 크레딧 소진 시 조용한 실패, 생성자 퇴사 시 고아 | 실행 깊이 제한 + 동일소스 재트리거 차단 + WS별 동시실행 상한 + 소유권 이전 | Temporal, Inngest |
| 18 엔타이틀먼트 L | **4축의 강제 지점이 전부 다름** — ①기능 온오프=UI+API ②개수한도=생성 트랜잭션 ③기간=조회쿼리+GC잡 ④크레딧=실행 런타임. **단일 `hasFeature()` 통합 시도는 실패** | 결제는 Stripe 위임, 엔타이틀먼트만 자체 테이블. `entitlement(ws,key)` 단일 조회+짧은 TTL. **모든 한도 검사는 서버 생성 트랜잭션 안에서.** v1은 축①② | Stripe Billing, OpenFGA |

**노션 실측 한도**: 차트 그룹 200/서브그룹 50 · 위젯 12(행당 4) · 이모지 500 · 캘린더 연결 DB 20 · 커스텀 도메인 25($10/월, 연 $8) · notion.site 도메인 Free 1/유료 5 · slug 60자 · Free 파일 5MB · 히스토리 7/30/90/무제한 · Free 게스트 10 · Iframely 1,900+ 도메인

**유료 게이팅으로 그대로 복제 가능(원본이 검증한 지불 의사)**: 커스텀 도메인(별도 SKU, 인프라 원가 실재) · 히스토리 기간 · 파일 용량 · 게스트 수 · private teamspace/SSO/audit log(B2B 전환 트리거) · 조건부 로직/Dashboard/verification · AI 크레딧(변동 원가)

## 5. 다른 도메인과의 접점

- **04 DB 뷰**: form/chart/dashboard를 view 상속으로 — F-04-18/08/20이 여기서 실체화. 서버 GROUP BY 생성기 + 권한 필터 선(先)적용.
- **06 권한**: grantee 타입에 anonymous writer / agent 추가(**소급 매우 비쌈**).
- **02 페이지**: 앱 렌더러와 분리된 무인증 읽기 SSR 경로(Sites·Forms 공용).
- **08 automation**: Custom Agents가 트리거·큐·감사 재사용, 루프 방지(F-08-10) 동일 문제.
- **10 AI / 07 검색**: 권한인지 인덱스·스트리밍·MCP·승인 게이트. `is_verified`가 검색 랭킹 부스트 겸 AI 답변 신호.
- **01 블록**: 이모지 annotation(= @멘션 구조). **11 히스토리/감사**: 보존기간 = 플랜 축③, 감사 actor에 agent. **09·12 파일**: 폼 무인증 업로드(남용 벡터), 이모지 공개 CDN 경로.
- **전 도메인**: 엔타이틀먼트 4축이 모든 생성 트랜잭션에 침투.

**01~12에 없던 신규 아키텍처 요구 7가지**: ①공개 무인증 렌더러 분리(나중이면 렌더 계층 재작성) ②principal 타입 확장 ③엔타이틀먼트 4축을 데이터로 ④서버 집계 생성기(클라 집계로 시작 시 전면 재작성) ⑤이모지 soft delete 강제 ⑥에이전트 변경의 단일 undo 단위+감사 ⑦**부가 제품 EOL 설계**(Mail이 실증, 내보내기 경로를 처음부터)

## 6. 최우선 미해결 질문

| # | 질문 | 왜 중요 |
|---|---|---|
| 1 | 다운그레이드 시 한도 초과 자산 처리 `[추정: 기존 유지+신규 차단]` | P0 엔타이틀먼트의 핵심 분기. 히스토리 축소 시 즉시 삭제는 데이터 손실 클레임 원인 |
| 2 | Sites 하위 페이지 **개별 발행 제외** 옵션 유무 `[확인필요]` | 자동 동반 발행이 유출 사고 1위. 없으면 클론이 자체 설계 |
| 3 | Forms 질문 타입 전수·프로퍼티 매핑, 공개 폼 파일 업로드 허용/용량 `[확인필요]` | F-13-01 범위 확정 불가. 무인증 업로드는 스토리지 남용 벡터 |
| 4 | 차트 개수 제한이 Plus에도 적용되는지 + 날짜 축 버킷팅(일/주/월/분기/연) 유무 `[확인필요]` | 자료 상충. 게이팅 티어 + 차트 엔진 범위 직결 |
| 5 | verification 자동 해제·owner 승계 여부, Undo wiki 시 값 보존 여부 `[확인필요]` | 상태 머신 정의 불가. 소실이면 경고 모달 필수 |

> 잔여 미검증 10건(이모지 파일 제한·타 WS 복사, SSL 발급 방식, Calendar Android/Windows, Agent 크레딧 단가, USD 단가, 조건부 로직 문법 등)은 원본 "검증되지 않은 항목 목록" 참조.

**출처(원본 30건 중 1차)**: notion.com/help — forms, public-pages-and-web-publishing, notion-sites-availability-and-pricing, connect-a-custom-domain-with-notion-sites, charts, dashboards, wikis-and-verified-pages, use-notion-calendar-with-notion, availability-blocking-and-time-zones, notion-mail-inbox-is-going-away, notion-agent, workspace-settings, embed-and-connect-other-apps / notion.com/pricing / releases 2025-09-18·2026-02-24 / blog/how-we-built-custom-emoji / developers.notion.com/reference emoji-and-icon·block / techcrunch 2026-06-25(Mail 종료)
