"use client";
import { useEffect } from "react";

/** Último recurso si falla el layout raíz: HTML mínimo, sin depender de nada más. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="es-MX">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f8fafc", color: "#0f172a" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>La plataforma no está disponible en este momento</h1>
          <p style={{ color: "#64748b", fontSize: 14 }}>Inténtalo de nuevo en unos minutos.{error.digest ? ` Código: ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8, border: 0, background: "#24508d", color: "#fff", cursor: "pointer" }}>Reintentar</button>
        </main>
      </body>
    </html>
  );
}
