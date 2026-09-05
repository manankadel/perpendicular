import PerpendicularLogin from "@/components/PerpendicularLogin";
import { safeReturnPath } from "@/lib/auth-proxy";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  return <PerpendicularLogin next={safeReturnPath(rawNext)} />;
}
