import { LockKeyhole } from "lucide-react";
import type { RoomParticipant } from "../domain/types";

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
