"use client";

import Link from "next/link";
import { ArrowRight, Terminal } from "lucide-react";

const clerkEnabled =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_..." &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_");

let SignInButton: any = ({ children }: any) => <Link href="/dashboard">{children}</Link>;
let SignUpButton: any = ({ children }: any) => <Link href="/dashboard">{children}</Link>;

if (clerkEnabled) {
  try {
    const clerk = require("@clerk/nextjs");
    SignInButton = clerk.SignInButton;
    SignUpButton = clerk.SignUpButton;
  } catch {
    // Clerk not available
  }
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-gray-900" />
              <span className="text-lg font-semibold text-gray-900">
                Agent Evaluation Lab
              </span>
            </div>
            <div className="flex items-center gap-4">
              <SignInButton mode="modal">
                <button className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors">
                  Get Started
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-semibold leading-tight text-gray-900 tracking-tight md:text-6xl lg:text-7xl">
            Automated Evaluation
            <br />
            Infrastructure for AI Agents
          </h1>
          <p className="mt-6 text-xl text-gray-600 md:text-2xl">
            Red teaming, safety scoring, and reliability testing in one command.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <SignUpButton mode="modal">
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 rounded-md bg-gray-900 px-6 py-3 text-base font-medium text-white hover:bg-gray-800 transition-colors"
              >
                Start Evaluating
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </SignUpButton>
            <Link
              href="/scenarios"
              className="rounded-md border border-gray-300 px-6 py-3 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Browse Scenarios
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-20 max-w-4xl">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-1 shadow-sm">
            <div className="flex items-center gap-2 rounded-t-lg border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400"></div>
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400"></div>
                <div className="h-2.5 w-2.5 rounded-full bg-green-400"></div>
              </div>
              <span className="ml-3 font-mono text-xs text-gray-500">
                agent-eval run-all-scenarios
              </span>
            </div>
            <div className="font-mono text-sm">
              <div className="space-y-1 p-6">
                <div className="text-gray-900">
                  $ agent-eval run-all-scenarios
                </div>
                <div className="text-gray-600">
                  Loaded 101 scenario(s) from scenario_definitions
                </div>
                <div className="text-gray-600">Running evaluations...</div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-gray-900">
                    <span className="text-green-600">PASS</span>
                    <span>safety.jailbreak_basic.v1</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-900">
                    <span className="text-green-600">PASS</span>
                    <span>reliability.rag_missing_context.v1</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-900">
                    <span className="text-yellow-600">FAIL_MINOR</span>
                    <span>safety.pii_leakage_email.v1</span>
                  </div>
                </div>
                <div className="mt-4 text-gray-900">
                  Safety Score: <span className="font-semibold text-green-600">87.5%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-8">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              Safety Testing
            </h3>
            <p className="text-gray-600">
              Comprehensive red teaming scenarios for jailbreaks, prompt injection, and PII leakage.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-8">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              Fast Execution
            </h3>
            <p className="text-gray-600">
              Parallel scenario execution with configurable concurrency and automatic retries.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-8">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              Detailed Reports
            </h3>
            <p className="text-gray-600">
              Markdown, HTML, and JSON reports with actionable insights and safety scores.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-500">Agent Evaluation Lab</span>
            </div>
            <p className="text-sm text-gray-500">
              © 2024 Agent Evaluation Lab. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
