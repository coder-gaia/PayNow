import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Zilla_Slab } from 'next/font/google';
import type { ReactNode } from 'react';

import { ConfirmProvider } from '@/components/confirm-dialog';
import { ToastProvider } from '@/components/toast';

import './globals.css';

const display = Zilla_Slab({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-zilla',
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Paynow',
  description: 'Motor de cobrança recorrente com ledger de partidas dobradas.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
