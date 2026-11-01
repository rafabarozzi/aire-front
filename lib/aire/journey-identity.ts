import type { Journey } from "./types.ts";
export function journeyKey(
  j: Pick<Journey, "repository" | "endpoint" | "sourceSubdirectory">,
) {
  const endpoint = j.endpoint.trim().replace(/\s+/g, " ");
  // A method omitted by an older client is deliberately not guessed to be GET.
  return JSON.stringify([
    j.repository.toLowerCase(),
    endpoint,
    (j.sourceSubdirectory || "")
      .split("/")
      .filter((p) => p && p !== ".")
      .join("/"),
  ]);
}
export function latestJourneys(all: Journey[]): Journey[] {
  const groups = new Map<string, Journey[]>();
  for (const j of all) {
    const key = journeyKey(j);
    groups.set(key, [...(groups.get(key) || []), j]);
  }
  return [...groups.values()]
    .map((rows) => {
      rows.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
      return {
        ...rows[0],
        journeyKey: journeyKey(rows[0]),
        versionCount: rows.length,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
