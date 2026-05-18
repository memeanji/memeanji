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
const AD_CREATIVE_COUNT = Number(process.env.ADSET_CREATIVE_COUNT || process.env.AD_CREATIVE_COUNT || process.env.ADVERTISE_COUNT || 5);
const ADSET_DAILY_BUDGET = process.env.ADSET_DAILY_BUDGET;
const MEDIA_FOLDER_PATH = process.env.MEDIA_FOLDER_PATH;
const SCHEDULE_TIME = process.env.SCHEDULE_TIME || '05:00';
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const QUICK_TEST_CREATIVE_STEP = String(process.env.QUICK_TEST_CREATIVE_STEP || '').toLowerCase() === 'true';
const QUICK_TEST_AD_NAME = process.env.QUICK_TEST_AD_NAME || `f_i_o_l_${new Date().getMonth() + 1}${new Date().getDate()}_1`;

let firstCreativeMediaUploaded = false;

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
  if (!Number.isFinite(AD_CREATIVE_COUNT) || AD_CREATIVE_COUNT < 1) throw new Error('AD_CREATIVE_COUNT must be >= 1');
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


function parseScheduleTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 5, minute: 0 };
  const hour = Math.max(0, Math.min(23, Number(m[1])));
  const minute = Math.max(0, Math.min(59, Number(m[2])));
  return { hour, minute };
}

function getAdsetName(index) {
  return `${getTodayMMDD()} ${ADSET_BASE_NAME} ${index}번 광고세트`;
}

async function ensureDirs() {
  await fs.mkdir(DIRS.screenshots, { recursive: true });
}


async function pause(page, label, ms = 2000) {
  console.log(`[PAUSE] ${label} - ${ms}ms`);
  await page.waitForTimeout(ms);
}

async function debugDump(page, reason) {
  const placeholders = await page.locator('input[placeholder]').evaluateAll((els) => els.map((el) => el.getAttribute('placeholder') || '')).catch(() => []);
  const inputValues = await page.locator('input').evaluateAll((els) => els.map((el) => el.value || '')).catch(() => []);
  const buttonTexts = await page.locator('button, [role="button"], div').evaluateAll((els) => els.map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 50)).catch(() => []);
  const inputCount = await page.locator('input').count().catch(() => 0);
  const bodyText = await page.locator('body').innerText().catch(() => '');

  console.log(`[DEBUG] ${reason} URL:`, page.url());
  console.log(`[DEBUG] ${reason} TITLE:`, await page.title());
  console.log(`[DEBUG] ${reason} input count:`, inputCount);
  console.log(`[DEBUG] ${reason} input placeholders:`, placeholders);
  console.log(`[DEBUG] ${reason} input values:`, inputValues);
  console.log(`[DEBUG] ${reason} button texts(sample):`, buttonTexts);
  console.log(`[DEBUG] ${reason} body text(1000):`, bodyText.slice(0, 1000));
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

async function clickRealCreateButton(page) {
  const createCandidates = page.locator('div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g.xuxw1ft.x6ikm8r.x10wlt62.xlyipyv.x1h4wwuj.xeuugli');
  const count = await createCandidates.count();

  for (let i = 0; i < count; i += 1) {
    const candidate = createCandidates.nth(i);
    const text = (await candidate.innerText().catch(() => '')).trim();
    const box = await candidate.boundingBox().catch(() => null);
    console.log('[DEBUG] create button candidate:', { index: i, text, box });

    if (text !== '만들기') continue;
    if (text.includes('보기 만들기')) continue;
    if (!box) continue;

    if (box.x < 300 && box.y > 150 && box.y < 300) {
      await candidate.click();
      return;
    }
  }

  throw new Error('좌측 상단 실제 +만들기 버튼을 찾지 못했습니다.');
}

async function isAdsetCreateOpen(page) {
  const byPlaceholder = await page.locator('input[placeholder="광고 세트 이름 지정"]').first().isVisible({ timeout: 1500 }).catch(() => false);
  if (byPlaceholder) return true;

  const textInputs = await page.locator('input[type="text"]').elementHandles();
  for (const input of textInputs) {
    const value = await input.getAttribute('value');
    if (value?.includes('리타겟') || value?.includes('광고세트')) return true;
  }

  const hasContinue = await page.getByText(/^계속$/).first().isVisible({ timeout: 1200 }).catch(() => false);
  const hasCancel = await page.getByText(/^취소$/).first().isVisible({ timeout: 1200 }).catch(() => false);
  return hasContinue && hasCancel;
}

async function ensureAdsetCreateOpen(page) {
  const isOpen = await isAdsetCreateOpen(page);
  if (isOpen) {
    console.log('[STEP] 광고 세트 생성 화면 확인됨');
    return true;
  }

  console.log('[WARN] 광고 세트 생성 화면이 아님 - +만들기 재진입 시도');
  await clickRealCreateButton(page);
  await pause(page, '광고 세트 생성 재진입 대기', 3000);

  const reopened = await isAdsetCreateOpen(page);
  if (!reopened) {
    await page.screenshot({ path: path.join(DIRS.screenshots, 'adset-create-reopen-failed.png'), fullPage: true });
    await debugDump(page, 'adset create reopen failed');
    throw new Error('광고 세트 생성 화면 재진입 실패');
  }
  return true;
}

