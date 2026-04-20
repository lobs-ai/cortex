// Single-user dev mode. Auth lands in phase 1.5 once real sign-in is wired.
export const DEMO_USER_ID = "u_demo";

export function currentUser(_req: unknown): { id: string } {
  return { id: DEMO_USER_ID };
}
