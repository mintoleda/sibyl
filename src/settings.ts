import { App, PluginSettingTab, Setting } from 'obsidian';
import SibylPlugin from './main';
import { LLMProvider, ProviderConfig } from './types';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
    github: 'GitHub Models',
    openrouter: 'OpenRouter',
    openai_compatible: 'OpenAI-Compatible',
    google: 'Google Gemini'
};

export class SibylSettingTab extends PluginSettingTab {
    plugin: SibylPlugin;

    constructor(app: App, plugin: SibylPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private async saveAndRefresh() {
        await this.plugin.saveSettings();
        this.display();
    }

    private addProviderTextSetting(
        containerEl: HTMLElement,
        config: ProviderConfig,
        name: string,
        desc: string,
        placeholder: string,
        getValue: (config: ProviderConfig) => string,
        setValue: (config: ProviderConfig, value: string) => void
    ) {
        new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addText(text => text
                .setPlaceholder(placeholder)
                .setValue(getValue(config))
                .onChange(async (value) => {
                    setValue(config, value);
                    await this.plugin.saveSettings();
                }));
    }

    private renderProviderSection(containerEl: HTMLElement) {
        const provider = this.plugin.settings.provider;
        const providerSettings = provider === 'github'
            ? this.plugin.settings.providers.github
            : provider === 'openrouter'
                ? this.plugin.settings.providers.openrouter
                : provider === 'openai_compatible'
                    ? this.plugin.settings.providers.openaiCompatible
                    : this.plugin.settings.providers.google;

        containerEl.createEl('h3', { text: `${PROVIDER_LABELS[provider]} Settings` });

        if (provider === 'github') {
            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'GitHub Token',
                'GitHub PAT with models:read scope',
                'ghp_...',
                config => config.apiKey,
                (config, value) => { config.apiKey = value; }
            );

            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'GitHub Model ID',
                'Model in publisher/model format',
                'openai/gpt-5-mini',
                config => config.model,
                (config, value) => { config.model = value; }
            );
        }

        if (provider === 'openrouter') {
            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'OpenRouter API Key',
                'API key for OpenRouter',
                'sk-or-v1-...',
                config => config.apiKey,
                (config, value) => { config.apiKey = value; }
            );

            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'OpenRouter Model',
                'Model slug as accepted by OpenRouter',
                'openai/gpt-4o-mini',
                config => config.model,
                (config, value) => { config.model = value; }
            );
        }

        if (provider === 'openai_compatible') {
            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'Provider Label',
                'Optional label for this endpoint',
                'OpenCode / Local / Custom',
                config => config.label ?? '',
                (config, value) => { config.label = value; }
            );

            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'API Key',
                'Leave blank only if your endpoint does not require auth',
                'sk-...',
                config => config.apiKey,
                (config, value) => { config.apiKey = value; }
            );

            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'Model',
                'Model name expected by the endpoint',
                'gpt-4o-mini',
                config => config.model,
                (config, value) => { config.model = value; }
            );
        }

        if (provider === 'google') {
            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'Google API Key',
                'Gemini API key from Google AI Studio',
                'AIza...',
                config => config.apiKey,
                (config, value) => { config.apiKey = value; }
            );

            this.addProviderTextSetting(
                containerEl,
                providerSettings,
                'Google Model',
                'Gemini model name passed to generateContent',
                'gemini-3-flash-preview',
                config => config.model,
                (config, value) => { config.model = value; }
            );
        }

        this.addProviderTextSetting(
            containerEl,
            providerSettings,
            'Base URL',
            'Explicit endpoint root used for chat completions',
            provider === 'github'
                ? 'https://models.github.ai/inference'
                : provider === 'openrouter'
                    ? 'https://openrouter.ai/api/v1'
                    : provider === 'google'
                        ? 'https://generativelanguage.googleapis.com/v1beta'
                        : 'http://localhost:11434/v1',
            config => config.baseUrl,
            (config, value) => { config.baseUrl = value; }
        );
    }

    private renderIndexManagement(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Index Management' });

        const statsEl = containerEl.createDiv({ text: 'Loading index stats...' });
        statsEl.style.marginBottom = '8px';
        void this.plugin.getIndexStats().then((stats) => {
            const approxMb = (stats.estimatedBytes / (1024 * 1024)).toFixed(2);
            statsEl.setText(`${stats.notes} notes, ${stats.chunks} chunks, ~${approxMb} MB estimated storage`);
        }).catch(() => {
            statsEl.setText('Unable to load index stats.');
        });

        new Setting(containerEl)
            .setName('Clear Index')
            .setDesc('Remove all indexed notes and chunks from the local database')
            .addButton((button) => button
                .setButtonText('Clear')
                .onClick(async () => {
                    await this.plugin.clearIndex();
                    this.display();
                }));

        new Setting(containerEl)
            .setName('Rebuild Index')
            .setDesc('Run a full force reindex of the vault')
            .addButton((button) => button
                .setButtonText('Rebuild')
                .onClick(async () => {
                    await this.plugin.reindexVault(true);
                    this.display();
                }));
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Sibyl Settings' });

        new Setting(containerEl)
            .setName('LLM Provider')
            .setDesc('Select which provider handles answer generation')
            .addDropdown(dropdown => dropdown
                .addOption('github', PROVIDER_LABELS.github)
                .addOption('openrouter', PROVIDER_LABELS.openrouter)
                .addOption('openai_compatible', PROVIDER_LABELS.openai_compatible)
                .addOption('google', PROVIDER_LABELS.google)
                .setValue(this.plugin.settings.provider)
                .onChange(async (value: LLMProvider) => {
                    this.plugin.settings.provider = value;
                    await this.saveAndRefresh();
                }));

        this.renderProviderSection(containerEl);

        containerEl.createEl('h3', { text: 'Generation' });

        new Setting(containerEl)
            .setName('Temperature')
            .setDesc('Optional. Unsupported parameters are omitted automatically.')
            .addText(text => text
                .setPlaceholder('Leave blank for provider default')
                .setValue(this.plugin.settings.generation.temperature)
                .onChange(async (value) => {
                    this.plugin.settings.generation.temperature = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Output Tokens')
            .setDesc('Optional. Sent only when supported by the provider.')
            .addText(text => text
                .setPlaceholder('Leave blank to omit')
                .setValue(this.plugin.settings.generation.maxTokens)
                .onChange(async (value) => {
                    this.plugin.settings.generation.maxTokens = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Retrieval' });

        new Setting(containerEl)
            .setName('Top K')
            .setDesc('Number of chunks to retrieve')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.topK)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.topK = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Similarity Threshold')
            .setDesc('Minimum cosine similarity required for a chunk to be returned')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.05)
                .setValue(this.plugin.settings.similarityThreshold)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.similarityThreshold = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Chunk Size')
            .setDesc('Characters per chunk')
            .addText(text => text
                .setValue(String(this.plugin.settings.chunkSize))
                .onChange(async (value) => {
                    this.plugin.settings.chunkSize = Number(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Ignore Patterns')
            .setDesc('One folder or wildcard pattern per line. Matching notes are excluded from indexing.')
            .addTextArea(text => text
                .setPlaceholder('.obsidian/\nTemplates/\nArchive/')
                .setValue(this.plugin.settings.ignorePatterns.join('\n'))
                .onChange(async (value) => {
                    this.plugin.settings.ignorePatterns = value
                        .split(/\r?\n|,/)
                        .map(pattern => pattern.trim())
                        .filter(Boolean);
                    await this.plugin.saveSettings();
                }));

        this.renderIndexManagement(containerEl);
    }
}
