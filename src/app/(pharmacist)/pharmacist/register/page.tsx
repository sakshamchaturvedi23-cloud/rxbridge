"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type DayHours = { open: string; close: string; closed: boolean };

function buildDefaultHours(): Record<string, DayHours> {
  const out: Record<string, DayHours> = {};
  for (const day of WEEKDAYS) {
    out[day] = {
      open: "09:00",
      close: "21:00",
      closed: day === "sunday",
    };
  }
  return out;
}

export default function PharmacistRegisterPage() {
  const router = useRouter();

  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [name, setName] = useState("");
  const [shopType, setShopType] = useState<"chemist" | "jan_aushadhi">("chemist");
  const [archetype, setArchetype] = useState<
    "neighborhood" | "chain" | "wholesale" | "jan_aushadhi"
  >("neighborhood");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("28.6139");
  const [longitude, setLongitude] = useState("77.2090");
  const [serviceRadiusKm, setServiceRadiusKm] = useState("5");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [pharmacistRegNumber, setPharmacistRegNumber] = useState("");
  const [operatingHours, setOperatingHours] =
    useState<Record<string, DayHours>>(buildDefaultHours);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    shopName: string;
    requiresEmailConfirmation: boolean;
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setHasSession(true);
        setSessionEmail(data.user.email ?? null);
        if (data.user.email) {
          setContactEmail((prev) => prev || data.user!.email!);
        }
      } else {
        setHasSession(false);
      }
    });
  }, []);

  function updateDayHours(
    day: string,
    patch: Partial<DayHours>
  ) {
    setOperatingHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], ...patch },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const parsedLat = Number(latitude);
    const parsedLng = Number(longitude);
    const parsedRadius = Number(serviceRadiusKm);

    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      setError("Latitude must be a valid number between -90 and 90.");
      setSubmitting(false);
      return;
    }
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      setError("Longitude must be a valid number between -180 and 180.");
      setSubmitting(false);
      return;
    }
    if (!Number.isFinite(parsedRadius) || parsedRadius <= 0) {
      setError("Service radius must be greater than 0 km.");
      setSubmitting(false);
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      shop_type: shopType,
      archetype,
      address: address.trim(),
      latitude: parsedLat,
      longitude: parsedLng,
      service_radius_km: parsedRadius,
      contact_phone: contactPhone.trim(),
      contact_email: contactEmail.trim(),
      license_number: licenseNumber.trim(),
      pharmacist_reg_number: pharmacistRegNumber.trim(),
      operating_hours: operatingHours,
    };

    if (!hasSession) {
      payload.full_name = fullName.trim();
      payload.email = email.trim();
      payload.password = password;
    }

    try {
      const res = await fetch("/api/pharmacist/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Registration failed. Please check all fields.");
        setSubmitting(false);
        return;
      }

      if (data.requiresEmailConfirmation) {
        setSuccessInfo({
          shopName: data.shop?.name || name,
          requiresEmailConfirmation: true,
        });
        setSubmitting(false);
        return;
      }

      router.replace("/pharmacist/dashboard");
    } catch {
      setError("Network error submitting pharmacy onboarding.");
      setSubmitting(false);
    }
  }

  if (successInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-emerald-500/30 bg-slate-900 p-8">
          <div className="flex items-center gap-3 text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
            <h1 className="text-xl font-semibold text-white">
              Pharmacy Submitted — Pending Verification
            </h1>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            <strong>{successInfo.shopName}</strong> has been registered with status{" "}
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
              Submitted — pending platform verification
            </span>
            . Please confirm your email address, then sign in to monitor your
            onboarding status and prepare inventory.
          </p>
          <div className="mt-6">
            <Link
              href="/pharmacist/login"
              className="inline-flex rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex flex-col gap-2 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">
                Pharmacy Onboarding
              </h1>
              <p className="text-xs text-slate-400">
                Register your pharmacy on RxBridge (starts in pending verification)
              </p>
            </div>
          </div>
          <Link
            href="/pharmacist/login"
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            Already registered? Sign in →
          </Link>
        </div>

        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p>
            Self-submitted license and registration numbers are marked{" "}
            <strong>Submitted — pending platform verification</strong>. They are not
            automatically validated by a regulatory authority, and live patient
            demand/reservation actions remain locked until approved.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Account */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-white">
              1. Pharmacist Owner Account
            </h2>
            {hasSession ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-slate-300">
                Registering with signed-in account:{" "}
                <strong className="text-white">{sessionEmail || "Authenticated user"}</strong>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Dr. Rajesh Sharma"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">
                    Account Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@pharmacy.in"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">
                    Password (min 8 chars)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Section 2: Pharmacy Details */}
          <section className="space-y-4 border-t border-slate-800 pt-5">
            <h2 className="text-sm font-semibold text-white">
              2. Pharmacy Details & Location
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-300">
                  Pharmacy Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Arogya Medicos & Chemists"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Shop Type
                </label>
                <select
                  value={shopType}
                  onChange={(e) =>
                    setShopType(e.target.value as "chemist" | "jan_aushadhi")
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="chemist">Retail Chemist</option>
                  <option value="jan_aushadhi">Jan Aushadhi Kendra</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Store Archetype
                </label>
                <select
                  value={archetype}
                  onChange={(e) =>
                    setArchetype(
                      e.target.value as
                        | "neighborhood"
                        | "chain"
                        | "wholesale"
                        | "jan_aushadhi"
                    )
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="neighborhood">Neighborhood</option>
                  <option value="chain">Chain</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="jan_aushadhi">Jan Aushadhi</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-300">
                  Full Street Address
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="14 Main Market, Sector 12, New Delhi 110075"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  required
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Contact Email
                </label>
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="desk@arogyamedicos.in"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
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
                  required
                  value={serviceRadiusKm}
                  onChange={(e) => setServiceRadiusKm(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Section 3: Licenses */}
          <section className="space-y-4 border-t border-slate-800 pt-5">
            <h2 className="text-sm font-semibold text-white">
              3. Pharmacy License & Pharmacist Registration
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Retail Drug License Number (Form 20/21)
                </label>
                <input
                  type="text"
                  required
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="DL-20B-2026-10421"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  State Pharmacy Council Reg. Number
                </label>
                <input
                  type="text"
                  required
                  value={pharmacistRegNumber}
                  onChange={(e) => setPharmacistRegNumber(e.target.value)}
                  placeholder="SPC-REG-88241"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Section 4: Operating Hours */}
          <section className="space-y-3 border-t border-slate-800 pt-5">
            <h2 className="text-sm font-semibold text-white">
              4. Operating Hours
            </h2>
            <div className="space-y-2">
              {WEEKDAYS.map((day) => {
                const cfg = operatingHours[day];
                return (
                  <div
                    key={day}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs"
                  >
                    <span className="w-24 font-medium capitalize text-slate-200">
                      {day}
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-slate-400">
                        <input
                          type="checkbox"
                          checked={cfg.closed}
                          onChange={(e) =>
                            updateDayHours(day, { closed: e.target.checked })
                          }
                          className="rounded border-slate-700 bg-slate-900"
                        />
                        Closed
                      </label>
                      {!cfg.closed && (
                        <>
                          <input
                            type="time"
                            value={cfg.open}
                            onChange={(e) =>
                              updateDayHours(day, { open: e.target.value })
                            }
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                          />
                          <span className="text-slate-500">to</span>
                          <input
                            type="time"
                            value={cfg.close}
                            onChange={(e) =>
                              updateDayHours(day, { close: e.target.value })
                            }
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-5">
            <Link
              href="/pharmacist/login"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting Onboarding…" : "Submit Pharmacy for Verification"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
