import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme/theme';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Market Trading Room Simulator';

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — Financial Markets, Without the Real-World Risk`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'A virtual financial-market learning and risk-analysis platform. Practise simulated trading, study portfolio risk and learn market concepts — no real money involved.',
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#081322' },
    { media: '(prefers-color-scheme: light)', color: '#f5f8fc' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
