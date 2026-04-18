export interface SearchFilters {
    folders: string[];
    tags: string[];
    query: string;
}

export function parseSearchQuery(input: string): SearchFilters {
    const folders: string[] = [];
    const tags: string[] = [];
    const terms: string[] = [];

    for (const token of input.split(/\s+/).filter(Boolean)) {
        if (token.startsWith('@') && token.length > 1) {
            folders.push(token.slice(1).replace(/^\/+/, ''));
            continue;
        }

        if (token.startsWith('#') && token.length > 1) {
            tags.push(token.slice(1).toLowerCase());
            continue;
        }

        terms.push(token);
    }

    return {
        folders,
        tags,
        query: terms.join(' ').trim() || input.trim()
    };
}
