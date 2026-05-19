import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "RPS Maestro",
  description: "Plataforma de orquestração de automações RPA",
};

// Script inline anti-FOUC: roda síncrono no <head> antes do React hidratar,
// lê localStorage e aplica .dark imediatamente. Sem isso, a página renderiza
// no tema light e flasha pro dark depois que o ThemeProvider monta.
const themeBootstrap = `
(function() {
  try {
    var p = localStorage.getItem('theme') || 'system';
    var d = p === 'dark' || (p === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (d) document.documentElement.classList.add('dark');
  } catch (_) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${geist.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="flex h-full bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <Providers>
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="flex-1 overflow-auto p-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
