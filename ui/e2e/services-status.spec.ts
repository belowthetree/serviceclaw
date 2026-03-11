import { test, expect } from "@playwright/test";

// Test data for mocking service states
const mockServices = [
  {
    id: "svc-1",
    name: "Test Service 1",
    state: "enabled",
    triggerType: "cron",
  },
  {
    id: "svc-2",
    name: "Test Service 2",
    state: "disabled",
    triggerType: "webhook",
  },
];

test.describe("Services Status Page", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the control UI
    await page.goto("/");
    // Wait for the page to be fully loaded
    await page.waitForLoadState("networkidle");
  });

  test("page loads and displays service list", async ({ page }) => {
    // Navigate to services status tab/page
    await page.click('[data-testid="tab-services"]');

    // Wait for service list container to be visible
    const serviceList = page.locator('[data-testid="service-list"]');
    await expect(serviceList).toBeVisible();

    // Take screenshot of initial load
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-initial.png",
      fullPage: true,
    });
  });

  test("service states display correctly", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');

    // Wait for service list to be visible
    await page.waitForSelector('[data-testid="service-list"]');

    // Verify service rows are rendered
    const serviceRows = page.locator('[data-testid^="service-row-"]');
    await expect(serviceRows).toHaveCount(2);

    // Check first service (enabled) status badge
    const firstServiceStatus = page.locator('[data-testid="service-status-svc-1"]');
    await expect(firstServiceStatus).toBeVisible();
    await expect(firstServiceStatus).toHaveText("Enabled");

    // Check second service (disabled) status badge
    const secondServiceStatus = page.locator('[data-testid="service-status-svc-2"]');
    await expect(secondServiceStatus).toBeVisible();
    await expect(secondServiceStatus).toHaveText("Disabled");

    // Take screenshot of service states
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-states.png",
      fullPage: true,
    });
  });

  test("enable button appears for disabled services", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Check that disabled service has an enable button
    const disabledServiceAction = page.locator('[data-testid="service-action-svc-2"]');
    await expect(disabledServiceAction).toBeVisible();
    await expect(disabledServiceAction).toHaveText("Enable");

    // Verify button styling (btn-primary for enable)
    await expect(disabledServiceAction).toHaveClass(/btn-primary/);

    // Take screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-enable-button.png",
      fullPage: true,
    });
  });

  test("disable button appears for enabled services", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Check that enabled service has a disable button
    const enabledServiceAction = page.locator('[data-testid="service-action-svc-1"]');
    await expect(enabledServiceAction).toBeVisible();
    await expect(enabledServiceAction).toHaveText("Disable");

    // Verify button styling (btn-secondary for disable)
    await expect(enabledServiceAction).toHaveClass(/btn-secondary/);

    // Take screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-disable-button.png",
      fullPage: true,
    });
  });

  test("clicking enable updates service state", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Click enable on the disabled service
    const enableButton = page.locator('[data-testid="service-action-svc-2"]');
    await expect(enableButton).toHaveText("Enable");
    await enableButton.click();

    // Wait for state update (button should change to Disable)
    await page.waitForTimeout(500); // Allow for animation/state update

    // After enabling, the button should change to "Disable"
    const disableButton = page.locator('[data-testid="service-action-svc-2"]');
    await expect(disableButton).toHaveText("Disable");

    // Status badge should update to "Enabled"
    const statusBadge = page.locator('[data-testid="service-status-svc-2"]');
    await expect(statusBadge).toHaveText("Enabled");

    // Take screenshot of updated state
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-after-enable.png",
      fullPage: true,
    });
  });

  test("clicking disable updates service state", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Click disable on the enabled service
    const disableButton = page.locator('[data-testid="service-action-svc-1"]');
    await expect(disableButton).toHaveText("Disable");
    await disableButton.click();

    // Wait for state update
    await page.waitForTimeout(500); // Allow for animation/state update

    // After disabling, the button should change to "Enable"
    const enableButton = page.locator('[data-testid="service-action-svc-1"]');
    await expect(enableButton).toHaveText("Enable");

    // Status badge should update to "Disabled"
    const statusBadge = page.locator('[data-testid="service-status-svc-1"]');
    await expect(statusBadge).toHaveText("Disabled");

    // Take screenshot of updated state
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-after-disable.png",
      fullPage: true,
    });
  });

  test("error handling displays correctly", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Simulate an error scenario by mocking a failed request
    // This would typically be done via route interception
    await page.route("**/services.status", async (route) => {
      await route.fulfill({
        status: 500,
        body: JSON.stringify({ error: "Failed to load services" }),
      });
    });

    // Refresh the page to trigger the error
    await page.reload();
    await page.click('[data-testid="tab-services"]');

    // Wait for error message to appear
    const errorAlert = page.locator('[role="alert"]');
    await expect(errorAlert).toBeVisible();

    // Take screenshot of error state
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-error.png",
      fullPage: true,
    });

    // Unroute to clean up
    await page.unroute("**/services.status");
  });

  test("empty state displays when no services", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');

    // Mock empty services response
    await page.route("**/services.status", async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ services: [] }),
      });
    });

    // Refresh to trigger empty state
    await page.reload();
    await page.click('[data-testid="tab-services"]');
    await page.waitForTimeout(500);

    // Check for empty state message
    const emptyState = page.locator('[role="status"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No services installed");

    // Take screenshot of empty state
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-empty.png",
      fullPage: true,
    });

    // Unroute to clean up
    await page.unroute("**/services.status");
  });

  test("loading state displays correctly", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');

    // Mock a delayed response to show loading state
    await page.route("**/services.status", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ services: mockServices }),
      });
    });

    // Refresh to trigger loading state
    await page.reload();
    await page.click('[data-testid="tab-services"]"');

    // Check for loading indicator
    const loadingState = page.locator('[role="status"]');
    await expect(loadingState).toBeVisible();
    await expect(loadingState).toContainText("Loading");

    // Take screenshot of loading state
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-loading.png",
      fullPage: true,
    });

    // Wait for loading to complete
    await page.waitForSelector('[data-testid="service-list"]');

    // Unroute to clean up
    await page.unroute("**/services.status");
  });

  test("service row structure is correct", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Check first service row structure
    const firstRow = page.locator('[data-testid="service-row-svc-1"]');
    await expect(firstRow).toBeVisible();

    // Verify service name is displayed
    await expect(firstRow.locator(".service-name")).toHaveText("Test Service 1");

    // Verify trigger type is displayed
    await expect(firstRow.locator(".trigger-type")).toHaveText("Scheduled");

    // Check second service row
    const secondRow = page.locator('[data-testid="service-row-svc-2"]');
    await expect(secondRow).toBeVisible();
    await expect(secondRow.locator(".service-name")).toHaveText("Test Service 2");
    await expect(secondRow.locator(".trigger-type")).toHaveText("Webhook");

    // Take screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-row-structure.png",
      fullPage: true,
    });
  });

  test("status badge colors are correct", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Check enabled status has chip-ok class (green)
    const enabledStatus = page.locator('[data-testid="service-status-svc-1"]');
    await expect(enabledStatus).toHaveClass(/chip-ok/);

    // Check disabled status has chip-warn class (orange)
    const disabledStatus = page.locator('[data-testid="service-status-svc-2"]');
    await expect(disabledStatus).toHaveClass(/chip-warn/);

    // Take screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-badge-colors.png",
      fullPage: true,
    });
  });

  test("header and description are displayed", async ({ page }) => {
    await page.click('[data-testid="tab-services"]');
    await page.waitForSelector('[data-testid="service-list"]');

    // Check header title
    const headerTitle = page.locator(".services-status-header__title");
    await expect(headerTitle).toBeVisible();
    await expect(headerTitle).toContainText("Services Status");

    // Check header description
    const headerDescription = page.locator(".services-status-header__description");
    await expect(headerDescription).toBeVisible();
    await expect(headerDescription).toContainText(
      "View and manage your installed automation services",
    );

    // Take screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/task-13-e2e-results/services-status-header.png",
      fullPage: true,
    });
  });
});
