/** @type {import('next').NextConfig} */
const APP = "https://missionos.commissioned41.com";

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // The apex (commissioned41.com) now serves this brand site. A handful of
    // paths used to be served by the dealer app on the apex — keep them working
    // by forwarding to the app subdomain so no existing link (legal, cards,
    // signup) breaks. Temporary (307) so it's easy to change later.
    return [
      { source: "/welcome", destination: "/", permanent: false },
      { source: "/login", destination: `${APP}/login`, permanent: false },
      { source: "/terms", destination: `${APP}/terms`, permanent: false },
      { source: "/privacy", destination: `${APP}/privacy`, permanent: false },
      { source: "/signup", destination: `${APP}/signup`, permanent: false },
      { source: "/card/:path*", destination: `${APP}/card/:path*`, permanent: false },
    ];
  },
};

export default nextConfig;
