import type { NextConfig } from "next";

import { CLOUDINARY_WIDTH_LADDER } from "./src/lib/cloudinary-loader";

const nextConfig: NextConfig = {
  images: {
    // Vehicle images are delivered through the Cloudinary loader (no global
    // remote host allowlist is opened). It is configured as the global
    // `loaderFile` so Server Components can render `<Image>` without passing the
    // loader function across the server→client boundary; Client Components may
    // still override with an explicit `loader` prop. Aligning deviceSizes with
    // the loader's clamp ladder makes the responsive `srcset` request exactly
    // the intended widths.
    loaderFile: "./src/lib/cloudinary-loader.ts",
    deviceSizes: [...CLOUDINARY_WIDTH_LADDER],
    imageSizes: [160, 240],
  },
};

export default nextConfig;
