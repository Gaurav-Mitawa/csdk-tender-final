import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Inter, Instrument_Serif } from 'next/font/google'
import './globals.css'

const sans = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
})

const mono = JetBrains_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const serif = Instrument_Serif({
  variable: '--font-serif',
  weight: '400',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Tender Agent | Chat',
  description: 'Live chat console for the Tender qualification agent.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-background text-foreground [font-feature-settings:'ss01','cv11']"
      >
        {children}
      </body>
    </html>
  )
}
