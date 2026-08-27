import { requireApiSession } from "@/lib/api";
import { syncDemoDirectory } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  const result = await syncDemoDirectory(
    auth.session.username,
    getRequestIp(request.headers),
  );
  return Response.json({ success: true, result });
}
