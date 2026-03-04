import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher(["/", "/scenarios", "/api/scenarios"]);

// Only enable Clerk if keys are properly configured
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const clerkSecret = process.env.CLERK_SECRET_KEY || "";

const clerkEnabled =
  clerkKey &&
  clerkKey !== "pk_test_..." &&
  clerkKey.startsWith("pk_") &&
  clerkSecret &&
  clerkSecret !== "sk_test_..." &&
  clerkSecret.startsWith("sk_");

export default clerkEnabled
  ? clerkMiddleware((auth, req) => {
      if (!isPublicRoute(req)) {
        auth().protect();
      }
    })
  : (req: NextRequest) => {
      // No-op middleware when Clerk is disabled
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};

