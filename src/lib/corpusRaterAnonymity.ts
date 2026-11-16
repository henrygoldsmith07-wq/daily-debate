/**
 * Blind raters stay blind, including to the moderator. Both the item view and
 * the admin CSV export label raters as "Rater 1..N" in submission order; the
 * raw rater_id is a real account id and must never reach the client.
 */
export function raterLabelsInOrder(ids: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const id of ids) {
    if (!labels.has(id)) labels.set(id, `Rater ${labels.size + 1}`);
  }
  return labels;
}
