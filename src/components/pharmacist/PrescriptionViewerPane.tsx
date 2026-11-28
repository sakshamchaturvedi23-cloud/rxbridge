"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FileImage, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

interface PrescriptionViewerPaneProps {
  prescriptionId: string;
  hasDocument: boolean;
}

export function PrescriptionViewerPane({
  prescriptionId,
  hasDocument,
}: PrescriptionViewerPaneProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasDocument);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const applyDocResponse = useCallback(async (res: Response) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "Unable to load prescription document.");
      setLoading(false);
      return;
    }
    setSignedUrl(payload.signedUrl ?? null);
    setLoading(false);
  }, []);

  const refreshSignedUrl = useCallback(async () => {
    if (!hasDocument) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pharmacist/prescriptions/${prescriptionId}/document`,
        { cache: "no-store" }
      );
      await applyDocResponse(res);
    } catch {
      setError("Network error loading prescription document.");
      setLoading(false);
    }
  }, [applyDocResponse, hasDocument, prescriptionId]);

  useEffect(() => {
    if (!hasDocument) return;
    let active = true;
    fetch(`/api/pharmacist/prescriptions/${prescriptionId}/document`, {
      cache: "no-store",
    })
      .then((res) => {
        if (active) return applyDocResponse(res);
      })
      .catch(() => {
        if (active) {
          setError("Network error loading prescription document.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [applyDocResponse, hasDocument, prescriptionId]);

  return (
    <section className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Original Prescription Document
          </h2>
          <p className="text-[11px] text-slate-400">
            Short-lived 300s authorized signed URL (read-only)
          </p>
        </div>
        {hasDocument && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
              title={zoomed ? "Reset zoom" : "Zoom image"}
            >
              {zoomed ? (
                <ZoomOut className="h-4 w-4" />
              ) : (
                <ZoomIn className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={refreshSignedUrl}
              className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
              title="Refresh signed URL"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {!hasDocument ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-6 text-center">
          <FileImage className="h-8 w-8 text-slate-500" />
          <p className="mt-2 text-xs font-medium text-slate-300">
            No prescription scan attached
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Verify extracted items carefully or request original physical
            prescription before dispensing Schedule H drugs.
          </p>
        </div>
      ) : loading ? (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 text-xs text-slate-400">
          Loading authorized prescription document…
        </div>
      ) : error || !signedUrl ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center text-xs text-rose-200">
          <p>{error || "Signed URL unavailable."}</p>
          <button
            type="button"
            onClick={refreshSignedUrl}
            className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 hover:bg-rose-500/20"
          >
            Reload Document
          </button>
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt="Patient uploaded prescription"
            className={`mx-auto rounded-lg object-contain transition-transform ${
              zoomed ? "w-[160%] max-w-none" : "max-h-[65vh] w-full"
            }`}
          />
        </div>
      )}
    </section>
  );
}
