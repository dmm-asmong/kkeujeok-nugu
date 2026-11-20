"use client";
import dynamic from "next/dynamic";
import { use } from "react";

const HostScreen = dynamic(() => import("@/components/HostScreen"), { ssr: false, loading: () => <div className="loading">방 여는 중…</div> });

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <HostScreen code={code.toUpperCase()} />;
}
