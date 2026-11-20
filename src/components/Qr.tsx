"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function Qr({ url, className }: { url: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c1a17", light: "#fffdf8" } })
      .then((s) => alive && setSvg(s))
      .catch(() => setSvg(""));
    return () => {
      alive = false;
    };
  }, [url]);
  // SVG markup comes from the qrcode library, not from user input.
  return <div className={className} role="img" aria-label={`QR 코드: ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
