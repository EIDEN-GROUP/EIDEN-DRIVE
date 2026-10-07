"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html><body>
      <div style={{ fontFamily: "system-ui", padding: 32, textAlign: "center" }} role="alert">
        <h1>Eiden Drive hit a fatal error</h1>
        <button onClick={reset} style={{ minHeight: 44, padding: "0 20px" }}>Reload</button>
      </div>
    </body></html>
  );
}
