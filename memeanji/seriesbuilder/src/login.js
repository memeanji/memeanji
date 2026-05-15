import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR;
const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR;

const DIRS = {
  auth: path.resolve('auth'),
  screenshots: path.resolve('screenshots'),
};

const PATHS = {
  session: path.join(DIRS.auth, 'meta-session.json'),
  login: path.join(DIRS.screenshots, '01-login-page.png'),
  loggedIn: path.join(DIRS.screenshots, '02-after-login.png'),
  error: path.join(DIRS.screenshots, 'error.png'),
};

function validateEnv() {
  if (!CHROME_USER_DATA_DIR) {
    throw new Error('환경변수 CHROME_USER_DATA_DIR가 필요합니다.');
  }

  if (!CHROME_PROFILE_DIR) {
    throw new Error('환경변수 CHROME_PROFILE_DIR가 필요합니다.');
  }
}

async function ensureDirs() {
  await fs.mkdir(DIRS.auth, { recursive: true });
  await fs.mkdir(DIRS.screenshots, { recursive: true });
}

async function main() {
  validateEnv();
  await ensureDirs();

  console.log('[LOGIN] launchPersistentContext 시작');
  const context = await chromium.launchPersistentContext(CHROME_USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: [`--profile-directory=${CHROME_PROFILE_DIR}`],
    viewport: null,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    console.log('[LOGIN] Facebook 접속');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: PATHS.login, fullPage: true });

    console.log('[LOGIN] 브라우저에서 정상 로그인 상태를 확인하세요.');
    console.log('[LOGIN] Ads Manager 캠페인 목록이 보이면 Enter를 눌러 세션 저장을 진행합니다.');

    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.pause();
        resolve();
      });
    });

    console.log('[LOGIN] Ads Manager 캠페인 화면 확인');
    await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
      waitUntil: 'domcontentloaded',
    });

    await page.getByRole('button', { name: /campaigns|캠페인/i }).first().waitFor({ timeout: 60000 });

    await page.screenshot({ path: PATHS.loggedIn, fullPage: true });
    await context.storageState({ path: PATHS.session });

    console.log(`[LOGIN] 세션 저장 완료: ${PATHS.session}`);
  } catch (error) {
    console.error('[LOGIN] 에러 발생:', error);
    await page.screenshot({ path: PATHS.error, fullPage: true });
    throw error;
  } finally {
    await context.close();
  }
}

main().catch(() => {
  process.exit(1);
});
