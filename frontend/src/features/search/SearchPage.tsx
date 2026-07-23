import { BadgeCheck, Search as SearchIcon, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MediaCard } from "../../components/MediaCard";
import { ScrollRail } from "../../components/ScrollRail";
import { Section } from "../../components/Section";
import { TrackRow } from "../../components/TrackRow";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

export function SearchPage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const allTracks = repository.tracks();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"all" | "popular" | "newest" | "liked">(
    "all",
  );
  const [genre, setGenre] = useState("all");
  const needle = query.toLowerCase().trim();
  const includes = (value: string) =>
    !needle || value.toLowerCase().includes(needle);
  const genres = [...new Set(allTracks.map((track) => track.genre))];
  const tracks = allTracks
    .filter(
      (track) =>
        (includes(track.title) ||
          includes(track.artists.map((a) => a.stageName).join(" ")) ||
          includes(track.genre)) &&
        (genre === "all" || track.genre === genre) &&
        (sort !== "liked" || user.likedTrackIds.includes(track.id)),
    )
    .sort((a, b) => {
      if (sort === "liked") {
        return (
          user.likedTrackIds.indexOf(a.id) - user.likedTrackIds.indexOf(b.id)
        );
      }
      if (sort === "newest") {
        return b.publicReleaseAt.localeCompare(a.publicReleaseAt);
      }
      if (sort === "popular") {
        return b.uniqueListenerCount - a.uniqueListenerCount;
      }
      return a.title.localeCompare(b.title);
    });
  const releases = db.releases.filter(
    (release) =>
      release.status !== "archived" &&
      (includes(release.title) || includes(release.primaryArtist.stageName)),
  );
  const profiles = db.users.filter(
    (userItem) =>
      userItem.kind === "consumer" &&
      !userItem.deletedAt &&
      (includes(userItem.displayName) ||
        includes(userItem.username) ||
        includes(userItem.artistProfile?.stageName ?? "")),
  );
  const playlists = db.playlists.filter(
    (playlist) => playlist.visibility === "public" && includes(playlist.title),
  );
  const showCatalog = sort !== "liked";
  const hasResults =
    tracks.length ||
    (showCatalog && (releases.length || profiles.length || playlists.length));
  return (
    <div className="page search-page">
      <header className="page-heading">
        <span className="eyebrow">{t("search")}</span>
        <h1>{t("searchTitle")}</h1>
      </header>
      <div className="search-toolbar">
        <div className="search-box">
          <SearchIcon />
          <input
            id="search-query"
            name="query"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </div>
        <div className="filter-row">
          <select
            id="search-sort"
            name="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label={t("search")}
          >
            <option value="all">{t("all")}</option>
            <option value="popular">{t("sortPopular")}</option>
            <option value="newest">{t("sortNewest")}</option>
            <option value="liked">{t("likedSongs")}</option>
          </select>
          <select
            id="search-genre"
            name="genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            aria-label={t("genre")}
          >
            <option value="all">{t("allGenres")}</option>
            {genres.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!hasResults && (
        <div className="empty-state">
          <SearchIcon />
          <h2>{t("noResults")}</h2>
          <p>{t("noResultsBody")}</p>
        </div>
      )}
      {showCatalog && profiles.length > 0 && (
        <Section title={t("people")}>
          <ScrollRail className="profile-rail">
            {profiles.map((profile) => (
              <Link
                to={
                  profile.artistProfile
                    ? `/artist/${profile.username}`
                    : `/profile/${profile.username}`
                }
                className="profile-card"
                key={profile.id}
              >
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" />
                ) : (
                  <span>
                    <UserRound />
                  </span>
                )}
                <strong>
                  {profile.artistProfile?.stageName ?? profile.displayName}
                  {profile.artistProfile?.verifiedAt && <BadgeCheck />}
                </strong>
                <small>
                  @{profile.username} ·{" "}
                  {t(profile.artistProfile ? "artist" : "consumer")}
                </small>
              </Link>
            ))}
          </ScrollRail>
        </Section>
      )}
      {tracks.length > 0 && (
        <Section title={sort === "liked" ? t("likedSongs") : t("tracks")}>
          <ScrollRail className="track-list search-track-list" axis="y">
            {tracks.slice(0, sort === "liked" ? 40 : 24).map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                context={tracks}
                index={index}
              />
            ))}
          </ScrollRail>
        </Section>
      )}
      {showCatalog && releases.length > 0 && (
        <Section title={t("releases")}>
          <ScrollRail className="media-rail">
            {releases.map((release) => (
              <MediaCard
                key={release.id}
                title={release.title}
                subtitle={t(release.type)}
                artistName={release.primaryArtist.stageName}
                artistHref={`/artist/${release.primaryArtist.username}`}
                coverUrl={release.coverUrl}
                href={`/release/${release.id}`}
                manageTrackIds={release.trackIds}
              />
            ))}
          </ScrollRail>
        </Section>
      )}
      {showCatalog && playlists.length > 0 && (
        <Section title={t("playlists")}>
          <ScrollRail className="media-rail">
            {playlists.map((playlist) => (
              <MediaCard
                key={playlist.id}
                title={playlist.title}
                subtitle={t("tracksCount", { count: playlist.trackIds.length })}
                collageUrls={playlist.trackIds.map(
                  (id) =>
                    db.tracks.find((track) => track.id === id)?.coverUrl ??
                    null,
                )}
                href={`/playlist/${playlist.id}`}
              />
            ))}
          </ScrollRail>
        </Section>
      )}
    </div>
  );
}
