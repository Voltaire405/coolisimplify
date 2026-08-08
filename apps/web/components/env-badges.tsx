import type { EnvironmentVariable } from "@/lib/types"

/** The small trait chips shown next to an env var's key (runtime, buildtime…). */
export function EnvBadges({ env }: { env: EnvironmentVariable }) {
  const badges: Array<{ label: string; title: string }> = []
  if (env.is_runtime)
    badges.push({ label: "runtime", title: "Runtime variable" })
  if (env.is_buildtime)
    badges.push({ label: "buildtime", title: "Build-time variable" })
  if (env.is_shared) badges.push({ label: "shared", title: "Shared variable" })
  if (env.is_shown_once) badges.push({ label: "once", title: "Shown once" })
  if (badges.length === 0) return null
  return (
    <span className="shrink-0 gap-1">
      {badges.map((b) => (
        <span
          key={b.label}
          title={b.title}
          className="rounded border border-border px-1 py-0 text-[9px] tracking-wider text-muted-foreground uppercase"
        >
          {b.label}
        </span>
      ))}
    </span>
  )
}
