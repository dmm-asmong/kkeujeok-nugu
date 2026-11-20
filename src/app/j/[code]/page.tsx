"use client";
import dynamic from "next/dynamic";
import { use } from "react";

const PlayerScreen = dynamic(() => import("@/components/PlayerScreen"), { ssr: false, loading: () => <div className="loading">들어가는 중…</div> });

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <PlayerScreen code={code.toUpperCase()} />;
}
