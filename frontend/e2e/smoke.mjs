import assert from 'node:assert/strict';
import { chromium, request } from 'playwright';

const appBaseUrl = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4200').replace(/\/$/, '');
const apiBaseUrl = (process.env.E2E_API_URL ?? `${appBaseUrl}/api/v1`).replace(/\/$/, '');
const email = process.env.E2E_EMAIL ?? `smoke-${Date.now()}@example.com`;
const password = process.env.E2E_PASSWORD ?? 'Smoke-test-password-123!';
const suffix = Date.now().toString();

async function requireOk(response, operation) {
  assert.equal(response.ok(), true, `${operation} failed with HTTP ${response.status()}`);
}

const api = await request.newContext({ baseURL: apiBaseUrl });
const browser = await chromium.launch();

try {
  const setup = await api.get('/auth/setup-status');
  await requireOk(setup, 'checking setup status');

  if ((await setup.json()).needs_setup) {
    const register = await api.post('/auth/register', {
      data: {
        email,
        password,
        display_name: 'Browser Smoke Test',
        base_currency: 'BRL',
      },
    });
    await requireOk(register, 'registering smoke user');
  } else {
    assert.ok(
      process.env.E2E_EMAIL && process.env.E2E_PASSWORD,
      'Set E2E_EMAIL and E2E_PASSWORD when the backend already has a user',
    );
    const login = await api.post('/auth/login', { data: { email, password } });
    await requireOk(login, 'logging in API setup session');
  }

  const preferences = await api.get('/auth/preferences');
  await requireOk(preferences, 'reading preferences');
  const currency = (await preferences.json()).base_currency;
  const csrf = async () => {
    const cookie = (await api.storageState()).cookies.find((item) => item.name === 'XSRF-TOKEN');
    assert.ok(cookie, 'API setup session did not receive a CSRF cookie');
    return decodeURIComponent(cookie.value);
  };
  const mutate = async (path, data) =>
    api.post(path, { data, headers: { 'X-XSRF-TOKEN': await csrf() } });

  const account = await mutate('/accounts', {
    name: `Browser Smoke ${suffix}`,
    type: 'checking',
    currency,
    opening_balance: '0',
    archived: false,
  });
  await requireOk(account, 'creating smoke account');
  const accountId = (await account.json()).id;

  const categoryGroup = await mutate('/category-groups', {
    name: `Browser Smoke ${suffix}`,
    kind: 'expense',
    color: '#1F5C6B',
    icon: 'wallet',
  });
  await requireOk(categoryGroup, 'creating smoke category group');
  const categoryGroupId = (await categoryGroup.json()).id;

  const category = await mutate('/categories', {
    name: `Browser Smoke ${suffix}`,
    kind: 'expense',
    group_id: categoryGroupId,
    color: '#1F5C6B',
    icon: 'wallet',
  });
  await requireOk(category, 'creating smoke category');
  const categoryId = (await category.json()).id;

  const page = await browser.newPage();
  await page.goto(`${appBaseUrl}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '');

  await page.goto(`${appBaseUrl}/transactions`);
  await page.locator('app-page-header button').first().click();
  await page.locator('#tx-amount').fill('12.34');
  await page.locator('#tx-account').selectOption(accountId);
  await page.locator('#tx-category').selectOption(categoryId);
  await page.locator('#tx-description').fill(`Browser smoke ${suffix}`);
  await page.locator('app-transaction-form-modal form button[type="submit"]').click();

  await assert.doesNotReject(() =>
    page.getByText(`Browser smoke ${suffix}`, { exact: true }).waitFor({ state: 'visible' }),
  );

  // Viewport sweep: Vitest/jsdom has no layout engine and cannot catch a
  // responsive regression, so this is the one place that can. A route with
  // horizontal overflow at a phone/tablet width is exactly the class of bug
  // the mobile pass fixed - routes gated behind admin/agents/investments are
  // skipped since a fresh smoke user won't have them.
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ];
  const routes = [
    '/',
    '/accounts',
    '/transactions',
    '/categories',
    '/rules',
    '/budgets',
    '/goals',
    '/reports',
    '/exchange',
    '/settings',
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(`${appBaseUrl}${route}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(
        overflow <= 1,
        `${route} overflows horizontally by ${overflow}px at ${viewport.width}x${viewport.height}`,
      );
    }
  }
} finally {
  await api.dispose();
  await browser.close();
}
