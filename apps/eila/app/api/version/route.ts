import { BUILD_ID } from "@/lib/version";

// The LIVE deploy's build id. A phone running an old cached bundle fetches this
// (which is always served by the CURRENT production deploy) and compares it to
// its own baked-in id — if they differ, a newer version is out and the app can
// prompt a refresh instead of quietly showing yesterday's code + numbers.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify({ build: BUILD_ID }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}
