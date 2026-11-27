"use client";

/**
 * src/app/(patient)/review/page.tsx
 *
 * Dedicated Prescription Review & Medicine Confirmation Page.
 * Wires into Part A medicine search, fuzzy matching, clinical safety flags, and P2->P3 handoff.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import React, { useState } from "react";
import { PrescriptionReviewFlow } from "@/components/clinical/PrescriptionReviewFlow";
import {
  confirmedMedicinesToPlanItems,
  type ConfirmedMedicine,
  type ExtractedMedicineItem,
} from "@/types/contracts";
import { CLINICAL_DISCLAIMERS } from "@/lib/clinical/safety-check";
import { CheckCircle2, ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";

const SAMPLE_DEMO_ITEMS: ExtractedMedicineItem[] = [
  {
    temp_id: "demo_item_1",
    raw_text: "Tab Augmentin 625 Duo",
    matched_medicine_id: "fa842009-26d5-4730-8ee1-c0bc4eea35e4",
    brand_name: "Augmentin 625 Duo Tablet",
    composition_display: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
    composition_key: "amoxycillin (500mg)|clavulanic acid (125mg)",
    dose: "1 tablet twice daily after meals",
    duration: "5 days",
    confidence: "high",
    is_nti: false,
    is_schedule_h: true,
    allow_alternative: true,
    safety_flags: [
      {
        severity: "amber",
        category: "schedule_h",
        message: "Schedule H prescription drug. Valid prescription & pharmacist verification required.",
        disclaimer: CLINICAL_DISCLAIMERS.schedule_h,
      },
    ],
    match_status: "auto_matched",
    suggestions: [
      {
        medicine_id: "fa842009-26d5-4730-8ee1-c0bc4eea35e4",
        brand_name: "Augmentin 625 Duo Tablet",
        composition_display: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
        similarity: 0.95,
      },
      {
        medicine_id: "aeba45a6-a99f-4a3f-8e48-3e6a154988b8",
        brand_name: "Mox CV 625 Tablet",
        composition_display: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
        similarity: 0.78,
      },
    ],
  },
  {
    temp_id: "demo_item_2",
    raw_text: "Cap Pan-D (unclear handwriting)",
    matched_medicine_id: null,
    brand_name: "Pan-D Capsule PR",
    composition_display: "Domperidone (30mg) + Pantoprazole (40mg)",
    composition_key: "domperidone (30mg)|pantoprazole (40mg)",
    dose: "1 capsule empty stomach in morning",
    duration: "10 days",
    confidence: "amber",
    is_nti: false,
    is_schedule_h: true,
    allow_alternative: true,
    safety_flags: [
      {
        severity: "amber",
        category: "schedule_h",
        message: "Schedule H prescription drug. Valid prescription & pharmacist verification required.",
        disclaimer: CLINICAL_DISCLAIMERS.schedule_h,
      },
    ],
    match_status: "needs_selection",
    suggestions: [
      {
        medicine_id: "2d79e6c0-db44-4d3a-9aec-b0a963b0827e",
        brand_name: "Pan-D Capsule PR",
        composition_display: "Domperidone (30mg) + Pantoprazole (40mg)",
        similarity: 0.86,
      },
      {
        medicine_id: "d42264d4-3cf0-4494-9c17-9c13e20d24ce",
        brand_name: "Pantocid DSR Capsule",
        composition_display: "Domperidone (30mg) + Pantoprazole (40mg)",
        similarity: 0.72,
      },
    ],
  },
  {
    temp_id: "demo_item_3",
    raw_text: "Tab ZEN 200",
    matched_medicine_id: "1171f843-a7f6-4de8-9c6b-364b6ea145f7",
    brand_name: "ZEN 200 Tablet",
    composition_display: "Carbamazepine (200mg)",
    composition_key: "carbamazepine (200mg)",
    dose: "1 tablet at bedtime",
    duration: "30 days",
    confidence: "high",
    is_nti: true,
    is_schedule_h: true,
    allow_alternative: false,
    safety_flags: [
      {
        severity: "amber",
        category: "nti_lock",
        message: "Narrow Therapeutic Index medicine (carbamazepine) detected. Brand substitution is clinically locked.",
        disclaimer: CLINICAL_DISCLAIMERS.nti_lock,
      },
      {
        severity: "amber",
        category: "schedule_h",
        message: "Schedule H prescription drug. Valid prescription & pharmacist verification required.",
        disclaimer: CLINICAL_DISCLAIMERS.schedule_h,
      },
    ],
    match_status: "auto_matched",
    suggestions: [
      {
        medicine_id: "1171f843-a7f6-4de8-9c6b-364b6ea145f7",
        brand_name: "ZEN 200 Tablet",
        composition_display: "Carbamazepine (200mg)",
        similarity: 0.98,
      },
    ],
  },
];

export default function ReviewPage() {
  const [confirmedPayload, setConfirmedPayload] = useState<ConfirmedMedicine[] | null>(null);

  const handleContinueToPlan = (medicines: ConfirmedMedicine[]) => {
    setConfirmedPayload(medicines);
  };

  const planItems = confirmedPayload
    ? confirmedMedicinesToPlanItems(confirmedPayload)
    : [];

  return (
    <div className="min-h-screen bg-slate-50/60 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
          </Link>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> Phase 2 Verification Stage
          </span>
        </div>

        {confirmedPayload ? (
          /* Success / Downstream Handoff Preview */
          <div className="rounded-2xl border border-emerald-200 bg-white p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Prescription Verified & Ready for Pharmacy Optimization
                </h2>
                <p className="text-sm text-slate-600">
                  {confirmedPayload.length} medicine(s) verified with valid catalog UUIDs and clinical safety checks.
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/50">
              {confirmedPayload.map((med, idx) => (
                <div key={med.medicine_id + idx} className="p-4 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold text-slate-900">{med.brand_name}</span>
                    {med.selected_alternative_brand_name && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                        Switched to: {med.selected_alternative_brand_name}
                      </span>
                    )}
                    <div className="text-xs text-slate-500 mt-0.5">
                      Salt: {med.composition_key} {med.dosage ? `• ${med.dosage}` : ""}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      Plan medicine_id: {planItems[idx]?.medicine_id} • allow_alternative:{" "}
                      {String(planItems[idx]?.allow_alternative)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-800">
                      ₹{((med.selected_alternative_mrp ?? med.mrp) || 0).toFixed(2)}
                    </span>
                    {med.is_nti && (
                      <span className="block text-[10px] font-bold text-amber-700">
                        NTI Locked
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setConfirmedPayload(null)}
                className="text-xs text-slate-500 hover:text-slate-800 underline"
              >
                ← Back to Edit Selection
              </button>

              <button
                type="button"
                className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 cursor-pointer"
                onClick={() => {
                  alert(
                    `Handoff payload ready for P3 /api/plans with ${planItems.length} validated items!`
                  );
                }}
              >
                Proceed to Shop Finder (P3 /api/plans) →
              </button>
            </div>
          </div>
        ) : (
          <PrescriptionReviewFlow
            initialItems={SAMPLE_DEMO_ITEMS}
            onContinueToPlan={handleContinueToPlan}
          />
        )}
      </div>
    </div>
  );
}
