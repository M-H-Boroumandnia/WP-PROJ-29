import { useSyncExternalStore } from "react";
import { repository } from "../repositories/localRepository";
import type { User } from "../domain/types";

const serverSnapshot = (): number => 0;
const authReadySnapshot = (): boolean => true;

export const useSession = (): User | null => {
  useSyncExternalStore(
    repository.subscribe,
    repository.revision,
    serverSnapshot,
  );
  return repository.sessionUser();
};

export const useAuthReady = (): boolean => {
  useSyncExternalStore(
    repository.subscribe,
    repository.revision,
    serverSnapshot,
  );
  const ready = (
    repository as typeof repository & { authReady?: () => boolean }
  ).authReady;
  return ready ? ready() : authReadySnapshot();
};

export const useDatabaseVersion = (): number =>
  useSyncExternalStore(
    repository.subscribe,
    repository.revision,
    serverSnapshot,
  );
