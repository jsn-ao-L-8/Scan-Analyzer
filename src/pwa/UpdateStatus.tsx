import { useRegisterSW } from "virtual:pwa-register/react";

export function UpdateStatus() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) {
        window.setInterval(() => void registration.update(), 60 * 60 * 1000);
      }
    }
  });
  if (!offlineReady && !needRefresh) return null;
  return (
    <aside className="update-toast" role="status">
      <span>
        {offlineReady
          ? "The analyzer is ready offline."
          : "A complete new version is ready."}
      </span>
      {needRefresh && (
        <button onClick={() => void updateServiceWorker(true)}>Update and reload</button>
      )}
      <button
        className="secondary"
        aria-label="Dismiss update message"
        onClick={() => {
          setOfflineReady(false);
          setNeedRefresh(false);
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
