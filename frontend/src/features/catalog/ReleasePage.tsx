import { CalendarDays, LockKeyhole, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { CoverArt } from "../../components/CoverArt";
import { EmptyState } from "../../components/EmptyState";
import { TrackRow } from "../../components/TrackRow";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

export function ReleasePage() {
  const { releaseId = "" } = useParams();
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const release = db.releases.find(
    (item) => item.id === releaseId && item.status !== "archived",
  );
  const allTracks = repository.tracks();
  const [renderNow] = useState(() => Date.now());
  if (!release)
    return (
      <div className="page">
        <EmptyState
          icon={LockKeyhole}
          title={t("notFound")}
          body={t("forbidden")}
        />
      </div>
    );
  const tracks = release.trackIds
    .map((id) => allTracks.find((track) => track.id === id))
    .filter(Boolean) as typeof allTracks;
  const date = new Intl.DateTimeFormat(user.locale, {
    dateStyle: "long",
  }).format(new Date(release.publicReleaseAt));
  const earlyDays = Math.max(
    0,
    Math.ceil(
      (new Date(release.publicReleaseAt).getTime() - renderNow) / 86_400_000,
    ),
  );
  return (
    <div className="page detail-page">
      <header className="detail-hero release-hero">
        <CoverArt src={release.coverUrl} alt={release.title} />
        <div>
          <span className="eyebrow">
            {t(release.type)} · {release.genre}
          </span>
          <h1>{release.title}</h1>
          <Link
            to={`/artist/${release.primaryArtist.username}`}
            className="artist-link"
          >
            {release.primaryArtist.stageName}
          </Link>
          <p>
            <CalendarDays />
            {t("released")}: {date}
          </p>
          {release.isEarlyAccess && (
            <span className="gold-chip">
              <Sparkles />
              {t("earlyAccess")} · {earlyDays} {t("days")}
            </span>
          )}
        </div>
      </header>
      <div className="track-list">
        {tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            context={tracks}
            index={index}
          />
        ))}
      </div>
      <footer className="release-foot">
        <strong>{release.primaryArtist.stageName}</strong>
        <span>{t("catalogCopyright")}</span>
      </footer>
    </div>
  );
}
