# Meta Ads Manager Automation (Playwright + Node.js)

Meta Ads Manager에서 로그인 세션을 저장하고, 특정 광고계정의 캠페인 내부에서 광고세트 생성 화면까지 자동 진입/입력하는 프로젝트입니다.

> 인증 우회가 아니라, **사용자가 정상 로그인한 Chrome 프로필 세션을 재사용**하는 방식입니다.

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
- `CHROME_USER_DATA_DIR`: Chrome 사용자 데이터 루트 경로
- `CHROME_PROFILE_DIR`: 사용할 프로필 디렉터리명 (`Default`, `Profile 1` 등)
- `MEDIA_FOLDER_PATH` (선택): 광고 소재 파일이 있는 폴더 경로 (폴더 직접 지정 업로드)

## 3) Windows에서 Chrome 프로필 경로 확인

1. Chrome 주소창에 `chrome://version` 입력
2. `프로필 경로(Profile Path)` 항목 확인
3. 예시
   - Profile Path: `C:\Users\MYUSER\AppData\Local\Google\Chrome\User Data\Profile 1`
   - 이 경우
     - `CHROME_USER_DATA_DIR=C:\Users\MYUSER\AppData\Local\Google\Chrome\User Data`
     - `CHROME_PROFILE_DIR=Profile 1`

## 4) 로그인 세션 저장

```bash
npm run login
```

동작:
1. `launchPersistentContext`로 기존 Chrome 사용자 프로필 실행
2. Ads Manager 페이지 오픈 (로그인 폼 자동 입력 없음)
3. 사용자가 직접 로그인 상태를 확인
4. Enter 입력 시 `auth/meta-session.json` 저장

## 5) 캠페인 열기 + 광고세트 이름 자동 입력

```bash
npm run open-campaign
```

동작:
1. `launchPersistentContext`로 동일 Chrome 프로필 재사용
2. 저장된 세션(`auth/meta-session.json`) 재사용
3. Ads Manager 접속 후 로그인 화면 감지 시 자동진행 중단 및 안내 메시지 출력
4. `act={AD_ACCOUNT_ID}` 계정으로 이동
5. `CAMPAIGN_NAME`과 exact match 되는 캠페인 검색 후 진입
6. `만들기` 클릭
7. 광고세트 생성 플로우 진입
8. 광고세트 이름 자동 입력
   - 형식: `MMDD 리타겟 {번호}번 광고세트`
   - 예시: `0513 리타겟 1번 광고세트`
9. (선택) `MEDIA_FOLDER_PATH`가 설정되어 있으면 해당 폴더의 파일을 자동 선택
10. `page.pause()`로 멈춤 (최종 검수 후 사용자가 직접 게시)

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
- `10-media-selected.png` (MEDIA_FOLDER_PATH 설정 시)

에러 발생 시:
- `screenshots/error.png`

## 구현 포인트

- Playwright Chromium (`channel: chrome`) + `headless: false`
- `launchPersistentContext` 기반 Chrome 프로필 재사용
- `storageState` 기반 세션 저장/재사용 구조 유지
- console.log 단계별 출력
- 실패 시 retry 1회
- 안정적인 locator 우선 사용:
  - `getByText`
  - `getByRole`
  - `getByPlaceholder`
  - `locator().filter()`
- 변동성 큰 클래스 셀렉터 / xpath 남발 지양


## 보안/정책 준수

- Google OAuth / Facebook 로그인 폼 자동 입력은 수행하지 않습니다.
- 자동화 탐지 우회(stealth plugin, user-agent 위조, `navigator.webdriver` 수정 등)를 사용하지 않습니다.
- 사용자가 일반 Chrome에서 정상 로그인한 세션 재사용 방식만 사용합니다.
