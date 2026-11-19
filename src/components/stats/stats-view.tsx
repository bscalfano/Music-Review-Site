import Link from "next/link";
import { artistPath } from "@/lib/albums/paths";
import type { UserStats } from "@/lib/stats/user-stats";

/** One horizontal bar row. Width is relative to `max`; the number is always printed too. */
function Bar({
  label,
  value,
  max,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <li className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground text-right tabular-nums">{label}</span>
      <span className="bg-muted h-3 overflow-hidden rounded-sm" aria-hidden>
        <span
          className="block h-full rounded-sm bg-(--profile-accent,var(--primary))"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular-nums">
        {value}
        {suffix}
      </span>
    </li>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="border-b pb-2 text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

const starLabel = (halfStars: number) => `${halfStars / 2}★`;

/** S10: a person's rating habits at a glance. Pure presentation of `getUserStats`. */
export function StatsView({ stats, name }: { stats: UserStats; name: string }) {
  if (stats.total === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        {name} hasn&apos;t logged anything yet, so there are no stats.
      </p>
    );
  }
  const maxDist = Math.max(...stats.distribution);
  const maxYear = Math.max(...stats.perYear.map((y) => y.count), 0);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="md:col-span-2">
        <dl className="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Logged</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.total}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Rated</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.rated}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Average</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {stats.average === null ? "—" : `${stats.average.toFixed(1)}★`}
            </dd>
          </div>
        </dl>
      </div>

      <Section id="dist-h" title="Ratings">
        {stats.rated === 0 ? (
          <p className="text-muted-foreground text-sm">No ratings yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...stats.distribution.keys()].reverse().map((i) => (
              <Bar key={i} label={starLabel(i)} value={stats.distribution[i]} max={maxDist} />
            ))}
          </ul>
        )}
      </Section>

      <Section id="year-h" title="Logged per year">
        {stats.perYear.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...stats.perYear].reverse().map((y) => (
              <Bar key={y.year} label={String(y.year)} value={y.count} max={maxYear} />
            ))}
          </ul>
        )}
      </Section>

      <Section id="artists-h" title="Top artists">
        <ol className="divide-y text-sm">
          {stats.topArtists.map((a) => (
            <li key={a.slug} className="flex items-baseline justify-between gap-3 py-1.5">
              <Link href={artistPath(a)} className="min-w-0 truncate hover:underline">
                {a.name}
              </Link>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {a.count} {a.count === 1 ? "album" : "albums"}
                {a.average !== null ? ` · ${a.average.toFixed(1)}★` : ""}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="decade-h" title="Average by decade">
        {stats.byDecade.length === 0 ? (
          <p className="text-muted-foreground text-sm">No rated albums with a release date yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {stats.byDecade.map((d) => (
              <li
                key={d.decade}
                className="grid grid-cols-[4.5rem_1fr_6rem] items-center gap-2 text-sm"
              >
                <span className="text-muted-foreground text-right tabular-nums">{d.decade}s</span>
                <span className="bg-muted h-3 overflow-hidden rounded-sm" aria-hidden>
                  <span
                    className="block h-full rounded-sm bg-(--profile-accent,var(--primary))"
                    style={{ width: `${(d.average / 5) * 100}%` }}
                  />
                </span>
                <span className="tabular-nums">
                  {d.average.toFixed(1)}★ <span className="text-muted-foreground">({d.count})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
