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
  open: path.join(DIRS.screenshots, '01-login-check-opened.png'),
  ready: path.join(DIRS.screenshots, '02-login-check-ready.png'),
  error: path.join(DIRS.screenshots, 'error.png'),
};

function validateEnv() {
  if (!CHROME_USER_DATA_DIR) throw new Error('환경변수 CHROME_USER_DATA_DIR가 필요합니다.');
  if (!CHROME_PROFILE_DIR) throw new Error('환경변수 CHROME_PROFILE_DIR가 필요합니다.');
}

async function ensureDirs() {
  await fs.mkdir(DIRS.auth, { recursive: true });
  await fs.mkdir(DIRS.screenshots, { recursive: true });
}

async function main() {
  validateEnv();
  await ensureDirs();

  console.log('[LOGIN] 기존 Chrome 프로필로 브라우저를 엽니다.');
  const context = await chromium.launchPersistentContext(CHROME_USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    args: [`--profile-directory=${CHROME_PROFILE_DIR}`],
    viewport: null,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    console.log('[LOGIN] Ads Manager 페이지로 이동합니다. (자동 로그인 입력 없음)');
    await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
      waitUntil: 'domcontentloaded',
    });
    await page.screenshot({ path: PATHS.open, fullPage: true });

    console.log('[LOGIN] 일반 Chrome에서 이미 로그인된 세션인지 확인하세요.');
    console.log('[LOGIN] Ads Manager 화면이 보이면 Enter를 눌러 세션을 저장합니다.');
    console.log('[LOGIN] 로그인 화면이라면 일반 Chrome에서 먼저 로그인 후 Enter를 누르세요.');

    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.pause();
        resolve();
      });
    });

    await page.screenshot({ path: PATHS.ready, fullPage: true });
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

main().catch(() => process.exit(1));
