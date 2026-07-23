import { Crown, LockKeyhole } from "lucide-react";
import type { RoomParticipant } from "../domain/types";
import { useTranslation } from "react-i18next";

export function ParticipantOrbit({
  participants,
}: {
  participants: RoomParticipant[];
}) {
  const { t } = useTranslation();
  return (
    <div
      className="participant-orbit"
      aria-label={t("participants", { count: participants.length })}
    >
      {participants.slice(0, 10).map((participant, index) => (
        <span
          className={participant.accessState === "playable" ? "" : "locked"}
          style={
            {
              "--orbit-index": index,
              "--orbit-total": Math.max(1, participants.length),
            } as React.CSSProperties
          }
          key={participant.userId}
        >
          {participant.avatarUrl ? (
            <img src={participant.avatarUrl} alt={participant.displayName} />
          ) : (
            participant.displayName.slice(0, 1)
          )}
          {participant.isHost && <Crown />}
          {participant.accessState !== "playable" && <LockKeyhole />}
        </span>
      ))}
    </div>
  );
}

export function ParticipantAccessState({
  participant,
}: {
  participant: RoomParticipant;
}) {
  return (
    <span className={`participant-access ${participant.accessState}`}>
      {participant.accessState !== "playable" && <LockKeyhole />}
      {participant.displayName}
    </span>
  );
}
