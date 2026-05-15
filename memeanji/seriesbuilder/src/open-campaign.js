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

function normalizeText(value) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function campaignPatternFromInput(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\s+/g, '\\s*'), 'i');
}

async function trySearchBox(page, keyword) {
  const searchInput = page
    .getByPlaceholder(/검색|search|필터|filter/i)
    .or(page.getByRole('searchbox'))
    .or(page.getByLabel(/검색|search|필터|filter/i));

  if (await searchInput.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[STEP] 캠페인 검색창 감지 - 검색어 입력 시도');
    await searchInput.first().click();
    await searchInput.first().fill('');
    await searchInput.first().fill(keyword);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(3000);
    return true;
  }

  console.log('[STEP] 캠페인 검색창 미감지 - 목록에서 직접 탐색');
  return false;
}

async function logCampaignCandidates(page, limit = 10) {
  const rows = page.getByRole('row');
  const rowCount = await rows.count();
  const candidates = [];

  for (let i = 0; i < rowCount && candidates.length < limit; i += 1) {
    const text = (await rows.nth(i).innerText().catch(() => '')).trim();
    if (text.length >= 2) {
      const firstLine = text.split('\n')[0].trim();
      if (firstLine) candidates.push(firstLine);
    }
  }

  console.log('[DEBUG] 화면 캠페인 후보(최대 10개):');
  if (candidates.length === 0) {
    console.log('  - (추출 실패: row text 없음)');
    return;
  }

  candidates.forEach((name, idx) => {
    console.log(`  ${idx + 1}. ${name}`);
  });
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

async function findCampaignTarget(page, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  const regex = campaignPatternFromInput(keyword);

  // 1) data-tooltip-content partial
  const tooltipMatch = page.locator('[data-tooltip-content]').filter({ hasText: regex }).first();
  if (await tooltipMatch.isVisible({ timeout: 5000 }).catch(() => false)) return tooltipMatch;

  const tooltipAttrMatch = page.locator(`[data-tooltip-content*="${keyword}"]`).first();
  if (await tooltipAttrMatch.isVisible({ timeout: 3000 }).catch(() => false)) return tooltipAttrMatch;

  // 2) span._3dfi._3dfj partial
  const spanMatch = page.locator('span._3dfi._3dfj').filter({ hasText: regex }).first();
  if (await spanMatch.isVisible({ timeout: 5000 }).catch(() => false)) return spanMatch;

  // 3) getByText fallback partial
  const textMatch = page.getByText(regex).first();
  if (await textMatch.isVisible({ timeout: 5000 }).catch(() => false)) return textMatch;

  // 4) whitespace-insensitive row scan fallback
  const rows = page.getByRole('row');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i += 1) {
    const text = await rows.nth(i).innerText().catch(() => '');
    if (normalizeText(text).includes(normalizedKeyword)) {
      return rows.nth(i);
    }
  }

  return null;
}

async function closeViewCreatePanelIfOpened(page) {
  const panelSignals = page.getByText(/보기 만들기|저장|이 보기에 관해 설명해보세요/i).first();
  const opened = await panelSignals.isVisible({ timeout: 1500 }).catch(() => false);
  if (!opened) return false;

  console.log('[STEP] 보기 만들기 패널 감지 - 닫기 시도');
  const closeBtn = page
    .getByRole('button', { name: /닫기|close|취소/i })
    .or(page.locator('[aria-label="닫기"], [aria-label="Close"]').first());

  if (await closeBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.first().click();
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await page.waitForTimeout(1000);
  return true;
}

async function fillAdsetNameInAdsetModalOnly(page, adsetName) {
  await closeViewCreatePanelIfOpened(page);

  const modalRoot = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByText(/광고 세트|ad set/i) })
    .first();

  const modalVisible = await modalRoot.isVisible({ timeout: 5000 }).catch(() => false);
  let nameInput;

  if (modalVisible) {
    nameInput = modalRoot
      .getByPlaceholder(/광고 세트 이름 지정/i)
      .or(modalRoot.getByPlaceholder(/광고 세트 이름|ad set name|이름/i))
      .or(modalRoot.getByLabel(/광고 세트 이름 지정|광고 세트 이름|ad set name/i));
  } else {
    nameInput = page
      .getByPlaceholder(/광고 세트 이름 지정/i)
      .or(page.getByPlaceholder(/광고 세트 이름|ad set name|이름/i));
  }

  await nameInput.first().waitFor({ timeout: 15000 });
  await nameInput.first().click();
  await nameInput.first().fill(adsetName);

  await closeViewCreatePanelIfOpened(page);
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
  await page.waitForTimeout(5000);

  console.log('[DEBUG] URL:', page.url());
  console.log('[DEBUG] TITLE:', await page.title());

  await page.screenshot({ path: PATHS.step2, fullPage: true });

  await trySearchBox(page, CAMPAIGN_NAME);
  const campaignTarget = await findCampaignTarget(page, CAMPAIGN_NAME);

  if (!campaignTarget) {
    await logCampaignCandidates(page, 10);
    throw new Error(`CAMPAIGN_NAME partial match 실패: ${CAMPAIGN_NAME}`);
  }

  await campaignTarget.click();
  await page.screenshot({ path: PATHS.step3, fullPage: true });

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

  await fillAdsetNameInAdsetModalOnly(page, getAdsetName());
  await page.screenshot({ path: PATHS.success, fullPage: true });

  await attachMediaFromFolderIfConfigured(page);

  const activePanel = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')).split('\n')[0] || '(unknown)';
  console.log('[DEBUG] FINAL URL:', page.url());
  console.log('[DEBUG] FINAL TITLE:', await page.title());
  console.log('[DEBUG] ACTIVE PANEL:', activePanel);

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
