import { PageHeader } from "@/components/page-header";
import { getFinanceState } from "@/lib/dal";
import { isDingTalkDirectoryConfigured } from "@/lib/dingtalk";
import { PeopleClient } from "./people-client";

export const metadata = { title: "人员管理" };
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const state = await getFinanceState();
  return (
    <>
      <PageHeader eyebrow="组织目录" title="人员管理" description="人员以稳定 ID 关联工资数据；离职只改变状态，不会删除人员或已经保存的历史月份快照。" />
      <PeopleClient employees={state.employees} directoryConfigured={isDingTalkDirectoryConfigured()} />
    </>
  );
}
