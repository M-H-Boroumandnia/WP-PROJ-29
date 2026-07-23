import { Check, ListMusic, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { playlistLimit } from "../domain/entitlements";
import { uiError } from "../features/shared/errors";
import { repository } from "../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../store/session";
import { PlaylistCollage } from "./CoverArt";

function ownedContainingAll(trackIds: string[]) {
  const selected = new Set<string>();
  if (!trackIds.length) return selected;
  repository.library().owned.forEach((playlist) => {
    if (trackIds.every((id) => playlist.trackIds.includes(id))) {
      selected.add(playlist.id);
    }
  });
  return selected;
}

export function PlaylistManageModal({
  trackIds,
  onClose,
}: {
  trackIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const db = repository.database();
  const owned = repository.library().owned;
  const limit = playlistLimit(user.subscription.tier);
  const [selected, setSelected] = useState(() => ownedContainingAll(trackIds));
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const atLimit = owned.length >= limit;

  const applySelection = (next: Set<string>) => {
    setSelected(next);
    repository.syncTrackPlaylists(trackIds, [...next]);
  };

  const toggle = (playlistId: string) => {
    const next = new Set(selected);
    if (next.has(playlistId)) next.delete(playlistId);
    else next.add(playlistId);
    applySelection(next);
  };

  const create = () => {
    if (atLimit) {
      setError(t("playlistLimit"));
      return;
    }
    Promise.resolve(
      repository.createPlaylist(title.trim() || t("playlistName")),
    )
      .then((playlist) => {
        const next = new Set(selected).add(playlist.id);
        applySelection(next);
        setCreating(false);
        setTitle("");
        setError("");
      })
      .catch((reason) => setError(uiError(reason, t)));
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal playlist-manage-modal"
        role="dialog"
        aria-labelledby="playlist-manage-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="playlist-manage-head">
          <div className="playlist-manage-title-block">
            <span className="playlist-manage-icon" aria-hidden>
              <ListMusic />
            </span>
            <div>
              <h2 id="playlist-manage-title">{t("managePlaylists")}</h2>
              <p className="playlist-manage-hint">{t("managePlaylistsHint")}</p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X />
          </button>
        </div>

        {Number.isFinite(limit) && (
          <div className="playlist-manage-meta">
            <span className={`playlist-manage-limit ${atLimit ? "is-full" : ""}`}>
              {t("playlistLimitCount", {
                count: owned.length,
                limit,
              })}
            </span>
          </div>
        )}

        <div className="playlist-manage-body">
          {owned.length ? (
            <ul className="playlist-check-list">
              {owned.map((playlist) => {
                const checked = selected.has(playlist.id);
                const covers = playlist.trackIds.map(
                  (id) =>
                    db.tracks.find((track) => track.id === id)?.coverUrl ?? null,
                );
                return (
                  <li key={playlist.id}>
                    <button
                      type="button"
                      className={`playlist-check-row ${checked ? "is-checked" : ""}`}
                      onClick={() => toggle(playlist.id)}
                      aria-pressed={checked}
                    >
                      <span className="playlist-check-art" aria-hidden>
                        <PlaylistCollage
                          urls={covers}
                          title={playlist.title}
                        />
                      </span>
                      <span className="playlist-check-copy">
                        <strong>{playlist.title}</strong>
                        <small>
                          {t(playlist.visibility)} ·{" "}
                          {t("tracksCount", {
                            count: playlist.trackIds.length,
                          })}
                        </small>
                      </span>
                      <span className="playlist-check-mark" aria-hidden>
                        {checked ? <Check /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="playlist-manage-empty">
              <ListMusic />
              <p>{t("noOwnedPlaylists")}</p>
            </div>
          )}
        </div>

        <div className="playlist-manage-footer">
          {creating ? (
            <div className="playlist-manage-create">
              <input
                id="playlist-manage-title-input"
                name="playlistTitle"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && create()}
                placeholder={t("playlistName")}
                aria-label={t("playlistName")}
              />
              <button type="button" className="button primary" onClick={create}>
                {t("create")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button ghost playlist-manage-create-btn"
              disabled={atLimit}
              onClick={() => {
                if (atLimit) {
                  setError(t("playlistLimit"));
                  return;
                }
                setCreating(true);
                setError("");
              }}
            >
              <Plus />
              {t("create")}
            </button>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
