export const CURRENT_ENTERPRISE_MEMBERS_WILDCARD = "*";

export function parseDingTalkAllowedUserIds(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function isDingTalkUserAllowed(allowedUserIds: Set<string>, userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;
  return (
    allowedUserIds.has(CURRENT_ENTERPRISE_MEMBERS_WILDCARD) ||
    allowedUserIds.has(normalizedUserId)
  );
}
