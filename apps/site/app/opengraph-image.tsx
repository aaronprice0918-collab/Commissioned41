import { ImageResponse } from "next/og";

// Dynamic Open Graph / Twitter card (summary_large_image). Brand-black field,
// steel-blue glow, wordmark + tagline — fills the image the layout metadata
// already promises. System fonts only; kept simple and on-brand.
export const alt = "Commissioned 41 — Know Your Mission. Execute With Purpose.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#04080f",
          backgroundImage:
            "radial-gradient(120% 80% at 50% -10%, rgba(96,150,255,0.22), transparent 56%), radial-gradient(90% 60% at 85% 8%, rgba(214,58,64,0.06), transparent 60%)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "#8ab4ff",
            marginBottom: 26,
          }}
        >
          Commissioned 41
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 78,
            fontWeight: 800,
            letterSpacing: -2,
            color: "#ffffff",
            textShadow: "0 0 40px rgba(96,150,255,0.45)",
            textAlign: "center",
          }}
        >
          Know Your Mission.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 78,
            fontWeight: 800,
            letterSpacing: -2,
            color: "#ffffff",
            textShadow: "0 0 40px rgba(96,150,255,0.45)",
            textAlign: "center",
            marginTop: 6,
          }}
        >
          Execute With Purpose.
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 48,
            display: "flex",
            fontSize: 26,
            color: "rgba(255,255,255,0.55)",
            letterSpacing: 1,
          }}
        >
          commissioned41.com
        </div>
      </div>
    ),
    { ...size }
  );
}