async function fillAdsetNameInAdsetModalOnly(page, adsetName) {
  await ensureAdsetCreateOpen(page);
  await pause(page, '광고 세트명 입력 전 대기', 2000);

  const broadLocator = page.locator(
    'input[placeholder="광고 세트 이름 지정"], input._58al._aghb[type="text"], input[type="text"][value*="리타겟"], input[type="text"][value*="광고세트"], input[type="text"][value*="광고 세트 이름 지정"], input[data-auto-logging-id]'
  );

  const broadCount = await broadLocator.count();
  console.log('[DEBUG] adset input broad candidate count:', broadCount);

  let targetInputHandle = null;
  const deadline = Date.now() + 180000; // 최대 3분

  while (Date.now() < deadline && !targetInputHandle) {
    const directLocator = page.locator('input[placeholder="광고 세트 이름 지정"], input._58al._aghb[type="text"]').first();
    if (await directLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
      targetInputHandle = await directLocator.elementHandle();
      break;
    }

    const inputs = await page.locator('input[type="text"]').elementHandles();
    for (const input of inputs) {
      const value = await input.getAttribute('value');
      const placeholder = await input.getAttribute('placeholder');
      const className = await input.getAttribute('class');

      console.log('[DEBUG] input candidate:', { value, placeholder, className });

      if (
        placeholder === '광고 세트 이름 지정' ||
        value?.includes('리타겟') ||
        value?.includes('광고세트') ||
        value?.includes('광고 세트 이름 지정') ||
        className?.includes('_58al')
      ) {
        targetInputHandle = input;
        break;
      }
    }

    if (!targetInputHandle) {
      console.log('[WAIT] 광고 세트 이름 input 탐색 중... (2s 재시도)');
      await page.waitForTimeout(5000);
    }
  }

  if (!targetInputHandle) {
    await debugDump(page, 'adsetNameInput not found after 3min');
    await page.screenshot({ path: path.join(DIRS.screenshots, 'adset-name-input-not-found.png'), fullPage: true });
    throw new Error('광고 세트 이름 input을 3분 내에 찾지 못했습니다.');
  }

  await targetInputHandle.asElement().click();
  await page.waitForTimeout(500);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.waitForTimeout(300);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await page.keyboard.type(adsetName, { delay: 80 });
  await page.waitForTimeout(1000);

  let actualValue = await targetInputHandle.evaluate((el) => el.value || '');
  console.log('[DEBUG] actual adset input value:', actualValue);

  if (!actualValue.trim().includes(adsetName)) {
    console.log('[DEBUG] keyboard.type 미반영 - DOM value fallback 적용');
    await targetInputHandle.evaluate((el, value) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, adsetName);

    await page.waitForTimeout(1000);
    actualValue = await targetInputHandle.evaluate((el) => el.value || '');
    console.log('[DEBUG] actual adset input value after fallback:', actualValue);
  }

  if (!actualValue.trim().includes(adsetName)) {
    await debugDump(page, 'adsetNameInput fill mismatch');
    throw new Error(`광고 세트명 입력 실패: expected=${adsetName}, actual=${actualValue}`);
  }

  await pause(page, '광고 세트명 입력 후 대기', 5000);
  await clickContinueButtonOnly(page);
  await page.screenshot({ path: path.join(DIRS.screenshots, '08-adset-name-and-continue.png'), fullPage: true });

}


