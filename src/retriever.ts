import { db, cosineSimilarity } from './store';
import { Indexer } from './indexer';
import { ChunkRecord, SibylSettings } from './types';
import { parseSearchQuery } from './search';

export interface SearchResult {
    chunk: ChunkRecord;
    score: number;
}

export class Retriever {
    constructor(private indexer: Indexer, private settings: SibylSettings) {}

    async search(rawQuery: string): Promise<SearchResult[]> {
        const parsed = parseSearchQuery(rawQuery);
        const queryText = parsed.query || rawQuery.trim();
        const queryEmbedding = await this.indexer.embed(queryText);
        const [allChunks, allNotes] = await Promise.all([
            db.chunks.toArray(),
            db.notes.toArray()
        ]);

        const notesById = new Map(allNotes.filter(note => note.id !== undefined).map(note => [note.id as number, note]));
        const scoredChunks = allChunks
            .filter((chunk) => {
                const note = notesById.get(chunk.noteId);
                if (!note) {
                    return false;
                }

                const folderMatches = parsed.folders.length === 0
                    || parsed.folders.some((folder) => note.path.startsWith(folder));
                const tagMatches = parsed.tags.length === 0
                    || parsed.tags.every((tag) => note.tags.includes(tag));

                return folderMatches && tagMatches;
            })
            .map((chunk) => {
                if (!chunk.embedding) {
                    return { chunk, score: 0 };
                }

                return {
                    chunk,
                    score: cosineSimilarity(queryEmbedding, chunk.embedding)
                };
            })
            .filter((result) => result.score >= this.settings.similarityThreshold);

        scoredChunks.sort((a, b) => b.score - a.score);
        return scoredChunks.slice(0, this.settings.topK);
    }
}
