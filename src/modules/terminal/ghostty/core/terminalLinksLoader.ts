import { selectionChangedByPointer } from "@/modules/terminal/ghostty/selection/TerminalSelectionController";
import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";

/** A queued click only belongs to the content and geometry it was made on. */
export function terminalLinkReplayStamp(
  options: LazyTerminalLinksOptions,
): string {
  const rect = options.target.getBoundingClientRect();
  const geometry = options.geometry();
  return [
    options.model.revision(),
    options.model.viewportOriginLine(),
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    geometry.cellWidth,
    geometry.cellHeight,
    geometry.shiftY,
  ].join(",");
}

export interface DeferredTerminalLinks {
  invalidate(): void;
  dispose(): void;
}

/**
 * Brings in the link trigger (`LazyTerminalLinks`) once the surface exists:
 * hovering a link is not needed to draw or stream the first terminal, so none
 * of its code belongs to the chunk that does.
 */
export function deferTerminalLinks(
  options: LazyTerminalLinksOptions,
): DeferredTerminalLinks {
  let links: DeferredTerminalLinks | null = null;
  let disposed = false;
  const events: Event[] = [];
  let clickStamp: string | null = null;
  let press: {
    down: PointerEvent;
    up: PointerEvent | null;
    evidence: { event: Event; distance: number } | null;
  } | null = null;
  const types = [
    "pointermove",
    "pointerdown",
    "pointerup",
    "pointerleave",
    "pointercancel",
    "lostpointercapture",
    "keydown",
    "keyup",
    "blur",
  ];
  const capture = (event: Event) => {
    const pointer = event as PointerEvent;
    if (
      event.type === "pointerdown" &&
      !pointer.button &&
      pointer.pointerType !== "touch"
    ) {
      clickStamp ??= terminalLinkReplayStamp(options);
      press = { down: pointer, up: null, evidence: null };
    } else if (
      event.type === "pointerleave" ||
      event.type === "pointercancel" ||
      event.type === "blur"
    ) {
      press = null;
    } else if (press && !press.up && pointer.pointerId === press.down.pointerId) {
      if (event.type === "pointerup" && !pointer.button) {
        press.up = pointer;
      } else if (event.type === "lostpointercapture") {
        press.evidence = { event, distance: Infinity };
      } else if (
        event.type === "pointermove" &&
        pointer.pointerType !== "touch"
      ) {
        // A drag can return to the press point before the code loads.
        const distance =
          (pointer.buttons & 1) === 0 || selectionChangedByPointer.has(event)
            ? Infinity
            : Math.hypot(
                pointer.clientX - press.down.clientX,
                pointer.clientY - press.down.clientY,
              );
        if (!press.evidence || distance > press.evidence.distance)
          press.evidence = { event, distance };
      }
    }
    if (
      (!press || press.up) &&
      event.type === "pointermove" &&
      events[events.length - 1]?.type === "pointermove"
    )
      events.pop();
    events.push(event);
    if (events.length > 64) {
      const index = events.findIndex(
        (queued) =>
          queued !== press?.down &&
          queued !== press?.up &&
          queued !== press?.evidence?.event,
      );
      events.splice(index, 1);
    }
  };
  const captureOutsideRelease = (event: PointerEvent) => {
    if (press && !press.up && !event.composedPath().includes(options.target))
      capture(event);
  };
  const listen = (add: boolean) => {
    for (const type of types) {
      const target =
        type.startsWith("pointer") || type === "lostpointercapture"
          ? options.target
          : options.keyTarget;
      if (add) target.addEventListener(type, capture);
      else target.removeEventListener(type, capture);
    }
    if (add) {
      options.keyTarget.addEventListener("pointerup", captureOutsideRelease, {
        capture: true,
      });
    } else {
      options.keyTarget.removeEventListener("pointerup", captureOutsideRelease, {
        capture: true,
      });
      press = null;
    }
  };
  listen(true);
  const loaded = import("./LazyTerminalLinks").then(({ LazyTerminalLinks }) => {
    if (disposed) return;
    const trigger = new LazyTerminalLinks(options);
    links = trigger;
    listen(false);
    const stale =
      clickStamp !== null && clickStamp !== terminalLinkReplayStamp(options);
    for (const event of events) {
      if (stale && (event.type === "pointerdown" || event.type === "pointerup"))
        continue;
      trigger.ingest(event);
    }
    events.length = 0;
  });
  loaded.catch((error) => {
    listen(false);
    events.length = 0;
    console.error(error);
  });
  return {
    invalidate: () => links?.invalidate(),
    dispose: () => {
      disposed = true;
      listen(false);
      events.length = 0;
      links?.dispose();
      links = null;
    },
  };
}
