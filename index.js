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
    saveSettingsDebounced,
    generateRaw
} from "../../../../script.js";
import { extension_settings, getContext, renderExtensionTemplateAsync } from "../../../extensions.js";
import { generateWebLlmChatPrompt, isWebLlmSupported } from "../../shared.js";

const MODULE_NAME = "emotion_plugin";
const TEMPLATE_FOLDER = "third-party/st-Emotion";

// Where the reflection is generated
const BACKENDS = {
    API: "api",         // separate OpenAI-compatible text completion endpoint
    WEBLLM: "webllm",   // in the browser via the WebLLM extension
    MAIN: "main"        // the API SillyTavern is connected to
};

// Default reflection prompt, {{user}}, {{char}} and {{messages}} are filled in per message
const DEFAULT_INSTRUCTION = "Given the interaction between {{user}} (the user) and {{char}} (the character), reflect on the emotional tone in their conversation.";
const DEFAULT_REQUEST = `Based on the text below:

{{messages}}

How should {{char}} be feeling about this interaction? Provide a thoughtful emotional analysis.`;

const defaultSettings = {
    backend: BACKENDS.API,
    position: extension_prompt_types.IN_PROMPT,
    depth: 1,
    role: extension_prompt_roles.SYSTEM,
    apiUrl: "http://127.0.0.1:1234/v1/completions",
    model: "",
    apiKey: "",
    maxTokens: 512,
    promptInstruction: DEFAULT_INSTRUCTION,
    promptRequest: DEFAULT_REQUEST
};

/**
 * Fills in the placeholders of a prompt template in a single pass,
 * so placeholders that appear inside the chat messages stay untouched.
 * @param {string} template Prompt template
 * @param {{user: string, char: string, messages: string}} values Placeholder values
 * @returns {string} Filled prompt
 */
function fillPrompt(template, values) {
    return template.replace(/\{\{(user|char|messages)\}\}/gi, (_, key) => values[key.toLowerCase()]);
}

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

const TEST_PROMPT = "Reply with the single word OK.";

/**
 * Tests the selected backend.
 * Started by the button (manual), it generates a short test reply and reports the result as a notification.
 * The automatic test on page load only checks availability, so it neither uses tokens nor loads a WebLLM model.
 * @param {boolean} manual Whether the test was started with the button
 */
