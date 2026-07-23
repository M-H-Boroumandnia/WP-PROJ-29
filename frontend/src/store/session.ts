import { useSyncExternalStore } from "react";
import { repository } from "../repositories/localRepository";
import type { User } from "../domain/types";

const serverSnapshot = (): number => 0;
export const useSession = (): User | null => {
  useSyncExternalStore(
    repository.subscribe,
    repository.revision,
    serverSnapshot,
  );
  return repository.sessionUser();
};

export const useDatabaseVersion = (): number =>
  useSyncExternalStore(
    repository.subscribe,
    repository.revision,
    serverSnapshot,
  );
