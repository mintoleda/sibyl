import { ConversationMessage, LLMProvider, ProviderConfig, SibylSettings } from './types';

type ChatRole = 'system' | 'user' | 'assistant';

interface ChatMessage {
    role: ChatRole;
    content: string;
}

interface ChatRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
}

interface ChatResponse {
    content: string;
}

interface ModelCapabilities {
    supportsTemperature: boolean;
    supportsMaxTokens: boolean;
}

interface ProviderError {
    code: 'auth' | 'rate_limit' | 'unsupported_param' | 'model_not_found' | 'network' | 'unknown';
    message: string;
    details?: string;
}

interface ProviderAdapter {
    readonly provider: LLMProvider;
    readonly displayName: string;
    readonly requiresApiKey: boolean;
    getConfig(settings: SibylSettings): ProviderConfig;
    getCapabilities(model: string): ModelCapabilities;
    buildRequestBody(request: ChatRequest): Record<string, unknown>;
    buildHeaders(config: ProviderConfig): Record<string, string>;
    getEndpoint(config: ProviderConfig): string;
    extractContent(data: any): string;
    normalizeError(status: number, bodyText: string): ProviderError;
}

function joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function parseOptionalNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonBody(bodyText: string): any {
    if (!bodyText) {
        return null;
    }

    try {
        return JSON.parse(bodyText);
    } catch {
        return null;
    }
}

function extractErrorMessage(bodyText: string): string {
    const parsed = parseJsonBody(bodyText);
    if (parsed?.error?.message && typeof parsed.error.message === 'string') {
        return parsed.error.message;
    }

    if (parsed?.message && typeof parsed.message === 'string') {
        return parsed.message;
    }

    return bodyText || 'Unknown provider error.';
}

abstract class OpenAICompatibleAdapter implements ProviderAdapter {
    abstract readonly provider: LLMProvider;
    abstract readonly displayName: string;
    readonly requiresApiKey = true;

    abstract getConfig(settings: SibylSettings): ProviderConfig;

    getCapabilities(_model: string): ModelCapabilities {
        return {
            supportsTemperature: true,
            supportsMaxTokens: true
        };
    }

    buildRequestBody(request: ChatRequest): Record<string, unknown> {
        const body: Record<string, unknown> = {
            model: request.model,
            messages: request.messages
        };

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        if (request.max_tokens !== undefined) {
            body.max_tokens = request.max_tokens;
        }

        return body;
    }

    buildHeaders(config: ProviderConfig): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (config.apiKey.trim()) {
            headers.Authorization = `Bearer ${config.apiKey}`;
        }

        return headers;
    }

    getEndpoint(config: ProviderConfig): string {
        return joinUrl(config.baseUrl, '/chat/completions');
    }

    extractContent(data: any): string {
        const content = data?.choices?.[0]?.message?.content;

        if (typeof content === 'string') {
            return content;
        }

        if (Array.isArray(content)) {
            return content
                .map((part) => typeof part?.text === 'string' ? part.text : '')
                .join('')
                .trim();
        }

        throw new Error('The provider response did not include a chat completion message.');
    }

    normalizeError(status: number, bodyText: string): ProviderError {
        const message = extractErrorMessage(bodyText);

        if (status === 401 || status === 403) {
            return { code: 'auth', message: 'Authentication failed.', details: message };
        }

        if (status === 404) {
            return { code: 'model_not_found', message: 'Model or endpoint not found.', details: message };
        }

        if (status === 429) {
            return { code: 'rate_limit', message: 'Rate limit exceeded.', details: message };
        }

        if (status === 400 && /temperature|max_tokens|unsupported/i.test(message)) {
            return { code: 'unsupported_param', message: 'The provider rejected one or more request parameters.', details: message };
        }

        return { code: 'unknown', message: 'The provider returned an error.', details: message };
    }
}

class GitHubAdapter extends OpenAICompatibleAdapter {
    readonly provider: LLMProvider = 'github';
    readonly displayName = 'GitHub Models';

    getConfig(settings: SibylSettings): ProviderConfig {
        return settings.providers.github;
    }

