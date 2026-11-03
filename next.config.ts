import type { NextConfig } from 'next';

const previewHost = process.env.QOE_PREVIEW_HOST?.toLowerCase();
if (
  previewHost !== undefined &&
  (previewHost === 'null' ||
    previewHost.length > 253 ||
    !previewHost
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
) {
  throw new Error(
    'QOE_PREVIEW_HOST must be one exact hostname without a protocol, port, wildcard, or path.',
  );
}

const nextConfig: NextConfig = {
  basePath: '/qoe',
  allowedDevOrigins: previewHost === undefined ? [] : [previewHost],
};

export default nextConfig;
