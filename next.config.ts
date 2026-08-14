import type { NextConfig } from "next";

import { CLOUDINARY_WIDTH_LADDER } from "./src/lib/cloudinary-loader";

const nextConfig: NextConfig = {
  images: {
    // Vehicle images are delivered through a per-<Image> Cloudinary loader (no
    // global remote host allowlist is opened). Aligning deviceSizes with the
    // loader's clamp ladder makes the generated responsive `srcset` request
    // exactly the intended widths.
    deviceSizes: [...CLOUDINARY_WIDTH_LADDER],
    imageSizes: [160, 240],
  },
};

export default nextConfig;