async function updateDateAndTimeBeforeContinue(page) {
  await pause(page, '날짜/시간 영역 이동 전 대기', 3000);
  await page.mouse.wheel(0, 500);
  await pause(page, '스크롤 후 날짜/시간 영역 대기', 3000);

  let dateInput = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const candidate = page.locator('input[placeholder="yyyy-mm-dd"]').first();
    const visible = await candidate.isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) {
      dateInput = candidate;
      break;
    }
    console.log(`[WAIT] 날짜 input 탐색 재시도 ${attempt}/6`);
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(2000);
  }

  if (!dateInput) {
    console.log('[DEBUG] 날짜 input 미감지 - 스케줄링 단계 미확인');
    await debugDump(page, 'schedule input not found');
    return false;
  }

  const currentDateText = await dateInput.inputValue().catch(() => '');
  console.log('[DEBUG] current date value:', currentDateText);

  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const nextDateText = `${tomorrow.getFullYear()}년 ${tomorrow.getMonth() + 1}월 ${tomorrow.getDate()}일`;

  console.log('[DEBUG] schedule date target (today+1):', nextDateText);

  await dateInput.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(nextDateText, { delay: 50 });
  await page.waitForTimeout(2000);
  console.log('[DEBUG] updated date value:', await dateInput.inputValue().catch(() => ''));
  await pause(page, '날짜 변경 반영 대기', 2000);

  const { hour, minute } = parseScheduleTime(SCHEDULE_TIME);
  const targetTimeText = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const hourSpin = page.locator('input[role="spinbutton"][aria-label*="시간"]').first();
  const minuteSpin = page.locator('input[role="spinbutton"][aria-label*="분"]').first();

  const hourVisible = await hourSpin.isVisible({ timeout: 5000 }).catch(() => false);
  if (hourVisible) {
    await hourSpin.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(String(hour), { delay: 80 });
    await page.waitForTimeout(700);

    await hourSpin.evaluate((el, hourVal) => {
      el.setAttribute('aria-valuenow', String(hourVal));
      el.setAttribute('aria-valuemin', '0');
      if ('value' in el) el.value = String(hourVal);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hour);
  }

  const minuteVisible = await minuteSpin.isVisible({ timeout: 3000 }).catch(() => false);
  if (minuteVisible) {
    await minuteSpin.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(String(minute).padStart(2, '0'), { delay: 80 });
    await page.waitForTimeout(700);
    await minuteSpin.evaluate((el, minuteVal) => {
      el.setAttribute('aria-valuenow', String(minuteVal));
      el.setAttribute('aria-valuemin', '0');
      if ('value' in el) el.value = String(minuteVal).padStart(2, '0');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, minute);
  }

  if (!hourVisible) {
    // fallback: generic time-like input
    const timeInputs = await page.locator('input').elementHandles();
    for (const input of timeInputs) {
      const value = await input.getAttribute('value');
      const placeholder = await input.getAttribute('placeholder');
      const ariaLabel = await input.getAttribute('aria-label');

      console.log('[DEBUG] time input candidate:', { value, placeholder, ariaLabel });
      if (value?.includes(':') || placeholder?.includes('시간') || ariaLabel?.includes('시간')) {
        await input.click();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(targetTimeText, { delay: 50 });
        await page.waitForTimeout(1500);
        break;
      }
    }
  }

  console.log('[DEBUG] schedule target time applied:', targetTimeText);

  return true;
}




async function ensureCampaignStructureRoot(page) {
  console.log('[STEP] campaign_structure_tree_root 탐색');
  const root = page.locator('#campaign_structure_tree_root').first();

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const visible = await root.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`[DEBUG] campaign_structure_tree_root visible attempt ${attempt}/8:`, visible);
    if (visible) {
      await pause(page, 'campaign_structure_tree_root 확인 후 안정화 대기', 3000);
      return true;
    }
    await page.waitForTimeout(3000);
  }

  await debugDump(page, 'campaign_structure_tree_root not found');
  throw new Error('id="campaign_structure_tree_root"를 찾지 못했습니다.');
}

async function openCorrectAdActionMenu(page, adsetName) {
  console.log('[STEP] row 기준 작업 메뉴 탐색');

  await ensureCampaignStructureRoot(page);
  await page.waitForTimeout(5000);

  const adRow = page.locator(`text=${adsetName}`).first();
  const adRowVisible = await adRow.isVisible({ timeout: 30000 }).catch(() => false);
  if (!adRowVisible) {
    throw new Error(`광고세트 row를 찾지 못했습니다: ${adsetName}`);
  }
  await page.waitForTimeout(5000);

  const adRowBox = await adRow.boundingBox();
  if (!adRowBox) throw new Error(`광고세트 row 위치를 찾지 못했습니다: ${adsetName}`);

  console.log('[DEBUG] 광고세트 row box:', { adsetName, adRowBox });

  const menuButtonSelector = '[role="button"].x1i10hfl.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x972fbf';
  const menuIconSelector = '.x6s0dn4.x78zum5.x1q0g3np.xozqiw3.x2lwn1j.xeuugli.x1iyjqo2.x8va1my.x1hc1fzr.x13dflua.x6o7n8i.xxziih7.x12w9bfk.xl56j7k.xh8yej3';

  let opened = false;

  for (let attempt = 1; attempt <= 10 && !opened; attempt += 1) {
    console.log(`[STEP] 작업 메뉴 탐색/클릭 시도 ${attempt}/10`);

    const buttonCandidates = await page.locator(menuButtonSelector).elementHandles();
    let targetMenu = null;

    for (const candidate of buttonCandidates) {
      const hasIcon = await candidate.$(menuIconSelector);
      if (!hasIcon) continue;

      const box = await candidate.boundingBox();
      if (!box) continue;

      const sameRow = Math.abs((box.y + box.height / 2) - (adRowBox.y + adRowBox.height / 2)) < 15;
      const rightSide = box.x > adRowBox.x;

      console.log('[DEBUG] 작업 메뉴 candidate:', { box, sameRow, rightSide });

      if (sameRow && rightSide) {
        targetMenu = candidate;
        break;
      }
    }

    if (!targetMenu) {
      console.log('[WARN] 같은 row의 작업 메뉴 후보를 찾지 못함');
      await page.waitForTimeout(5000);
      continue;
    }

    const menuBox = await targetMenu.boundingBox();
    if (!menuBox) {
      await page.waitForTimeout(5000);
      continue;
    }

    const menuTypeLabel = adsetName === '새 판매 광고' ? '광고 복제 작업메뉴 찾기' : '광고 세트 작업메뉴 찾기';
    console.log(`[DEBUG] ${menuTypeLabel}:`, menuBox);
    await page.waitForTimeout(5000);
    await page.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await page.waitForTimeout(10000);

    const actionHeading = page.locator('div[role="heading"]').filter({ hasText: /이 광고( 세트)?에 대한 작업/ }).first();
    const actionHeadingVisible = await actionHeading.isVisible({ timeout: 10000 }).catch(() => false);
    const duplicateByClass = page.locator('div.x1mcwxda').filter({ hasText: /^복제$/ }).first();
    const duplicateVisible = await duplicateByClass.isVisible({ timeout: 10000 }).catch(() => false);
    const bodyText = await page.locator('body').innerText();

    console.log('[DEBUG] 작업 메뉴 클릭 후 body text:', bodyText.slice(0, 3000));
    console.log('[DEBUG] 광고세트 작업 heading visible:', actionHeadingVisible);
    console.log('[DEBUG] 복제 버튼 visible:', duplicateVisible);

    if (actionHeadingVisible || duplicateVisible || bodyText.includes('이 광고 세트에 대한 작업') || bodyText.includes('이 광고에 대한 작업') || bodyText.includes('복제')) {
      opened = true;
      break;
    }

    await page.waitForTimeout(5000);
  }

  if (!opened) {
    await page.screenshot({ path: path.join(DIRS.screenshots, 'duplicate-menu-not-opened.png'), fullPage: true });
    throw new Error('작업 메뉴는 클릭했지만 복제 메뉴가 열리지 않았습니다.');
  }

  console.log('[STEP] 작업 메뉴 열기 성공');
}

