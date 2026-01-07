"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [nextPath, setNextPath] = useState("/");
  const { t } = useI18n();

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => {
        if (!data.enabled) {
          setEnabled(false);
          router.replace("/");
        }
      })
      .catch(() => {
        setEnabled(true);
      });
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setNextPath(params.get("next") || "/");
  }, []);

  const handleLogin = async () => {
    setMessage("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || t("login.failed"));
      return;
    }
    router.replace(nextPath || "/");
  };

  if (!enabled) {
    return null;
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-sm space-y-6">
        <h1 className="section-title">{t("login.title")}</h1>
        <Card>
          <CardHeader>
            <CardTitle>{t("login.subtitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm text-neutral-500">{t("login.username")}</label>
              <Input value={user} onChange={(event) => setUser(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-neutral-500">{t("login.password")}</label>
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {message ? <p className="text-sm text-rose-600">{message}</p> : null}
            <Button onClick={handleLogin}>{t("login.submit")}</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
