// Drafts stay in this browser, separated by account, project and work item type.
export type WorkDraft = {
  values: Record<string, unknown>;
  files: { file: File; token: string }[];
};
export async function workDraft(
  key: string,
  action: "read" | "write" | "delete",
  value?: WorkDraft,
): Promise<WorkDraft | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("reqflow-work-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "drafts",
        action === "read" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("drafts");
      const request =
        action === "read"
          ? store.get(key)
          : action === "write"
            ? store.put(value, key)
            : store.delete(key);
      tx.oncomplete = () =>
        resolve(action === "read" ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("草稿保存失败"));
    });
  } finally {
    db.close();
  }
}
