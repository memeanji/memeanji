# meta 자동화 시즌 2

기존 Chrome(CDP attach) 세션을 재사용해서 Meta Ads Manager 캠페인 진입 후 광고 세트를 여러 개 자동 생성하는 Playwright + Node.js 자동화 프로젝트입니다.

## 저장 위치

- GitHub 저장소: `memeanji/memeanji`
- 프로젝트 경로: `memeanji/seriesbuilder`
- 시즌2 작업 브랜치: `meta-automation-season-2`

## 환경변수

- `AD_ACCOUNT_ID`
- `CAMPAIGN_NAME`
- `ADSET_BASE_NAME` (기본: 리타겟)
- `ADSET_START_INDEX` (기본: 1)
- `ADSET_COUNT` (기본: 1)
- `ADSET_CREATIVE_COUNT` (기본: 5, 또는 `AD_CREATIVE_COUNT`/`ADVERTISE_COUNT`)
- `ADSET_DAILY_BUDGET` (선택)
- `CDP_URL` (기본: `http://127.0.0.1:9222`)
- `SCHEDULE_TIME` (기본: `05:00`)
- `MEDIA_FOLDER_PATH` (선택)

## 광고 세트명 규칙

`MMDD {ADSET_BASE_NAME} {번호}번 광고세트`

예: `0515 리타겟 1번 광고세트`

## 실행

1. 일반 Chrome을 remote debugging으로 실행
2. Meta Ads Manager 로그인 상태 유지
3. `npm run open-campaign`

## 동작

- 초기 광고세트 1개 생성 후 복제 단계로 확장
- 캠페인 진입
- `ADSET_COUNT` 만큼 반복 생성
- `ADSET_CREATIVE_COUNT` 값만큼 새 판매 광고 복제 (첫 번째 복제 단계)
- `ADSET_COUNT` 값만큼 광고세트 복제 (두 번째 복제 단계)
- 각 반복에서 광고 세트 이름 자동 입력
- 일 예산(`ADSET_DAILY_BUDGET`) 입력 후 스케줄링 진행
- `ADSET_DAILY_BUDGET` 설정 시 예산 입력 시도
- `보기 만들기` 패널 감지 시 닫기
- 게시는 자동 클릭하지 않고 마지막 `page.pause()`에서 멈춤

## 빠른 크리에이티브 단계 테스트

- `QUICK_TEST_CREATIVE_STEP=true`로 설정하면 전체 플로우 없이 크리에이티브 설정/랜딩URL/업로드 단계만 실행합니다.
- `QUICK_TEST_AD_NAME`으로 미디어 검색용 광고소재명을 지정할 수 있습니다.

## 시즌2 고도화 방향

- 크리에이티브 설정 버튼을 먼저 대기하고 확인된 뒤 클릭
- `이미지 광고` 옵션을 단계별로 대기, 확인, 클릭
- `span[data-surface-wrapper="1"]` 진입 여부 검증
- 실패 시 디버그 로그와 스크린샷을 남겨 원인 추적
- Meta UI 클래스 변경에 대비한 fallback selector 정리
