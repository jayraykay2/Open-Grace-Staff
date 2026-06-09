// Open Grace LLC | Mobile flow tests — CFS Staff App (v5)
// Viewport: 375×812 (iPhone 14 / SE proxy)
//
// Flows covered:
//   1. App load ("login") — no auth system; verifies tool is accessible and ready
//   2. Dashboard load      — stats render, deadline banners, recent contacts
//   3. Create client + intake contact — add consumer, then log a full contact
//   4. Update service status — change a consumer's status in the Consumers tab
//   5. Add follow-up — log a contact with a follow-up flag, verify it surfaces
//   6. Submit / report outcome — generate a quarterly report, verify output
//   7. Mobile navigation — all six tabs reachable by tap on a small screen
//
// PHI note: all test data is fake. No real client names, UCIs, or dates are used.

const { test, expect } = require('@playwright/test');
const path = require('path');

const TOOL = `file://${path.resolve(
  __dirname,
  '../../Director Folder/OpenGrace_CFS_App_v4.html'
)}`;

// ── SHARED VIEWPORT ────────────────────────────────────────────────────────
const MOBILE = { width: 375, height: 812 };

// ── FAKE DATA ──────────────────────────────────────────────────────────────
const CONSUMER = {
  name:   'Test Consumer',
  rc:     'RC-TEST-0000',
  lang:   'English',
  enroll: '2026-01-01',
  staff:  'Test Staff',
  status: 'Active',
};

const LOG = {
  date:     '2026-04-15',
  staff:    'Test Staff',
  type:     'In-Person Home Visit',
  hours:    '1.5',
  ipp:      'Goal 1 – Daily living skills',
  notes:    'Consumer was present and engaged. Progress toward Goal 1 observed.',
  followup: 'Yes - Minor',
  nextdate: '2026-04-22',
};

const INCIDENT_LOG = {
  date:     '2026-04-20',
  staff:    'Test Staff',
  type:     'Crisis Response',
  hours:    '2',
  notes:    'Client experienced a behavioral incident. All protocols followed.',
  incident: 'Consumer became distressed. Verbal de-escalation used successfully.',
};

// ── HELPERS ────────────────────────────────────────────────────────────────

/** Open the app at mobile viewport. */
async function openApp(page) {
  await page.setViewportSize(MOBILE);
  await page.goto(TOOL);
  await page.waitForLoadState('domcontentloaded');
}

/** Navigate to a named tab by clicking it. */
async function goToTab(page, name) {
  // Tabs are buttons inside <nav> with text containing the name
  const tab = page.locator('nav .tab', { hasText: new RegExp(name, 'i') });
  await tab.click();
  await page.waitForTimeout(150); // tab transition
}

/** Add a consumer via the Consumers tab form. Returns the consumer name. */
async function addConsumer(page, c = CONSUMER) {
  await goToTab(page, 'Consumers');
  await page.locator('#c-name').fill(c.name);
  await page.locator('#c-rc').fill(c.rc);
  await page.locator('#c-lang').fill(c.lang);
  await page.locator('#c-enroll').fill(c.enroll);
  await page.locator('#c-staff').fill(c.staff);
  await page.locator('#c-status').selectOption(c.status);
  await page.locator('button', { hasText: /Add Consumer/i }).click();
  return c.name;
}

/** Fill and save a contact log entry. `overrides` merges into LOG defaults. */
async function saveLog(page, overrides = {}) {
  const entry = { ...LOG, ...overrides };
  await goToTab(page, 'Log');

  await page.locator('#f-consumer').selectOption({ label: entry.consumer || CONSUMER.name });
  await page.locator('#f-date').fill(entry.date);
  await page.locator('#f-staff').fill(entry.staff);
  await page.locator('#f-type').selectOption(entry.type);
  await page.locator('#f-hours').fill(entry.hours);

  if (entry.ipp) await page.locator('#f-ipp').fill(entry.ipp);

  // Check at least one service
  await page.locator('.f-svc').first().check();

  await page.locator('#f-notes').fill(entry.notes);
  await page.locator('#f-followup').selectOption(entry.followup || 'No');

  if (entry.nextdate) await page.locator('#f-nextdate').fill(entry.nextdate);
  if (entry.incident) await page.locator('#f-incident').fill(entry.incident);

  await page.locator('button', { hasText: /Save Contact Log/i }).click();
  // Wait for success alert to appear then disappear
  await expect(page.locator('#log-alert')).toBeVisible();
}

