import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AIRE · Jornadas e confiabilidade",
  description:
    "O console de confiabilidade da Northeia. Mapeie jornadas, explore dependências e revise evidências.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
