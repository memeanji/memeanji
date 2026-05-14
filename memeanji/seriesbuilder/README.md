# Meta Ads Manager Automation (Playwright + Node.js)

Meta Ads Manager에서 로그인 세션을 저장하고, 특정 광고계정의 캠페인 내부에서 광고세트 생성 화면까지 자동 진입/입력하는 프로젝트입니다.

## 1) 설치

```bash
npm install
```

## 2) 환경변수 설정

`.env.example`를 복사해 `.env`를 만든 뒤 값을 입력합니다.

```bash
cp .env.example .env
```

- `AD_ACCOUNT_ID`: `act_` 제외한 광고 계정 ID
- `CAMPAIGN_NAME`: 정확히 일치시킬 캠페인 이름
- `ADSET_INDEX`: 광고세트 번호 (이름 생성에 사용)

## 3) 로그인 세션 저장

```bash
npm run login
```

동작:
1. Facebook 로그인 페이지 접속
2. 수동 로그인
3. Ads Manager 캠페인 화면 로딩 확인
4. `auth/meta-session.json` 저장

## 4) 캠페인 열기 + 광고세트 이름 자동 입력

```bash
npm run open-campaign
```

동작:
1. 저장된 세션(`auth/meta-session.json`) 재사용
2. Ads Manager 접속
3. `act={AD_ACCOUNT_ID}` 계정으로 이동
4. `CAMPAIGN_NAME`과 exact match 되는 캠페인 검색 후 진입
5. `만들기` 클릭
6. 광고세트 생성 플로우 진입
7. 광고세트 이름 자동 입력
   - 형식: `MMDD 리타겟 {번호}번 광고세트`
   - 예시: `0513 리타겟 1번 광고세트`
8. `page.pause()`로 멈춤 (최종 검수 후 사용자가 직접 게시)

## 스크린샷

단계별로 `screenshots/`에 저장됩니다.

- `01-login-page.png`
- `02-after-login.png`
- `03-adsmanager-home.png`
- `04-account-entered.png`
- `05-campaign-found.png`
- `06-campaign-opened.png`
- `07-create-button-clicked.png`
- `08-adset-flow-opened.png`
- `09-adset-name-filled.png`

에러 발생 시:
- `screenshots/error.png`

## 구현 포인트

- Playwright Chromium + `headless: false`
- `dotenv`로 환경변수 로드
- `storageState` 기반 세션 저장/재사용
- console.log 단계별 출력
- 실패 시 retry 1회
- 안정적인 locator 우선 사용:
  - `getByText`
  - `getByRole`
  - `getByPlaceholder`
  - `locator().filter()`
- 변동성 큰 클래스 셀렉터 / xpath 남발 지양
