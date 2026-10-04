# st-Emotion

st-Emotion gives SillyTavern characters an inner voice. Each time you send a message, the last five chat messages are passed to an LLM that reflects on how the character feels about the interaction. The reflection is added to the prompt as `(Inner Thought: …)`, so the character's reply can draw on it. It is not shown in the chat.

## Installation

1. Open the Extensions panel in SillyTavern and click **Install extension**.
2. Enter `https://github.com/X00LA/st-Emotion` and confirm.

The extension folder must be named `st-Emotion`, because the settings page is loaded from that path. Installing via URL takes care of that.

## Backends

Choose where the reflection is generated under **Backend** in the settings:

| Backend | What you need |
| --- | --- |
| **OpenAI-compatible API** | A separate server with a text completion endpoint, e.g. LM Studio at `http://127.0.0.1:1234/v1/completions`. The extension sends a `prompt` and reads `choices[0].text` (or `generated_text`), so chat completion (`/v1/chat/completions`) and embedding endpoints do not work. |
| **WebLLM** | The [WebLLM extension](https://github.com/SillyTavern/Extension-WebLLM) and a browser with WebGPU. The model runs in the browser; choose and download it in the WebLLM settings. Only small models are practical. |
| **SillyTavern's connected API** | Nothing extra. The reflection uses the API and model SillyTavern is connected to, which costs time and tokens there. |

## Settings

Extensions panel → **Emotion Plugin Settings**:

| Setting | Default | Description |
| --- | --- | --- |
| Backend | OpenAI-compatible API | Where the reflection is generated, see above |
| API URL | `http://127.0.0.1:1234/v1/completions` | Text completion endpoint (OpenAI-compatible API only) |
| Model Name | empty | Sent as `model`; leave empty to use the model loaded on the server (OpenAI-compatible API only) |
| API Key | empty | Sent as `Authorization: Bearer …` if set (OpenAI-compatible API only) |
| Max Reflection Length | 512 | Maximum length of the reflection in tokens |
| Test Connection | – | Checks the selected backend. For the API it sends a one-token request; for WebLLM it only checks availability, so no model is downloaded. Also runs when the page loads. |
| Reflection Prompt – Instruction | see below | System prompt for the reflection |
| Reflection Prompt – Request | see below | The request with the chat messages |
| Restore default prompt | – | Resets both prompt fields to the default |
| Injection Position | After Main Prompt | Where the inner thought goes: None, Before Main Prompt, After Main Prompt, In-chat @ Depth |
| Injection Depth | 1 | Depth for In-chat @ Depth |
| Injected As | System | Role of the injected text: System, User or Assistant |

## Reflection prompt

The prompt that asks for the reflection can be edited in the settings. It has two parts:

- **Instruction**, sent as the system prompt
- **Request**, the actual request with the chat messages

Placeholders, filled in for each message:

| Placeholder | Replaced with |
| --- | --- |
| `{{user}}` | The user's name |
| `{{char}}` | The character's name |
| `{{messages}}` | The last five chat messages, one per line as `[Name] text` |

Default instruction:

```text
Given the interaction between {{user}} (the user) and {{char}} (the character), reflect on the emotional tone in their conversation.
```

Default request:

```text
Based on the text below:

{{messages}}

How should {{char}} be feeling about this interaction? Provide a thoughtful emotional analysis.
```

An empty field uses the default. With the OpenAI-compatible API, both parts are combined into one text prompt in the format `### Instruction:` … `### Response:`.

## Good to know

- SillyTavern waits for the reflection before generating the character's reply. A slow backend or a long reflection delays every reply, so keep **Max Reflection Length** small.
- The sampling parameters (temperature 1.0, top-p 0.95; for the API also top-k 40, repetition penalty 1.2) are set in `index.js`.
- If no reflection is generated, for example because the backend is unreachable, the previous inner thought stays in the prompt until you switch chats. Errors are logged to the browser console.

## Credits

Original extension and idea by [LeetHappyfeet](https://github.com/LeetHappyfeet/st-Emotion).
