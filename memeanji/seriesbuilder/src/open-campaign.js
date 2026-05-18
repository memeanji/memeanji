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
const SCHEDULE_TIME = process.env.SCHEDULE_TIME || '05:00';
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
  for (let attempt = 1; attempt <= 6; attempt += 1) {
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

  const match = currentDateText.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const nextDate = new Date(year, month - 1, day);
    nextDate.setDate(nextDate.getDate() + 1);

    const nextDateText = `${nextDate.getFullYear()}년 ${nextDate.getMonth() + 1}월 ${nextDate.getDate()}일`;
    await dateInput.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(nextDateText, { delay: 50 });
    await page.waitForTimeout(2000);
    console.log('[DEBUG] updated date value:', await dateInput.inputValue().catch(() => ''));
    await pause(page, '날짜 변경 반영 대기', 2000);
  } else {
    console.log('[DEBUG] 날짜 파싱 실패, 기존 값 유지:', currentDateText);
  }

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

async function openCorrectAdActionMenu(page) {
  console.log('[STEP] 새 판매 광고 row 기준 작업 메뉴 탐색');

  await ensureCampaignStructureRoot(page);
  await page.waitForTimeout(5000);

  const adRow = page.locator('text=새 판매 광고').first();
  await adRow.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(5000);

  const adRowBox = await adRow.boundingBox();
  if (!adRowBox) throw new Error('새 판매 광고 row 위치를 찾지 못했습니다.');

  console.log('[DEBUG] 새 판매 광고 row box:', adRowBox);

  const menuButtonSelector = '[role="button"].x1i10hfl.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x972fbf';
  const menuIconSelector = '.x6s0dn4.x78zum5.x1q0g3np.xozqiw3.x2lwn1j.xeuugli.x1iyjqo2.x8va1my.x1hc1fzr.x13dflua.x6o7n8i.xxziih7.x12w9bfk.xl56j7k.xh8yej3';

  let opened = false;

  for (let attempt = 1; attempt <= 4 && !opened; attempt += 1) {
    console.log(`[STEP] 작업 메뉴 탐색/클릭 시도 ${attempt}/4`);

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

    console.log('[DEBUG] 최종 작업 메뉴 box:', menuBox);
    await page.waitForTimeout(5000);
    await page.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await page.waitForTimeout(10000);

    const duplicateByClass = page.locator('div.x1mcwxda').filter({ hasText: /^복제$/ }).first();
    const duplicateVisible = await duplicateByClass.isVisible({ timeout: 10000 }).catch(() => false);
    const bodyText = await page.locator('body').innerText();

    console.log('[DEBUG] 작업 메뉴 클릭 후 body text:', bodyText.slice(0, 3000));
    console.log('[DEBUG] 복제 버튼 visible:', duplicateVisible);

    if (duplicateVisible || bodyText.includes('이 광고에 대한 작업') || bodyText.includes('복제')) {
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

async function setDuplicateCount(page, count = 5) {
  console.log('[STEP] 복제 옵션 버튼 탐색');
  await openCorrectAdActionMenu(page);

  const duplicateButton = page.locator('div.x1mcwxda').filter({ hasText: /^복제$/ }).first();

  let duplicateClicked = false;
  for (let attempt = 1; attempt <= 4 && !duplicateClicked; attempt += 1) {
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

    console.log(`[WARN] 복제 클릭 후 상태 변화 없음, 재시도 ${attempt}/4`);
  }

  if (!duplicateClicked) {
    await page.screenshot({ path: path.join(DIRS.screenshots, 'duplicate-button-click-failed.png'), fullPage: true });
    throw new Error('복제 버튼 클릭에 실패했습니다.');
  }

  console.log('[STEP] 복제 개수 input 탐색');

  let duplicateInput = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await pause(page, `복제 input 탐색 전 대기 ${attempt}/5`, 3000);
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

    console.log(`[WAIT] 복제 개수 input 탐색 재시도 ${attempt}/5`);
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

  if (await budgetInput.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log(`[STEP] 예산 입력: ${budgetValue}`);
    await budgetInput.first().click();
    await budgetInput.first().fill(String(budgetValue));
  } else {
    console.log('[STEP] 예산 입력창 미감지 - 건너뜀');
  }

}

async function enterAdsetFlow(page) {
  await ensureAdsetCreateOpen(page);
  await page.locator('input[placeholder="광고 세트 이름 지정"], input._58al._aghb').first().waitFor({ state: 'visible', timeout: 180000 });
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

  for (let n = 0; n < ADSET_COUNT; n += 1) {
    const index = ADSET_START_INDEX + n;
    const adsetName = getAdsetName(index);
    console.log(`[STEP] ${n + 1}/${ADSET_COUNT} 광고 세트 생성 시작: ${adsetName}`);

    await clickRealCreateButton(page);
    await pause(page, '만들기 버튼 클릭 후 대기', 3000);
    await page.screenshot({ path: PATHS.step5, fullPage: true });
    await enterAdsetFlow(page);
    await pause(page, '광고 세트 생성 화면 진입 후 대기', 3000);
    await page.screenshot({ path: PATHS.step6, fullPage: true });

    await fillAdsetNameInAdsetModalOnly(page, adsetName);

    const scheduleReady = await updateDateAndTimeBeforeContinue(page);
    if (!scheduleReady) {
      throw new Error('스케줄링 영역 확인 실패: 날짜 input을 찾지 못했습니다.');
    }

    await pause(page, '스케줄링 후 복제 설정 전 대기', 5000);
    await setDuplicateCount(page, 5);
    await pause(page, '복제 설정 후 대기', 7000);

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
