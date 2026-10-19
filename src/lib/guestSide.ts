// Guest "Challenge me" side. Date-derived on purpose: a reload cannot swap the
// side mid-practice. Pure so the home screen can show the side before the start.
export function guestChallengeSide(now: Date = new Date()): "for" | "against" {
  const day = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) / 86_400_000;
  return day % 2 === 0 ? "for" : "against";
}
