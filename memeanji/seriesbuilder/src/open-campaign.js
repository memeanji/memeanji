import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID;
const CAMPAIGN_NAME = process.env.CAMPAIGN_NAME;
const ADSET_INDEX = process.env.ADSET_INDEX;
const ADSET_BASE_NAME = '리타겟';
const ADSET_START_INDEX = Number(process.env.ADSET_START_INDEX || ADSET_INDEX || 1);
const ADSET_COUNT = Number(process.env.ADSET_COUNT || 1);
const ADSET_DAILY_BUDGET = process.env.ADSET_DAILY_BUDGET;
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
  if (!Number.isFinite(ADSET_START_INDEX)) throw new Error('ADSET_START_INDEX must be a number');
  if (!Number.isFinite(ADSET_COUNT) || ADSET_COUNT < 1) throw new Error('ADSET_COUNT must be >= 1');
}

function normalizeText(value) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function campaignPatternFromInput(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\s+/g, '\\s*'), 'i');
}

function getTodayMMDD() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function getAdsetName(index) {
  return `${getTodayMMDD()} ${ADSET_BASE_NAME} ${index}번 광고세트`;
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

async function trySearchBox(page, keyword) {
  const searchInput = page
    .locator('input[type="text"], input[type="search"], textarea')
    .filter({ hasNot: page.locator('[type="checkbox"], [role="switch"]') })
    .filter({ hasNot: page.locator('[aria-label*="빠른 보기" i], [aria-label*="저장" i]') })
    .first();

  const visible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    console.log('[STEP] 캠페인 검색창 미감지 - 목록에서 직접 탐색');
    return false;
  }

  console.log('[STEP] 캠페인 검색창 감지 - 검색어 입력 시도');
  await searchInput.click();
  await searchInput.fill('');
  await searchInput.fill(keyword);
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(3000);
  return true;
}

async function logCampaignCandidates(page, limit = 10) {
  const rows = page.getByRole('row');
  const rowCount = await rows.count();
  const candidates = [];
  for (let i = 0; i < rowCount && candidates.length < limit; i += 1) {
    const text = (await rows.nth(i).innerText().catch(() => '')).trim();
    if (text.length >= 2) candidates.push(text.split('\n')[0].trim());
  }
  console.log('[DEBUG] 화면 캠페인 후보(최대 10개):');
  candidates.forEach((name, idx) => console.log(`  ${idx + 1}. ${name}`));
}

async function findCampaignTarget(page, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  const regex = campaignPatternFromInput(keyword);

  const tooltipMatch = page.locator('[data-tooltip-content]').filter({ hasText: regex }).first();
  if (await tooltipMatch.isVisible({ timeout: 5000 }).catch(() => false)) return tooltipMatch;

  const spanMatch = page.locator('span._3dfi._3dfj').filter({ hasText: regex }).first();
  if (await spanMatch.isVisible({ timeout: 5000 }).catch(() => false)) return spanMatch;

  const textMatch = page.getByText(regex).first();
  if (await textMatch.isVisible({ timeout: 5000 }).catch(() => false)) return textMatch;

  const rows = page.getByRole('row');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i += 1) {
    const text = await rows.nth(i).innerText().catch(() => '');
    if (normalizeText(text).includes(normalizedKeyword)) return rows.nth(i);
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

  if (await closeBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) await closeBtn.first().click();
  else await page.keyboard.press('Escape').catch(() => {});

  await page.waitForTimeout(1000);
  return true;
}

async function clickLeftCreateButtonOnly(page) {
  const createCandidates = page.locator('div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g');
  const count = await createCandidates.count();

  for (let i = 0; i < count; i += 1) {
    const candidate = createCandidates.nth(i);
    const text = (await candidate.innerText().catch(() => '')).trim();
    console.log('[DEBUG] create button text:', text);
    if (!text || text.includes('보기 만들기')) continue;
    if (text === '만들기') {
      await candidate.click();
      return;
    }
  }
  throw new Error('왼쪽 "+ 만들기" 버튼을 찾지 못했습니다.');
}

async function fillAdsetNameInAdsetModalOnly(page, adsetName) {
  await closeViewCreatePanelIfOpened(page);

  const adsetNameInput = page
    .locator('input[placeholder="광고 세트 이름 지정"], input._58al._aghb, input[type="text"][value]')
    .first();

  try {
    await adsetNameInput.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    const modalText = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')).slice(0, 500);
    console.log('[DEBUG] adset name input timeout URL:', page.url());
    console.log('[DEBUG] adset name input timeout TITLE:', await page.title());
    console.log('[DEBUG] adset name input modal text:', modalText);
    throw new Error('광고 세트 이름 input을 찾지 못했습니다.');
  }

  await adsetNameInput.click({ timeout: 10000 });
  await adsetNameInput.press('Control+A');
  await page.keyboard.press('Backspace');
  await adsetNameInput.type(adsetName, { delay: 30 });

  const currentValue = await adsetNameInput.inputValue().catch(() => '');
  console.log('[DEBUG] adset name input value:', currentValue);
  if (currentValue.trim() !== adsetName) {
    throw new Error(`광고 세트 이름 입력 검증 실패: expected="${adsetName}", actual="${currentValue}"`);
  }

  const continueButton = page
    .locator('div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g')
    .filter({ hasText: /^계속$/ })
    .first();

  const continueVisible = await continueButton.isVisible({ timeout: 30000 }).catch(() => false);
  if (!continueVisible) {
    const modalText = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')).slice(0, 500);
    console.log('[DEBUG] continue button timeout URL:', page.url());
    console.log('[DEBUG] continue button timeout TITLE:', await page.title());
    console.log('[DEBUG] continue button modal text:', modalText);
    throw new Error('textContent가 정확히 "계속"인 버튼을 찾지 못했습니다.');
  }

  await continueButton.click();
  await page.screenshot({ path: path.join(DIRS.screenshots, '08-adset-name-and-continue.png'), fullPage: true });

  await closeViewCreatePanelIfOpened(page);
}

