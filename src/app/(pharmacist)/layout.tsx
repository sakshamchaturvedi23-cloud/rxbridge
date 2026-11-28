import React, { Suspense } from "react";
import { PharmacistShell } from "@/components/pharmacist/PharmacistShell";

export default function PharmacistPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
          Loading pharmacy portal…
        </div>
      }
    >
      <PharmacistShell>{children}</PharmacistShell>
    </Suspense>
  );
}
