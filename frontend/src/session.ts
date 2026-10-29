import { useEffect, useRef } from "react";
import { api, type Row } from "./api";

export function useSession(
  user: Row | null,
  onExpired: () => void | Promise<void>,
) {
  const expire = useRef(onExpired);
  expire.current = onExpired;
  useEffect(() => {
    if (!user) return;
    const localDeadline = (snapshot: Row) =>
      typeof snapshot.session_remaining_seconds === "number"
        ? Date.now() + snapshot.session_remaining_seconds * 1000
        : Number(snapshot.session_expires_at || 0) * 1000;
    let deadline = localDeadline(user);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false,
      ending = false,
      checking = false,
      touching = false;
    let lastTouch = 0;
    const expired = () => {
      if (ending || stopped) return;
      ending = true;
      clearTimeout(timer);
      void expire.current();
    };
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || ending || !deadline) return;
      timer = setTimeout(
        () => void check(),
        Math.min(2147483647, Math.max(100, deadline - Date.now() + 100)),
      );
    };
    const check = async () => {
      if (checking || stopped || ending) return;
      checking = true;
      try {
        const current = await api("auth/me");
        if (stopped) return;
        if (current.id !== user.id) {
          window.location.reload();
          return;
        }
        deadline = localDeadline(current);
        schedule();
      } catch (error: any) {
        if (
          error.code === "UNAUTHENTICATED" ||
          error.code === "SESSION_EXPIRED"
        )
          expired();
        else if (deadline && deadline <= Date.now()) expired();
        else if (!stopped && !ending)
          timer = setTimeout(() => void check(), 15000);
      } finally {
        checking = false;
      }
    };
    const active = () => {
      if (
        stopped ||
        ending ||
        touching ||
        document.visibilityState !== "visible"
      )
        return;
      const throttle = Math.min(
        60000,
        Math.max(
          1000,
          Number(user.session_idle_timeout_seconds || 604800) * 250,
        ),
      );
      if (Date.now() - lastTouch < throttle) return;
      lastTouch = Date.now();
      touching = true;
      api("auth/activity", "POST")
        .then((current) => {
          if (stopped) return;
          deadline = localDeadline(current);
          schedule();
        })
        .catch(() => {})
        .finally(() => {
          touching = false;
        });
    };
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "reqflow:session-check") void check();
    };
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
    ];
    events.forEach((event) =>
      document.addEventListener(event, active, {
        capture: true,
        passive: true,
      }),
    );
    window.addEventListener("reqflow:session-expired", expired);
    window.addEventListener("focus", visible);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      events.forEach((event) =>
        document.removeEventListener(event, active, true),
      );
      window.removeEventListener("reqflow:session-expired", expired);
      window.removeEventListener("focus", visible);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [user?.id]);
}
