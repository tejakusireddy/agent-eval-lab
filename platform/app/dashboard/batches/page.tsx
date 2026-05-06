import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/app-layout";
import { BatchList } from "@/components/batch/batch-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BatchDashboardPage() {
  const { userId } = getAuth();
  if (!userId) {
    redirect("/");
  }

  return (
    <AppLayout>
      <BatchList />
    </AppLayout>
  );
}
