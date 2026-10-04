import {
  appendRecording,
  attachDraftMap,
  renameRecordedProcess,
  correctExpertRule,
  mergeRecordedProcesses,
  reviseProcessStep,
  approveWorkMapVersion,
  type RecordedProcess,
  type RecordingInput,
} from "./processes";
import { preparePrivateRecording } from "./privacy-recording";
import { privacyScan } from "./privacy";

const DB_NAME = "apprentice-local-v1";
const STORE = "processes";

/** Restore cloud copies without overwriting newer or unsynced browser work. */
export async function importCloudProcesses(records: RecordedProcess[]): Promise<{ added: number; skipped: number }> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let added = 0, skipped = 0;
    for (const record of records) {
      if (record.schemaVersion !== 1 || record.ownerId !== "local-demo-user" || !Array.isArray(record.versions)) {
        tx.abort();
        break;
      }
      const lookup = store.get(record.id);
      lookup.onsuccess = () => {
        if (lookup.result) skipped++;
        else { store.add(record); added++; }
      };
    }
    tx.oncomplete = () => { database.close(); resolve({ added, skipped }); };
    tx.onabort = () => { database.close(); reject(new Error("Could not restore cloud backups.")); };
  });
}

/** Seed additive synthetic examples without touching captured user processes. */
export async function addDemoProcesses(examples: RecordedProcess[]): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const example of examples) {
      if (!example.demo || !example.id.startsWith("demo-")) {
        tx.abort();
        break;
      }
      const lookup = store.get(example.id);
      lookup.onsuccess = () => { if (!lookup.result) store.add(example); };
    }
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onabort = () => { database.close(); reject(new Error("Could not add synthetic examples")); };
  });
}

/** Replace only the original, untouched German demo fixtures. Never rewrite a user's recordings or edits. */
export async function updateUntouchedDemoProcesses(examples: RecordedProcess[]): Promise<void> {
  const oldTitles: Record<string, string> = {
    "demo-invoice": "Rechnung buchen: Anlage oder Aufwand",
    "demo-quote": "Angebots-E-Mail aus Notion versenden",
    "demo-supplier": "Neuen Lieferanten pruefen und freigeben",
  };
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const example of examples) {
      if (!example.demo || !oldTitles[example.id]) continue;
      const request = store.get(example.id);
      request.onsuccess = () => {
        const previous = request.result as RecordedProcess | undefined;
        const version = previous?.versions[0];
        if (previous?.demo && !previous.mergedIntoId && previous.title === oldTitles[example.id] &&
          previous.updatedAt === previous.createdAt && previous.versions.length === 1 &&
          version?.id === `${example.id}-v1` && version.status === "recorded" && !version.reviewedAt) {
          store.put(example);
        }
      };
    }
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onabort = () => { database.close(); reject(new Error("Could not update synthetic examples")); };
  });
}

/** Resolve merge redirects inside the same transaction, including late capture/map writes. */
function resolveProcess(
  store: IDBObjectStore,
  id: string,
  done: (process: RecordedProcess | undefined) => void,
  fail: (error: Error) => void,
  seen = new Set<string>(),
) {
  if (seen.has(id) || seen.size >= 30) {
    fail(new Error("Invalid process reference."));
    return;
  }
  seen.add(id);
  const request = store.get(id);
  request.onsuccess = () => {
    const process = request.result as RecordedProcess | undefined;
    if (!process && seen.size > 1) {
      fail(new Error("The referenced process was deleted."));
      return;
    }
    if (process?.mergedIntoId)
      resolveProcess(store, process.mergedIntoId, done, fail, seen);
    else done(process);
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let blocked = false;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      reject(
        new Error(
          "Local database unavailable. Check browser storage settings.",
        ),
      );
      return;
    }
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onerror = () =>
      reject(
        new Error(
          "Local database unavailable. Check browser storage settings.",
        ),
      );
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "Database blocked. Close other Apprentice tabs and try again.",
        ),
      );
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

async function read<T>(
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = operation(transaction.objectStore(STORE));
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(new Error("Could not load local processes."));
    };
  });
}

export async function listProcesses(
  ownerId: string,
): Promise<RecordedProcess[]> {
  const all = await read<RecordedProcess[]>((store) => store.getAll());
  return all
    .filter((process) => process.ownerId === ownerId && !process.mergedIntoId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProcess(
  id: string,
  ownerId: string,
): Promise<RecordedProcess | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, "readonly");
    let result: RecordedProcess | undefined, error: Error | undefined;
    resolveProcess(
      tx.objectStore(STORE),
      id,
      (p) => {
        result = p?.ownerId === ownerId ? p : undefined;
      },
      (e) => {
        error = e;
        tx.abort();
      },
    );
    tx.oncomplete = () => {
      database.close();
      resolve(result);
    };
    tx.onabort = () => {
      database.close();
      reject(error ?? new Error("Could not load the process."));
    };
  });
}

