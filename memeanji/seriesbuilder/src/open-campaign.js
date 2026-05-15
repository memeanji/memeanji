import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID;
const CAMPAIGN_NAME = process.env.CAMPAIGN_NAME;
const ADSET_INDEX = process.env.ADSET_INDEX;
const MEDIA_FOLDER_PATH = process.env.MEDIA_FOLDER_PATH;
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

const DIRS = {
  screenshots: path.resolve('screenshots'),
};

const PATHS = {
  step1: path.join(DIRS.screenshots, '03-adsmanager-home.png'),
  step2: path.join(DIRS.screenshots, '04-account-entered.png'),
  step3: path.join(DIRS.screenshots, '05-campaign-found.png'),
  step4: path.join(DIRS.screenshots, '06-campaign-opened.png'),
  step5: path.join(DIRS.screenshots, '07-create-button-clicked.png'),
  step6: path.join(DIRS.screenshots, '08-adset-flow-opened.png'),
  success: path.join(DIRS.screenshots, '09-adset-name-filled.png'),
  error: path.join(DIRS.screenshots, 'error.png'),
};

function validateEnv() {
  if (!AD_ACCOUNT_ID) throw new Error('AD_ACCOUNT_ID is missing in .env');
  if (!CAMPAIGN_NAME) throw new Error('CAMPAIGN_NAME is missing in .env');
  if (!ADSET_INDEX) throw new Error('ADSET_INDEX is missing in .env');
}

function getTodayMMDD() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function getAdsetName() {
  return `${getTodayMMDD()} 리타겟 ${ADSET_INDEX}번 광고세트`;
}

async function ensureDirs() {
  await fs.mkdir(DIRS.screenshots, { recursive: true });
}

async function ensureLoggedInOrThrow(page) {
  const currentUrl = page.url();
  if (/facebook\.com\/(login|checkpoint)/i.test(currentUrl)) {
    throw new Error('로그인 화면이 감지되었습니다. 일반 Chrome에서 Meta 로그인 후 다시 실행해주세요.');
  }
}

async function attachMediaFromFolderIfConfigured(page) {
  if (!MEDIA_FOLDER_PATH) {
    console.log('[STEP] MEDIA_FOLDER_PATH 미설정 - 파일 선택 단계 건너뜀');
    return;
  }

  console.log(`[STEP] 파일 폴더 지정 업로드 시도: ${MEDIA_FOLDER_PATH}`);
  const folderPath = path.resolve(MEDIA_FOLDER_PATH);
  const folderEntries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = folderEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(folderPath, entry.name))
    .filter((filePath) => /\.(png|jpe?g|webp|gif|mp4|mov)$/i.test(filePath));

  if (files.length === 0) {
    throw new Error(`MEDIA_FOLDER_PATH에 업로드 가능한 파일이 없습니다: ${folderPath}`);
  }

  const addMediaButton = page
    .getByRole('button', { name: /미디어|이미지|동영상|add media|upload/i })
    .or(page.getByText(/미디어|이미지|동영상|add media|upload/i).first());

  if (await addMediaButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await addMediaButton.first().click();
  }

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ timeout: 30000 });
  await fileInput.setInputFiles(files);

  await page.screenshot({ path: path.join(DIRS.screenshots, '10-media-selected.png'), fullPage: true });
}

async function runFlow(page) {
  console.log('[STEP] Ads Manager 접속');
  await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', { waitUntil: 'domcontentloaded' });
  await ensureLoggedInOrThrow(page);
  await page.screenshot({ path: PATHS.step1, fullPage: true });

  console.log(`[STEP] 광고계정 이동: act=${AD_ACCOUNT_ID}`);
  const targetUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${AD_ACCOUNT_ID}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);

  console.log('[DEBUG] URL:', page.url());
  console.log('[DEBUG] TITLE:', await page.title());

  const campaignReady = page
    .getByRole('tab', { name: /캠페인|campaigns/i })
    .or(page.getByRole('link', { name: /캠페인|campaigns/i }))
    .or(page.getByText(/캠페인|campaigns/i).first())
    .or(page.getByRole('grid').first())
    .or(page.getByRole('table').first());

  const isCampaignUrl = /\/campaigns/i.test(page.url());
  if (!isCampaignUrl) {
    await campaignReady.first().waitFor({ timeout: 60000 });
  }

  await page.screenshot({ path: PATHS.step2, fullPage: true });

  const exactCampaignRegex = new RegExp(`^${CAMPAIGN_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const campaignRow = page.getByRole('row').filter({ has: page.getByText(exactCampaignRegex) }).first();
  await campaignRow.waitFor({ timeout: 60000 });
  await page.screenshot({ path: PATHS.step3, fullPage: true });

  await campaignRow.getByText(exactCampaignRegex).first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: PATHS.step4, fullPage: true });

  const createBtn = page.getByRole('button', { name: /만들기|create/i }).or(page.getByText(/만들기|create/i).first());
  await createBtn.first().click();
  await page.screenshot({ path: PATHS.step5, fullPage: true });

  const adsetOption = page
    .getByRole('radio', { name: /광고 세트|ad set/i })
    .or(page.getByRole('button', { name: /광고 세트|ad set/i }))
    .or(page.getByText(/광고 세트|ad set/i));
  if (await adsetOption.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await adsetOption.first().click();
  }
  await page.screenshot({ path: PATHS.step6, fullPage: true });

  const nameInput = page
    .getByPlaceholder(/광고 세트 이름|ad set name|이름/i)
    .or(page.getByLabel(/광고 세트 이름|ad set name|이름/i))
    .or(page.locator('input[aria-label*="광고 세트"], input[aria-label*="Ad set"], input[placeholder*="이름"], input[placeholder*="name"]').first());
  await nameInput.first().fill(getAdsetName());
  await page.screenshot({ path: PATHS.success, fullPage: true });

  await attachMediaFromFolderIfConfigured(page);

  console.log('[STEP] 최종 검수용 pause 진입 (게시 버튼 수동)');
  await page.pause();
}

async function main() {
  validateEnv();
  await ensureDirs();

  console.log(`[OPEN] 기존 Chrome 세션에 CDP attach: ${CDP_URL}`);
  const browser = await chromium.connectOverCDP(CDP_URL);

  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('연결된 Chrome context가 없습니다. Chrome을 remote-debugging 포트로 실행했는지 확인하세요.');
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await runFlow(page);
  } catch (error) {
    console.error('[OPEN] 실행 실패:', error);
    try {
      const context = browser.contexts()[0];
      const page = context?.pages()?.[0];
      if (page) await page.screenshot({ path: PATHS.error, fullPage: true });
    } catch {}
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[FATAL ERROR]', error);
  process.exit(1);
});
