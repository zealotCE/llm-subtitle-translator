"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function AuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (pathname.startsWith("/login")) {
      setChecking(false);
      return;
    }
    const search = typeof window !== "undefined" ? window.location.search : "";
    const nextPath = search ? `${pathname}${search}` : pathname;
    let active = true;
    fetch("/api/auth/status")
      .then(async (res) => {
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          if (data.enabled && !data.ok) {
            router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
          }
        } else {
          router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        }
      })
      .catch(() => {
        if (!active) return;
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (checking) {
    return null;
  }
  return null;
}
