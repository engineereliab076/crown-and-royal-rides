import { handlers } from "@/server/auth";

// Auth.js catch-all route mounted at the Phase 2 base path /api/admin/auth/*.
export const { GET, POST } = handlers;
