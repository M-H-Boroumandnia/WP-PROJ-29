import { Banknote, BarChart3, FileAudio, Landmark, Music, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverArt } from "../../components/CoverArt";
import type { ArtistAnalytics } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { useSession } from "../../store/session";

const emptyAnalytics = (): ArtistAnalytics => ({
  streams: 0,
  tracks: 0,
  releases: 0,
  uniqueListeners: 0,
  rewardRial: 0,
  paidRial: 0,
  unpaidRial: 0,
  period: "",
  verified: false,
  streamsByRelease: [],
  topTracks: [],
});

export function StudioStatistics({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  const user = useSession();
  const [stats, setStats] = useState<ArtistAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const formatToman = (rial: number) =>
    `${Math.round(rial / 10).toLocaleString(user?.locale ?? "en")} ${t("toman")}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void repository
      .artistAnalytics()
      .then((payload) => {
        if (!cancelled) setStats(payload);
      })
      .catch(() => {
        if (!cancelled) setStats(emptyAnalytics());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlocked = verified || Boolean(stats?.verified);

  if (loading && !unlocked)
    return (
      <section className="studio-stats">
        <p className="muted">{t("loading")}</p>
      </section>
    );

  if (!unlocked)
    return (
      <div className="studio-locked">
        <BarChart3 />
        <h2>{t("verifiedOnly")}</h2>
        <p>{t("studioStatsLocked")}</p>
      </div>
    );

  if (!stats)
    return (
      <section className="studio-stats">
        <p className="muted">{t("loading")}</p>
      </section>
    );

  const maxBar = Math.max(1, ...stats.streamsByRelease.map((row) => row.streams));

  return (
    <section className="studio-stats">
      <div className="studio-metrics studio-metrics-five">
        <div>
          <Music />
          <span>{t("releases")}</span>
          <strong>{stats.releases}</strong>
        </div>
        <div>
          <FileAudio />
          <span>{t("tracks")}</span>
          <strong>{stats.tracks}</strong>
        </div>
        <div>
          <BarChart3 />
          <span>{t("streams")}</span>
          <strong>{stats.streams.toLocaleString()}</strong>
        </div>
        <div>
          <Users />
          <span>{t("uniqueListeners")}</span>
          <strong>{stats.uniqueListeners.toLocaleString()}</strong>
        </div>
        <div>
          <Landmark />
          <span>{t("paidRevenue")}</span>
          <strong>{formatToman(stats.paidRial)}</strong>
        </div>
        <div>
          <Banknote />
          <span>{t("unpaidRevenue")}</span>
          <strong>{formatToman(stats.unpaidRial)}</strong>
        </div>
      </div>
      <div className="studio-stats-stack">
        <article className="analytics-chart">
          <h3>{t("streamsByRelease")}</h3>
          {stats.streamsByRelease.length ? (
            <div
              className="studio-bar-chart studio-bar-chart-horizontal"
              role="img"
              aria-label={t("streamsByRelease")}
            >
              {stats.streamsByRelease.map((row) => (
                <div className="studio-bar" key={row.id}>
                  <span className="studio-bar-label" title={row.title}>
                    {row.title}
                  </span>
                  <div className="studio-bar-track">
                    <div
                      className="studio-bar-fill"
                      style={{
                        width: `${Math.max(4, (row.streams / maxBar) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="studio-bar-value">
                    {row.streams.toLocaleString()}
                    <small>{formatToman(row.rewardRial)}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("noPublishedCatalog")}</p>
          )}
        </article>
        <article className="studio-top-tracks">
          <h3>{t("topTracks")}</h3>
          {stats.topTracks.length ? (
            <ol>
              {stats.topTracks.map((track) => (
                <li key={track.id}>
                  <CoverArt src={track.coverUrl} alt={track.title} />
                  <div>
                    <strong>{track.title}</strong>
                    <span className="muted">{track.releaseTitle}</span>
                  </div>
                  <em>{track.streamCount.toLocaleString()}</em>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">{t("noPublishedCatalog")}</p>
          )}
        </article>
      </div>
    </section>
  );
}
