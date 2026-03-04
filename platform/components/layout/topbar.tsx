"use client";

const clerkEnabled =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_..." &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_");

let UserButton: any = () => null;
if (clerkEnabled) {
  try {
    const clerk = require("@clerk/nextjs");
    UserButton = clerk.UserButton;
  } catch {
    // Clerk not available
  }
}

export function TopBar() {
  return (
    <div className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">Default Project</span>
      </div>
      <div className="flex items-center gap-4">
        <UserButton afterSignOutUrl="/" />
      </div>
    </div>
  );
}

