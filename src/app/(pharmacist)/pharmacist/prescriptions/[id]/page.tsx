"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrescriptionViewerPane } from "@/components/pharmacist/PrescriptionViewerPane";
import { VerificationDecisionPanel } from "@/components/pharmacist/VerificationDecisionPanel";
import type { ExtractedMedicineItem, SafetyFlag } from "@/types/contracts";
import type {
  PharmacistMemberRole,
  PrescriptionVerificationStatus,
  VerificationNoteDTO,
} from "@/types/pharmacist";

interface PrescriptionDetailPayload {
  verification: {
    id: string;
    status: PrescriptionVerificationStatus;
  } | null;
  prescription: {
    id: string;
    has_document: boolean;
    extracted_items: Array<Partial<ExtractedMedicineItem>>;
  };
  safety_report: {
    items: Array<{
      temp_id: string;
      is_nti: boolean;
      is_schedule_h: boolean;
      safety_flags: SafetyFlag[];
    }>;
  };
  disclaimers: {
    decision_support: string;
    interaction_coverage: string;
    profile_source: string;
  };
  notes: VerificationNoteDTO[];
  canSignOff: boolean;
  memberRole: PharmacistMemberRole;
}

export default function PharmacistPrescriptionReviewPage() {
  const params = useParams<{ id: string }>();
  const prescriptionId = params?.id ?? "";

  const [detail, setDetail] = useState<PrescriptionDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyDetailResponse = useCallback(async (res: Response) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "Failed to load prescription review.");
      setLoading(false);
      return;
    }
    setDetail(payload as PrescriptionDetailPayload);
    setLoading(false);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!prescriptionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pharmacist/prescriptions/${prescriptionId}`, {
        cache: "no-store",
      });
      await applyDetailResponse(res);
    } catch {
      setError("Network error loading prescription details.");
      setLoading(false);
    }
  }, [applyDetailResponse, prescriptionId]);

  useEffect(() => {
    if (!prescriptionId) return;
    let active = true;
    fetch(`/api/pharmacist/prescriptions/${prescriptionId}`, {
      cache: "no-store",
    })
      .then((res) => {
        if (active) return applyDetailResponse(res);
      })
      .catch(() => {
        if (active) {
          setError("Network error loading prescription details.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [applyDetailResponse, prescriptionId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/pharmacist/prescriptions"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Verification Queue
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-white">
            Prescription Clinical Review
          </h1>
          <p className="font-mono text-xs text-slate-400">
            ID: {prescriptionId}
          </p>
        </div>
      </div>

      {loading && !detail ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-96 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-96 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        </div>
      ) : error || !detail ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          <p>{error || "Prescription review unavailable."}</p>
          <button
            type="button"
            onClick={refreshDetail}
            className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1 text-xs hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PrescriptionViewerPane
            prescriptionId={detail.prescription.id}
            hasDocument={detail.prescription.has_document}
          />
          <VerificationDecisionPanel
            key={`${detail.prescription.id}-${detail.verification?.status ?? "pending_review"}-${detail.notes.length}`}
            prescriptionId={detail.prescription.id}
            currentStatus={
              detail.verification?.status ?? "pending_review"
            }
            canSignOff={detail.canSignOff}
            memberRole={detail.memberRole}
            extractedItems={detail.prescription.extracted_items}
            safetyItems={detail.safety_report.items}
            disclaimers={detail.disclaimers}
            notes={detail.notes}
            onVerified={refreshDetail}
          />
        </div>
      )}
    </div>
  );
}
