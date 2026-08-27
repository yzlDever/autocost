import "server-only";

import { cache } from "react";
import { requireSession } from "./session";
import { getStoreState } from "./store";

export const getFinanceState = cache(async () => {
  await requireSession();
  return getStoreState();
});
