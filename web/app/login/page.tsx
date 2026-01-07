"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [nextPath, setNextPath] = useState("/");

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
      setMessage(data.message || "登录失败");
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
        <h1 className="section-title">登录</h1>
        <Card>
          <CardHeader>
            <CardTitle>账号验证</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm text-dune">用户名</label>
              <Input value={user} onChange={(event) => setUser(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-dune">密码</label>
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {message ? <p className="text-sm text-ember">{message}</p> : null}
            <Button onClick={handleLogin}>登录</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
