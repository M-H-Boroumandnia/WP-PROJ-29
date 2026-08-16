import {
  Check,
  Copy,
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
import { ParticipantAccessState } from "../../components/RoomPrimitives";
import { canUseRooms } from "../../domain/entitlements";
import type { ListeningRoom, TrackView } from "../../domain/types";
import { repository } from "../../repositories/localRepository";
import { usePlayer } from "../../store/player";
import { useDatabaseVersion, useSession } from "../../store/session";

const ROOM_INVITE_KEY = "sonora.activeRoomInvite";

type RoomApi = {
  createRoom?: () => Promise<ListeningRoom>;
  joinRoom?: (inviteCode: string) => Promise<ListeningRoom>;
  getRoom?: (inviteCode: string) => Promise<ListeningRoom>;
  addRoomTrack?: (roomId: string, trackId: string) => Promise<ListeningRoom>;
  roomSocketUrl?: (inviteCode: string) => string;
  loadTracksByIds?: (ids: string[]) => Promise<void>;
};

function rememberInvite(code: string | null) {
  try {
    if (code) sessionStorage.setItem(ROOM_INVITE_KEY, code);
    else sessionStorage.removeItem(ROOM_INVITE_KEY);
  } catch {
    // sessionStorage may be unavailable
  }
}

function rememberedInvite() {
  try {
    return sessionStorage.getItem(ROOM_INVITE_KEY)?.trim().toUpperCase() || "";
  } catch {
    return "";
  }
}

function syncRoomPlayback(
  room: ListeningRoom,
  tracks: TrackView[],
  locallyPlayable: boolean,
) {
  const trackIds = room.queue.map((item) => item.trackId);
  const currentIndex = trackIds.length
    ? Math.max(
        0,
        room.queue.findIndex((item) => item.id === room.currentQueueItemId),
      )
    : -1;
  const wantPlaying = Boolean(
    room.isPlaying && locallyPlayable && currentIndex >= 0,
  );
  const currentId = currentIndex >= 0 ? trackIds[currentIndex] : null;
  const locked = currentId
    ? tracks.find((track) => track.id === currentId)?.isPlayableForViewer ===
      false
    : false;
  const playing = wantPlaying && !locked;
  const player = usePlayer.getState();
  const queueChanged =
    player.trackIds.length !== trackIds.length ||
    player.trackIds.some((id, index) => id !== trackIds[index]);
  const trackChanged = queueChanged || player.currentIndex !== currentIndex;

  usePlayer.setState({
    trackIds,
    currentIndex,
    isPlaying: playing,
    shuffleEnabled: room.shuffleEnabled,
    repeatMode: room.repeatMode,
    gestureRequired: false,
    ...(trackChanged
      ? {
          position: room.positionSeconds || 0,
          playbackNonce: player.playbackNonce + 1,
          failureCount: 0,
        }
      : {}),
  });
}

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
  const [copied, setCopied] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const restoring = useRef(false);

  useEffect(() => {
    void repository.loadCatalogData?.();
  }, []);

  useEffect(() => {
    const code = rememberedInvite();
    if (!code || !api.joinRoom || restoring.current) return;
    restoring.current = true;
    api
      .joinRoom(code)
      .then((restored) => {
        setRoom(restored);
        rememberInvite(restored.inviteCode);
      })
      .catch(() => rememberInvite(null))
      .finally(() => {
        restoring.current = false;
      });
  }, [api]);

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
  const locallyPlayable = me?.accessState === "playable";

  useEffect(() => {
    if (!room?.queue.length) return;
    void api.loadTracksByIds?.(room.queue.map((item) => item.trackId));
  }, [api, room?.queue]);

  useEffect(() => {
    if (!room) return;
    syncRoomPlayback(room, tracks, locallyPlayable);
  }, [room, tracks, locallyPlayable]);

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
      if (payload.room) {
        setRoom(payload.room);
        rememberInvite(payload.room.inviteCode);
      }
      if (payload.type === "reaction" && payload.payload?.emoji) {
        setReaction(payload.payload.emoji);
        window.setTimeout(() => setReaction(null), 1400);
      }
    };
    ws.onerror = () => setError(t("roomConnectionError"));
    return () => {
      ws.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [api, room?.inviteCode, t]);

  const send = (type: string, payload: Record<string, unknown> = {}) => {
    const ws = socket.current;
    if (!ws) return;
    const body = JSON.stringify({ type, payload });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(body);
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener("open", () => ws.send(body), { once: true });
    }
  };
  const enterRoom = (next: ListeningRoom) => {
    setRoom(next);
    rememberInvite(next.inviteCode);
    setError("");
  };
  const create = () =>
    api
      .createRoom?.()
      .then(enterRoom)
      .catch((reason) => setError(reason.message ?? t("error")));
  const join = () =>
    api
      .joinRoom?.(invite)
      .then(enterRoom)
      .catch((reason) => setError(reason.message ?? t("error")));
  const addTrack = () => {
    if (!room || !trackId) return;
    api
      .addRoomTrack?.(room.id, trackId)
      .then(enterRoom)
      .catch((reason) => setError(reason.message ?? t("error")));
  };
  const copyInvite = async () => {
    if (!room?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(room.inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t("error"));
    }
  };
  const togglePlayback = () => {
    if (!room?.currentQueueItemId) {
      setError(t("queueEmptyBody"));
      return;
    }
    // Optimistic local start so the click gesture unlocks audio immediately.
    if (!room.isPlaying && locallyPlayable && current?.isPlayableForViewer) {
      syncRoomPlayback(
        { ...room, isPlaying: true },
        tracks,
        locallyPlayable,
      );
    }
    send(room.isPlaying ? "pause" : "play");
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
            {reaction && <span className="room-reaction">{reaction}</span>}
            <div>
              <div className="room-now-top">
                <h2 className={current ? undefined : "room-now-empty"}>
                  {current ? (
                    current.title
                  ) : (
                    <>
                      {t("queueEmpty")}{" "}
                      <button
                        type="button"
                        className="room-invite-inline"
                        onClick={() => void copyInvite()}
                        title={
                          copied
                            ? t("inviteCopied")
                            : `${t("inviteCode")}: ${room.inviteCode}`
                        }
                        aria-label={
                          copied ? t("inviteCopied") : t("copyInviteCode")
                        }
                      >
                        {room.inviteCode}
                        {copied ? <Check /> : <Copy />}
                      </button>
                    </>
                  )}
                </h2>
                {current && (
                  <button
                    type="button"
                    className="room-invite-code"
                    onClick={() => void copyInvite()}
                    title={
                      copied
                        ? t("inviteCopied")
                        : `${t("inviteCode")}: ${room.inviteCode}`
                    }
                    aria-label={
                      copied ? t("inviteCopied") : t("copyInviteCode")
                    }
                  >
                    <strong className="room-invite-value">{room.inviteCode}</strong>
                    {copied ? <Check /> : <Copy />}
                  </button>
                )}
              </div>
              <p className={current ? undefined : "muted"}>
                {current?.artists[0]?.stageName ?? t("queueEmptyBody")}
              </p>
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
              onClick={togglePlayback}
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
