import { useCallback, useEffect, useState } from "react";
import { SessionList } from "./pages/session-list";
import { ChatDetail } from "./pages/chat-detail";

export type Route =
  | { page: "list" }
  | { page: "chat"; sessionId: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = hash.match(/^chat\/(.+)$/);
  if (match) return { page: "chat", sessionId: match[1] };
  return { page: "list" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = r.page === "list" ? "/" : `/chat/${r.sessionId}`;
  }, []);

  if (route.page === "chat") {
    return (
      <ChatDetail
        sessionId={route.sessionId}
        onBack={() => navigate({ page: "list" })}
      />
    );
  }
  return <SessionList onOpen={(id) => navigate({ page: "chat", sessionId: id })} />;
}
