import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Heart,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlaylistCollage } from "../../components/CoverArt";
import { EmptyState } from "../../components/EmptyState";
import type { TrackView } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { usePlayer } from "../../store/player";
import { useDatabaseVersion, useSession } from "../../store/session";

function SortableTrack({
  track,
  index,
  total,
  context,
  playlistId,
  move,
  remove,
}: {
  track: TrackView;
  index: number;
  total: number;
  context: TrackView[];
  playlistId: string;
  move: (from: number, to: number) => void;
  remove: () => void;
}) {
  const { t } = useTranslation();
  const replace = usePlayer((s) => s.replaceContext);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`sortable-track ${isDragging ? "dragging" : ""}`}
    >
      <button
        className="drag-button"
        {...attributes}
        {...listeners}
        aria-label={t("dragHelp")}
      >
        <GripVertical />
      </button>
      <button
        className="track-play"
        onClick={() => {
          repository.recordRecentlyPlayedPlaylist(playlistId);
          replace(context, track.id);
        }}
        disabled={!track.isPlayableForViewer}
      >
        <Play fill="currentColor" />
      </button>
      <span className="track-order">{index + 1}</span>
      <div className="track-main">
        <strong>{track.title}</strong>
        <span>{track.artists[0].stageName}</span>
      </div>
      <div className="keyboard-order">
        <button
          className="icon-button"
          disabled={index === 0}
          onClick={() => move(index, index - 1)}
          aria-label={`${t("dragHelp")} ${index}`}
        >
          <ArrowUp />
        </button>
        <button
          className="icon-button"
          disabled={index === total - 1}
          onClick={() => move(index, index + 1)}
          aria-label={`${t("dragHelp")} ${index + 2}`}
        >
          <ArrowDown />
        </button>
      </div>
      <button
        className="icon-button danger"
        onClick={remove}
        aria-label={t("remove")}
      >
        <Trash2 />
      </button>
    </div>
  );
}

