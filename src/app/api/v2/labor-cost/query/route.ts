import { handleLaborCostQuery } from "@/lib/labor-cost-query-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleLaborCostQuery(request);
}