    getCapabilities(_model: string): ModelCapabilities {
        return {
            supportsTemperature: false,
            supportsMaxTokens: false
        };
    }

    buildHeaders(config: ProviderConfig): Record<string, string> {
        return {
            ...super.buildHeaders(config),
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    getEndpoint(config: ProviderConfig): string {
        return joinUrl(config.baseUrl, '/chat/completions');
    }

    normalizeError(status: number, bodyText: string): ProviderError {
        const baseError = super.normalizeError(status, bodyText);

        if (baseError.code === 'auth') {
            return {
                ...baseError,
                details: `${baseError.details ?? ''} Your token may lack access to this model.`
            };
        }

        return baseError;
    }
}

class OpenRouterAdapter extends OpenAICompatibleAdapter {
    readonly provider: LLMProvider = 'openrouter';
    readonly displayName = 'OpenRouter';

    getConfig(settings: SibylSettings): ProviderConfig {
        return settings.providers.openrouter;
    }

    buildHeaders(config: ProviderConfig): Record<string, string> {
        return {
            ...super.buildHeaders(config),
            'HTTP-Referer': 'https://obsidian.md',
            'X-Title': 'Sibyl'
        };
    }
}

class CustomOpenAICompatibleAdapter extends OpenAICompatibleAdapter {
    readonly provider: LLMProvider = 'openai_compatible';
    readonly displayName = 'OpenAI-Compatible';
    readonly requiresApiKey = false;

    getConfig(settings: SibylSettings): ProviderConfig {
        return settings.providers.openaiCompatible;
    }
}

class GoogleGeminiAdapter implements ProviderAdapter {
    readonly provider: LLMProvider = 'google';
    readonly displayName = 'Google Gemini';
    readonly requiresApiKey = true;

    getConfig(settings: SibylSettings): ProviderConfig {
        return settings.providers.google;
    }

    getCapabilities(_model: string): ModelCapabilities {
        return {
            supportsTemperature: true,
            supportsMaxTokens: true
        };
    }

    buildRequestBody(request: ChatRequest): Record<string, unknown> {
        const systemMessages = request.messages.filter((message) => message.role === 'system');
        const nonSystemMessages = request.messages.filter((message) => message.role !== 'system');

        const body: Record<string, unknown> = {
            contents: nonSystemMessages.map((message) => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }]
            }))
        };

        if (systemMessages.length > 0) {
            body.systemInstruction = {
                parts: systemMessages.map((message) => ({ text: message.content }))
            };
        }

        const generationConfig: Record<string, unknown> = {};
        if (request.temperature !== undefined) {
            generationConfig.temperature = request.temperature;
        }

        if (request.max_tokens !== undefined) {
            generationConfig.maxOutputTokens = request.max_tokens;
        }

        if (Object.keys(generationConfig).length > 0) {
            body.generationConfig = generationConfig;
        }

        return body;
    }

    buildHeaders(_config: ProviderConfig): Record<string, string> {
        return {
            'Content-Type': 'application/json'
        };
    }

    getEndpoint(config: ProviderConfig): string {
        const baseUrl = config.baseUrl.replace(/\/+$/, '');
        const model = encodeURIComponent(config.model);
        const apiKey = encodeURIComponent(config.apiKey);
        return `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
    }

    extractContent(data: any): string {
        const parts = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) {
            throw new Error('Google Gemini response did not include candidate content.');
        }

        const text = parts
            .map((part) => typeof part?.text === 'string' ? part.text : '')
            .join('')
            .trim();

        if (!text) {
            throw new Error('Google Gemini response did not include text content.');
        }

        return text;
    }

    normalizeError(status: number, bodyText: string): ProviderError {
        const parsed = parseJsonBody(bodyText);
        const message = extractErrorMessage(bodyText);
        const errorStatus = typeof parsed?.error?.status === 'string' ? parsed.error.status : '';

        if (status === 401 || status === 403) {
            return { code: 'auth', message: 'Authentication failed.', details: message };
        }

        if (status === 404) {
            return { code: 'model_not_found', message: 'Model not found.', details: message };
        }

        if (status === 429) {
            return { code: 'rate_limit', message: 'Rate limit exceeded.', details: message };
        }

        if (status === 400 && (errorStatus === 'INVALID_ARGUMENT' || /temperature|maxoutputtokens|unsupported|invalid/i.test(message))) {
            return { code: 'unsupported_param', message: 'The provider rejected one or more request parameters.', details: message };
        }

        return { code: 'unknown', message: 'The provider returned an error.', details: message };
    }
}

const ADAPTERS: Record<LLMProvider, ProviderAdapter> = {
    github: new GitHubAdapter(),
    openrouter: new OpenRouterAdapter(),
    openai_compatible: new CustomOpenAICompatibleAdapter(),
    google: new GoogleGeminiAdapter()
};

export class LLMService {
    constructor(private settings: SibylSettings) {}

    private getAdapter(): ProviderAdapter {
        return ADAPTERS[this.settings.provider];
    }

    private buildMessages(prompt: string, context: string, history: ConversationMessage[] = []): ChatMessage[] {
        return [
            {
                role: 'system',
                content: 'You are Sibyl, a helpful assistant with access to the user\'s private knowledge base. Answer using the provided context and cite sources inline using bracketed numbers like [1] and [2] that match the numbered context blocks. If the context is insufficient, say so plainly.'
            },
            ...history.map((message) => ({
                role: message.role,
                content: message.content
            })),
            {
                role: 'user',
                content: `Context:\n${context}\n\nQuery: ${prompt}`
            }
        ];
    }

    private buildRequest(
        config: ProviderConfig,
        adapter: ProviderAdapter,
        prompt: string,
        context: string,
        history: ConversationMessage[] = []
    ): ChatRequest {
        const capabilities = adapter.getCapabilities(config.model);
        const request: ChatRequest = {
            model: config.model,
            messages: this.buildMessages(prompt, context, history)
        };

        const temperature = parseOptionalNumber(this.settings.generation.temperature);
        if (capabilities.supportsTemperature && temperature !== undefined) {
            request.temperature = temperature;
        }

        const maxTokens = parseOptionalNumber(this.settings.generation.maxTokens);
        if (capabilities.supportsMaxTokens && maxTokens !== undefined) {
            request.max_tokens = maxTokens;
        }

        return request;
    }

    private validateConfig(adapter: ProviderAdapter, config: ProviderConfig) {
        if (adapter.requiresApiKey && !config.apiKey.trim()) {
            throw new Error(`${adapter.displayName} API key is not set in Sibyl settings.`);
        }

        if (!config.model.trim()) {
            throw new Error(`${adapter.displayName} model is not set in Sibyl settings.`);
        }

        if (!config.baseUrl.trim()) {
            throw new Error(`${adapter.displayName} base URL is not set in Sibyl settings.`);
        }
    }

    async generate(prompt: string, context: string, history: ConversationMessage[] = []): Promise<string> {
        const adapter = this.getAdapter();
        const config = adapter.getConfig(this.settings);
        this.validateConfig(adapter, config);

        const request = this.buildRequest(config, adapter, prompt, context, history);

        let response: Response;
        try {
            response = await fetch(adapter.getEndpoint(config), {
                method: 'POST',
                headers: adapter.buildHeaders(config),
                body: JSON.stringify(adapter.buildRequestBody(request))
            });
        } catch (error: any) {
            throw new Error(`Network error while calling ${adapter.displayName}: ${error?.message ?? 'Request failed.'}`);
        }

        if (!response.ok) {
            const bodyText = await response.text();
            const normalized = adapter.normalizeError(response.status, bodyText);
            console.error(`${adapter.displayName} API error`, {
                provider: adapter.provider,
                status: response.status,
                body: bodyText
            });
            const details = normalized.details ? ` ${normalized.details}` : '';
            throw new Error(`${adapter.displayName} error (${normalized.code}): ${normalized.message}${details}`);
        }

        const data = await response.json();
        return adapter.extractContent(data);
    }
}
