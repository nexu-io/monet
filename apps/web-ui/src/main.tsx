import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { themeVariables } from "@nexu-design/tokens";

import "./app/globals.css";
import ArtifactsPage from "./app/artifacts/page";
import ConnectorsPage from "./app/connectors/page";
import HomePage from "./app/page";
import { AppProviders } from "./app/providers";
import SettingsLayout from "./app/settings/layout";
import ConnectorsSettingsPage from "./app/settings/connectors/page";
import GeneralSettingsPage from "./app/settings/general/page";
import ModelSettingsPage from "./app/settings/models/page";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

Object.entries(themeVariables.light as Record<string, string>).forEach(([key, value]) => {
  document.documentElement.style.setProperty(key, value);
});
document.documentElement.style.colorScheme = "light";

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <AppProviders>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/artifacts" element={<ArtifactsPage />} />
            <Route path="/connectors" element={<ConnectorsPage />} />
            <Route path="/sessions" element={<Navigate to="/" replace />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="connectors" element={<ConnectorsSettingsPage />} />
              <Route path="general" element={<GeneralSettingsPage />} />
              <Route path="models" element={<ModelSettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppProviders>
      </Suspense>
    </BrowserRouter>
  </StrictMode>
);
