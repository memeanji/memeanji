import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

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

async function ensureDirs() {
  await fs.mkdir(DIRS.auth, { recursive: true });
  await fs.mkdir(DIRS.screenshots, { recursive: true });
}

async function main() {
  await ensureDirs();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: PATHS.login, fullPage: true });

    console.log('\n[LOGIN] 브라우저에서 Meta(Facebook) 로그인을 완료하세요.');
    console.log('[LOGIN] 로그인 완료 후 Ads Manager 메인 화면(캠페인 목록)이 보이면 Enter를 누르세요.\n');

    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.pause();
        resolve();
      });
    });

    await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
      waitUntil: 'domcontentloaded',
    });

    await page.getByRole('button', { name: /campaigns|캠페인/i }).first().waitFor({
      timeout: 60000,
    });

    await page.screenshot({ path: PATHS.loggedIn, fullPage: true });
    await context.storageState({ path: PATHS.session });

    console.log(`[LOGIN] 세션 저장 완료: ${PATHS.session}`);
  } catch (error) {
    console.error('[LOGIN] 에러 발생:', error);
    await page.screenshot({ path: PATHS.error, fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(() => {
  process.exit(1);
});
