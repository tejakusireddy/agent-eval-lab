import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/app-layout";
import { BatchResultsViewer } from "@/components/batch/batch-results-viewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BatchDetailsPage({
  params,
}: {
  params: Promise<{ batchId: string }> | { batchId: string };
}) {
  const { userId } = getAuth();
  if (!userId) {
    redirect("/");
  }

  const resolved = await Promise.resolve(params);

  return (
    <AppLayout>
      <BatchResultsViewer batchId={resolved.batchId} />
    </AppLayout>
  );
}