export function PlaylistPage() {
  const { playlistId = "" } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useSession()!;
  useDatabaseVersion();
  const playlist = repository.playlist(playlistId);
  const tracks = repository.tracks();
  const db = repository.database();
  const replace = usePlayer((s) => s.replaceContext);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(playlist?.title ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");
  const [visibility, setVisibility] = useState<"private" | "public">(
    playlist?.visibility ?? "private",
  );
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  if (!playlist)
    return (
      <div className="page">
        <EmptyState icon={Heart} title={t("notFound")} body={t("forbidden")} />
      </div>
    );
  const owner = db.users.find((user) => user.id === playlist.ownerId)!;
  const own = owner.id === me.id;
  const playlistTracks = playlist.trackIds
    .map((id) => tracks.find((track) => track.id === id))
    .filter(Boolean) as TrackView[];
  const updateOrder = (ids: string[]) =>
    repository.updatePlaylist(playlist.id, { trackIds: ids });
  const move = (from: number, to: number) =>
    updateOrder(arrayMove(playlist.trackIds, from, to));
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      move(
        playlist.trackIds.indexOf(String(active.id)),
        playlist.trackIds.indexOf(String(over.id)),
      );
  };
  const save = () => {
    repository.updatePlaylist(playlist.id, { title, description, visibility });
    setEditing(false);
  };
  return (
    <div className="page detail-page playlist-page">
      <header className="detail-hero release-hero">
        <PlaylistCollage
          urls={playlistTracks.map((track) => track.coverUrl)}
          title={playlist.title}
        />
        <div>
          <span className="eyebrow">
            {t("playlist")} · {t(playlist.visibility)}
          </span>
          {editing ? (
            <input
              id="playlist-edit-title"
              name="title"
              className="title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label={t("playlistName")}
            />
          ) : (
            <h1>{playlist.title}</h1>
          )}
          <Link
            to={
              owner.artistProfile
                ? `/artist/${owner.username}`
                : `/profile/${owner.username}`
            }
            className="artist-link"
          >
            {owner.artistProfile?.stageName ?? owner.displayName}
          </Link>
          <p>{t("tracksCount", { count: playlistTracks.length })}</p>
          {playlist.description ? <p>{playlist.description}</p> : null}
        </div>
      </header>
      <div className="detail-actions">
        <button
          className="main-play large"
          onClick={() => {
            if (!playlistTracks[0]) return;
            repository.recordRecentlyPlayedPlaylist(playlist.id);
            replace(playlistTracks, playlistTracks[0].id);
          }}
          disabled={!playlistTracks.length}
        >
          <Play fill="currentColor" />
        </button>
        {own ? (
          <>
            <button
              className="button ghost"
              onClick={() => navigate("/search")}
            >
              <Plus />
              {t("tracks")}
            </button>
            <div className="detail-actions-end">
              <button
                className="button ghost"
                onClick={() => setEditing(!editing)}
              >
                <Pencil />
                {t("edit")}
              </button>
              <button
                className="icon-button danger"
                onClick={() => setDeleting(true)}
                aria-label={t("delete")}
              >
                <Trash2 />
              </button>
            </div>
          </>
        ) : (
          <button
            className={`button ${me.savedPlaylistIds.includes(playlist.id) ? "ghost" : "primary"}`}
            onClick={() => repository.savePlaylist(playlist.id)}
          >
            <Save />
            {t(me.savedPlaylistIds.includes(playlist.id) ? "unsave" : "save")}
          </button>
        )}
      </div>
      {!own && <p className="notice-line">{t("liveReference")}</p>}
      {editing && (
        <div className="edit-panel">
          <label htmlFor="playlist-edit-description">
            {t("description")}
            <textarea
              id="playlist-edit-description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label htmlFor="playlist-edit-visibility">
            {t("visibility")}
            <select
              id="playlist-edit-visibility"
              name="visibility"
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as typeof visibility)
              }
            >
              <option value="private">{t("private")}</option>
              <option value="public">{t("public")}</option>
            </select>
          </label>
          <button className="button primary" onClick={save}>
            {t("save")}
          </button>
        </div>
      )}
      {playlistTracks.length ? (
        own ? (
          <>
            <p className="muted drag-copy">{t("dragHelp")}</p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={dragEnd}
            >
              <SortableContext
                items={playlist.trackIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="sortable-list">
                  {playlistTracks.map((track, index) => (
                    <SortableTrack
                      key={track.id}
                      track={track}
                      index={index}
                      total={playlistTracks.length}
                      context={playlistTracks}
                      playlistId={playlist.id}
                      move={move}
                      remove={() =>
                        updateOrder(
                          playlist.trackIds.filter((id) => id !== track.id),
                        )
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        ) : (
          <div className="track-list">
            {playlistTracks.map((track, index) => (
              <button
                className="public-track"
                key={track.id}
                onClick={() => {
                  repository.recordRecentlyPlayedPlaylist(playlist.id);
                  replace(playlistTracks, track.id);
                }}
                disabled={!track.isPlayableForViewer}
              >
                <span>{index + 1}</span>
                <strong>{track.title}</strong>
                <small>{track.artists[0].stageName}</small>
                <Play />
              </button>
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon={Heart}
          title={t("playlistEmpty")}
          body={t("playlistEmptyBody")}
        />
      )}
      {deleting && (
        <div
          className="modal-backdrop"
          onClick={() => setDeleting(false)}
          role="presentation"
        >
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-playlist-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{t("playlist")}</span>
                <h2 id="delete-playlist-title">{t("deleteConfirm")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setDeleting(false)}
                aria-label={t("close")}
              >
                <X />
              </button>
            </div>
            <p className="muted">{t("deleteConfirmBody")}</p>
            <div className="modal-actions">
              <button
                className="button ghost"
                onClick={() => setDeleting(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="button danger"
                onClick={() => {
                  repository.deletePlaylist(playlist.id);
                  navigate("/library");
                }}
              >
                <Trash2 />
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