// ══════════════════════════════════════════════════════════════════════════
// FLOW 1 — APP LOAD ("LOGIN")
// The app has no authentication. "Login" means: the tool opens correctly,
// the header is visible, the nav is present, and the dashboard is the
// default active panel.
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 1 — App Load (mobile)', () => {

  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('header is visible at 375px', async ({ page }) => {
    await expect(page.locator('header')).toBeVisible();
  });

  test('app title shown in header', async ({ page }) => {
    await expect(page.locator('header')).toContainText(/Open Grace/i);
  });

  test('navigation is visible', async ({ page }) => {
    await expect(page.locator('nav')).toBeVisible();
  });

  test('dashboard panel is active by default', async ({ page }) => {
    await expect(page.locator('#panel-dashboard')).toBeVisible();
  });

  test('Import and Export buttons are present in header', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Import/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export/i })).toBeVisible();
  });

  test('session-only warning is shown on load', async ({ page }) => {
    await expect(page.locator('#source-banner')).toContainText(/Session Only|not saved/i);
  });

  test('no PHI in localStorage after load', async ({ page }) => {
    const leaked = await page.evaluate(() =>
      ['og_logs', 'og_consumers', 'og_roster']
        .filter(k => localStorage.getItem(k) !== null)
    );
    expect(leaked).toHaveLength(0);
  });

});

// ══════════════════════════════════════════════════════════════════════════
// FLOW 2 — DASHBOARD LOAD
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 2 — Dashboard load (mobile)', () => {

  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('all four roster stat cards render', async ({ page }) => {
    await expect(page.locator('#rs-active')).toBeVisible();
    await expect(page.locator('#rs-assess')).toBeVisible();
    await expect(page.locator('#rs-new')).toBeVisible();
    await expect(page.locator('#rs-total')).toBeVisible();
  });

  test('all four log stat cards render', async ({ page }) => {
    await expect(page.locator('#s-total')).toBeVisible();
    await expect(page.locator('#s-month')).toBeVisible();
    await expect(page.locator('#s-consumers')).toBeVisible();
    await expect(page.locator('#s-assess')).toBeVisible();
  });

  test('stat cards show 0 with empty data — no crash', async ({ page }) => {
    await expect(page.locator('#s-total')).toHaveText('0');
    await expect(page.locator('#rs-total')).toHaveText('0');
  });

  test('IRC deadlines card is visible', async ({ page }) => {
    await expect(page.locator('.card-title', { hasText: /IRC Deadlines/i })).toBeVisible();
  });

  test('QPR due date is shown', async ({ page }) => {
    await expect(page.locator('#qpr-due')).not.toHaveText('—');
  });

  test('recent contacts card shows empty state message', async ({ page }) => {
    await expect(page.locator('#recent-list')).toContainText(/No contacts logged yet/i);
  });

  test('no 90-day warning banners shown with empty roster', async ({ page }) => {
    const banners = page.locator('.alert-banner');
    await expect(banners).toHaveCount(0);
  });

  test('dashboard updates after a consumer is added', async ({ page }) => {
    await addConsumer(page);
    await goToTab(page, 'Dashboard');
    await expect(page.locator('#s-consumers')).toHaveText('1');
  });

  test('90-day EXPIRED banner appears for overdue roster entry', async ({ page }) => {
    // Inject a roster entry with startDate 91 days ago
    await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 91);
      window.roster = [{
        id: 1, name: 'Overdue Client', dob: '', rc: 'RC-000',
        diagnosis: '', lang: '', enroll: '', status: 'Active',
        startDate: d.toISOString().split('T')[0],
        staff: 'Test Staff', emergency: '', emergencyPhone: '', notes: '',
      }];
      window.updateDashboard();
    });
    await expect(page.locator('.alert-banner-red')).toBeVisible();
    await expect(page.locator('.alert-banner-red')).toContainText(/Expired/i);
  });

  test('90-day APPROACHING banner appears for near-deadline roster entry', async ({ page }) => {
    await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 80); // 10 days remaining
      window.roster = [{
        id: 2, name: 'Soon Client', dob: '', rc: 'RC-001',
        diagnosis: '', lang: '', enroll: '', status: 'Active',
        startDate: d.toISOString().split('T')[0],
        staff: 'Test Staff', emergency: '', emergencyPhone: '', notes: '',
      }];
      window.updateDashboard();
    });
    await expect(page.locator('.alert-banner-orange')).toBeVisible();
    await expect(page.locator('.alert-banner-orange')).toContainText(/Approaching/i);
  });

});

