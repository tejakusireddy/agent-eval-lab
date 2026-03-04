import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function SettingsPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-2 text-gray-600">Manage your account and preferences</p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                API key management coming soon
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Billing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Billing management coming soon
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
