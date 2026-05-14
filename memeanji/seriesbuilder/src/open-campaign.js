import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID;
const CAMPAIGN_NAME = process.env.CAMPAIGN_NAME;
const ADSET_INDEX = process.env.ADSET_INDEX;

const DIRS = {
  auth: path.resolve('auth'),
  screenshots: path.resolve('screenshots'),
};

const PATHS = {
  session: path.join(DIRS.auth, 'meta-session.json'),
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
  if (!AD_ACCOUNT_ID) throw new Error('환경변수 AD_ACCOUNT_ID가 필요합니다. (.env 참고)');
  if (!CAMPAIGN_NAME) throw new Error('환경변수 CAMPAIGN_NAME이 필요합니다. (.env 참고)');
  if (!ADSET_INDEX) throw new Error('환경변수 ADSET_INDEX가 필요합니다. (.env 참고)');
}

function getTodayMMDD() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${month}${day}`;
}

function getAdsetName() {
  return `${getTodayMMDD()} 리타겟 ${ADSET_INDEX}번 광고세트`;
}

async function ensureSessionExists() {
  try {
    await fs.access(PATHS.session);
  } catch {
    throw new Error(`세션 파일이 없습니다: ${PATHS.session}. 먼저 npm run login 실행 필요`);
  }
}

async function ensureDirs() {
  await fs.mkdir(DIRS.screenshots, { recursive: true });
}

async function clickCreateButton(page) {
  console.log('[STEP] 만들기 버튼 클릭 시도');
  const createBtn = page
    .getByRole('button', { name: /만들기|create/i })
    .or(page.getByText(/만들기|create/i).first());

  await createBtn.first().waitFor({ timeout: 30000 });
  await createBtn.first().click();
  await page.screenshot({ path: PATHS.step5, fullPage: true });
}

async function enterAdsetFlow(page) {
  console.log('[STEP] 광고세트 생성 플로우 진입 시도');

  const adsetOption = page
    .getByRole('radio', { name: /광고 세트|ad set/i })
    .or(page.getByRole('button', { name: /광고 세트|ad set/i }))
    .or(page.getByText(/광고 세트|ad set/i));

  if (await adsetOption.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await adsetOption.first().click();
  }

  const nextButton = page
    .getByRole('button', { name: /다음|next|continue|계속/i })
    .or(page.getByText(/다음|next|continue|계속/i).first());

  if (await nextButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await nextButton.first().click();
  }

  await page.screenshot({ path: PATHS.step6, fullPage: true });
}

async function fillAdsetName(page, adsetName) {
  console.log(`[STEP] 광고세트 이름 입력: ${adsetName}`);

  const nameInput = page
    .getByPlaceholder(/광고 세트 이름|ad set name|이름/i)
    .or(page.getByLabel(/광고 세트 이름|ad set name|이름/i))
    .or(page.locator('input[aria-label*="광고 세트"], input[aria-label*="Ad set"], input[placeholder*="이름"], input[placeholder*="name"]').first());

  await nameInput.first().waitFor({ timeout: 30000 });
  await nameInput.first().click();
  await nameInput.first().fill(adsetName);
  await page.screenshot({ path: PATHS.success, fullPage: true });
}

async function runFlow(page) {
  console.log('[STEP] Ads Manager 접속');
  await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
    waitUntil: 'domcontentloaded',
  });
  await page.screenshot({ path: PATHS.step1, fullPage: true });

  console.log(`[STEP] 광고계정 이동: act=${AD_ACCOUNT_ID}`);
  const accountUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${AD_ACCOUNT_ID}`;
  await page.goto(accountUrl, { waitUntil: 'domcontentloaded' });

  await page
    .locator('[role="main"]')
    .getByRole('button', { name: /campaigns|캠페인/i })
    .first()
    .waitFor({ timeout: 60000 });

  await page.screenshot({ path: PATHS.step2, fullPage: true });

  console.log(`[STEP] 캠페인 찾기: ${CAMPAIGN_NAME}`);
  const exactCampaignRegex = new RegExp(`^${CAMPAIGN_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

  const campaignRow = page
    .getByRole('row')
    .filter({ has: page.getByText(exactCampaignRegex) })
    .first();

  await campaignRow.waitFor({ timeout: 60000 });
  await page.screenshot({ path: PATHS.step3, fullPage: true });

  await campaignRow.getByText(exactCampaignRegex).first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: PATHS.step4, fullPage: true });
  console.log('[STEP] 캠페인 내부 진입 완료');

  await clickCreateButton(page);
  await enterAdsetFlow(page);
  await fillAdsetName(page, getAdsetName());

  console.log('[STEP] 최종 검수용 pause 진입 (게시 버튼은 직접 클릭)');
  await page.pause();
}

async function main() {
  validateEnv();
  await ensureDirs();
  await ensureSessionExists();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: PATHS.session });
  const page = await context.newPage();

  try {
    await runFlow(page);
    console.log('[OPEN] 광고세트 생성 준비 완료 (미게시 상태)');
  } catch (error) {
    console.error('[OPEN] 1차 시도 실패. retry 1회 진행:', error);
    try {
      await runFlow(page);
      console.log('[OPEN] retry 성공');
    } catch (retryError) {
      console.error('[OPEN] retry 실패:', retryError);
      await page.screenshot({ path: PATHS.error, fullPage: true });
      throw retryError;
    }
  } finally {
    await browser.close();
  }
}

main().catch(() => {
  process.exit(1);
});
