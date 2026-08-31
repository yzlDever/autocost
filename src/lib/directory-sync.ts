import type { StoreState } from "./types";

export type DirectoryPerson = {
  userId: string;
  name: string;
  employeeNo: string | null;
  departmentIds: number[];
};

export type DirectorySnapshot = {
  people: DirectoryPerson[];
  departments: Map<number, string>;
};

function departmentLabel(person: DirectoryPerson, departments: Map<number, string>) {
  const names = person.departmentIds
    .map((departmentId) => departments.get(departmentId))
    .filter((name): name is string => Boolean(name) && name !== "全公司");
  return [...new Set(names)].join(" / ") || "全公司";
}

export function applyDingTalkDirectorySnapshot(
  draft: StoreState,
  snapshot: DirectorySnapshot,
  now: string,
) {
  const peopleByUserId = new Map(
    snapshot.people
      .filter((person) => person.userId.trim() && person.name.trim())
      .map((person) => [person.userId.trim(), person]),
  );
  const seenUserIds = new Set<string>();
  let created = 0;
  let updated = 0;

  peopleByUserId.forEach((person, userId) => {
    let employee = draft.employees.find((item) => item.id === userId);

    if (!employee) {
      employee = {
        id: userId,
        employeeNo: person.employeeNo,
        name: person.name.trim(),
        department: departmentLabel(person, snapshot.departments),
        status: "active",
        source: "dingtalk",
        lastSyncedAt: now,
      };
      draft.employees.push(employee);
      created += 1;
    } else {
      employee.employeeNo = person.employeeNo || employee.employeeNo;
      employee.name = person.name.trim();
      employee.department = departmentLabel(person, snapshot.departments);
      employee.status = "active";
      employee.source = "dingtalk";
      employee.lastSyncedAt = now;
      updated += 1;
    }
    seenUserIds.add(userId);
  });

  let inactivated = 0;
  draft.employees.forEach((employee) => {
    if (
      employee.source === "dingtalk" &&
      !seenUserIds.has(employee.id) &&
      employee.status !== "inactive"
    ) {
      employee.status = "inactive";
      employee.lastSyncedAt = now;
      inactivated += 1;
    }
  });

  return {
    count: peopleByUserId.size,
    created,
    updated,
    inactivated,
    departmentCount: snapshot.departments.size,
    syncedAt: now,
  };
}