async function setDuplicateCount(page, count = 9, adsetName) {
  console.log('[STEP] 복제 옵션 버튼 탐색:', { adsetName, count });
  await openCorrectAdActionMenu(page, adsetName);

  const duplicateButton = page.locator('div.x1mcwxda').filter({ hasText: /^복제$/ }).first();

  let duplicateClicked = false;
  for (let attempt = 1; attempt <= 10 && !duplicateClicked; attempt += 1) {
    await duplicateButton.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(5000);
    await duplicateButton.click({ force: true }).catch(async () => {
      const box = await duplicateButton.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    });
    await page.waitForTimeout(10000);

    const bodyText = await page.locator('body').innerText();
    const duplicateStillVisible = await duplicateButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (!duplicateStillVisible || bodyText.includes('복제 개수') || bodyText.includes('계속')) {
      duplicateClicked = true;
      break;
    }

    console.log(`[WARN] 복제 클릭 후 상태 변화 없음, 재시도 ${attempt}/10`);
  }

  if (!duplicateClicked) {
    await page.screenshot({ path: path.join(DIRS.screenshots, 'duplicate-button-click-failed.png'), fullPage: true });
    throw new Error('복제 버튼 클릭에 실패했습니다.');
  }

  console.log('[STEP] 복제 개수 input 탐색');

  let duplicateInput = null;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await pause(page, `복제 input 탐색 전 대기 ${attempt}/10`, 3000);
    const inputs = await page.locator('input').elementHandles();

    for (const input of inputs) {
      const value = await input.getAttribute('value');
      const type = await input.getAttribute('type');
      const className = await input.getAttribute('class');

      console.log('[DEBUG] duplicate input candidate:', {
        attempt,
        type,
        value,
        className,
      });

      const isNumberOnly = value && /^\d+$/.test(value);
      const isNotDate = value && !value.includes('년') && !value.includes('월') && !value.includes('일');
      const isNotTime = value && !value.includes(':');

      if (isNumberOnly && isNotDate && isNotTime && value === '1') {
        duplicateInput = input;
        break;
      }
    }

    if (duplicateInput) break;

    console.log(`[WAIT] 복제 개수 input 탐색 재시도 ${attempt}/10`);
    await page.waitForTimeout(5000);
  }

  if (!duplicateInput) {
    await page.screenshot({
      path: path.join(DIRS.screenshots, 'duplicate-count-input-not-found.png'),
      fullPage: true,
    });
    throw new Error('복제 개수 input을 찾지 못했습니다.');
  }

  await duplicateInput.click();
  await page.waitForTimeout(1000);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.waitForTimeout(500);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  await page.keyboard.type(String(count), { delay: 80 });
  await page.waitForTimeout(2000);

  let actualValue = await duplicateInput.evaluate((el) => el.value);
  console.log('[DEBUG] duplicate count after keyboard input:', actualValue);

  if (actualValue !== String(count)) {
    console.log('[WARN] 키보드 입력으로 복제 개수 변경 실패 - DOM value 직접 변경 fallback');

    await duplicateInput.evaluate((el, value) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(count));

    await page.waitForTimeout(2000);
    actualValue = await duplicateInput.evaluate((el) => el.value);
  }

  console.log('[DEBUG] final duplicate count:', actualValue);

  if (actualValue !== String(count)) {
    throw new Error(`복제 개수 변경 실패: expected=${count}, actual=${actualValue}`);
  }

  console.log(`[STEP] 복제 개수 ${count}개 설정 완료`);

  await confirmDuplicateModal(page);
}



