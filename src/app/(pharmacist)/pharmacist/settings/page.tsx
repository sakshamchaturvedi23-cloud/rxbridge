"use client";

import React from "react";
import { Shield, Users } from "lucide-react";
import { usePharmacistPortal } from "@/components/pharmacist/PharmacistShell";

export default function PharmacistSettingsPage() {
  const { shop, memberRole, members, canManageShop, currentUser } =
    usePharmacistPortal();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">
          Account & Team Settings
        </h1>
        <p className="text-sm text-slate-400">
          Role permissions, active pharmacy team roster, and verification posture.
        </p>
      </div>

      {/* Signed-in Account & Role */}
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Shield className="h-4 w-4 text-emerald-400" />
          <span>Current Session & Access Role</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <p className="text-xs text-slate-400">Signed-in Email</p>
            <p className="mt-1 truncate font-medium text-white">
              {currentUser.email || "Authenticated User"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <p className="text-xs text-slate-400">Pharmacy Role</p>
            <p className="mt-1 font-medium capitalize text-emerald-300">
              {memberRole.replace("_", " ")}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <p className="text-xs text-slate-400">Clinical Rx Sign-Off</p>
            <p className="mt-1 font-medium text-white">
              {memberRole === "owner" || memberRole === "licensed_pharmacist"
                ? "Authorized (Owner / Licensed Pharmacist)"
                : "Restricted (Staff cannot verify Rx)"}
            </p>
          </div>
        </div>
      </section>

      {/* Active Pharmacy Members Roster */}
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-emerald-400" />
            <span>Pharmacy Team Roster ({shop.name})</span>
          </div>
          <span className="text-xs text-slate-400">
            {canManageShop ? "Owner view" : "Read-only"}
          </span>
        </div>

        {members.length === 0 ? (
          <p className="mt-4 text-xs text-slate-400">
            No pharmacy members returned for this shop.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-4 font-medium">Member</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {members.map((m) => (
                  <tr key={m.id} className="text-slate-200">
                    <td className="py-2.5 pr-4 font-mono">
                      {m.full_name
                        ? `${m.full_name} (${m.user_id.slice(0, 8)}…)`
                        : `${m.user_id.slice(0, 8)}…${m.user_id.slice(-4)}`}
                      {m.user_id === currentUser.id && (
                        <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 font-sans text-[11px] text-emerald-300">
                          You
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 capitalize">
                      {m.member_role.replace("_", " ")}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          m.is_active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {m.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-400">
                      {m.created_at ? m.created_at.slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
