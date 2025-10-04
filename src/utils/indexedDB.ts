import { openDB, type IDBPDatabase } from "idb";

interface IChunkData {
  [coinName: string]: ICurrencyData | number[];
  avgMaSpread: number[];
}

interface ICurrencyData {
  movingAverages: number[];
  normalizedPrices: number[];
  cumulativeMeans: number[];
}

interface IMetadata {
  coins: string[];
  koef: number;
  totalPoints: number;
  chunkSize: number;
  chunks: IChunkInfo[];
}

interface IChunkInfo {
  id: number;
  startIndex: number;
  endIndex: number;
  file: string;
}

const DB_NAME = "CryptoChartDB";
const DB_VERSION = 1;
const METADATA_STORE = "metadata";
const CHUNKS_STORE = "chunks";

class IndexedDBManager {
  private db: IDBPDatabase | null = null;

  async init(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE);
        }

        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          const chunkStore = db.createObjectStore(CHUNKS_STORE, {
            keyPath: "chunkId",
          });
          chunkStore.createIndex("chunkId", "chunkId", { unique: true });
        }
      },
    });
  }

  async clearAll(): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(
      [METADATA_STORE, CHUNKS_STORE],
      "readwrite"
    );
    await Promise.all([
      tx.objectStore(METADATA_STORE).clear(),
      tx.objectStore(CHUNKS_STORE).clear(),
      tx.done,
    ]);
  }

  async saveMetadata(metadata: IMetadata): Promise<void> {
    if (!this.db) await this.init();

    await this.db!.put(METADATA_STORE, metadata, "current");
  }

  async saveMetadataHash(hash: string): Promise<void> {
    if (!this.db) await this.init();

    await this.db!.put(METADATA_STORE, hash, "hash");
  }

  async getMetadata(): Promise<IMetadata | null> {
    if (!this.db) await this.init();

    const metadata = await this.db!.get(METADATA_STORE, "current");
    return metadata || null;
  }

  async getMetadataHash(): Promise<string | null> {
    if (!this.db) await this.init();

    const hash = await this.db!.get(METADATA_STORE, "hash");
    return hash || null;
  }

  async saveChunk(chunkId: number, chunkData: IChunkData): Promise<void> {
    if (!this.db) await this.init();

    await this.db!.put(CHUNKS_STORE, { chunkId, data: chunkData });
  }

  async getChunk(chunkId: number): Promise<IChunkData | null> {
    if (!this.db) await this.init();

    const result = await this.db!.get(CHUNKS_STORE, chunkId);
    return result ? result.data : null;
  }

  async hasChunk(chunkId: number): Promise<boolean> {
    if (!this.db) await this.init();

    const count = await this.db!.count(CHUNKS_STORE, chunkId);
    return count > 0;
  }

  async getCachedChunksCount(): Promise<number> {
    if (!this.db) await this.init();

    return await this.db!.count(CHUNKS_STORE);
  }
}

export const dbManager = new IndexedDBManager();
