import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CoverArt } from "../../components/CoverArt";
import { MediaCard } from "../../components/MediaCard";
import { ScrollRail } from "../../components/ScrollRail";
import { Section } from "../../components/Section";
import { TrackRow } from "../../components/TrackRow";
import type { Playlist } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { usePlayer } from "../../store/player";
import { useDatabaseVersion, useSession } from "../../store/session";

export function HomePage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const tracks = repository.tracks();
  const replace = usePlayer((s) => s.replaceContext);
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? "greetingMorning"
      : hour < 18
        ? "greetingAfternoon"
        : "greetingEvening";
  const visiblePlaylists = new Map(
    repository.visiblePlaylists().map((playlist) => [playlist.id, playlist]),
  );
  const recentPlaylists = user.recentlyPlayedPlaylistIds
    .map((id) => visiblePlaylists.get(id))
    .filter(Boolean) as Playlist[];
  const published = db.releases
    .filter((release) => release.status === "published")
    .sort((a, b) => b.publicReleaseAt.localeCompare(a.publicReleaseAt));
  const popular = [...tracks]
    .sort((a, b) => b.uniqueListenerCount - a.uniqueListenerCount)
    .slice(0, 5);
  const early = db.releases.filter((release) => release.isEarlyAccess);
  const followed = published.filter((release) =>
    user.followingIds.includes(release.ownerUserId),
  );

  return (
    <div className="page home-page">
      <header className="home-hero">
        <div>
          <span className="eyebrow">{t(greeting)}</span>
          <h1>{user.displayName}</h1>
          <p>{t("brandTagline")}</p>
        </div>
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" />
        ) : (
          <div className="avatar-fallback">{user.displayName.slice(0, 1)}</div>
        )}
      </header>
      {recentPlaylists.length > 0 && (
        <Section title={t("recentlyPlayedPlaylists")}>
          <ScrollRail className="media-rail">
            {recentPlaylists.slice(0, 12).map((playlist) => {
              const playlistTracks = tracks.filter((track) =>
                playlist.trackIds.includes(track.id),
              );
              const firstPlayable = playlistTracks.find(
                (track) => track.isPlayableForViewer,
              );
              return (
                <MediaCard
                  key={playlist.id}
                  title={playlist.title}
                  subtitle={t("tracksCount", {
                    count: playlist.trackIds.length,
                  })}
                  collageUrls={playlist.trackIds.map(
                    (id) =>
                      db.tracks.find((track) => track.id === id)?.coverUrl ??
                      null,
                  )}
                  href={`/playlist/${playlist.id}`}
                  onPlay={
                    firstPlayable
                      ? () => {
                          repository.recordRecentlyPlayedPlaylist(playlist.id);
                          replace(playlistTracks, firstPlayable.id);
                        }
                      : undefined
                  }
                />
              );
            })}
          </ScrollRail>
        </Section>
      )}
      {followed.length > 0 && (
        <Section title={t("followedRelease")}>
          <ScrollRail className="media-rail">
            {followed.map((release) => {
              const releaseTracks = tracks.filter((track) =>
                release.trackIds.includes(track.id),
              );
              return (
                <MediaCard
                  key={release.id}
                  title={release.title}
                  artistName={release.primaryArtist.stageName}
                  artistHref={`/artist/${release.primaryArtist.username}`}
                  coverUrl={release.coverUrl}
                  href={`/release/${release.id}`}
                  badge="new"
                  manageTrackIds={release.trackIds}
                  onPlay={() => replace(releaseTracks, release.trackIds[0])}
                />
              );
            })}
          </ScrollRail>
        </Section>
      )}
      <Section
        title={t("newReleases")}
        action={
          <Link to="/search" className="text-link">
            {t("search")} <ArrowRight />
          </Link>
        }
      >
        <ScrollRail className="media-rail">
          {published.slice(0, 5).map((release) => {
            const releaseTracks = tracks.filter((track) =>
              release.trackIds.includes(track.id),
            );
            return (
              <MediaCard
                key={release.id}
                title={release.title}
                artistName={release.primaryArtist.stageName}
                artistHref={`/artist/${release.primaryArtist.username}`}
                coverUrl={release.coverUrl}
                href={`/release/${release.id}`}
                manageTrackIds={release.trackIds}
                onPlay={() => replace(releaseTracks, release.trackIds[0])}
              />
            );
          })}
        </ScrollRail>
      </Section>
      {user.subscription.tier === "gold" && early.length > 0 && (
        <Section title={t("earlyAccess")}>
          <div className="early-banner">
            <div>
              <span className="eyebrow">
                <Sparkles /> {t("gold")}
              </span>
              <h3>{early[0].title}</h3>
              <p>
                <Link to={`/artist/${early[0].primaryArtist.username}`}>
                  {early[0].primaryArtist.stageName}
                </Link>{" "}
                ·{" "}
                {new Intl.DateTimeFormat(user.locale, {
                  dateStyle: "long",
                }).format(new Date(early[0].publicReleaseAt))}
              </p>
              <Link className="button gold" to={`/release/${early[0].id}`}>
                {t("play")}
              </Link>
            </div>
            <CoverArt src={early[0].coverUrl} alt={early[0].title} />
          </div>
        </Section>
      )}
      <Section title={t("popularTracks")}>
        <div className="track-list home-popular-tracks">
          {popular.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              context={popular}
              index={index}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
