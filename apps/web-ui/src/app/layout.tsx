import type { Metadata } from "next";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { themeVariables } from "@nexu-design/tokens";

import "./globals.css";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  title: "Monet",
  description: "Desktop-first agent chat UI shell for the Monet controller."
};

type RootLayoutProps = {
  children: ReactNode;
};

const darkThemeStyle = themeVariables.dark as CSSProperties;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="dark" style={darkThemeStyle}>
      <body>
        <Suspense fallback={null}>
          <AppProviders>{children}</AppProviders>
        </Suspense>
      </body>
    </html>
  );
}