async function fillAdsetBudgetInModalOnly(page, budgetValue) {
  await closeViewCreatePanelIfOpened(page);
  const modalRoot = page.locator('[role="dialog"]').filter({ has: page.getByText(/광고 세트|ad set/i) }).first();
  const modalVisible = await modalRoot.isVisible({ timeout: 3000 }).catch(() => false);

  const budgetInput = modalVisible
    ? modalRoot
      .getByLabel(/일일 예산|예산|daily budget|budget/i)
      .or(modalRoot.getByPlaceholder(/예산|budget/i))
      .or(modalRoot.locator('input[type="text"]').filter({ hasNot: modalRoot.locator('[type="checkbox"], [role="switch"]') }).first())
    : page.getByLabel(/일일 예산|예산|daily budget|budget/i).or(page.getByPlaceholder(/예산|budget/i));

  if (await budgetInput.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log(`[STEP] 예산 입력: ${budgetValue}`);
    await budgetInput.first().click();
    await budgetInput.first().fill(String(budgetValue));
  } else {
    console.log('[STEP] 예산 입력창 미감지 - 건너뜀');
  }

  await closeViewCreatePanelIfOpened(page);
}

async function enterAdsetFlow(page) {
  const adsetNameInput = page
    .locator('input[placeholder="광고 세트 이름 지정"], input._58al._aghb')
    .first();

  const inputCount = await page
    .locator('input[placeholder="광고 세트 이름 지정"], input._58al._aghb')
    .count();

  try {
    await adsetNameInput.waitFor({ state: 'visible', timeout: 30000 });
    return;
  } catch {
    const placeholders = await page
      .locator('input[placeholder]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('placeholder') || '').filter(Boolean))
      .catch(() => []);

    console.log('[DEBUG] enterAdsetFlow timeout URL:', page.url());
    console.log('[DEBUG] enterAdsetFlow timeout TITLE:', await page.title());
    console.log('[DEBUG] enterAdsetFlow input placeholders:', placeholders);
    console.log('[DEBUG] enterAdsetFlow matched input count:', inputCount);

    throw new Error('광고 세트 생성 모달(광고 세트 이름 지정 input)을 찾지 못했습니다.');
  }
}

async function attachMediaFromFolderIfConfigured(page) {
  if (!MEDIA_FOLDER_PATH) return;
  const folderPath = path.resolve(MEDIA_FOLDER_PATH);
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(folderPath, e.name)).filter((f) => /\.(png|jpe?g|webp|gif|mp4|mov)$/i.test(f));
  if (!files.length) throw new Error(`MEDIA_FOLDER_PATH에 업로드 가능한 파일이 없습니다: ${folderPath}`);

  const addMediaButton = page.getByRole('button', { name: /미디어|이미지|동영상|add media|upload/i }).or(page.getByText(/미디어|이미지|동영상|add media|upload/i).first());
  if (await addMediaButton.first().isVisible({ timeout: 5000 }).catch(() => false)) await addMediaButton.first().click();
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ timeout: 30000 });
  await fileInput.setInputFiles(files);
}

async function runFlow(page) {
  console.log('[STEP] Ads Manager 접속');
  await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', { waitUntil: 'domcontentloaded' });
  await ensureLoggedInOrThrow(page);
  await page.screenshot({ path: PATHS.step1, fullPage: true });

  console.log(`[STEP] 광고계정 이동: act=${AD_ACCOUNT_ID}`);
  await page.goto(`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${AD_ACCOUNT_ID}`, { waitUntil: 'domcontentloaded' });
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

  for (let n = 0; n < ADSET_COUNT; n += 1) {
    const index = ADSET_START_INDEX + n;
    const adsetName = getAdsetName(index);
    console.log(`[STEP] ${n + 1}/${ADSET_COUNT} 광고 세트 생성 시작: ${adsetName}`);

    await clickLeftCreateButtonOnly(page);
    await page.screenshot({ path: PATHS.step5, fullPage: true });
    await enterAdsetFlow(page);
    await page.screenshot({ path: PATHS.step6, fullPage: true });

    await fillAdsetNameInAdsetModalOnly(page, adsetName);
    if (ADSET_DAILY_BUDGET) {
      await fillAdsetBudgetInModalOnly(page, ADSET_DAILY_BUDGET);
    }

    if (n === 0) {
      await attachMediaFromFolderIfConfigured(page);
    }
  }

  await page.screenshot({ path: PATHS.success, fullPage: true });

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
    if (!context) throw new Error('연결된 Chrome context가 없습니다.');
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
