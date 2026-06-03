import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  type MetaFunction,
  json,
  redirect,
} from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  FormLayout,
  TextField,
  Banner,
  DataTable,
  Divider,
  Box,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import type { Env } from "~/load-context";
import { isValidShop } from "~/lib/shopify.server";
import { loadOfflineSession } from "~/lib/session-storage.server";
import { shopifyAdmin } from "~/lib/shopify-api.server";
import { authenticate } from "~/lib/shopify.server";
import { captureSetupStep } from "~/lib/merchant-qa.server";
import { getDb } from "~/lib/db/client.server";
import { backInStockSubscriptions, backInStockSettings } from "~/lib/db/schema.server";
import { eq, desc, count } from "drizzle-orm";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context.cloudflare?.env ?? {}) as Env;
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (!shop || !isValidShop(shop)) {
    throw new Response("Missing or invalid ?shop", { status: 400 });
  }

  const session = await loadOfflineSession(context, shop);
  if (!session) {
    throw redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  }

  const db = getDb(env.D1);

  // Load settings for this shop
  let settings = null;
  let totalSubscriptions = 0;
  let recentSubscriptions: Array<{
    id: string;
    productTitle: string;
    variantTitle: string | null;
    customerEmail: string;
    createdAt: string | null;
    notifiedAt: string | null;
  }> = [];

  try {
    const settingsRows = await db
      .select()
      .from(backInStockSettings)
      .where(eq(backInStockSettings.shop, shop))
      .limit(1);
    settings = settingsRows[0] ?? null;

    const countResult = await db
      .select({ value: count() })
      .from(backInStockSubscriptions)
      .where(eq(backInStockSubscriptions.shop, shop));
    totalSubscriptions = countResult[0]?.value ?? 0;

    recentSubscriptions = await db
      .select()
      .from(backInStockSubscriptions)
      .where(eq(backInStockSubscriptions.shop, shop))
      .orderBy(desc(backInStockSubscriptions.createdAt))
      .limit(10);
  } catch {
    // Tables may not exist yet on first load — gracefully degrade
  }

  return json({
    shop,
    apiKey: env.SHOPIFY_API_KEY ?? "",
    settings,
    totalSubscriptions,
    recentSubscriptions,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { session, shop } = await authenticate.admin(request, context);
  const env = (context.cloudflare?.env ?? {}) as Env;
  const db = getDb(env.D1);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save_settings") {
    const emailSubject = (formData.get("emailSubject") as string) ?? "Your item is back in stock!";
    const emailBody = (formData.get("emailBody") as string) ?? "";
    const alertsEnabled = formData.get("alertsEnabled") === "true";

    try {
      await db
        .insert(backInStockSettings)
        .values({
          shop,
          emailSubject,
          emailBody,
          alertsEnabled,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: backInStockSettings.shop,
          set: {
            emailSubject,
            emailBody,
            alertsEnabled,
            updatedAt: new Date().toISOString(),
          },
        });

      await captureSetupStep(env, "configured_alerts", {
        enabled: String(alertsEnabled),
        shop,
      });

      return json({ success: true, message: "Settings saved successfully." });
    } catch (err) {
      return json({ success: false, message: "Failed to save settings. Please try again." }, { status: 500 });
    }
  }

  return json({ success: false, message: "Unknown action." }, { status: 400 });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: "Back in Stock Alerts" },
  { name: "shopify-api-key", content: data?.apiKey ?? "" },
];

export default function AppIndex() {
  const { shop, settings, totalSubscriptions, recentSubscriptions } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(
    settings?.alertsEnabled ?? true
  );
  const [emailSubject, setEmailSubject] = useState<string>(
    settings?.emailSubject ?? "Your item is back in stock!"
  );
  const [emailBody, setEmailBody] = useState<string>(
    settings?.emailBody ??
      "Great news! The item you were waiting for is now available. Visit our store to purchase it before it sells out again."
  );

  const handleAlertsToggle = useCallback(() => {
    setAlertsEnabled((prev) => !prev);
  }, []);

  const tableRows = recentSubscriptions.map((sub) => [
    sub.customerEmail,
    sub.productTitle,
    sub.variantTitle ?? "—",
    sub.notifiedAt ? "Notified" : "Waiting",
    sub.createdAt ? new Date(sub.createdAt).toLocaleDateString() : "—",
  ]);

  return (
    <Page
      title="Back in Stock Alerts"
      subtitle={`Installed on ${shop}`}
    >
      <Layout>
        {actionData && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => {}}
            >
              <Text as="p">{actionData.message}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Status Overview */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Status Overview
              </Text>
              <InlineStack gap="400" align="start">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Alerts Status
                  </Text>
                  <Badge tone={alertsEnabled ? "success" : "warning"}>
                    {alertsEnabled ? "Active" : "Paused"}
                  </Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total Subscriptions
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {totalSubscriptions}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Notified
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {recentSubscriptions.filter((s) => s.notifiedAt).length}
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Settings Panel */}
        <Layout.Section>
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="save_settings" />
              <input
                type="hidden"
                name="alertsEnabled"
                value={String(alertsEnabled)}
              />
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Alert Settings
                </Text>
                <FormLayout>
                  <InlineStack gap="300" align="start" blockAlign="center">
                    <Text as="p" variant="bodyMd">
                      Alerts are currently{" "}
                      <strong>{alertsEnabled ? "enabled" : "disabled"}</strong>.
                    </Text>
                    <button
                      type="button"
                      onClick={handleAlertsToggle}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "1px solid #ccc",
                        background: alertsEnabled ? "#f6f6f7" : "#008060",
                        color: alertsEnabled ? "#333" : "#fff",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                    >
                      {alertsEnabled ? "Disable Alerts" : "Enable Alerts"}
                    </button>
                  </InlineStack>
                  <TextField
                    label="Email Subject"
                    name="emailSubject"
                    value={emailSubject}
                    onChange={setEmailSubject}
                    autoComplete="off"
                    helpText="Subject line for the back-in-stock notification email."
                  />
                  <TextField
                    label="Email Body"
                    name="emailBody"
                    value={emailBody}
                    onChange={setEmailBody}
                    multiline={4}
                    autoComplete="off"
                    helpText="Message body sent to customers when their item is restocked."
                  />
                </FormLayout>
                <Divider />
                <InlineStack align="end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 20px",
                      borderRadius: 6,
                      border: "none",
                      background: "#008060",
                      color: "#fff",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      opacity: isSubmitting ? 0.7 : 1,
                    }}
                  >
                    {isSubmitting ? "Saving…" : "Save Settings"}
                  </button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        {/* Recent Subscriptions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recent Subscriptions
              </Text>
              {recentSubscriptions.length === 0 ? (
                <Box paddingBlockEnd="400">
                  <Text as="p" tone="subdued">
                    No subscriptions yet. Once customers subscribe to out-of-stock
                    products, they will appear here.
                  </Text>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={[
                    "Customer Email",
                    "Product",
                    "Variant",
                    "Status",
                    "Subscribed On",
                  ]}
                  rows={tableRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Customer Widget Info */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Customer Subscription Widget
              </Text>
              <Text as="p" tone="subdued">
                Customers can subscribe to out-of-stock products via the
                subscription form. Share the link below or embed it on your
                storefront.
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {`https://<your-app-domain>/customer/back-in-stock?shop=${shop}`}
                </Text>
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                Replace{" "}
                <code>&lt;your-app-domain&gt;</code> with your deployed app
                domain. Customers can visit this page directly or you can embed
                it in your theme.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}