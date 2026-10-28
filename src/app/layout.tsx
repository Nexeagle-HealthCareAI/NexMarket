import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';
import { getDictionary } from '@/i18n/getDictionary';
import { I18nProvider } from '@/i18n/I18nProvider';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'NexEagle | Glisan Akbari SuperSpeciality Hospital',
  description:
    'NexEagle hospital marketing CRM and field agent platform for Glisan Akbari SuperSpeciality Hospital.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'NexEagle',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0e1525',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value || 'en';
  const dictionary = await getDictionary(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider dictionary={dictionary}>
          <Providers>
            <PwaRegister />
            {children}
          </Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