// ══════════════════════════════════════════════════════════════════════════
// FLOW 3 — CREATE CLIENT + INTAKE CONTACT
// Add a consumer manually, then log a contact for them.
// Verify the consumer appears in the dropdown and the record appears in Records.
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 3 — Create client and log intake contact (mobile)', () => {

  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('consumer form is visible on Consumers tab', async ({ page }) => {
    await goToTab(page, 'Consumers');
    await expect(page.locator('#c-name')).toBeVisible();
    await expect(page.locator('#c-status')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add Consumer/i })).toBeVisible();
  });

  test('adding a consumer shows success alert', async ({ page }) => {
    await goToTab(page, 'Consumers');
    await page.locator('#c-name').fill(CONSUMER.name);
    await page.locator('button', { hasText: /Add Consumer/i }).click();
    await expect(page.locator('#consumer-alert')).toBeVisible();
  });

  test('added consumer appears in consumers list', async ({ page }) => {
    await addConsumer(page);
    await expect(page.locator('#consumers-list')).toContainText(CONSUMER.name);
  });

  test('added consumer appears in Log tab dropdown', async ({ page }) => {
    await addConsumer(page);
    await goToTab(page, 'Log');
    const options = await page.locator('#f-consumer option').allTextContents();
    expect(options).toContain(CONSUMER.name);
  });

  test('consumer without name is rejected', async ({ page }) => {
    await goToTab(page, 'Consumers');
    await page.locator('button', { hasText: /Add Consumer/i }).click();
    // Should show browser alert — dialog handler
    page.on('dialog', async dialog => {
      expect(dialog.message()).toMatch(/name/i);
      await dialog.accept();
    });
  });

  test('full log entry saves and confirmation is shown', async ({ page }) => {
    await addConsumer(page);
    await saveLog(page);
    await expect(page.locator('#log-alert')).toBeVisible();
  });

  test('saved log appears in Records tab', async ({ page }) => {
    await addConsumer(page);
    await saveLog(page);
    await goToTab(page, 'Records');
    await expect(page.locator('#records-list')).toContainText(CONSUMER.name);
  });

  test('saved log appears in dashboard recent contacts', async ({ page }) => {
    await addConsumer(page);
    await saveLog(page);
    await goToTab(page, 'Dashboard');
    await expect(page.locator('#recent-list')).toContainText(CONSUMER.name);
  });

  test('dashboard total contacts increments after save', async ({ page }) => {
    await addConsumer(page);
    await saveLog(page);
    await goToTab(page, 'Dashboard');
    await expect(page.locator('#s-total')).toHaveText('1');
  });

  test('log form clears after save', async ({ page }) => {
    await addConsumer(page);
    await saveLog(page);
    await expect(page.locator('#f-notes')).toHaveValue('');
    await expect(page.locator('#f-consumer')).toHaveValue('');
  });

  test('saving without required fields shows validation alert', async ({ page }) => {
    await goToTab(page, 'Log');
    let alerted = false;
    page.on('dialog', async dialog => { alerted = true; await dialog.accept(); });
    await page.locator('button', { hasText: /Save Contact Log/i }).click();
    await page.waitForTimeout(300);
    expect(alerted).toBe(true);
  });

  test('consumer can be removed from consumers list', async ({ page }) => {
    await addConsumer(page);
    page.on('dialog', async d => await d.accept()); // confirm dialog
    await page.locator('.btn-danger-sm').first().click();
    await expect(page.locator('#consumers-list')).not.toContainText(CONSUMER.name);
  });

});