export async function saveRecording(
  input: RecordingInput,
): Promise<RecordedProcess> {
  input = await preparePrivateRecording(input);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    // Read + append in one transaction prevents two tabs overwriting each other's versions.
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let result: RecordedProcess;
    let validationError: unknown;
    resolveProcess(
      store,
      input.processId,
      (existing) => {
        try {
          result = appendRecording(existing, {
            ...input,
            processId: existing?.id ?? input.processId,
          });
          store.put(result);
        } catch (error) {
          validationError = error;
          transaction.abort();
        }
      },
      (error) => {
        validationError = error;
        transaction.abort();
      },
    );
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(
        validationError ??
          new Error(
            "Save failed (for example, storage may be full). Your recording remains in this tab. Please try again.",
          ),
      );
    };
  });
}

export async function deleteProcess(
  id: string,
  ownerId: string,
): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result as RecordedProcess[];
      if (
        !all.some(
          (p) => p.id === id && p.ownerId === ownerId && !p.mergedIntoId,
        )
      ) {
        transaction.abort();
        return;
      }
      const removed = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of all)
          if (
            p.ownerId === ownerId &&
            p.mergedIntoId &&
            removed.has(p.mergedIntoId) &&
            !removed.has(p.id)
          ) {
            removed.add(p.id);
            changed = true;
          }
      }
      removed.forEach((key) => store.delete(key));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(
        new Error(
          "Could not delete the process. Reload the list and try again.",
        ),
      );
    };
  });
}

async function updateExisting(
  id: string,
  update: (process: RecordedProcess) => RecordedProcess,
): Promise<RecordedProcess> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let result: RecordedProcess;
    let error: unknown;
    resolveProcess(
      store,
      id,
      (existing) => {
        try {
          if (!existing)
            throw new Error(
              "The process was deleted or is no longer available.",
            );
          result = update(existing);
          store.put(result);
        } catch (cause) {
          error = cause;
          transaction.abort();
        }
      },
      (cause) => {
        error = cause;
        transaction.abort();
      },
    );
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(error ?? new Error("Could not save the change."));
    };
  });
}

export async function renameProcess(
  id: string,
  ownerId: string,
  title: string,
) {
  title = (await privacyScan([title])).texts[0];
  return updateExisting(id, (process) =>
    renameRecordedProcess(process, ownerId, title),
  );
}

export async function saveStepRevision(
  id: string,
  ownerId: string,
  input: Parameters<typeof reviseProcessStep>[2],
) {
  const safe = await privacyScan([input.title, input.action, input.note]);
  input = {
    ...input,
    title: safe.texts[0],
    action: safe.texts[1],
    note: safe.texts[2],
  };
  return updateExisting(id, (process) =>
    reviseProcessStep(process, ownerId, input),
  );
}

export async function saveRuleCorrection(
  id: string,
  ownerId: string,
  input: Parameters<typeof correctExpertRule>[2],
) {
  const checked = await privacyScan([input.statement]);
  if (checked.report.engine !== "presidio")
    throw new Error("The expert statement could not be fully checked. Please try again later.");
  return updateExisting(id, (process) =>
    correctExpertRule(process, ownerId, { ...input, statement: checked.texts[0], scanReport: checked.report }),
  );
}

export function approveVersion(id: string, ownerId: string, versionId: string) {
  return updateExisting(id, (process) =>
    approveWorkMapVersion(process, ownerId, versionId, new Date().toISOString()),
  );
}

export async function mergeProcesses(
  sourceId: string,
  targetId: string,
  ownerId: string,
) {
  const database = await openDatabase();
  return new Promise<RecordedProcess>((resolve, reject) => {
    const tx = database.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE);
    let result: RecordedProcess, error: unknown;
    const fail = (cause: unknown) => {
      error = cause;
      tx.abort();
    };
    resolveProcess(
      store,
      targetId,
      (target) => {
        resolveProcess(
          store,
          sourceId,
          (source) => {
            try {
              if (!source || !target)
                throw new Error("One of the processes is no longer available.");
              result = mergeRecordedProcesses(
                target,
                source,
                ownerId,
                new Date().toISOString(),
              );
              store.put(result);
              // Retain the original record for source history; hide it from the top-level library.
              store.put({ ...source, mergedIntoId: target.id });
            } catch (cause) {
              fail(cause);
            }
          },
          fail,
        );
      },
      fail,
    );
    tx.oncomplete = () => {
      database.close();
      resolve(result);
    };
    tx.onabort = () => {
      database.close();
      reject(error ?? new Error("Could not save the merge."));
    };
  });
}
export function saveDraftMap(
  id: string,
  ownerId: string,
  versionId: string,
  expectedTitle: string,
  map: unknown,
) {
  return updateExisting(id, (process) =>
    attachDraftMap(process, ownerId, versionId, expectedTitle, map),
  );
}
