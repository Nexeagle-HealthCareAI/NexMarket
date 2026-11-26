import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Book your place · Health camp',
  description: 'Book a free check-up at the health camp and get your token number.',
  robots: { index: false, follow: false },
};

/** Public pages people open from a QR poster (no sign-in). */
export default function PublicCampLayout({ children }: { children: React.ReactNode }) {
  return children;
}