// ══════════════════════════════════════════════════════════════════════════
// FLOW 4 — UPDATE SERVICE STATUS
// Change a consumer's status from Active to On Hold and verify the badge updates.
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 4 — Update service status (mobile)', () => {

  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('status dropdown accepts all four values', async ({ page }) => {
    await goToTab(page, 'Consumers');
    const options = await page.locator('#c-status option').allTextContents();
    expect(options).toContain('Active');
    expect(options).toContain('Assessment Phase');
    expect(options).toContain('On Hold');
    expect(options).toContain('Exited');
  });

  test('consumer added with Assessment Phase status shows correct badge', async ({ page }) => {
    await addConsumer(page, { ...CONSUMER, status: 'Assessment Phase' });
    const card = page.locator('.consumer-card').filter({ hasText: CONSUMER.name });
    await expect(card).toContainText('Assessment Phase');
  });

  test('consumer added as On Hold shows gold badge', async ({ page }) => {
    await addConsumer(page, { ...CONSUMER, status: 'On Hold' });
    const card = page.locator('.consumer-card').filter({ hasText: CONSUMER.name });
    await expect(card.locator('.badge')).toHaveClass(/badge-gold/);
  });

  test('consumer added as Exited shows red badge', async ({ page }) => {
    await addConsumer(page, { ...CONSUMER, status: 'Exited' });
    const card = page.locator('.consumer-card').filter({ hasText: CONSUMER.name });
    await expect(card.locator('.badge')).toHaveClass(/badge-red/);
  });

  test('active consumer count reflects only Active status', async ({ page }) => {
    await addConsumer(page, { ...CONSUMER, name: 'Active One', status: 'Active' });
    await goToTab(page, 'Consumers');
    await addConsumer(page, { ...CONSUMER, name: 'On Hold One', status: 'On Hold' });
    await goToTab(page, 'Dashboard');
    // Only the Active consumer should count toward s-consumers
    await expect(page.locator('#s-consumers')).toHaveText('1');
  });

  test('client roster status filter works on Clients tab', async ({ page }) => {
    // Inject a roster with mixed statuses
    await page.evaluate(() => {
      window.roster = [
        { id: 1, name: 'Active Client', status: 'Active', startDate: '', rc: '', enroll: '', staff: '', lang: '', notes: '' },
        { id: 2, name: 'Exited Client', status: 'Exited', startDate: '', rc: '', enroll: '', staff: '', lang: '', notes: '' },
      ];
      window.renderClients();
    });
    await goToTab(page, 'Clients');
    await page.locator('#client-status-filter').selectOption('Active');
    await expect(page.locator('#clients-list')).toContainText('Active Client');
    await expect(page.locator('#clients-list')).not.toContainText('Exited Client');
  });

  test('clearing status filter shows all clients', async ({ page }) => {
    await page.evaluate(() => {
      window.roster = [
        { id: 1, name: 'Active Client', status: 'Active', startDate: '', rc: '', enroll: '', staff: '', lang: '', notes: '' },
        { id: 2, name: 'Exited Client', status: 'Exited', startDate: '', rc: '', enroll: '', staff: '', lang: '', notes: '' },
      ];
      window.renderClients();
    });
    await goToTab(page, 'Clients');
    await page.locator('#client-status-filter').selectOption('');
    await expect(page.locator('#clients-list')).toContainText('Active Client');
    await expect(page.locator('#clients-list')).toContainText('Exited Client');
  });

});

// ══════════════════════════════════════════════════════════════════════════
// FLOW 5 — ADD FOLLOW-UP
// Log a contact with follow-up flagged. Verify badge on record card.
// Log a contact with an incident note. Verify incident badge.
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 5 — Add follow-up and incident (mobile)', () => {

  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await addConsumer(page);
  });

  test('record with "Yes - Minor" follow-up shows follow-up badge', async ({ page }) => {
    await saveLog(page, { followup: 'Yes - Minor' });
    await goToTab(page, 'Records');
    const card = page.locator('.rec-card').filter({ hasText: CONSUMER.name });
    await expect(card.locator('.badge', { hasText: /Yes - Minor/i })).toBeVisible();
  });

  test('record with "Yes - Urgent" follow-up shows red badge', async ({ page }) => {
    await saveLog(page, { followup: 'Yes - Urgent' });
    await goToTab(page, 'Records');
    const card = page.locator('.rec-card').filter({ hasText: CONSUMER.name });
    await expect(card.locator('.badge-red', { hasText: /Yes - Urgent/i })).toBeVisible();
  });

  test('record with no follow-up shows green badge', async ({ page }) => {
    await saveLog(page, { followup: 'No' });
    await goToTab(page, 'Records');
    const card = page.locator('.rec-card').filter({ hasText: CONSUMER.name });
    await expect(card.locator('.badge-green', { hasText: /No/i })).toBeVisible();
  });

  test('record with incident note shows incident badge', async ({ page }) => {
    await saveLog(page, {
      type:     INCIDENT_LOG.type,
      hours:    INCIDENT_LOG.hours,
      notes:    INCIDENT_LOG.notes,
      incident: INCIDENT_LOG.incident,
      followup: 'No',
    });
    await goToTab(page, 'Records');
    const card = page.locator('.rec-card').filter({ hasText: CONSUMER.name });
    await expect(card.locator('.badge-red', { hasText: /Incident/i })).toBeVisible();
  });

  test('next contact date is saved in the record', async ({ page }) => {
    await saveLog(page, { nextdate: '2026-05-01', followup: 'Yes - Minor' });
    // Verify the value is stored in logs[]
    const nextDate = await page.evaluate(() => window.logs[0]?.nextdate);
    expect(nextDate).toBe('2026-05-01');
  });

  test('record can be deleted', async ({ page }) => {
    await saveLog(page);
    await goToTab(page, 'Records');
    page.on('dialog', async d => await d.accept());
    await page.locator('.btn-danger-sm').first().click();
    await expect(page.locator('#records-list')).not.toContainText(CONSUMER.name);
  });

  test('deleting a record decrements dashboard total', async ({ page }) => {
    await saveLog(page);
    await goToTab(page, 'Dashboard');
    await expect(page.locator('#s-total')).toHaveText('1');
    await goToTab(page, 'Records');
    page.on('dialog', async d => await d.accept());
    await page.locator('.btn-danger-sm').first().click();
    await goToTab(page, 'Dashboard');
    await expect(page.locator('#s-total')).toHaveText('0');
  });

});

