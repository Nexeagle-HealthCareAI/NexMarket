'use client';

import Image from 'next/image';

/** NexEagle brand mark (kept under its old component name so every existing import still works). */
export default function NexMarketLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/nexeagle-mark.png"
      alt="NexEagle"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      priority
      unoptimized
    />
  );
}
