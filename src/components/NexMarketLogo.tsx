'use client';

import React from 'react';
import { motion } from 'framer-motion';

export default function NexMarketLogo({ size = 32, className = '' }: { size?: number, className?: string }) {
  // A modern, abstract "N" shape with data points (nodes)
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="url(#nexGrad)"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      initial="hidden"
      animate="visible"
    >
      <defs>
        <linearGradient id="nexGrad" x1="0" y1="0" x2="24" y2="24">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>

      {/* Left vertical pillar */}
      <motion.path
        d="M4 20V4"
        variants={{
          hidden: { pathLength: 0, opacity: 0 },
          visible: { pathLength: 1, opacity: 1, transition: { duration: 0.6, ease: "easeOut" } }
        }}
      />
      
      {/* Diagonal interconnect */}
      <motion.path
        d="M4 4L20 20"
        variants={{
          hidden: { pathLength: 0, opacity: 0 },
          visible: { pathLength: 1, opacity: 1, transition: { duration: 0.8, ease: "easeInOut", delay: 0.2 } }
        }}
      />

      {/* Right vertical pillar */}
      <motion.path
        d="M20 20V4"
        variants={{
          hidden: { pathLength: 0, opacity: 0 },
          visible: { pathLength: 1, opacity: 1, transition: { duration: 0.6, ease: "easeOut", delay: 0.6 } }
        }}
      />

      {/* Data Node / Pulse point 1 */}
      <motion.circle
        cx="4"
        cy="4"
        r="2.5"
        fill="#4f46e5"
        stroke="none"
        variants={{
          hidden: { scale: 0, opacity: 0 },
          visible: { scale: 1, opacity: 1, transition: { duration: 0.4, type: "spring", delay: 0.6 } }
        }}
      />

      {/* Data Node / Pulse point 2 */}
      <motion.circle
        cx="20"
        cy="20"
        r="2.5"
        fill="#0ea5e9"
        stroke="none"
        variants={{
          hidden: { scale: 0, opacity: 0 },
          visible: { scale: 1, opacity: 1, transition: { duration: 0.4, type: "spring", delay: 1.0 } }
        }}
      />
    </motion.svg>
  );
}
