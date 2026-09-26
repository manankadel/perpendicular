import PerpendicularLogin from "@/components/PerpendicularLogin";
import { safeReturnPath } from "@/lib/auth-proxy";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const rawError = Array.isArray(params.error) ? params.error[0] : params.error;
  return <PerpendicularLogin next={safeReturnPath(rawNext)} initialError={rawError?.slice(0, 240)} />;
}