// ══════════════════════════════════════════════════════════════════════════
// FLOW 6 — SUBMIT / REPORT OUTCOME
// Generate a quarterly report and verify the output fields.
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 6 — Report outcome (mobile)', () => {

  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await addConsumer(page);
    // Log two contacts in Q2 2026
    await saveLog(page, { date: '2026-04-10', hours: '1.5' });
    await saveLog(page, { date: '2026-05-20', hours: '2.0' });
  });

  test('Reports tab is accessible', async ({ page }) => {
    await goToTab(page, 'Reports');
    await expect(page.locator('#panel-reporting')).toBeVisible();
  });

  test('quarter selector and year input are present', async ({ page }) => {
    await goToTab(page, 'Reports');
    await expect(page.locator('#r-quarter')).toBeVisible();
    await expect(page.locator('#r-year')).toBeVisible();
  });

  test('generate button is present', async ({ page }) => {
    await goToTab(page, 'Reports');
    await expect(page.getByRole('button', { name: /Generate/i })).toBeVisible();
  });

  test('generating report for Q2 2026 shows correct contact count', async ({ page }) => {
    await goToTab(page, 'Reports');
    await page.locator('#r-quarter').selectOption('Q2 (Apr-Jun)');
    await page.locator('#r-year').fill('2026');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.locator('#report-out')).toBeVisible();
    await expect(page.locator('#r-contacts')).toHaveText('2');
  });

  test('generating report shows correct total hours', async ({ page }) => {
    await goToTab(page, 'Reports');
    await page.locator('#r-quarter').selectOption('Q2 (Apr-Jun)');
    await page.locator('#r-year').fill('2026');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.locator('#r-hours')).toHaveText('3.5');
  });

  test('generating report shows 1 unique consumer', async ({ page }) => {
    await goToTab(page, 'Reports');
    await page.locator('#r-quarter').selectOption('Q2 (Apr-Jun)');
    await page.locator('#r-year').fill('2026');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.locator('#r-unique')).toHaveText('1');
  });

  test('report for empty quarter shows 0 contacts', async ({ page }) => {
    await goToTab(page, 'Reports');
    await page.locator('#r-quarter').selectOption('Q1 (Jan-Mar)');
    await page.locator('#r-year').fill('2026');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.locator('#r-contacts')).toHaveText('0');
  });

  test('per-consumer breakdown renders in report output', async ({ page }) => {
    await goToTab(page, 'Reports');
    await page.locator('#r-quarter').selectOption('Q2 (Apr-Jun)');
    await page.locator('#r-year').fill('2026');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.locator('#r-breakdown')).toContainText(CONSUMER.name);
  });

  test('QPR checklist renders with all items', async ({ page }) => {
    await goToTab(page, 'Reports');
    const items = page.locator('.checklist-item');
    await expect(items).toHaveCount(7);
  });

  test('QPR checklist items can be checked', async ({ page }) => {
    await goToTab(page, 'Reports');
    const firstBox = page.locator('.check-box').first();
    await firstBox.click();
    await expect(firstBox).toHaveClass(/checked/);
    await expect(firstBox).toContainText('✓');
  });

  test('export CSV button is present on Reports tab', async ({ page }) => {
    await goToTab(page, 'Reports');
    await expect(page.locator('button', { hasText: /Export All Records/i })).toBeVisible();
  });

  test('export CSV triggers a download', async ({ page }) => {
    await goToTab(page, 'Reports');
    const [ download ] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button', { hasText: /Export All Records/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/OpenGrace_CFS_\d{4}-\d{2}-\d{2}\.csv/);
  });

});

