import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import { PROJECT } from '@/lib/config';
import { Sidebar } from './_components/sidebar';
import './globals.css';

const sans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
});

const mono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: `${PROJECT.name} — AI Visibility`,
  description: `How AI models answer questions about ${PROJECT.name} and its competitors, tracked daily.`,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
