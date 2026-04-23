import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "unauthorized" }),
    message: z.string().openapi({ example: "Missing or invalid bearer token." })
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok").openapi({ example: "ok" }),
    service: z.literal("controller").openapi({ example: "controller" }),
    version: z.string().openapi({ example: "0.1.0" })
  })
  .openapi("HealthResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createErrorResponse(error: string, message: string): ErrorResponse {
  return {
    error,
    message
  };
}
