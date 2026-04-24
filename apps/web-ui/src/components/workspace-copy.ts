export function sanitizeInternalRuntimeMessage(message: string | null | undefined) {
  return message
    ?.replace(/\bcontrollers\b/gi, "workspaces")
    .replace(/\bcontroller\b/gi, "workspace") ?? null;
}
