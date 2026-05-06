// Safe auth wrapper that works with or without Clerk
export function getAuth() {
  try {
    const clerkEnabled =
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_..." &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_") &&
      process.env.CLERK_SECRET_KEY &&
      process.env.CLERK_SECRET_KEY !== "sk_test_..." &&
      process.env.CLERK_SECRET_KEY.startsWith("sk_");

    if (clerkEnabled) {
      try {
        // Dynamic import to avoid errors when Clerk is disabled
        const { auth } = require("@clerk/nextjs");
        const authResult = auth();
        if (authResult && authResult.userId) {
          return authResult;
        }
      } catch (error) {
        // Fallback if Clerk fails to load
        console.warn("Clerk auth failed, using dev mode:", error);
      }
    }
  } catch (error) {
    console.warn("Auth check failed, using dev mode:", error);
  }

  const bypassEnabled =
    process.env.DEV_AUTH_BYPASS === "true" || process.env.NODE_ENV !== "production";

  if (bypassEnabled) {
    // Return mock auth when Clerk is disabled (development/local demos)
    return {
      userId: "dev-user-123",
      orgId: "dev-org-123",
      sessionId: null,
    };
  }

  return {
    userId: null,
    orgId: null,
    sessionId: null,
  };
}
