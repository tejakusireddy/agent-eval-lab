import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { verifyEvidencePackSignature } from "@/lib/release-gate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const { userId } = getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const evidence = body?.evidence && typeof body.evidence === "object" ? body.evidence : body;
    if (!evidence || typeof evidence !== "object") {
      return NextResponse.json(
        { error: "Invalid payload: provide an evidence object" },
        { status: 400 }
      );
    }

    const verification = verifyEvidencePackSignature(
      evidence as Record<string, unknown>,
      process.env.EVIDENCE_SIGNING_KEY || null
    );

    return NextResponse.json({
      success: true,
      valid:
        verification.hashValid &&
        (!verification.signatureChecked || verification.signatureValid),
      verification,
      notes: {
        signatureChecked: verification.signatureChecked
          ? "signature validated using server signing key"
          : "signature was not validated (missing signature in evidence or EVIDENCE_SIGNING_KEY not configured on server)",
      },
    });
  } catch (error: any) {
    console.error("Evidence verification error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
