import { NextResponse } from "next/server";
import { loadScenarioCatalog } from "@/lib/server-scenarios";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const { scenarios, categories } = await loadScenarioCatalog();

    return NextResponse.json({
      scenarios,
      categories,
      total: scenarios.length,
    });
  } catch (error: any) {
    console.error("Scenarios API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Failed to load scenarios",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