async function testConnection(manual = false) {
    const settings = extension_settings[MODULE_NAME];
    const $status = $("#emotion_connection_status");
    const report = (ok, text) => {
        $status.removeClass("emotion-status-ok emotion-status-fail")
            .addClass(ok ? "emotion-status-ok" : "emotion-status-fail")
            .text(text);
        if (manual) {
            toastr[ok ? "success" : "error"](text, "st-Emotion");
        }
    };
    const reportReply = (reply) => {
        const text = String(reply ?? "").trim();
        if (text) {
            report(true, `Working – model replied: "${text.slice(0, 60)}"`);
        } else {
            report(false, "The backend returned no text");
        }
    };
    $status.removeClass("emotion-status-ok emotion-status-fail").text("Testing connection...");

    try {
        if (settings.backend === BACKENDS.WEBLLM) {
            if (!isWebLlmSupported()) {
                report(false, "WebLLM not available (extension missing or no WebGPU)");
                return;
            }
            if (!manual) {
                report(true, "WebLLM available – click Test Connection to try a generation");
                return;
            }
            $status.text("Testing... (loading the WebLLM model can take a while)");
            reportReply(await generateWebLlmChatPrompt([{ role: "user", content: TEST_PROMPT }], { max_tokens: 10 }));
            return;
        }

        if (settings.backend === BACKENDS.MAIN) {
            if (getContext().onlineStatus === "no_connection") {
                report(false, "SillyTavern is not connected to an API");
                return;
            }
            if (!manual) {
                report(true, "SillyTavern is connected – click Test Connection to try a generation");
                return;
            }
            reportReply(await generateRaw({ prompt: TEST_PROMPT, responseLength: 10 }));
            return;
        }

        if (!settings.apiUrl) {
            report(false, "No API URL set");
            return;
        }

        const body = {
            prompt: manual ? TEST_PROMPT : "Hi",
            max_tokens: manual ? 10 : 1
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
        const reply = data?.choices?.[0]?.text ?? data?.generated_text;
        if (reply === undefined) {
            throw new Error("unexpected response format, is this a text completion endpoint?");
        }

        if (manual) {
            reportReply(reply);
        } else {
            report(true, "Connected – endpoint responded correctly");
        }
    } catch (error) {
        console.error("Emotion Plugin: Connection test failed", error);
        report(false, `Connection failed (${error.message})`);
    }
}

function updateBackendUI(backend) {
    $("#emotion_api_settings").toggle(backend === BACKENDS.API);
    $("#emotion_webllm_hint").toggle(backend === BACKENDS.WEBLLM);
    $("#emotion_main_hint").toggle(backend === BACKENDS.MAIN);
}

function bindSettingsUI() {
    const settings = extension_settings[MODULE_NAME];

    $("#emotion_backend").val(settings.backend).on("change", function () {
        settings.backend = String($(this).val());
        saveSettingsDebounced();
        updateBackendUI(settings.backend);
        testConnection();
    });
    updateBackendUI(settings.backend);

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

    $("#emotion_max_tokens").val(settings.maxTokens).on("input", function () {
        settings.maxTokens = Number($(this).val());
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

    $("#emotion_test_connection").on("click", () => testConnection(true));

    $("#emotion_prompt_instruction").val(settings.promptInstruction).on("input", function () {
        settings.promptInstruction = String($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_prompt_request").val(settings.promptRequest).on("input", function () {
        settings.promptRequest = String($(this).val());
        saveSettingsDebounced();
    });

    $("#emotion_prompt_reset").on("click", function () {
        if (!confirm("Restore the default reflection prompt? Your changes will be lost.")) return;
        settings.promptInstruction = DEFAULT_INSTRUCTION;
        settings.promptRequest = DEFAULT_REQUEST;
        $("#emotion_prompt_instruction").val(settings.promptInstruction);
        $("#emotion_prompt_request").val(settings.promptRequest);
        saveSettingsDebounced();
    });
}

jQuery(async () => {
    loadSettings();
    const settingsHtml = await renderExtensionTemplateAsync(TEMPLATE_FOLDER, "settings");
    $("#extensions_settings2").append(settingsHtml);
    bindSettingsUI();
    testConnection();
});

// SillyTavern connects to its API after the extensions are loaded
eventSource.on(event_types.ONLINE_STATUS_CHANGED, () => {
    if (extension_settings[MODULE_NAME]?.backend === BACKENDS.MAIN) {
        testConnection();
    }
});

/**
 * Generates the reflection with the selected backend.
 * @param {object} settings Extension settings
 * @param {string} instruction What to reflect on
 * @param {string} request The conversation and the question about it
 * @returns {Promise<string>} The reflection, empty if nothing was generated
 */
async function generateReflection(settings, instruction, request) {
    const maxTokens = settings.maxTokens > 0 ? settings.maxTokens : defaultSettings.maxTokens;

    if (settings.backend === BACKENDS.WEBLLM) {
        if (!isWebLlmSupported()) return "";
        const messages = [
            { role: "system", content: instruction },
            { role: "user", content: request }
        ];
        return await generateWebLlmChatPrompt(messages, { max_tokens: maxTokens, temperature: 1.0, top_p: 0.95 }) ?? "";
    }

    if (settings.backend === BACKENDS.MAIN) {
        return await generateRaw({ systemPrompt: instruction, prompt: request, responseLength: maxTokens }) ?? "";
    }

    const body = {
        prompt: `
### Instruction:
${instruction}
${request}

### Response:
`,
        max_tokens: maxTokens,
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
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    return result?.generated_text || result?.choices?.[0]?.text || "";
}

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

    // An emptied prompt field falls back to the default
    const values = { user: userName, char: charName, messages: formattedMessages };
    const instruction = fillPrompt(settings.promptInstruction?.trim() ? settings.promptInstruction : DEFAULT_INSTRUCTION, values);
    const request = fillPrompt(settings.promptRequest?.trim() ? settings.promptRequest : DEFAULT_REQUEST, values);

    try {
        const reasoningText = (await generateReflection(settings, instruction, request))?.trim();

        if (reasoningText) {
            setExtensionPrompt(
                MODULE_NAME,
                `(Inner Thought: ${reasoningText})`,
                settings.position,
                settings.depth,
                false,
                settings.role
            );
            // The inner thought is hidden from the chat, show it in the settings instead
            $("#emotion_last_reflection").val(reasoningText);
            console.debug("Emotion Plugin: Inner thought", reasoningText);
        } else {
            toastr.warning("No reflection was generated. Check the backend with Test Connection.", "st-Emotion", { preventDuplicates: true });
        }
    } catch (error) {
        console.error("Emotion Plugin: Error generating the reflection", error);
        toastr.error(`Reflection failed: ${error.message}`, "st-Emotion", { preventDuplicates: true });
    }
});
