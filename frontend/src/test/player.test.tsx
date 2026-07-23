import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PASSWORD } from "../data/seed";
import { Player } from "../features/player/Player";
import { repository } from "../repositories/localRepository";
import { usePlayer } from "../store/player";

describe("queue and player behavior", () => {
  beforeEach(() => {
    repository.reset();
    repository.login("listener.gold@sonora.demo", DEMO_PASSWORD);
    usePlayer.setState({
      trackIds: [],
      currentIndex: -1,
      isPlaying: false,
      position: 0,
      repeatMode: "off",
      shuffleEnabled: false,
      failureCount: 0,
      unavailableIds: [],
      toast: null,
    });
  });

  it("replaces the queue with the selected playback context", () => {
    const tracks = repository.tracks().slice(0, 4);
    act(() => usePlayer.getState().replaceContext(tracks, tracks[2].id));
    expect(usePlayer.getState().trackIds).toEqual(
      tracks.map((track) => track.id),
    );
    expect(usePlayer.getState().currentIndex).toBe(2);
    expect(usePlayer.getState().isPlaying).toBe(true);
  });

  it("keeps queue mutations separate from source playlists", () => {
    const playlist = repository.playlist("playlist-1")!;
    const tracks = repository
      .tracks()
      .filter((track) => playlist.trackIds.includes(track.id));
    act(() => {
      usePlayer.getState().replaceContext(tracks, tracks[0].id);
      usePlayer.getState().addToQueue("track-12");
    });
    expect(usePlayer.getState().trackIds).toContain("track-12");
    expect(repository.playlist("playlist-1")!.trackIds).not.toContain(
      "track-12",
    );
  });

  it("does not add locked tracks with Add next or Add to queue", () => {
    repository.logout();
    repository.login("listener.basic@sonora.demo", DEMO_PASSWORD);
    const locked = repository
      .tracks()
      .find((track) => track.id === "track-12")!;
    expect(locked.isPlayableForViewer).toBe(false);
    act(() => {
      usePlayer.getState().addNext(locked.id);
      usePlayer.getState().addToQueue(locked.id);
    });
    expect(usePlayer.getState().trackIds).not.toContain(locked.id);
    expect(usePlayer.getState().toast).toBe("cannotQueueLocked");
  });

  it("cycles repeat modes and toggles shuffle", () => {
    act(() => usePlayer.getState().cycleRepeat());
    expect(usePlayer.getState().repeatMode).toBe("all");
    act(() => usePlayer.getState().cycleRepeat());
    expect(usePlayer.getState().repeatMode).toBe("one");
    act(() => usePlayer.getState().toggleShuffle());
    expect(usePlayer.getState().shuffleEnabled).toBe(true);
  });

  it("supports keyboard play/pause and queue shortcuts", () => {
    const tracks = repository.tracks().slice(0, 2);
    act(() => usePlayer.getState().replaceContext(tracks, tracks[0].id));
    const view = render(
      <MemoryRouter>
        <Player />
      </MemoryRouter>,
    );
    fireEvent.keyDown(window, { code: "Space" });
    expect(usePlayer.getState().isPlaying).toBe(false);
    fireEvent.keyDown(window, { key: "q" });
    expect(usePlayer.getState().queueOpen).toBe(true);
    view.unmount();
  });

  it("skips a failed source after a short delay", async () => {
    vi.useFakeTimers();
    const tracks = repository.tracks().slice(0, 3);
    act(() => usePlayer.getState().replaceContext(tracks, tracks[0].id));
    const view = render(
      <MemoryRouter>
        <Player />
      </MemoryRouter>,
    );
    const audio = view.container.querySelector("audio")!;
    await act(async () => {
      await Promise.resolve();
    });
    expect(audio.getAttribute("src") || audio.src).toContain(
      tracks[0].audioUrl,
    );
    // Simulate a real media failure after a source is active.
    Object.defineProperty(audio, "error", {
      configurable: true,
      get: () => ({ code: 4, message: "MEDIA_ELEMENT_ERROR" }),
    });
    fireEvent.error(audio);
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(usePlayer.getState().currentIndex).toBe(1);
    expect(usePlayer.getState().unavailableIds).toContain(tracks[0].id);
    vi.useRealTimers();
    view.unmount();
  });

  it("wraps to the first track when next is pressed at the end", () => {
    const tracks = repository.tracks().slice(0, 3);
    act(() =>
      usePlayer.getState().replaceContext(tracks, tracks[tracks.length - 1].id),
    );
    expect(usePlayer.getState().currentIndex).toBe(2);
    act(() => usePlayer.getState().next());
    expect(usePlayer.getState().currentIndex).toBe(0);
    expect(usePlayer.getState().isPlaying).toBe(true);
  });
});
