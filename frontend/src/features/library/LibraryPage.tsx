import { LibraryBig, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { MediaCard } from "../../components/MediaCard";
import { PlaylistManageModal } from "../../components/PlaylistManageModal";
import { Section } from "../../components/Section";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

export function LibraryPage() {
  const { t } = useTranslation();
  useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const { owned, saved } = repository.library();
  const [managing, setManaging] = useState(false);

  return (
    <div className="page library-page">
      <header className="page-heading with-action">
        <div>
          <h1>{t("yourLibrary")}</h1>
        </div>
        <button className="button primary" onClick={() => setManaging(true)}>
          <Plus />
          {t("createPlaylist")}
        </button>
      </header>
      <Section title={t("ownedPlaylists")}>
        <div className="media-grid">
          {owned.map((playlist) => (
            <MediaCard
              key={playlist.id}
              title={playlist.title}
              subtitle={`${t(playlist.visibility)} · ${t("tracksCount", { count: playlist.trackIds.length })}`}
              collageUrls={playlist.trackIds.map(
                (id) =>
                  db.tracks.find((track) => track.id === id)?.coverUrl ?? null,
              )}
              href={`/playlist/${playlist.id}`}
            />
          ))}
          <button className="create-card" onClick={() => setManaging(true)}>
            <span>
              <Plus />
            </span>
            <strong>{t("createPlaylist")}</strong>
          </button>
        </div>
      </Section>
      <Section title={t("savedPlaylists")}>
        {saved.length ? (
          <div className="media-grid">
            {saved.map((playlist) => (
              <MediaCard
                key={playlist.id}
                title={playlist.title}
                subtitle={t("liveReference")}
                collageUrls={playlist.trackIds.map(
                  (id) =>
                    db.tracks.find((track) => track.id === id)?.coverUrl ??
                    null,
                )}
                href={`/playlist/${playlist.id}`}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={LibraryBig}
            title={t("savedPlaylists")}
            body={t("noPublicPlaylists")}
          />
        )}
      </Section>
      {managing && (
        <PlaylistManageModal trackIds={[]} onClose={() => setManaging(false)} />
      )}
    </div>
  );
}
