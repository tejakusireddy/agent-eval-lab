import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Agent Evaluation Lab | Automated AI Agent Testing",
  description:
    "Red teaming, safety scoring, and reliability testing for AI agents — in one command.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  const clerkSecret = process.env.CLERK_SECRET_KEY || "";
  
  const clerkEnabled =
    clerkKey &&
    clerkKey !== "pk_test_..." &&
    clerkKey.startsWith("pk_") &&
    clerkSecret &&
    clerkSecret !== "sk_test_..." &&
    clerkSecret.startsWith("sk_");

  const content = (
    <html lang="en">
      <body className={`${plexSans.variable} antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );

  // Only use ClerkProvider if keys are valid
  if (clerkEnabled) {
    try {
      // Dynamic import to avoid errors when Clerk is disabled
      const { ClerkProvider } = require("@clerk/nextjs");
      return <ClerkProvider>{content}</ClerkProvider>;
    } catch (error) {
      // Clerk initialization failed
      return content;
    }
  }

  return content;
}
