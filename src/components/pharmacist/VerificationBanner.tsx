"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Clock, ShieldAlert } from "lucide-react";
import type { ShopVerificationStatus } from "@/types/pharmacist";

interface VerificationBannerProps {
  status: ShopVerificationStatus;
  verificationNote?: string | null;
}

export function VerificationBanner({
  status,
  verificationNote,
}: VerificationBannerProps) {
  if (status === "verified") {
    return null;
  }

  if (status === "pending") {
    return (
      <div
        role="status"
        className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-200">
              Submitted — pending platform verification
            </p>
            <p className="text-xs text-amber-200/80">
              Live patient demand and reservation fulfilment actions remain locked
              until verification is approved. You can still configure your profile
              and prepare inventory.
            </p>
          </div>
        </div>
        <Link
          href="/pharmacist/profile"
          className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/30"
        >
          Review Submission
        </Link>
      </div>
    );
  }

  const isRejected = status === "rejected";
  return (
    <div
      role="alert"
      className="mb-6 flex flex-col gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-rose-100 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        {isRejected ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
        )}
        <div>
          <p className="text-sm font-semibold text-rose-200">
            {isRejected ? "Pharmacy verification rejected" : "Pharmacy account suspended"}
          </p>
          <p className="text-xs text-rose-200/80">
            {verificationNote?.trim()
              ? verificationNote
              : "Patient-facing operations are disabled. Please review your pharmacy profile details or contact platform support."}
          </p>
        </div>
      </div>
      <Link
        href="/pharmacist/profile"
        className="shrink-0 rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/30"
      >
        View Profile
      </Link>
    </div>
  );
}