async function confirmDuplicateModal(page) {
  console.log('[STEP] 복제 모달 하단 "복제만들기" 버튼 확인 클릭');

  const duplicateCreateButton = page.locator('#pe_duplicate_create_button').first();

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const visible = await duplicateCreateButton.isVisible({ timeout: 3000 }).catch(() => false);
    const box = await duplicateCreateButton.boundingBox().catch(() => null);

    console.log('[DEBUG] 복제만들기 버튼 상태:', { attempt, visible, box });

    if (visible && box) {
      await page.waitForTimeout(5000);
      await duplicateCreateButton.click({ force: true }).catch(async () => {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
      await page.waitForTimeout(7000);
      return true;
    }

    console.log(`[WAIT] 복제만들기 버튼 탐색 재시도 ${attempt}/10`);
    await page.waitForTimeout(3000);
  }

  const confirmCandidates = page.locator('div, span, button').filter({ hasText: /^복제$/ });

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const count = await confirmCandidates.count();

    for (let i = 0; i < count; i += 1) {
      const candidate = confirmCandidates.nth(i);
      const box = await candidate.boundingBox().catch(() => null);
      const visible = await candidate.isVisible().catch(() => false);
      const text = (await candidate.innerText().catch(() => '')).trim();

      console.log('[DEBUG] 복제 confirm fallback candidate:', { attempt, index: i, text, visible, box });

      if (!visible || !box) continue;
      if (box.x < 900 || box.y < 480 || box.y > 700) continue;

      await page.waitForTimeout(5000);
      await candidate.click({ force: true }).catch(async () => {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
      await page.waitForTimeout(7000);
      return true;
    }

    console.log(`[WAIT] 복제 confirm fallback 탐색 재시도 ${attempt}/10`);
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(DIRS.screenshots, 'duplicate-confirm-not-found.png'), fullPage: true });
  throw new Error('복제 모달의 확인용 "복제만들기" 버튼을 찾지 못했습니다.');
}

async function clickContinueButtonOnly(page) {
  await pause(page, '계속 버튼 탐색 전 대기', 5000);
  let continueButton = null;

  for (let attempt = 1; attempt <= 8 && !continueButton; attempt += 1) {
    const continueCandidates = await page
      .locator('div, span, button')
      .filter({ hasText: /^계속$/ })
      .elementHandles();

    for (const el of continueCandidates) {
      const text = (await el.innerText().catch(() => '')).trim();
      const box = await el.boundingBox();
      console.log('[DEBUG] continue candidate:', { attempt, text, box });

      if (text !== '계속' || !box) continue;
      if (box.x > 900 && box.y > 300 && box.y < 700) {
        continueButton = el;
        break;
      }
    }

    if (!continueButton) {
      console.log(`[WAIT] 계속 버튼 탐색 재시도 ${attempt}/8`);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(5000);
    }
  }

  if (!continueButton) {
    await debugDump(page, 'continue button not found after retries');
    throw new Error('계속 버튼을 찾지 못했습니다.');
  }

  const box = await continueButton.boundingBox();
  if (!box) throw new Error('계속 버튼 좌표를 가져오지 못했습니다.');

  await continueButton.click().catch(async () => {
    await continueButton.click({ force: true });
  }).catch(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  });

  await page.waitForTimeout(3500);
}


async function fillAdsetBudgetInModalOnly(page, budgetValue) {
  const modalRoot = page.locator('[role="dialog"]').filter({ has: page.getByText(/광고 세트|ad set/i) }).first();
  const modalVisible = await modalRoot.isVisible({ timeout: 3000 }).catch(() => false);

  const budgetInput = modalVisible
    ? modalRoot
      .getByLabel(/일일 예산|예산|daily budget|budget/i)
      .or(modalRoot.getByPlaceholder(/예산|budget/i))
      .or(modalRoot.locator('input[type="text"]').filter({ hasNot: modalRoot.locator('[type="checkbox"], [role="switch"]') }).first())
    : page.getByLabel(/일일 예산|예산|daily budget|budget/i).or(page.getByPlaceholder(/예산|budget/i));

  const budgetEl = budgetInput.first();
  const budgetVisible = await budgetEl.isVisible({ timeout: 5000 }).catch(() => false);

  if (budgetVisible) {
    const disabled = await budgetEl.getAttribute('aria-disabled').catch(() => null);
    if (disabled === 'true') {
      console.log('[STEP] 예산 입력창 비활성(aria-disabled=true) - 건너뜀');
      return;
    }

    console.log(`[STEP] 예산 입력: ${budgetValue}`);
    await budgetEl.click({ force: true }).catch(() => null);
    await budgetEl.fill(String(budgetValue)).catch(() => null);
  } else {
    console.log('[STEP] 예산 입력창 미감지 - 건너뜀');
  }

}

async function enterAdsetFlow(page) {
  await ensureAdsetCreateOpen(page);
  await page.locator('input[placeholder="광고 세트 이름 지정"], input._58al._aghb').first().waitFor({ state: 'visible', timeout: 180000 });
}



