# Meta Ads Manager Automation (Playwright + Node.js)

기존 Chrome(CDP attach) 세션을 재사용해서 캠페인 진입 후 광고 세트를 여러 개 자동 생성합니다.

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
- 캠페인 진입
- `ADSET_COUNT` 만큼 반복 생성
- `ADSET_CREATIVE_COUNT` 값만큼 새 판매 광고 복제
- `ADSET_COUNT` 값만큼 광고세트 복제
- 각 반복에서 광고 세트 이름 자동 입력
- `ADSET_DAILY_BUDGET` 설정 시 예산 입력 시도
- `보기 만들기` 패널 감지 시 닫기
- 게시는 자동 클릭하지 않고 마지막 `page.pause()`에서 멈춤
