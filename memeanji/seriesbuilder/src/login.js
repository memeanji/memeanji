import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
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
  if (!CHROME_USER_DATA_DIR) throw new Error('CHROME_USER_DATA_DIR is missing in .env');
  if (!CHROME_PROFILE_DIR) throw new Error('CHROME_PROFILE_DIR is missing in .env');
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
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
    viewport: null,
    args: [
      `--profile-directory=${CHROME_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    console.log('[LOGIN] Ads Manager 페이지로 이동합니다. (자동 로그인 입력 없음)');
    await page.goto('https://business.facebook.com/adsmanager', {
      waitUntil: 'domcontentloaded',
    });
    await page.screenshot({ path: PATHS.open, fullPage: true });

    console.log('[LOGIN] Meta 로그인 상태 확인 후 Enter를 누르세요.');
    await waitForEnter();

    await page.screenshot({ path: PATHS.ready, fullPage: true });
    await context.storageState({ path: PATHS.session });
    console.log('[LOGIN] 세션 저장 완료');
    console.log(`[LOGIN] 저장 경로: ${PATHS.session}`);
  } catch (error) {
    console.error('[LOGIN] 에러 발생:', error);
    await page.screenshot({ path: PATHS.error, fullPage: true });
    throw error;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error('[FATAL ERROR]', error);
  process.exit(1);
});
