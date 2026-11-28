"use client";

import React, { useState } from "react";
import { Building2, CheckCircle2, Lock, Save } from "lucide-react";
import { usePharmacistPortal } from "@/components/pharmacist/PharmacistShell";
import type { PharmacistMemberRole, PharmacyShopSummary } from "@/types/pharmacist";

function ProfileEditorForm({
  shop,
  memberRole,
  canManageShop,
  refreshProfile,
}: {
  shop: PharmacyShopSummary;
  memberRole: PharmacistMemberRole;
  canManageShop: boolean;
  refreshProfile: () => Promise<void>;
}) {
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address);
  const [lat, setLat] = useState(String(shop.lat));
  const [lng, setLng] = useState(String(shop.lng));
  const [contactPhone, setContactPhone] = useState(shop.contact_phone ?? "");
  const [contactEmail, setContactEmail] = useState(shop.contact_email ?? "");
  const [licenseNumber, setLicenseNumber] = useState(shop.license_number ?? "");
  const [pharmacistRegNumber, setPharmacistRegNumber] = useState(
    shop.pharmacist_reg_number ?? ""
  );
  const [serviceRadiusKm, setServiceRadiusKm] = useState(
    String(shop.service_radius_km ?? 5)
  );
  const [hoursJson, setHoursJson] = useState(
    JSON.stringify(shop.operating_hours ?? {}, null, 2)
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function handleRequestSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedMsg(null);
    if (!canManageShop) return;
    setConfirmOpen(true);
  }

  async function handleConfirmedSave() {
    setSaving(true);
    setError(null);
    setSavedMsg(null);

    let parsedHours: Record<string, unknown> = {};
    try {
      const candidate = JSON.parse(hoursJson || "{}");
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("Operating hours must be a JSON object");
      }
      parsedHours = candidate as Record<string, unknown>;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid operating hours JSON"
      );
      setSaving(false);
      setConfirmOpen(false);
      return;
    }

    try {
      const res = await fetch("/api/pharmacist/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          lat: Number(lat),
          lng: Number(lng),
          contact_phone: contactPhone.trim(),
          contact_email: contactEmail.trim(),
          license_number: licenseNumber.trim(),
          pharmacist_reg_number: pharmacistRegNumber.trim(),
          service_radius_km: Number(serviceRadiusKm),
          operating_hours: parsedHours,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Failed to save profile updates");
        setSaving(false);
        setConfirmOpen(false);
        return;
      }

      await refreshProfile();
      setSavedMsg("Pharmacy profile updated.");
      setSaving(false);
      setConfirmOpen(false);
    } catch {
      setError("Network error while saving pharmacy profile.");
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Pharmacy Profile</h1>
          <p className="text-sm text-slate-400">
            Manage store details, service coordinates, operating hours, and submitted
            registration credentials.
          </p>
        </div>
        <span
          className={`self-start rounded-lg px-3 py-1.5 text-xs font-medium ${
            shop.verification_status === "verified"
              ? "bg-emerald-500/15 text-emerald-300"
              : shop.verification_status === "pending"
                ? "bg-amber-500/15 text-amber-300"
                : "bg-rose-500/15 text-rose-300"
          }`}
        >
          {shop.verification_status === "pending"
            ? "Submitted — pending platform verification"
            : `Status: ${shop.verification_status}`}
        </span>
      </div>

      {!canManageShop && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
          <Lock className="h-4 w-4 text-slate-400" />
          <span>
            Signed in as <strong>{memberRole}</strong>. Only the pharmacy owner can
            edit store profile and license details.
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          {error}
        </div>
      )}

      {savedMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          <span>{savedMsg}</span>
        </div>
      )}

      <form
        onSubmit={handleRequestSave}
        className="space-y-5 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Building2 className="h-4 w-4 text-emerald-400" />
          <span>Store & Compliance Submission</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-300">
              Pharmacy Name
            </label>
            <input
              type="text"
              disabled={!canManageShop}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-300">Address</label>
            <input
              type="text"
              disabled={!canManageShop}
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">Latitude</label>
            <input
              type="number"
              step="any"
              disabled={!canManageShop}
              required
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">Longitude</label>
            <input
              type="number"
              step="any"
              disabled={!canManageShop}
              required
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">
              Contact Phone
            </label>
            <input
              type="text"
              disabled={!canManageShop}
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">
              Contact Email
            </label>
            <input
              type="email"
              disabled={!canManageShop}
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">
              Drug License Number
            </label>
            <input
              type="text"
              disabled={!canManageShop}
              required
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">
              Pharmacist Registration Number
            </label>
            <input
              type="text"
              disabled={!canManageShop}
              required
              value={pharmacistRegNumber}
              onChange={(e) => setPharmacistRegNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">
              Service Radius (km)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="100"
              disabled={!canManageShop}
              required
              value={serviceRadiusKm}
              onChange={(e) => setServiceRadiusKm(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-300">
              Operating Hours (JSON)
            </label>
            <textarea
              rows={6}
              disabled={!canManageShop}
              value={hoursJson}
              onChange={(e) => setHoursJson(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 disabled:opacity-60"
            />
          </div>
        </div>

        {canManageShop && (
          <div className="flex justify-end border-t border-slate-800 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        )}
      </form>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-white">
              Confirm Profile Update
            </h2>
            <p className="mt-2 text-xs text-slate-300">
              Updating pharmacy profile, service coordinates, or registration numbers
              affects downstream order routing and verification records. Proceed with
              saving these changes?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmedSave}
                className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PharmacistProfilePage() {
  const { shop, memberRole, canManageShop, refreshProfile } =
    usePharmacistPortal();

  return (
    <ProfileEditorForm
      key={`${shop.id}-${shop.updated_at}`}
      shop={shop}
      memberRole={memberRole}
      canManageShop={canManageShop}
      refreshProfile={refreshProfile}
    />
  );
}
