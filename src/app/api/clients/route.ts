import { jsonError, requireApiSession } from "@/lib/api";
import { createApiClientRecord, toggleApiClientRecord } from "@/lib/store";
import { getRequestIp } from "@/lib/utils";

function publicClient(client: Awaited<ReturnType<typeof toggleApiClientRecord>>) {
  return {
    id: client.id,
    name: client.name,
    keyPrefix: client.keyPrefix,
    keyLastFour: client.keyLastFour,
    status: client.status,
    createdAt: client.createdAt,
    lastUsedAt: client.lastUsedAt,
  };
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as { name?: string };
    const result = await createApiClientRecord(
      body.name ?? "",
      auth.session.username,
      getRequestIp(request.headers),
    );
    return Response.json({ success: true, key: result.key, client: publicClient(result.record) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "创建密钥失败。");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) return jsonError("接口来源 ID 无效。");
    const client = await toggleApiClientRecord(
      body.id,
      auth.session.username,
      getRequestIp(request.headers),
    );
    return Response.json({ success: true, client: publicClient(client) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "更新密钥失败。");
  }
}
