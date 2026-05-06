import { AppLayout } from "@/components/layout/app-layout";
import { IntegrationQuickstart } from "@/components/integrations/quickstart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function IntegrationsPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl">
        <IntegrationQuickstart />
      </div>
    </AppLayout>
  );
}
