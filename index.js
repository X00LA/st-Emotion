/**
 * Modified index.js - Local Emotion Offload Plugin for SillyTavern
 *
 * Extracts the last few replies using the properties 'mes' for message text and 'name' for sender,
 * and attempts to determine the user and character names.
 */

import {
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    eventSource,
    event_types,
    saveSettingsDebounced
} from "../../../../script.js";
import { extension_settings, getContext, renderExtensionTemplateAsync } from "../../../extensions.js";

const MODULE_NAME = "emotion_plugin";
const TEMPLATE_FOLDER = "third-party/st-Emotion";

const defaultSettings = {
    position: extension_prompt_types.IN_PROMPT,
    depth: 1,
    role: extension_prompt_roles.SYSTEM,
    apiUrl: "http://127.0.0.1:1234/v1/completions",
    model: "llama-3.1-8b-lexi-v2",
    apiKey: ""
};

function buildHeaders(settings) {
    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) {
        headers["Authorization"] = `Bearer ${settings.apiKey}`;
    }
    return headers;
}

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return extension_settings[MODULE_NAME];
}

async function testConnection() {
    const settings = extension_settings[MODULE_NAME];
    const $status = $("#emotion_connection_status");
    $status.removeClass("emotion-status-ok emotion-status-fail").text("Testing connection...");

    if (!settings.apiUrl) {
        $status.addClass("emotion-status-fail").text("No API URL set");
        return;
    }

    try {
        const body = {
            prompt: "Hi",
            max_tokens: 1
        };
        if (settings.model) {
            body.model = settings.model;
        }

        const response = await fetch(settings.apiUrl, {
            method: "POST",
            headers: buildHeaders(settings),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const hasResult = data?.choices?.[0]?.text !== undefined || data?.generated_text !== undefined;
        if (!hasResult) {
            throw new Error("unexpected response format");
        }

        $status.addClass("emotion-status-ok").text("Connected – endpoint responded correctly");
    } catch (error) {
        console.error("Emotion Plugin: Connection test failed", error);
        $status.addClass("emotion-status-fail").text(`Connection failed (${error.message})`);
    }
}

function bindSettingsUI() {
    const settings = extension_settings[MODULE_NAME];

    $("#emotion_api_url").val(settings.apiUrl).on("input", function () {
        settings.apiUrl = String($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_model").val(settings.model).on("input", function () {
        settings.model = String($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_api_key").val(settings.apiKey).on("input", function () {
        settings.apiKey = String($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_position").val(String(settings.position)).on("change", function () {
        settings.position = Number($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_depth").val(settings.depth).on("input", function () {
        settings.depth = Number($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_role").val(String(settings.role)).on("change", function () {
        settings.role = Number($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_test_connection").on("click", testConnection);
}

jQuery(async () => {
    loadSettings();
    const settingsHtml = await renderExtensionTemplateAsync(TEMPLATE_FOLDER, "settings");
    $("#extensions_settings2").append(settingsHtml);
    bindSettingsUI();
    testConnection();
});

// Main emotion hook

eventSource.on(event_types.MESSAGE_SENT, async () => {
    const context = getContext();
    const chatLog = context.chat;
    if (!chatLog || chatLog.length === 0) return;

    const settings = extension_settings[MODULE_NAME];

    const numMessagesToInclude = 5;
    const recentMessages = chatLog.slice(-numMessagesToInclude);

    const formattedMessages = recentMessages.map(msg => {
        const sender = msg.name || "unknown";
        const content = msg.mes || "";
        return `[${sender}] ${content}`;
    }).join("\n");

    let charName = "Unknown";
    let userName = chatLog[chatLog.length - 1].name || "User";

    if (context.characterId && context.characters?.[context.characterId]?.name) {
        charName = context.characters[context.characterId].name;
    } else {
        const lastSender = userName;
        for (let i = chatLog.length - 2; i >= 0; i--) {
            const candidate = chatLog[i].name;
            if (candidate && candidate !== lastSender) {
                charName = candidate;
                break;
            }
        }
    }

    const emotionPrompt = `
### Instruction:
Given the interaction between ${userName} (the user) and ${charName} (the character), reflect on the emotional tone in their conversation.
Based on the text below:

${formattedMessages}

How should ${charName} be feeling about this interaction? Provide a thoughtful emotional analysis.

### Response:
`;

    try {
        const body = {
            prompt: emotionPrompt,
            max_tokens: 2048,
            do_sample: true,
            temperature: 1.0,
            top_p: 0.95,
            top_k: 40,
            repetition_penalty: 1.2
        };
        if (settings.model) {
            body.model = settings.model;
        }

        const response = await fetch(settings.apiUrl, {
            method: 'POST',
            headers: buildHeaders(settings),
            body: JSON.stringify(body)
        });

        const result = await response.json();
        let reasoningText = result?.generated_text?.trim() || result?.choices?.[0]?.text?.trim();

        if (reasoningText) {
            setExtensionPrompt(
                MODULE_NAME,
                `(Inner Thought: ${reasoningText})`,
                settings.position,
                settings.depth,
                false,
                settings.role
            );
        }
    } catch (error) {
        console.error("Emotion Plugin: Error calling local LLM endpoint", error);
    }
});
