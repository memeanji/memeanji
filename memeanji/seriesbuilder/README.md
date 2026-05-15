# Meta Ads Manager Automation (Playwright + Node.js)

이 프로젝트는 **새 브라우저를 생성하지 않고**, 사용자가 이미 로그인해 둔 일반 Chrome에 CDP로 attach해서 동작합니다.

## 1) 설치

```bash
npm install
```

## 2) 일반 Chrome 실행 (필수)

Windows:

```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug"
```

그 Chrome 창에서 Meta Ads Manager 로그인 상태를 먼저 만들어 주세요.

## 3) 환경변수 설정

```bash
cp .env.example .env
```

- `AD_ACCOUNT_ID`
- `CAMPAIGN_NAME`
- `ADSET_INDEX`
- `CDP_URL` (기본값 `http://127.0.0.1:9222`)
- `MEDIA_FOLDER_PATH` (선택)

## 4) login 스크립트

`npm run login`은 로그인 자동화를 수행하지 않습니다.
Chrome를 어떻게 실행하고 어떤 순서로 진행할지 안내만 출력합니다.

## 5) 캠페인 자동화 실행

```bash
npm run open-campaign
```

동작:
1. `chromium.connectOverCDP(CDP_URL)`로 기존 Chrome에 attach
2. 기존 탭(context/pages) 재사용
3. Ads Manager 이동
4. 계정/캠페인 진입 후 광고세트 이름 입력
5. 필요시 미디어 폴더 파일 선택
6. `page.pause()`에서 최종 검수

## 정책 준수

- Google/Facebook OAuth 자동 입력 없음
- stealth plugin / webdriver 우회 없음
- 기존 사용자 로그인 세션 재사용만 사용
