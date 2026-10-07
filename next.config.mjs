/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  webpack: (config) => {
    // pdfjs-dist 3.x optionally requires Node's native `canvas`; the browser reader renders with the DOM canvas,
    // so tell webpack to ignore it (otherwise it tries to bundle a .node binary and the build fails).
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  }
};
export default nextConfig;
