# Meta Ads Manager Automation (Playwright + Node.js)

Meta Ads Manager에서 로그인 세션을 저장하고, 특정 광고계정의 캠페인 내부에서 광고세트 생성 화면까지 자동 진입/입력하는 프로젝트입니다.

> 인증 우회가 아니라, **사용자가 직접 로그인한 정상 세션을 재사용**하는 방식입니다.

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
- `PLAYWRIGHT_USER_DATA_DIR`: Playwright 전용 사용자 데이터 경로 (`pw-profile` 권장)
- `MEDIA_FOLDER_PATH` (선택): 광고 소재 파일이 있는 폴더 경로

## 3) Playwright 전용 프로필 경로 설정

- 기존 Chrome User Data (`AppData\Local\Google\Chrome\User Data`)를 직접 사용하지 마세요.
- 별도 폴더를 지정하세요.
- 예시: `C:\Users\894플러스\Desktop\meta\memeanji\memeanji\seriesbuilder\pw-profile`

## 4) 실행 전 주의사항

- Chrome 충돌 방지를 위해 기존 Chrome 창은 모두 종료 후 실행하세요.
- `stealth plugin`, `navigator.webdriver` 수정, OAuth 자동 로그인 입력은 사용하지 않습니다.

## 5) 로그인 세션 저장

```bash
npm run login
```

동작:
1. `launchPersistentContext`로 Playwright 전용 프로필 실행
2. `https://business.facebook.com/adsmanager` 자동 이동 (로그인 폼 자동 입력 없음)
3. 사용자가 해당 창에서 직접 로그인 상태 확인
4. Enter 입력 시 `auth/meta-session.json` 저장

## 6) 캠페인 열기 + 광고세트 이름 자동 입력

```bash
npm run open-campaign
```

동작:
1. `launchPersistentContext`로 동일 Playwright 프로필 재사용
2. 저장된 세션(`auth/meta-session.json`) 재사용
3. Ads Manager 접속 후 로그인 화면 감지 시 자동진행 중단 및 안내 메시지 출력
4. `act={AD_ACCOUNT_ID}` 계정으로 이동
5. `CAMPAIGN_NAME`과 exact match 되는 캠페인 검색 후 진입
6. `만들기` 클릭
7. 광고세트 생성 플로우 진입
8. 광고세트 이름 자동 입력 (`MMDD 리타겟 {번호}번 광고세트`)
9. (선택) `MEDIA_FOLDER_PATH`가 설정되어 있으면 해당 폴더의 파일 자동 선택
10. `page.pause()`로 멈춤 (최종 검수 후 사용자가 직접 게시)

## 7) 전체 실행 흐름

1. `npm run login`
2. 브라우저에서 Ads Manager 로그인 상태 확인
3. 터미널에서 Enter 입력
4. `auth/meta-session.json` 저장
5. `npm run open-campaign` 실행

## 보안/정책 준수

- Google OAuth / Facebook 로그인 폼 자동 입력은 수행하지 않습니다.
- 자동화 탐지 우회(stealth plugin, user-agent 위조, `navigator.webdriver` 수정 등)를 사용하지 않습니다.
- 사용자 정상 로그인 세션 재사용 방식만 사용합니다.
