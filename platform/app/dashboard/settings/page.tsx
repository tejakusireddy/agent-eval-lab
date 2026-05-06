import { redirect } from "next/navigation";

import { AppLayout } from "@/components/layout/app-layout";
import { EnterpriseSettings } from "@/components/settings/enterprise-settings";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SettingsPage() {
  const { userId } = getAuth();
  if (!userId) {
    redirect("/");
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <EnterpriseSettings />
      </div>
    </AppLayout>
  );
}