async function selectImageAdModeWithRequestedClasses(page) {
  // 1) contextual layer root 대기
  const layerRoot = page.locator('div[data-testid="ContextualLayerRoot"], div.uiContextualLayerParent.xu96u03.xm80bdy').first();
  await layerRoot.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);

  // 2) 내부 메뉴 컨테이너 대기
  const menuContainer = layerRoot.locator('div.x1gzqxud.xjwep3j.x1t39747.x1wcsgtt.x1pczhz8.x1xp1s0c.x5yr21d.xh8yej3.x1g2r6go.x6o7n8i.xw7d9y7.x12w9bfk.xg01cxk.x1v84ljc').first();
  const menuVisible = await menuContainer.isVisible({ timeout: 15000 }).catch(() => false);
  if (!menuVisible) {
    console.log('[WAIT] 이미지 광고 메뉴 컨테이너 미확인 - fallback 탐색 진행');
  }
  await page.waitForTimeout(3000);

  // 3) 이미지 광고 menuitem(요청 DOM) 우선 클릭
  const imageMenuItem = layerRoot
    .locator('div[role="menuitem"][data-surface*="browse-image-library-dropdown-item"]')
    .filter({ has: layerRoot.locator('div[id^="js_"]').filter({ hasText: /^이미지 광고$/ }) })
    .first();

  let clicked = false;
  for (let attempt = 1; attempt <= 10 && !clicked; attempt += 1) {
    console.log(`[STEP] 이미지 광고 menuitem 클릭 시도 ${attempt}/10`);
    const visible = await imageMenuItem.isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) {
      await page.waitForTimeout(3000);
      await imageMenuItem.click({ force: true }).then(() => { clicked = true; }).catch(() => null);
      if (!clicked) {
        const box = await imageMenuItem.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          clicked = true;
        }
      }
      await page.waitForTimeout(5000);
      break;
    }

    // fallback: id=js_2i0 같은 텍스트 노드 직접 클릭
    const imageLabel = layerRoot.locator('div.x1vvvo52.x1fvot60.xo1l8bm.xxio538.xbsr9hj.xq9mrsl.x1mzt3pk.x1vvkbs.x13faqbe.xeuugli.x1iyjqo2').filter({ hasText: /^이미지 광고$/ }).first();
    const labelVisible = await imageLabel.isVisible({ timeout: 3000 }).catch(() => false);
    if (labelVisible) {
      await imageLabel.click({ force: true }).then(() => { clicked = true; }).catch(async () => {
        const lbox = await imageLabel.boundingBox();
        if (lbox) await page.mouse.click(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
      });
      await page.waitForTimeout(5000);
      break;
    }

    await page.waitForTimeout(4000);
  }

  if (!clicked) {
    await debugDump(page, 'image ad menuitem click failed');
    throw new Error('이미지 광고 버튼 클릭 실패');
  }
}

async function attachMediaFromFolderIfConfigured(page, targetAdName) {
  if (!MEDIA_FOLDER_PATH) return;
  const folderPath = path.resolve(MEDIA_FOLDER_PATH);
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.join(folderPath, e.name))
    .filter((f) => /\.(png|jpe?g|webp|gif|mp4|mov)$/i.test(f));

  if (!files.length) throw new Error(`MEDIA_FOLDER_PATH에 업로드 가능한 파일이 없습니다: ${folderPath}`);

  await selectImageAdModeWithRequestedClasses(page);

  const imageAdTab = page.locator('div.x1vvvo52.x1fvot60.xo1l8bm.xxio538.xbsr9hj.xq9mrsl.x1mzt3pk.x1vvkbs.x13faqbe.xeuugli.x1iyjqo2').filter({ hasText: /^이미지 광고$/ }).first();
  if (await imageAdTab.isVisible({ timeout: 8000 }).catch(() => false)) {
    await page.waitForTimeout(3000);
    await imageAdTab.click({ force: true }).catch(() => null);
    await page.waitForTimeout(3000);
  }

  const uploadButton = page.locator('div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g.xuxw1ft.x6ikm8r.x10wlt62.xlyipyv.x1h4wwuj.xeuugli').filter({ hasText: /^업로드$/ }).first();
  if (await uploadButton.isVisible({ timeout: 10000 }).catch(() => false)) {
    await uploadButton.click({ force: true }).catch(async () => {
      const box = await uploadButton.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    });
    await page.waitForTimeout(5000);
  }

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ timeout: 30000 });
  await fileInput.setInputFiles(files);
  await page.waitForTimeout(7000);

  const mediaSearch = page.locator('input[placeholder="미디어 검색"]').first();
  if (await mediaSearch.isVisible({ timeout: 10000 }).catch(() => false)) {
    await mediaSearch.click({ force: true });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(targetAdName, { delay: 40 });
    await page.waitForTimeout(5000);
    console.log('[STEP] 업로드 후 미디어 검색:', { targetAdName });
  }
}


