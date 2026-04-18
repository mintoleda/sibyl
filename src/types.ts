export type LLMProvider = 'github' | 'openrouter' | 'openai_compatible' | 'google';

export interface ProviderConfig {
    apiKey: string;
    model: string;
    baseUrl: string;
    label?: string;
}

export interface GenerationSettings {
    temperature: string;
    maxTokens: string;
}

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface CitationSource {
    index: number;
    path: string;
    heading?: string;
    excerpt: string;
    lineStart: number;
    lineEnd: number;
}

export interface SibylSettings {
    provider: LLMProvider;
    providers: {
        github: ProviderConfig;
        openrouter: ProviderConfig;
        openaiCompatible: ProviderConfig;
        google: ProviderConfig;
    };
    generation: GenerationSettings;
    embeddingModel: string;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    similarityThreshold: number;
    maxContextTokens: number;
    ignorePatterns: string[];
}

const DEFAULT_GITHUB_CONFIG: ProviderConfig = {
    apiKey: '',
    model: 'openai/gpt-5-mini',
    baseUrl: 'https://models.github.ai/inference'
};

const DEFAULT_OPENROUTER_CONFIG: ProviderConfig = {
    apiKey: '',
    model: 'openai/gpt-4o-mini',
    baseUrl: 'https://openrouter.ai/api/v1'
};

const DEFAULT_OPENAI_COMPATIBLE_CONFIG: ProviderConfig = {
    apiKey: '',
    model: '',
    baseUrl: 'http://localhost:11434/v1',
    label: 'Custom OpenAI-Compatible'
};

const DEFAULT_GOOGLE_CONFIG: ProviderConfig = {
    apiKey: '',
    model: 'gemini-3-flash-preview',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    label: 'Google Gemini'
};

export const DEFAULT_SETTINGS: SibylSettings = {
    provider: 'github',
    providers: {
        github: DEFAULT_GITHUB_CONFIG,
        openrouter: DEFAULT_OPENROUTER_CONFIG,
        openaiCompatible: DEFAULT_OPENAI_COMPATIBLE_CONFIG,
        google: DEFAULT_GOOGLE_CONFIG
    },
    generation: {
        temperature: '',
        maxTokens: ''
    },
    embeddingModel: 'Xenova/bge-small-en-v1.5',
    chunkSize: 500,
    chunkOverlap: 50,
    topK: 5,
    similarityThreshold: 0.2,
    maxContextTokens: 4000,
    ignorePatterns: ['.obsidian/', 'Templates/', 'Archive/']
};

type LegacySettings = {
    githubToken?: string;
    githubModelId?: string;
    provider?: string;
    providers?: Partial<{
        github: Partial<ProviderConfig>;
        openrouter: Partial<ProviderConfig>;
        openaiCompatible: Partial<ProviderConfig>;
        google: Partial<ProviderConfig>;
    }>;
    generation?: Partial<GenerationSettings>;
    embeddingModel?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    similarityThreshold?: number;
    maxContextTokens?: number;
    ignorePatterns?: string[] | string;
};

export function normalizeSettings(data: LegacySettings | null | undefined): SibylSettings {
    const raw = data ?? {};
    const provider = raw.provider === 'openrouter' || raw.provider === 'openai_compatible' || raw.provider === 'google'
        ? raw.provider
        : 'github';

    return {
        provider,
        providers: {
            github: {
                apiKey: raw.providers?.github?.apiKey ?? raw.githubToken ?? DEFAULT_GITHUB_CONFIG.apiKey,
                model: raw.providers?.github?.model ?? raw.githubModelId ?? DEFAULT_GITHUB_CONFIG.model,
                baseUrl: raw.providers?.github?.baseUrl ?? DEFAULT_GITHUB_CONFIG.baseUrl,
                label: raw.providers?.github?.label ?? DEFAULT_GITHUB_CONFIG.label
            },
            openrouter: {
                apiKey: raw.providers?.openrouter?.apiKey ?? DEFAULT_OPENROUTER_CONFIG.apiKey,
                model: raw.providers?.openrouter?.model ?? DEFAULT_OPENROUTER_CONFIG.model,
                baseUrl: raw.providers?.openrouter?.baseUrl ?? DEFAULT_OPENROUTER_CONFIG.baseUrl,
                label: raw.providers?.openrouter?.label ?? DEFAULT_OPENROUTER_CONFIG.label
            },
            openaiCompatible: {
                apiKey: raw.providers?.openaiCompatible?.apiKey ?? DEFAULT_OPENAI_COMPATIBLE_CONFIG.apiKey,
                model: raw.providers?.openaiCompatible?.model ?? DEFAULT_OPENAI_COMPATIBLE_CONFIG.model,
                baseUrl: raw.providers?.openaiCompatible?.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_CONFIG.baseUrl,
                label: raw.providers?.openaiCompatible?.label ?? DEFAULT_OPENAI_COMPATIBLE_CONFIG.label
            },
            google: {
                apiKey: raw.providers?.google?.apiKey ?? DEFAULT_GOOGLE_CONFIG.apiKey,
                model: raw.providers?.google?.model ?? DEFAULT_GOOGLE_CONFIG.model,
                baseUrl: raw.providers?.google?.baseUrl ?? DEFAULT_GOOGLE_CONFIG.baseUrl,
                label: raw.providers?.google?.label ?? DEFAULT_GOOGLE_CONFIG.label
            }
        },
        generation: {
            temperature: raw.generation?.temperature ?? DEFAULT_SETTINGS.generation.temperature,
            maxTokens: raw.generation?.maxTokens ?? DEFAULT_SETTINGS.generation.maxTokens
        },
        embeddingModel: raw.embeddingModel ?? DEFAULT_SETTINGS.embeddingModel,
        chunkSize: raw.chunkSize ?? DEFAULT_SETTINGS.chunkSize,
        chunkOverlap: raw.chunkOverlap ?? DEFAULT_SETTINGS.chunkOverlap,
        topK: raw.topK ?? DEFAULT_SETTINGS.topK,
        similarityThreshold: raw.similarityThreshold ?? DEFAULT_SETTINGS.similarityThreshold,
        maxContextTokens: raw.maxContextTokens ?? DEFAULT_SETTINGS.maxContextTokens,
        ignorePatterns: Array.isArray(raw.ignorePatterns)
            ? raw.ignorePatterns.filter(Boolean)
            : typeof raw.ignorePatterns === 'string'
                ? raw.ignorePatterns.split(/\r?\n|,/).map(pattern => pattern.trim()).filter(Boolean)
                : DEFAULT_SETTINGS.ignorePatterns
    };
}

export interface NoteRecord {
    id?: number;
    path: string;
    folder: string;
    tags: string[];
    mtime: number;
    hash: string;
    chunkCount?: number;
}

export interface ChunkRecord {
    id?: number;
    noteId: number;
    path: string;
    text: string;
    startIndex: number;
    endIndex: number;
    heading?: string;
    lineStart: number;
    lineEnd: number;
    embedding?: number[];
}
