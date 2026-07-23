import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

function useFineHover() {
  const [fineHover, setFineHover] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
      : true,
  );
  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFineHover(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return fineHover;
}

export function ScrollRail({
  className = "",
  axis = "x",
  children,
}: {
  className?: string;
  axis?: "x" | "y";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const fineHover = useFineHover();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canStart, setCanStart] = useState(false);
  const [canEnd, setCanEnd] = useState(false);
  const [hovered, setHovered] = useState(false);

  const update = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    if (axis === "x") {
      const max = node.scrollWidth - node.clientWidth;
      setCanStart(node.scrollLeft > 2);
      setCanEnd(max - node.scrollLeft > 2);
    } else {
      const max = node.scrollHeight - node.clientHeight;
      setCanStart(node.scrollTop > 2);
      setCanEnd(max - node.scrollTop > 2);
    }
  }, [axis]);

  useLayoutEffect(() => {
    update();
  }, [update, children]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const scrollByPage = (direction: 1 | -1) => {
    const node = scrollerRef.current;
    if (!node) return;
    if (axis === "x") {
      const amount = Math.max(node.clientWidth * 0.85, 120);
      node.scrollBy({ left: direction * amount, behavior: "smooth" });
    } else {
      const amount = Math.max(node.clientHeight * 0.85, 80);
      node.scrollBy({ top: direction * amount, behavior: "smooth" });
    }
  };

  const overflow = canStart || canEnd;
  const showControls = fineHover && overflow && hovered;

  return (
    <div
      className={`scroll-rail ${axis === "y" ? "is-vertical" : "is-horizontal"} ${overflow ? "has-overflow" : ""} ${showControls ? "show-controls" : ""}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {axis === "x" ? (
        <>
          <button
            type="button"
            className="scroll-rail-btn is-start"
            hidden={!canStart || !showControls}
            tabIndex={showControls && canStart ? 0 : -1}
            aria-label={t("scrollLeft")}
            onClick={() => scrollByPage(-1)}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="scroll-rail-btn is-end"
            hidden={!canEnd || !showControls}
            tabIndex={showControls && canEnd ? 0 : -1}
            aria-label={t("scrollRight")}
            onClick={() => scrollByPage(1)}
          >
            <ChevronRight />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="scroll-rail-btn is-start"
            hidden={!canStart || !showControls}
            tabIndex={showControls && canStart ? 0 : -1}
            aria-label={t("scrollUp")}
            onClick={() => scrollByPage(-1)}
          >
            <ChevronUp />
          </button>
          <button
            type="button"
            className="scroll-rail-btn is-end"
            hidden={!canEnd || !showControls}
            tabIndex={showControls && canEnd ? 0 : -1}
            aria-label={t("scrollDown")}
            onClick={() => scrollByPage(1)}
          >
            <ChevronDown />
          </button>
        </>
      )}
      <div ref={scrollerRef} className={`scroll-rail-scroller ${className}`}>
        {children}
      </div>
    </div>
  );
}