async function openCreativeSettingsAndFillLandingUrl(page, targetAdName) {
  const creativeSettings = page.locator('div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g.xuxw1ft.x6ikm8r.x10wlt62.xlyipyv.x1h4wwuj.xeuugli.x1iyjqo2').filter({ hasText: /^크리에이티브 설정$/ }).first();
  const imageAdTab = page.locator('div.x1vvvo52.x1fvot60.xo1l8bm.xxio538.xbsr9hj.xq9mrsl.x1mzt3pk.x1vvkbs.x13faqbe.xeuugli.x1iyjqo2').filter({ hasText: /^이미지 광고$/ }).first();
  const uploadButton = page.locator('div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g.xuxw1ft.x6ikm8r.x10wlt62.xlyipyv.x1h4wwuj.xeuugli').filter({ hasText: /^업로드$/ }).first();

  let creativeOpened = false;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    console.log(`[STEP] 크리에이티브 설정 진입 시도 ${attempt}/10`);
    const creativeVisible = await creativeSettings.isVisible({ timeout: 10000 }).catch(() => false);
    if (!creativeVisible) {
      console.log(`[WAIT] 크리에이티브 설정 버튼 탐색 재시도 ${attempt}/10`);
      await page.waitForTimeout(5000);
      continue;
    }

    await page.waitForTimeout(5000);
    const settingBox = await creativeSettings.boundingBox().catch(() => null);
    console.log('[DEBUG] 크리에이티브 설정 버튼 box:', settingBox);

    let clicked = false;
    await creativeSettings.click({ force: true }).then(() => { clicked = true; }).catch(() => null);

    if (!clicked && settingBox) {
      const clickTargets = [
        { x: settingBox.x + settingBox.width / 2, y: settingBox.y + settingBox.height / 2 },
        { x: settingBox.x + settingBox.width / 2 + 12, y: settingBox.y + settingBox.height / 2 },
        { x: settingBox.x + settingBox.width / 2 - 12, y: settingBox.y + settingBox.height / 2 },
        { x: settingBox.x + settingBox.width / 2, y: settingBox.y + settingBox.height / 2 + 8 },
        { x: settingBox.x + settingBox.width / 2, y: settingBox.y + settingBox.height / 2 - 8 },
      ];

      for (const [idx, pt] of clickTargets.entries()) {
        console.log('[DEBUG] 크리에이티브 설정 좌표 클릭 시도:', { attempt, index: idx + 1, pt });
        await page.mouse.click(pt.x, pt.y).catch(() => null);
        await page.waitForTimeout(2000);

        const checkImage = await imageAdTab.isVisible({ timeout: 1000 }).catch(() => false);
        const checkUpload = await uploadButton.isVisible({ timeout: 1000 }).catch(() => false);
        if (checkImage || checkUpload) {
          clicked = true;
          break;
        }
      }
    }

    await page.waitForTimeout(7000);

    const openedByImage = await imageAdTab.isVisible({ timeout: 5000 }).catch(() => false);
    const openedByUpload = await uploadButton.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[DEBUG] 크리에이티브 설정 진입 판정:', { openedByImage, openedByUpload });

    if (openedByImage && openedByUpload) {
      creativeOpened = true;
      console.log('[STEP] 크리에이티브 설정 진입 성공');
      break;
    }

    console.log(`[WAIT] 크리에이티브 설정 진입 확인 재시도 ${attempt}/10`);
    await page.waitForTimeout(5000);
  }

  if (!creativeOpened) {
    await debugDump(page, 'creative settings not opened after retries');
    throw new Error('크리에이티브 설정 진입 실패: 이미지 광고/업로드 확인 불가');
  }

  const targetUrl = `https://repurely.com/surl/P/100?utm_source=f&utm_medium=f&utm_campaign=${targetAdName}`;
  const landingInput = page.locator('input[placeholder="http://www.example.com/page"]').first();
  const landingVisible = await landingInput.isVisible({ timeout: 10000 }).catch(() => false);
  if (landingVisible) {
    console.log('[STEP] 랜딩 URL 입력 시작');
    await landingInput.click({ force: true });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(targetUrl, { delay: 40 });
    await page.waitForTimeout(3000);
    console.log('[STEP] 랜딩 URL 입력 완료:', { targetUrl });
  } else {
    throw new Error('랜딩 URL input을 찾지 못했습니다.');
  }
}

async function renameAdsetsAndAdsSequentially(page, adsetStartIndex = 1, adsetCount = 10, adCreativeCount = 5) {
  console.log('[STEP] 광고세트/광고소재 순차 이름 변경 시작');

  const today = getTodayMMDD();
  let adsetIndex = adsetStartIndex;
  let adCreativeIndex = 1;
  const adsetEndIndex = adsetStartIndex + adsetCount - 1;
  const maxCreativeTotal = adsetCount * adCreativeCount;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await page.waitForTimeout(5000);

    const rows = await page.locator('[role="row"]').elementHandles();
    if (!rows.length) {
      console.log(`[WAIT] row 미탐지 재시도 ${attempt}/10`);
      continue;
    }

    for (const row of rows) {
      const rowText = (await row.innerText().catch(() => '')).trim();
      if (!rowText) continue;

      const rowBox = await row.boundingBox().catch(() => null);
      if (!rowBox) continue;

      const isAdsetCopy = rowText.includes('광고세트') && rowText.includes('사본');
      const isAdCopy = rowText.includes('새 판매 광고') || rowText.includes('광고 - 사본') || rowText.includes('광고명');

      if (isAdsetCopy && adsetIndex <= adsetEndIndex) {
        await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
        await page.waitForTimeout(7000);

        const targetAdsetName = getAdsetName(adsetIndex);
        const adsetInput = page.locator('input[placeholder="여기에 광고 세트 이름을 입력하세요..."], input[placeholder="광고 세트 이름 지정"]').first();
        const visible = await adsetInput.isVisible({ timeout: 5000 }).catch(() => false);
        if (visible) {
          await adsetInput.click({ force: true });
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.type(targetAdsetName, { delay: 60 });
          await page.waitForTimeout(5000);
          console.log('[STEP] 광고세트명 변경:', { targetAdsetName });
          adsetIndex += 1;
        }
        continue;
      }

      if (isAdCopy && adCreativeIndex <= maxCreativeTotal) {
        await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
        await page.waitForTimeout(7000);

        const adNameInput = page.locator('input[placeholder="여기에 광고 이름을 입력하세요..."], input[placeholder*="광고 이름"], input[value*="새 판매 광고"]').first();
        const visible = await adNameInput.isVisible({ timeout: 5000 }).catch(() => false);
        if (!visible) continue;

        const targetAdName = `f_i_o_l_${today}_${String(adCreativeIndex)}`;
        await adNameInput.click({ force: true });
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(targetAdName, { delay: 60 });
        await page.waitForTimeout(5000);
        console.log('[STEP] 광고소재명 변경:', { targetAdName });
        await openCreativeSettingsAndFillLandingUrl(page, targetAdName);

        if (adCreativeIndex === 1 && !firstCreativeMediaUploaded) {
          await page.waitForTimeout(5000);
          await attachMediaFromFolderIfConfigured(page, targetAdName);
          firstCreativeMediaUploaded = true;
          console.log('[STEP] 첫 번째 광고소재 미디어 업로드 완료');
        }

        adCreativeIndex += 1;
      }
    }

    if (adsetIndex > adsetEndIndex && adCreativeIndex > maxCreativeTotal) {
      console.log('[STEP] 광고세트/광고소재 순차 이름 변경 완료');
      return true;
    }

    console.log(`[WAIT] 순차 이름 변경 재탐색 ${attempt}/10`);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(DIRS.screenshots, 'adset-ad-rename-sequence-failed.png'), fullPage: true });
  throw new Error('광고세트/광고소재 순차 이름 변경 실패');
}


