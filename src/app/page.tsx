import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Home: signed-out visitors see Discover; signed-in users see the Following feed. New accounts
 * finish onboarding (pick a handle) first.
 */
export default async function Home() {
  const user = await getCurrentUser();
  if (user && !user.handle) redirect("/onboarding");
  redirect(user ? "/feed" : "/discover");
}
