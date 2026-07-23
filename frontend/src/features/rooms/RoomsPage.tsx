import {
  Crown,
  Headphones,
  Link2,
  LockKeyhole,
  MessageCircleHeart,
  Pause,
  Play,
  Plus,
  Radio,
  Shuffle,
  SkipForward,
  UserCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ParticipantAccessState,
  ParticipantOrbit,
} from "../../components/RoomPrimitives";
import { canUseRooms } from "../../domain/entitlements";
import type { ListeningRoom } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { useDatabaseVersion, useSession } from "../../store/session";

type RoomApi = {
  createRoom?: () => Promise<ListeningRoom>;
  joinRoom?: (inviteCode: string) => Promise<ListeningRoom>;
  addRoomTrack?: (roomId: string, trackId: string) => Promise<ListeningRoom>;
  roomSocketUrl?: (inviteCode: string) => string;
};

export function RoomsPage() {
  const { t } = useTranslation();
  const user = useSession()!;
  useDatabaseVersion();
  const tracks = repository.tracks();
  const api = repository as unknown as RoomApi;
  const [room, setRoom] = useState<ListeningRoom | null>(null);
  const [invite, setInvite] = useState("");
  const [trackId, setTrackId] = useState("");
  const [error, setError] = useState("");
  const [reaction, setReaction] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const current = useMemo(
    () =>
      tracks.find(
        (track) =>
          track.id ===
          room?.queue.find((item) => item.id === room.currentQueueItemId)
            ?.trackId,
      ),
    [room, tracks],
  );
  const me = room?.participants.find(
    (participant) => participant.userId === user.id,
  );
  const canControl = Boolean(me?.isHost || me?.canControl);

  useEffect(() => {
    if (!room?.inviteCode || !api.roomSocketUrl) return;
    socket.current?.close();
    const ws = new WebSocket(api.roomSocketUrl(room.inviteCode));
    socket.current = ws;
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data) as {
        type: string;
        room?: ListeningRoom;
        userId?: string;
        payload?: { emoji?: string };
      };
      if (payload.room) setRoom(payload.room);
      if (payload.type === "reaction" && payload.payload?.emoji) {
        setReaction(payload.payload.emoji);
        window.setTimeout(() => setReaction(null), 1400);
      }
    };
    ws.onerror = () => setError(t("roomConnectionError"));
    return () => ws.close();
  }, [api, room?.inviteCode, t]);

  const send = (type: string, payload: Record<string, unknown> = {}) =>
    socket.current?.readyState === WebSocket.OPEN &&
    socket.current.send(JSON.stringify({ type, payload }));
  const create = () =>
    api
      .createRoom?.()
      .then(setRoom)
      .catch((reason) => setError(reason.message ?? t("error")));
  const join = () =>
    api
      .joinRoom?.(invite)
      .then(setRoom)
      .catch((reason) => setError(reason.message ?? t("error")));
  const addTrack = () => {
    if (!room || !trackId) return;
    api
      .addRoomTrack?.(room.id, trackId)
      .then(setRoom)
      .catch((reason) => setError(reason.message ?? t("error")));
  };

  if (!canUseRooms(user.subscription.tier))
    return (
      <div className="page narrow-page">
        <div className="locked-card">
          <LockKeyhole />
          <div>
            <h1>{t("groupListening")}</h1>
            <p>{t("roomsGate")}</p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page rooms-page">
      <header className="page-heading with-action">
        <div>
          <span className="eyebrow">
            <Radio />
            {t("groupListening")}
          </span>
          <h1>{t("roomsTitle")}</h1>
          <p className="muted">{t("roomsSubtitle")}</p>
        </div>
        <button className="button primary" onClick={create}>
          <Plus />
          {t("createRoom")}
        </button>
      </header>
      <section className="room-join-card">
        <label htmlFor="room-invite-code">
          {t("roomCode")}
          <span className="input-icon">
            <Link2 />
            <input
              id="room-invite-code"
              name="inviteCode"
              value={invite}
              onChange={(event) => setInvite(event.target.value)}
              placeholder="ABCD1234"
            />
          </span>
        </label>
        <button
          className="button ghost"
          onClick={join}
          disabled={!invite.trim()}
        >
          {t("joinRoom")}
        </button>
      </section>
      {error && <p className="form-error">{error}</p>}
      {room ? (
        <section className="room-stage">
          <div className="room-now">
            <ParticipantOrbit participants={room.participants} />
            {reaction && <span className="room-reaction">{reaction}</span>}
            <div>
              <span className="eyebrow">
                {t("inviteCode")}: {room.inviteCode}
              </span>
              <h2>{current?.title ?? t("queueEmpty")}</h2>
              <p>{current?.artists[0]?.stageName ?? t("queueEmptyBody")}</p>
              {me?.accessState !== "playable" && (
                <div className="locked-card compact">
                  <LockKeyhole />
                  <span>{t("roomLocalLock")}</span>
                </div>
              )}
            </div>
          </div>
          <div className="room-controls">
            <button
              className="main-play"
              disabled={!canControl}
              onClick={() => send(room.isPlaying ? "pause" : "play")}
            >
              {room.isPlaying ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              disabled={!canControl}
              onClick={() =>
                send("track_changed", {
                  queueItemId:
                    room.queue[
                      (room.queue.findIndex(
                        (item) => item.id === room.currentQueueItemId,
                      ) +
                        1) %
                        Math.max(1, room.queue.length)
                    ]?.id,
                })
              }
            >
              <SkipForward />
            </button>
            <button
              className="icon-button"
              disabled={!canControl}
              onClick={() =>
                send("shuffle_changed", {
                  shuffleEnabled: !room.shuffleEnabled,
                })
              }
            >
              <Shuffle />
            </button>
            <button
              className="icon-button"
              onClick={() => send("reaction", { emoji: "💚" })}
            >
              <MessageCircleHeart />
            </button>
          </div>
          <div className="room-grid">
            <div className="room-panel">
              <h2>{t("queue")}</h2>
              <div className="room-add">
                <select
                  id="room-track-select"
                  name="trackId"
                  value={trackId}
                  onChange={(event) => setTrackId(event.target.value)}
                >
                  <option value="">{t("tracks")}</option>
                  {tracks
                    .filter((track) => track.isPlayableForViewer)
                    .map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.title} · {track.artists[0]?.stageName}
                      </option>
                    ))}
                </select>
                <button
                  className="button small"
                  onClick={addTrack}
                  disabled={!canControl || !trackId}
                >
                  <Plus />
                  {t("addQueue")}
                </button>
              </div>
              {room.queue.length ? (
                room.queue.map((item, index) => {
                  const track = tracks.find(
                    (candidate) => candidate.id === item.trackId,
                  );
                  return (
                    <button
                      className={
                        item.id === room.currentQueueItemId
                          ? "room-queue-row active"
                          : "room-queue-row"
                      }
                      key={item.id}
                      disabled={!canControl}
                      onClick={() =>
                        send("track_changed", { queueItemId: item.id })
                      }
                    >
                      <span>{index + 1}</span>
                      <strong>{track?.title ?? t("track")}</strong>
                      <small>{track?.artists[0]?.stageName}</small>
                    </button>
                  );
                })
              ) : (
                <p className="muted">{t("queueEmptyBody")}</p>
              )}
            </div>
            <div className="room-panel">
              <h2>{t("participants", { count: room.participants.length })}</h2>
              {room.participants.map((participant) => (
                <div className="room-participant-row" key={participant.userId}>
                  <ParticipantAccessState participant={participant} />
                  {participant.isHost && <Crown />}
                  {me?.isHost && participant.userId !== user.id && (
                    <>
                      <button
                        className="icon-button"
                        onClick={() =>
                          send("participant_permissions_changed", {
                            userId: participant.userId,
                            canControl: !participant.canControl,
                          })
                        }
                      >
                        <UserCheck />
                      </button>
                      <button
                        className="button small ghost"
                        onClick={() =>
                          send("host_changed", { userId: participant.userId })
                        }
                      >
                        {t("transferHost")}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div className="empty-state">
          <Headphones />
          <h2>{t("roomEmptyTitle")}</h2>
          <p>{t("roomEmptyBody")}</p>
        </div>
      )}
    </div>
  );
}
