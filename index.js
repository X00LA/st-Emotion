/**
 * Modified index.js - Local Emotion Offload Plugin for SillyTavern
 *
 * Now it extracts the last few replies using the properties 'mes' for message text and 'name' for sender,
 * and it attempts to determine the user and character names.
 */

import {
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    eventSource,
    event_types
} from "../../../../script.js";
import { getContext } from "../../../extensions.js";

const MODULE_NAME = "emotion_plugin";

// Default settings
export let extension_settings = {
    [MODULE_NAME]: {
        position: extension_prompt_types.IN_PROMPT,
        depth: 1,
        role: extension_prompt_roles.SYSTEM
    }
};

// Load settings from the UI if available
eventSource.on(event_types.EXTENSION_SETTINGS_UPDATED, () => {
    const settings = extension_settings[MODULE_NAME];
    settings.position = Number(document.getElementById("emotion_position")?.value ?? settings.position);
    settings.depth = Number(document.getElementById("emotion_depth")?.value ?? settings.depth);
    settings.role = Number(document.getElementById("emotion_role")?.value ?? settings.role);
});

// Main emotion hook

const context = getContext();

eventSource.on(event_types.MESSAGE_SENT, async () => {
    const chatLog = context.chat;
    if (!chatLog || chatLog.length === 0) return;

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
        const response = await fetch("http://192.168.1.125:5000/v1/completions", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: emotionPrompt,
                max_tokens: 1200,
                do_sample: true,
                temperature: 1.0,
                top_p: 0.9,
                top_k: 40,
                repetition_penalty: 1.0
            })
        });

        const result = await response.json();
        let reasoningText = result?.generated_text?.trim() || result?.choices?.[0]?.text?.trim();

        if (reasoningText) {
            setExtensionPrompt(
                MODULE_NAME,
                `(Inner Thought: ${reasoningText})`,
                extension_settings[MODULE_NAME].position,
                extension_settings[MODULE_NAME].depth,
                false,
                extension_settings[MODULE_NAME].role
            );
        }
    } catch (error) {
        console.error("Emotion Plugin: Error calling local LLM endpoint", error);
    }
});