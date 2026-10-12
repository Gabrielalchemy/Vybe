import { useSyncExternalStore } from "react";

interface Store<S> {
  subscribe(listener: (s: S) => void): () => void;
}

/** Subscribes React to a non-React store that publishes immutable snapshots. */
export function useSnapshot<S>(store: Store<S>, read: () => S | null): S | null {
  return useSyncExternalStore(
    (notify) => store.subscribe(() => notify()),
    read,
  );
}
