"use client";

/**
 * Last-resort boundary for errors in the root layout / providers. It replaces the whole document, so it cannot use the
 * app's CSS or settings: plain inline styles, both languages, colours that pass AA in light and dark.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const btn = { minHeight: 48, padding: "0 20px", borderRadius: 14, border: "1px solid #2b3d36", font: "inherit", fontWeight: 700, cursor: "pointer" } as const;
  return (
    <html lang="ja">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0b1311", color: "#eaf3ee", fontFamily: "system-ui, sans-serif" }}>
        <title>Tessera</title>
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24 }}>問題が起きました / Something went wrong</h1>
          <p style={{ color: "#a3b8ad", lineHeight: 1.6 }}>
            アプリの起動中にエラーが起きました。成績や保存データは端末に残っています。
            <br />
            The app failed to start. Your data is still on this device.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <button type="button" onClick={() => retry()} style={{ ...btn, background: "#e9b949", color: "#1b1400", border: "none" }}>
              もう一度 / Try again
            </button>
            <a href="/" style={{ ...btn, display: "grid", placeItems: "center", color: "#eaf3ee", textDecoration: "none" }}>
              ホーム / Home
            </a>
          </div>
          <pre style={{ marginTop: 16, textAlign: "left", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#a3b8ad" }}>{msg}</pre>
        </main>
      </body>
    </html>
  );
}
