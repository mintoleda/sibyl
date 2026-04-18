import Dexie, { Table } from 'dexie';
import { NoteRecord, ChunkRecord } from './types';

export class SibylDatabase extends Dexie {
    notes!: Table<NoteRecord>;
    chunks!: Table<ChunkRecord>;

    constructor() {
        super('SibylDatabase');
        this.version(1).stores({
            notes: '++id, path, mtime, hash',
            chunks: '++id, noteId, path'
        });
        this.version(2).stores({
            notes: '++id, path, folder, mtime, hash, *tags',
            chunks: '++id, noteId, path, heading, lineStart, lineEnd'
        }).upgrade(async (tx) => {
            await tx.table('notes').toCollection().modify((note: NoteRecord) => {
                note.folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
                note.tags = Array.isArray(note.tags) ? note.tags : [];
                note.chunkCount = typeof note.chunkCount === 'number' ? note.chunkCount : 0;
            });

            await tx.table('chunks').toCollection().modify((chunk: ChunkRecord) => {
                chunk.heading = chunk.heading ?? '';
                chunk.lineStart = typeof chunk.lineStart === 'number' ? chunk.lineStart : 1;
                chunk.lineEnd = typeof chunk.lineEnd === 'number' ? chunk.lineEnd : chunk.lineStart;
            });
        });
    }

    async clearAll() {
        await this.notes.clear();
        await this.chunks.clear();
    }
}

export const db = new SibylDatabase();

export function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
