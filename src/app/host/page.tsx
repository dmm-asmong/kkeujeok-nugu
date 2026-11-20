"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_SETTINGS, SettingsForm } from "@/components/SettingsForm";
import { api, store } from "@/lib/client";

export default function CreateRoom() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <main className="create">
      <header className="home-top">
        <Link href="/" className="logo">
          끄적<em>누구</em>
        </Link>
        <span className="hand">진행자 준비</span>
      </header>
      <h1 className="create-title">
        오늘 모임에 맞는 <mark>질문 세 개</mark>만 고르면 끝.
      </h1>
      <p className="lead">방은 2시간 동안 열려 있고, 끝내기를 누르면 그림과 답이 바로 지워져요.</p>
      <div className="card create-card">
        <SettingsForm
          initial={DEFAULT_SETTINGS}
          submitLabel="이대로 방 열기"
          busy={busy}
          onSubmit={async (settings) => {
            setBusy(true);
            setErr("");
            try {
              const r = await api<{ code: string; hostToken: string }>("/api/rooms", { method: "POST", json: { settings } });
              store.set(`kn-host:${r.code}`, r.hostToken);
              router.push(`/host/${r.code}`);
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        />
        {err && <p className="err">{err}</p>}
      </div>
      <footer className="credit">만든 사람 · 양○○ (애즈몽)</footer>
    </main>
  );
}