// ══════════════════════════════════════════════════════════════════════════
// FLOW 7 — MOBILE NAVIGATION
// All six tabs must be reachable by tap at 375px.
// Switching tabs shows the correct panel and hides all others.
// ══════════════════════════════════════════════════════════════════════════

test.describe('Flow 7 — Mobile navigation (375px)', () => {

  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('nav is horizontally scrollable at 375px', async ({ page }) => {
    const overflow = await page.locator('nav').evaluate(
      el => getComputedStyle(el).overflowX
    );
    // overflow-x should be auto or scroll to allow tab scrolling on small screens
    // Currently this test will FAIL until Issue #6 is fixed — that is intentional.
    expect(['auto', 'scroll']).toContain(overflow);
  });

  test('Dashboard tab is active on load', async ({ page }) => {
    const activeTab = page.locator('nav .tab.active');
    await expect(activeTab).toContainText(/Dashboard/i);
    await expect(page.locator('#panel-dashboard')).toBeVisible();
  });

  test('tapping Log tab shows Log panel', async ({ page }) => {
    await goToTab(page, 'Log');
    await expect(page.locator('#panel-log')).toBeVisible();
    await expect(page.locator('#panel-dashboard')).not.toBeVisible();
  });

  test('tapping Records tab shows Records panel', async ({ page }) => {
    await goToTab(page, 'Records');
    await expect(page.locator('#panel-records')).toBeVisible();
  });

  test('tapping Clients tab shows Clients panel', async ({ page }) => {
    await goToTab(page, 'Clients');
    await expect(page.locator('#panel-clients')).toBeVisible();
  });

  test('tapping Consumers tab shows Consumers panel', async ({ page }) => {
    await goToTab(page, 'Consumers');
    await expect(page.locator('#panel-consumers')).toBeVisible();
  });

  test('tapping Reports tab shows Reports panel', async ({ page }) => {
    await goToTab(page, 'Reports');
    await expect(page.locator('#panel-reporting')).toBeVisible();
  });

  test('only one panel is visible at a time', async ({ page }) => {
    await goToTab(page, 'Log');
    const visiblePanels = await page.locator('.panel.active').count();
    expect(visiblePanels).toBe(1);
  });

  test('switching tabs scrolls page to top', async ({ page }) => {
    // Scroll down on log tab, then switch — should return to top
    await goToTab(page, 'Log');
    await page.evaluate(() => window.scrollTo(0, 500));
    await goToTab(page, 'Dashboard');
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
  });

  test('all six tab buttons are present', async ({ page }) => {
    await expect(page.locator('nav .tab')).toHaveCount(6);
  });

  test('Records tab search is functional at 375px', async ({ page }) => {
    // Add a consumer and log, then search for them
    await addConsumer(page);
    await saveLog(page);
    await goToTab(page, 'Records');
    await page.locator('#search-q').fill(CONSUMER.name);
    await expect(page.locator('#records-list')).toContainText(CONSUMER.name);
  });

  test('Records tab search with no match shows empty state', async ({ page }) => {
    await addConsumer(page);
    await saveLog(page);
    await goToTab(page, 'Records');
    await page.locator('#search-q').fill('ZZZNOTAREALNAME');
    await expect(page.locator('#records-list')).toContainText(/No records match/i);
  });

  test('touch targets on tab buttons are at least 44px tall', async ({ page }) => {
    const heights = await page.locator('nav .tab').evaluateAll(
      tabs => tabs.map(t => t.getBoundingClientRect().height)
    );
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(44);
    }
  });

  test('form inputs on Log tab are at least 44px tall on mobile', async ({ page }) => {
    await goToTab(page, 'Log');
    const heights = await page.locator('#panel-log input, #panel-log select').evaluateAll(
      inputs => inputs.map(i => i.getBoundingClientRect().height)
    );
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(44);
    }
  });

});
