import { App, ItemView, MarkdownRenderer, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { CitationSource, ChunkRecord, ConversationMessage, SibylSettings, normalizeSettings } from './types';
import { SibylSettingTab } from './settings';
import { Indexer } from './indexer';
import { Retriever, SearchResult } from './retriever';
import { LLMService } from './llm';
import { db } from './store';

const VIEW_TYPE_SIBYL_CHAT = 'sibyl-chat-view';
const MAX_HISTORY_MESSAGES = 8;

interface AssistantTurn {
    role: 'assistant';
    content: string;
    citations: CitationSource[];
}

interface UserTurn {
    role: 'user';
    content: string;
}

type ChatTurn = AssistantTurn | UserTurn;

interface SearchResponse {
    answer: string;
    citations: CitationSource[];
    results: SearchResult[];
}

function truncateExcerpt(text: string, maxLength = 180): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact;
}

function escapeInternalLinkTarget(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function buildCitationLink(source: CitationSource): string {
    const target = source.heading
        ? `${escapeInternalLinkTarget(source.path)}#${escapeInternalLinkTarget(source.heading)}`
        : escapeInternalLinkTarget(source.path);
    // Use zero-width space \u200B to prevent ]]] from breaking the wikilink parser
    return `[[${target}|[${source.index}]\u200B]]`;
}

function renderAnswerMarkdown(answer: string, citations: CitationSource[]): string {
    const citationMap = new Map(citations.map((source) => [source.index, source]));
    const withInlineLinks = answer.replace(/\[(\d+)\]/g, (match, indexText) => {
        const source = citationMap.get(Number(indexText));
        return source ? buildCitationLink(source) : match;
    });

    if (citations.length === 0) {
        return withInlineLinks;
    }

    const fallbackSources = citations
        .map((source) => `- ${buildCitationLink(source)} ${source.path}${source.heading ? ` > ${source.heading}` : ''}`)
        .join('\n');

    return `${withInlineLinks}\n\nReferenced notes:\n${fallbackSources}`;
}

export default class SibylPlugin extends Plugin {
    settings!: SibylSettings;
    indexer!: Indexer;
    retriever!: Retriever;
    llm!: LLMService;
    private statusBarEl!: HTMLElement;

    async onload() {
        console.log('Sibyl loading features...');
        await this.loadSettings();

        try {
            this.indexer = new Indexer(this.settings);
            this.retriever = new Retriever(this.indexer, this.settings);
            this.llm = new LLMService(this.settings);
            this.statusBarEl = this.addStatusBarItem();
            this.setStatusBar('Ready');

            this.registerView(
                VIEW_TYPE_SIBYL_CHAT,
                (leaf) => new SibylChatView(leaf, this)
            );

            this.addSettingTab(new SibylSettingTab(this.app, this));

            this.addCommand({
                id: 'semantic-search',
                name: 'Open Sibyl Chat',
                callback: () => {
                    void this.activateChatView();
                }
            });

            this.addCommand({
                id: 'reindex-vault',
                name: 'Reindex Vault',
                callback: () => void this.reindexVault(false)
            });

            this.addCommand({
                id: 'reindex-vault-force',
                name: 'Reindex Vault (Force)',
                callback: () => void this.reindexVault(true)
            });

            this.registerEvent(
                this.app.vault.on('modify', async (file) => {
                    if (!(file instanceof TFile) || file.extension !== 'md') {
                        return;
                    }

                    try {
                        if (this.indexer.shouldIgnorePath(file.path)) {
                            await this.indexer.removeNote(file.path);
                            return;
                        }

                        const content = await this.app.vault.read(file);
                        await this.indexer.indexNote(file, content);
                    } catch (e) {
                        console.error('Failed to index modified file:', e);
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('delete', async (file) => {
                    if (file instanceof TFile) {
                        try {
                            await this.indexer.removeNote(file.path);
                        } catch (e) {
                            console.error('Failed to remove deleted file from index:', e);
                        }
                    }
                })
            );

            console.log('Sibyl loaded successfully');
        } catch (e) {
            console.error('Sibyl failed to load:', e);
            new Notice('Sibyl failed to load. Check console for details.');
        }
    }

    async onunload() {
        await this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIBYL_CHAT);
    }

    async loadSettings() {
        this.settings = normalizeSettings(await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private setStatusBar(text: string) {
        if (this.statusBarEl) {
            this.statusBarEl.setText(`Sibyl: ${text}`);
        }
    }

    async activateChatView() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIBYL_CHAT);
        const leaf = leaves.length > 0 ? leaves[0] : this.app.workspace.getLeaf('window');
        if (!leaf) {
            throw new Error('Unable to open Sibyl chat view.');
        }

        await leaf.setViewState({
            type: VIEW_TYPE_SIBYL_CHAT,
            active: true
        });
        this.app.workspace.revealLeaf(leaf);

        const view = leaf.view as SibylChatView;
        view.focusInput();
    }

    private buildCitations(results: SearchResult[]): CitationSource[] {
        return results.map((result, index) => ({
            index: index + 1,
            path: result.chunk.path,
            heading: result.chunk.heading,
            excerpt: truncateExcerpt(result.chunk.text),
            lineStart: result.chunk.lineStart,
            lineEnd: result.chunk.lineEnd
        }));
    }

    private buildContext(results: SearchResult[]): string {
        return results
            .map((result, index) => {
                const heading = result.chunk.heading ? `Section: ${result.chunk.heading}\n` : '';
                return `[${index + 1}] File: ${result.chunk.path}
${heading}Lines: ${result.chunk.lineStart}-${result.chunk.lineEnd}
Similarity: ${result.score.toFixed(3)}
Content:
${result.chunk.text}`;
            })
            .join('\n---\n');
    }

    async askSibyl(query: string, history: ConversationMessage[]): Promise<SearchResponse> {
        const results = await this.retriever.search(query);
        const citations = this.buildCitations(results);

        if (results.length === 0) {
            return {
                answer: 'No indexed notes matched that query. Try widening the scope, lowering the similarity threshold, or removing folder/tag filters.',
                citations: [],
                results: []
            };
        }

        const context = this.buildContext(results);
        const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);
        const answer = await this.llm.generate(query, context, trimmedHistory);

        return {
            answer,
            citations,
            results
        };
    }

    async clearIndex() {
        await db.clearAll();
        this.setStatusBar('Index cleared');
        new Notice('Sibyl index cleared.');
    }

    async getIndexStats(): Promise<{ notes: number; chunks: number; estimatedBytes: number }> {
        const [notes, chunks] = await Promise.all([
            db.notes.toArray(),
            db.chunks.toArray()
        ]);

        const estimatedBytes = notes.reduce((total, note) => {
            return total + note.path.length * 2 + note.folder.length * 2 + note.tags.join(',').length * 2;
        }, 0) + chunks.reduce((total, chunk) => {
            const embeddingBytes = Array.isArray(chunk.embedding) ? chunk.embedding.length * 8 : 0;
            return total + chunk.text.length * 2 + embeddingBytes;
        }, 0);

        return {
            notes: notes.length,
            chunks: chunks.length,
            estimatedBytes
        };
    }

    async reindexVault(force: boolean) {
        const label = force ? 'force' : 'smart';
        new Notice(`Starting ${label} vault reindex...`);
        this.setStatusBar(`Reindexing (${label}) 0%`);

        try {
            const files = this.app.vault.getMarkdownFiles();
            const existingPaths = new Set<string>((await db.notes.toArray()).map((note) => note.path));

            let indexed = 0;
            let skipped = 0;
            let ignored = 0;
            const visitedPaths = new Set<string>();

            for (let index = 0; index < files.length; index++) {
                const file = files[index];
                visitedPaths.add(file.path);

                if (this.indexer.shouldIgnorePath(file.path)) {
                    ignored++;
                    await this.indexer.removeNote(file.path);
                    this.setStatusBar(`Reindexing ${Math.round(((index + 1) / files.length) * 100)}%`);
                    continue;
                }

                if (!force && await this.indexer.isUpToDate(file)) {
                    skipped++;
                } else {
                    const content = await this.app.vault.read(file);
                    await this.indexer.indexNote(file, content);
                    indexed++;
                }

                if ((index + 1) % 5 === 0 || index === files.length - 1) {
                    const percent = Math.round(((index + 1) / files.length) * 100);
                    this.setStatusBar(`Reindexing ${percent}% (${indexed} indexed, ${skipped} skipped, ${ignored} ignored)`);
                }
            }

            const stalePaths = [...existingPaths].filter((path) => !visitedPaths.has(path) || this.indexer.shouldIgnorePath(path));
            for (const stalePath of stalePaths) {
                await this.indexer.removeNote(stalePath);
            }

            this.setStatusBar(`Ready (${indexed} indexed, ${ignored} ignored)`);
            new Notice(
                `Reindex complete: ${indexed} indexed, ${skipped} skipped, ${ignored} ignored, ${stalePaths.length} removed.`
            );
        } catch (e: any) {
            this.setStatusBar('Reindex failed');
            new Notice(`Reindex failed: ${e.message}`);
            console.error(e);
        }
    }
}

class SibylChatView extends ItemView {
    private messageLogEl!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;
    private composerEl!: HTMLDivElement;
    private turns: ChatTurn[] = [];
    private isLoading = false;
    private autocompleteEl: HTMLDivElement | null = null;
    private autocompleteItems: string[] = [];
    private autocompleteIndex = -1;
    private autocompleteToken: { start: number; end: number } | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: SibylPlugin) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_SIBYL_CHAT;
    }

    getDisplayText(): string {
        return 'Sibyl Chat';
    }

    async onOpen() {
        this.injectStyles();
        this.render();
    }

    async onClose() {
        this.hideAutocomplete();
    }

    private injectStyles() {
        const id = 'sibyl-chat-styles';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
            @keyframes sibyl-bounce {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                40% { transform: translateY(-5px); opacity: 1; }
            }
            .sibyl-autocomplete {
                position: absolute; left: 0; right: 0;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.25);
                overflow-y: auto; max-height: 220px; z-index: 100;
            }
            .sibyl-autocomplete-item {
                padding: 6px 10px; cursor: pointer; font-size: 0.9em;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                color: var(--text-normal);
            }
            .sibyl-autocomplete-item:hover,
            .sibyl-autocomplete-item--active {
                background: var(--background-modifier-hover);
                color: var(--text-accent);
            }
        `;
        document.head.appendChild(style);
    }

    focusInput() {
        this.inputEl?.focus();
    }

    private render() {
        this.hideAutocomplete();
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.position = 'relative';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.height = '100%';
        contentEl.style.padding = '12px';
        contentEl.style.gap = '12px';

        const headerEl = contentEl.createDiv();
        headerEl.style.display = 'flex';
        headerEl.style.justifyContent = 'space-between';
        headerEl.style.alignItems = 'center';

        headerEl.createEl('h2', { text: 'Sibyl Chat' });

        const controlsEl = headerEl.createDiv();
        controlsEl.style.display = 'flex';
        controlsEl.style.gap = '8px';

        const clearButton = controlsEl.createEl('button', { text: 'Clear' });
        clearButton.onclick = () => {
            this.turns = [];
            this.renderMessages();
            this.focusInput();
        };

        const helpEl = contentEl.createDiv({
            text: 'Use @folder/path and #tag filters inside your prompt to narrow retrieval.'
        });
        helpEl.style.fontSize = '0.9em';
        helpEl.style.opacity = '0.8';

        this.messageLogEl = contentEl.createDiv();
        this.messageLogEl.style.flex = '1';
        this.messageLogEl.style.overflowY = 'auto';
        this.messageLogEl.style.display = 'flex';
        this.messageLogEl.style.flexDirection = 'column';
        this.messageLogEl.style.gap = '10px';

        this.composerEl = contentEl.createDiv();
        this.composerEl.style.display = 'flex';
        this.composerEl.style.flexDirection = 'column';
        this.composerEl.style.gap = '8px';

        this.inputEl = this.composerEl.createEl('textarea', {
            attr: {
                placeholder: 'Ask Sibyl. Example: @projects #meeting summarize the last roadmap decision'
            }
        });
        this.inputEl.rows = 4;
        this.inputEl.style.width = '100%';
        this.inputEl.style.resize = 'vertical';

        const submitButton = this.composerEl.createEl('button', {
            text: this.isLoading ? 'Thinking...' : 'Send'
        });
        submitButton.disabled = this.isLoading;
        submitButton.onclick = () => {
            void this.submit();
        };

        this.inputEl.addEventListener('keydown', (event) => {
            if (this.autocompleteEl) {
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    this.highlightItem(Math.min(this.autocompleteIndex + 1, this.autocompleteItems.length - 1));
                    return;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    this.highlightItem(Math.max(this.autocompleteIndex - 1, 0));
                    return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    const idx = this.autocompleteIndex >= 0 ? this.autocompleteIndex : 0;
                    this.selectAutocomplete(this.autocompleteItems[idx]);
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.hideAutocomplete();
                    return;
                }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void this.submit();
            }
        });

        this.inputEl.addEventListener('input', () => {
            const cursor = this.inputEl.selectionStart ?? 0;
            const atToken = this.getAtToken(this.inputEl.value, cursor);
            if (atToken) {
                const items = this.getFolderSuggestions(atToken.query);
                if (items.length > 0) {
                    this.showAutocomplete(items, { start: atToken.start, end: atToken.end });
                    return;
                }
            }
            const hashToken = this.getHashToken(this.inputEl.value, cursor);
            if (hashToken) {
                const items = this.getTagSuggestions(hashToken.query);
                if (items.length > 0) {
                    this.showAutocomplete(items, { start: hashToken.start, end: hashToken.end });
                    return;
                }
            }
            this.hideAutocomplete();
        });

        this.inputEl.addEventListener('click', () => {
            if (!this.autocompleteEl) return;
            const cursor = this.inputEl.selectionStart ?? 0;
            const atToken = this.getAtToken(this.inputEl.value, cursor);
            const hashToken = this.getHashToken(this.inputEl.value, cursor);
            if (!atToken && !hashToken) this.hideAutocomplete();
        });

        this.inputEl.addEventListener('blur', () => {
            setTimeout(() => this.hideAutocomplete(), 150);
        });

        this.renderMessages();
    }

    private getAtToken(text: string, cursor: number): { query: string; start: number; end: number } | null {
        const match = /(?:^|[\s\n])(@\S*)$/.exec(text.slice(0, cursor));
        if (!match) return null;
        const full = match[1];
        const start = cursor - full.length;
        return { query: full.slice(1), start, end: cursor };
    }

    private getHashToken(text: string, cursor: number): { query: string; start: number; end: number } | null {
        const match = /(?:^|[\s\n])(#\S*)$/.exec(text.slice(0, cursor));
        if (!match) return null;
        const full = match[1];
        const start = cursor - full.length;
        return { query: full.slice(1), start, end: cursor };
    }

    private getFolderSuggestions(query: string): string[] {
        const q = query.toLowerCase();
        const candidates = new Set<string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const pathNoExt = file.path.endsWith('.md') ? file.path.slice(0, -3) : file.path;
            const parts = pathNoExt.split('/');
            for (let i = 1; i <= parts.length; i++) {
                candidates.add(parts.slice(0, i).join('/'));
            }
        }
        return [...candidates]
            .filter((p) => p.toLowerCase().includes(q))
            .sort((a, b) => {
                const al = a.toLowerCase();
                const bl = b.toLowerCase();
                const aPrefix = al.startsWith(q);
                const bPrefix = bl.startsWith(q);
                if (aPrefix && !bPrefix) return -1;
                if (!aPrefix && bPrefix) return 1;
                return al.localeCompare(bl);
            })
            .slice(0, 10);
    }

    private getTagSuggestions(query: string): string[] {
        const q = query.toLowerCase();
        const tags = this.app.metadataCache.getTags();
        return Object.keys(tags)
            .map((t) => t.replace(/^#/, ''))
            .filter((t) => t.toLowerCase().includes(q))
            .sort((a, b) => {
                const al = a.toLowerCase();
                const bl = b.toLowerCase();
                const aPrefix = al.startsWith(q);
                const bPrefix = bl.startsWith(q);
                if (aPrefix && !bPrefix) return -1;
                if (!aPrefix && bPrefix) return 1;
                return (tags[`#${a}`] ?? 0) > (tags[`#${b}`] ?? 0) ? -1 : 1;
            })
            .slice(0, 10);
    }

    private showAutocomplete(items: string[], token: { start: number; end: number }) {
        this.hideAutocomplete();
        const el = this.contentEl.createDiv({ cls: 'sibyl-autocomplete' }) as HTMLDivElement;
        el.style.bottom = `${this.composerEl.offsetHeight + 4}px`;
        for (const item of items) {
            const itemEl = el.createDiv({ cls: 'sibyl-autocomplete-item', text: item });
            itemEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectAutocomplete(item);
            });
        }
        this.autocompleteEl = el;
        this.autocompleteItems = items;
        this.autocompleteToken = token;
        this.autocompleteIndex = -1;
    }

    private hideAutocomplete() {
        this.autocompleteEl?.remove();
        this.autocompleteEl = null;
        this.autocompleteItems = [];
        this.autocompleteIndex = -1;
        this.autocompleteToken = null;
    }

    private highlightItem(index: number) {
        if (!this.autocompleteEl) return;
        this.autocompleteIndex = index;
        const children = this.autocompleteEl.querySelectorAll('.sibyl-autocomplete-item');
        children.forEach((child, i) => {
            child.classList.toggle('sibyl-autocomplete-item--active', i === index);
        });
        (children[index] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }

    private selectAutocomplete(path: string) {
        if (!this.autocompleteToken) return;
        const { start, end } = this.autocompleteToken;
        const sigil = this.inputEl.value[start] === '#' ? '#' : '@';
        const replacement = `${sigil}${path} `;
        this.inputEl.value = this.inputEl.value.slice(0, start) + replacement + this.inputEl.value.slice(end);
        this.inputEl.setSelectionRange(start + replacement.length, start + replacement.length);
        this.hideAutocomplete();
        this.inputEl.focus();
    }

    private async renderMessages() {
        this.messageLogEl.empty();

        if (this.turns.length === 0) {
            const emptyEl = this.messageLogEl.createDiv({
                text: 'No conversation yet. Ask a question to start a multi-turn session.'
            });
            emptyEl.style.opacity = '0.7';
            emptyEl.style.padding = '12px';
            return;
        }

        for (const turn of this.turns) {
            const bubbleEl = this.messageLogEl.createDiv();
            bubbleEl.style.padding = '10px 12px';
            bubbleEl.style.borderRadius = '10px';
            bubbleEl.style.background = turn.role === 'user' ? 'var(--background-modifier-hover)' : 'var(--background-secondary)';

            const labelEl = bubbleEl.createDiv({ text: turn.role === 'user' ? 'You' : 'Sibyl' });
            labelEl.style.fontWeight = '600';
            labelEl.style.marginBottom = '6px';

            const bodyEl = bubbleEl.createDiv();
            if (turn.role === 'assistant') {
                await MarkdownRenderer.render(this.app, renderAnswerMarkdown(turn.content, turn.citations), bodyEl, '', this.plugin);
            } else {
                bodyEl.setText(turn.content);
            }
        }

        this.messageLogEl.scrollTop = this.messageLogEl.scrollHeight;
    }

    private showThinkingIndicator() {
        const bubbleEl = this.messageLogEl.createDiv({ cls: 'sibyl-thinking' });
        bubbleEl.style.padding = '10px 12px';
        bubbleEl.style.borderRadius = '10px';
        bubbleEl.style.background = 'var(--background-secondary)';

        const labelEl = bubbleEl.createDiv({ text: 'Sibyl' });
        labelEl.style.fontWeight = '600';
        labelEl.style.marginBottom = '6px';

        const dotsEl = bubbleEl.createDiv();
        dotsEl.style.display = 'flex';
        dotsEl.style.gap = '4px';
        dotsEl.style.alignItems = 'center';

        for (let i = 0; i < 3; i++) {
            const dot = dotsEl.createDiv();
            dot.style.width = '7px';
            dot.style.height = '7px';
            dot.style.borderRadius = '50%';
            dot.style.background = 'var(--text-muted)';
            dot.style.animation = `sibyl-bounce 1.2s ease-in-out ${i * 0.2}s infinite`;
        }

        this.messageLogEl.scrollTop = this.messageLogEl.scrollHeight;
    }

    private async submit() {
        const query = this.inputEl.value.trim();
        if (!query || this.isLoading) {
            return;
        }

        this.isLoading = true;
        const submitValue = this.inputEl.value;
        this.inputEl.value = '';
        this.turns.push({ role: 'user', content: query });
        await this.renderMessages();
        this.showThinkingIndicator();

        try {
            const history: ConversationMessage[] = this.turns
                .slice(0, -1)
                .map((turn) => ({ role: turn.role, content: turn.content }));
            const response = await this.plugin.askSibyl(query, history);
            this.turns.push({
                role: 'assistant',
                content: response.answer,
                citations: response.citations
            });
        } catch (error: any) {
            new Notice(`Error: ${error.message}`);
            this.turns.push({
                role: 'assistant',
                content: `Error: ${error.message}`,
                citations: []
            });
        } finally {
            this.isLoading = false;
            await this.render();
            this.inputEl.value = '';
            this.focusInput();
            if (submitValue && this.turns[this.turns.length - 1]?.role === 'assistant') {
                this.messageLogEl.scrollTop = this.messageLogEl.scrollHeight;
            }
        }
    }
}
