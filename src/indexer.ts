import { pipeline, env } from '@xenova/transformers';
import { ChunkRecord, SibylSettings } from './types';
import { db } from './store';
import { TFile } from 'obsidian';

// Configure transformers.js for browser environment in Electron
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
    env.backends.onnx.wasm.numThreads = 1;
}

interface ChunkMetadata {
    text: string;
    start: number;
    end: number;
    heading?: string;
    lineStart: number;
    lineEnd: number;
}

export class Indexer {
    private embedder: any = null;

    constructor(private settings: SibylSettings) {}

    async getEmbedder() {
        if (!this.embedder) {
            this.embedder = await pipeline('feature-extraction', this.settings.embeddingModel);
        }
        return this.embedder;
    }

    async embed(text: string): Promise<number[]> {
        const embedder = await this.getEmbedder();
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }

    private getIgnorePatterns(): string[] {
        return this.settings.ignorePatterns
            .map((pattern) => pattern.trim())
            .filter(Boolean);
    }

    shouldIgnorePath(path: string): boolean {
        return this.getIgnorePatterns().some((pattern) => {
            const normalized = pattern.replace(/^\/+/, '');
            if (normalized.endsWith('/')) {
                return path.startsWith(normalized);
            }

            if (normalized.includes('*')) {
                const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                return new RegExp(`^${escaped}$`).test(path);
            }

            return path === normalized || path.startsWith(`${normalized}/`);
        });
    }

    private extractTags(text: string): string[] {
        const tags = new Set<string>();
        const matches = text.matchAll(/(^|\s)#([A-Za-z0-9/_-]+)/g);
        for (const match of matches) {
            tags.add(match[2].toLowerCase());
        }
        return [...tags];
    }

    private getFolder(path: string): string {
        return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    }

    private buildLineOffsets(text: string): number[] {
        const offsets = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') {
                offsets.push(i + 1);
            }
        }
        return offsets;
    }

    private getLineNumber(position: number, lineOffsets: number[]): number {
        let low = 0;
        let high = lineOffsets.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const current = lineOffsets[mid];
            const next = mid + 1 < lineOffsets.length ? lineOffsets[mid + 1] : Number.MAX_SAFE_INTEGER;

            if (position >= current && position < next) {
                return mid + 1;
            }

            if (position < current) {
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        return lineOffsets.length;
    }

    private extractHeadings(text: string): { position: number; heading: string }[] {
        const headings: { position: number; heading: string }[] = [];
        const lines = text.split('\n');
        let cursor = 0;

        for (const line of lines) {
            const match = /^(#{1,6})\s+(.*)$/.exec(line);
            if (match && match[2].trim()) {
                headings.push({
                    position: cursor,
                    heading: match[2].trim()
                });
            }
            cursor += line.length + 1;
        }

        return headings;
    }

    private getNearestHeading(position: number, headings: { position: number; heading: string }[]): string | undefined {
        let currentHeading: string | undefined;
        for (const heading of headings) {
            if (heading.position > position) {
                break;
            }
            currentHeading = heading.heading;
        }
        return currentHeading;
    }

    chunkText(text: string, chunkSize: number, overlap: number): ChunkMetadata[] {
        const chunks: ChunkMetadata[] = [];
        const lineOffsets = this.buildLineOffsets(text);
        const headings = this.extractHeadings(text);
        let start = 0;

        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            chunks.push({
                text: text.substring(start, end),
                start,
                end,
                heading: this.getNearestHeading(start, headings),
                lineStart: this.getLineNumber(start, lineOffsets),
                lineEnd: this.getLineNumber(Math.max(start, end - 1), lineOffsets)
            });
            start += (chunkSize - overlap);
            if (start >= text.length) {
                break;
            }
        }

        return chunks;
    }

    async indexNote(file: TFile, content: string) {
        if (this.shouldIgnorePath(file.path)) {
            await this.removeNote(file.path);
            return;
        }

        const existingNote = await db.notes.where('path').equals(file.path).first();
        if (existingNote && existingNote.id) {
            await db.chunks.where('noteId').equals(existingNote.id).delete();
            await db.notes.delete(existingNote.id);
        }

        const chunks = this.chunkText(content, this.settings.chunkSize, this.settings.chunkOverlap);
        const noteId = await db.notes.add({
            path: file.path,
            folder: this.getFolder(file.path),
            tags: this.extractTags(content),
            mtime: file.stat.mtime,
            hash: '',
            chunkCount: chunks.length
        });

        for (const chunk of chunks) {
            const embedding = await this.embed(chunk.text);
            await db.chunks.add({
                noteId: noteId as number,
                path: file.path,
                text: chunk.text,
                startIndex: chunk.start,
                endIndex: chunk.end,
                heading: chunk.heading,
                lineStart: chunk.lineStart,
                lineEnd: chunk.lineEnd,
                embedding
            } as ChunkRecord);
        }
    }

    async removeNote(path: string) {
        const existingNote = await db.notes.where('path').equals(path).first();
        if (existingNote && existingNote.id) {
            await db.chunks.where('noteId').equals(existingNote.id).delete();
            await db.notes.delete(existingNote.id);
        }
    }

    async isUpToDate(file: TFile): Promise<boolean> {
        const record = await db.notes.where('path').equals(file.path).first();
        return record !== undefined && record.mtime === file.stat.mtime;
    }
}
