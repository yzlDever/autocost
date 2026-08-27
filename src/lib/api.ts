import "server-only";

import { getSession } from "./session";

export async function requireApiSession() {
  const session = await getSession();
  if (!session) {
    return {
      session: null,
      response: Response.json({ success: false, message: "登录已过期，请重新登录。" }, { status: 401 }),
    } as const;
  }
  return { session, response: null } as const;
}

export function jsonError(message: string, status = 400, code?: string) {
  return Response.json({ success: false, code, message }, { status });
}