async function runCreativeStepOnly(page) {
  console.log('[STEP] QUICK_TEST_CREATIVE_STEP=true - 크리에이티브 단계만 실행');
  await openCreativeSettingsAndFillLandingUrl(page, QUICK_TEST_AD_NAME);
  if (!firstCreativeMediaUploaded) {
    await attachMediaFromFolderIfConfigured(page, QUICK_TEST_AD_NAME);
    firstCreativeMediaUploaded = true;
  }
  await page.screenshot({ path: path.join(DIRS.screenshots, 'quick-creative-step-done.png'), fullPage: true });
}

async function runFlow(page) {
  if (QUICK_TEST_CREATIVE_STEP) {
    await runCreativeStepOnly(page);
    return;
  }

  console.log('[STEP] Ads Manager 접속');
  await page.goto('https://adsmanager.facebook.com/adsmanager/manage/campaigns', { waitUntil: 'domcontentloaded' });
  await ensureLoggedInOrThrow(page);
  await page.screenshot({ path: PATHS.step1, fullPage: true });

  console.log(`[STEP] 광고계정 이동: act=${AD_ACCOUNT_ID}`);
  await page.goto(`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${AD_ACCOUNT_ID}`, { waitUntil: 'domcontentloaded' });
  await pause(page, '광고계정 이동 후 대기', 3000);
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

  for (let n = 0; n < 1; n += 1) {
    const index = ADSET_START_INDEX + n;
    const adsetName = getAdsetName(index);
    console.log(`[STEP] ${n + 1}/1 광고 세트 생성 시작: ${adsetName}`);

    await clickRealCreateButton(page);
    await pause(page, '만들기 버튼 클릭 후 대기', 3000);
    await page.screenshot({ path: PATHS.step5, fullPage: true });
    await enterAdsetFlow(page);
    await pause(page, '광고 세트 생성 화면 진입 후 대기', 3000);
    await page.screenshot({ path: PATHS.step6, fullPage: true });

    await fillAdsetNameInAdsetModalOnly(page, adsetName);

    if (ADSET_DAILY_BUDGET) {
      await pause(page, '일 예산 입력 전 대기', 4000);
      await fillAdsetBudgetInModalOnly(page, ADSET_DAILY_BUDGET);
      await pause(page, '일 예산 입력 후 스케줄링 전 대기', 5000);
    }

    const scheduleReady = await updateDateAndTimeBeforeContinue(page);
    if (!scheduleReady) {
      throw new Error('스케줄링 영역 확인 실패: 날짜 input을 찾지 못했습니다.');
    }

    const adCreativeDuplicateCount = Math.max(AD_CREATIVE_COUNT, 0);
    if (adCreativeDuplicateCount > 0) {
      await pause(page, '스케줄링 후 새 판매 광고 복제 설정 전 대기', 5000);
      await setDuplicateCount(page, adCreativeDuplicateCount, '새 판매 광고');
      await pause(page, '새 판매 광고 복제 설정 후 대기', 7000);
    }

    const adsetDuplicateCount = Math.max(ADSET_COUNT, 0);
    if (adsetDuplicateCount > 0) {
      await pause(page, '스케줄링 후 광고세트 복제 설정 전 대기', 5000);
      await setDuplicateCount(page, adsetDuplicateCount, adsetName);
      await pause(page, '광고세트 복제 설정 후 대기', 7000);
    }

    if (n === 0) {
      await renameAdsetsAndAdsSequentially(page, ADSET_START_INDEX, ADSET_COUNT, AD_CREATIVE_COUNT);
    }

  }

  await page.screenshot({ path: PATHS.success, fullPage: true });

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
