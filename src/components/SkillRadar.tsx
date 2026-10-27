import type { ArgumentSkillProfile } from "@/lib/skillProfile";

const SIZE = 220;
const CENTRE = SIZE / 2;
const RADIUS = 72;
// Horizontal room either side for the skill labels, which sit outside the web.
const LABEL_ROOM = 48;

function point(index: number, count: number, fraction: number): [number, number] {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return [CENTRE + Math.cos(angle) * RADIUS * fraction, CENTRE + Math.sin(angle) * RADIUS * fraction];
}

/**
 * The argument profile as a shape: one spoke per reasoning skill, further out
 * where more of that move has been observed in your own debates. A skill with
 * no observed signal sits at the centre with a hollow marker rather than
 * borrowing a guess. While the profile is still below its minimum sample the
 * shape is dashed: an early read, not an ability rating. The labelled rows in
 * SkillProfileBars stay the readable version of the same data.
 */
export default function SkillRadar({ profile }: { profile: ArgumentSkillProfile }) {
  const dims = profile.dimensions;
  // No observed signal anywhere is a blank web, not a profile: the rows below
  // already say "No observed signal yet".
  if (dims.length < 3 || dims.every((d) => d.score === null)) return null;
  const early = profile.debatesAnalysed < profile.minDebates;
  const shape = dims
    .map((d, i) => point(i, dims.length, d.score === null ? 0 : Math.max(0.06, d.score / 100)))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return (
    <figure className="skill-radar" data-testid="skill-radar">
      <svg viewBox={`${-LABEL_ROOM} 0 ${SIZE + LABEL_ROOM * 2} ${SIZE}`} role="img" aria-label={`Argument profile shape across ${dims.length} skills${early ? ", early read" : ""}. The rows below list each skill.`}>
        {[0.33, 0.66, 1].map((ring) => (
          <polygon
            key={ring}
            className="skill-radar-ring"
            points={dims.map((_, i) => point(i, dims.length, ring).map((v) => v.toFixed(1)).join(",")).join(" ")}
          />
        ))}
        {dims.map((d, i) => {
          const [x, y] = point(i, dims.length, 1);
          return <line key={`spoke-${d.key}`} className="skill-radar-spoke" x1={CENTRE} y1={CENTRE} x2={x} y2={y} />;
        })}
        <polygon className={`skill-radar-shape${early ? " is-early" : ""}`} points={shape} />
        {dims.map((d, i) => {
          const [x, y] = point(i, dims.length, d.score === null ? 0 : Math.max(0.06, d.score / 100));
          return (
            <circle
              key={`dot-${d.key}`}
              className={`skill-radar-dot${d.score === null ? " is-empty" : ""}${d.lowConfidence ? " is-low" : ""}`}
              cx={x}
              cy={y}
              r={3.2}
            />
          );
        })}
        {dims.map((d, i) => {
          const [x, y] = point(i, dims.length, 1.28);
          const anchor = Math.abs(x - CENTRE) < 8 ? "middle" : x > CENTRE ? "start" : "end";
          return (
            <text key={`label-${d.key}`} className="skill-radar-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              {d.label}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
