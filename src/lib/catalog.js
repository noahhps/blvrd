/* Every model server the app knows how to reach, before the reader has set
 * any of them up.
 *
 * Three protocols cover all of them: Ollama's own, Anthropic's, and the
 * OpenAI-compatible chat API that nearly every open-source server and host
 * speaks. So a new entry here is usually one line -- a name, a base URL, and
 * where to get a key -- and no new code.
 *
 * Local servers come first and are what the app looks for on its own (the
 * "Find local servers" button probes each `base`). Hosted ones are split by
 * what they serve: open-weight models first -- the same Llama, Qwen, Mistral,
 * DeepSeek and Gemma you could run at home, on someone else's GPUs -- then the
 * closed APIs. A hosted server is sent your messages; the app says so wherever
 * one is chosen.
 */

export const LOCAL = [
  {
    id: "ollama",
    kind: "ollama",
    name: "Ollama",
    base: "http://127.0.0.1:11434",
    note: "The default. `ollama pull qwen3` (or any model) and it shows up here.",
    site: "https://ollama.com",
  },
  {
    id: "lmstudio",
    kind: "openai",
    name: "LM Studio",
    base: "http://127.0.0.1:1234/v1",
    note: "Start the server from LM Studio's Developer tab.",
    site: "https://lmstudio.ai",
  },
  {
    id: "llamacpp",
    kind: "openai",
    name: "llama.cpp server",
    base: "http://127.0.0.1:8080/v1",
    note: "`llama-server -m model.gguf --jinja` (the --jinja flag turns tool calls on). llamafile, LocalAI and MLX LM use this port too.",
    site: "https://github.com/ggml-org/llama.cpp",
  },
  {
    id: "unsloth",
    kind: "openai",
    name: "Unsloth",
    base: "http://127.0.0.1:8888/v1",
    note: "Load a model in Unsloth Studio, then make a key under Settings → API and paste it here.",
    site: "https://unsloth.ai",
    // Unsloth won't answer without one of its own `sk-unsloth-…` keys,
    // even on this machine.
    localKey: true,
  },
  {
    id: "jan",
    kind: "openai",
    name: "Jan",
    base: "http://127.0.0.1:1337/v1",
    note: "Turn on the Local API Server in Jan's settings.",
    site: "https://jan.ai",
  },
  {
    id: "vllm",
    kind: "openai",
    name: "vLLM",
    base: "http://127.0.0.1:8000/v1",
    note: "`vllm serve <model> --enable-auto-tool-choice --tool-call-parser <parser>` for tools.",
    site: "https://docs.vllm.ai",
  },
  {
    id: "sglang",
    kind: "openai",
    name: "SGLang",
    base: "http://127.0.0.1:30000/v1",
    note: "`python -m sglang.launch_server --model-path <model>`.",
    site: "https://docs.sglang.ai",
  },
  {
    id: "koboldcpp",
    kind: "openai",
    name: "KoboldCpp",
    base: "http://127.0.0.1:5001/v1",
    note: "Its OpenAI-compatible endpoint is on by default.",
    site: "https://github.com/LostRuins/koboldcpp",
  },
  {
    id: "textgen",
    kind: "openai",
    name: "text-generation-webui",
    base: "http://127.0.0.1:5000/v1",
    note: "Start it with --api. TabbyAPI uses the same port.",
    site: "https://github.com/oobabooga/text-generation-webui",
  },
  {
    id: "gpt4all",
    kind: "openai",
    name: "GPT4All",
    base: "http://127.0.0.1:4891/v1",
    note: "Enable the Local API Server in GPT4All's settings.",
    site: "https://gpt4all.io",
  },
];

export const HOSTED_OPEN = [
  { id: "huggingface", kind: "openai", name: "Hugging Face", base: "https://router.huggingface.co/v1", keys: "https://huggingface.co/settings/tokens" },
  { id: "together", kind: "openai", name: "Together AI", base: "https://api.together.xyz/v1", keys: "https://api.together.ai/settings/api-keys" },
  { id: "groq", kind: "openai", name: "Groq", base: "https://api.groq.com/openai/v1", keys: "https://console.groq.com/keys" },
  { id: "fireworks", kind: "openai", name: "Fireworks", base: "https://api.fireworks.ai/inference/v1", keys: "https://fireworks.ai/account/api-keys" },
  { id: "deepinfra", kind: "openai", name: "DeepInfra", base: "https://api.deepinfra.com/v1/openai", keys: "https://deepinfra.com/dash/api_keys" },
  { id: "cerebras", kind: "openai", name: "Cerebras", base: "https://api.cerebras.ai/v1", keys: "https://cloud.cerebras.ai" },
  { id: "sambanova", kind: "openai", name: "SambaNova", base: "https://api.sambanova.ai/v1", keys: "https://cloud.sambanova.ai/apis" },
  { id: "nebius", kind: "openai", name: "Nebius AI Studio", base: "https://api.studio.nebius.com/v1", keys: "https://studio.nebius.com" },
  { id: "hyperbolic", kind: "openai", name: "Hyperbolic", base: "https://api.hyperbolic.xyz/v1", keys: "https://app.hyperbolic.xyz/settings" },
  { id: "novita", kind: "openai", name: "Novita AI", base: "https://api.novita.ai/v3/openai", keys: "https://novita.ai/settings/key-management" },
  { id: "openrouter", kind: "openai", name: "OpenRouter", base: "https://openrouter.ai/api/v1", keys: "https://openrouter.ai/keys" },
  { id: "mistral", kind: "openai", name: "Mistral", base: "https://api.mistral.ai/v1", keys: "https://console.mistral.ai/api-keys" },
  { id: "deepseek", kind: "openai", name: "DeepSeek", base: "https://api.deepseek.com/v1", keys: "https://platform.deepseek.com/api_keys" },
];

export const HOSTED_CLOSED = [
  { id: "anthropic", kind: "anthropic", name: "Anthropic", base: "https://api.anthropic.com", keys: "https://console.anthropic.com/settings/keys" },
  { id: "openai", kind: "openai", name: "OpenAI", base: "https://api.openai.com/v1", keys: "https://platform.openai.com/api-keys" },
  { id: "gemini", kind: "openai", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", keys: "https://aistudio.google.com/apikey" },
  { id: "xai", kind: "openai", name: "xAI", base: "https://api.x.ai/v1", keys: "https://console.x.ai" },
];

export const CATALOG = [...LOCAL, ...HOSTED_OPEN, ...HOSTED_CLOSED];
export const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

/* Whether a URL stays on this machine or the local network. Decides the
 * "local" / "sends to <host>" label, nothing else -- a server the reader runs
 * on another box at home is still theirs. */
export function isLocalUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".localhost")) {
    return true;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
