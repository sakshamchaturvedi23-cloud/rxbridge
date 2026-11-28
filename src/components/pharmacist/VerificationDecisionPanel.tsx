"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert } from "lucide-react";
import type { ExtractedMedicineItem, SafetyFlag } from "@/types/contracts";
import type {
  PharmacistMemberRole,
  PrescriptionVerificationStatus,
  VerificationNoteDTO,
} from "@/types/pharmacist";

interface ItemReviewState {
  temp_id: string;
  medicine_id: string | null;
  medicine_name: string;
  verified: boolean;
  clarification_needed: boolean;
  note: string;
}

interface VerificationDecisionPanelProps {
  prescriptionId: string;
  currentStatus: PrescriptionVerificationStatus;
  canSignOff: boolean;
  memberRole: PharmacistMemberRole;
  extractedItems: Array<Partial<ExtractedMedicineItem>>;
  safetyItems: Array<{
    temp_id: string;
    is_nti: boolean;
    is_schedule_h: boolean;
    safety_flags: SafetyFlag[];
  }>;
  disclaimers: {
    decision_support: string;
    interaction_coverage: string;
    profile_source: string;
  };
  notes: VerificationNoteDTO[];
  onVerified: () => Promise<void> | void;
}

export function VerificationDecisionPanel({
  prescriptionId,
  currentStatus,
  canSignOff,
  memberRole,
  extractedItems,
  safetyItems,
  disclaimers,
  notes,
  onVerified,
}: VerificationDecisionPanelProps) {
  const isTerminal =
    currentStatus === "approved" || currentStatus === "rejected";

  const [itemStates, setItemStates] = useState<ItemReviewState[]>(() =>
    extractedItems.map((it, idx) => ({
      temp_id: it.temp_id || `item-${idx + 1}`,
      medicine_id: it.matched_medicine_id ?? null,
      medicine_name: it.brand_name || it.raw_text || `Medicine ${idx + 1}`,
      verified: true,
      clarification_needed: false,
      note: "",
    }))
  );

  const [decision, setDecision] = useState<
    "approved" | "partially_verified" | "needs_clarification" | "rejected"
  >("approved");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function updateItemState(
    index: number,
    patch: Partial<ItemReviewState>
  ) {
    setItemStates((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!canSignOff || isTerminal) return;

    if (
      (decision === "rejected" || decision === "needs_clarification") &&
      !note.trim()
    ) {
      setError(
        `A pharmacist note/reason is required when marking a prescription as '${decision.replace("_", " ")}'.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/pharmacist/prescriptions/${prescriptionId}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            note: note.trim() || null,
            item_decisions: itemStates.map((st) => ({
              temp_id: st.temp_id,
              medicine_id: st.medicine_id,
              medicine_name: st.medicine_name,
              verified: st.verified,
              clarification_needed: st.clarification_needed,
              note: st.note.trim() || null,
            })),
          }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Failed to submit verification decision.");
        setSubmitting(false);
        return;
      }

      setSuccessMsg(`Verification decision saved (${decision.replace("_", " ")}).`);
      setNote("");
      setSubmitting(false);
      await onVerified();
    } catch {
      setError("Network error submitting verification decision.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Decision-Support Disclaimers */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-100">
        <p className="font-semibold text-amber-200">
          Clinical Decision-Support Notice
        </p>
        <p className="mt-1 text-amber-200/90">{disclaimers.decision_support}</p>
        <p className="mt-1 text-[11px] text-amber-200/75">
          {disclaimers.interaction_coverage}
        </p>
      </div>

      {/* Extracted Medicines (Read-only Identity + Safety Flags) */}
      <section className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Prescribed Medicines ({extractedItems.length})
          </h2>
          <span className="text-[11px] text-slate-400">
            Original Rx immutable
          </span>
        </div>

        {extractedItems.length === 0 ? (
          <p className="text-xs text-slate-400">
            No extracted medicine items recorded on this prescription.
          </p>
        ) : (
          <div className="space-y-3">
            {extractedItems.map((item, idx) => {
              const safety = safetyItems[idx];
              const isNti = Boolean(safety?.is_nti || item.is_nti);
              const isScheduleH = Boolean(
                safety?.is_schedule_h || item.is_schedule_h
              );
              const flags = safety?.safety_flags ?? item.safety_flags ?? [];
              const rowState = itemStates[idx];

              return (
                <div
                  key={item.temp_id || idx}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {item.brand_name || item.raw_text || "Unknown Medicine"}
                      </p>
                      <p className="mt-0.5 text-slate-400">
                        {item.composition_display || "Composition unmapped"}
                        {item.dose ? ` • Dose: ${item.dose}` : ""}
                        {item.duration ? ` • Duration: ${item.duration}` : ""}
                      </p>
                      {item.raw_text && (
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          OCR raw: &ldquo;{item.raw_text}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {item.confidence === "amber" && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                          Amber OCR Confidence
                        </span>
                      )}
                      {isNti && (
                        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
                          NTI — Do Not Substitute
                        </span>
                      )}
                      {isScheduleH && (
                        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
                          Schedule H Rx
                        </span>
                      )}
                    </div>
                  </div>

                  {flags.length > 0 && (
                    <ul className="mt-2.5 space-y-1">
                      {flags.map((f, fIdx) => (
                        <li
                          key={fIdx}
                          className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${
                            f.severity === "red"
                              ? "bg-rose-500/15 text-rose-200"
                              : "bg-amber-500/10 text-amber-200"
                          }`}
                        >
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{f.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {rowState && canSignOff && !isTerminal && (
                    <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-2.5">
                      <label className="flex items-center gap-1.5 text-slate-200">
                        <input
                          type="checkbox"
                          checked={rowState.verified}
                          onChange={(e) =>
                            updateItemState(idx, {
                              verified: e.target.checked,
                              clarification_needed: e.target.checked
                                ? false
                                : rowState.clarification_needed,
                            })
                          }
                          className="rounded border-slate-700 bg-slate-900"
                        />
                        Verified against Rx
                      </label>
                      <label className="flex items-center gap-1.5 text-amber-200">
                        <input
                          type="checkbox"
                          checked={rowState.clarification_needed}
                          onChange={(e) =>
                            updateItemState(idx, {
                              clarification_needed: e.target.checked,
                              verified: e.target.checked ? false : rowState.verified,
                            })
                          }
                          className="rounded border-slate-700 bg-slate-900"
                        />
                        Needs clarification
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sign-off Decision Form */}
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
        <h2 className="text-sm font-semibold text-white">
          Pharmacist Verification Decision
        </h2>

        {!canSignOff ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
            <Lock className="h-4 w-4 text-slate-400" />
            <span>
              Signed in as <strong>{memberRole}</strong>. Only an{" "}
              <strong>owner</strong> or <strong>licensed_pharmacist</strong> can
              sign off prescription verifications.
            </span>
          </div>
        ) : isTerminal ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
            <ShieldAlert className="h-4 w-4 text-emerald-400" />
            <span>
              This verification is finalized as{" "}
              <strong className="capitalize">
                {currentStatus.replace("_", " ")}
              </strong>
              .
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 space-y-4">
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
              >
                {error}
              </div>
            )}
            {successMsg && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "approved", label: "Approve Rx" },
                  { value: "partially_verified", label: "Partially Verify" },
                  { value: "needs_clarification", label: "Needs Clarification" },
                  { value: "rejected", label: "Reject Rx" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDecision(opt.value)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    decision === opt.value
                      ? opt.value === "rejected"
                        ? "border-rose-500/60 bg-rose-500/20 text-rose-200"
                        : opt.value === "needs_clarification"
                          ? "border-amber-500/60 bg-amber-500/20 text-amber-200"
                          : "border-emerald-500/60 bg-emerald-500/20 text-emerald-200"
                      : "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Pharmacist Note / Reason{" "}
                {(decision === "rejected" || decision === "needs_clarification") && (
                  <span className="text-rose-400">* (Required)</span>
                )}
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Record clinical verification rationale, legibility remarks, or clarification instructions…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-emerald-500 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Recording Decision…" : "Submit Clinical Verification"}
            </button>
          </form>
        )}
      </section>

      {/* Audit History */}
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
        <h2 className="text-sm font-semibold text-white">
          Verification Audit History
        </h2>
        {notes.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">
            No pharmacist verification notes recorded yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-medium capitalize text-slate-200">
                    {n.decision_snapshot.replace(/_/g, " ")}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1.5 text-slate-300">{n.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
