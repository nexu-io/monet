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

// Server-side default: render the light token set. The ThemeProvider on the
// client will re-apply the user's saved/system preference on mount. Tokens are
// the single source of truth here — we never hand-roll colors.
const lightThemeStyle = themeVariables.light as CSSProperties;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="light" data-theme="light" style={lightThemeStyle}>
      <body>
        <Suspense fallback={null}>
          <AppProviders>{children}</AppProviders>
        </Suspense>
      </body>
    </html>
  );
}
